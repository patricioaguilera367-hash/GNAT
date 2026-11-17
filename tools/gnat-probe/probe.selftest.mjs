/**
 * Offline self-test for `probe-mt-aperturas.js`.
 *
 * Runs the probe against a stubbed GNAT window so the whole pipeline
 * (resolve → geometry → point query → span geometries → device widgets →
 * DMS section 23 → summary) is exercised without touching a real GNAT session.
 *
 * Fixtures reproduce the first real field run of code `F51757`, which found two
 * defects that these assertions now pin:
 *
 *   1. object ids sent as strings are rejected by the backend with
 *      "JSON value is not numeric" — the stub fails the request in that case,
 *      exactly like GNAT;
 *   2. `F51757` is a *Subestación MT/BT* with no Point geometry, so the probe
 *      must fall through to the first pole-like candidate instead of giving up.
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

const SUBESTACION_ID = 4550468;
const POLE_ID = 5207841;
const DBC_ID = 9446883;
const SPAN_MT_1 = 900001;
const SPAN_MT_2 = 900002;

const POLE_LONLAT = [-72.812867652, -37.912094564];

/** Same shape the real `textual_search` returned for `F51757`. */
const SEARCH_CANDIDATES = [
  { object_id: SUBESTACION_ID, surrogate_in_map_id: SUBESTACION_ID, pin_location: null, display: "F51757 (Subestación MT/BT)" },
  {
    object_id: POLE_ID,
    surrogate_in_map_id: POLE_ID,
    pin_location: null,
    display: "F517570 (Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT)",
  },
  { object_id: 5460168, surrogate_in_map_id: 5460168, pin_location: null, display: "F517571 (Postes c.a. 10 m  350 Kg/Rup cte. comun con BT)" },
  { object_id: 4989672, surrogate_in_map_id: 4989672, pin_location: null, display: "F517572 (Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT)" },
  { object_id: DBC_ID, surrogate_in_map_id: DBC_ID, pin_location: null, display: "F517572 (Desconectador Fusible Empresa)" },
  { object_id: 8347637, surrogate_in_map_id: 8347637, pin_location: null, display: "F517573 [F59840] (Eq.protección BT1 Fas.5KVA)" },
  { object_id: 8347676, surrogate_in_map_id: 8347676, pin_location: null, display: "F517573 [F59840] (Desconectador Fusible Empresa)" },
];

const POINT_OBJECTS = [
  { id: SPAN_MT_1, display: "F517570 - F517572", type: "Tramo Aéreo MT", description: "<table><tr><td>Alimentador</td><td>Angol-Los Sauces [S203]</td></tr></table>" },
  { id: SPAN_MT_2, display: "F517570 - F517571", type: "Tramo Aéreo MT", description: "<table><tr><td>Alimentador</td><td>Angol-Los Sauces [S203]</td></tr></table>" },
  { id: 3660863, display: "3660863", type: "Nodo de Baja Tensión", description: "" },
  { id: POLE_ID, display: "F517570", type: "Postes c.a. 11.5 m 350 Kg/Rup cte. comun con BT", description: "<table><tr><td>Voltaje</td><td>400</td></tr></table>" },
];

const requests = [];

/** Fail exactly like GNAT when an id is not a JSON number. */
function assertNumericIds(params) {
  const ids = JSON.parse(params.object_ids);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "number")) {
    throw new Error("JSON value is not numeric");
  }
  return ids;
}

function geoJsonFor(ids) {
  const features = ids.map((id) => {
    if (id === SUBESTACION_ID) {
      // A substation is not a cartographic point: geometry is null.
      return { type: "Feature", geometry: null, id, properties: { display_name: "F51757" } };
    }
    if (id === POLE_ID || id === DBC_ID) {
      // A device is a cartographic point too, just offset from the pole.
      const coords = id === POLE_ID ? POLE_LONLAT : [POLE_LONLAT[0] + 0.0001, POLE_LONLAT[1] + 0.0001];
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: coords },
        id,
        properties: { display_name: id === POLE_ID ? "F517570" : "F517572" },
        bbox: [coords[0], coords[1], coords[0], coords[1]],
      };
    }
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-72.8128, -37.912],
          [-72.813, -37.9125],
        ],
      },
      id,
      properties: { display_name: "F517570 - F517572" },
      bbox: [-72.813, -37.9125, -72.8128, -37.912],
    };
  });
  return features.length === 1 ? features[0] : { type: "FeatureCollection", features };
}

function widgetDefinitionFor(objectId) {
  return {
    title: `Objeto ${objectId}`,
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

function fakeAcsRequest(options) {
  const { url, params, success, failure } = options;
  requests.push({ url, action: params && params.action, params });
  try {
    if (url === "svc_wmc.php") {
      if (params.action === "textual_search") return void success(SEARCH_CANDIDATES);
      if (params.action === "get_objects_geojson") return void success(geoJsonFor(assertNumericIds(params)));
      if (params.action === "get_objects_info_for_point") return void success(POINT_OBJECTS);
      return void failure(new Error(`unexpected wmc action ${params.action}`));
    }
    if (url === "Web/component/svc_object_view.php") {
      if (typeof params.object_id !== "number") throw new Error("object_id must be numeric");
      if (params.action === "get_object_definition") return void success(widgetDefinitionFor(params.object_id));
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
      if (typeof params.object_id !== "number") throw new Error("object_id must be numeric");
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
  getZoom: () => 15.114949744876553,
  getResolution: () => 2.4,
  setCenter: () => {},
  setZoom: () => {},
  setResolution: () => {},
};

const sandbox = {
  console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
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
  zoom: 15.114949744876553,
});

// --- the field run that failed ---------------------------------------------
const report = await probe.run(["F51757"]);

assert.equal(report.errors.length, 0, `probe reported errors: ${JSON.stringify(report.errors)}`);
assert.equal(report.cases.length, 1);

const poleCase = report.cases[0];
const summary = poleCase.summary;

// Bug 2: the substation has no Point, so the probe must move on to a pole.
assert.equal(poleCase.targetPlan.substations.length, 1);
assert.equal(summary.pointFound, true);
assert.equal(poleCase.resolved.objectId, POLE_ID);
assert.deepEqual(plain(poleCase.resolved.lonlat), { lon: POLE_LONLAT[0], lat: POLE_LONLAT[1] });
assert.equal(poleCase.geometryAttempts.length, 1, "only the substation may be skipped before a pole answers");

// Bug 1: every geometry request must carry numeric ids.
const geometryCalls = requests.filter((entry) => entry.action === "get_objects_geojson");
assert.ok(geometryCalls.length > 0);
for (const call of geometryCalls) {
  const ids = JSON.parse(call.params.object_ids);
  assert.ok(Array.isArray(ids), "object_ids must be a JSON array");
  for (const id of ids) assert.equal(typeof id, "number", `id ${JSON.stringify(id)} must be a number`);
}

// U1: MT spans expose endpoint codes and have LineString geometry.
assert.equal(summary.spansFound, 2);
assert.equal(summary.everySpanDisplayParses, true);
assert.deepEqual(plain(summary.spanDisplays[0].variants["space-hyphen-space"]), ["F517570", "F517572"]);
assert.equal(summary.lineStringsReturned, 2);
assert.equal(summary.twoVertexLineStrings, 2);
assert.deepEqual(plain(summary.spanTypes), ["Tramo Aéreo MT"]);

// U2: devices found through the search list are probed and carry state.
assert.equal(summary.devicesOnPole, 0, "this pole has no device mounted on it");
assert.equal(summary.devicesFromSearch, 3);
assert.equal(summary.hasStateEvidence, true);
const evidenceSources = plain(summary.stateEvidence.map((item) => item.source)).sort();
assert.deepEqual(evidenceSources, [
  "device_dms_section_23",
  "device_dms_section_23",
  "device_dms_section_23",
  "dms_section_23",
  "widget_content",
  "widget_content",
  "widget_content",
]);

// The substation must never be mistaken for a pole, a device or a span.
const classifiedSubstation = poleCase.targetPlan.classified.find((entry) => entry.id === SUBESTACION_ID);
assert.equal(classifiedSubstation.isSubstation, true);
assert.equal(classifiedSubstation.isPole, false);
assert.equal(classifiedSubstation.isDevice, false);

// --- verdict ----------------------------------------------------------------
assert.deepEqual(plain(report.verdict), {
  u1_mtSpansExposeEndpointCodes: true,
  u1_spansHaveLineStringGeometry: true,
  u2_devicesAreVisibleOnPole: true,
  u2_deviceStateIsReadable: true,
  everySpanDisplayParses: true,
  anyPointFound: true,
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

for (const entry of requests.filter((r) => r.url === "svc_wmc.php")) {
  assert.equal(entry.params.scale, 1000, "viewport params must be merged into wmc requests");
}

// --- report shape -----------------------------------------------------------
const serialized = probe.json();
assert.ok(serialized.length > 1000);
assert.equal(JSON.parse(serialized).verdict.u1_spansHaveLineStringGeometry, true);

// The digest must keep every decision input while staying small enough to paste.
const digest = probe.summaryJson();
assert.ok(digest.length > 200, "digest must not be empty");
assert.ok(digest.length < serialized.length, "digest must be smaller than the full report");

const digestObject = JSON.parse(digest);
assert.equal(digestObject.verdict.u1_spansHaveLineStringGeometry, true);
assert.equal(digestObject.verdict.anyPointFound, true);
assert.equal(digestObject.cases.length, 1);
assert.equal(digestObject.cases[0].summary.hasStateEvidence, true);
assert.deepEqual(plain(digestObject.cases[0].summary.spanTypes), ["Tramo Aéreo MT"]);
assert.equal(digestObject.cases[0].summary.stateEvidence.length, 7);

// The digest drops the bulk (widget text, per-feature geometry) but not the answers.
assert.ok(!digest.includes("sin cambios"), "digest must not carry raw widget text");
assert.ok(!digest.includes("objectViewRequested"), "digest must not carry request bookkeeping");

// --- direct id probing ------------------------------------------------------
requests.length = 0;
const byId = await probe.run([DBC_ID]);
assert.equal(byId.errors.length, 0, `direct id probe errors: ${JSON.stringify(byId.errors)}`);
assert.equal(byId.cases[0].objectId, DBC_ID);
assert.equal(byId.verdict.anyPointFound, true);
assert.ok(
  requests.every((entry) => !entry.params.object_ids || JSON.parse(entry.params.object_ids).every((id) => typeof id === "number")),
  "direct id probing must also send numeric ids"
);

console.log("probe.selftest: OK — probe pipeline verified against a stubbed GNAT window");
