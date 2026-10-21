# Confirmed bounded GNAT evidence

Date: 2026-10-21. **Point and one MT line geometry, a successful two-ID batch, several response wrappers and UI read-only behavior are confirmed. Electrical connectivity, area inventory and independent access are not.**

This is the current evidence ledger. Earlier [search](../GNAT_BUSQUEDA.md) and [selection](../GNAT_SELECCION_FICHAS.md) reports are preserved historical snapshots, not silently rewritten.

## Collection and provenance

The parent observed original authorized Chrome UI/client methods through Chrome DevTools MCP. Missing bodies were recovered from already-generated calls, without repeated searches. New bounded geometry work used two known IDs, one original point-identify click on a visible segment, and one line lookup; no sweep, load/capacity probe, operational action or unknown widget was executed. Local request references below are session-scoped, not globally unique or replay tokens.

The standalone Node observer attempted a two-second startup once: ACL initialization succeeded, zero records, exit 1; exact loopback /json/list returned non-success HTTP (numeric status not retained). No target attachment or live clean shutdown was established. No alternate port/browser-setting changes were attempted. MCP evidence is **not** proof the standalone observer works live.

## Response sequence

All listed response bodies were observed as successful samples. HTTP200 was explicitly retained for 4021/4048/4111/4116/4117; do not infer unrecorded status codes for other entries.

| Reference | Original action and scope | Confirmed response |
| --- | --- | --- |
| 3999 | get_objects_geojson [5018289], FAP1783 | success/data Feature, Point, id/properties.display_name/bbox; no crs |
| 4021 | get_object_definition object_id=5018289 | success/data; title/widget_definition/message_error keys; recursive widget metadata |
| 4048 | get_widget_content, same object, bounded known widget list | success/data array of widget_id/content; string/array/null; response order differs |
| 4049 | list_location_parts location_id=5018289, page1/start0/limit100 | data two rows, total2; no success field |
| 4059 | get_objects_geojson [4013068], F514139 pole | singleton Point Feature with id/label/bbox |
| 4075 | get_objects_geojson [28557382], F514139 DBC | separate singleton Point Feature; distinct ID and coordinate |
| 4110 | Original verified read-only IDs5 tab on DBC28557382 | list_object_external_ids success/data five rows; no total; all row read_only=false |
| 4111 | Original zoomToObjects [4013068,28557382] | **Actual server two-ID success/data FeatureCollection**, two independently identified Point features |
| 4116 | Original onMapClick, visible blue F514139 segment, no pick/drawing mode | get_objects_info_for_point success/data one row: id32327210, display F514139 - F514140, type Tramo aéreo MT, description string |
| 4117 | Original zoomToObjects [32327210] | success/data Feature, LineString with two vertices, id/label/bbox; no node/terminal IDs |

4116 description UI showed medium-voltage distribution cable, three phases and Normal/Real circuit display Cajón [S223]. These are displayed attributes, not a terminal graph. Maintenance/operator details are excluded. The consumer references image, but **image was not verified in the body**.

## Geometry and CRS

Loaded OpenLayers GeoJSON reader dataProjection.getCode() returned EPSG:4326, consistent with the original fallback. Actual fromLonLat transformation of the observed FAP coordinate into EPSG:3857 exactly matched the prior map center. Thus GNAT's consumer interprets the tested samples as longitude/latitude EPSG:4326 with a real transform consistency check. Raw responses contain no explicit crs; this is not a universal guarantee for future types/contracts.

Feature.id supports matching the tested objects, independently of response order. The two-ID success proves neither maxima, ordering guarantees, partial-error behavior nor complete inventory.

The returned line bbox extends beyond the coordinate-vertex latitude extent. Preserve server bbox separately from any derived geometry extent; do not overwrite it or call the vertices pole/terminal coordinates. One MT line is verified; BT vector geometry was not tested.

## Definition, UI and widget evidence

Definition exposition includes read-only/read-write; initializeTab calls setReadOnly(true) for read-only tabs supporting that method. IDs5 and Attachments45 are read-only/non-generator. Header267/2/253/82 are read-write/generator=true. Row read_only=false is distinct from global tab readOnly=true. This is an observed UI gate, not server-side authorization proof.

IDs component has add/edit/remove controls in its implementation, but the tested initialized tab was read-only. Only that verified tab was manually selected. Widget142 electrical loader has scripts:true and read-write exposition; **not executed**. All other unknown-effect tools remain excluded.

| UI-only live case | Confirmed display | Limit |
| --- | --- | --- |
| Line32327210 | Cable; TRAMO AÉREO MT; Lineal | Display class/type, not backend machine type IDs |
| DC28557387 | Seccionador; DC POLE TOP 900A 25KV; Puntual; F514139 -> F514139 [F514139] | Cached original candidate/info controls; no new raw DC body |
| DF28557371 | Interruptor-seccionador con fusibles; DESCONECTADOR FUSIBLE EMPRESA; Puntual; F514139 -> F66023 -> F514139 [F66023] | Intermediate breadcrumb is real UI evidence, not proof of hosting or electrical connection |

DC/DF centers differ in EPSG:3857; exact coordinates are not published. Formal machine class codes remain unverified. No device/electrical widget was activated for these cases.

## Live layers and privacy

Safe live class/format checks confirmed visible MT/BT/infrastructure WMTS image/png; selection Vector; ImageWMS elsewhere. Raster visual delivery is distinct from object-vector lookup, not a network inventory contract.

Transient CDP reception was explicitly authorized, not credential publication. One earlier saved-config snippet and a later broader WMS source-parameter read exposed sensitive fields transiently in tool context; inspection stopped/was narrowed to safe class/format projections. No credential values, source URLs, cookies or headers are included here. This does not claim zero historical exposure or bypass earlier full-header inspection refusal.

## Reproducible local evidence

[Transformed observed catalog](fixtures/contracts.observed.anonymized.json) remaps IDs, translates all coordinates/bboxes consistently, replaces labels/organization/date values, and explicitly records partial subsets. It is **not an untouched server response**, original geolocation dataset, standalone capture or invented live evidence. Point/line geometry shape and wrapper distinctions derive from real responses. Unknown nonempty widget rows and uncollected scalar values are omitted rather than fabricated. Batch bboxes are rounded to available coordinate precision.

[Contract tests](tests/observed-contracts.test.cjs) exercise existing inspector projection/schema against this catalog; they do not contact GNAT. Initial RED: three explicit missing-fixture assertions, not missing-module errors; GREEN after catalog creation. The [synthetic fixture](fixtures/geojson.synthetic.json) remains separate.

Inspector limitations remain: bbox/display_name/content values and exposition mode strings are not retained by its current projection; external-ID and point-identify bodies are not allowlisted; schema may collapse unknown keys. Manual stdin correlation, no automatic UI changes/JavaScript exceptions, and dropped HTML/business text remain capability gaps. No production code changed to hide these gaps.
