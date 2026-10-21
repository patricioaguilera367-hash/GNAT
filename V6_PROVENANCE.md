# Exact V6 baseline and provenance

| Field | Verified value |
| --- | --- |
| Original path | `v6.txt` |
| Packaged path | `snapshot/v6.txt` |
| Size | 67,852 bytes |
| SHA256 | `48383BB3991DC5C6CD5DA246292C6EA9CC5807741068E517F71F2DDF178CBE66` |
| Version interpretation | User-designated V6 filename; internal header/title/log retain CENTRALITY V4. Not a verified internal semantic release. |

No source label, newline, encoding, export or algorithm changed. In the master Markdown, UTF-8 text is embedded verbatim; snapshot/manifest remain authoritative for exact bytes. Fences/metadata outside originals are not source content.

## Runtime boundary

The base is a browser-console JavaScript IIFE expecting existing same-origin `iframe#content`, `frame.contentWindow.webMap_.map`, `w.ol` and host map/layer/source resources. Native browser Canvas, Blob, KML/KMZ and `DecompressionStream('deflate-raw')` are platform assumptions. No JSZip/CDN dependency was found in the verified base. Static findings are not a supported-browser guarantee.

It is not standalone HTML, a bookmarklet or the Local app. Local Python/web does not host/replace the IIFE automatically. Do not rename `v6.txt` to historical `v4.js` to make old tests appear to cover it.

The base has CommonJS exports for six CSV helpers and an early no-DOM return; this alone does not prove browser behavior. Packaging performs syntax-only `vm.Script` parsing without running the IIFE. Existing `v4.test.js` reads `v4.js`; label its results V4 coverage.

## Preservation chain

`SOURCE_MANIFEST.json` maps each original to copy path, size, SHA256, role, evidence class and private-handoff classification. Source hashes are checked pre/post copy and against ZIP members. Generated guides have final checksums in `SHA256SUMS.txt`, excluding itself. ZIP checksum is outside ZIP, avoiding recursion.

Original root/research `.gitignore` files are unchanged under `original-ignore-policies/` with inert `.original` suffixes. This is the only exception to `snapshot/<original path>`. Their old exclusions would otherwise hide V6/V4 sources. Mapping is explicit in the manifest.
