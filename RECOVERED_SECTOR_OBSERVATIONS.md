# Recovered interrupted sector investigation

**Provenance:** parent-session handoff of inert response and loaded-client observations after the original current ledger. Original raw bodies and full transcript unavailable here. These notes distinguish observed content, candidates and unknown behavior, not independently replayed evidence.

## Electrical consultation candidate

Known DF `28557371`, widget `142`, original loader `/backend/saesa/elec_web_object_view.php`, parameter `object_id`. Metadata reported `scripts:true` and read-write exposition. Widget NOT activated; returned scripts NOT executed.

Parent issued one bounded original `Ext.Ajax` request using the known view endpoint and inspected only `responseText` inertly: HTTP200, length4,086, two script blocks. Headings:

`Circuito`, `Name`, `Salida`, `Tensión`, `Vecinos`, `Id`, `Tipo`, `Business Id`, `Navigation`, `Comportamiento de red por fase`, `Jerarquía de red`, `Real`, `Normal`.

Headings prove neither neighbor rows, graph schema, terminals nor valid states. Static candidate `paint_upstream_flow` in `svc_elec_addons_tm.php` was not executed; read-only semantics NOT established. This catalog is not a replay recipe or operational integration.

Subsequent full-header inspector refused; work stopped. A second body-only request was intentionally user-aborted; execution outcome unknown. Do not blindly repeat. Any follow-up needs source-owner authorization/verified read contract.

## Conditions candidate

Widget `107` client columns included `condition_occurred_at` (event time), `condition_recorded_at` (record time), `reliability`, condition-kind/measurement-related fields. Tab `initialized:false`, zero cached rows: NOT authoritative empty response, current state, quality, freshness or coverage proof.

Future state model must distinguish occurred/recorded time, provenance and confidence. UI column names/uninitialized cache are not state truth.

## Installed assets candidate

Widget `101` proxy candidate `/backend/saesa/AM/component/svc_location.php?action=list_location_assets`, scoped by `location_id`. Client scope verified; no actual row body confirmed. Distinct from confirmed `list_location_parts`; do not merge schemas/allowlists based on similar endpoint.

## Readiness

Enough for consultation design/maps/fiches with limits; NOT rigorous sector/isolation. Graph relations, valid temporal states, quality/freshness/coverage and independent authorization still missing. Geometry, UI hierarchy, host and electrical connection remain separate.

## Observer versus MCP

Standalone Node24: 29 prior offline inspector/contract tests. One two-second startup at exact `9222/json/list` returned non-success HTTP (numeric code not retained), zero records, no attachment. No relaunch/config/port recovery. MCP worked separately; not standalone live compatibility proof.

Omitted bbox/display_name/content/exposition values, dropped HTML, manual-only correlation and unobserved JS exceptions remain gaps. Recovered notes are not standalone inspector output.
