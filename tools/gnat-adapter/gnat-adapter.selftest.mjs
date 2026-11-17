import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const zone = require("./gnat-adapter.js");

const P1 = { lon: -72.094406189, lat: -38.739195167 }; // F517570
const P2 = { lon: -72.096025017, lat: -38.738362926 }; // F517572
const DEVICE_ID = 9446883;

const SPANS_AT_P1 = [
  { id: 4706891, display: "F517569 - F517570", type: "Alambre Cu Duro Des 6 AWG 2-fas MT" },
  { id: 5697808, display: "F517570 - F517571", type: "Alambre Cu Duro Des 6 AWG 2-fas MT" },
];

const SPANS_AT_P2 = [
  { id: 5694180, display: "F517571 - F517572", type: "Alambre Cu Duro Des 6 AWG 2-fas MT" },
  { id: 5218044, display: "F517573 - F517572", type: "Alambre Cu Duro Des 6 AWG 1-fas BT" },
  { id: 9446882, display: "F517572", type: "Alambre Cu Duro Des 6 AWG 2-fas MT" },
];

/** Section 23 as GNAT actually renders it, measured live. */
const SECTION_CLOSED = `<div class='section'><div class='h'>Datos</div>
<div class='row'><span>Estado operativo:</span><b>normalmente cerrado (NC)</b></div>
<div class='row'><span>Tensión del circuito:</span><b>13.2 kV</b></div>
<div class='row'><span>Fases:</span><b>Real</b> desde 08/04/2026 18:30:00 -04</div></div>`;

const SECTION_BLANK = `<div class='section'><div class='row'><span>Tensión del circuito:</span><b>13.2 kV</b></div></div>`;

function makeClient(config = {}) {
  const calls = [];
  const client = {
    calls,
    async search(term) {
      calls.push({ op: "search", term });
      if (term === "F517570") return [{ object_id: 9446884, surrogate_in_map_id: 9446884, display: "F517570 (Postes c.a. 10 m)" }];
      if (term === "F517572") {
        return [
          { object_id: 4989672, surrogate_in_map_id: 4989672, display: "F517572 (Postes c.a. 11.5 m)" },
          { object_id: DEVICE_ID, surrogate_in_map_id: DEVICE_ID, display: "F517572 (Desconectador Fusible Empresa)" },
        ];
      }
      return [];
    },
    async geojson(ids) {
      calls.push({ op: "geojson", ids });
      const id = ids[0];
      const point = id === 9446884 ? P1 : id === 4989672 || id === DEVICE_ID ? P2 : null;
      if (!point) return { type: "Feature", geometry: null, id };
      return {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "Point", coordinates: [point.lon, point.lat] }, id }],
      };
    },
    async pointObjects(lon, lat) {
      calls.push({ op: "point", lon, lat });
      // The two poles are ~180 m apart while a ring reaches 12 m, so classify by
      // nearest centre: a fixed tolerance would fold both poles into one.
      const toP1 = Math.abs(lon - P1.lon) + Math.abs(lat - P1.lat);
      const toP2 = Math.abs(lon - P2.lon) + Math.abs(lat - P2.lat);
      if (toP1 < toP2) return config.poleOneObjects || SPANS_AT_P1;
      return config.poleTwoObjects || [...SPANS_AT_P2, { id: DEVICE_ID, display: "F517572", type: "" }];
    },
    async objectTitle(id) {
      calls.push({ op: "title", id });
      if (id === DEVICE_ID) return "Desconectador Fusible Empresa";
      return `Detalle de Cable ${id}`;
    },
    async sectionHtml(id, sectionId) {
      calls.push({ op: "section", id, sectionId });
      return config.sectionHtml === undefined ? SECTION_CLOSED : config.sectionHtml;
    },
  };
  return client;
}

// --- one pole: the zone is defined, but nothing isolates it yet --------------
{
  const client = makeClient();
  const result = await zone.findWorkZone({ poleCodes: ["F517570"], client });

  assert.equal(result.status, "parcial");
  assert.equal(result.reason, "sin aparato de maniobra adyacente: la zona no queda delimitada por maniobra");
  assert.equal(result.zone.edges.length, 2);
  assert.deepEqual(
    result.zone.edges.map((edge) => `${edge.from}-${edge.to}`),
    ["F517569-F517570", "F517570-F517571"]
  );
  assert.deepEqual(result.zone.voltages, ["mt"]);
  assert.equal(result.boundary.length, 0);
  assert.equal(result.budget.requests, 1 + 1 + 6, "one search, one geometry, six ring samples at 5 m");
}

// --- two poles: the switch at F517572 closes the zone ------------------------
{
  const client = makeClient();
  const result = await zone.findWorkZone({ poleCodes: ["F517570", "F517572"], client });

  assert.equal(result.status, "delimitada");
  assert.equal(result.zone.edges.length, 4, "the single-code pseudo span is not an edge");
  assert.deepEqual(result.zone.voltages.sort(), ["bt", "mt"], "MT and BT never merge");
  assert.equal(result.boundary.length, 1);
  assert.equal(result.boundary[0].estado, "cerrado", "S7: a read switch reports its state");
  assert.equal(result.boundary[0].estadoTexto, "normalmente cerrado (NC)");
  assert.equal(result.boundary[0].realDesde, "08/04/2026 18:30:00 -04");
  assert.equal(result.boundary[0].hasRealBlock, true);
  assert.equal(result.boundary[0].title, "Desconectador Fusible Empresa");
}

// --- S7: an unread switch is not a closed switch -----------------------------
{
  const client = makeClient({ sectionHtml: SECTION_BLANK });
  const result = await zone.findWorkZone({ poleCodes: ["F517572"], client });

  assert.equal(result.boundary.length, 1, "the device is still reported");
  assert.equal(result.boundary[0].estado, "desconocido");
  assert.equal(result.boundary[0].estadoTexto, null);
  assert.equal(result.status, "parcial");
  assert.equal(result.reason, "aparatos hallados sin estado legible");
}

// --- S1: the budget wins over completeness ----------------------------------
{
  const client = makeClient();
  const result = await zone.findWorkZone({ poleCodes: ["F517570", "F517572"], client, settings: { maxRequests: 3 } });

  assert.ok(result.budget.requests <= 3, "never spend past the budget");
  assert.equal(result.status, "no concluyente", "a run that measured nothing is not a partial answer");
  assert.match(result.reason, /presupuesto agotado/);
}

// --- a truncated run that did measure stays partial -------------------------
{
  const client = makeClient();
  const result = await zone.findWorkZone({ poleCodes: ["F517570", "F517572"], client, settings: { maxRequests: 14 } });

  assert.ok(result.budget.requests <= 14);
  assert.ok(result.zone.edges.length > 0, "some spans were measured before the cut");
  assert.equal(result.status, "parcial");
  assert.match(result.reason, /presupuesto agotado/);
}

// --- a code nobody owns is reported, never guessed --------------------------
{
  const client = makeClient();
  const result = await zone.findWorkZone({ poleCodes: ["F999999"], client });

  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.unresolved, ["F999999"]);
  assert.equal(result.status, "no concluyente");
  assert.equal(result.reason, "ningún código resolvió a un punto");
}

// --- verify: the operator chooses the openings, the engine checks them ------
const CHAIN = ["PA1001", "PA1002", "PA1003", "PA1004", "PA1005"];
const chainPoint = (index) => ({ lon: -72.1 + index * 0.01, lat: -38.7 });
const SOURCE_OBJECT_ID = 5001;

function makeChainClient(config = {}) {
  return {
    async search(term) {
      if (!CHAIN.includes(term)) return [];
      return [{ object_id: 9000 + CHAIN.indexOf(term), surrogate_in_map_id: 9000 + CHAIN.indexOf(term), display: `${term} (Postes c.a. 11.5 m)` }];
    },
    async geojson(ids) {
      const index = Number(ids[0]) - 9000;
      const point = chainPoint(index);
      return { type: "Feature", geometry: { type: "Point", coordinates: [point.lon, point.lat] }, id: ids[0] };
    },
    async pointObjects(lon, lat) {
      let best = 0;
      for (let i = 1; i < CHAIN.length; i += 1) {
        if (Math.abs(lon - chainPoint(i).lon) < Math.abs(lon - chainPoint(best).lon)) best = i;
      }
      const rows = [];
      if (best > 0) rows.push({ id: 7000 + best, display: `${CHAIN[best - 1]} - ${CHAIN[best]}`, type: "Alambre Cu Duro Des 6 AWG 2-fas MT" });
      if (best < CHAIN.length - 1) rows.push({ id: 7100 + best, display: `${CHAIN[best]} - ${CHAIN[best + 1]}`, type: "Alambre Cu Duro Des 6 AWG 2-fas MT" });
      if (best === 0 && config.withSource) rows.push({ id: SOURCE_OBJECT_ID, display: CHAIN[0], type: "" });
      return rows;
    },
    async objectTitle(id) {
      return id === SOURCE_OBJECT_ID ? "Subestación MT/BT 15 kVA" : `Detalle de Cable ${id}`;
    },
    async sectionHtml() {
      return SECTION_CLOSED;
    },
  };
}

// The chosen openings close the island: nothing else feeds it.
{
  const result = await zone.verifyAperturas({
    workCodes: ["PA1002", "PA1003"],
    openCodes: ["PA1001", "PA1004"],
    client: makeChainClient(),
  });
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.island.sort(), ["PA1002", "PA1003"]);
  assert.deepEqual(result.boundary.sort(), ["PA1001", "PA1004"]);
  assert.equal(result.sources.length, 0);
  assert.equal(result.voltage, "mt");
}

// One opening missing: the island still reaches a source, so it is not dead.
{
  const result = await zone.verifyAperturas({
    workCodes: ["PA1002", "PA1003"],
    openCodes: ["PA1004"],
    client: makeChainClient({ withSource: true }),
    settings: { maxRequests: 200, readSources: true },
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /sigue conectada a Subestación/);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].code, "PA1001");
}

// Opening nothing: the island never meets the switches it claims to rely on.
{
  const result = await zone.verifyAperturas({
    workCodes: ["PA1002"],
    openCodes: [],
    client: makeChainClient(),
    settings: { maxRequests: 200 },
  });
  assert.equal(result.valid, false);
  assert.equal(result.boundary.length, 0);
  assert.match(result.reason, /no se alcanzó ninguna de las aperturas/);
  assert.equal(result.island.length, 5, "the walk covered the whole chain");
}

// S1: an unfinished walk is never a valid opening.
{
  const result = await zone.verifyAperturas({
    workCodes: ["PA1002", "PA1003"],
    openCodes: ["PA1001", "PA1004"],
    client: makeChainClient(),
    settings: { maxRequests: 8 },
  });
  assert.equal(result.valid, false, "incomplete evidence never approves an opening");
  assert.match(result.reason, /presupuesto agotado/);
  assert.ok(result.unresolved.length > 0);
}

// --- a switch cuts a side, not the pole -------------------------------------
// Opening both sides isolates the pole; opening one leaves it fed from the other.
{
  const both = await zone.verifyAperturas({
    workCodes: ["PA1002"],
    openCodes: [{ code: "PA1001", side: "both" }, { code: "PA1003", side: "both" }],
    client: makeChainClient(),
  });
  assert.equal(both.valid, true, both.reason);
  assert.deepEqual(both.opened, ["PA1001", "PA1003"]);
  assert.equal(both.poleStates.find((entry) => entry.code === "PA1001").live, "no");
  assert.match(both.poleStates.find((entry) => entry.code === "PA1001").reason, /aislado/);
}

{
  const oneSide = await zone.verifyAperturas({
    workCodes: ["PA1002"],
    openCodes: [{ code: "PA1001", side: "a" }, { code: "PA1003", side: "b" }],
    client: makeChainClient(),
  });
  const state = oneSide.poleStates.find((entry) => entry.code === "PA1001");
  assert.equal(state.live, "desconocido", "one side still feeds the pole");
  assert.match(state.reason, /lado a/);
  assert.equal(state.role, "apertura");
}

// A pole that is both work and an opening cannot be declared dead.
{
  const result = await zone.verifyAperturas({
    workCodes: ["PA1002"],
    openCodes: ["PA1002"],
    client: makeChainClient(),
  });
  const state = result.poleStates.find((entry) => entry.code === "PA1002");
  assert.equal(state.role, "ambos");
  assert.equal(state.live, "desconocido");
  assert.equal(result.valid, false);
  assert.match(result.reason, /PA1002 \(estado desconocido\)/);
}

// --- shared parsers ---------------------------------------------------------
{
  assert.equal(zone.codeOf("F517572 (Postes c.a. 11.5 m)"), "F517572");
  assert.equal(zone.codeOf("Trintre"), null);
  assert.deepEqual(zone.codePairOf("F562540 - F562541"), ["F562540", "F562541"]);
  assert.equal(zone.codePairOf("Trintre - Colonia Miraflores"), null);
  assert.equal(zone.parseOperatingState(SECTION_CLOSED).estado, "cerrado");
  assert.equal(
    zone.parseOperatingState("<b>Estado operativo:</b> normalmente abierto (NA) <span>Tensión del circuito:</span>").estado,
    "abierto"
  );
  assert.equal(zone.parseOperatingState("").estado, "desconocido");
}

console.log("gnat-adapter.selftest: OK — work zone engine verified against recorded GNAT shapes");
