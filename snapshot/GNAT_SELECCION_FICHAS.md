# GNAT selection, map positioning, and object views

Date: 2026-10-21. Status: **partial investigation; no implementation**.

## Scope, evidence, and safety

The existing Chrome session was inspected through Chrome DevTools MCP. The original search candidate and information controls were used. Later UI clicks were dispatched to original DOM controls; no GNAT source was edited, backend requests replayed, or operational actions executed. Centrality Local was not inspected or modified.

The browser exploration stopped after 25 Chrome DevTools calls, including one refused request inspection and one failed serialization. Persistence and document readback followed without further browser exploration. Search was repeated only to select FAP1783 and F514139. Previously confirmed search response bodies were not collected again.

**Important limitation:** the request-detail tool was refused because it retrieves complete headers, including cookies, contrary to the user's restriction. No request details were returned by that refused call. No workaround was attempted. Consequently this report distinguishes:

- **Network-list evidence:** method, endpoint, status, and local request ID only.
- **Loaded-client evidence:** function implementations already present in page memory, selected candidate records, widget metadata, rendered text, component stores, and map view state. These are not raw HTTP response bodies.
- **Examples:** anonymized structural illustrations, not captured response bodies.

No credential, cookie, token, internal hostname, or exact geographic location is included here. No effect-unknown widget or operational tool was explicitly executed. Opening the original object view automatically initialized components and generated requests; no server implementation audit establishes their complete absence of incidental effects.

## 1. Selection and positioning

### Confirmed client call chain

The original combobox `select` listener stores the candidate, exposes its information trigger, and invokes the search/positioning trigger. Its branching logic is:

```javascript
// Observed behavior, reduced to relevant statements.
if (selected.get('object_id')) {
  Gis.zoomToObjects(selected.get('surrogate_in_map_id'));
} else {
  const point = selected.get('pin_location').coords[0];
  Gis.pinOnPoint(point.x, point.y, selected.get('display'));
}
```

The fallback branch was inspected, not exercised. `pin_location: null` does not prevent object-backed positioning.

`Gis.zoomToObjects` normalizes a scalar to an array and delegates to a proxy. The map panel exposes `zoomToObjects`, which calls `objectsToFeatures(objectIds, zoomToFeatures, this)`. The proxy's internal binding was not independently traced end-to-end.

`objectsToFeatures` builds this request in the loaded client:

```text
relative endpoint: svc_wmc.php
action: get_objects_geojson
object_ids: JSON-encoded array of map identifiers
```

The selected FAP1783 record contained `object_id=5018289`, `surrogate_in_map_id=5018289`, and `pin_location=null`. A new POST to `/backend/saesa/svc_wmc.php` appeared after selection, local request **3999**, HTTP **200**. Its body and response were not inspected, so associating its action with the client function is supported by timing and loaded code, not a captured body.

### Geometry and map rendering

The loaded implementation:

1. Receives a GeoJSON value in its success callback.
2. Uses `ol.format.GeoJSON().readFeatures(geojson, {featureProjection: mapProjection})`.
3. Uses a map view in **EPSG:3857**; does not explicitly specify `dataProjection` in the inspected call.
4. Assigns point features the `pin` style, other geometries the `default` style.
5. Highlights features and unions their geometry extents.
6. Transforms that extent to EPSG:4326 for `setExtent`.
7. Calls the OpenLayers view's `fit(bounds, {padding: [50,50,50,50]})`.

The exact GeoJSON envelope, input CRS, geometry coordinates, feature properties, empty-result envelope, and error behavior were not verified from network responses. Do not infer an input CRS solely from the map view projection.

After positioning, both inspected pole views and the DBC view had zoom 21. Exact coordinates were observed only as map view state and deliberately omitted from this document.

## 2. Opening the original technical view

The combobox information trigger uses **`object_id`**, not the map surrogate:

```javascript
Web.showObjectView(selected.get('object_id'), callerComponent);
```

The inspected function creates `Web.component.ObjectViewDlg`, containing `Web.component.ObjectViewPanel`. The panel's `loadDefinitions` builds:

```text
endpoint: /backend/saesa/Web/component/svc_object_view.php
action: get_object_definition
object_id: selected object identifier
```

The loaded success callback expects `title`, optionally `message_error`, and `widget_definition`. The latter can contain:

```text
header_widgets
tab_widgets
action_widgets
tool_widgets
```

These are confirmed consumer field names, **not a confirmed full response schema**. The raw response wrapper, absent values, nesting details and permissions fields remain unverified.

### Observed request sequence for FAP1783

| Order | Local request | Method and relative endpoint | Status | Evidence limit |
| --- | --- | --- | --- | --- |
| 1 | 3998 | POST `svc_wmc.php?_dc=...` | 200 | Search necessary to select; known search body not re-inspected |
| 2 | 3999 | POST `svc_wmc.php` | 200 | After candidate selection; detail inspection refused |
| 3 | 4021 | POST `Web/component/svc_object_view.php` | 200 | After original information trigger |
| 4 | 4022 onward | GET component and localization JavaScript | 200 | Includes `AM/component/LocationPartsGrid.js` |
| 5 | 4029–4045, interleaved | POST `svc_web_services.php` and `FH/component/svc.php`, plus component scripts | 200 | Actions/bodies not inspected; do not assume all are generic widget-content requests |
| 6 | 4048 | POST `Web/component/svc_object_view.php` | 200 | Matches endpoint used by content loader; exact action not captured |
| 7 | 4049 | POST `AM/component/svc_location.php?action=list_location_parts&_dc=...` | 200 | Original Partes grid automatically active |

The interleaved sequence is not a claim of strict callback causality. Responses were successful at HTTP level; raw bodies and application-level success were not verified in this run. No fresh network list was collected for F514139 after the limit was reached.

## 3. Widget metadata and content loading

Each registered widget has `definition`, `component`, and `backendId=definition.id`. Observed definition keys:

```text
id, title, exposition, icon_class, color, container_children,
component_class, component_config, component_has_content_generator,
action_has_params, action_provider_id, action_provider_item_name
```

The inspected registry separates `headers`, `tabs`, `actions`, and `tools`. FAP1783's registered `actions` section was empty. This does not establish a system-wide permission or absence of operational behavior in other sections.

### How GNAT chooses generated content

`collectWidgetIdsWithDataGenerator` inspects **tabs, headers, and tools**, selecting definitions with `component_has_content_generator=true`. It does not include the actions section in that collection. `loadWidgetsData` builds:

```text
endpoint: /backend/saesa/Web/component/svc_object_view.php
action: get_widget_content
object_id: object identifier
widget_ids: JSON-encoded array of backend widget IDs
```

`applyWidgetContent` expects an array of items with `widget_id` and `content`. It looks up the registered component by backend widget ID; string content goes to `component.update`, otherwise data goes to `component.loadData` when supported.

**This flag identifies a loading mechanism, not guaranteed read-only behavior.** No explicit permission or universal read-only flag was confirmed. A widget with `component_has_content_generator=false` may still fetch its own data. Do not treat its title, class, lack of generator, or membership in tabs/tools as a safety authorization.

### Automatically loaded consultation data: Partes

The original view opened on **Ubicación de activos → Partes**, widget **291**, class `AM.component.LocationPartsGrid`. No extra manual widget activation was needed or performed. Its generator flag is false. Its store proxy points to `AM/component/svc_location.php?action=list_location_parts`. Its inspected `loadData` calls `store.loadPage(1, options)`.

For FAP1783, two records were present in the component store and rendered in the grid. Observed field set:

```text
id, name, class, class_display, type_display,
managed_by, managed_by_id, installed_assets
```

Confirmed displayed types were `Nodo de Baja Tensión` and `Nodo estructura BT`; both records had `class=elec_insulator`, display class `Estructura`, and installed asset counts 0 and 1 respectively. This is **component-store evidence**, not proof of the raw server envelope or pagination fields. Object scoping parameters used by that grid were not traced completely.

Anonymized illustration of the observed store records:

```json
[
  {"id": 10001, "name": "10001", "class": "elec_insulator", "class_display": "Estructura", "type_display": "Nodo de Baja Tensión", "managed_by": "COMPANY_A", "managed_by_id": 900, "installed_assets": 0},
  {"id": 10002, "name": "10002", "class": "elec_insulator", "class_display": "Estructura", "type_display": "Nodo estructura BT", "managed_by": "COMPANY_A", "managed_by_id": 900, "installed_assets": 1}
]
```

Anonymized illustration of the generated-content consumer contract (not a captured response):

```json
[
  {"widget_id": 2, "content": "<span>POLE_A</span>"}
]
```

Rendered header widgets confirmed: 267 `am.asset_location_breadcrumbs`, 2 `web.object_display_name`, 253 `web.object_type_name`, 82 `am.asset_location_info`, all with a content generator.

## 4. Pole versus equipment: F514139

Both candidates were selected using original candidate DOM elements, and each original information control was opened. No DC or DF view was opened.

| Observation | Pole | DBC equipment |
| --- | --- | --- |
| `object_id` | 4013068 | 28557382 |
| `surrogate_in_map_id` | 4013068 | 28557382 |
| `pin_location` | null | null |
| View title | Detalle de Poste F514139 | Detalle de Interruptor seccionador F514139 [F514139] |
| Type header | POSTES C.A. 10 M 350 KG/RUP CTE. COMUN CON BT | DBC ABB NXA 36KV |
| Class display | Poste | Interruptor seccionador |
| Breadcrumb | F514139 | F514139 → F514139 [F514139] |
| Map projection and zoom | EPSG:3857; 21 | EPSG:3857; 21 |

Their resulting map centers differ: DBC minus pole is approximately **(+3.8114, -7.9328) EPSG:3857 map units**. These are view-center differences, not verified raw equipment coordinates, ground distances, or mounting offsets. The breadcrumb supports a displayed hierarchy; it does not independently prove physical mounting in the field.

The same generic selection and view-loading client functions handle both records, using different IDs. No different per-type request contract was confirmed. The rendered object class, type header, and available widgets **do differ**:

- Pole-specific observed tabs: 155 `Clientes`, 156 `Métricas de cortocircuíto`.
- Equipment-specific observed tabs: 133 `Dispositivos` (`DDM.component.LocationDeviceGrid`), 142 `Red / Datos eléctricos` (`Electrical.component.NetworkingElectricalInfo`); both generator flags false.
- Common observed tabs: 291 Partes, 101 Activos instalados, 102 Unidades constructivas proyectadas, 105 Características generales, 5 IDs, 45 Adjuntos, 107 Condiciones, 138 Averías / Reparaciones, 41 Historial de cambios, 42 Bloqueos vigentes en gestiones.

Thus the UI formally distinguishes asset class/type labels and widget sets. Stable machine-level object class/type identifiers and the backend rule selecting those widgets remain pending. Identifiers happened to match within each candidate's two fields; do not generalize that equality.

## 5. Reproduction plan for Centrality Local — not implemented

1. Preserve the complete selected candidate, including separate `object_id`, `surrogate_in_map_id`, display text and optional pin location. Do not collapse by code or label.
2. For object-backed positioning, supply the **map surrogate** to the `get_objects_geojson` request's JSON array. For a pin-only candidate, follow the separate pin-location branch once its actual format and CRS are verified.
3. Parse the verified geometry response, transform into the local map projection, highlight the chosen geometry, and fit its extent with padding. Do not use `pin_location=null` to disable positioning.
4. Load the view definition using **object_id** and build its dynamic sections. Do not hardcode the pole's tabs for equipment.
5. Keep generated content and self-loading components as separate adapters. The former uses `get_widget_content`; the latter requires its own verified endpoint, scoping, pagination and record contract.
6. Use an explicit, verified consultation-only allowlist. Do not blindly execute action providers, tools, component configs, or arbitrary HTML/scripts from GNAT. A generator flag is not a read permission. A Local renderer should handle returned strings safely rather than copying GNAT's unrestricted HTML update behavior.

Steps 1–4 are supported by inspected client logic and UI observations, but not yet validated against complete network bodies. Exact backend envelopes, error handling and widget-specific scoping are required before treating a Local integration as complete. No Local code or architecture was inspected, so no specific file/module changes are prescribed.

## 6. Pending questions and next bounded investigation

- Obtain a permitted header-free request/response inspection capability, or explicit authorization for the full-header inspector. Do not bypass the current refusal.
- Confirm actual selection request body, GeoJSON response envelope, input CRS and object properties.
- Confirm object-definition and widget-content raw response envelopes and application-level success/error structures.
- Trace `LocationPartsGrid`'s object scoping and paging without executing unknown actions.
- Verify an explicitly chosen consultation widget manually; the present run only observed the automatically active Partes grid and headers.
- Determine a reliable read-only capability/permission signal. No such universal signal was established here.
- Confirm machine-level class/type IDs and compare the equipment's network requests, not only rendered metadata.
- Optionally inspect DC/DF views only under a further authorized bounded scope; do not recollect prior search evidence.

The DBC technical view was left open. No operational control was invoked. Investigation stopped without requesting or exercising broader permissions.
