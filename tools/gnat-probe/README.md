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

5. Copy the report and send it back:

```js
__gnatProbe.copy()                       // to clipboard
__gnatProbe.json()                       // or paste from the console
```

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
   (`networking_electrical`): `Vecinos` and `Comportamiento de red por fase`.
   These are the only known candidates for device state, so the probe reports the
   inert text and the state-bearing lines verbatim instead of guessing.

Remote HTML is always converted to **inert text**; the probe never assigns it to
`innerHTML` and never executes remote JS or widget actions.

## Field findings that shaped version 1.1.0

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

## Report shape

```jsonc
{
  "probeVersion": "1.1.0",
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
