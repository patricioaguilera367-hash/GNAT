# Local consultation flows and evidence

These flows describe inspected client behavior and proposed independent adapters. They do not implement GNAT replay or authorize new server actions.

## Selection and map positioning

1. E1 search returns candidates; preserve every object ID, map surrogate and display label.
2. E2 selection uses `surrogate_in_map_id` for object-backed positioning. The separate pin-only branch remains untested.
3. E2/E3 `objectsToFeatures` serializes a nonempty map-ID array for `get_objects_geojson`.
4. Consumer reads GeoJSON into the map projection, highlights features and fits their combined extent. Map view is EPSG:3857; tested samples use reader EPSG:4326 and a real point transform matched the map center (E8). No universal server declaration follows.
5. E8 confirms success/data Feature for singleton points/line and FeatureCollection for two IDs. Local must decode both, match by Feature.id and retain server bbox separately before transformation. Do not fabricate longitude/latitude from null pins or map centers.

## Technical view and widgets

1. E2 information trigger uses `object_id` to obtain the object definition.
2. Render native Local headers/tabs from safe definition fields; reject executable configuration.
3. A verified generated-content widget uses object ID plus backend widget ID(s); self-loading widgets need separate contracts.
4. Handle partial widget failures independently. A loading flag is not a permission flag. E8 confirms exposition read-only drives setReadOnly(true); row read_only=false is a different layer.

Observed FAP1783 sequence: search → positioning POST → definition POST → interleaved scripts/services → additional view-service POST → Partes request. Endpoint timing does not prove exact action or callback causality for every request. See the [original ordered network list](../GNAT_SELECCION_FICHAS.md).

## Code-list geolocation — proposed

Normalize/validate input → consult authorization-scoped cache → bounded serial searches → expose ambiguous candidates → retrieve selected map geometry → verify CRS → return per-input evidence/status → optionally load explicitly requested technical metadata. Detailed acceptance conditions: [GEOLOCALIZACION](GEOLOCALIZACION.md).

## Point identify versus inventory

E3 click handling transforms the clicked location to EPSG:4326 and requests `get_objects_info_for_point`, with viewport-scale context. The result consumer reads `id/display/description/type/image` (image not verified in the captured body); choosing original information opens `Web.showObjectView(id)`.

This is click-local identification, not an authorized area enumeration, exact feature geometry response, terminal linkage or global inventory. Do not sweep points/tiles to reconstruct an inventory.

## Current evidence boundary

Transient reception permission is resolved. Standalone discovery failed with zero records; no live observer attachment was verified. Parent MCP recovered existing bodies and bounded original client reads: two-ID geometry, click-local line identification and one line lookup. See [sequence](EVIDENCIA_CONFIRMADA.md). No area sweep or widget142 execution. New fixtures are transformed observed samples; synthetic fixtures remain distinct.
