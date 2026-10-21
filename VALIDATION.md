# Validation record

Date: 2026-10-21. No production behavior or reusable executable tooling introduced. Checks ran against the packaged snapshot without installing dependencies, contacting corporate systems or executing V6/portal scripts. Python HTTP tests use local loopback only.

## Existing functional checks: observed passing

Run from `gnat-v6-handoff/snapshot/`:

| Exact command | Observed result |
| --- | --- |
| `node --test gnat-research/tests/*.test.cjs` | 29 passed, 0 failed/skipped. Offline inspector and transformed-contract fixtures, not live handshake. |
| `python -B -m unittest discover -s tests -v` | 32 passed. Temporary local DB/captures and ephemeral loopback HTTP; no corporate transport. |
| `node --test (Get-ChildItem tests/*.test.js \| ForEach-Object FullName)` | 9 passed, 0 failed/skipped. Existing Local DOM/map/diagnostic stubs. PowerShell command; remove Markdown table escape before running. |
| `node --test v4.test.js` | 13 passed, 0 failed/skipped; V4 ONLY, not V6 coverage. |
| `node --check web/app.js` | Exit0. |
| `node --check web/map.js` | Exit0. |
| `node --check web/gnat-client.js` | Exit0. |
| `node --check bridge/diagnostico_contrato_gnat.js` | Exit0. |

83 existing tests passed across the four suites. Separate V6 syntax-only parse, exit0, no execution:

```powershell
node -e "new(require('node:vm').Script)(require('node:fs').readFileSync('v6.txt','utf8')); console.log('V6 syntax parsed only; not executed')"
```

For an unescaped Local JS test command:

```powershell
node --test (Get-ChildItem tests/*.test.js | ForEach-Object FullName)
```

## Structural and preservation checks

- 66 allowlisted originals, 585,420 bytes, read/copy equality and SHA256 asserted. Baseline V6 exact size/hash matches provenance. Original sources remain untouched.
- Explicit package ignore-policy exceptions keep copied V6, V4 and example CSVs visible even beneath the workspace's inherited historical exclusions; all copied original paths were checked using `git check-ignore --stdin` without staging.
- Complete full-text master includes each copied original plus nine generated explanatory Markdown guides, source manifest and new active ignore policy: 77 uniquely anchored appendices. Fences are longer than any backtick run inside their text, not a fixed fence vulnerable to embedded snippets. Source sections are verified against decoded original bytes, not summaries.
- Root and packaged master are identical byte-for-byte. All relative Markdown link paths in explanatory/original documents resolve; final sealing checks the generated master/checksum targets too. External URLs are not fetched or claimed valid. Source document fragment anchors/language rendering are not rewritten or exhaustively checked.
- Conservative credential patterns over allowlisted source text found zero matches: private-key delimiters, AWS access-key shape, long GitHub tokens, long Bearer values and quoted long secret assignments. No excluded private file was opened for that scan. This is not comprehensive security/rights clearance; real IDs/codes remain private.
- No unexpected runtime files remained after tests. Archive entries are generated from explicit copied/generated paths only; reject symlinks, traversal, private/cache/Git paths and compare every decompressed entry byte/hash with the corresponding file.
- `SHA256SUMS.txt` covers all final package files except itself; its hash cannot contain itself. Outer ZIP checksum is external in `GNAT_V6_HANDOFF.zip.sha256`. ZIP decompression checks verify member bytes without writing extracted files.

The final sealing command asserts these invariants before reporting success. No blind staging/commit or original cleanup is performed.

## Skipped, unavailable and pending

- No V6 browser/runtime, portal visual/manual QA, live GNAT integration, independent auth/CORS, real data/capture import or standalone live CDP attachment test. These require distinct authorization/evidence and cannot be inferred from syntax/offline PASS.
- Native review receipt, commit/PR/push/publication not created. Existing repository unborn state, unresolved delivery chain choice and previous preflight access failure remain parent-owned constraints; no gates bypassed.
- No original full transcript/raw response bodies included. Recovered sector findings retain explicit provenance and uncertain aborted request outcome.
- Conservative privacy scan is not an independent exhaustive security audit or public publication license. User/source-owner review required before uploads/sharing.
