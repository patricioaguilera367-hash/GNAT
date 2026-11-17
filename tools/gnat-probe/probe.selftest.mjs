/**
 * Offline self-test for `probe-mt-aperturas.js`.
 *
 * Runs the probe against a stubbed GNAT window so the whole pipeline
 * (resolve → geometry → point query → span geometries → device widgets →
 * DMS section 23 → summary) is exercised without touching a real GNAT session.
 *
 * The fixtures reproduce only the shapes already observed in the context
 * transcripts, plus the MT/AP shapes the probe exists to confirm.
 *
 *   node tools/gnat-probe/probe.selftest.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "probe-mt-aperturas.js"), "utf8");

const POLE_ID = 3687560;
const SPAN_MT_1 = 900001;
const SPAN_MT_2 = 900002;
const DBC_ID = 777001;

const logLines = [];

/** Responses keyed by the action the probe issues. */
const fixtures = {
  textual_search: [
    {
      object_id: POLE_ID,
      surrogate_in_map_id: POLE_ID,
      pin_location: null,
      display: "F51757 (Postes c.a. 10 m 350 Kg/Rup cte. comun con BT)",
    },
  ],
  get_objects_geojson: null, // resolved per requested ids
  get_objects_info_for_point: [
    {
      id: SPAN_MT_1,
      display: "F51757 - F51800",
      type: "Tramo Aéreo MT",
      description: "<table><tr><td>Alimentador</td><td>Angol-Los Sauces [S203]</td></tr></table>",
    },
    {
      id: SPAN_MT_2,
      display: "F51757 - F51600",
      type: "Tramo Aéreo MT",
      description: "<table><tr><td>Alimentador</td><td>Angol-Los Sauces [S203]</td></tr></table>",
    },
    { id: 3660863, display: "3660863", type: "Nodo de Baja Tensión", description: "" },
    {
      id: POLE_ID,
      display: "F51757",
      type: "Postes c.a. 10 m 350 Kg/Rup cte. comun con BT",
      description: "<table><tr><td>Voltaje</td><td>400</td></tr></table>",
    },
    { id: DBC_ID, display: "F51757", type: "Interruptor seccionador (DBC)", description: "" },
  ],
};

function geoJsonFor(ids) {
  const features = ids.map((rawId) => {
    const id = String(rawId);
    if (id === String(POLE_ID)) {
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-72.812867652, -37.912094564] },
        id: POLE_ID,
        properties: { display_name: "F51757" },
        bbox: [-72.812867652, -37.912094564, -72.812867652, -37.912094564],
      };
    }
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-72.8128, -37.912],
          [-72.8130, -37.9125],
        ],
      },
      id: Number(id),
      properties: { display_name: "F51757 - F51800" },
      bbox: [-72.8130, -37.9125, -72.8128, -37.912],
    };
  });
  return features.length === 1 ? features[0] : { type: "FeatureCollection", features };
}

function widgetDefinitionFor(objectId) {
  assert.equal(objectId, DBC_ID, "definition must be requested for the switching device");
  return {
    title: "Interruptor seccionador (DBC)",
    message_error: null,
    widget_definition: {
      header_widgets: [{ id: 5, title: "IDs" }],
      tab_widgets: [
        { id: 142, title: "Red/Datos eléctricos", component_class: "ElecNetworkingPanel" },
        { id: 41, title: "Historial de cambios" },
      ],
      tool_widgets: [],
      action_widgets: [],
    },
  };
}

const requests = [];

function fakeAcsRequest(options) {
  const { url, params, success, failure } = options;
  requests.push({ url, action: params && params.action, params });
  try {
    if (url === "svc_wmc.php") {
      if (params.action === "textual_search") return void success(fixtures.textual_search);
      if (params.action === "get_objects_geojson") {
        return void success(geoJsonFor(JSON.parse(params.object_ids)));
      }
      if (params.action === "get_objects_info_for_point") return void success(fixtures.get_objects_info_for_point);
      return void failure(new Error(`unexpected wmc action ${params.action}`));
    }
    if (url === "Web/component/svc_object_view.php") {
      if (params.action === "get_object_definition") {
        return void success(widgetDefinitionFor(Number(params.object_id)));
      }
      if (params.action === "get_widget_content") {
        return void success(
          params.widget_ids.map((widgetId) => ({
            widget_id: widgetId,
            content:
              widgetId === 142
                ? "<table><tr><td>Estado</td><td>Cerrado</td></tr><tr><td>Fase R</td><td>Real</td></tr></table>"
                : "<div>sin cambios</div>",
          }))
        );
      }
      return void failure(new Error(`unexpected object_view action ${params.action}`));
    }
    if (url === "elec_addons_cm_object_data_section.php") {
      return void success(
        "<h3>Vecinos</h3><table><tr><td>Nodo de Baja Tensión</td><td>-</td></tr></table>" +
          "<h3>Comportamiento de red por fase</h3>" +
          "<table><tr><td>Cerrado</td><td>Cerrado</td><td>Cerrado</td></tr></table>"
      );
    }
    return void failure(new Error(`unexpected url ${url}`));
  } catch (error) {
    failure(error);
  }
}

const view = {
  getProjection: () => ({ getCode: () => "EPSG:3857" }),
  getCenter: () => [0, 0],
  getZoom: () => 15,
  getResolution: () => 2.4,
  setCenter: () => {},
  setZoom: () => {},
  setResolution: () => {},
};

const sandbox = {
  console: {
    info: (...args) => logLines.push(["info", ...args]),
    warn: (...args) => logLines.push(["warn", ...args]),
    error: (...args) => logLines.push(["error", ...args]),
    log: () => {},
  },
  document: { querySelector: () => null },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  webMap_: {
    map: { getView: () => view },
    getViewportParams: () => ({ bounds: "stub", scale: 1000, units_per_pixel: 0.4 }),
  },
  Acs: { request: fakeAcsRequest },
  Ext: {
    apply: (base, extra) => Object.assign({}, base, extra),
    encode: (value) => JSON.stringify(value),
  },
  ol: { proj: { fromLonLat: (coords) => coords } },
};

vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(source, sandbox, { filename: "probe-mt-aperturas.js" });

const probe = sandbox.window.__gnatProbe;
assert.ok(probe, "script must expose window.__gnatProbe");

/** vm objects live in another realm; normalise before structural comparison. */
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- environment detection --------------------------------------------------
assert.deepEqual(plain(probe.env()), {
  frame: "same-frame",
  hasWebMap: true,
  hasMap: true,
  hasAcs: true,
  hasExt: true,
  zoom: 15,
});

// --- the probe run ----------------------------------------------------------
const report = await probe.run(["F51757"]);

assert.equal(report.errors.length, 0, `probe reported errors: ${JSON.stringify(report.errors)}`);
assert.equal(report.cases.length, 1);

const poleCase = report.cases[0];
const summary = poleCase.summary;

assert.equal(poleCase.resolved.objectId, POLE_ID);
assert.deepEqual(plain(poleCase.resolved.lonlat), { lon: -72.812867652, lat: -37.912094564 });

// U1: MT spans expose endpoint codes and have LineString geometry.
assert.equal(summary.spansFound, 2, "both MT spans must be classified as spans");
assert.equal(summary.everySpanDisplayParses, true);
assert.deepEqual(plain(summary.spanDisplays[0].variants["space-hyphen-space"]), ["F51757", "F51800"]);
assert.equal(summary.lineStringsReturned, 2);
assert.equal(summary.twoVertexLineStrings, 2, "each MT span must come back as a 2-vertex LineString");
assert.deepEqual(plain(summary.spanTypes), ["Tramo Aéreo MT"]);

// U2: the switching device is visible on the pole and its state is readable.
assert.equal(summary.devicesFound, 1);
assert.deepEqual(plain(summary.deviceTypes), ["Interruptor seccionador (DBC)"]);
assert.equal(summary.hasStateEvidence, true);

const evidenceSources = summary.stateEvidence.map((item) => item.source).sort();
assert.deepEqual(plain(evidenceSources), ["dms_section_23", "widget_content"]);

// The pole itself must not be mistaken for a device.
assert.equal(poleCase.pointQuery.objects.filter((item) => item.isDevice).length, 1);

// --- verdict ----------------------------------------------------------------
assert.deepEqual(plain(report.verdict), {
  u1_mtSpansExposeEndpointCodes: true,
  u1_spansHaveLineStringGeometry: true,
  u2_devicesAreVisibleOnPole: true,
  u2_deviceStateIsReadable: true,
  everySpanDisplayParses: true,
});

// --- read-only guarantees ---------------------------------------------------
const calledUrls = [...new Set(requests.map((entry) => entry.url))].sort();
assert.deepEqual(calledUrls, [
  "Web/component/svc_object_view.php",
  "elec_addons_cm_object_data_section.php",
  "svc_wmc.php",
]);

const calledWmcActions = [...new Set(requests.filter((r) => r.url === "svc_wmc.php").map((r) => r.action))].sort();
assert.deepEqual(calledWmcActions, ["get_objects_geojson", "get_objects_info_for_point", "textual_search"]);

// Every request must carry the live viewport params merged in.
for (const entry of requests.filter((r) => r.url === "svc_wmc.php")) {
  assert.equal(entry.params.scale, 1000, "viewport params must be merged into wmc requests");
}

// --- report shape -----------------------------------------------------------
const serialized = probe.json();
assert.ok(serialized.length > 1000);
assert.equal(JSON.parse(serialized).verdict.u1_spansHaveLineStringGeometry, true);

console.log("probe.selftest: OK — probe pipeline verified against a stubbed GNAT window");
