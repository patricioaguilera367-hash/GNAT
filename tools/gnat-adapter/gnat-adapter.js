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

  return {
    version: "1.0.0",
    findWorkZone,
    parseOperatingState,
    codeOf,
    codePairOf,
    voltageOf,
  };
});
