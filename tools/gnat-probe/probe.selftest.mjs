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

let execCommandResult = true;
let clipboardBlocked = false;
const fetchedUrls = [];
const stubState = { acsElecDecodeError: false, pointObjects: null };

/** Ficha titles, which is where GNAT says an object is a cable. */
const CABLE_TITLES = {
  477763812: "Detalle de Cable F562540 - F562541",
  35144088: "Detalle de Cable F562540 - F562541",
  479563245: "Detalle de Polígono de gestión M-265807 (1)",
};

/** The field shape that finally answered U1: a span whose `type` is a conductor. */
const CABLE_OBJECTS = [
  { id: 479563245, display: "M-265807 (1)", type: null, description: "" },
  {
    id: 477763812,
    display: "F562540 - F562541",
    type: "Alambre Cu Duro Des 6 AWG 1-fas MT",
    description: "<table><tr><td>Alimentador</td><td>Angol-Los Sauces [S203]</td></tr></table>",
  },
  { id: 35144088, display: "F562540 - F562541", type: "Alambre Cu Duro Des 6 AWG 1-fas BT", description: "" },
];

/** Section 23 payload for a switching device: the real GNAT shape, trimmed. */
const DEVICE_HTML = [
  '<div class="section">',
  '<div class="subsection"><h1>Circuito</h1><table class="grid"><tbody>',
  '<tr><th>Nombre</th><th class="last">Salida</th></tr>',
  '<tr class="last"><td>Cajón</td><td class="last"><a href="cm_object_data.php?id=203819095">Cajón</a></td></tr>',
  '</tbody></table></div>',
  '<div class="subsection"><h1>Tensión</h1><div style="padding-left: 10px"> Tensión del circuito: <b>13.2 kV</b></div>',
  '<div class="subsection"><a href="javascript:gis_highlight_objects([9446884,9446885], true)">Resaltar todos</a>',
  '<h1>Vecinos</h1><table class="grid"><tbody>',
  '<tr><th>Id</th><th>Tipo</th><th>Id de negocio</th><th class="last">Navegación</th></tr>',
  '<tr><td><a href="cm_object_data.php?id=9446884">Borne #1 de F517572</a></td><td>Borne</td><td>-</td><td class="last"><a href="javascript:gis_center_on_object(9446884)">ir</a></td></tr>',
  '<tr class="alt last"><td><a href="cm_object_data.php?id=9446885">Borne #2 de F517572</a></td><td>Borne</td><td>-</td><td class="last"><a href="javascript:gis_center_on_object(9446885)">ir</a></td></tr>',
  '</tbody></table></div>',
  '<div class="subsection"><span>Estado operativo: normalmente cerrado (NC)</span></div>',
  '<div class="subsection"><h1>Comportamiento de red por fase</h1><ul style="padding-left: 10px">',
  '<li><b>Real</b>&nbsp;<i>(desde 08/04/2026 18:30:00 -04)</i></li>',
  '<ul style="padding-left: 10px"><li>R: cerrado</li><li>S: cerrado</li><li>T: cerrado</li></ul>',
  '<li><b>Normal</b></li>',
  '<ul style="padding-left: 10px"><li>R: cerrado</li><li>S: cerrado</li><li>T: cerrado</li></ul></ul></div>',
  '<div class="subsection"><h1>Jerarquía de red</h1><h2>Real</h2><div id="div-model-3"></div>',
  '<script>Ext.widget("container", { items: [{ xtype: "button", handler: function () { Acs.request({ url: "svc_elec_addons_tm.php", params: { action: "paint_upstream_flow", start_node_id: 9446883, net_model_id: 3 } }); } }] });</script></div>',
  '<div class="subsection"><h2>Normal</h2><div id="div-model-2"></div>',
  '<script>Ext.widget("container", { items: [{ xtype: "button", handler: function () { Acs.request({ url: "svc_elec_addons_tm.php", params: { action: "paint_upstream_flow", start_node_id: 9446883, net_model_id: 2 } }); } }] });</script></div>',
  '<div class="subsection"><a href="elec_addons_cm_object_data_section.php?object_id=9446883&list_operations=1">Ver operaciones</a></div>',
  '</div>',
].join("");

/** Section 23 payload for a pole: no phases, no vecinos. */
const POLE_HTML = [
  '<div class="section">',
  '<div class="subsection"><h1>Comportamiento de red por fase</h1><ul style="padding-left: 10px"></ul></div>',
  '<div class="subsection"><h1>Jerarquía de red</h1><h2>Real</h2><div>Cajón [S223]</div></div>',
  '</div>',
].join("");

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
    title: CABLE_TITLES[objectId] || `Objeto ${objectId}`,
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
      if (params.action === "get_objects_info_for_point") return void success(stubState.pointObjects || POINT_OBJECTS);
      return void failure(new Error(`unexpected wmc action ${params.action}`));
    }
    if (url === "Web/component/svc_object_view.php") {
      if (typeof params.object_id !== "number") throw new Error("object_id must be numeric");
      if (params.action === "get_object_definition") return void success(widgetDefinitionFor(params.object_id));
      if (params.action === "get_widget_content") {
        // GNAT rejects a raw array here: `widget_ids` must be an encoded string.
        if (typeof params.widget_ids !== "string") throw new Error("widget_ids must be an encoded JSON string");
        const widgetIds = JSON.parse(params.widget_ids);
        return void success(
          widgetIds.map((widgetId) => ({
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
      if (stubState.acsElecDecodeError) {
        // Faithful to GNAT: the HTML comes back and Acs dies decoding it.
        return void failure(new Error("You're trying to decode an invalid JSON String: " + DEVICE_HTML));
      }
      return void success(DEVICE_HTML);
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
  document: {
    querySelector: () => null,
    createElement: () => ({ value: "", style: {}, setAttribute: () => {}, select: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => execCommandResult,
  },
  navigator: {
    clipboard: {
      writeText: async () => {
        if (clipboardBlocked) {
          const error = new Error("Failed to execute 'writeText' on 'Clipboard': Document is not focused.");
          error.name = "NotAllowedError";
          throw error;
        }
      },
    },
  },
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
  ol: { proj: { fromLonLat: (coords) => coords, toLonLat: (coords) => coords } },
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

// --- S1/S2/S3/S4: section 23 is HTML, so it is read as text over fetch ------
sandbox.fetch = async (url) => {
  fetchedUrls.push(url);
  const match = String(url).match(/object_id=(\d+)/);
  const objectId = match ? Number(match[1]) : null;
  const body = objectId === POLE_ID || objectId === SUBESTACION_ID ? POLE_HTML : DEVICE_HTML;
  return { ok: true, status: 200, text: async () => body };
};

const htmlRun = await probe.run(["F517572"]);
assert.equal(htmlRun.errors.length, 0, `fetch run reported errors: ${JSON.stringify(htmlRun.errors)}`);

const htmlCase = htmlRun.cases[0];
assert.equal(htmlCase.electricalSection.via, "fetch", "section 23 must be read over fetch, not Acs");
assert.ok(fetchedUrls.length >= 4, `expected one fetch per section, got ${fetchedUrls.length}`);
for (const url of fetchedUrls) {
  assert.ok(url.startsWith("elec_addons_cm_object_data_section.php?"), `unexpected fetch url ${url}`);
  assert.ok(url.includes("section_id=23"), `section id missing from ${url}`);
}

const sectionSummary = htmlCase.summary;
assert.equal(sectionSummary.sections.length, 4, "one pole section plus three device sections");

const deviceSection = sectionSummary.sections.find((entry) => entry.objectId !== POLE_ID && entry.estadoOperativo);
assert.ok(deviceSection, "a device section must expose its operating state");

// S2
assert.equal(deviceSection.estadoOperativo, "normalmente cerrado (NC)");
assert.equal(deviceSection.tensionCircuito, "13.2 kV");
assert.deepEqual(plain(deviceSection.circuito), { id: 203819095, nombre: "Cajón" });
assert.deepEqual(plain(deviceSection.phases), {
  real: { R: "cerrado", S: "cerrado", T: "cerrado", desde: "desde 08/04/2026 18:30:00 -04" },
  normal: { R: "cerrado", S: "cerrado", T: "cerrado" },
});

// S3: the electrical graph vertices are terminals, not poles.
assert.deepEqual(plain(deviceSection.vecinos), [
  { id: 9446884, etiqueta: "Borne #1 de F517572", tipo: "Borne", idNegocio: "-" },
  { id: 9446885, etiqueta: "Borne #2 de F517572", tipo: "Borne", idNegocio: "-" },
]);
assert.deepEqual(plain(deviceSection.neighborIds), [9446884, 9446885]);

// S4
assert.deepEqual(plain(deviceSection.netModels), [
  { id: 3, nombre: "Real" },
  { id: 2, nombre: "Normal" },
]);

// S5: the evidence reaches the digest.
assert.equal(sectionSummary.hasStateEvidence, true);
assert.equal(plain(sectionSummary.conclusions).u2_sectionStateReadable, true);
const sectionEvidence = sectionSummary.stateEvidence.filter((entry) => entry.source === "device_dms_section_23");
assert.equal(sectionEvidence.length, 3);

// A section that answers with nothing must not read as state evidence.
assert.equal(
  sectionSummary.stateEvidence.filter((entry) => entry.source === "dms_section_23").length,
  0,
  "an empty pole section must not be counted as readable state"
);
assert.equal(sectionSummary.sections.filter((entry) => !entry.estadoOperativo && !entry.phases.real).length, 1);

// S7: a point with spans must say so instead of only counting.
assert.equal(sectionSummary.spanDiagnosis.objectsReturned, 4);
assert.equal(plain(sectionSummary.spanDiagnosis.typeCounts)["Tramo Aéreo MT"], 2);
assert.equal(sectionSummary.spanDiagnosis.objectsSample.length, 4);
assert.equal(sectionSummary.spanDiagnosis.note, "spans classified");

// --- S1 fallback: the payload survives an Acs decode failure --------------
stubState.acsElecDecodeError = true;
sandbox.fetch = undefined;

const salvageRun = await probe.run([DBC_ID]);
const salvageSection = salvageRun.cases[0].electricalSection;
assert.equal(salvageSection.via, "acs-salvage", "the HTML must be salvaged from the Acs error message");
assert.equal(salvageSection.parsed.estadoOperativo, "normalmente cerrado (NC)");
assert.deepEqual(plain(salvageSection.parsed.neighborIds), [9446884, 9446885]);

// --- probeAt: inventory a bare coordinate, e.g. the middle of a span -------
const atCase = await probe.probeAt({ lon: -72.1, lat: -38.7 }, "mid-span");
assert.equal(atCase.summary.pointFound, true);
assert.equal(atCase.summary.spansFound, 2, "the sample point must expose its spans");
assert.equal(atCase.summary.lineStringsReturned, 2);
assert.equal(atCase.summary.spanDiagnosis.note, "spans classified");
assert.equal(atCase.summary.spanDiagnosis.objectTitles.length, 4, "GNAT's own class must be read for each object");
for (const entry of atCase.summary.spanDiagnosis.objectTitles) {
  assert.equal(typeof entry.title, "string");
  assert.ok(entry.title.startsWith("Objeto "), `unexpected title ${entry.title}`);
  assert.equal(typeof entry.classifiedAsSpan, "boolean");
}
assert.ok(
  probe.report.cases.some((entry) => entry.code === "mid-span"),
  "a coordinate probe must land in the report"
);

const centreCase = await probe.probeCenter("centre");
assert.equal(plain(centreCase.resolved).geometryType, "coordinate");
assert.equal(centreCase.code, "centre");

// --- the shape that answered U1: a span whose type is a conductor ----------
stubState.pointObjects = CABLE_OBJECTS;
const cableCase = await probe.probeAt({ lon: -72.8530195, lat: -37.8865012 }, "cable-mt-bt");

assert.equal(cableCase.summary.spansFound, 2, "both stacked cables must be classified as spans");
assert.deepEqual(plain(cableCase.summary.spanDisplays[0].variants["space-hyphen-space"]), ["F562540", "F562541"]);
assert.deepEqual(plain(cableCase.summary.spansByVoltage), { mt: 1, bt: 1, unknown: 0 });
assert.equal(cableCase.summary.lineStringsReturned, 2, "each span id must resolve to a line");
assert.equal(cableCase.summary.twoVertexLineStrings, 2);

const cableTitles = cableCase.summary.spanDiagnosis.objectTitles;
assert.equal(cableTitles[0].classifiedAsSpan, false, "a management polygon is not a span");
assert.equal(cableTitles[1].title, "Detalle de Cable F562540 - F562541");
assert.equal(cableTitles[1].classifiedAsSpan, true);
assert.equal(cableTitles[1].spanVoltage, "mt");
assert.equal(cableTitles[2].spanVoltage, "bt");
stubState.pointObjects = null;

// --- S3: the ring around a pole finds its conductors -----------------------
stubState.pointObjects = CABLE_OBJECTS;
const ringCase = await probe.probeAround({ lon: -72.853, lat: -37.8865 }, { samples: 8, radiusMeters: 20 });

assert.equal(ringCase.samples, 8, "every bearing must be sampled within the budget");
assert.ok(ringCase.requests <= 12);
assert.equal(ringCase.summary.objectsReturned, 3, "eight samples of the same point must dedupe to three objects");
assert.equal(ringCase.sampleReports[1].freshObjects, 0, "a repeated object must not be counted twice");
assert.equal(ringCase.summary.spansFound, 2);
assert.deepEqual(plain(ringCase.summary.spansByVoltage), { mt: 1, bt: 1, unknown: 0 });
assert.deepEqual(plain(ringCase.edges), [
  { id: 477763812, voltage: "mt", from: "F562540", to: "F562541" },
  { id: 35144088, voltage: "bt", from: "F562540", to: "F562541" },
]);
assert.equal(ringCase.summary.spanDiagnosis.note, "spans classified");
assert.ok(
  probe.report.cases.some((entry) => entry.code.startsWith("ring@")),
  "a ring probe must land in the report"
);
stubState.pointObjects = null;

// --- S6: copying survives an unfocused console ----------------------------
clipboardBlocked = true;
execCommandResult = true;
assert.equal(await probe.copy(), true, "the textarea fallback must copy when the async API is blocked");
assert.equal(typeof probe.lastPayload, "string");
assert.ok(probe.lastPayload.includes("probeVersion"));

execCommandResult = false;
const logged = [];
const realLog = sandbox.console.log;
sandbox.console.log = (...args) => logged.push(args);
assert.equal(await probe.copySummary(), false, "a fully blocked clipboard must report failure, not throw");
sandbox.console.log = realLog;
assert.equal(logged.length, 1, "the digest must reach the console when nothing else works");
assert.ok(String(logged[0][0]).includes("verdict"));
assert.equal(typeof probe.lastPayload, "string");

console.log("probe.selftest: OK — probe pipeline verified against a stubbed GNAT window");
