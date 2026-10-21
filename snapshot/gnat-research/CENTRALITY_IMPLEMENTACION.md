# Independent Centrality Local integration plan

**Proposal only:** use GNAT as an explicitly authorized read-data source, not an embedded visual dependency. This phase changes no Local application code and establishes no independent authentication rights.

## Minimal architecture

| Boundary | Responsibility |
| --- | --- |
| Native Local UI | Candidate picker, local map, technical-view sections, per-item status and evidence/staleness indicators |
| Domain model | Separate object/map/feature identifiers, asset types and host associations; geometry distinct from connectivity |
| Authorized source adapter | Versioned request/response contracts, origin/action allowlist, authorization checks, timeouts/error mapping and rate policy |
| Read-widget adapters | Only individually verified consultation services; no GNAT component execution or operational controls |
| Private cache | Authorization-scoped minimal records, TTL/invalidation, access controls and provenance |

The inspector is a temporary research tool, **not** the production adapter, login mechanism, proxy, scraper or UI automation dependency. Do not extract browser sessions/tokens or assume browser authentication transfers to Local. Obtain an owner-approved authentication and read-access mechanism before implementing remote integration.

## Behavior to reproduce

1. Search once per normalized uncached code, retain all candidates and distinct IDs; require selection where ambiguous.
2. Map lookup uses selected map surrogate; technical definition uses selected object ID. Preserve returned feature ID independently.
3. Decode per-action wrappers: geometry success/data Feature or FeatureCollection; definition/content success/data; Parts data/total without success; external IDs success/data without total. Match geometry by Feature.id and content by widget_id, not position. Preserve server bbox separately. Tested consumer CRS is EPSG:4326, not a universal declaration.
4. Build native technical sections from safe metadata. Only execute an explicitly approved consultation adapter; never load remote component classes/configuration.
5. Return partial results when geometry/widget calls fail; a valid identity remains visible. No automatic operational action or unverified widget fallback.

See [geolocation acceptance rules](GEOLOCALIZACION.md) and [network representation](../GNAT_TOPOLOGIA.md). [Observed samples](EVIDENCIA_CONFIRMADA.md) satisfy successful point/line/two-ID shape evidence; synthetic fixtures alone do not. Keep IDs opaque: accept digit strings or safe integer numbers without lossy coercion, and preserve object/map/feature roles.

## Implementation gates

- Authorized independent authentication, permitted fields, cache/storage rights and expected rate budget.
- Successful sample schemas and consumer CRS are confirmed; characterize errors/login/rate-limit/partial results and future types before production use.
- Individual consultation-widget scoping/read authorization and native safe rendering; use a restricted HTML sanitizer, never embedded scripts or GNAT component execution.
- Explicit topology evidence before electrical routes; no inferred proximity connections.
- Adapter tests using approved anonymized real fixtures plus synthetic negative cases; visible provenance and incomplete-state UX.

Tradeoff: a native adapter avoids GNAT visual coupling but requires stable verified contracts and authorization maintenance. Reusing GNAT HTML/component logic would be faster superficially but imports unsafe execution, visual dependence and hidden side effects; it is not the proposed design.
