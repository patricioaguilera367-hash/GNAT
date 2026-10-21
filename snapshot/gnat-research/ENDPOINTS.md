# Confirmed read-contract endpoint catalog

Paths are source-relative, not permission or instructions for independent replay. E8 request references are local to the observed tool session. See [provenance](EVIDENCIA_CONFIRMADA.md).

| Endpoint | Action and observed inputs | Successful response observed |
| --- | --- | --- |
| /backend/saesa/svc_wmc.php | textual_search; query/page/start/limit (E1) | success/data candidates; JSON under HTML MIME in prior cases |
| Same | get_objects_geojson; form POST action plus JSON object_ids; 3999/4059/4075/4111/4117 | success/data; singleton Feature, two-ID FeatureCollection; Point and one LineString |
| Same | get_objects_info_for_point; 4116; lonlat JSON {lon,lat}, bounds JSON {lon1,lat1,lon2,lat2}, scale=resolution*1000, units_per_pixel=resolution | success/data array; id/display/type/description; image only in consumer, not verified in body |
| /backend/saesa/Web/component/svc_object_view.php | get_object_definition; POST object_id; 4021 | success/data with title/widget_definition/message_error |
| Same | get_widget_content; POST object_id plus JSON widget_ids; 4048 | success/data array {widget_id,content}; string/array/null; order differs |
| /backend/saesa/AM/component/svc_location.php | list_location_parts; query action/_dc; POST location_id/page=1/start=0/limit=100/sort=name/dir=ASC; 4049 | data array and total=2, **no success field** |
| /backend/saesa/svc_web_services.php | list_object_external_ids; query action/_dc; POST object_id/page=1/start=0; 4110 | success/data five rows; **no total field** |

Parts rows: id/name/class/class_display/type_display/managed_by/managed_by_id/installed_assets. External-ID rows: entity_id/entity_name/external_id/is_business_id/has_generator/begin_date/read_only; dates observed as ISO strings. Row read_only=false does not override tab read-only mode.

## Adapter implications

Decode per action, not one universal wrapper. Key widget results by widget_id and geometry by Feature.id; never zip by position. Treat _dc as transport detail, not business identity. Preserve absent versus null/empty. Negative, denied, login and partial-error envelopes remain uncharacterized.

Inspector body allowlist is unchanged: point-identify and external IDs are unsupported body actions. MCP observations do not expand observer capabilities or independent access rights. No bulk/area permission follows from this catalog.
