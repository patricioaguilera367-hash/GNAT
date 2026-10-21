# GNAT contract evidence

Status: **partial, updated with bounded live evidence**, 2026-10-21. Successful point, two-ID geometry, line, definition and consultation responses are confirmed; production integration and electrical topology are not. Start with [confirmed evidence](EVIDENCIA_CONFIRMADA.md).

## Evidence classes

| Key | Class | Source and limit |
| --- | --- | --- |
| E1 | Prior real response | [Search report](../GNAT_BUSQUEDA.md), five bounded codes; preserved as historical evidence |
| E2 | Prior UI / loaded-client | [Selection report](../GNAT_SELECCION_FICHAS.md); earlier gaps superseded only where E8 confirms them |
| E3 | Saved-client | Map geometry consumer 1520-1563, highlighting 1487-1513, layer handling 1016-1066/1127-1138 and point identification 1632-1770 in saved map.js; not universal server guarantees |
| E4 | Saved-config-derived | Earlier raster-layer observation; credential-bearing configuration excluded from deliverables and further inspection |
| E5 | Synthetic | [Invented geometry fixture](fixtures/geojson.synthetic.json); tooling only |
| E6 | Offline checks | Inspector and diagnostic tests; not live handshake proof |
| E7 | User domain context | Shared codes, DC/DBC/DF terminology, transformer CD versus pole COD; not a field survey |
| E8 | Current observed response / live-client / UI | [Request sequence and boundaries](EVIDENCIA_CONFIRMADA.md); transformed fixtures identify subsets |

## Contract maturity

| Contract | Confirmed for tested samples | Still unknown |
| --- | --- | --- |
| textual_search | E1 form POST and success/data candidates | Exactness, complete paging, negatives/errors/auth |
| get_objects_geojson | E8 success/data Feature for singleton points/line; two-ID FeatureCollection; IDs and bbox | Other types/counts, partial errors, maxima/rates, universal CRS declaration |
| get_object_definition | E8 root fields, recursive widget metadata, exposition/generator separation | Formal backend asset class/type IDs, server authorization guarantees |
| get_widget_content | E8 success/data entries keyed by widget_id; string/array/null; changed response order | Full nonempty-row schemas and safe HTML semantics |
| list_location_parts | E8 location_id scope, paging request, data/total without success | Complete paging and error behavior |
| list_object_external_ids | E8 object_id scope; success/data, five rows, no total | Independent access permission and error/paging guarantees |
| get_objects_info_for_point | E8 click-local success/data identification of one MT line | Area inventory and electrical endpoints |

Raw geometry HTTP envelopes are now confirmed, not merely inferred from a helper. CRS confidence is sample-scoped consumer/transform verification, not an explicit server-wide declaration.

## Safety boundary

The user authorized transient CDP reception; credential retention/publication remains prohibited. Standalone observer startup failed at exact loopback discovery with zero records, while Chrome DevTools MCP supplied E8. No alternate ports/settings or credentials were inspected for recovery. Earlier saved-config and later broad WMS-parameter inspections transiently exposed sensitive fields to tool context; values were not copied into these deliverables. Subsequent layer projections were restricted to class/format. No zero-historical-exposure claim is made.

See [coverage](COBERTURA.md), [pending work](PENDIENTES.md), [geolocation](GEOLOCALIZACION.md) and [topology](../GNAT_TOPOLOGIA.md).
