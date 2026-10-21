# Centrality Local V9.2 — Fusión

**Origen:** V9.1 del repositorio + `centrality_v9(2).js` recibido.

## Conserva de V9.1
- Panel compacto, lista de navegación y búsqueda filtrada.
- Color de poste por supervisor; X de apertura siempre roja.
- Gestión de zonas, nombre humano, responsable y color de referencia.
- JSON versión 4 y referencias compartidas a aperturas.
- Botones `Original`, `Forzar +1`, `Forzar +2`.

## Incorpora del archivo nuevo
- Planilla Excel avanzada con selección de rangos, copiar/pegar y navegación por teclado.
- Hojas Recorrido, Ingreso masivo y Catálogo de aperturas.
- Edición de códigos visibles y sus asociaciones, sin exponer IDs como columnas.
- Borradores incompletos dentro del JSON, sin inventar coordenadas.

## Límites conocidos
- No consulta automáticamente las coordenadas a GNAT: nuevos códigos sin coordenadas quedan pendientes.
- El ingreso masivo admite cuatro aperturas por fila; si la zona necesita más, usar la vista Zonas.
- No abrir simultáneamente ambas ventanas de edición; sus datos se sincronizan al mapa.
- Cambiar de Zonas a Excel con modificaciones incompletas exige corregirlas primero.
- Faltan pruebas en una sesión real de GNAT.
