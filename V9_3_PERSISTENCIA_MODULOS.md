# Centrality Local V9.3 — persistencia y modularización incremental

## Qué se integró

- Autosave cada 8 segundos si el proyecto cambió; también intenta guardar al ocultar/cerrar el panel. Se detiene cuando no hay cambios.
- Almacenamiento en `chrome.storage.local` bajo la clave `centrality_autosave`, dentro del perfil Chrome que tiene instalada la extensión. No es Google Drive ni sincronización entre equipos.
- Snapshot con **el mismo formato JSON V4 que la exportación manual**: registros, IDs, coordenadas, asociaciones, paleta, filtros, zonas, responsables, tipoEquipo, fechas y borrador Excel (incluidos códigos aún sin coordenadas).
- **Recuperar autosave** requiere clic y confirmación: no carga ni sobrescribe automáticamente al entrar a GNAT. El importador JSON existente vuelve a validar todo antes de sustituir el mapa.
- La copia inicial no sobrescribe una copia guardada: solo se graba tras cambios reales. Si el proyecto queda vacío, no borra el último respaldo no vacío.
- El panel indica guardado correcto o error; no se afirma éxito antes de que Chrome confirme `storage.local.set`.

## Estructura actual

```
GNAT_Extension_V9/
  manifest.json                 Configuración MV3 (activeTab, scripting, storage)
  background.js                 Valida pestaña e inyecta archivos por orden
  centrality_v9.js              V9.2 base: panel, ventanas, GNAT y atlas legado
  src/background/storage-bridge.js  Mundo ISOLATED: único acceso a storage
  src/core/state.js            Serializador JSON compartido
  src/core/autosave.js         Calendario, cambios, respuestas y estado
  src/gis/map-bridge.js        Localización del mapa OpenLayers autorizado
  src/ui/grid-engine.js        Parser 2D de clipboard, sin librerías
```

Se mantiene el núcleo visual restante en `centrality_v9.js` para **no reescribir** en esta versión las conexiones entre la hoja Excel y GNAT. A futuro pueden extraerse las ventanas, sus estilos y el lector KMZ a módulos separados sin añadir bundler. No son módulos ES importados dinámicamente: Chrome los inyecta en orden, con JS plano.

## Límites y precauciones

- El autosave es un **respaldo de emergencia**, no sustituye guardar el JSON manualmente después de planificar una faena.
- Chrome local tiene cuota limitada (aprox. 10 MB por extensión, según navegador/políticas); si el respaldo excede esa cuota aparece un error. El proyecto normal sigue utilizable.
- Hay una sola copia más reciente por perfil/extensión, no una biblioteca de proyectos: trabajos o pestañas simultáneos pueden reemplazarse entre sí tras cambios. Guarda un JSON distinto por trabajo.
- Los datos se procesan en la sesión GNAT y se guardan localmente por la extensión. Como el script se ejecuta en la página autenticada, no debe usarse en una página de origen no confiable.
- La versión V9.2 original, los formatos de importación JSON 1–4, los colores por supervisor y las X rojas se mantienen.
- La prueba Chromium es con OpenLayers y almacenamiento simulados; no demuestra ejecución en GNAT real ni en el contenedor aislado de una extensión de producción. La prueba real requiere tu sesión autorizada.
- GNAT no se modifica y las asociaciones de puntos son datos de planificación; no prueban aislamiento eléctrico.

## Verificación local

```
node --check GNAT_Extension_V9/centrality_v9.js
node --test tests/extension-v9.test.cjs
```

## Actualizar en tu equipo

```
cd "$env:USERPROFILE\Desktop\GNAT-Centrality"
git pull origin main
```

Luego pulsa **Actualizar** en `chrome://extensions`, guarda cualquier JSON con cambios, recarga GNAT y vuelve a iniciar la extensión. Comprueba el estado y botón **Recuperar autosave**.
