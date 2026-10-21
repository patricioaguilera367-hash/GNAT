# V9 — reorganización de interfaz (propuesta de prueba)

- V8 preservada como referencia. V9 mantiene el mecanismo de extensión sobre GNAT.
- Mapa compacto, búsqueda/filtro de zonas y detalle WMTS +1/+2 a la vista.
- Atlas A1/PDF oculto (código aún presente, sin certificación de impresión).
- Planilla con zonas D1, D2 y nombres humanos, supervisor responsable y color de zona.
- Panel Editar zona permite pegar códigos de postes y aperturas **ya presentes en el catálogo**; no geolocaliza desde GNAT.
- Los puntos pueden tener un color propio opcional; X de aperturas siguen siempre rojas.
- Tipo de equipo en aperturas (campo descriptivo manual), sin validación eléctrica.
- JSON versión 4 conserva paleta de zonas, responsables, tipos y colores propios. Admite JSON 1–3 anteriores.
- CSV solo exportación legible desde la planilla; sin IDs internos; importaciones heredadas ocultas.
- La paleta de categorías heredadas (Verde, Naranjo, Azul) sigue disponible en filtros avanzados; la creación de zonas de colores ilimitados es independiente.

## Límites

- No hay resolución automática de coordenadas GNAT ni consultas de red.
- El atlas/PDF no está validado; no expuesto.
- Esta versión no es un sistema de determinación de maniobras; las asociaciones son manuales.
- Probada sobre un mapa simulado con Playwright; falta prueba end-to-end en GNAT autenticado.
