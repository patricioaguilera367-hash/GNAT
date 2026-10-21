# Code-list geolocation specification

Status: **proposal with confirmed sample contracts**, not an implemented Local batch feature. [Confirmed evidence](EVIDENCIA_CONFIRMADA.md) includes three points, one MT line and a successful two-ID batch; no bulk extraction or inventory.

## Goal and input

Accept an ordered list of user-authorized pole/asset codes and return per-input candidates, separately identified selected assets, verified geometries, geographic coordinates **only when CRS is established**, and minimal metadata/provenance. Local owns the UI; GNAT access requires an independently approved read/authentication mechanism.

Preserve original text, normalize only documented whitespace/case policy, bound list size locally, and coalesce repeated lookup work without losing input positions. Reject malformed inputs without remote requests. Initial product list-size cap must be explicitly configured; no GNAT capacity is claimed.

## Evidence-backed lookup sequence

1. E1 `textual_search` uses `query/action/page/start/limit`; observed successful wrapper is `success/data`. Search is not exact-only (F56822).
2. Retain every distinct candidate object ID, independent map surrogate and label. Shared codes and duplicate labels are not duplicates.
3. Exact-match classification requires a verified structured code field or separately verified matching rule. Label prefixes alone remain heuristic. Expose uncertain matching; do not silently choose a pole or equipment.
4. For an explicitly selected object-backed candidate, E2/E3 map lookup sends its map surrogate in JSON `object_ids`; technical metadata uses object ID. E8 confirms success/data with singleton Feature or two-ID FeatureCollection for tested samples.
5. Validate returned feature identity/geometry/CRS; record missing, partial and mismatched results individually. Never assume response order corresponds to input order.

## Per-input statuses — proposed Local semantics

| Status | Meaning; evidence needed |
| --- | --- |
| `resolved` | Explicitly resolved identity and validated geometry; lon/lat may still be withheld if source CRS unverified |
| `ambiguous` | Multiple eligible assets or unresolved exactness/type; user choice required |
| `no_exact_match` | Successful characterized response, but verified matching rule finds no exact candidate; longer-code matches may exist |
| `nonexistent` | Only an authoritative characterized absence/exact-query contract with complete applicable paging; **not currently verified** |
| `match_unverified` | Response lacks verified structured code/type evidence; do not infer exactness from display alone |
| `partial_geometry_failure` | Identity resolved, geometry call/feature mapping failed, absent or unsupported; retain candidate |
| `auth_required`, `forbidden` | Characterized authentication/authorization failure; never report as absence |
| `network_error`, `rate_limited`, `source_error`, `invalid_response` | Keep failure category and safe retry state; no invented empty success |
| `invalid_input`, `cancelled` | Local validation/cancellation; no claim about GNAT inventory |

Server negative/error envelopes are unknown. Until verified, return safe generic source/invalid-response outcomes rather than guessing an error class from HTTP 200 or an HTML login page.

## Geometry and reference system

- Client map uses EPSG:3857. Loaded reader dataProjection is EPSG:4326, and actual FAP fromLonLat transformation matches the prior view center. Tested samples are therefore interpreted as lon/lat EPSG:4326 by GNAT; no raw crs declaration or universal server guarantee was observed.
- Keep raw verified geometry plus declared/verified CRS separately from derived WGS84 longitude/latitude. Publish geographic coordinates only after a confirmed transformation; validate finite values and applicable ranges.
- Point: return actual point coordinate after CRS verification. MultiPoint: retain all points; no silent first-point choice. LineString/MultiLineString/Polygon: return geometry and type, not a claimed pole coordinate; an optional representative point must be labeled derived with its method.
- `pin_location:null`, empty geometry, no returned feature and failed lookup are different conditions. Geometryless objects are not automatically nonexistent.
- Feature.id matches the tested requested IDs; match by ID, not order. Preserve source bbox separately from derived extent: the line bbox exceeds vertex latitude extent. [Transformed observed fixtures](fixtures/contracts.observed.anonymized.json) characterize samples; the [synthetic fixture](fixtures/geojson.synthetic.json) remains tooling-only.

## Batching, request budget and retries — proposed policy, not GNAT limits

E8 verifies actual server success for two known IDs in one request. Maximum IDs/body/page sizes, order guarantees, partial failures and rate remain unknown. This is not capacity evidence; no further load probing.

Start future integration with concurrency **1**, configurable minimum spacing (proposed 500 ms), bounded timeouts and at most two retries with exponential backoff/jitter only for verified idempotent reads and transient failures. Honor `Retry-After` when exposed; stop on auth/forbidden/unknown effects. Add cancellation, a total request budget and partial progress. Do not auto-retry malformed/ambiguous responses or perform unbounded paging. Operator/source-owner limits override these local defaults.

## Cache and result contract — proposal

Cache key: source environment + user/authorization scope + contract/schema version + action + normalized inputs, with object ID and map surrogate distinct; geometry entries also include source CRS/version. Deduplicate lookups, not assets. Never share cached data across unauthorized users/scopes.

Proposed TTLs: search/metadata 5 minutes; geometry 15 minutes when cache rights permit; characterized negative exact result 30 seconds. TTLs are Local policy, not source freshness guarantees. Mark age/stale status, invalidate on authorization/contract changes, allow explicit bounded refresh, and never cache auth failures as negative inventory. Prefer private encrypted storage where approved, minimal fields, access controls and retention/deletion policy; no browser credentials in cache.

Illustrative Local result only, **synthetic; not a GNAT response**:

```json
{"inputCode":"POLE_A","status":"ambiguous","candidates":[{"objectId":"1001","mapSurrogateId":"9001","assetTypeStatus":"unverified"},{"objectId":"1002","mapSurrogateId":"9002","assetTypeStatus":"unverified"}],"geometry":null,"geographicCoordinates":null,"sourceCrsStatus":"unverified","evidenceClass":"synthetic"}
```

## Acceptance before implementation

Use only the five known code cases initially: FAP1783/F562512/F562515/F56822/F514139. Real point consumer-CRS consistency and two-ID success are now verified. Partial failures remain pending; preserve shared-code assets and nonexact/duplicate labels. A new nonexistent test needs one explicitly authorized bounded safe code. Area inventory remains unavailable until a verified read contract and authorized bounded area exist; point-identify, raster tiles and viewport bounds do not confer inventory permission.
