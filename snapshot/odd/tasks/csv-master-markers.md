# CSV Master Markers

## Objective

Turn the existing KML/KMZ workflow into an editable two-CSV round trip that preserves stable numbering, keeps route points separate from X-shaped openings, and groups them through unique operational block codes.

## Problem and why

The current CSV restore path only reapplies one supervisor block to the same points in the same order. Marker selection also derives array positions from `numero - 1`, so deleting rows or preserving gaps in visible numbering is unsafe. The operator needs to export KML-derived route points, edit their supervisors and block IDs, maintain opening coordinates in a separate table, then import both tables into the map.

## Authorized scope

- Extend `v4.js` and add focused Node tests.
- Preserve KML/KMZ loading as the initial/legacy source.
- Export and import two semicolon CSV files: one for route points and one for openings.
- Do not change Centrality data or add dependencies.

## Constraints

- CSV delimiter: semicolon; decimal comma and decimal point must both import.
- Coordinates: EPSG:4326 longitude and latitude.
- Route-point schema: `ID;Numero;Subestacion;Longitud;Latitud;SupervisorColor;BloqueID`.
- Opening schema: `ID;Numero;Codigo;Longitud;Latitud;SupervisorColor;Bloques`.
- Marker `ID` and visible `Numero` are separate and stable; openings render as an X with the same base dimensions as points.
- `SupervisorColor`: existing Verde, Naranjo, Azul and Sin asignar values.
- Each route point has at most one `BloqueID`; openings may reference multiple unique block IDs separated by `|`.
- Visible numbering never auto-compacts after deletion.
- Labels expose number and code independently.

## TDD

- Mode: enabled.
- Source: session `Strict TDD Mode: enabled`.
- Runner: `node --test v4.test.js`.
- Required cycle: observe RED before production changes, then GREEN, then refactor while green.

## Delivery

- Strategy: local implementation only; the user explicitly requested no commits on 2026-10-19, overriding commit and chain handling for this change.
- Forecast: approximately 360 authored changed lines, excluding this recovery document.
- Chain strategy: not applicable.
- Reviewed boundary: branch point `832ba5d9`.
- RDD: disabled/unmanaged; clone-local status command also reports an unsafe Git authority owner and cannot run native review.

## Tasks

- [x] **CSV-1 — Two-table CSV model and round trip**
  - Route: delegated direct.
  - Trigger evidence: preparation reading was delegated; implementation spans non-trivial production and test files.
  - Reopened after the user replaced the approved single-table design with separate route-point and opening tables.
  - Add pure parsing/serialization/normalization behavior for both schemas with stable IDs, explicit numbers, decimal-comma coordinates, supervisor validation and block references.
  - Route import may add, remove, reorder or edit point rows; opening import independently replaces opening rows; blank IDs receive collision-safe generated IDs.
  - Export every loaded field into the appropriate CSV.
  - Acceptance: focused RED/GREEN tests cover both valid round trips, shared openings and rejected duplicate/invalid identity data.
  - Checks: `node --test v4.test.js`; `node --check v4.js`.
  - Commit: skipped by explicit user request.
  - Review outcome: disabled/unmanaged.

- [x] **CSV-2 — Map, filtering, labels and deletion**
  - Route: delegated direct.
  - Trigger evidence: behavioral changes span UI state, OpenLayers styling, atlas rendering and tests.
  - Render openings as X markers at point-marker dimensions.
  - Filter independently by supervisor and operational block, including all markers.
  - Show/hide visible number and code independently.
  - Delete only selected markers without renumbering survivors.
  - Carry both marker types and active labels into atlas output.
  - Acceptance: structural tests cover stable selection identity and X/point SVG/style decisions; manual browser smoke steps are documented if Centrality is unavailable.
  - Checks: `node --test v4.test.js`; `node --check v4.js`.
  - Commit: skipped by explicit user request.
  - Review outcome: disabled/unmanaged.

## Progress and evidence

- 2026-10-19: `doc.kml` inspected read-only: 83 points plus one route line; point coordinates are longitude, latitude, altitude in EPSG:4326.
- 2026-10-19: Feature branch `feat/csv-master-markers` created.
- Engram mirror: pending because multiple active runtime sessions make the project/session binding ambiguous.
- 2026-10-19: The superseded single-table CSV implementation reached GREEN with 6/6 focused tests, but CSV-1 was reopened when the user approved two separate tables instead.
- 2026-10-19: Revised design approved: `recorrido.csv` owns route points and `aperturas.csv` owns X markers and their block references.
- 2026-10-19: Revised CSV-1 observed RED at 0/7, then an additional restoration RED at 7/8, and finished GREEN at 8/8. Independent verification passed; parent spot-check also passed 8/8.
- 2026-10-19: User explicitly requested no commits; delivery-chain handling is disabled for this local change.
- 2026-10-19: CSV-2 observed RED at 8/11, then GREEN at 11/11. A stale-atlas race was found independently, reproduced RED at 12/13 and fixed. Final parent verification passed 13/13 tests plus `node --check v4.js`.
- 2026-10-19: Independent verification passed after one scoped correction. Live Centrality/KMZ/PDF rendering remains a manual smoke check.
- 2026-10-19: Delivery accounting discovered that `Desktop/v4` was entirely untracked at the branch point, so adding `v4.js` makes the first work-unit commit exceed the 400-line delivery budget even though the authored feature change is narrower. Awaiting the required chain-strategy decision before the first commit.

## Next step

Copy and execute the complete `v4.js` in Centrality, then smoke-test KML load, both CSV round trips, X rendering, block filtering and PDF output.
