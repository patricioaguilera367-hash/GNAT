# Code and knowledge map

**Current implementation root: `GNAT_Extension/`.** Reuse it for future requested features.

| Current path | Role |
| --- | --- |
| `GNAT_Extension/manifest.json` | MV3 V8 8.0.0, `activeTab` and `scripting`, action and worker. |
| `GNAT_Extension/background.js` | User-click launcher; checks same-origin host map, injects MAIN-world V8 or reopens an existing editor. |
| `GNAT_Extension/centrality_v8.js` | Current map panel, local work points, blocks, linked opening IDs, CSV/project interchange, sheet editor and atlas/PDF. Host-dependent, not standalone. |
| `GNAT_Extension/LEEME.txt` | Preserved original Spanish installation/usage instructions. |
| `tests/extension-publication.test.cjs` | Offline source identity/manifest/syntax and CSV helper checks only. |

## Historical reference map

Use `snapshot/` only as the original historical project root when running its existing tests; its imports and document links retain original relationships. This locator map does not mean every documented design is implemented.

| Path under snapshot | Role and boundary |
| --- | --- |
| `v6.txt` | Historical user-designated host-dependent V6 base, unchanged; superseded as active base by V8. |
| `v4.js`, `v4.test.js` | Historical V4 and its CSV tests, NOT V6 coverage. |
| `legacy/Global_V4_1_referencia.js`, `legacy/Buscador_V2_referencia.txt` | Earlier references, not automatically active base. |
| `INICIAR.bat`, `iniciar.py` | Existing Windows/Python launcher; see original README. |
| `app/config.py`, `app/server.py` | Local configuration/HTTP app; preserve loopback/origin constraints. |
| `app/db.py`, `app/importers.py`, `app/captures.py` | SQLite, CSV/KML/KMZ import, local captures; no real data included. |
| `app/integrations/gnat.py` | Disconnected and explicit MOCK adapters, normalization, geometry validation, text-only metadata. No corporate transport. |
| `web/index.html`, `web/app.js`, `web/map.js`, `web/styles.css` | Local UI/map/styles; OSM starts off. |
| `web/gnat-client.js` | Optional MOCK panel; remote-query button stays disabled. |
| `bridge/diagnostico_contrato_gnat.js` and `.txt` | Original manual observer pair, not permission to execute. |
| `bridge/exportar_vista_centrality.js` | Visible-view export snippet; retention/CORS permission still required. |
| `tests/` | Python functional and JavaScript DOM/map/diagnostic tests. |
| `examples/`, `datos/.keep` | Demo CSVs and empty-directory marker; no real DB/captures. |
| `docs/`, root `README.md` | Original context, architecture, changes and contract. |
| `GNAT_BUSQUEDA.md`, `GNAT_SELECCION_FICHAS.md`, `GNAT_TOPOLOGIA.md` | Historical investigations/topology limits; current ledger governs covered updates. |
| `gnat-research/*.md` | Current ledger/coverage/endpoints/widgets/flows/model/proposals/pending work. |
| `gnat-research/inspector/core.cjs`, `cli.cjs` | Passive Node observer, offline verified; live attachment failed. |
| `gnat-research/tests/`, `fixtures/` | Tests and transformed observed partial catalog separate from synthetic fixture. |
| `odd/tasks/` | Three historical records, not active handoff status or receipts. |

## Separation to preserve

Keep adapter/authentication separate from geometry rendering, user work-point identity, evidence persistence and any future topology graph. Preserve `object_id`, map surrogate, returned Feature ID, terminal ID and circuit ID as independent roles unless explicitly linked by source evidence. Keep source bbox separate from derived extent. Display labels are not automatically formal machine classes.

## Without tools

[Current source context](GNAT_CURRENT_CHAT_CONTEXT.md) supplies V8; the historical [research context](GNAT_V6_CHAT_CONTEXT.md) has a unique anchored full appendix for every manifest entry and every new explanatory guide. Index records original path and SHA256. No code is replaced by ellipses. Manifest defines actual inclusion, not forecast counts.
