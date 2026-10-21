# Contrato GNAT: evidencia, no promesas de conexión

**Estado entregado: desconectado.** Hay contrato aislado, fixtures MOCK y un diagnóstico pasivo. Ningún endpoint remoto fue invocado desde esta aplicación ni durante sus pruebas.

## Matriz de evidencia

| Tema | Observado / implementado | No observado o pendiente |
|---|---|---|
| Interfaz original | Según informe aportado: OpenLayers EPSG:3857, iframe del mismo origen, 40 capas | Independencia de iframe, cliente externo permitido |
| MT/BT/infraestructura | Informe: raster PNG WMTS; matrixSet `centrality`, niveles 0–20 | Acceso/condiciones desde localhost; vector masivo, descarga de zonas |
| Poste F5353 | Informe: ID 8659987, Point WGS84 `[-72.06376236,-37.780086409]` | Vigencia actual; exactitud de búsquedas remotas |
| Tramo F5353–F5352 | Informe: ID 8659985; identificación de objetos con descripción HTML | LineString/MultiLineString real del tramo; discrepancia 6/8 AWG sin resolver |
| Acciones | Nombres encontrados en cliente guardado, detallados abajo | Contrato vivo, autorización, parámetros obligatorios actuales |
| App local | SQLite/capturas, búsqueda exacta local, MOCK y errores probados sin red | Consultas GNAT reales, sesión/CORS de localhost |
| Importación oficial manual | Alternativa futura prioritaria si no hay conexión permitida | Formato/permiso de retención: función diferida, no usar importación de puntos |

El informe anterior observó HTTP 200 dentro del portal; **HTTP 200 no autoriza un cliente externo**. Su monitor ocultó los valores action. La lectura de fuentes locales aporta candidatos, no una nueva confirmación en vivo.

## Candidatos encontrados en fuentes locales

Referencias originales inspeccionadas, no dependencias ni archivos de esta distribución:

| Servicio / acción candidata | Fuente local | Solicitud / respuesta conocida |
|---|---|---|
| `svc_wmc.php` / `textual_search` | `Centrality - Mapa_files/map.js.descarga`, sección desde ~824 | Cliente usa búsqueda y campos `object_id`, `surrogate_in_map_id`, `pin_location`, `display`; informe registra `action,limit,page,query,start`. Forma real de cada resultado pendiente |
| `svc_wmc.php` / `get_objects_geojson` | mismo archivo, ~1546 | Cliente envía `object_ids` como JSON; informe observó `{success,data:Feature}` solo para Point |
| `svc_wmc.php` / `get_objects_info_for_point` | mismo archivo, ~1660 | `lonlat` + viewport; informe: `bounds,scale,units_per_pixel`; respuesta `data` array de `id,display,type,image,description` |
| `Web/component/svc_object_view.php` / `get_object_definition` | `ObjectViewDlg.js.descarga`, ~203 | `object_id`; informe: título, definiciones de widgets y message_error |
| mismo servicio / `get_widget_content` | mismo archivo, ~566 | `object_id,widget_ids`; contenido string/array, posiblemente HTML; cantidades de widgets variables |

`svc_web_services.php`, `svc_location.php`, `svc_condition.php` aparecen en el informe con nombres de campos; no se inventan acciones ni se consideran buscadores de postes. No hay exportación geográfica confirmada; solo se podrá evaluar una función ofrecida por la UI y autorizada. El monitor omite valores action desconocidos para evitar capturar secretos por una clasificación demasiado amplia.

## Contrato de la aplicación

Implementación Python: `app/integrations/gnat.py`.

| Operación neutra | Método | Estado actual |
|---|---|---|
| searchAssets | `search_assets(query, asset_types=None, pagination=None)` | Desconectado; MOCK exacto trim+upper, filtro y ambigüedad. No paginación remota inventada |
| getAssetGeometry | `get_asset_geometry(object_id)` | MOCK Point / líneas sintéticas; ID no conocido devuelve not_found |
| getAssetMetadata | `get_asset_metadata(object_id)` | MOCK textual, sin ejecución HTML |
| getAssetById | `get_asset_by_id(object_id)` | Composición de ficha MOCK |
| listAvailableLayers | `list_available_layers()` | Lista vacía: no confunde capas observadas con acceso disponible |
| getConnectionStatus | `get_connection_status()` | `validated:false`, desconectado; MOCK no se declara conectado |

Resultados: `{ok,data,error,consulted_at}`; activo normalizado con `id` string, `code/name`, `asset_type`, geometría WGS84, metadatos textuales, `source`, `consulted_at`, `synthetic`. El resultado interno también conserva `raw_response` en memoria; no se vuelca ni persiste. Líneas sintéticas usan IDs `SYN-LINE` y `SYN-MULTI`, no el ID del tramo real.

Errores diferenciados: desconexión, timeout, conexión, 401/403, HTTP distinto de 200, success:false, JSON inválido/vacío, campos ausentes y geometría inválida. El normalizador recibe respuestas de prueba; no ejecuta peticiones. No hay caché oficial SQLite ni actualización automática de puntos.

## Una ejecución manual de 30–60 segundos

Solo si su cuenta y organización permiten observar estas operaciones:

1. Abra Mapas en la sesión oficial ya autorizada. En DevTools seleccione el **contexto del iframe del mapa** que realiza las solicitudes; el snippet solo observa ese contexto, no otros marcos/orígenes.
2. En **Sources → Snippets**, cree un snippet y pegue íntegro `bridge/diagnostico_contrato_gnat.txt` (idéntico al JS). Ejecútelo. Aparece el panel **Diagnóstico GNAT · pasivo**.
3. Busque un código de su elección, seleccione un resultado y abra su ficha «i». Seleccione voluntariamente un tramo y abra su información. Si existe una función de exportación geográfica ofrecida por la UI, no la ejecute sin permiso; informe que existe y su etiqueta por separado.
4. En 30–60 segundos pulse **Detener y restaurar**, y luego **Exportar TXT** o **Exportar JSON**. La captura también se detiene a los 60 segundos. Revise el archivo antes de compartirlo. Use **Cerrar y borrar** para eliminarlo de memoria.
5. Entregue solo el archivo saneado, no HAR, cookies, solicitudes copiadas, fichas HTML ni capturas con credenciales.

El monitor no realiza ninguna solicitud. Solo envuelve fetch y XMLHttpRequest del contexto actual, sobre el mismo origen y los cinco nombres de servicio del informe. Retiene secuencia, servicio sin URL, acción funcional conocida, nombres de campos permitidos, HTTP, forma acotada y tipo de geometría. No registra códigos, IDs, coordenadas, valores de fichas/búsqueda, URL completa, headers, cookies, Authorization, tokens ni local/sessionStorage.

Límites: 24 muestras totales, 3 por servicio/acción, respuesta 64 KB, petición formulario inspeccionable hasta 16 KB, forma de 4 niveles/12 claves y exportación aproximada menor de 64 KB. Respuestas grandes, no JSON o no observables se marcan como tales. XHR con responseType JSON se omite (`unavailable_json_object`), porque no ofrece una cota fiable de bytes sin recorrer el objeto completo. Cuerpos Request/streams no inspeccionables no se clonan; acciones no incluidas en la lista segura se omiten. La instrumentación añade trabajo acotado, sin modificar las respuestas entregadas a la UI. Detener restaura solo sus propios hooks; no pisa herramientas que los hayan sustituido después.

**CORS localhost = NO_VERIFICADO.** Este diagnóstico no prueba autenticación externa, no reutiliza una sesión y no hace pruebas CORS. Una captura sin muestras tampoco demuestra ausencia de servicio: confirme primero el contexto correcto.

## Siguiente conexión permitida

1. Preferir API oficialmente documentada/habilitada para cliente externo con permiso explícito.
2. Si solo se permite el mismo origen, evaluar un puente mínimo allí, exclusivamente por acciones iniciadas por el usuario y resultados cuya retención está permitida.
3. Si ninguno es viable, acordar importación manual saneada como alternativa offline, separada de los puntos de trabajo.

No se implementa ninguno sin contrato/autorización. Se excluyen extracción de cookies/tokens, contraseñas guardadas, evasión CORS, Chrome inseguro, proxies abiertos, push no respaldado y descarga masiva. Una futura consulta significará petición bajo demanda con hora/error, no actualización en segundo plano.

## Pruebas realizadas

Python estándar: contrato desconectado/MOCK, coincidencia exacta/duplicada, geometrías, HTML/widgets, timeout, conexión, 401/403, success:false, JSON vacío/malformado y campos faltantes. HTTP loopback: estado y MOCK no modifican SQLite y no exponen raw_response. Node: texto inerte/XSS, estados/overlay y monitor con stubs, límites/origen/restauración. **No** se probó en el portal, no hubo tráfico externo y no existe una conexión GNAT validada.
