# Cambios de esta entrega

## Núcleo conservado

Se mantiene la aplicación Python/SQLite/canvas y sus rutas API; importaciones históricas, búsqueda exacta, edición/supervisores y capturas manuales. El piloto original y sus datos quedan fuera de la copia de trabajo y no se incluyen datos privados en el paquete nuevo.

## Compatibilidad v6 y mejoras v4

- Recorrido/aperturas coexisten; importación reemplaza solo su clase, con confirmación explícita si ya hay puntos.
- ID externo separado del ID SQLite y del número visible; numeración con huecos conservada.
- Bloques compartidos en aperturas y filtro independiente de supervisor; X de tamaño equivalente al punto y etiquetas de números/códigos independientes.
- Corregida la ida/vuelta de la exportación conjunta: `ClasePunto` distingue recorrido/apertura y conserva el alias legado `Clase` para tipo de activo, sin colisión con `Tipo`.
- CSV v6 de ambos tipos, separador `;`, coma decimal para Excel chileno. Coordenadas corruptas no se adivinan; rechazo completo con fila/columna.
- Migración aditiva idempotente con respaldo previo, sin borrar puntos existentes.
- KMZ inválido devuelve validación 400, no 500. OSM apagado por defecto, voluntario.
- Corregido el fallback de `INICIAR.bat`: CMD expandía `%errorlevel%` antes de la detección de Python dentro de un bloque; se usa evaluación runtime `if not errorlevel 1`.

## GNAT opcional realista

- Adaptador desconectado y fixtures explícitos; no hay conexión corporativa simulada.
- Point del informe; LineString/MultiLineString sintéticos separados, no geometría inferida de códigos.
- Ficha segura con procedencia/hora, capa optativa y borrado de sesión; consulta real deshabilitada.
- Normalización y errores de contrato probados sin transporte remoto; JSON crudo solo en memoria interna, sin caché oficial SQLite.
- Un diagnóstico pasivo manual en JS/TXT idénticos, acotado y restaurable. Acciones candidatas de fuentes guardadas se diferencian de confirmación viva.

## Pendientes explícitos

Contrato/permiso/API/sesión/CORS para conexión real; geometría real del tramo; importación manual oficial saneada; prueba visual manual en Chrome y ejecución del diagnóstico por el usuario. No se añaden módulos empresariales, scraper, atlas/PDF, autenticación ni instalaciones.

Pruebas y comandos en README; evidencias de desarrollo en `odd/tasks/centrality-gnat-integration.md` dentro del workspace (no requerido para ejecutar el paquete).
