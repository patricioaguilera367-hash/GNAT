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
    // GNAT's point query takes its capture radius from `units_per_pixel` and the
    // visible layers from `scale`, both per request. One calibrated query replaces
    // a ring of six; the second entry is only tried when the first finds nothing.
    // Capture radius escalates. A span is drawn between its two bornes, and in
    // rural sectors those sit metres away from the pole point: a radius tuned on
    // one feeder found two spans there and none on a neighbouring one.
    pointTuning: [
      { scale: 250, units_per_pixel: 0.85 },
      { scale: 250, units_per_pixel: 1.7 },
      { scale: 500, units_per_pixel: 4 },
      { scale: 1000, units_per_pixel: 9 },
    ],
    bearings: 6,
    maxRequests: 60,
    maxMilliseconds: 45000,
    maxDeviceLookups: 8,
    maxStateReads: 4,
    maxSourceHops: 6,
    // A code names several objects (poste, switch, estructura); the structure is the
    // one whose sheet lists cables, so a few candidates are tried before giving up.
    maxStructureTries: 3,
  };

  /** `F562541` or `5236366`, at the start of a display. */
  const CODE_AT_START = /^([A-Z]{0,3}\d{4,})\b/i;
  /** Only a pair of pole codes is an edge; `Trintre - Colonia Miraflores` is not. */
  const CODE_PAIR = /^([A-Z]{0,3}\d{4,})\s+-\s+([A-Z]{0,3}\d{4,})$/i;
  const DEVICE_TITLE = /\b(desconectador|seccional|reconectador|cuchilla|interruptor|fusible)\b/i;
  /** A pole title that can still feed a zone: energy comes from somewhere. */
  /**
   * What actually feeds MT: the feeder breaker, the head of the line, generation.
   *
   * A subestación de distribución (SSEE) is a transformer hung on a pole: MT feeds
   * it and it steps down to BT, so it never feeds the medium-voltage zone. Treating
   * one as a source blocked every zone that happened to contain it.
   */
  const SOURCE_TITLE = /\b(reconectador|alimentador|salida de l[ií]nea|generador|subestaci[oó]n\s+mt\/bt)\b/i;
  const TRANSFORMER_TITLE = /(ssee|transformador|subestaci[oó]n (a[eé]rea|de distribuci[oó]n|elevada|de superficie))/i;
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

  /**
   * One pole ring, sampled in parallel, with the narrow radius first.
   *
   * Returns the raw rows so each caller keeps its own classification, and
   * `complete: false` when the budget cut the ring short.
   */
  const memoOf = (settings) => (settings.memo instanceof Map ? settings.memo : null);

  const ringAt = async ({ client, settings, spend, canSpend, point, code }) => {
    // Rings are never memoised. The walk must see the network as it is now, and a
    // ring cached by an earlier pass can only poison it — the saving is one request.
    const rows = [];
    let complete = true;
    for (const tuning of settings.pointTuning) {
      if (!canSpend()) {
        complete = false;
        break;
      }
      let batch = [];
      try {
        batch = (await spend(() => client.pointObjects(point.lon, point.lat, tuning))) || [];
      } catch (error) {
        batch = [];
      }
      for (const row of Array.isArray(batch) ? batch : []) rows.push(row);
      if (rows.some((row) => codePairOf(row && row.display))) break;
    }
    return { rows, complete };
  };

  /** A spender shared across phases, so the wall clock is not restarted mid-run. */
  const makeSpender = (settings, existing) => {
    const state = existing || { requests: 0, startedAt: Date.now() };
    return {
      state,
      canSpend: () =>
        state.requests < settings.maxRequests && Date.now() - state.startedAt < settings.maxMilliseconds,
      spend: async (fn) => {
        state.requests += 1;
        if (settings.onProgress && state.requests % 20 === 0) {
          try {
            settings.onProgress({ requests: state.requests, elapsedMs: Date.now() - state.startedAt });
          } catch (error) {
            // progress output must never break a run
          }
        }
        return fn();
      },
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
      rows = Array.isArray(rows) ? rows : [];
      const exact = rows.filter((row) => codeOf(row && row.display) === code);
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
      const ring = await ringAt({ client, settings, spend, canSpend, point: entry.lonlat, code: entry.code });
      for (const row of ring.rows) {
        const key = safeText(row && row.id);
        if (!objects.has(key)) objects.set(key, { id: row.id, display: row.display, type: row.type });
      }
      found = ring.rows.some((row) => codePairOf(row && row.display));
      ringed.push({ code: entry.code, calibrated: found });
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

    const spender = makeSpender(settings, settings.budget);
    settings.budget = spender.state;
    const canSpend = spender.canSpend;
    const spend = spender.spend;
    const used = spender.state;
    const started = spender.state.startedAt;

    const cut = new Set(opened);
    const island = new Set(work);
    const boundary = [];
    const sources = [];
    const sourceIds = new Set();
    const failed = [];
    const queue = [...work];
    const seenPoints = new Set();
    let partial = false;

    /** Everything the ring finds around a pole, split into spans and other objects. */
    const ringObjects = async (point, code) => {
      const spans = [];
      const others = [];
      const ring = await ringAt({ client, settings, spend, canSpend, point, code });
      if (!ring.complete) partial = true;
      for (const row of ring.rows) {
        const pair = codePairOf(row && row.display);
        if (!pair) {
          if (row && row.id !== undefined && !others.some((entry) => entry.id === row.id)) {
            others.push({ id: row.id, display: row.display });
          }
          continue;
        }
        if (voltageOf(row) !== voltage) continue;
        const other = pair[0] === code ? pair[1] : pair[1] === code ? pair[0] : null;
        if (other && !spans.some((entry) => entry.other === other)) spans.push({ other, id: row.id });
      }
      return { spans, others };
    };

    /**
     * Does the line still feeding this pole come from here?
     *
     * Follows one direction until a source, a line end (remate) or the hop limit.
     * "si" feeds the pole, "no" is a dead end, "desconocido" is not evidence.
     */
    const walkToSource = async (fromCode, towards, hopsLimit) => {
      let previous = fromCode;
      let current = towards;
      for (let hop = 0; hop < hopsLimit; hop += 1) {
        if (!canSpend()) return "desconocido";
        if (cut.has(current)) return "no";
        const point = await resolvePoint(current);
        if (!point) return "desconocido";
        const here = await ringObjects(point, current);
        // A source sits at a pole as its own object, not on the span itself.
        if (settings.readSources) {
          for (const other of here.others) {
            if (!canSpend()) return "desconocido";
            try {
              const title = safeText(await spend(() => client.objectTitle(other.id)));
              if (TRANSFORMER_TITLE.test(title)) continue;
              if (SOURCE_TITLE.test(title)) return "si";
            } catch (error) {
              // an unreadable title is not a source
            }
          }
        }
        const forward = here.spans.find((entry) => entry.other !== previous) || null;
        if (!forward) return "no";
        previous = current;
        current = forward.other;
      }
      return "desconocido";
    };

    /**
     * Which side of an opening pole is still fed.
     *
     * Radial: opening the source side kills the pole, opening the far side leaves
     * it as a live dead-end. Looped: a second source keeps it alive either way.
     */
    const stateOfOpening = async (entry) => {
      const point = await resolvePoint(entry.code);
      if (!point) {
        return { code: entry.code, side: entry.side, sides: [], live: "desconocido", reason: "el poste no resolvió a un punto" };
      }
      const spans = (await ringObjects(point, entry.code)).spans;
      if (spans.length === 0) {
        return { code: entry.code, side: entry.side, sides: [], live: "desconocido", reason: "no se hallaron tramos MT en ese poste" };
      }
      const sides = [];
      for (const span of spans) {
        sides.push({ towards: span.other, reachesSource: await walkToSource(entry.code, span.other, settings.maxSourceHops) });
      }
      const reaching = sides.filter((side) => side.reachesSource === "si").length;
      const dead = sides.every((side) => side.reachesSource === "no");
      const unknown = sides.some((side) => side.reachesSource === "desconocido");

      if (entry.side === "both") {
        return { code: entry.code, side: entry.side, sides, live: "no", reason: "ambos lados abiertos: el poste queda aislado" };
      }
      if (dead) {
        return { code: entry.code, side: entry.side, sides, live: "no", reason: "ningún lado alcanza una fuente: el poste queda sin tensión" };
      }
      if (reaching >= 2) {
        return { code: entry.code, side: entry.side, sides, live: "si", reason: "el otro lado sigue alimentado: red anillada" };
      }
      if (unknown) {
        return { code: entry.code, side: entry.side, sides, live: "desconocido", reason: "no se pudo completar la traza hacia el fuente" };
      }
      if (entry.side === "a") {
        return { code: entry.code, side: entry.side, sides, live: "no", reason: "se abre el lado que alimenta: el poste y todo aguas abajo quedan sin tensión" };
      }
      if (entry.side === "b") {
        return { code: entry.code, side: entry.side, sides, live: "si", reason: "se abre el lado de aguas abajo: el poste queda como remate energizado" };
      }
      return { code: entry.code, side: entry.side, sides, live: "si", reason: "un lado sigue alcanzando una fuente y no se indicó cuál se abre" };
    };

    const searchRows = new Map();
    const resolvePoint = async (code) => {
      const memo = memoOf(settings);
      const key = `point:${code}`;
      if (memo && memo.has(key)) {
        const cached = memo.get(key);
        seenPoints.add(code);
        return cached;
      }
      if (!canSpend()) return null;
      let rows = [];
      try {
        rows = (await spend(() => client.search(code))) || [];
      } catch (error) {
        rows = [];
      }
      rows = Array.isArray(rows) ? rows : [];
      searchRows.set(code, rows);
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
            if (point) {
              if (memo) memo.set(key, point);
              return point;
            }
          } catch (error) {
            // try the next id
          }
        }
      }
      return null;
    };

    const diagnostics = [];
    const nodeCache = new Map();

    /**
     * Neighbours of a pole, straight from the structure sheet.
     *
     * `textual_search` returns every object carrying the code — poste, switch,
     * estructura — so the structure has to be found among them: it is the one whose
     * sheet answers with `A - B` cable pairs.
     */
    const metadataNeighbours = async (code) => {
      if (!settings.metadata) return null;
      if (nodeCache.has(code)) return nodeCache.get(code);
      let result = null;
      let rows = [];
      try {
        rows = (await spend(() => client.search(code))) || [];
      } catch (error) {
        rows = [];
      }
      const candidates = (Array.isArray(rows) ? rows : [])
        .filter((row) => row && row.object_id !== undefined)
        .slice(0, Math.max(1, settings.maxStructureTries || 3));
      for (const row of candidates) {
        if (!canSpend()) break;
        let html = "";
        try {
          html = safeText(await spend(() => client.sectionHtml(row.object_id, settings.sectionId)));
        } catch (error) {
          continue;
        }
        const text = stripTags(html);
        const pairs = codePairsIn(text);
        if (pairs.length === 0) continue;
        const neighbours = [];
        for (const pair of pairs) {
          const other = pair[0] === code ? pair[1] : pair[1] === code ? pair[0] : null;
          if (other && other !== code && neighbours.indexOf(other) === -1) neighbours.push(other);
        }
        if (neighbours.length === 0) continue;
        result = {
          pairs,
          neighbours,
          tensionKv: tensionOfSection(text),
          state: parseOperatingState(html),
          display: safeText(row.display),
        };
        break;
      }
      nodeCache.set(code, result);
      return result;
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
      let tramos = 0;
      let fuente = "anillo";
      let meta = null;
      // The textual search matches by prefix, so asking for a pole also returns the
      // cables whose name starts with it: the spans leaving that pole, already paid
      // for by the coordinate lookup and until now thrown away.
      const neighbours = [];
      for (const row of searchRows.get(code) || []) {
        const pair = codePairOf(row && row.display);
        if (!pair) continue;
        const other = pair[0] === code ? pair[1] : pair[1] === code ? pair[0] : null;
        if (other && other !== code && neighbours.indexOf(other) === -1) neighbours.push(other);
      }
      if (neighbours.length > 0) {
        fuente = "busqueda";
      } else {
        meta = await metadataNeighbours(code);
        if (meta) for (const other of meta.neighbours) if (neighbours.indexOf(other) === -1) neighbours.push(other);
        if (neighbours.length > 0) fuente = "metadata";
      }
      if (neighbours.length > 0) {
        for (const other of neighbours) {
          tramos += 1;
          if (cut.has(other)) {
            if (boundary.indexOf(other) === -1) boundary.push(other);
          } else if (!island.has(other) && boundary.indexOf(other) === -1) {
            island.add(other);
            queue.push(other);
          }
        }
      }
      const ring = neighbours.length > 0
        ? { rows: [], complete: true }
        : await ringAt({ client, settings, spend, canSpend, point, code });
      if (!ring.complete) partial = true;
      for (const row of ring.rows) {
        const pair = codePairOf(row && row.display);
        // A permit is medium voltage unless it says otherwise: an undefined
        // voltage here would silently compare against nothing and never expand.
        if (pair && voltageOf(row) === (voltage || "mt")) {
          tramos += 1;
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
            if (TRANSFORMER_TITLE.test(title)) continue;
            if (SOURCE_TITLE.test(title)) {
              sourceIds.add(row.id);
              sources.push({ code, objectId: Number(row.id), title });
            }
          } catch (error) {
            // an unreadable title is not a source, and not evidence of one
          }
        }
      }
      diagnostics.push({
        code,
        fuente,
        objetos: ring.rows.length,
        tramos,
        completo: ring.complete,
        // A pole with no traversable span is the one worth showing: without what
        // the server actually returned, "0 tramos" is a mystery instead of a fact.
        muestras: tramos === 0
          ? ring.rows.slice(0, 6).map((row) => ({
              display: safeText(row && row.display),
              tipo: safeText(row && row.type),
              voltaje: voltageOf(row),
            }))
          : [],
      });
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
    const poleStates = [];
    for (const [code, role] of roles.entries()) {
      if (role === "apertura" || role === "ambos") {
        const entry = openings.find((item) => item.code === code) || { code, side: "desconocido" };
        const state = await stateOfOpening(entry);
        poleStates.push(Object.assign({ role }, state));
      } else {
        poleStates.push({
          code,
          role,
          live: islandClosed ? "no" : "desconocido",
          reason: islandClosed ? "dentro de la isla cerrada" : "la isla no cerró: no puede afirmarse que esté sin tensión",
        });
      }
    }
    const liveWorkPoles = poleStates.filter((entry) => entry.role !== "apertura" && entry.live !== "no");
    // A live boundary pole is normal — it is the dead-end that feeds nothing — but
    // the crew must know it stays energised.
    const warnings = poleStates
      .filter((entry) => entry.live === "si")
      .map((entry) => `${entry.code} queda con tensión (${entry.reason})`);

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
      warnings,
      voltage,
      island: [...island],
      boundary,
      diagnostics,
      sources,
      failed,
      unresolved: queue,
      budget: { requests: used.requests, maxRequests: settings.maxRequests, elapsedMs: Date.now() - started },
    };
  }

  /** Convex hull, so the zone has an outline and not just a list of poles. */
  const convexHull = (points) => {
    const pts = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
    if (pts.length < 3) return pts.map((p) => [p.lon, p.lat]);
    const cross = (o, a, b) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1)).map((p) => [p.lon, p.lat]);
  };

  /**
   * Rebuild a hand-written permit from the network and compare the two.
   *
   * The supervisor already decided the work zone and the openings. This resolves
   * every declared code, rebuilds the spans, devices, outline and labels around
   * it, runs the verification, and reports where the permit and the network
   * disagree.
   */
  async function auditPermit(options) {
    const opts = options || {};
    const client = opts.client || {};
    const permit = opts.permit || {};
    const settings = Object.assign({}, DEFAULTS, opts.settings || {});
    const voltage = safeText(opts.voltage || "mt").toLowerCase();

    const spender = makeSpender(settings, settings.budget);
    settings.budget = spender.state;
    // One memo for the whole run: the audit and its verification must never ask
    // GNAT twice for the same pole.
    if (!(settings.memo instanceof Map)) settings.memo = new Map();
    const memo = settings.memo;
    const canSpend = spender.canSpend;
    const spend = spender.spend;
    const used = spender.state;
    const started = spender.state.startedAt;

    const declared = [];
    // One code can hold several roles at once: the same pole is often both the
    // work zone and the switch that isolates it.
    const declare = (codes, role) => {
      for (const raw of codes || []) {
        const code = safeText(typeof raw === "string" ? raw : raw && raw.code).trim().toUpperCase();
        if (!code) continue;
        const existing = declared.find((entry) => entry.code === code);
        if (existing) {
          if (!existing.roles.includes(role)) existing.roles.push(role);
          continue;
        }
        declared.push({ code, role, roles: [role] });
      }
    };
    declare([permit.objectCode], "objeto");
    declare(permit.workCodes, "trabajo");
    declare(permit.openCodes, "apertura");
    declare(permit.groundCodes, "puesta a tierra");
    declare(permit.siteCodes, "punto de faenas");

    const resolve = async (code) => {
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
            if (point) {
              memo.set(`point:${code}`, point);
              return { point, objectId: Number(row.object_id), display: row.display, matches: exact.length };
            }
          } catch (error) {
            // try the next id
          }
        }
      }
      return exact.length > 0 ? { point: null, objectId: Number(exact[0].object_id), display: exact[0].display, matches: exact.length } : null;
    };

    const ring = async (point, code) => {
      const spans = [];
      const others = [];
      const found = await ringAt({ client, settings, spend, canSpend, point, code });
      for (const row of found.rows) {
        const pair = codePairOf(row && row.display);
        if (!pair) {
          if (row && row.id !== undefined && !others.some((entry) => entry.id === row.id)) {
            others.push({ id: row.id, display: row.display, type: row.type });
          }
          continue;
        }
        if (voltageOf(row) !== voltage) continue;
        const display = safeText(row.display);
        if (!spans.some((entry) => entry.display === display)) {
          spans.push({ id: row.id, from: pair[0], to: pair[1], display, voltage: voltageOf(row), type: row.type });
        }
      }
      return { spans, others, complete: found.complete };
    };

    const points = [];
    const missing = [];
    for (const entry of declared) {
      const found = await resolve(entry.code);
      if (!found || !found.point) {
        missing.push({ code: entry.code, role: entry.role, reason: found ? "sin punto cartográfico" : "no resuelve" });
        continue;
      }
      points.push({ code: entry.code, role: entry.role, lonlat: found.point, objectId: found.objectId, label: found.display, matches: found.matches });
    }

    const isZone = (entry) => entry.role === "trabajo" || entry.role === "punto de faenas" || entry.role === "objeto";
    const zoneSpans = [];
    const zoneDevices = [];
    let ringsComplete = true;
    for (const entry of points.filter(isZone)) {
      const found = await ring(entry.lonlat, entry.code);
      if (!found.complete) ringsComplete = false;
      for (const span of found.spans) {
        if (!zoneSpans.some((existing) => existing.display === span.display)) zoneSpans.push(span);
      }
      for (const other of found.others) {
        if (!zoneDevices.some((existing) => existing.id === other.id)) zoneDevices.push(other);
      }
    }

    const labels = [];
    for (const device of zoneDevices.slice(0, settings.maxDeviceLookups)) {
      if (!canSpend()) break;
      try {
        const title = safeText(await spend(() => client.objectTitle(device.id)));
        labels.push({ objectId: device.id, code: codeOf(device.display), title, isDevice: DEVICE_TITLE.test(title) });
      } catch (error) {
        labels.push({ objectId: device.id, code: codeOf(device.display), title: null, isDevice: false });
      }
    }

    const verification = await verifyAperturas({
      client,
      workCodes: (permit.workCodes || []).length > 0 ? permit.workCodes : derivedZoneCodes(points),
      openCodes: permit.openCodes || [],
      voltage,
      settings,
    });

    const findings = [];
    for (const entry of missing) findings.push({ level: "bloqueante", text: `${entry.code} (${entry.role}) no resuelve: ${entry.reason}` });
    if (!ringsComplete) findings.push({ level: "advertencia", text: "el presupuesto cortó algún anillo: la red alrededor de la zona está incompleta" });
    if (points.filter((entry) => entry.matches > 1).length > 0) {
      for (const entry of points.filter((item) => item.matches > 1)) {
        findings.push({ level: "info", text: `${entry.code} nombra ${entry.matches} objetos: se usó el primero con punto` });
      }
    }
    const undeclared = labels.filter((label) => label.isDevice && !declared.some((entry) => entry.code === label.code));
    for (const label of undeclared) {
      findings.push({ level: "advertencia", text: `${label.code || label.objectId} es ${label.title} dentro de la zona y no figura como apertura` });
    }
    const zoneCodes = new Set(points.filter(isZone).map((entry) => entry.code));
    const islandSet = new Set(verification.island || []);
    for (const entry of declared.filter((item) => item.roles.includes("puesta a tierra"))) {
      if (islandSet.size > 0 && !islandSet.has(entry.code)) {
        findings.push({
          level: "advertencia",
          text: `${entry.code} se declara puesta a tierra pero no queda dentro de la isla sin tensión`,
        });
      }
    }
    const orphanSpans = zoneSpans.filter((span) => !zoneCodes.has(span.from) && !zoneCodes.has(span.to));
    for (const span of orphanSpans) {
      findings.push({ level: "info", text: `tramo ${span.display} no toca ningún código declarado` });
    }
    if (!verification.valid) findings.push({ level: "bloqueante", text: `verificación: ${verification.reason}` });
    const voltages = [...new Set(zoneSpans.map((span) => span.voltage))];

    return {
      status: missing.length > 0 || !verification.valid || !ringsComplete ? "inconsistente" : "consistente",
      voltage,
      declared,
      points,
      missing,
      network: { spans: zoneSpans, devices: zoneDevices },
      outline: convexHull(points.filter(isZone).map((entry) => entry.lonlat)),
      labels,
      verification,
      findings,
      voltages,
      budget: { requests: used.requests, maxRequests: settings.maxRequests, elapsedMs: Date.now() - started },
    };
  }

  const derivedZoneCodes = (points) =>
    points.filter((entry) => entry.role === "objeto" || entry.role === "punto de faenas").map((entry) => entry.code);

  /**
   * Turn a permit preset into a CentralityLocal v5 payload.
   *
   * The preset is the supervisor's form: codes and roles, no coordinates, because
   * coordinates only exist inside GNAT. They are resolved here, once, and the
   * result is exactly the project V10 already knows how to load and draw.
   */
  const buildProjectFromPreset = async ({ preset, client, settings = {} }) => {
    if (!preset || typeof preset !== "object") throw new Error("preset requerido");
    const roles = Array.isArray(preset.roles) ? preset.roles : [];
    const resolved = { maxRequests: 200, maxMilliseconds: 120000, ...settings };
    const spender = makeSpender(resolved, resolved.budget);
    resolved.budget = spender.state;
    const canSpend = spender.canSpend;
    const spend = spender.spend;
    const started = Date.now();

    const resolve = async (code) => {
      if (!canSpend()) return null;
      const raw = await spend(() => client.search(code));
      const rows = Array.isArray(raw) ? raw : Array.isArray(raw && raw.rows) ? raw.rows : [];
      const exact = rows.filter((row) => safeText(codeOf(row && row.display)).toUpperCase() === String(code).toUpperCase());
      const chosen = (exact.length ? exact : rows)[0];
      if (!chosen || chosen.surrogate_in_map_id === undefined || !canSpend()) return null;
      const payload = await spend(() => client.geojson([Number(chosen.surrogate_in_map_id)]));
      const point = featureList(payload).map(pointOfFeature).find(Boolean);
      if (!point) return null;
      return { point, objectId: Number(chosen.object_id), display: safeText(chosen.display) };
    };

    const memo = new Map();
    const registros = [];
    const unresolved = [];
    const bloques = Array.isArray(preset.bloques) && preset.bloques.length
      ? preset.bloques.map((block) => ({ id: String(block.id), nombre: safeText(block.nombre), color: safeText(block.color) }))
      : [
          { id: "D", nombre: "Desconectada", color: "#d92b2b" },
          { id: "T", nombre: "Trabajo", color: "#1f9d55" },
          { id: "F", nombre: "Frontera", color: "#e0a100" },
        ];
    const known = new Set(bloques.map((block) => block.id));

    let numero = 0;
    for (const role of roles) {
      const codigo = safeText(role && role.codigo).trim();
      if (!codigo) continue;
      if (!memo.has(codigo)) memo.set(codigo, await resolve(codigo));
      const hit = memo.get(codigo);
      if (!hit) {
        // A code that does not resolve is never dropped silently: the preset is
        // the document a supervisor signs, so a missing pole must be visible.
        if (!unresolved.some((item) => item.codigo === codigo)) {
          unresolved.push({ codigo, rol: safeText(role.rol), motivo: canSpend() ? "el código no resolvió a un punto" : "presupuesto agotado" });
        }
        continue;
      }
      // An empty block is deliberate: an opening is a fence, not an area, and
      // V10 draws a hull per block. Two openings 500 m apart would draw a sliver.
      const bloque = known.has(safeText(role.bloque)) ? safeText(role.bloque) : "";
      numero += 1;
      registros.push({
        id: `${safeText(role.rol) || "P"}-${codigo}`,
        numero,
        tipo: safeText(role.tipo) === "apertura" ? "APERTURA" : "PUNTO",
        codigo,
        longitud: hit.point.lon,
        latitud: hit.point.lat,
        supervisorColor: "Sin asignar",
        supervisorId: "default",
        bloqueId: bloque,
        bloques: [bloque],
        aperturasIds: safeText(role.tipo) === "apertura" ? [codigo] : [],
        // A ground point carries its role visibly, so the verification can find it
        // again from the map without re-reading the preset.
        tipoEquipo: safeText(role.equipo) || (safeText(role.tipo) === "tierra" ? "Puesta a tierra" : ""),
        colorPersonalizado: "",
        rol: safeText(role.rol),
        gnat: { objectId: hit.objectId, display: hit.display },
      });
    }

    return {
      version: 5,
      formato: "CentralityLocal",
      id: "preset-" + safeText(preset.preset || "permiso"),
      nombre: safeText(preset.nombre) || safeText(preset.preset) || "Preset de permiso",
      updatedAt: Date.now(),
      multiSupervisorEnabled: false,
      supervisors: [],
      bloques,
      registros,
      preset: { id: safeText(preset.preset), version: Number(preset.presetVersion) || 1, circuito: preset.circuito || null },
      unresolved,
      budget: { ...spender.state, elapsedMs: Date.now() - started },
    };
  };

  /**
   * A cable is named after the two structures it joins: `F723227 - F97181`.
   * That pair IS the edge, and a structure sheet lists it under Vecinos, so the
   * graph comes from metadata: no radial probe, no guessing the voltage.
   */
  const CODE_PAIR_IN_TEXT = /\b([A-Z]{0,3}\d{4,})\s*[-–]\s*([A-Z]{0,3}\d{4,})\b/g;
  const codePairsIn = (text) => {
    const out = [];
    const seen = new Set();
    CODE_PAIR_IN_TEXT.lastIndex = 0;
    let match = CODE_PAIR_IN_TEXT.exec(text);
    while (match) {
      const key = match[1] + "|" + match[2];
      const reverse = match[2] + "|" + match[1];
      if (!seen.has(key) && !seen.has(reverse)) {
        seen.add(key);
        out.push([match[1], match[2]]);
      }
      match = CODE_PAIR_IN_TEXT.exec(text);
    }
    return out;
  };

  const tensionOfSection = (text) => {
    const hit = /Tensi[oó]n del circuito:\s*([\d.,]+)\s*kV/i.exec(text);
    if (!hit) return null;
    const value = Number(hit[1].replace(",", "."));
    return Number.isFinite(value) ? value : null;
  };

  return {
    version: "1.11.0",
    buildProjectFromPreset,
    auditPermit,
    convexHull,
    findWorkZone,
    verifyAperturas,
    parseOperatingState,
    codeOf,
    codePairOf,
    codePairsIn,
    tensionOfSection,
    voltageOf,
  };
});
