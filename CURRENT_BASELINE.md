# Current implementation baseline: GNAT Extension V8

The user explicitly identifies `Desktop/v4/GNAT_Extension` as their currently used version. Future requested features must extend **this baseline**, reusing its existing work-point, block, CSV/project, editor and map behaviors. Older V6/V4 and Python MOCK code remain reference material, not a mandate to rebuild the working extension.

## Provenance and identity

Four regular files (115,897 bytes) were copied unchanged into `GNAT_Extension/`. Manifest name: **Centrality Local V8**; version: **8.0.0**; Chrome Manifest V3. Filename/version and user-reported use establish baseline selection, not independent runtime certification. Some internal compatibility/log strings still refer to older versions; those bytes were intentionally preserved.

| Source file | Bytes | SHA256 |
| --- | ---: | --- |
| `background.js` | 2541 | `9F6E70BADFF550EBF4615153A08057DE46182CD53736218F8A0CD1462AE1957E` |
| `centrality_v8.js` | 110755 | `5F83B0FD6EEAE76FED4C6EE7ED4DC3F12C051749576C5EC696EB4F8C1C7238A5` |
| `LEEME.txt` | 2253 | `06E7F6B0579D75351885BFF35861D31A5365DF987180C3C505351C39293331B0` |
| `manifest.json` | 348 | `04DE80740D2235525031410234072504553C5CC19D4415ED4F3E4C8544887D84` |

The four-file source allowlist is exhaustive for this import. No runtime datasets, CSV projects, databases, browser profiles, captures, credentials, cookies, tokens, saved portal pages or configuration were imported. Original source files outside this repository were not edited. Earlier snapshot, SOURCE_MANIFEST.json, V6_PROVENANCE.md and GNAT_V6_CHAT_CONTEXT.md remain historical and byte-preserved. The workspace's existing V6 ZIP was not regenerated or relabeled as current.

## Installation and host boundary

1. Follow approved corporate Chrome extension policy; contact IT if developer-mode loading is blocked.
2. Open `chrome://extensions`, enable developer mode if permitted, and **Load unpacked** selecting this repository's `GNAT_Extension` folder. No build, npm install, remote debugging or DevTools injection is needed.
3. Sign into the authorized GNAT page normally, open Mapas and wait for the map. Click the extension action. Export project JSON before reloading/closing the host.

The launcher uses `activeTab` and `scripting` only, service worker `background.js`, MAIN-world execution. It checks same-origin `iframe#content` with `contentWindow.webMap_.map` and `contentWindow.ol`; existing `__superponerKMZ.abrirPlanilla` reopens the editor rather than reinjecting. The map runtime needs the host's OpenLayers objects, layer sources and DOM. This is **not standalone Centrality Local** and does not establish independent GNAT authentication or transport.

Local files and local planning edits do not imply zero network: atlas/map rendering reuses host tile sources, which can generate ordinary host requests. No corporate browser or service was executed during this publication. Preserve the host dependency until a separately authorized, source-backed migration is requested.

## Existing interchange and domain boundaries

The code accepts CentralityLocal project JSON versions 1, 2 and 3 and exports version 3. CSV route/opening helpers preserve stable marker IDs, blocks and opening links. These are planning records: `aperturasIds` is not proof of electrical terminals, real equipment states, isolation or connectivity. Never infer graph edges from shared codes or nearby geometry.

S/E means substation; transformer CD of S/E differs from pole COD. Existing GNAT identity/geometry/widget findings remain in the historical research corpus, especially `snapshot/gnat-research/EVIDENCIA_CONFIRMADA.md`, `CONTRATOS.md` and `COBERTURA.md`. Do not repeat confirmed investigation or treat proposed integrations as implemented.

## Validation scope and recovery

`node --test tests/extension-publication.test.cjs`: **5 passed, 0 failed** after import. Before import, the same five checks failed because the current extension files were absent; this is packaging RED/GREEN evidence, not proof of fixing a runtime bug. Checks cover exact four-file hashes/sizes, MV3/action/worker/permissions, syntax of both JavaScript files with vm.Script (no browser execution), six Node-only helper exports and synthetic route/opening CSV round trips with stable planning links, legacy route columns and invalid-input rejection.

Browser/Chrome installation/real GNAT E2E: **not run**. User-reported practical use is separate evidence. V4/Python and earlier research tests do not provide V8 browser coverage. No new runtime behavior was authored; original source was not adjusted to make checks pass.

Current whole-repository hashes are in SHA256SUMS.txt; the older SOURCE_MANIFEST.json remains the 66-original V6 handoff inventory, not the current repository inventory. Rollback boundary: remove imported GNAT_Extension, current addendum/provenance/test and restore the five active orientation guides plus checksum list; keep all historical snapshots and original workspace data.

For chat-only coding, upload GNAT_CURRENT_CHAT_CONTEXT.md **and** GNAT_V6_CHAT_CONTEXT.md. The current file is authoritative for implementation baseline; the historical file provides full older research. Preserve both rather than losing earlier evidence.
