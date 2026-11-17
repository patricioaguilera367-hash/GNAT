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
 *   U2. Which objects represent switching devices (`DBC`, `DF`, `DC`,
 *       `Reconectador`, `Pole Top`), and is there ANY endpoint that exposes
 *       their open/closed state?
 *
 * This script is strictly READ-ONLY against GNAT:
 *   - it calls only the four allowlisted read endpoints plus the two section
 *     readers, and never a write/action endpoint;
 *   - it never inserts remote HTML into the DOM and never executes remote JS:
 *     every response is handled as inert text;
 *   - it never aborts requests it does not own;
 *   - the only mutation is the map view (center + zoom), restored afterwards.
 *
 * Usage (browser console of the GNAT tab, top frame):
 *
 *   await __gnatProbe.run()                      // DEFAULT_CODES
 *   await __gnatProbe.run(["F51757"])            // explicit codes
 *   __gnatProbe.copy()                           // report to clipboard
 *   __gnatProbe.json()                           // report as string
 *
 * Paste the clipboard content back to the assistant. Nothing is written to
 * GNAT, to the map data, or to disk.
 */
(() => {
  "use strict";

  const VERSION = "1.0.0";

  /** Poles to probe when `run()` is called without arguments. */
  const DEFAULT_CODES = ["F51757", "F61655", "F514139"];

  /** `get_objects_info_for_point` resolves against the live view scale. */
  const PROBE_ZOOM = 18;
  const REQUEST_TIMEOUT_MS = 20000;
  const MAX_IDS_PER_GEOJSON_CALL = 40;

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
    "reconectador",
    "reconnect",
    "seccionador",
    "fusible",
    "pole top",
    "interruptor",
    "apertura",
    "cuchilla",
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
    codes: [],
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

  /** Collect every `Text: Value` pair that mentions a state hint. */
  const extractStateLines = (text, maxLines = 40) => {
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

  /** Pretty-print a value for the report, bounded. */
  const preview = (value, max = 1200) => {
    if (typeof value === "string") return truncate(value, max);
    try {
      return truncate(JSON.stringify(value, null, 1), max);
    } catch (_) {
      return safeString(value);
    }
  };

  /** Classify an object by its reported `type` / `display`. */
  const classify = (item) => {
    const type = safeString(item && item.type).toLowerCase();
    const display = safeString(item && item.display).toLowerCase();
    const blob = `${type} ${display}`;
    const isDevice = DEVICE_HINTS.some((hint) => blob.includes(hint));
    const isSpan = SPAN_HINTS.some((hint) => blob.includes(hint));
    const isNode = blob.includes("nodo");
    const isPole = blob.includes("poste") && !isDevice;
    return { isDevice, isSpan, isNode, isPole };
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

  // -------------------------------------------------------------- environment

  function resolveEnv() {
    const w = document.querySelector("iframe#content")?.contentWindow || window;
    if (!w.webMap_ || !w.webMap_.map) {
      throw new Error(
        'GNAT map not found. Open the Centrality map and run this script in the console of the frame that owns `iframe#content`.'
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
          { action: "get_widget_content", object_id: objectId, widget_ids: widgetIds },
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

  async function describeCandidateGeometry(api, candidate) {
    const surrogate = candidate.surrogate_in_map_id;
    const objectId = candidate.object_id;
    const result = { objectId, surrogateId: surrogate, display: candidate.display, pin_location: candidate.pin_location };

    const ids = [surrogate, objectId].filter((id) => id !== null && id !== undefined && id !== "");
    const unique = [...new Set(ids.map((id) => safeString(id)))];
    if (unique.length === 0) return { ...result, geometry: null, error: "no usable id" };

    const geo = await api.objectsGeoJson(unique);
    const features = geo && geo.type === "FeatureCollection" ? geo.features || [] : geo ? [geo] : [];
    const feature = features[0] || null;
    const geometry = feature && feature.geometry ? feature.geometry : null;
    const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;

    return {
      ...result,
      requestedIds: unique,
      geometryType: geometry ? geometry.type : null,
      coordinates: coords,
      featureId: feature ? feature.id : null,
      featureProperties: feature ? feature.properties : null,
      lonlat: geometry && geometry.type === "Point" && coords ? { lon: coords[0], lat: coords[1] } : null,
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
      const batch = spanIds.slice(i, i + MAX_IDS_PER_GEOJSON_CALL);
      const geo = await api.objectsGeoJson(batch);
      const features = geo && geo.type === "FeatureCollection" ? geo.features || [] : geo ? [geo] : [];
      for (const feature of features) {
        const geometry = feature && feature.geometry ? feature.geometry : null;
        const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        results.push({
          requestedId: batch.length === 1 ? batch[0] : undefined,
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
    const definition = await api.objectDefinition(objectId);
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
      objectId,
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
    const ids = wanted.map((widget) => widget.id).filter((id) => id !== null && id !== undefined);
    if (ids.length > 0) {
      const contents = await api.widgetContent(objectId, ids);
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

  /** Probe the DMS electrical section for `Vecinos` and per-phase state. */
  async function probeElectricalSection(api, objectId) {
    const attempts = [];
    const variants = [
      { section_id: DMS_SECTION_NETWORKING_ELECTRICAL },
      { section_id: DMS_SECTION_NETWORKING_ELECTRICAL, panel_id: 0, working_time: 0 },
      { section_id: DMS_SECTION_NETWORKING_ELECTRICAL, scripts: false },
    ];

    for (const variant of variants) {
      try {
        const response = await api.elecSection(objectId, DMS_SECTION_NETWORKING_ELECTRICAL, variant);
        const raw = typeof response === "string" ? response : preview(response, 60000);
        const text = htmlToText(raw);
        attempts.push({
          params: variant,
          ok: true,
          rawLength: raw.length,
          textLength: text.length,
          text: truncate(text, 6000),
          stateLines: extractStateLines(text, 60),
          mentionsVecinos: /vecino/i.test(text),
          mentionsComportamiento: /comportamiento/i.test(text),
        });
        if (attempts[attempts.length - 1].textLength > 0) break;
      } catch (error) {
        attempts.push({ params: variant, ok: false, error: safeString(error && error.message) || preview(error) });
      }
    }

    return { objectId, sectionId: DMS_SECTION_NETWORKING_ELECTRICAL, attempts };
  }

  function summariseCase(poleCase) {
    const objects = (poleCase.pointQuery && poleCase.pointQuery.objects) || [];
    const spans = objects.filter((item) => item.isSpan);
    const devices = objects.filter((item) => item.isDevice);
    const nodes = objects.filter((item) => item.isNode);

    const spanParses = spans.map((span) => parseSpanDisplay(span.display));
    const spanGeom = (poleCase.spanGeometries && poleCase.spanGeometries.features) || [];
    const lineStrings = spanGeom.filter((feature) => feature.geometryType === "LineString");

    const stateEvidence = [];
    for (const device of poleCase.devices || []) {
      if (device.definition && device.definition.stateWidgets && device.definition.stateWidgets.length > 0) {
        stateEvidence.push({ source: "object_view_widget_titles", deviceId: device.id, widgets: device.definition.stateWidgets });
      }
      for (const content of (device.definition && device.definition.widgetContents) || []) {
        if (content.stateLines && content.stateLines.total > 0) {
          stateEvidence.push({ source: "widget_content", deviceId: device.id, widgetId: content.widgetId, lines: content.stateLines.lines });
        }
      }
    }
    for (const attempt of (poleCase.electricalSection && poleCase.electricalSection.attempts) || []) {
      if (attempt.ok && attempt.stateLines && attempt.stateLines.total > 0) {
        stateEvidence.push({ source: "dms_section_23", lines: attempt.stateLines.lines });
      }
    }

    return {
      code: poleCase.code,
      objectsReturned: objects.length,
      spansFound: spans.length,
      devicesFound: devices.length,
      nodesFound: nodes.length,
      everySpanDisplayParses: spans.length > 0 && spanParses.every((parsed) => parsed.parsesCleanly),
      spanDisplays: spanParses,
      lineStringsReturned: lineStrings.length,
      twoVertexLineStrings: lineStrings.filter((feature) => feature.vertexCount === 2).length,
      deviceTypes: devices.map((device) => device.type),
      spanTypes: [...new Set(spans.map((span) => span.type))],
      hasStateEvidence: stateEvidence.length > 0,
      stateEvidence,
      conclusions: {
        u1_mtSpansExposeEndpointCodes: spans.length > 0 && spanParses.some((parsed) => parsed.parsesCleanly),
        u1_spansHaveLineStringGeometry: lineStrings.length > 0,
        u2_devicesAreVisibleOnPole: devices.length > 0,
        u2_deviceStateIsReadable: stateEvidence.length > 0,
      },
    };
  }

  async function probeCode(api, code) {
    const poleCase = { code, resolved: null, candidates: [], pointQuery: null, spanGeometries: null, devices: [], electricalSection: null };

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

    const chosen = candidates.find((candidate) => /poste/i.test(safeString(candidate.display))) || candidates[0];
    const geometry = await step(`geometry:${code}`, () => describeCandidateGeometry(api, chosen));
    poleCase.resolved = geometry.ok ? geometry.value : { error: geometry.error };

    const lonlat = poleCase.resolved && poleCase.resolved.lonlat;
    if (!lonlat) {
      poleCase.resolved = {
        ...(poleCase.resolved || {}),
        error: "candidate geometry is not a usable Point; cannot run get_objects_info_for_point",
      };
      poleCase.summary = { code, error: "no point geometry" };
      return poleCase;
    }

    const point = await step(`point:${code}`, () => probePoint(api, lonlat.lon, lonlat.lat));
    poleCase.pointQuery = point.ok ? point.value : { error: point.error, objects: [] };

    const spanIds = ((poleCase.pointQuery && poleCase.pointQuery.objects) || [])
      .filter((item) => item.isSpan && item.id !== null && item.id !== undefined)
      .map((item) => item.id);

    if (spanIds.length > 0) {
      const spans = await step(`spans:${code}`, () => probeSpanGeometries(api, spanIds));
      poleCase.spanGeometries = spans.ok ? spans.value : { error: spans.error, features: [] };
    }

    const devices = ((poleCase.pointQuery && poleCase.pointQuery.objects) || []).filter(
      (item) => item.isDevice && item.id !== null && item.id !== undefined
    );

    for (const device of devices) {
      const definition = await step(`device:${device.id}`, () => probeDeviceDefinition(api, device.id));
      poleCase.devices.push({
        id: device.id,
        display: device.display,
        type: device.type,
        definition: definition.ok ? definition.value : { error: definition.error },
      });
    }

    const section = await step(`section23:${code}`, () => probeElectricalSection(api, poleCase.resolved.objectId));
    poleCase.electricalSection = section.ok ? section.value : { error: section.error, attempts: [] };

    poleCase.summary = summariseCase(poleCase);
    return poleCase;
  }

  // ---------------------------------------------------------------- entrypoint

  async function run(codes) {
    const input = Array.isArray(codes) && codes.length > 0 ? codes : DEFAULT_CODES;
    report.codes = input;
    report.cases = [];
    report.errors = [];
    report.warnings = [];
    report.startedAt = new Date().toISOString();
    report.finishedAt = null;

    let w, api;
    try {
      w = resolveEnv();
      api = buildApi(w);
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

    console.info(`[gnatProbe] v${VERSION} probing ${input.length} code(s): ${input.join(", ")}`);

    for (const code of input) {
      console.info(`[gnatProbe] → ${code}`);
      try {
        const poleCase = await probeCode(api, code);
        report.cases.push(poleCase);
        const summary = poleCase.summary || {};
        console.info(`[gnatProbe] ← ${code}`, {
          spans: summary.spansFound,
          devices: summary.devicesFound,
          lineStrings: summary.lineStringsReturned,
          stateEvidence: summary.hasStateEvidence,
        });
      } catch (error) {
        const message = safeString(error && error.message) || preview(error);
        report.errors.push({ step: `case:${code}`, message });
        report.cases.push({ code, error: message });
        console.error(`[gnatProbe] case ${code} failed:`, error);
      }
    }

    const summaries = report.cases.map((item) => item.summary).filter(Boolean);
    report.finishedAt = new Date().toISOString();
    report.verdict = {
      u1_mtSpansExposeEndpointCodes: summaries.some((summary) => summary.conclusions && summary.conclusions.u1_mtSpansExposeEndpointCodes),
      u1_spansHaveLineStringGeometry: summaries.some((summary) => summary.conclusions && summary.conclusions.u1_spansHaveLineStringGeometry),
      u2_devicesAreVisibleOnPole: summaries.some((summary) => summary.conclusions && summary.conclusions.u2_devicesAreVisibleOnPole),
      u2_deviceStateIsReadable: summaries.some((summary) => summary.conclusions && summary.conclusions.u2_deviceStateIsReadable),
      everySpanDisplayParses: summaries.length > 0 && summaries.every((summary) => summary.everySpanDisplayParses),
    };

    console.info("[gnatProbe] verdict:", report.verdict);
    console.info("[gnatProbe] run `__gnatProbe.copy()` to copy the full report.");
    return report;
  }

  const json = () => JSON.stringify(report, null, 2);

  async function copy() {
    const payload = json();
    try {
      await navigator.clipboard.writeText(payload);
      console.info(`[gnatProbe] report copied (${payload.length} chars).`);
      return true;
    } catch (error) {
      console.warn("[gnatProbe] clipboard unavailable; use `__gnatProbe.json()` and copy from the console.", error);
      return false;
    }
  }

  window.__gnatProbe = {
    version: VERSION,
    run,
    json,
    copy,
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
    `[gnatProbe] v${VERSION} loaded. Next: await __gnatProbe.run()  →  __gnatProbe.copy()  (defaults: ${DEFAULT_CODES.join(", ")})`
  );
})();
