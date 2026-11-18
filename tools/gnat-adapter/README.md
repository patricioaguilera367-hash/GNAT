# gnat-adapter — motor de Zona Desconectada

Librería silenciosa: sin DOM propio, sin mutar el mapa. Responde una sola cosa:
**dados los postes donde se va a trabajar, qué tramos quedan desenergizados y qué
aparatos de maniobra los aíslan.**

## Instalación como extensión (recomendado)

Cada versión se compila a su propia carpeta cargable:

```bash
node tools/build-extension.mjs 1.5
# → build-versions/v1.5/
```

Después: `chrome://extensions` → **Modo de desarrollador** → **Cargar
descomprimida** → `build-versions/v1.5`.

Cada build es autocontenido (manifest, background, V10, tools y el adaptador) y
lleva el número en el nombre, así podés tener 1.5 y 1.6 cargadas a la vez y ver
cuál es cuál. `build-versions/` no se commitea: se regenera desde el commit.

**Numeración:** esta línea avanza 1.5, 1.6, 1.7… Después del merge con V10 sigue
como 11.0, 11.1, 11.1.1.

## Inyección en la extensión

`background.js` inyecta en `world: "MAIN"`, así que la librería comparte mundo con
`webMap_`, `Acs` y `Ext`. Los dos archivos ya figuran en sus dos listas `files`,
antes de `centrality_v10.js`.

1. `chrome://extensions` → activar **Modo de desarrollador** → **Cargar
   descomprimida** → la carpeta del repo.
2. Recargar la pestaña de GNAT y abrir la extensión.
3. En la consola: `__gnatZone.version` → `"1.5.0"`.

No hay que pegar nada nunca más. Al recargar la extensión, recargá también la
pestaña: el service worker nuevo reinyecta los archivos.

## Cargar en la consola (sin extensión)

```js
// 1. el motor
// (pegar tools/gnat-adapter/gnat-adapter.js)
// 2. el transporte GNAT
// (pegar tools/gnat-adapter/gnat-adapter.browser.js)

await __gnatZone.findWorkZoneLive(["F517570", "F517572"])
```

`findWorkZoneLive` arma el cliente y devuelve el resultado completo. Para tests o
para otro transporte, usar `findWorkZone({ poleCodes, client })` con un cliente
propio.

## Contrato del cliente

| Método | Devuelve |
|---|---|
| `search(term)` | filas de `textual_search` (`object_id`, `surrogate_in_map_id`, `display`) |
| `geojson(ids)` | `get_objects_geojson` — Feature, FeatureCollection, array o geometría |
| `pointObjects(lon, lat)` | filas de `get_objects_info_for_point` (`id`, `display`, `type`) |
| `objectTitle(objectId)` | título de la ficha (`Detalle de Cable …`, `Desconectador …`) |
| `sectionHtml(objectId, sectionId)` | HTML crudo de la sección (23 para estado) |

## Verificar una apertura elegida por el supervisor

El motor **no propone** la apertura óptima: eso lo decide el supervisor con
criterio propio. El motor verifica si la decisión aísla la zona.

```js
await __gnatZone.verifyAperturasLive({
  workCodes: ["FAG1674", "FAG1665", "FAG1666", "FAG1671", "FAG1667"],
  // `side` es el lado del poste que corta el aparato: "a", "b" o "both".
  openCodes: [{ code: "FBE9179", side: "both" }, { code: "FF4840", side: "both" }],
  settings: { maxRequests: 400, maxMilliseconds: 30000, readSources: true },
})
```

Un aparato **no hace desaparecer el poste**: corta un lado. Abrir un lado deja el
poste alimentado por el otro —queda un remate con tensión— y sólo abrir los dos
lados lo aísla. Por eso `openCodes` acepta el lado, y `poleStates` informa cada
poste por separado:

```js
poleStates: [
  { code: "FAG1674", role: "ambos",  live: "desconocido", reason: "el aparato corta un solo lado..." },
  { code: "FBE9179", role: "apertura", live: "desconocido", reason: "se abre el lado a: el lado opuesto puede seguir energizado" },
  { code: "FAG1665", role: "trabajo", live: "no", reason: "dentro de la isla cerrada" },
]
```

`live` sólo vale `"no"` con evidencia: isla cerrada, o `side: "both"` en el
aparato. Un poste que es trabajo y apertura a la vez nunca se declara sin
tensión, y eso alcanza para que `valid` sea `false`.

Camina el grafo MT desde los postes de trabajo, se detiene en cada apertura y
devuelve la isla que quedó cerrada:

```js
{
  valid: true | false,
  reason: "zona aislada: 2 apertura(s) cierran la isla",
  island: ["FAG1674", "FAG1665", ...],   // lo que queda sin tensión
  boundary: ["FBE9179", "FF4840"],        // las aperturas que la cierran
  poleStates: [{ code, role, live, reason }],
  sources: [{ code, objectId, title }],   // si sigue alimentada, acá está
  unresolved: [code],                     // lo que el presupuesto no alcanzó
}
```

**`valid: true` sólo con evidencia completa.** Si el presupuesto se agota, si un
poste no resuelve a un punto o si no se alcanzó ninguna apertura, devuelve
`false` con el motivo. Una caminata a medias nunca aprueba una apertura.

## Auditar un permiso hecho a mano

Reconstruye el permiso desde la red y lo compara con lo que escribió el supervisor:
puntos, envolvente, tramos, aparatos, etiquetas y la verificación de aperturas.

```js
await __gnatZone.auditPermitLive(
  {
    objectCode: "FAG1672",
    workCodes: ["FAG1674", "FAG1665", "FAG1666", "FAG1671", "FAG1667"],
    openCodes: [{ code: "FBE9179" }, { code: "FF4840" }],
    groundCodes: ["FAG1674", "F723320"],
    siteCodes: ["FAG1672", "FAG1665"],
  },
  { settings: { maxRequests: 800, maxMilliseconds: 60000, readSources: true } }
)
```

Devuelve:

```js
{
  status: "consistente" | "inconsistente",
  points: [{ code, role, lonlat, objectId, label }],   // todo lo declarado, resuelto
  missing: [{ code, role, reason }],                   // lo que la red no tiene
  network: { spans, devices },                         // lo que hay alrededor
  outline: [[lon, lat], ...],                          // envolvente de la zona
  labels: [{ objectId, code, title, isDevice }],
  verification: { valid, reason, island, boundary, poleStates, warnings },
  findings: [{ level, text }],                         // bloqueante | advertencia | info
  voltages: ["mt"],
}
```

La envolvente es la cápsula convexa: en una radial recta degenera en un segmento,
que es la verdad geométrica, no un error.

`status: "inconsistente"` si algún código no resuelve, si la verificación falla o
si el presupuesto cortó un anillo. Los aparatos que están dentro de la zona y no
figuran como apertura salen como advertencia: ahí es donde falta una maniobra.

## Salida de `findWorkZone`

```js
{
  status: "delimitada" | "parcial" | "no concluyente",
  reason: string,                  // por qué se detuvo, en castellano
  resolved: [{ code, lonlat }],
  unresolved: [code],
  zone: { codes, edges, voltages }, // edges: { from, to, voltage, id, display }
  boundary: [{ id, title, estado, estadoTexto, realDesde }],
  budget: { requests, maxRequests, elapsedMs }
}
```

## Reglas que no se negocian

- **`desconocido` no es `cerrado`.** Si la sección 23 no expone estado, el aparato
  se informa igual, sin estado. Nunca se asume maniobra realizada.
- **Sólo un par de códigos de poste es arista.** `Trintre - Colonia Miraflores` es
  un par de localidades y no entra al grafo.
- **MT y BT no se mezclan.** Una misma arista física lleva las dos tensiones; se
  informan por separado y no se colapsan.
- **Presupuesto primero.** 60 requests / 45 s por defecto. Al agotarse devuelve lo
  medido con `status: "parcial"` y su motivo; si no midió nada, `no concluyente`.
- **Una consulta por poste.** `get_objects_info_for_point` recibe `scale` (capas) y
  `units_per_pixel` (radio de captura) por request, así que un poste cuesta **1
  request** y no 6. Medido: sin calibrar devuelve 17 objetos y 0 tramos; calibrado
  con `scale: 250, units_per_pixel: 0.85` devuelve 5 objetos y 2 tramos.
- **Cuidado con el orden.** `Ext.apply(base, viewportParams)` pisa `scale` y
  `units_per_pixel`: hay que aplicarlos después.
- **Reloj compartido.** Auditoría y verificación usan el mismo contador: el
  presupuesto es total, no por fase.
- **Progreso visible.** `[gnatZone] 20 requests · 34 s` cada 20 requests, para que
  una corrida larga no parezca colgada.

## Verificar sin navegador

```bash
node tools/gnat-adapter/gnat-adapter.selftest.mjs
```

Contra las formas reales ya registradas: tramo MT, tramo BT, pseudo-tramo de un
solo código, sección 23 cerrada, sección 23 sin estado, y presupuesto agotado.
