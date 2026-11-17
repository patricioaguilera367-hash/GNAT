# gnat-probe-v1 — lector de sección 23 y digerido del probe

Extensión de diagnóstico read-only sobre el mapa GNAT. Objetivo: cerrar **U1**
(¿los tramos MT exponen códigos de extremo y geometría?) y **U2** (¿se puede leer
el estado abierto/cerrado de un aparato de maniobra?).

Archivos: `tools/gnat-probe/probe-mt-aperturas.js`,
`tools/gnat-probe/probe.selftest.mjs`, `tools/gnat-probe/README.md`.
Rama `feat/v10-mt-probe`.

## Specs

**S1 — La sección 23 se lee como texto, no por `Acs.request`.**
`elec_addons_cm_object_data_section.php` responde **HTML**, no JSON. `Acs.request`
intenta decodificarlo y falla con el mensaje exacto
`You're trying to decode an invalid JSON String: <div class='section'>…`.
El reader debe usar `fetch` same-origin (`credentials: "same-origin"`) y
`response.text()`, con timeout propio. Si `fetch` no existe o falla, debe
reintentar por `Acs.request` y **rescatar el HTML del mensaje de error** quitando
el prefijo hasta `invalid JSON String:`. Nunca debe perder el HTML.

**S2 — Campos verbatim que hay que extraer de esa sección.**
De la respuesta real de `object_id=9446883` (Desconectador Fusible F517572):

```
Estado operativo: normalmente cerrado (NC)
Tensión del circuito: 13.2 kV
Comportamiento de red por fase
  Real (desde 08/04/2026 18:30:00 -04)
  R: cerrado   S: cerrado   T: cerrado
  Normal
  R: cerrado   S: cerrado   T: cerrado
```

Debe producir `estadoOperativo`, `tensionCircuito`, y `phases` con la forma
`{ real: { desde, R, S, T }, normal: { R, S, T } }`. `desde` conserva el texto
tal cual aparece entre paréntesis. Los valores de fase conservan su literal
(`cerrado`).

**S3 — `Vecinos` es una tabla con la topología real.**
Columnas observadas: `Id`, `Tipo`, `Id de negocio`, `Navegación`. Cada fila trae
el id dentro de un enlace `cm_object_data.php?id=NNN` y su clase en `Tipo`.
Filas reales de `F517572`:

| Id | Tipo | Id de negocio |
|---|---|---|
| `Borne #1 de F517572` (9446884) | `Borne` | `-` |
| `Borne #2 de F517572` (9446885) | `Borne` | `-` |

Debe devolverse como `vecinos: [{ id, etiqueta, tipo, idNegocio }]`. Además, el
markup trae `gis_highlight_objects([9446884,9446885], true)`: extraer esos ids en
`neighborIds` y además la lista de enlaces `cm_object_data.php`,
`dms_operations.php` y `elec_addons_cm_object_data_section.php` en `links`.

**S4 — `net_model_id` 2 = Normal, 3 = Real.**
Los scripts inline usan `net_model_id: 3` bajo el encabezado `Real` y
`net_model_id: 2` bajo `Normal`, con `action: 'paint_upstream_flow'` y
`start_node_id`. Registrar esa correspondencia en el reporte como dato leído, y
**no ejecutar** nada de ese HTML ni de esos scripts.

**S5 — El resumen debe alcanzar para decidir.**
`copySummary()` incluye `verdict`, y por caso: `resolved`, `geometryAttempts`,
`objectsSample` (máximo 25 entradas con `id`, `type`, `display`) de lo que
devolvió `get_objects_info_for_point`, y por cada sección parseada
`estadoOperativo`, `tensionCircuito`, `circuito`, `phases`, `vecinos` (máximo 10
filas por objeto) y `netModels`. Debe seguir siendo mucho más chico que
`copy()`.

**S6 — Copiar sin foco.**
En la corrida real `navigator.clipboard.writeText` falló con
`NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Document is not focused.`
`copy()` y `copySummary()` deben: intentar `navigator.clipboard.writeText`; si
falla, reintentar con un `textarea` oculto + `document.execCommand('copy')`; si
también falla, escribir el payload con `console.log` y dejarlo en
`__gnatProbe.lastPayload`. Nunca deben lanzar.

**S7 — Diagnosticar el caso "cero tramos".**
En la corrida real ambos casos dieron `pointFound: true` con `spans: 0` y nada
que explique por qué. Cuando no se clasifique ningún tramo, el resumen debe
traer `spanDiagnosis` con: cuántos objetos devolvió el point query, el conteo por
`type`, y `objectsSample`. No inventar conclusiones: solo reportar.

**S8 — Sigue siendo read-only.**
Solo GET. Nunca asignar HTML remoto a `innerHTML` ni ejecutarlo. Timeout propio
en cada request. No abortar requests ajenos. La única mutación permitida es la
vista del mapa, que se restaura.

**S9 — Verificación.**
`node tools/gnat-probe/probe.selftest.mjs` debe seguir verde y cubrir S1–S7 con
`fetch` stubbeado devolviendo el HTML real citado en S2/S3, incluido el camino de
rescate desde el mensaje de error de `Acs` y el fallback de copiado.

## Tasks

- **T1** — Implementar S1–S9 en el probe, el self-test y el README. Un commit
  sobre `feat/v10-mt-probe`.

## Log

**L1** — «Te he dejado una carpeta llamada context, necesito que la leas.»

**L2** — «Ok inicia con eso, ademas inicializa el github
https://github.com/patricioaguilera367-hash/GNAT en esta carpeta que usaremos
como ruta origen.»

**L3** — Corrida de campo 1 (`F51757`): el código es una `Subestación MT/BT`, no
un poste; `textual_search` matchea por prefijo; ids enviados como string fueron
rechazados con `JSON value is not numeric`; `pin_location` siempre `null`.

**L4** — Corrida de campo 2 (`F517570`, `F517572`): `pointFound: true` pero
`spans: 0` y `lineStrings: 0` en ambos casos; `devicesFromSearch: 2` en
`F517572`. La sección 23 se pidió por `Acs.request` y falló con el error de
decodificación JSON citado en S1, cuyo mensaje contenía el HTML completo de S2/S3.
`copySummary()` y `copy()` fallaron por falta de foco (S6).

**L5** — «si sigamos.»

**L6** — T1 se implementó inline: el worker delegado falló dos veces con
`unavailable` del proveedor y no escribió nada en ninguno de los dos intentos
(verificado: el probe seguía en v1.2.0). S1–S7 quedaron cubiertos y el self-test
está verde.

**L7** — El self-test encontró un cuarto defecto antes de salir: `Jerarquía de
red` repite los encabezados `Real` y `Normal` debajo de `Comportamiento de red
por fase`, así que un parser ingenuo reiniciaba el bloque que acababa de llenar y
todas las fases volvían `null`. Corregido: un encabezado nunca reinicia un bloque
con valores, y un bloque sin ningún valor de fase se descarta.

**L8** — Tercera corrida. Muestrear el poste `F517570` devuelve el poste y dos
tirantes: cero tramos. Muestrear el medio del tramo en
`(-72.853019, -37.886501)` devuelve el tramo real. **U1 queda respondida:**

```
id 477763812  type "Alambre Cu Duro Des 6 AWG 1-fas MT"
              display "F562540 - F562541"
              title "Detalle de Cable F562540 - F562541"
id 35144088   type "Alambre Cu Duro Des 6 AWG 1-fas BT"
              display "F562540 - F562541"
```

Los códigos de extremo sí están en `display`. La clase (`Cable`) sólo aparece en
el título de la ficha: `type` es el material del conductor. Por eso la
clasificación por etiqueta fallaba y ahora se complementa con
`get_object_definition`.

Hallazgo adicional: en el mismo punto hay **dos cables apilados**, MT y BT, sobre
el mismo par de postes. El cruce BT que se había diferido a la iteración 2 existe
en el primer tramo medido; por eso cada tramo lleva nivel de tensión y el resumen
lo cuenta en `spansByVoltage`.

Sigue sin verificarse la geometría (`get_objects_geojson` sobre un id de cable) y
el estado abierto/cerrado de un aparato **en MT** (sólo se observó en un DF de
BT).


