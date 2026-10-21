# Proposed Local evidence-preserving data model

This is a **proposal**, not a recovered GNAT database schema. Existing evidence and gaps are in [CONTRATOS](CONTRATOS.md).

| Entity | Required separation and provenance |
| --- | --- |
| QueryInput | Original code, normalized code, request order and per-input outcome; do not silently change a code |
| SearchCandidate | Source, object ID, independent map surrogate, raw display label, exact-match confidence, unverified pin location, evidence reference |
| AssetIdentity | Source-scoped object ID as opaque identifier; verified machine class/type when available; display labels separately |
| GeometryObservation | Map surrogate, returned feature ID independently, geometry, original server bbox, separate derived extent, source CRS confidence, timestamp and response reference; tested Feature.id matching does not establish universal ID equivalence |
| ObjectDefinition | Object ID, definition version/hash, separate widget sections; reject unknown executable behavior |
| WidgetObservation | Object ID + backend widget ID, verified read adapter, content schema, observation/error status |
| AssetAssociation | Parent/child or host/equipment relationship, relation type and evidence class; displayed breadcrumb is not field verification |
| NetworkConnection | Explicit source terminal/node/edge relationship, phase/state/direction and provenance; not proximity-based |

## Domain constraints

- A code is not a primary key. F514139 returned pole/DC/DBC/DF candidates; F56822 included longer codes and duplicate display labels with distinct IDs (E1).
- `object_id` selects the technical view; `surrogate_in_map_id` supplies the map lookup in inspected client logic (E2). Matching example values do not make the fields aliases.
- Preserve leading/bracketed codes as separate observed label portions until their formal semantics are verified. Do not reinterpret `[F66023]` as corruption automatically.
- User context: S/E means substation; transformer CD of S/E and pole COD represent different identifiers. System-versus-field discrepancy is a separate possibility, not the default explanation.
- Formal machine type IDs are pending. UI class labels now distinguish pole/DBC/DC/DF/line, but label parsing alone must not authorize type-dependent behavior.
- `pin_location:null` is not proof of missing geometry; geometry lookup is a separate observation.

## Illustrative synthetic record

Not a GNAT response; schema names below belong to the proposed Local model.

```json
{"inputCode":"POLE_A","objectId":"1001","mapSurrogateId":"9001","geometryStatus":"unverified","sourceCrs":null,"assetTypeStatus":"unverified","evidenceClass":"synthetic"}
```

DC28557387 displays Seccionador, DC POLE TOP 900A 25KV; DF28557371 displays Interruptor-seccionador con fusibles, DESCONECTADOR FUSIBLE EMPRESA. DF breadcrumb is F514139 -> F66023 -> F514139 [F66023]. Preserve that intermediate display association, not an inferred physical host/electrical connection or formal bracket-code meaning. These are UI-only observations, no new raw DC/DF bodies.

IDs are modeled as opaque strings to avoid numeric precision/coercion errors. Normalize digit strings or safe integer numbers only; reject precision-lost numbers, never merge identifier roles. Never equate a search candidate ID, point-identify `id`, returned feature ID, terminal ID or circuit ID without explicit linking evidence. Geometry and electrical connectivity remain distinct tables even when their coordinates coincide.
