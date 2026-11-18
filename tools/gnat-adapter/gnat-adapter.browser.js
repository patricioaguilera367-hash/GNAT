/**
 * Transport bridge: GNAT (browser) → injected client for `gnat-adapter.js`.
 *
 * The engine never touches the network itself. This file adapts the GNAT window
 * to the five calls the engine makes, so the same engine logic stays testable
 * offline and this bridge is the only part that changes with the host.
 *
 * Read-only by construction: GET only, no HTML execution, no map mutation.
 */
(function (root) {
  "use strict";

  const URL_WMC = "svc_wmc.php";
  const URL_OBJECT_VIEW = "Web/component/svc_object_view.php";
  const URL_ELEC_SECTION = "elec_addons_cm_object_data_section.php";
  const DEFAULT_TIMEOUT_MS = 6000;

  function resolveEnv() {
    const w = document.querySelector("iframe#content")?.contentWindow || window;
    if (!w.webMap_ || !w.webMap_.map) {
      throw new Error("GNAT map not found: run this in the console of the frame that owns `iframe#content`.");
    }
    if (!w.Acs || typeof w.Acs.request !== "function") {
      throw new Error("`webMap_` exists but `Acs.request` is unavailable; this is not the GNAT main frame.");
    }
    return w;
  }

  function makeClient(options) {
    const w = (options && options.window) || resolveEnv();
    const timeoutMs = (options && options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const withViewport = (base) => w.Ext.apply(base, w.webMap_.getViewportParams());

    const request = (url, params, label) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };
        const timer = setTimeout(() => finish(reject, new Error(`timeout: ${label}`)), timeoutMs);
        try {
          w.Acs.request({
            url,
            params,
            success: (response) => {
              clearTimeout(timer);
              finish(resolve, response);
            },
            failure: (error) => {
              clearTimeout(timer);
              finish(reject, error instanceof Error ? error : new Error(`${label} failed`));
            },
          });
        } catch (error) {
          clearTimeout(timer);
          finish(reject, error);
        }
      });

    /** Section 23 answers HTML; `Acs.request` mangles it, so this one is a raw GET. */
    const sectionHtml = async (objectId, sectionId) => {
      const query = new URLSearchParams({ object_id: String(objectId), section_id: String(sectionId) });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await w.fetch(`${URL_ELEC_SECTION}?${query.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`section ${sectionId} answered ${response.status}`);
        return await response.text();
      } finally {
        clearTimeout(timer);
      }
    };

    return {
      search(term) {
        return request(
          URL_WMC,
          withViewport({ action: "textual_search", query: term, page: 1, start: 0, limit: 25 }),
          `textual_search(${term})`
        );
      },
      geojson(ids) {
        return request(
          URL_WMC,
          withViewport({ action: "get_objects_geojson", object_ids: w.Ext.encode(ids) }),
          `get_objects_geojson(${ids.length})`
        );
      },
      /**
       * One calibrated point query.
       *
       * `scale` decides which layers the server includes and `units_per_pixel` is
       * the capture radius in metres per pixel; both are per request, so the
       * radius no longer depends on the zoom. The tuning must be applied AFTER the
       * viewport params: `Ext.apply(base, viewport)` would overwrite it.
       */
      pointObjects(lon, lat, tuning) {
        const params = withViewport({ action: "get_objects_info_for_point", lonlat: w.Ext.encode({ lon, lat }) });
        if (tuning) {
          if (typeof tuning.scale === "number") params.scale = tuning.scale;
          if (typeof tuning.units_per_pixel === "number") params.units_per_pixel = tuning.units_per_pixel;
        }
        return request(URL_WMC, params, "get_objects_info_for_point");
      },
      async objectTitle(objectId) {
        const definition = await request(
          URL_OBJECT_VIEW,
          { action: "get_object_definition", object_id: objectId },
          `get_object_definition(${objectId})`
        );
        return (definition && definition.title) || "";
      },
      sectionHtml,
    };
  }

  /** Progress output, because a run of hundreds of 1.7 s requests looks hung. */
  function withProgress(options) {
    const settings = Object.assign({}, (options && options.settings) || {});
    if (!settings.onProgress) {
      settings.onProgress = (info) =>
        console.info(`[gnatZone] ${info.requests} requests · ${Math.round(info.elapsedMs / 1000)} s`);
    }
    return Object.assign({}, options || {}, { settings });
  }

  function attach(engine) {
    const api = engine || root.__gnatZone;
    if (!api || typeof api.findWorkZone !== "function") {
      throw new Error("load gnat-adapter.js before this bridge");
    }
    api.makeClient = makeClient;
    api.findWorkZoneLive = (poleCodes, options) =>
      api.findWorkZone(Object.assign(withProgress(options), { poleCodes, client: makeClient(options) }));
    api.verifyAperturasLive = (options) =>
      api.verifyAperturas(Object.assign(withProgress(options), { client: makeClient(options) }));
    api.auditPermitLive = (permit, options) =>
      api.auditPermit(Object.assign(withProgress(options), { permit, client: makeClient(options) }));
    return api;
  }

  attach();
})(typeof globalThis !== "undefined" ? globalThis : this);
