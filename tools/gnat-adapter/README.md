# gnat-adapter — motor de Zona Desconectada

Librería silenciosa: sin DOM propio, sin mutar el mapa. Responde una sola cosa:
**dados los postes donde se va a trabajar, qué tramos quedan desenergizados y qué
aparatos de maniobra los aíslan.**

## Cargar en la consola

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

## Salida

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
- **Presupuesto primero.** 24 requests / 8 s por defecto. Al agotarse devuelve lo
  medido con `status: "parcial"` y su motivo; si no midió nada, `no concluyente`.

## Verificar sin navegador

```bash
node tools/gnat-adapter/gnat-adapter.selftest.mjs
```

Contra las formas reales ya registradas: tramo MT, tramo BT, pseudo-tramo de un
solo código, sección 23 cerrada, sección 23 sin estado, y presupuesto agotado.
