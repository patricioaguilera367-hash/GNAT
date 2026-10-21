# Centrality Local

Visor modular Windows + Python estándar + SQLite. **GNAT está desconectado**: la ficha opcional funciona con fixtures **MOCK**, sin consultas corporativas ni cambios automáticos a sus puntos.

## Probar en Windows

1. Extraiga `centrality-local.zip` en una carpeta local.
2. Compruebe Python 3.11 o posterior: `python --version` (o `py -3 --version`). No instale paquetes pip.
3. Abra `INICIAR.bat`. Si no se abre el navegador, visite `http://127.0.0.1:8765`. Alternativa: `python iniciar.py`.
4. Importe `examples/recorrido.csv` y después `examples/aperturas.csv`: ambos tipos deben coexistir. Son datos de demostración, no coordenadas recuperadas del usuario.
5. Filtre por bloque, cambie supervisores y pruebe números/códigos independientes en **Capas**. Las aperturas usan X; sin asignar se muestra rojo, pero no es un supervisor.
6. En **GNAT**, pulse **Buscar fixture MOCK** con `F5353`. Active voluntariamente su capa. Pruebe `SINTETICO_LINEA` o `SINTETICO_MULTILINEA`; **NO** representan el tramo real F5353–F5352.

Para salir: Ctrl+C en el servidor. El paquete empieza sin base ni capturas privadas. Si ya tenía datos, mantenga una copia completa de su carpeta `datos`; con el servidor detenido, puede copiarla al nuevo directorio. No sustituya su única copia. La primera migración crea un respaldo de la BD antes de añadir columnas.

## Datos y compatibilidad

- KMZ/KML: solo puntos, nunca convertir vértices de rutas en activos. Los formatos CSV anteriores siguen disponibles.
- Recorrido v6: `ID;Numero;Subestacion;Longitud;Latitud;SupervisorColor;BloqueID`.
- Aperturas v6: `ID;Numero;Codigo;Longitud;Latitud;SupervisorColor;Bloques` (varios bloques con `|`).
- La exportación conjunta (por defecto o `kind=legacy`) usa `Tipo` para el tipo de activo y `ClasePunto` para recorrido/apertura. Se conserva el alias histórico `Clase` como tipo de activo; no se reutiliza con otro significado.
- `id` SQLite identifica selección/edición; `import_id` conserva el ID CSV; `numero` es visible y admite huecos. No se usa `Numero - 1` para localizar puntos.
- Importar coordenadas reemplaza **solo las clases presentes** (recorrido/apertura). Si ya existen puntos de esas clases, aparece confirmación antes de cambiar nada. KMZ/KML y CSV antiguos son recorrido por defecto.
- CSV sin coordenadas actualiza atributos únicamente con coincidencia única `Numero + Código`; no cambia coordenadas ni bloques existentes. Las coincidencias ambiguas no se eligen automáticamente.
- Coordenadas WGS84: longitud primero al usar GeoJSON. CSV admite punto o coma decimal y exporta `;`, coma decimal y BOM UTF-8 para Excel chileno. No lleva separador de miles.
- Un CSV dañado devuelve fila/columna y no reemplaza ningún punto. **No** se reconstruyen coordenadas corruptas por conjetura. Use el KML/KMZ original o un CSV corregido por su fuente.
- Supervisores: Verde, Naranjo, Azul; vacío/Sin asignar = rojo visual. Bloques de trabajo e identidad no son el color del supervisor.

## Cartografía y privacidad

OSM está **apagado al iniciar**. Activarlo en **Capas** envía solicitudes normales de teselas a OpenStreetMap; no hay precarga masiva ni descarga offline. Sin activarlo puede trabajar con puntos y capturas locales.

**Mosaico** conserva la importación de capturas georreferenciadas JSON/PNG. El snippet existente `bridge/exportar_vista_centrality.js` exporta únicamente la vista abierta, si su cuenta permite conservarla y el navegador lo permite. No se ha vuelto a probar dentro del portal en esta entrega. No eluda restricciones CORS ni de uso.

MT/BT/infraestructura observadas son **raster PNG WMTS**, no geometría vectorial masiva. El proveedor remoto está no disponible; no hay URL WMTS inventada ni cliente de autenticación.

## GNAT: qué puede hacer ahora

Contrato y normalización en `app/integrations/gnat.py`; UI independiente en `web/gnat-client.js`. Búsqueda exacta/ambigua de fixtures, Point del informe y líneas sintéticas, procedencia/hora, metadatos como texto seguro, capa opcional y borrado visible de ficha/capa. **Consultar GNAT** permanece deshabilitado.

No hay caché oficial SQLite, vinculación ni sobrescritura de puntos. El JSON crudo se conserva solo dentro del resultado diagnóstico en memoria; no se devuelve a la UI ni se guarda. Se difiere la importación manual de respuestas oficiales saneadas hasta acordar su formato y permiso de retención.

Para la conexión real, primero hace falta comprobar un servicio externo oficialmente autorizado; si no existe, evaluar un puente dentro del origen autorizado. Localhost/CORS/sesión **no están verificados**. No se copian cookies, tokens, contraseñas ni sesiones. Véase [contrato y diagnóstico](docs/CONTRATO_GNAT.md).

## Diagnóstico manual único (opcional)

`bridge/diagnostico_contrato_gnat.txt` contiene exactamente el mismo snippet que `.js`. Solo observa solicitudes que la interfaz oficial ya realiza; no hace consultas propias. Su panel permite detener/restaurar y exportar TXT/JSON saneado por clic. Siga el procedimiento de 30–60 segundos de [CONTRATO_GNAT.md](docs/CONTRATO_GNAT.md#una-ejecución-manual-de-30–60-segundos).

## Pruebas sin red externa

Desde la raíz:

```powershell
python -B -m unittest discover -s tests -v
node --test (Get-ChildItem tests/*.test.js | ForEach-Object FullName)
node --check web/app.js
node --check web/map.js
node --check web/gnat-client.js
node --check bridge/diagnostico_contrato_gnat.js
```

Node solo es necesario para pruebas de desarrollo, no para usar el visor. La suite usa DB/capturas temporales, HTTP loopback con puerto efímero y stubs de navegador. No abre sesiones corporativas ni descarga teselas. No sustituye una prueba visual manual en Chrome/Windows ni valida una API GNAT viva.

## Límites

Sin GNAT en vivo, exportación masiva, scraper, atlas/PDF A1, credenciales ni dependencias nuevas. El servidor escucha solo en loopback y rechaza escrituras desde otros orígenes. Si 8765 está ocupado, cierre la otra instancia. Respalde `datos` para conservar SQLite y capturas. Detalles: [arquitectura](docs/ARQUITECTURA.md), [cambios](docs/CAMBIOS.md).
