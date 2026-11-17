/**
 * GNAT work-zone engine.
 *
 * Answers one question: given the poles where work will happen, which spans end
 * up de-energised and which switching devices isolate them?
 *
 * Silent library: no DOM, no map interaction, no globals beyond `__gnatZone`.
 * Every remote call goes through an injected `client`, so the whole engine is
 * testable offline and the caller keeps ownership of transport, credentials and
 * timeouts.
 *
 * Budget first: a ring of `bearings` points per radius, stop the moment the
 * answer is good enough, and return a partial result with its reason instead of
 * spending minutes on an optimal one.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__gnatZone = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = {
    sectionId: 23,
    radiiMeters: [5, 12],
    bearings: 6,
    maxRequests: 24,
    maxMilliseconds: 8000,
    maxDeviceLookups: 8,
    maxStateReads: 4,
  };

  /** `F562541` or `5236366`, at the start of a display. */
  const CODE_AT_START = /^([A-Z]{0,3}\d{4,})\b/i;
  /** Only a pair of pole codes is an edge; `Trintre - Colonia Miraflores` is not. */
  const CODE_PAIR = /^([A-Z]{0,3}\d{4,})\s+-\s+([A-Z]{0,3}\d{4,})$/i;
  const DEVICE_TITLE = /\b(desconectador|seccional|reconectador|cuchilla|interruptor|fusible)\b/i;
  /** A pole title that can still feed a zone: energy comes from somewhere. */
  const SOURCE_TITLE = /\b(subestaci[oó]n|reconectador|alimentador|salida de l[ií]nea|generador)\b/i;
  const CABLES_ONLY = /^(alambre|cable|conductor)\b/i;

  const safeText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

  const codeOf = (display) => {
    const match = CODE_AT_START.exec(safeText(display).trim());
    return match ? match[1].toUpperCase() : null;
  };

  const codePairOf = (display) => {
    const match = CODE_PAIR.exec(safeText(display).trim());
    return match ? [match[1].toUpperCase(), match[2].toUpperCase()] : null;
  };

  /** The same pole pair carries MT and BT conductors; never collapse them. */
  const voltageOf = (object) => {
    const text = `${safeText(object && object.type)} ${safeText(object && object.display)}`;
    if (/\bMT\b/i.test(text)) return "mt";
    if (/\bBT\b/i.test(text)) return "bt";
    return "unknown";
  };

  const looksLikeConductor = (object) => CABLES_ONLY.test(safeText(object && object.type).trim());

  const stripTags = (html) =>
    safeText(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&aacute;/gi, "a")
      .replace(/&eacute;/gi, "e")
      .replace(/&iacute;/gi, "i")
      .replace(/&oacute;/gi, "o")
      .replace(/&uacute;/gi, "u")
      .replace(/\s+/g, " ")
      .trim();

  /**
   * Estado operativo from section 23. The endpoint answers HTML, and the state
   * reads as text: `Estado operativo: normalmente cerrado (NC)`.
   *
   * Anything that cannot be read stays `desconocido`: an unread switch is not a
   * closed switch.
   */
  const parseOperatingState = (html) => {
    const text = stripTags(html);
    const label = /Estado operativo:\s*([^:]{0,60}?)(?=\s(?:Tensi|Circuito|Vecinos)\b|$)/i.exec(text);
    const words = label ? label[1].trim() : "";
    let estado = "desconocido";
    if (/\babierto\b/i.test(words) && !/\bcerrado\b/i.test(words)) estado = "abierto";
    else if (/\bcerrado\b/i.test(words) && !/\babierto\b/i.test(words)) estado = "cerrado";
    const realFrom = /desde\s+(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}:\d{2})?(?:\s*-0\d)?)/i.exec(text);
    return {
      estado,
      estadoTexto: words || null,
      realDesde: realFrom ? realFrom[1].trim() : null,
      hasRealBlock: /\bReal\b/.test(text),
    };
  };

  const offsetOf = (lon, lat, radiusMeters, bearingRadians) => {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = metersPerDegreeLat * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    return {
      lon: lon + (radiusMeters * Math.cos(bearingRadians)) / metersPerDegreeLon,
      lat: lat + (radiusMeters * Math.sin(bearingRadians)) / metersPerDegreeLat,
    };
  };

  const featureList = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.features)) return payload.features;
    if (payload.geometry || payload.type === "Feature") return [payload];
    return [];
  };

  const pointOfFeature = (feature) => {
    const geometry = feature && feature.geometry;
    if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
    if (geometry.coordinates.length < 2) return null;
    return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  };

  /**
   * @param {object} options
   * @param {string[]} options.poleCodes  codes the operator selected
   * @param {object} options.client       injected transport (see README)
   * @param {object} [options.settings]    budget and ring overrides
   */
  async function findWorkZone(options) {
    const opts = options || {};
    const client = opts.client || {};
    const settings = Object.assign({}, DEFAULTS, opts.settings || {});
    const selected = (opts.poleCodes || [])
      .map((code) => safeText(code).trim().toUpperCase())
      .filter(Boolean);

    const started = Date.now();
    const budget = { used: 0, exceeded: null };

    const canSpend = () => {
      if (budget.used >= settings.maxRequests) return false;
      if (Date.now() - started >= settings.maxMilliseconds) return false;
      return true;
    };
    const spend = async (fn) => {
      budget.used += 1;
      return fn();
    };

    const resolved = [];
    const unresolved = [];

    for (const code of selected) {
      if (!canSpend()) break;
      let rows = [];
      try {
        rows = (await spend(() => client.search(code))) || [];
      } catch (error) {
        rows = [];
      }
      const exact = (Array.isArray(rows) ? rows : []).filter((row) => codeOf(row && row.display) === code);
      let point = null;
      for (const row of exact) {
        if (!canSpend()) break;
        const ids = [Number(row.surrogate_in_map_id), Number(row.object_id)].filter(
          (id, index, all) => Number.isFinite(id) && all.indexOf(id) === index
        );
        for (const id of ids) {
          if (!canSpend()) break;
          try {
            const payload = await spend(() => client.geojson([id]));
            const feature = featureList(payload)
              .map(pointOfFeature)
              .find(Boolean);
            if (feature) {
              point = feature;
              break;
            }
          } catch (error) {
            // try the next id
          }
        }
        if (point) break;
      }
      if (point) resolved.push({ code, lonlat: point, matches: exact.length });
      else unresolved.push(code);
    }

    const objects = new Map();
    const ringed = [];

    for (const entry of resolved) {
      if (!canSpend()) break;
      let found = false;
      for (const radius of settings.radiiMeters) {
        for (let index = 0; index < settings.bearings && canSpend(); index += 1) {
          const bearing = (2 * Math.PI * index) / settings.bearings;
          const point = offsetOf(entry.lonlat.lon, entry.lonlat.lat, radius, bearing);
          try {
            const rows = (await spend(() => client.pointObjects(point.lon, point.lat))) || [];
            for (const row of Array.isArray(rows) ? rows : []) {
              const key = safeText(row && row.id);
              if (objects.has(key)) continue;
              objects.set(key, { id: row.id, display: row.display, type: row.type });
            }
            if ((Array.isArray(rows) ? rows : []).some((row) => codePairOf(row && row.display))) found = true;
          } catch (error) {
            // a sample that fails is a sample lost, not a reason to stop
          }
        }
        if (found) break;
      }
      ringed.push({ code: entry.code, radiusMetersUsed: found ? settings.radiiMeters[0] : settings.radiiMeters[settings.radiiMeters.length - 1] });
    }

    const all = [...objects.values()];
    const edges = [];
    const deviceCandidates = [];

    for (const object of all) {
      const pair = codePairOf(object.display);
      if (pair) {
        edges.push({
          id: Number(object.id),
          from: pair[0],
          to: pair[1],
          voltage: voltageOf(object),
          display: object.display,
          type: object.type,
        });
      } else if (!looksLikeConductor(object)) {
        deviceCandidates.push(object);
      }
    }

    const zoneEdges = edges.filter((edge) => selected.includes(edge.from) || selected.includes(edge.to));

    const boundary = [];
    let lookups = 0;
    let stateReads = 0;

    for (const candidate of deviceCandidates) {
      if (lookups >= settings.maxDeviceLookups || !canSpend()) break;
      lookups += 1;
      let title = "";
      try {
        title = safeText(await spend(() => client.objectTitle(candidate.id)));
      } catch (error) {
        title = "";
      }
      const isDevice = DEVICE_TITLE.test(title) || DEVICE_TITLE.test(safeText(candidate.display));
      if (!isDevice) continue;

      const device = {
        id: Number(candidate.id),
        title: title || null,
        display: candidate.display,
        estado: "desconocido",
        estadoTexto: null,
        realDesde: null,
        hasRealBlock: false,
      };

      if (stateReads < settings.maxStateReads && canSpend()) {
        stateReads += 1;
        try {
          const html = await spend(() => client.sectionHtml(candidate.id, settings.sectionId));
          Object.assign(device, parseOperatingState(html));
        } catch (error) {
          device.estado = "desconocido";
        }
      }
      boundary.push(device);
    }

    const spentOut = !canSpend();
    const truncated = spentOut || unresolved.length > 0;
    let status = "delimitada";
    let reason = "zona delimitada con los aparatos hallados";
    if (zoneEdges.length === 0) {
      status = "no concluyente";
      // Running out of budget is not evidence that no span touches the poles.
      reason = spentOut
        ? `presupuesto agotado antes de medir tramos (${budget.used}/${settings.maxRequests} requests)`
        : resolved.length === 0
        ? "ningún código resolvió a un punto"
        : "ningún tramo toca los postes seleccionados";
    } else if (boundary.length === 0) {
      status = "parcial";
      reason = "sin aparato de maniobra adyacente: la zona no queda delimitada por maniobra";
    } else if (boundary.every((device) => device.estado === "desconocido")) {
      status = "parcial";
      reason = "aparatos hallados sin estado legible";
    }
    if (status !== "no concluyente" && truncated) {
      status = "parcial";
      reason = `${reason}; presupuesto agotado con ${unresolved.length} código(s) sin resolver`;
    }

    return {
      status,
      reason,
      selected,
      resolved,
      unresolved,
      ringed,
      zone: {
        codes: selected,
        edges: zoneEdges,
        voltages: [...new Set(zoneEdges.map((edge) => edge.voltage))],
      },
      boundary,
      budget: {
        requests: budget.used,
        maxRequests: settings.maxRequests,
        elapsedMs: Date.now() - started,
        maxMilliseconds: settings.maxMilliseconds,
      },
    };
  }

  /** Normalise an opening: a bare code, or `{ code, side }` with side a|b|both. */
  const normaliseOpening = (entry) => {
    if (typeof entry === "string") return { code: entry.trim().toUpperCase(), side: "desconocido" };
    const raw = safeText(entry && entry.code).trim().toUpperCase();
    const side = safeText(entry && entry.side).toLowerCase();
    return { code: raw, side: side === "a" || side === "b" || side === "both" ? side : "desconocido" };
  };

  /**
   * Verify a set of openings instead of proposing them.
   *
   * The operator decides which switches to open; this only answers whether that
   * decision isolates the work zone. It walks the MT graph from the work poles,
   * stops at every opening, and reports the island it closed. An island that
   * reaches a source is not de-energised, and neither is one the budget could not
   * finish exploring: `valid` is never true on incomplete evidence.
   */
  async function verifyAperturas(options) {
    const opts = options || {};
    const client = opts.client || {};
    const settings = Object.assign({}, DEFAULTS, opts.settings || {});
    const voltage = safeText(opts.voltage || "mt").toLowerCase();

    const work = (opts.workCodes || []).map((code) => safeText(code).trim().toUpperCase()).filter(Boolean);
    const openings = (opts.openCodes || []).map(normaliseOpening).filter((entry) => entry.code);
    const opened = openings.map((entry) => entry.code);
    const sideOf = new Map(openings.map((entry) => [entry.code, entry.side]));

    const started = Date.now();
    const used = { requests: 0 };
    const canSpend = () => used.requests < settings.maxRequests && Date.now() - started < settings.maxMilliseconds;
    const spend = async (fn) => {
      used.requests += 1;
      return fn();
    };

    const cut = new Set(opened);
    const island = new Set(work);
    const boundary = [];
    const sources = [];
    const sourceIds = new Set();
    const failed = [];
    const queue = [...work];
    const seenPoints = new Set();
    let partial = false;

    const resolvePoint = async (code) => {
      if (!canSpend()) return null;
      let rows = [];
      try {
        rows = (await spend(() => client.search(code))) || [];
      } catch (error) {
        rows = [];
      }
      const exact = (Array.isArray(rows) ? rows : []).filter((row) => codeOf(row && row.display) === code);
      for (const row of exact) {
        const ids = [Number(row.surrogate_in_map_id), Number(row.object_id)].filter(
          (id, index, all) => Number.isFinite(id) && all.indexOf(id) === index
        );
        for (const id of ids) {
          if (!canSpend()) return null;
          try {
            const payload = await spend(() => client.geojson([id]));
            const point = featureList(payload).map(pointOfFeature).find(Boolean);
            if (point) return point;
          } catch (error) {
            // try the next id
          }
        }
      }
      return null;
    };

    while (queue.length > 0) {
      const code = queue.shift();
      if (cut.has(code)) {
        // An opened pole is the island's boundary, never one of its members.
        if (boundary.indexOf(code) === -1) boundary.push(code);
        island.delete(code);
        continue;
      }
      if (!canSpend()) {
        // Dropping the pole silently would let an unfinished walk look complete.
        queue.unshift(code);
        break;
      }
      const point = await resolvePoint(code);
      if (!point) {
        failed.push(code);
        continue;
      }
      seenPoints.add(code);

      let found = false;
      let sampledAll = true;
      for (const radius of settings.radiiMeters) {
        for (let index = 0; index < settings.bearings; index += 1) {
          if (!canSpend()) {
            sampledAll = false;
            break;
          }
          const bearing = (2 * Math.PI * index) / settings.bearings;
          const sample = offsetOf(point.lon, point.lat, radius, bearing);
          let rows = [];
          try {
            rows = (await spend(() => client.pointObjects(sample.lon, sample.lat))) || [];
          } catch (error) {
            continue;
          }
          for (const row of Array.isArray(rows) ? rows : []) {
            const pair = codePairOf(row && row.display);
            if (pair && voltageOf(row) === voltage) {
              found = true;
              const other = pair[0] === code ? pair[1] : pair[1] === code ? pair[0] : null;
              if (other && !island.has(other) && boundary.indexOf(other) === -1) {
                if (cut.has(other)) {
                  boundary.push(other);
                } else {
                  island.add(other);
                  queue.push(other);
                }
              }
            } else if (!pair && row && row.id !== undefined && settings.readSources && !sourceIds.has(row.id)) {
              if (!canSpend()) continue;
              try {
                const title = safeText(await spend(() => client.objectTitle(row.id)));
                if (SOURCE_TITLE.test(title)) {
                  sourceIds.add(row.id);
                  sources.push({ code, objectId: Number(row.id), title });
                }
              } catch (error) {
                // an unreadable title is not a source, and not evidence of one
              }
            }
          }
        }
        if (!sampledAll) {
          partial = true;
          break;
        }
        if (found) break;
      }
    }

    const truncated = partial || (canSpend() === false && queue.length > 0);
    const incomplete = truncated || failed.length > 0 || island.size === 0;

    let valid = false;
    let reason;

    // A switching device cuts one side of its pole, not the pole itself. Opening
    // one side leaves the pole fed from the other: it becomes a live dead-end.
    // Only both sides isolate the pole, and work must never be reported as dead
    // on a pole whose live side was not established.
    const roles = new Map();
    for (const code of work) roles.set(code, "trabajo");
    for (const code of opened) roles.set(code, roles.get(code) === "trabajo" ? "ambos" : "apertura");

    const islandClosed = sources.length === 0 && !incomplete && boundary.length > 0;
    const poleStates = [...roles.entries()].map(([code, role]) => {
      if (role === "apertura" || role === "ambos") {
        const side = sideOf.get(code) || "desconocido";
        if (side === "both") {
          return { code, role, live: "no", reason: "ambos lados abiertos: el poste queda aislado" };
        }
        return {
          code,
          role,
          live: "desconocido",
          reason:
            side === "desconocido"
              ? "el aparato corta un solo lado y no se indicó cuál: el lado opuesto puede seguir energizado"
              : `se abre el lado ${side}: el lado opuesto puede seguir energizado`,
        };
      }
      return {
        code,
        role,
        live: islandClosed ? "no" : "desconocido",
        reason: islandClosed ? "dentro de la isla cerrada" : "la isla no cerró: no puede afirmarse que esté sin tensión",
      };
    });
    const liveWorkPoles = poleStates.filter((entry) => entry.role !== "apertura" && entry.live !== "no");

    if (work.some((code) => !cut.has(code)) && seenPoints.size === 0) {
      reason = "ningún poste de trabajo resolvió a un punto";
    } else if (sources.length > 0) {
      reason = `la zona sigue conectada a ${sources[0].title || "una fuente"} en ${sources[0].code}`;
    } else if (truncated) {
      reason = `presupuesto agotado con ${queue.length} poste(s) sin explorar: la apertura no puede confirmarse`;
    } else if (failed.length > 0) {
      reason = `${failed.length} poste(s) sin punto cartográfico: la apertura no puede confirmarse`;
    } else if (boundary.length === 0) {
      reason = "no se alcanzó ninguna de las aperturas indicadas: la zona no está delimitada por ellas";
    } else if (liveWorkPoles.length > 0) {
      reason = `poste(s) de trabajo sin tensión confirmada: ${liveWorkPoles
        .map((entry) => `${entry.code} (${entry.live === "desconocido" ? "estado desconocido" : "energizado"})`)
        .join(", ")}`;
    } else {
      valid = true;
      reason = `zona aislada: ${boundary.length} apertura(s) cierran la isla`;
    }

    return {
      valid: valid && !incomplete,
      reason,
      work,
      opened,
      openings,
      poleStates,
      voltage,
      island: [...island],
      boundary,
      sources,
      failed,
      unresolved: queue,
      budget: { requests: used.requests, maxRequests: settings.maxRequests, elapsedMs: Date.now() - started },
    };
  }

  return {
    version: "1.2.0",
    findWorkZone,
    verifyAperturas,
    parseOperatingState,
    codeOf,
    codePairOf,
    voltageOf,
  };
});
