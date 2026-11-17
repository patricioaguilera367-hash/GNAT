# GNAT probe — MT spans and switching devices

Read-only contract probe that closes the two unknowns blocking the **Zona
Desconectada** engine. Nothing is written to GNAT, to the map data, or to disk.

## Why this exists

Everything the engine needs is already available for low-voltage / public-lighting
spans (`Tramo Aéreo AP` / `BT`):

- `get_objects_info_for_point` returns spans whose `display` is `"<POLO_A> - <POLO_B>"`,
  i.e. the two neighbour pole codes, plus the numeric span `id`;
- `get_objects_geojson` returns their `LineString`.

Two things were **never** verified, and both are prerequisites for walking the
medium-voltage network:

| # | Unknown | Why it blocks |
|---|---|---|
| U1 | Do **MT** spans (`Tramo Aéreo MT`) expose the same `"A - B"` endpoint codes, and do they come back as `LineString`? | Without endpoint codes there is no graph to walk; without geometry there is nothing to paint. |
| U2 | Which objects are the switching devices (`DBC`, `DF`, `DC`, `Reconectador`, `Pole Top`), and is there **any** endpoint that exposes their open/closed state? | A boundary you cannot read is a work-zone boundary you cannot justify. |

## How to run

1. Open the GNAT / Centrality map in Chrome and load the area you care about
   (the probe moves the view to each pole at zoom 18 and restores it afterwards;
   `get_objects_info_for_point` is scale dependent, so this is required).
2. Open DevTools → **Console** on the frame that owns the map (top frame is
   fine: the script resolves `iframe#content` itself).
3. Paste the whole content of `probe-mt-aperturas.js` and press Enter.
4. Run it:

```js
await __gnatProbe.run()                  // default: F51757
await __gnatProbe.run(["F517570"])       // codes you have at hand
await __gnatProbe.run([9446883])         // numeric object ids, skipping the search
```

5. Copy the digest and send it back:

```js
__gnatProbe.copySummary()                // verdict + per-case answers (small)
__gnatProbe.summaryJson()                // same, printed
__gnatProbe.copy()                       // full report, only when debugging
__gnatProbe.json()                       // full report, printed
```

`copySummary()` is the default round trip: it keeps `verdict`, `resolved`,
`geometryAttempts`, the target plan and every case `summary` (span displays,
device types, state evidence), and drops only the bulk — raw widget text and
per-feature geometry — which is what `copy()` is for.

Useful while troubleshooting:

```js
__gnatProbe.env()        // confirms you are in the right frame
__gnatProbe.report       // live report object
```

## Codes are prefixes, not exact matches

`textual_search` matches a **prefix**, so asking for `F51757` returns the
substation `F51757 (Subestación MT/BT)` *plus* every pole in that family
(`F517570`–`F517577`) and the devices mounted on them. The probe reports the full
classification in `targetPlan.classified`, skips substations (they have no Point
geometry) and moves on to the first pole-like candidate. If you want a specific
pole, pass its full code or its numeric id.

Every candidate is also reported with `exactPrefix`, so a prefix hit is never
silently treated as an exact one.

## What it does, step by step

For each code:

1. **Resolve** — `textual_search` with round-trip variants (`F51757` → `51757` →
   `FF51757`), keeping all candidates.
2. **Locate** — `get_objects_geojson` on the candidate ids to obtain the official
   point coordinate. Fall back to `pin_location` when an object has no geometry.
3. **Inventory the pole** — `get_objects_info_for_point` at that coordinate, then
   classify every returned object as span / device / node / pole.
4. **Vectorise spans** — `get_objects_geojson` on every span id, recording
   geometry type, vertex count, first/last vertex and bbox. A 2-vertex
   `LineString` per span is what the engine needs.
5. **Inspect devices** — `get_object_definition` for each switching device, then
   `get_widget_content` only for state-relevant widgets (bounded to 8).
6. **Read DMS section 23** — `elec_addons_cm_object_data_section.php`
   (`networking_electrical`) is **HTML, not JSON**. `Acs.request` dies decoding it
   and only the error message carries the payload, so the probe reads it as text
   over a same-origin GET and falls back to salvaging the HTML out of the `Acs`
   error. It extracts `Estado operativo`, `Tensión del circuito`, `Circuito`, the
   per-phase `Real`/`Normal` blocks (the real one with the timestamp it started),
   the `Vecinos` table and the `net_model_id` mapping (`2` Normal, `3` Real).

Remote HTML is always converted to **inert text**; the probe never assigns it to
`innerHTML` and never executes remote JS or widget actions.

### Why `Vecinos` matters more than the span display

For a switching device, `Vecinos` lists `Borne #1` and `Borne #2` with their own
ids — the **terminals**, not the neighbouring poles. So the electrical graph is a
walk over terminals (`object → Vecinos → sibling borne → object`), not over
pole-to-pole hops parsed out of a span name. The probe reports both, because the
pole-to-pole shape is only confirmed for AP/BT spans.

### Probing a span, not a pole

`get_objects_info_for_point` on an MT pole returns the pole and its guy wires
(`Tirante de M.T. rural …`), not spans: a span is the line **between** poles.
Centre the map on the line and sample that coordinate instead:

```js
__gnatProbe.probeCenter()                                  // current map centre
await __gnatProbe.probeAt({ lon: -72.09, lat: -38.73 })     // explicit coordinate
```

Each call appends a case to the report, so `copySummary()` picks it up. This is
the shortest path to answering U1.

## U1 answered: a span is a `Cable` and its `type` is a conductor

Sampling the middle of an MT line returns, for one pole pair:

```json
{ "id": 477763812, "type": "Alambre Cu Duro Des 6 AWG 1-fas MT",
  "display": "F562540 - F562541",
  "title": "Detalle de Cable F562540 - F562541" }
```

So the two endpoint codes **are** exposed, in `display`, exactly as for AP/BT. What
is not exposed is the word "cable" in `type`: that field carries the conductor
material. The class only appears in the ficha title, which is why the probe now
reads `get_object_definition` for the objects at a point and classifies with
`title` as well as `type`/`display`.

Two consequences worth remembering:

- **Stacked circuits.** That same point returned an `Alambre … 1-fas MT` and an
  `Alambre … 1-fas BT` over the same pole pair. Every span carries its voltage
  level, and the summary counts them separately in `spansByVoltage`.
- **A pole is the wrong sample point.** At `F517570` the point query returns the
  pole and its guy wires. Spans live on the line between poles.

## Field findings that shaped versions 1.1.0 to 1.6.0

The first real run of code `F51757` produced no point query and two defects,
both now pinned by the self-test:

| Symptom | Cause | Fix |
|---|---|---|
| `"JSON value is not numeric"` | Object ids were sent as strings; GNAT requires JSON integers | Ids are normalised to numbers and an unusable id is reported, never silently coerced |
| Probe gave up on the first candidate | `F51757` is a *Subestación MT/BT* with `geometry: null`, and the probe stopped there | Candidates are ordered (poles first, substations and devices excluded) and the walk continues until one yields a Point |

The same run also showed that `textual_search` already returns the switching
devices with their own codes (`F517572 (Desconectador Fusible Empresa)`,
`F517573 [F59840] (Desconectador Fusible Empresa)`), so version 1.1.0 probes those
too: geometry, ficha and DMS section 23 for each.

Version 1.2.0 added `copySummary()` (the full report is ~40 KB of JSON for one
code) and fixed a third defect the self-test caught: devices probed *on the pole*
kept their ficha but were dropped from the state-evidence collection, so a pole
with a mounted switch would have reported `hasStateEvidence: false`.

Version 1.3.0 comes from the second field run (`F517570`, `F517572`), which
answered U2 and exposed three more defects:

| Symptom | Cause | Fix |
|---|---|---|
| Section 23 content never reached the report | The endpoint answers HTML and `Acs.request` fails while JSON-decoding it | Read it as text over `fetch`; salvage the HTML from the `Acs` error message when that is not available |
| `copySummary()` and `copy()` failed | `NotAllowedError: Document is not focused` | Hidden `textarea` + `execCommand`, then `console.log`, then `__gnatProbe.lastPayload` |
| `pointFound: true` with `spans: 0` and no explanation | The report counted spans but never listed what the point actually returned | `spanDiagnosis` carries the object count, the type histogram and a sample |

The self-test also caught a fourth: `Jerarquía de red` repeats the `Real` and
`Normal` headings below `Comportamiento de red por fase`, so a naive parser reset
the phase block it had just filled and every phase came back `null`.

Version 1.4.0 comes from the third run, which finally read `spanDiagnosis`:

| Finding | Cause | Fix |
|---|---|---|
| A pole point returns no spans | The point is the pole, and a span is the line between poles | `probeAt` / `probeCenter` sample a bare coordinate, which is where a span lives |
| `hasStateEvidence: true` on a pole with no state | The section answered, so it counted as evidence even when empty | Evidence now requires an operating state, a phase value or at least one neighbour |
| `Type checking failed for value 'widget_ids'` | The raw array is rejected; GNAT wants an encoded value | Sent through `Ext.encode`, and the self-test fails if a raw array is passed |

## Report shape

```jsonc
{
  "probeVersion": "1.6.0",
  "viewport": { "projection": "EPSG:3857", "zoom": 16, "usesViewportParams": true },
  "cases": [{ "code": "F51757", "resolved": {}, "pointQuery": {}, "spanGeometries": {}, "devices": [], "electricalSection": {}, "summary": {} }],
  "verdict": {
    "u1_mtSpansExposeEndpointCodes": false,
    "u1_spansHaveLineStringGeometry": false,
    "u2_devicesAreVisibleOnPole": false,
    "u2_deviceStateIsReadable": false,
    "everySpanDisplayParses": false
  },
  "errors": []
}
```

`verdict` is the answer to U1/U2. `errors` lists any step that failed without
aborting the run — a failed step is not an answered question.

## Offline self-test

The whole pipeline runs against a stubbed GNAT window, so the script can be
verified without a live session:

```bash
node tools/gnat-probe/probe.selftest.mjs
```

The fixtures reproduce only shapes already observed in the context transcripts.
The test also asserts the read-only guarantees: exactly three URLs are called,
only `textual_search` / `get_objects_geojson` / `get_objects_info_for_point` on
`svc_wmc.php`, and every one of them carries the live viewport parameters.
