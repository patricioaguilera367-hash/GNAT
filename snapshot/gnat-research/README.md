# Passive GNAT research inspector

This standalone Node 24 observer records bounded, privacy-projected evidence from the authorized Chrome page. It never searches GNAT, navigates, opens widgets, intercepts requests, injects code, reads storage, or changes application settings. Operate the original interface separately, and only for authorized read-only cases.

**Status:** offline observer verified; standalone startup failed at exact loopback discovery, zero records, no live attachment. Parent Chrome DevTools MCP separately confirmed bounded response contracts. See [current evidence](EVIDENCIA_CONFIRMADA.md); transformed observed fixtures are distinct from synthetic tests.

## Quick path

```powershell
node --test gnat-research/tests/*.test.cjs
node gnat-research/inspector/cli.cjs --help
# Run only after authorizing this browser session and validating the observer:
node gnat-research/inspector/cli.cjs observe --origin https://st.saesa.cl:8082 --endpoint http://127.0.0.1:9222 --duration 180
```

The observer requires exactly one matching page, or an explicit `--target <page-id>` when multiple matching pages exist. It rejects non-loopback debugging endpoints, unexpected origins, credentials in URLs, and cross-port debugger WebSockets. It does not start Chrome or enable remote debugging. No automatic requests are sent to GNAT.

Captures are created under `gnat-research/private/` and ignored by Git. Before connecting, Windows ACLs must prove current-user ownership and protected current-user-only access; unverified storage fails closed. Newly created directories/files receive restrictive ACLs; existing directories are checked, not relaxed. POSIX uses owner-only modes. Symlinked ancestors are rejected.

While observing, type `select_pole_1`, `select_equipment_1`, `open_view_1`, or `consult_widget_1` on stdin to mark an authorized manual action. Other supported prefixes are `search`, `batch`, `area`, and `topology`; append `_1` through `_999`. `stop`, Ctrl+C, or the duration limit ends collection and prints a value-free schema summary. Markers indicate timing, **not proven causality**. Incremental progress counts print every 15 seconds. The collector never initiates the marked action.

```powershell
node gnat-research/inspector/cli.cjs summary gnat-research/private/<capture-file>.jsonl
```

## Privacy and evidence boundary

| Layer | Retention policy |
| --- | --- |
| CDP transport | Chrome necessarily sends complete protocol frames transiently, which can include headers, cookies, URL parameters, or request bodies. This observer cannot promise those bytes never enter process memory. Do not use it when transient reception itself is forbidden. |
| Protocol ingress | JSON reviver discards header/cookie/auth/token/storage/personal-data key families before events reach the collector. No ExtraInfo events, cookie commands, raw event logging, HAR exports, console evaluation, or interception. `header_widgets` is a business metadata key, not an HTTP header. |
| Requests | Only exact authorized origin, Fetch/XHR and GET/POST. Static known endpoint/action names, local correlation numbers and a small numeric/asset-code parameter allowlist survive. URLs, request IDs and arbitrary text do not survive. Unknown actions/endpoints become `unknown`; no body retrieval. |
| Responses | Request and final response path/origin plus safe query identity must match. Duplicate/conflicting action parameters and unknown query parameters fail closed. Only successful allowlisted observed actions labelled `application/json`, `application/geo+json`, or `text/html` (optional charset parameters) are eligible for bounded JSON parsing. GNAT is known to label JSON as HTML. Actual HTML/malformed JSON is skipped, not retained; unknown actions/endpoints never trigger body retrieval. No raw body is persisted. |
| Projection | Preserve numeric object/map/widget IDs independently, finite coordinates, GeoJSON geometry types, selected class codes and widget generator booleans. Arbitrary descriptions, titles, HTML/content, names, owner/contact information and unknown business values are omitted. Unknown fields are collapsed in schema-only evidence. |
| Files and errors | Strict record projection, bounded private JSONL, generic error categories. No raw exception, server error text, credentials or real secrets in fixtures. Exact IDs and coordinates are still private business data, not publication-ready anonymized examples. |

The prior full-header network inspector refusal remains in force. The user authorized transient CDP reception, not secret retention/publication. One bounded standalone startup failed at discovery; no browser settings or alternate ports were changed. MCP observations do not prove observer attachment.

## Allowlisted observed contracts

These names come from earlier research; allowlisting permits passive response inspection, not independent invocation or a claim that every server implementation is side-effect-free.

| Endpoint | Observed action eligible for a bounded projected body |
| --- | --- |
| `/backend/saesa/svc_wmc.php` | `textual_search`, `get_objects_geojson` |
| `/backend/saesa/Web/component/svc_object_view.php` | `get_object_definition`, `get_widget_content` |
| `/backend/saesa/AM/component/svc_location.php` | `list_location_parts` |

Unsupported endpoints/actions retain only coarse request/response metadata. Do not expand the allowlist without a verified read contract. This tool does not classify widgets as safe or authorize opening them.

## Bounds and limitations

- Session: default 180 seconds, maximum 1800; 10,000 events/records, 100 pending network requests, 30-second request age, 32 pending CDP commands, 5-second command timeout.
- Network buffers: 128 KiB total, 64 KiB per resource, 4 KiB request post data. Eligible bodies: at most 64 KiB reported encoded length and 64 KiB decoded UTF-8; base64 representation separately bounded. Compressed responses can transiently exceed their encoded length before rejection. Protocol frames above 256 KiB are discarded after WebSocket receipt.
- Output: 8 MiB total, 128 KiB per JSONL line; 100 markers; bounded schema depth/fields, arrays and coordinate nesting. Request parameter arrays are retained only when all entries are numeric and the original length is at most two; otherwise the entire parameter is omitted, not truncated. Body arrays retain at most 200 projected entries and drop unsafe values, so neither array lengths nor indexes prove original cardinality/order. Explicit source nulls remain null; dropped values do not become invented nulls. Missing/omitted fields are not full-request evidence; skipped bodies are not negative business results.
- No guarantee of collection before attachment, request completeness, retry success, server CRS, widget readability, topology, or absence of incidental server effects. Empty/missing values cannot be interpreted as nonexistent coordinates or assets.
- `object_id` and `surrogate_in_map_id` are retained as distinct fields. Coordinates are preserved without assigning a CRS or deriving connectivity.
- HTML widget content and free-form descriptions are schema-only. Inspecting safe business text needs a separate reviewed projection, not raw capture. Raster/WMS images and script bodies are intentionally not collected.
- Offline summaries report field types, null/type variation, presence/repetition counts and sanitized errors. Presence counts are per observed body, not proof of server optionality. Correlation IDs remain in JSONL; timing alone is not causal proof.
- The synthetic protocol peer tests event/reply/error behavior without a live WebSocket handshake. Actual Chrome interoperability, live clean stop, operating-system memory/swap and non-Windows file permissions remain separate checks.

## Verification

Tests cover privacy ingress, geometry/ID preservation, off-origin redirects, response-path mismatch, unknown actions, MIME/status/size gates, malformed and base64 JSON, pending/late/error cleanup, command/target restrictions, private Windows ACL output, CLI argument privacy, offline schemas and oversized lines. `fixtures/geojson.synthetic.json` is invented data, not a GNAT response.

No application source, original research document, browser state or remote inventory is changed. No global inventory, area enumeration, operational widget, batch load test, or independent GNAT request is implemented.

## Research specifications — partial, bounded live evidence

Start with [contracts and evidence](CONTRATOS.md), then [coverage](COBERTURA.md) and [pending decisions](PENDIENTES.md). Technical catalogs: [endpoints](ENDPOINTS.md), [widgets](WIDGETS.md), [data model](MODELO_DATOS.md), [flows](FLUJOS.md). Implementation proposals: [independent Local integration](CENTRALITY_IMPLEMENTACION.md), [code-list geolocation](GEOLOCALIZACION.md), [electrical geometry/topology](../GNAT_TOPOLOGIA.md).

Current checks: 29 inspector/contract tests and three existing diagnostic tests pass. Standalone discovery returned non-success HTTP; zero records, exit1, no attachment/clean-stop proof. MCP confirms point/line geometry, two-ID success and consultation wrappers. Earlier saved-config and later broader WMS-parameter inspections transiently exposed sensitive fields to tool context; stopped/narrowed, no credential values published. No zero-historical-exposure claim.

Observer still omits bbox/display_name/content values and exposition mode strings; point-identify/external-ID bodies are not allowlisted. Fixtures are curated transformed evidence from parent MCP, not observer output. Automatic UI correlation and JavaScript exceptions remain unimplemented.
