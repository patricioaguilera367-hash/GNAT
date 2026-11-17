/**
 * GNAT V10 — read-only contract probe: MT spans and switching devices.
 *
 * Purpose: close the two unknowns that currently block the Zona Desconectada
 * engine, before writing any engine code:
 *
 *   U1. Does `get_objects_info_for_point` on a MEDIUM VOLTAGE pole return
 *       `Tramo Aereo MT` objects with the same `"<POLO_A> - <POLO_B>"` display
 *       format observed for AP/BT, and does `get_objects_geojson` return a
 *       LineString for those span ids?
 *
 *   U2. Which objects represent switching devices (`DBC`, `DF`,
 *       `Desconectador Fusible`, `Reconectador`, `Pole Top`), and is there ANY
 *       endpoint that exposes their open/closed state?
 *
 * This script is strictly READ-ONLY against GNAT:
 *   - it calls only the read endpoints plus the two section readers, and never
 *     a write/action endpoint;
 *   - it never inserts remote HTML into the DOM and never executes remote JS:
 *     every response is handled as inert text;
 *   - it never aborts requests it does not own;
 *   - the only mutation is the map view (center + zoom), restored afterwards.
 *
 * Usage (browser console of the GNAT tab, top frame):
 *
 *   await __gnatProbe.run()                      // DEFAULT_CODES
 *   await __gnatProbe.run(["F51757"])            // explicit codes
 *   await __gnatProbe.run([9446883])             // probe objects by numeric id
 *   __gnatProbe.copy()                           // report to clipboard
 *   __gnatProbe.json()                           // report as string
 *
 * Paste the clipboard content back to the assistant. Nothing is written to
 * GNAT, to the map data, or to disk.
 */
(() => {
  "use strict";

  const VERSION = "1.5.0";

  /** Poles to probe when `run()` is called without arguments. */
  const DEFAULT_CODES = ["F51757"];

  /** `get_objects_info_for_point` resolves against the live view scale. */
  const PROBE_ZOOM = 18;
  const REQUEST_TIMEOUT_MS = 20000;
  const MAX_IDS_PER_GEOJSON_CALL = 40;
  const MAX_POLE_TARGETS = 5;
  const MAX_SEARCH_DEVICES = 4;

  const URL_WMC = "svc_wmc.php";
  const URL_OBJECT_VIEW = "Web/component/svc_object_view.php";
  const URL_CM_SECTION = "cm_object_data_section.php";
  const URL_ELEC_SECTION = "elec_addons_cm_object_data_section.php";

  const DMS_SECTION_NETWORKING_ELECTRICAL = 23;

  /** Case-insensitive substrings that mark a switching/manoeuvre device. */
  const DEVICE_HINTS = [
    "dbc",
    "df",
    "dc",
    "desconectador",
    "reconectador",
    "reconnect",
    "seccionador",
    "fusible",
    "pole top",
    "interruptor",
    "apertura",
    "cuchilla",
    "eq.proteccion",
    "eq. protección",
    "eq.protección",
  ];

  /** Case-insensitive substrings that mark a span/cable object. */
  const SPAN_HINTS = ["tramo", "cable", "linea", "línea"];

  /** Case-insensitive substrings that mark a state field in inert text. */
  const STATE_HINTS = [
    "abierto",
    "cerrado",
    "real",
    "normal",
    "estado",
    "maniobra",
    "operaci",
    "fase",
  ];

  const report = {
    probeVersion: VERSION,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    viewport: null,
    inputs: [],
    cases: [],
    warnings: [],
    errors: [],
  };

  // ---------------------------------------------------------------- utilities

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isObjectLike = (value) => value !== null && typeof value === "object";

  const safeString = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return String(value);
    } catch (_) {
      return "";
    }
  };

  const truncate = (text, max = 4000) => {
    const value = safeString(text);
    return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
  };

  /**
   * GNAT ids are integers. Sending them as strings makes the backend reject the
   * whole request with "JSON value is not numeric", so every id is normalised
   * here and an unusable value is reported instead of silently coerced.
   */
  const toNumericId = (value) => {
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
    const text = safeString(value).trim();
    if (!/^-?\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };

  /**
   * Convert remote HTML to inert, readable text without touching the DOM.
   * Remote markup is untrusted: never assign it to innerHTML and never run it.
   */
  const htmlToText = (html) => {
    let text = safeString(html);
    text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
    text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<\/(tr|p|div|li|h[1-6])>/gi, "\n");
    text = text.replace(/<\/(td|th)>/gi, " | ");
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<[^>]+>/g, " ");
    text = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    return text
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  };

  /** Collect every line that mentions a state hint. */
  const extractStateLines = (text, maxLines = 60) => {
    const lines = safeString(text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        const low = line.toLowerCase();
        return STATE_HINTS.some((hint) => low.includes(hint));
      });
    return {
      total: lines.length,
      lines: lines.slice(0, maxLines),
      truncated: lines.length > maxLines,
    };
  };

  const preview = (value, max = 1200) => {
    if (typeof value === "string") return truncate(value, max);
    try {
      return truncate(JSON.stringify(value, null, 1), max);
    } catch (_) {
      return safeString(value);
    }
  };

  /** Pull the HTML payload out of an `Acs` JSON-decode failure message. */
  const extractHtmlFromMessage = (message) => {
    const text = safeString(message);
    const index = text.indexOf("<");
    if (index < 0) return null;
    const payload = text.slice(index).trim();
    return payload.startsWith("<") ? payload : null;
  };

  /** Split a chunk of HTML into `<tr>` rows of tagged cells (id + inert text). */
  const extractTableRows = (html, maxRows = 40) => {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(safeString(html))) && rows.length < maxRows) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) && cells.length < 8) {
        const raw = cellMatch[1];
        const idMatch = raw.match(/cm_object_data\.php\?id=(\d+)/i);
        cells.push({
          texto: htmlToText(raw).replace(/\s+/g, " ").trim(),
          id: idMatch ? toNumericId(idMatch[1]) : null,
        });
      }
      const hasText = cells.some((cell) => cell.texto.length > 0);
      if (cells.length > 0 && hasText) rows.push(cells);
    }
    return rows;
  };

  /**
   * `Comportamiento de red por fase` renders two blocks: `Real` (the operating
   * state, with the timestamp it started) and `Normal` (the design state).
   */
  const parsePhases = (text) => {
    const phases = { real: null, normal: null };
    let current = null;
    for (const rawLine of safeString(text).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const head = line.match(/^(real|normal)(?:\b|\s|$)/i);
      if (head) {
        current = head[1].toLowerCase();
        // "Jerarquia de red" repeats the same Real/Normal headings further down.
        // Never reset a block that already carries phase values.
        if (!phases[current]) phases[current] = { R: null, S: null, T: null };
        const since = line.match(/\(([^)]*desde[^)]*)\)/i);
        if (since) phases[current].desde = since[1].trim();
        continue;
      }
      const phase = line.match(/^([RST])\s*:\s*(.+)$/);
      if (phase && current && phases[current]) phases[current][phase[1]] = phase[2].trim();
    }
    // A heading with no phase values behind it is not a readable state.
    for (const key of ["real", "normal"]) {
      const block = phases[key];
      if (block && !["R", "S", "T"].some((name) => block[name])) phases[key] = null;
    }
    return phases;
  };

  /**
   * Parse DMS section 23 (`networking_electrical`).
   *
   * The endpoint answers HTML, never JSON, so it is read as inert text: only its
   * literal values are extracted and nothing from it is executed.
   */
  const parseElectricalSection = (html) => {
    const raw = safeString(html);
    const text = htmlToText(raw);
    const parsed = {
      hasContent: text.length > 0,
      text: truncate(text, 4000),
      estadoOperativo: null,
      tensionCircuito: null,
      circuito: null,
      phases: { real: null, normal: null },
      vecinos: [],
      neighborIds: [],
      links: [],
      netModels: [],
    };

    const estado = raw.match(/Estado operativo:\s*([^<]+)/i);
    if (estado) parsed.estadoOperativo = estado[1].replace(/\s+/g, " ").trim();

    const tension = raw.match(/Tensi[oó]n del circuito:\s*(?:<b>)?\s*([\d.,]+\s*kV)/i);
    if (tension) parsed.tensionCircuito = tension[1].trim();

    const circuito = raw.match(/<h1>Circuito<\/h1>[\s\S]{0,800}?cm_object_data\.php\?id=(\d+)"[^>]*>([^<]+)</i);
    if (circuito) parsed.circuito = { id: toNumericId(circuito[1]), nombre: circuito[2].trim() };

    parsed.phases = parsePhases(text);

    const vecinos = raw.match(/<h1>Vecinos<\/h1>([\s\S]*?)<\/table>/i);
    if (vecinos) {
      parsed.vecinos = extractTableRows(vecinos[1])
        .filter((cells) => cells.length >= 2 && cells[0].id !== null)
        .slice(0, 10)
        .map((cells) => ({
          id: cells[0].id,
          etiqueta: cells[0].texto,
          tipo: cells[1] ? cells[1].texto : null,
          idNegocio: cells[2] ? cells[2].texto : null,
        }));
    }

    const highlight = raw.match(/gis_highlight_objects\(\[([\d,\s]+)\]/);
    if (highlight) {
      parsed.neighborIds = highlight[1]
        .split(",")
        .map((value) => toNumericId(value.trim()))
        .filter((value) => value !== null);
    }

    const linkRe = /href=['"]([^'"]*(?:cm_object_data|dms_operations|elec_addons_cm_object_data_section)\.php[^'"]*)['"]/gi;
    let linkMatch;
    while ((linkMatch = linkRe.exec(raw)) && parsed.links.length < 20) {
      if (!parsed.links.includes(linkMatch[1])) parsed.links.push(linkMatch[1]);
    }

    // `net_model_id` 2 is the Normal model and 3 the Real one, as the section's
    // own inline scripts render it. Read as data; nothing of it is executed.
    const modelIds = [];
    const modelRe = /net_model_id:\s*(\d+)/g;
    let modelMatch;
    while ((modelMatch = modelRe.exec(raw)) && modelIds.length < 6) {
      const value = toNumericId(modelMatch[1]);
      if (value !== null && !modelIds.includes(value)) modelIds.push(value);
    }
    parsed.netModels = modelIds.map((value) => ({
      id: value,
      nombre: value === 3 ? "Real" : value === 2 ? "Normal" : null,
    }));

    return parsed;
  };

  /** Classify an object by its reported `type` / `display`. */
  const classify = (item) => {
    const type = safeString(item && item.type).toLowerCase();
    const display = safeString(item && item.display).toLowerCase();
    const blob = `${type} ${display}`;
    const isDevice = DEVICE_HINTS.some((hint) => blob.includes(hint));
    const isSpan = SPAN_HINTS.some((hint) => blob.includes(hint));
    const isNode = blob.includes("nodo");
    const isSubstation = blob.includes("subestacion") || blob.includes("subestación");
    const isPole = blob.includes("poste") && !isDevice;
    return { isDevice, isSpan, isNode, isSubstation, isPole };
  };

  /**
   * Split a span display name into its endpoint codes.
   * Observed shape for AP/BT: "F562830 - F562831". The separator is not proven
   * for MT, so every plausible variant is reported instead of assumed.
   */
  const parseSpanDisplay = (display) => {
    const raw = safeString(display).trim();
    const variants = {};
    const hyphen = raw.split(/\s+-\s+/);
    if (hyphen.length === 2) variants["space-hyphen-space"] = hyphen.map((s) => s.trim());
    const anyDash = raw.split(/\s*[-]\s*/).filter(Boolean);
    if (anyDash.length === 2) variants["any-dash"] = anyDash.map((s) => s.trim());
    const enDash = raw.split(/\s*[–—]\s*/).filter(Boolean);
    if (enDash.length === 2) variants["en-dash"] = enDash.map((s) => s.trim());
    const slash = raw.split(/\s*\/\s*/).filter(Boolean);
    if (slash.length === 2) variants["slash"] = slash.map((s) => s.trim());
    return {
      display: raw,
      variants,
      parsesCleanly: Object.keys(variants).length > 0,
    };
  };

  /** Normalise the several shapes a GeoJSON payload can arrive in. */
  const featuresOf = (geo) => {
    if (!geo) return [];
    if (geo.type === "FeatureCollection") return Array.isArray(geo.features) ? geo.features : [];
    if (geo.type === "Feature") return [geo];
    if (Array.isArray(geo)) return geo.filter((item) => item && item.type === "Feature");
    if (geo.geometry) return [geo];
    return [];
  };

  // -------------------------------------------------------------- environment

  function resolveEnv() {
    const w = document.querySelector("iframe#content")?.contentWindow || window;
    if (!w.webMap_ || !w.webMap_.map) {
      throw new Error(
        "GNAT map not found. Open the Centrality map and run this script in the console of the frame that owns `iframe#content`."
      );
    }
    if (!w.Acs || typeof w.Acs.request !== "function") {
      throw new Error("`webMap_` exists but `Acs.request` is unavailable; this is not the GNAT main frame.");
    }
    if (!w.Ext || typeof w.Ext.apply !== "function" || typeof w.Ext.encode !== "function") {
      throw new Error("`Ext.apply` / `Ext.encode` unavailable; this is not the GNAT main frame.");
    }
    return w;
  }

  /**
   * Build a timeout-bounded request function bound to the GNAT window.
   * Never aborts foreign requests: only this promise stops waiting.
   */
  function makeRequester(w) {
    return function request(url, params, label) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = w.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms (${label})`));
        }, REQUEST_TIMEOUT_MS);

        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          w.clearTimeout(timer);
          fn(value);
        };

        try {
          w.Acs.request({
            url,
            params,
            success: (response) => finish(resolve, response),
            failure: (error) => finish(reject, error || new Error(`request failed (${label})`)),
          });
        } catch (error) {
          finish(reject, error);
        }
      });
    };
  }

  /** Wrap each probe step so one failure never aborts the whole report. */
  async function step(name, fn) {
    try {
      return { ok: true, name, value: await fn() };
    } catch (error) {
      const message = safeString(error && error.message) || preview(error);
      report.errors.push({ step: name, message });
      return { ok: false, name, error: message };
    }
  }

  // ------------------------------------------------------------------ services

  function buildApi(w) {
    const request = makeRequester(w);
    const wm = w.webMap_;

    const withViewport = (base) => w.Ext.apply(base, wm.getViewportParams());

    return {
      w,
      wm,
      request,

      textualSearch(query) {
        return request(
          URL_WMC,
          withViewport({ action: "textual_search", query, page: 1, start: 0, limit: 25 }),
          `textual_search(${query})`
        );
      },

      /** `ids` must be integers: string ids are rejected by the backend. */
      objectsGeoJson(ids) {
        return request(
          URL_WMC,
          withViewport({ action: "get_objects_geojson", object_ids: w.Ext.encode(ids) }),
          `get_objects_geojson(${ids.length} ids)`
        );
      },

      objectsInfoForPoint(lon, lat) {
        return request(
          URL_WMC,
          withViewport({ action: "get_objects_info_for_point", lonlat: w.Ext.encode({ lon, lat }) }),
          `get_objects_info_for_point(${lon},${lat})`
        );
      },

      objectDefinition(objectId) {
        return request(
          URL_OBJECT_VIEW,
          { action: "get_object_definition", object_id: objectId },
          `get_object_definition(${objectId})`
        );
      },

      widgetContent(objectId, widgetIds) {
        return request(
          URL_OBJECT_VIEW,
          { action: "get_widget_content", object_id: objectId, widget_ids: w.Ext.encode(widgetIds) },
          `get_widget_content(${objectId})`
        );
      },

      /** Best effort: the exact parameter set of this reader is not known yet. */
      cmSection(objectId, sectionId, extra) {
        return request(
          URL_CM_SECTION,
          Object.assign({ object_id: objectId, section_id: sectionId }, extra),
          `cm_object_data_section(${objectId},${sectionId})`
        );
      },

      /** Best effort: DMS section 23 exposes `Vecinos` and per-phase network state. */
      elecSection(objectId, sectionId, extra) {
        return request(
          URL_ELEC_SECTION,
          Object.assign({ object_id: objectId, section_id: sectionId }, extra),
          `elec_addons_cm_object_data_section(${objectId},${sectionId})`
        );
      },

      /**
       * Section endpoints answer HTML, not JSON, so `Acs.request` fails while
       * decoding them. Read the payload as text over a same-origin GET instead.
       */
      async sectionHtml(objectId, sectionId, extra) {
        if (typeof w.fetch !== "function") throw new Error("fetch unavailable");
        const params = Object.assign({ object_id: objectId, section_id: sectionId }, extra);
        const query = Object.keys(params)
          .filter((key) => params[key] !== undefined && params[key] !== null)
          .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
          .join("&");
        const url = `${URL_ELEC_SECTION}?${query}`;
        const controller = typeof w.AbortController === "function" ? new w.AbortController() : null;
        const timer = w.setTimeout(() => {
          if (controller) controller.abort();
        }, REQUEST_TIMEOUT_MS);
        try {
          const init = controller ? { credentials: "same-origin", signal: controller.signal } : { credentials: "same-origin" };
          const response = await w.fetch(url, init);
          if (response && response.ok === false) throw new Error(`HTTP ${response.status} (${url})`);
          const body = await response.text();
          if (!safeString(body).trim()) throw new Error(`empty section body (${url})`);
          return body;
        } finally {
          w.clearTimeout(timer);
        }
      },
    };
  }

  // -------------------------------------------------------------- view control

  async function withProbeView(api, lon, lat, aboutZoom) {
    const { w, wm } = api;
    const view = wm.map.getView();
    const saved = {
      center: view.getCenter() ? view.getCenter().slice() : null,
      zoom: view.getZoom(),
      resolution: view.getResolution(),
    };
    const target = w.ol && w.ol.proj ? w.ol.proj.fromLonLat([lon, lat]) : [lon, lat];
    view.setCenter(target);
    view.setZoom(PROBE_ZOOM);
    await sleep(450);
    try {
      return await aboutZoom();
    } finally {
      if (saved.center) view.setCenter(saved.center);
      if (typeof saved.zoom === "number") view.setZoom(saved.zoom);
      else if (typeof saved.resolution === "number") view.setResolution(saved.resolution);
    }
  }

  // ----------------------------------------------------------- geometry lookup

  /** Extract a lon/lat pair from a `pin_location` of unknown shape. */
  const latLonFromPin = (pin) => {
    if (!pin) return null;
    if (Array.isArray(pin) && pin.length >= 2) {
      const lon = toNumericId(String(pin[0]).replace(".", "")) === null ? Number(pin[0]) : Number(pin[0]);
      const lat = Number(pin[1]);
      return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
    }
    if (isObjectLike(pin)) {
      const lon = Number(pin.lon ?? pin.lng ?? pin.x);
      const lat = Number(pin.lat ?? pin.y);
      return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
    }
    return null;
  };

  /**
   * Resolve the official coordinate of an object.
   * Tries the surrogate (cartographic) id first because geometry follows it,
   * then the business id when they differ, and finally `pin_location`.
   */
  async function resolveGeometry(api, candidate) {
    const surrogate = toNumericId(candidate.surrogate_in_map_id ?? candidate.surrogateId);
    const objectId = toNumericId(candidate.object_id ?? candidate.objectId);
    const ids = [];
    if (surrogate !== null) ids.push(surrogate);
    if (objectId !== null && objectId !== surrogate) ids.push(objectId);

    const attempts = [];
    const result = {
      objectId: objectId,
      surrogateId: surrogate,
      display: candidate.display,
      requestedIds: ids,
      attempts,
      geometryType: null,
      coordinates: null,
      lonlat: null,
      error: null,
    };

    if (ids.length === 0) {
      result.error = "no numeric id on this candidate";
      const fromPin = latLonFromPin(candidate.pin_location);
      if (fromPin) {
        result.lonlat = fromPin;
        result.geometryType = "pin_location";
      }
      return result;
    }

    for (const id of ids) {
      try {
        const payload = await api.objectsGeoJson([id]);
        const features = featuresOf(payload);
        const feature = features.find((item) => item && item.geometry && item.geometry.type === "Point") || features[0] || null;
        const geometry = feature && feature.geometry ? feature.geometry : null;
        const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
        attempts.push({
          sentId: id,
          sentIdType: typeof id,
          features: features.length,
          geometryType: geometry ? geometry.type : null,
          error: null,
        });
        if (geometry && geometry.type === "Point" && coordinates && coordinates.length >= 2) {
          result.geometryType = "Point";
          result.coordinates = coordinates;
          result.lonlat = { lon: coordinates[0], lat: coordinates[1] };
          result.featureId = feature.id;
          result.featureProperties = feature.properties;
          return result;
        }
      } catch (error) {
        attempts.push({
          sentId: id,
          sentIdType: typeof id,
          features: 0,
          geometryType: null,
          error: safeString(error && error.message) || preview(error),
        });
      }
    }

    const fromPin = latLonFromPin(candidate.pin_location);
    if (fromPin) {
      result.lonlat = fromPin;
      result.geometryType = "pin_location";
      result.error = "no Point geometry; using pin_location";
      return result;
    }

    result.error = attempts.some((attempt) => attempt.error)
      ? "every geometry request failed"
      : "no Point geometry returned for this object";
    return result;
  }

  // --------------------------------------------------------------- case probes

  async function resolveCode(api, code) {
    const attempts = [];
    const candidatesFor = (value) => [value, value.replace(/^F/i, ""), `F${value}`, `FF${value}`];

    for (const term of [...new Set(candidatesFor(code))]) {
      const response = await api.textualSearch(term);
      const rows = Array.isArray(response) ? response : [];
      attempts.push({ term, count: rows.length });
      if (rows.length > 0) {
        return { term, candidates: rows, attempts };
      }
    }
    return { term: null, candidates: [], attempts };
  }

  /**
   * Order the search candidates into pole targets worth querying.
   * A code such as `F51757` is a *prefix*: GNAT returns the substation
   * `F51757` plus every `F517570..F517577` pole and their devices. Poles come
   * first because a pole is what carries spans; devices and substations are
   * reported but never chosen for the point query.
   */
  function planTargets(candidates, code) {
    const enriched = candidates.map((candidate) => {
      const flags = classify(candidate);
      const display = safeString(candidate.display);
      const exactPrefix = display.startsWith(`${code} (`) || display === code;
      return { candidate, flags, exactPrefix };
    });

    const score = (entry) => {
      if (entry.flags.isDevice) return 100;
      if (entry.flags.isSubstation) return 90;
      if (entry.flags.isPole) return entry.exactPrefix ? 0 : 1;
      return entry.exactPrefix ? 2 : 3;
    };

    const ordered = enriched.slice().sort((a, b) => score(a) - score(b));
    return {
      poleTargets: ordered.filter((entry) => !entry.flags.isDevice && !entry.flags.isSubstation).slice(0, MAX_POLE_TARGETS),
      deviceTargets: ordered.filter((entry) => entry.flags.isDevice).slice(0, MAX_SEARCH_DEVICES),
      substations: ordered.filter((entry) => entry.flags.isSubstation).map((entry) => entry.candidate),
      classified: ordered.map((entry) => ({
        display: entry.candidate.display,
        id: entry.candidate.object_id,
        ...entry.flags,
        exactPrefix: entry.exactPrefix,
      })),
    };
  }

  async function probePoint(api, lon, lat) {
    return withProbeView(api, lon, lat, async () => {
      const response = await api.objectsInfoForPoint(lon, lat);
      const rows = Array.isArray(response) ? response : [];
      return {
        requestLonLat: { lon, lat },
        count: rows.length,
        objects: rows.map((item) => {
          const flags = classify(item);
          return {
            id: item && item.id,
            idType: item && typeof item.id,
            display: item && item.display,
            type: item && item.type,
            ...flags,
            descriptionText: item && item.description ? truncate(htmlToText(item.description), 2500) : null,
            image: item && item.image ? "present" : null,
            rawKeys: item && isObjectLike(item) ? Object.keys(item) : [],
          };
        }),
      };
    });
  }

  async function probeSpanGeometries(api, spanIds) {
    const results = [];
    for (let i = 0; i < spanIds.length; i += MAX_IDS_PER_GEOJSON_CALL) {
      const batch = spanIds.slice(i, i + MAX_IDS_PER_GEOJSON_CALL).map(toNumericId).filter((id) => id !== null);
      if (batch.length === 0) continue;
      const geo = await api.objectsGeoJson(batch);
      for (const feature of featuresOf(geo)) {
        const geometry = feature && feature.geometry ? feature.geometry : null;
        const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        results.push({
          requestedIds: batch,
          featureId: feature ? feature.id : null,
          display: feature && feature.properties ? feature.properties.display_name : null,
          properties: feature ? feature.properties : null,
          geometryType: geometry ? geometry.type : null,
          vertexCount: coords.length,
          vertices: coords.length <= 6 ? coords : undefined,
          first: coords.length ? coords[0] : null,
          last: coords.length ? coords[coords.length - 1] : null,
          bbox: feature ? feature.bbox : null,
        });
      }
    }
    return { requested: spanIds.length, featuresReturned: results.length, features: results };
  }

  /** Read a device's ficha definition and look for state-bearing widgets. */
  async function probeDeviceDefinition(api, objectId) {
    const numericId = toNumericId(objectId);
    if (numericId === null) return { objectId, error: "no numeric id" };

    const definition = await api.objectDefinition(numericId);
    const widgetDefinition = definition && definition.widget_definition ? definition.widget_definition : null;
    const bucketNames = ["header_widgets", "tab_widgets", "tool_widgets", "action_widgets"];

    const widgets = [];
    if (widgetDefinition) {
      for (const bucket of bucketNames) {
        const list = Array.isArray(widgetDefinition[bucket]) ? widgetDefinition[bucket] : [];
        for (const widget of list) {
          widgets.push({
            bucket,
            id: widget && widget.id,
            title: widget && widget.title,
            component_class: widget && widget.component_class,
            color: widget && widget.color,
          });
        }
      }
    }

    const out = {
      objectId: numericId,
      title: definition && definition.title ? truncate(htmlToText(definition.title), 200) : null,
      messageError: definition ? definition.message_error : null,
      buckets: widgetDefinition ? Object.keys(widgetDefinition) : [],
      widgetCount: widgets.length,
      widgets,
      stateWidgets: widgets.filter((widget) => {
        const blob = `${safeString(widget.title)} ${safeString(widget.id)}`.toLowerCase();
        return STATE_HINTS.some((hint) => blob.includes(hint));
      }),
      widgetContents: [],
    };

    // Only state-relevant widgets are read, to keep the probe bounded.
    const wanted = (out.stateWidgets.length > 0 ? out.stateWidgets : widgets).slice(0, 8);
    const ids = wanted.map((widget) => toNumericId(widget.id)).filter((id) => id !== null);
    if (ids.length > 0) {
      const contents = await api.widgetContent(numericId, ids);
      const list = Array.isArray(contents) ? contents : [];
      out.widgetContents = list.map((entry) => {
        const text = htmlToText(entry && entry.content);
        return {
          widgetId: entry && entry.widget_id,
          textLength: text.length,
          text: truncate(text, 2500),
          stateLines: extractStateLines(text),
        };
      });
    }

    return out;
  }

  /**
   * Probe DMS section 23 (`networking_electrical`).
   *
   * The endpoint answers HTML, not JSON: `Acs.request` fails while decoding it
   * and the payload survives only inside the error message. Read it as text
   * first, and salvage it from the error when that is not possible.
   */
  async function probeElectricalSection(api, objectId) {
    const numericId = toNumericId(objectId);
    if (numericId === null) return { objectId, attempts: [], parsed: null, error: "no numeric id" };

    const attempts = [];
    const variants = [{}, { list_operations: 1 }];

    for (const variant of variants) {
      try {
        const html = await api.sectionHtml(numericId, DMS_SECTION_NETWORKING_ELECTRICAL, variant);
        const parsed = parseElectricalSection(html);
        attempts.push({ params: variant, ok: true, via: "fetch", htmlLength: html.length, parsed });
        if (parsed.hasContent) break;
      } catch (error) {
        attempts.push({
          params: variant,
          ok: false,
          via: "fetch",
          error: truncate(safeString(error && error.message) || preview(error), 300),
        });
      }
    }

    const satisfied = attempts.some((attempt) => attempt.ok && attempt.parsed && attempt.parsed.hasContent);
    if (!satisfied) {
      try {
        const response = await api.elecSection(numericId, DMS_SECTION_NETWORKING_ELECTRICAL, {});
        const html = typeof response === "string" ? response : null;
        attempts.push(
          html
            ? { params: { via: "acs" }, ok: true, via: "acs", htmlLength: html.length, parsed: parseElectricalSection(html) }
            : { params: { via: "acs" }, ok: false, via: "acs", error: "acs returned no text payload" }
        );
      } catch (error) {
        const message = safeString(error && error.message) || preview(error);
        const html = extractHtmlFromMessage(message);
        attempts.push(
          html
            ? { params: { via: "acs-salvage" }, ok: true, via: "acs-salvage", htmlLength: html.length, parsed: parseElectricalSection(html) }
            : { params: { via: "acs-salvage" }, ok: false, via: "acs-salvage", error: truncate(message, 300) }
        );
      }
    }

    const winner = attempts.find((attempt) => attempt.ok && attempt.parsed && attempt.parsed.hasContent) || null;
    return {
      objectId: numericId,
      sectionId: DMS_SECTION_NETWORKING_ELECTRICAL,
      attempts,
      parsed: winner ? winner.parsed : null,
      via: winner ? winner.via : null,
    };
  }

  /** Read a candidate device that came from the search list, not from a pole. */
  async function probeSearchDevice(api, candidate) {
    const numericId = toNumericId(candidate.object_id);
    const entry = {
      objectId: numericId,
      surrogateId: toNumericId(candidate.surrogate_in_map_id),
      display: candidate.display,
      geometry: null,
      definition: null,
      electricalSection: null,
    };

    const geometry = await step(`deviceGeometry:${numericId}`, () => resolveGeometry(api, candidate));
    entry.geometry = geometry.ok ? geometry.value : { error: geometry.error };

    const definition = await step(`deviceDefinition:${numericId}`, () => probeDeviceDefinition(api, numericId));
    entry.definition = definition.ok ? definition.value : { error: definition.error };

    const section = await step(`deviceSection23:${numericId}`, () => probeElectricalSection(api, numericId));
    entry.electricalSection = section.ok ? section.value : { error: section.error, attempts: [] };

    return entry;
  }

  /** One evidence entry per object whose section 23 answered with real content. */
  function collectStateEvidence(devices, electricalSection) {
    const evidence = [];

    const pushSection = (section, source, deviceId) => {
      const parsed = section && section.parsed;
      if (!parsed) return;
      // A section that answered but carries nothing is not state evidence: a pole
      // with an empty `Comportamiento de red por fase` must not read as "readable".
      const meaningful =
        !!parsed.estadoOperativo ||
        !!(parsed.phases && (parsed.phases.real || parsed.phases.normal)) ||
        (Array.isArray(parsed.vecinos) && parsed.vecinos.length > 0);
      if (!meaningful) return;
      evidence.push({
        source,
        deviceId,
        via: section.via,
        estadoOperativo: parsed.estadoOperativo,
        tensionCircuito: parsed.tensionCircuito,
        circuito: parsed.circuito,
        phases: parsed.phases,
        vecinos: parsed.vecinos,
        neighborIds: parsed.neighborIds,
        netModels: parsed.netModels,
      });
    };

    for (const device of devices || []) {
      const definition = device.definition || {};
      if (Array.isArray(definition.stateWidgets) && definition.stateWidgets.length > 0) {
        evidence.push({
          source: "object_view_widget_titles",
          deviceId: device.id ?? device.objectId,
          widgets: definition.stateWidgets,
        });
      }
      for (const content of definition.widgetContents || []) {
        if (content.stateLines && content.stateLines.total > 0) {
          evidence.push({
            source: "widget_content",
            deviceId: device.id ?? device.objectId,
            widgetId: content.widgetId,
            lines: content.stateLines.lines,
          });
        }
      }
      pushSection(device.electricalSection, "device_dms_section_23", device.id ?? device.objectId);
    }

    pushSection(electricalSection, "dms_section_23", electricalSection ? electricalSection.objectId : null);

    return evidence;
  }

  function summariseCase(poleCase) {
    const objects = (poleCase.pointQuery && poleCase.pointQuery.objects) || [];
    const spans = objects.filter((item) => item.isSpan);
    const poleDevices = objects.filter((item) => item.isDevice);
    const nodes = objects.filter((item) => item.isNode);

    const spanParses = spans.map((span) => parseSpanDisplay(span.display));
    const spanGeom = (poleCase.spanGeometries && poleCase.spanGeometries.features) || [];
    const lineStrings = spanGeom.filter((feature) => feature.geometryType === "LineString");

    // `poleCase.devices` holds the probed definitions; the raw point-query flags
    // carry no ficha, so they are only used for counting.
    const allDevices = [...(poleCase.devices || []), ...(poleCase.searchDevices || [])];
    const stateEvidence = collectStateEvidence(allDevices, poleCase.electricalSection);

    const sectionOf = (section) => {
      const parsed = section && section.parsed;
      if (!parsed) return null;
      return {
        objectId: section.objectId,
        via: section.via,
        estadoOperativo: parsed.estadoOperativo,
        tensionCircuito: parsed.tensionCircuito,
        circuito: parsed.circuito,
        phases: parsed.phases,
        vecinos: parsed.vecinos,
        neighborIds: parsed.neighborIds,
        netModels: parsed.netModels,
      };
    };

    const sections = [sectionOf(poleCase.electricalSection)]
      .concat((poleCase.searchDevices || []).map((device) => sectionOf(device.electricalSection)))
      .filter(Boolean);

    // A point query can come back with no spans at all. Report the evidence so
    // the next run can tell "this point has no spans" from "I misclassified".
    const objectsSample = objects
      .slice(0, 25)
      .map((item) => ({ id: item.id, type: item.type, display: item.display }));
    const typeCounts = {};
    for (const item of objects) {
      const key = safeString(item.type) || "(sin type)";
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    }
    const spanDiagnosis = {
      objectsReturned: objects.length,
      typeCounts,
      objectsSample,
      objectTitles: poleCase.objectTitles || [],
      note: spans.length > 0 ? "spans classified" : "no object at this point was classified as a span",
    };

    return {
      code: poleCase.code,
      pointFound: !!poleCase.pointQuery,
      objectsReturned: objects.length,
      spansFound: spans.length,
      devicesOnPole: poleDevices.length,
      devicesFromSearch: (poleCase.searchDevices || []).length,
      nodesFound: nodes.length,
      everySpanDisplayParses: spans.length > 0 && spanParses.every((parsed) => parsed.parsesCleanly),
      spanDisplays: spanParses,
      lineStringsReturned: lineStrings.length,
      twoVertexLineStrings: lineStrings.filter((feature) => feature.vertexCount === 2).length,
      deviceTypes: [...poleDevices.map((device) => device.type), ...(poleCase.searchDevices || []).map((device) => device.display)],
      spanTypes: [...new Set(spans.map((span) => span.type))],
      hasStateEvidence: stateEvidence.length > 0,
      stateEvidence,
      sections,
      objectsSample,
      spanDiagnosis,
      conclusions: {
        u1_mtSpansExposeEndpointCodes: spans.length > 0 && spanParses.some((parsed) => parsed.parsesCleanly),
        u1_spansHaveLineStringGeometry: lineStrings.length > 0,
        u2_devicesAreVisibleOnPole: poleDevices.length > 0 || (poleCase.searchDevices || []).length > 0,
        u2_deviceStateIsReadable: stateEvidence.length > 0,
        u2_sectionStateReadable: sections.some((entry) => !!entry.estadoOperativo || !!(entry.phases && entry.phases.real)),
      },
    };
  }

  async function probeCode(api, code) {
    const poleCase = {
      code,
      resolved: null,
      candidates: [],
      targetPlan: null,
      geometryAttempts: [],
      pointQuery: null,
      spanGeometries: null,
      devices: [],
      searchDevices: [],
      electricalSection: null,
    };

    const resolution = await step(`resolve:${code}`, () => resolveCode(api, code));
    poleCase.resolutionAttempts = resolution.ok ? resolution.value.attempts : [];
    const candidates = resolution.ok ? resolution.value.candidates : [];
    poleCase.candidates = candidates.map((candidate) => ({
      object_id: candidate.object_id,
      surrogate_in_map_id: candidate.surrogate_in_map_id,
      pin_location: candidate.pin_location,
      display: candidate.display,
    }));

    if (candidates.length === 0) {
      poleCase.resolved = { error: "no candidates from textual_search" };
      poleCase.summary = { code, error: "no candidates" };
      return poleCase;
    }

    const plan = planTargets(candidates, code);
    poleCase.targetPlan = {
      classified: plan.classified,
      poleTargets: plan.poleTargets.map((entry) => entry.candidate.display),
      deviceTargets: plan.deviceTargets.map((entry) => entry.candidate.display),
      substations: plan.substations.map((candidate) => candidate.display),
    };

    // Walk the ordered targets until one yields a usable Point.
    let chosen = null;
    for (const entry of plan.poleTargets) {
      const geometry = await step(`geometry:${entry.candidate.object_id}`, () => resolveGeometry(api, entry.candidate));
      poleCase.geometryAttempts.push({
        display: entry.candidate.display,
        ok: geometry.ok,
        lonlat: geometry.ok ? geometry.value.lonlat : null,
        attempts: geometry.ok ? geometry.value.attempts : [{ error: geometry.error }],
        error: geometry.ok ? geometry.value.error : geometry.error,
      });
      if (geometry.ok && geometry.value.lonlat) {
        chosen = geometry.value;
        break;
      }
    }

    poleCase.resolved = chosen || {
      error: poleCase.geometryAttempts.length === 0 ? "no pole-like candidate to query" : "no candidate yielded a Point",
    };

    if (!chosen) {
      poleCase.summary = { code, error: "no point geometry", pointFound: false, ...summariseCase(poleCase) };
      return poleCase;
    }

    const point = await step(`point:${code}`, () => probePoint(api, chosen.lonlat.lon, chosen.lonlat.lat));
    poleCase.pointQuery = point.ok ? point.value : { error: point.error, objects: [] };

    const spanIds = ((poleCase.pointQuery && poleCase.pointQuery.objects) || [])
      .filter((item) => item.isSpan)
      .map((item) => toNumericId(item.id))
      .filter((id) => id !== null);

    if (spanIds.length > 0) {
      const spans = await step(`spans:${code}`, () => probeSpanGeometries(api, spanIds));
      poleCase.spanGeometries = spans.ok ? spans.value : { error: spans.error, features: [] };
    }

    const poleDevices = ((poleCase.pointQuery && poleCase.pointQuery.objects) || []).filter(
      (item) => item.isDevice && toNumericId(item.id) !== null
    );

    for (const device of poleDevices) {
      const definition = await step(`device:${device.id}`, () => probeDeviceDefinition(api, device.id));
      poleCase.devices.push({
        id: device.id,
        display: device.display,
        type: device.type,
        definition: definition.ok ? definition.value : { error: definition.error },
      });
    }

    // Devices that only appear in the search list still carry the state question.
    for (const entry of plan.deviceTargets) {
      const device = await step(`searchDevice:${entry.candidate.object_id}`, () => probeSearchDevice(api, entry.candidate));
      if (device.ok) poleCase.searchDevices.push(device.value);
    }

    const sectionSubject = toNumericId(chosen.objectId) ?? toNumericId(chosen.surrogateId);
    const section = await step(`section23:${sectionSubject}`, () => probeElectricalSection(api, sectionSubject));
    poleCase.electricalSection = section.ok ? section.value : { error: section.error, attempts: [] };

    poleCase.summary = summariseCase(poleCase);
    return poleCase;
  }

  /** Probe objects directly by numeric id, skipping the textual search. */
  async function probeObjectId(api, objectId) {
    const numericId = toNumericId(objectId);
    const poleCase = { code: `#${safeString(objectId)}`, objectId: numericId, pointQuery: null, resolved: null };

    const geometry = await step(`geometry:${objectId}`, () =>
      resolveGeometry(api, { object_id: numericId, surrogate_in_map_id: numericId, display: `#${objectId}` })
    );
    poleCase.geometryAttempts = [{ ok: geometry.ok, lonlat: geometry.ok ? geometry.value.lonlat : null, error: geometry.ok ? geometry.value.error : geometry.error }];
    poleCase.resolved = geometry.ok ? geometry.value : { error: geometry.error };

    if (!poleCase.resolved || !poleCase.resolved.lonlat) {
      poleCase.summary = { code: poleCase.code, error: "no point geometry", pointFound: false };
      return poleCase;
    }

    const point = await step(`point:${objectId}`, () =>
      probePoint(api, poleCase.resolved.lonlat.lon, poleCase.resolved.lonlat.lat)
    );
    poleCase.pointQuery = point.ok ? point.value : { error: point.error, objects: [] };

    const spanIds = ((poleCase.pointQuery && poleCase.pointQuery.objects) || [])
      .filter((item) => item.isSpan)
      .map((item) => toNumericId(item.id))
      .filter((id) => id !== null);
    if (spanIds.length > 0) {
      const spans = await step(`spans:${objectId}`, () => probeSpanGeometries(api, spanIds));
      poleCase.spanGeometries = spans.ok ? spans.value : { error: spans.error, features: [] };
    }

    const definition = await step(`definition:${objectId}`, () => probeDeviceDefinition(api, numericId));
    poleCase.devices = [{ id: numericId, display: `#${objectId}`, definition: definition.ok ? definition.value : { error: definition.error } }];

    const section = await step(`section23:${objectId}`, () => probeElectricalSection(api, numericId));
    poleCase.electricalSection = section.ok ? section.value : { error: section.error, attempts: [] };

    poleCase.summary = summariseCase(poleCase);
    return poleCase;
  }

  const verdictOf = (summaries) => ({
    u1_mtSpansExposeEndpointCodes: summaries.some((summary) => summary.conclusions && summary.conclusions.u1_mtSpansExposeEndpointCodes),
    u1_spansHaveLineStringGeometry: summaries.some((summary) => summary.conclusions && summary.conclusions.u1_spansHaveLineStringGeometry),
    u2_devicesAreVisibleOnPole: summaries.some((summary) => summary.conclusions && summary.conclusions.u2_devicesAreVisibleOnPole),
    u2_deviceStateIsReadable: summaries.some((summary) => summary.conclusions && summary.conclusions.u2_deviceStateIsReadable),
    everySpanDisplayParses: summaries.length > 0 && summaries.every((summary) => summary.everySpanDisplayParses),
    anyPointFound: summaries.some((summary) => summary.pointFound),
  });

  /** Read only the class GNAT reports for an object, without its widgets. */
  async function probeObjectTitle(api, objectId) {
    const numericId = toNumericId(objectId);
    if (numericId === null) return { objectId, title: null, buckets: [] };
    const definition = await api.objectDefinition(numericId);
    return {
      objectId: numericId,
      title: definition && definition.title ? truncate(htmlToText(definition.title), 200) : null,
      buckets: definition && definition.widget_definition ? Object.keys(definition.widget_definition) : [],
    };
  }

  /**
   * Inventory a bare coordinate: no code, no textual search. A span is a line
   * between two poles, so the middle of a span can answer what the pole cannot.
   */
  async function probePointAt(api, lon, lat, label) {
    const pointCase = {
      code: label || `@${lon},${lat}`,
      resolved: { lonlat: { lon, lat }, geometryType: "coordinate" },
      geometryAttempts: [],
      pointQuery: null,
      spanGeometries: null,
      devices: [],
      searchDevices: [],
      electricalSection: null,
    };

    const point = await step(`point:${pointCase.code}`, () => probePoint(api, lon, lat));
    pointCase.pointQuery = point.ok ? point.value : { error: point.error, objects: [] };

    const objects = (pointCase.pointQuery && pointCase.pointQuery.objects) || [];

    // Ask GNAT for the class of each object instead of trusting the label-based
    // classification: this is what tells a span apart from an accessory.
    const objectTitles = [];
    for (const item of objects.slice(0, 3)) {
      const title = await step(`title:${item.id}`, () => probeObjectTitle(api, item.id));
      if (title.ok) {
        objectTitles.push({
          ...title.value,
          reportedType: item.type,
          reportedDisplay: item.display,
          classifiedAsSpan: item.isSpan,
          classifiedAsDevice: item.isDevice,
        });
      }
    }
    pointCase.objectTitles = objectTitles;

    const spanIds = objects
      .filter((item) => item.isSpan)
      .map((item) => toNumericId(item.id))
      .filter((id) => id !== null);
    if (spanIds.length > 0) {
      const spans = await step(`spans:${pointCase.code}`, () => probeSpanGeometries(api, spanIds));
      pointCase.spanGeometries = spans.ok ? spans.value : { error: spans.error, features: [] };
    }

    const subject = objects.find((item) => item.isDevice) || objects.find((item) => item.isPole) || objects[0] || null;
    if (subject && toNumericId(subject.id) !== null) {
      const section = await step(`section23:${subject.id}`, () => probeElectricalSection(api, subject.id));
      pointCase.electricalSection = section.ok ? section.value : { error: section.error, attempts: [] };
      if (subject.isDevice) {
        const definition = await step(`device:${subject.id}`, () => probeDeviceDefinition(api, subject.id));
        pointCase.devices.push({
          id: subject.id,
          display: subject.display,
          type: subject.type,
          definition: definition.ok ? definition.value : { error: definition.error },
        });
      }
    }

    pointCase.summary = summariseCase(pointCase);
    return pointCase;
  }

  /** Resolve the current map view centre to lon/lat. */
  function mapCenterLonLat(api) {
    const center = api.wm.map.getView().getCenter();
    if (!center) throw new Error("map view has no centre");
    const w = api.w;
    const lonlat = w.ol && w.ol.proj && typeof w.ol.proj.toLonLat === "function" ? w.ol.proj.toLonLat(center) : center;
    return { lon: lonlat[0], lat: lonlat[1] };
  }

  /**
   * Inventory one coordinate. Defaults to the current map centre, which is how
   * a span is sampled: centre the map on the line and run it.
   */
  async function probeAt(target, label) {
    const api = buildApi(resolveEnv());
    const position =
      target && typeof target.lon === "number" && typeof target.lat === "number" ? target : mapCenterLonLat(api);
    const pointCase = await probePointAt(
      api,
      position.lon,
      position.lat,
      label || `@${Number(position.lon).toFixed(6)},${Number(position.lat).toFixed(6)}`
    );
    report.cases.push(pointCase);
    report.finishedAt = new Date().toISOString();
    report.verdict = verdictOf(report.cases.map((entry) => entry.summary).filter(Boolean));
    console.info(`[gnatProbe] ${pointCase.code}`);
    // Printed as text so the console does not collapse it into `{…}`.
    console.info(JSON.stringify(pointCase.summary.spanDiagnosis, null, 1));
    return pointCase;
  }

  const probeCenter = (label) => probeAt(null, label);

  // ---------------------------------------------------------------- entrypoint

  async function run(input) {
    const items = Array.isArray(input) && input.length > 0 ? input : DEFAULT_CODES;
    report.inputs = items;
    report.cases = [];
    report.errors = [];
    report.warnings = [];
    report.startedAt = new Date().toISOString();
    report.finishedAt = null;

    let api;
    try {
      api = buildApi(resolveEnv());
    } catch (error) {
      report.errors.push({ step: "environment", message: safeString(error && error.message) });
      report.finishedAt = new Date().toISOString();
      console.error("[gnatProbe] environment error:", error);
      return report;
    }

    const view = api.wm.map.getView();
    report.viewport = {
      projection: view.getProjection() ? safeString(view.getProjection().getCode()) : null,
      zoom: view.getZoom(),
      usesViewportParams: typeof api.wm.getViewportParams === "function",
    };

    console.info(`[gnatProbe] v${VERSION} probing ${items.length} input(s): ${items.map(safeString).join(", ")}`);

    for (const item of items) {
      const isId = typeof item === "number" || (typeof item === "string" && /^\d+$/.test(item.trim()));
      console.info(`[gnatProbe] → ${safeString(item)} (${isId ? "object id" : "code"})`);
      try {
        const poleCase = isId ? await probeObjectId(api, item) : await probeCode(api, safeString(item));
        report.cases.push(poleCase);
        const summary = poleCase.summary || {};
        console.info(`[gnatProbe] ← ${safeString(item)}`, {
          pointFound: summary.pointFound,
          spans: summary.spansFound,
          devicesOnPole: summary.devicesOnPole,
          devicesFromSearch: summary.devicesFromSearch,
          lineStrings: summary.lineStringsReturned,
          stateEvidence: summary.hasStateEvidence,
        });
      } catch (error) {
        const message = safeString(error && error.message) || preview(error);
        report.errors.push({ step: `case:${safeString(item)}`, message });
        report.cases.push({ code: safeString(item), error: message });
        console.error(`[gnatProbe] case ${safeString(item)} failed:`, error);
      }
    }

    const summaries = report.cases.map((entry) => entry.summary).filter(Boolean);
    report.finishedAt = new Date().toISOString();
    report.verdict = verdictOf(summaries);

    console.info("[gnatProbe] verdict:", report.verdict);
    console.info("[gnatProbe] run `__gnatProbe.copy()` to copy the full report.");
    return report;
  }

  const json = () => JSON.stringify(report, null, 2);

  /**
   * Bounded digest: the verdict plus what actually answers U1 and U2 per case.
   * The full report keeps every geometry attempt and widget text; this one is
   * what fits in a pasted message without losing a single decision input.
   */
  const summaryJson = () =>
    JSON.stringify(
      {
        probeVersion: VERSION,
        viewport: report.viewport,
        verdict: report.verdict,
        errors: report.errors,
        cases: report.cases.map((entry) => ({
          code: entry.code,
          resolved: entry.resolved,
          geometryAttempts: entry.geometryAttempts,
          targetPlan: entry.targetPlan
            ? {
                poleTargets: entry.targetPlan.poleTargets,
                deviceTargets: entry.targetPlan.deviceTargets,
                substations: entry.targetPlan.substations,
              }
            : null,
          summary: entry.summary,
        })),
      },
      null,
      2
    );

  async function copyWith(payload, label) {
    window.__gnatProbe = window.__gnatProbe || {};
    window.__gnatProbe.lastPayload = payload;
    window.__gnatProbe.lastPayloadLabel = label;
    try {
      await navigator.clipboard.writeText(payload);
      console.info(`[gnatProbe] ${label} copied (${payload.length} chars).`);
      return true;
    } catch (error) {
      // An unfocused console rejects the async clipboard API outright.
      try {
        const area = document.createElement("textarea");
        area.value = payload;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "-1000px";
        document.body.appendChild(area);
        area.select();
        const copied = typeof document.execCommand === "function" && document.execCommand("copy");
        document.body.removeChild(area);
        if (copied) {
          console.info(`[gnatProbe] ${label} copied via fallback (${payload.length} chars).`);
          return true;
        }
      } catch (_) {
        /* fall through to the console */
      }
      console.warn(`[gnatProbe] clipboard blocked for ${label}; payload printed below and kept on __gnatProbe.lastPayload.`);
      console.log(payload);
      return false;
    }
  }

  const copy = () => copyWith(json(), "report");

  const copySummary = () => copyWith(summaryJson(), "summary");

  window.__gnatProbe = {
    version: VERSION,
    run,
    probeAt,
    probeCenter,
    json,
    summaryJson,
    copy,
    copySummary,
    report,
    /** Re-read the environment only; useful to confirm you are in the right frame. */
    env() {
      const w = resolveEnv();
      return {
        frame: window === w ? "same-frame" : "iframe#content",
        hasWebMap: !!w.webMap_,
        hasMap: !!(w.webMap_ && w.webMap_.map),
        hasAcs: !!(w.Acs && typeof w.Acs.request === "function"),
        hasExt: !!(w.Ext && typeof w.Ext.apply === "function"),
        zoom: w.webMap_ && w.webMap_.map ? w.webMap_.map.getView().getZoom() : null,
      };
    },
  };

  console.info(
    `[gnatProbe] v${VERSION} loaded. Next: await __gnatProbe.run()  →  __gnatProbe.copySummary()  (defaults: ${DEFAULT_CODES.join(", ")})`
  );
})();
