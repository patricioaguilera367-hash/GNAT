# Arquitectura: núcleo local e integración opcional

Se conserva el piloto modular. Ninguna consulta GNAT escribe en `puntos`; mapa, tabla y SQLite pueden usarse sin GNAT.

```text
KMZ/KML/CSV -> app/importers.py -> app/db.py -> app/server.py -> web/app.js
Captura autorizada JSON+PNG -> app/captures.py -> API local -> web/map.js
Estado desconectado / MOCK -> app/integrations/gnat.py -> API local -> web/gnat-client.js
                                                              -> capa opcional del mapa
Portal oficial -> snippet diagnóstico MANUAL -> TXT/JSON saneado por clic
```

## Responsabilidades

| Archivo | Límite |
|---|---|
| `app/db.py` | Puntos locales, índices, supervisores y búsquedas exactas; ningún dato GNAT |
| `app/importers.py` | CSV histórico/v6, KML y KMZ; validación previa a cualquier reemplazo |
| `app/server.py` | HTTP loopback, validación Host/Origin, CSP y rutas locales |
| `app/captures.py` | Capturas PNG + manifiesto local, sin capturador remoto |
| `app/integrations/gnat.py` | Contrato desconectado, fixtures, GeoJSON/errores/metadatos; sin cliente HTTP |
| `web/gnat-client.js` | Ficha GNAT/MOCK, estado, texto seguro, capa optativa; no importa puntos |
| `web/map.js` | Canvas WebMercator; puntos, X, capturas y geometría opcional separada |
| `bridge/diagnostico_contrato_gnat.js` | Monitor pasivo del origen oficial; no conecta localhost |

`layerProviders` describe capturas locales disponibles y WMTS no disponible. El mapa actual conserva el renderizado de capturas; no se crea un framework de proveedores ni un transportador WMTS especulativo. OSM es un fondo optativo, apagado por defecto.

## SQLite y transición reversible

La tabla de negocio sigue siendo `puntos`. Se añaden `clase` (`recorrido` por defecto), `import_id` y `bloques` (lista JSON). `tipo` sigue describiendo poste/subestación/otro; no se confunde con la clase recorrido/apertura. En el CSV conjunto, el encabezado `ClasePunto` identifica esta nueva clase; `Clase` conserva su significado histórico como alias de `Tipo`. Así pueden coexistir ambas columnas sin colisión de importación.

Al abrir un esquema anterior, primero se genera una copia SQLite consistente `puntos.sqlite3.pre-<UTC>.bak` usando la API `backup`; después se añaden solo columnas ausentes. La migración es idempotente, sin DROP, renumeración ni pérdida de campos. Las pruebas usan un esquema legado independiente y comprueban el respaldo antes del ALTER.

Cada importación valida todas las filas antes de borrar/insertar, en una transacción. Solo reemplaza las clases presentes. El API devuelve 409 y `requires_confirmation` cuando esas clases ya contienen puntos; la UI solo reenvía con `confirm_replace=1` después del sí explícito. Exportar CSV no reemplaza un respaldo completo de `datos`.

Rollback: detener el servidor, preservar los nuevos datos aparte y restaurar una **copia** del `.bak` con el código anterior. No abrir una copia activa simultáneamente con dos versiones. Para deshacer la nueva distribución sin datos añadidos, se puede volver al piloto original intacto; no se debe eliminar el original ni sus capturas.

## GNAT sin retención corporativa automática

`DisconnectedAdapter` implementa las operaciones neutrales y devuelve desconexión real. `FixtureAdapter` es una selección explícita, nunca una conexión validada. Las rutas `/api/gnat/mock` no comparten importadores ni funciones de escritura de puntos.

Los resultados contienen ID normalizado, código/nombre, tipo, GeoJSON WGS84, procedencia, hora y error estructurado. `raw_response` solo permanece en memoria del resultado diagnóstico; `public_result` lo elimina del límite HTTP. Los metadatos HTML/widgets se convierten a texto; la UI usa `textContent`, no `innerHTML`.

No se añade `gnat_cache.py` ni tabla de caché: no hay necesidad funcional ni permiso de retención demostrado. Borrar ficha elimina el estado efímero y la capa opcional. Vincular/actualizar/desvincular activos oficiales no está implementado porque no existe un vínculo real. Cualquier futura sincronización exigirá autorización y confirmación explícita, sin sobrescribir KMZ/supervisores automáticamente.

## API compatible

| Método/ruta | Resultado |
|---|---|
| GET `/api/health`, `/api/points` | Estado local / puntos con campos previos + campos aditivos |
| POST `/api/import?filename=...` | Archivo validado; 409 requiere confirmación antes de reemplazar |
| PATCH `/api/points/{id}` | Atributos por ID SQLite, no número visible |
| POST `/api/supervisores`, `/api/batch` | Asignación / búsqueda exacta local |
| GET `/api/export.csv` | CSV compatible con campos aditivos para conservar clases/IDs/bloques |
| GET `/api/export.csv?kind=route` o `opening` | Esquemas v6 independientes con coma decimal |
| GET/POST/DELETE `/api/captures...` | Rutas de capturas originales |
| GET `/api/gnat/status` | Estado desconectado, `validated:false` |
| POST `/api/gnat/mock` | Solo fixtures locales: `query`, `asset_types` o `object_id` |

No hay ruta de consulta remota, proxy abierto, credenciales, almacenamiento del navegador ni SDK externo. CSP permite imágenes OSM solo por la opción explícita; `connect-src` permanece en `'self'`.

## Verificación y límites

Pruebas Python de parsers, migración y contratos; HTTP real loopback con datos temporales; pruebas Node de mapa/ficha/monitor mediante stubs estándar. Las respuestas 401/403/timeout/success:false son casos simulados del normalizador, **no evidencia de acceso al servidor**. No se ejecutó Chrome autenticado ni el diagnóstico en GNAT. No hay atlas ni descarga masiva.
