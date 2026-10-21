# Centrality Local — integración GNAT opcional

## Objetivo y alcance autorizado
Extender el piloto modular existente sin reescribirlo, contrastándolo con `v6.txt` y conservando las mejoras útiles verificadas en `v4.js`. Entregar una aplicación local demostrable, con integración GNAT aislada, datos MOCK explícitos y diagnóstico pasivo. Nombre estable: `centrality-local`.

## Restricciones
- Sin commits, staging, push ni PR: instrucción explícita del usuario. La rama aislada es `feat/gnat-integration`, todavía sin commits.
- No usar el repositorio ancestral de `C:/Users/Supervisor`: se inicializó uno exclusivo en esta carpeta.
- No modificar la copia original `Centrality_Local_V5/`, las referencias, los CSV del usuario ni su SQLite. Trabajar con una copia del código en la raíz; datos de prueba temporales.
- No llamadas a GNAT, credenciales, cookies, sesiones del navegador, telemetría, descarga masiva ni evasión de CORS. Las referencias prueban contratos del cliente guardado, no disponibilidad remota actual.
- Mantener Python estándar, SQLite, rutas API existentes, capturas y funcionamiento local. No restaurar por conjetura las coordenadas CSV dañadas.
- Atlas PDF A1 fuera de alcance. No convertir el código monolítico de referencia en dependencia de ejecución.

## Diseño de trabajo
- Conservar módulos Python y canvas existentes. Copiar el piloto a la raíz para una ruta estable sin versiones, preservando el original.
- Compatibilidad selectiva con recorrido/aperturas: identidades separadas de números visibles, asociaciones de bloques compartidas, X para aperturas y etiquetas independientes. No importar errores de indexación `Numero - 1`.
- GNAT: contrato/normalización independientes del mapa y SQLite; adaptador desconectado real y fixture MOCK optativo. No éxito simulado ni persistencia corporativa automática. No sobrescribir puntos locales por consultar una ficha.
- Un diagnóstico pasivo, limitado y restaurable sobre servicios del mismo origen, ejecutado manualmente por el usuario; no realiza consultas ni extrae autenticación.
- Proveedores de cartografía: capturas locales actuales, OSM optativo y WMTS remoto explícitamente no disponible sin contrato/acceso validado.

## Tareas, ruta y aceptación
- [x] T0 — Línea base y referencias. Ruta: dos exploraciones delegadas (requiere más de cuatro archivos). Pruebas originales 7/7 y smoke HTTP aislado 19 aserciones; SQLite original sin cambios. Comparación de `v6.txt`, `v4.js`, piloto y fuentes GNAT guardadas completada.
- [x] T1 — Copia de trabajo estable y compatibilidad recorrido/aperturas. Ruta: escritor delegado (múltiples archivos no triviales). Mantener API/importaciones existentes, numeración con huecos, colores y bloques; exportar coordenadas con coma decimal; rechazo claro y atómico de CSV inválido. Migraciones, si necesarias, idempotentes y con respaldo previo. Conservar el original intacto.
- [x] T2 — Adaptador GNAT, fixtures y UI de ficha/estados. Ruta: mismo escritor delegado. Búsqueda exacta y ambigua; Point/LineString/MultiLineString sintéticos; metadatos como texto seguro; errores explícitos; modo desconectado sin llamadas externas y sin modificar puntos locales.
- [x] T3 — Diagnóstico único y documentación. Ruta: mismo escritor delegado. Acciones observadas en fuentes identificadas como candidatas, no verificadas en vivo; sin secretos, consultas, transmisión ni captura ilimitada. Instrucciones Windows, matriz de evidencia y limitaciones reales.
- [x] T4 — Verificación independiente, paquete y nombre estable. Ruta: verificador delegado + comprobación puntual del coordinador. Probar con DB temporal, conservar originales; ZIP sin datos corporativos ni credenciales. Usar la carpeta estable centrality-local; Windows impidió el renombrado de la carpeta activa, por lo que se creó una copia verificada y se conservó v4 como respaldo.

## Verificación
- TDD estricto habilitado por instrucciones de sesión. Observar RED antes de implementar cada comportamiento y GREEN después; no inventar evidencia.
- Runner existente: `python -B -m unittest discover -s tests -v` desde la raíz de la aplicación.
- Comprobación JS: `node --check` para scripts modificados. Cualquier harness adicional debe usar biblioteca estándar y registrarse con su comando exacto.
- Smoke de arranque/API con SQLite/capturas temporales y puerto loopback efímero. Nunca lanzar navegador con OSM activo durante pruebas.
- Base observada: 7 tests originales aprobados; smoke HTTP de 19 aserciones aprobado. Python 3.14.7 disponible; `py` no disponible; INICIAR.bat tiene fallback a `python`.
- Riesgos preexistentes relevantes: CSV con coordenadas reemplaza datos sin confirmación visual; KMZ inválido produce HTTP 500; OSM está activo por defecto. Corregir solamente donde afecta límites de importación/seguridad de esta integración.
- RDD está activo por configuración global; cualquier evaluación nativa será sobre el candidato real y sin crear un commit prohibido. No fabricar aprobación si el repositorio sin HEAD impide una revisión.

## Recuperación, entrega y presupuesto
- Documento: `odd/tasks/centrality-gnat-integration.md`.
- Espejo Engram pendiente: no existe identidad runtime registrada; no se permiten escrituras atribuidas. Detección actual de proyecto: `v4`, aún no registrado en Engram. No seleccionar otra sesión/proyecto como sustituto.
- No se encontró registro de skills del proyecto; se usan las rutas verificadas de skills de esta sesión.
- Estrategia: `ask-on-risk`; no PR ni commits por restricción explícita, por lo que no se abre una cadena de PR. Previsión orientativa: 1.500–2.500 líneas autorales repartidas en módulos/tests/docs; no reducir claridad ni omitir pruebas por presupuesto de líneas.
- Rollback: eliminar únicamente la nueva copia modular en la raíz y sus módulos añadidos; `Centrality_Local_V5/`, `v6.txt`, `v4.js`, KML/CSV/capturas originales siguen intactos. Los datos importados por el usuario posteriormente requieren respaldo propio.

## Progreso y siguiente paso
T0–T4 completadas con verificación funcional independiente. Proyecto de trabajo: C:/Users/Supervisor/Desktop/centrality-local. Abrir esta carpeta en la próxima sesión; v4 permanece como respaldo por bloqueo de Windows. GNAT real, validación visual y revisión nativa siguen pendientes; no hay aprobación de revisión. No hubo commits, staging ni push.

## Evidencia T1
- RED de compatibilidad: `python -B -m unittest discover -s tests -v`, 14 pruebas, 6 errores de capacidades ausentes (coma decimal, columnas v6, campos migrados, KMZ inválido). Un problema de cleanup del harness Windows se corrigió antes del segundo RED.
- RED de HTTP/arranque: mismo comando, 20 pruebas, 3 fallos esperados: falta de confirmación 409, exportación v6 ausente y fallback Python omitido. `node --test tests/map.test.js`: 2 fallos (filtro/etiquetas ausentes y OSM activo).
- GREEN: 20/20 Python; 2/2 JS. `node --check web/app.js` y `node --check web/map.js`: salida 0. Smoke HTTP real incorporado en `tests/test_http.py`: puerto efímero, DB/capturas temporales; importación por clase, confirmación/cancelación, CSV v6 con coma decimal, edición por ID, búsquedas, capturas, rechazo KMZ/origen.
- Identidad: `id` SQLite entero identifica navegación/edición; `import_id` conserva el ID externo por clase. `numero` no es un índice; huecos intactos. Importaciones reemplazan solo las clases presentes; consultas no cambian ninguna.
- Migración aditiva: `clase`, `import_id`, `bloques` (JSON), respaldo SQLite `.pre-<UTC>.bak` antes del primer ALTER, prueba idempotente y lectura de respaldo legado.
- Arranque CMD probado con `py.cmd`/`python.cmd` controlados; ambos caminos sin abrir navegador. Original intacto.
- Espejo Engram sigue pendiente (sin sesión runtime registrada). Sin commits por instrucción.

## Evidencia T2 y T3
- T2 RED: `python -B -m unittest discover -s tests -v`, 29 pruebas, 9 fallos esperados por adaptador/rutas aún ausentes. GREEN posterior 29/29. `node --test tests/map.test.js tests/gnat-ui.test.js`: RED 3 fallos (módulo de ficha/capa opcional ausentes), GREEN 5/5.
- Normalización aislada sin transporte remoto: desconectado real, fixtures explícitos, exactitud/duplicados/tipos, Point del informe, líneas sintéticas, HTML/widgets como texto inerte, JSON vacío/malformado/incompleto, 401/403, timeout, fallo de conexión y success:false. Errores probados con respuestas suministradas, no con GNAT vivo.
- Caché oficial/manual import diferidos: no hay permiso de retención/contrato validado; solo resultados efímeros. `raw_response` queda en memoria interna y se elimina del límite HTTP; ninguna consulta llama al importador ni a escritura de puntos.
- T3 RED: `node --test tests/diagnostic.test.js`, 2 fallos por snippet inexistente; GREEN 2/2. Endurecimiento acotado posterior: RED 1 fallo por recorrer respuesta XHR JSON sin cota de bytes; GREEN 3/3 al omitir ese caso como `unavailable_json_object`. JS y TXT idénticos comprobados por bytes.
- Diagnóstico pasivo: mismo origen, cinco servicios conocidos, solo acciones funcionales ya encontradas en fuente; sin solicitudes propias, cookies/headers/storage, URLs completas ni valores de negocio. Límites 60 s/24 muestras/3 por acción/64 KB respuesta, detención/restauración/exportación visibles. CORS localhost `NO_VERIFICADO`.
- Regresión adicional KML: RED 2 subcasos de coordenadas inválidas que se omitían/aceptaban; GREEN tras validación compartida de longitud/latitud antes de cualquier importación.

## Verificación final del escritor
- `python -B -m unittest discover -s tests -v`: **30/30 aprobadas**, sin omitidas. Son 7 originales + 23 nuevas.
- `node --test (Get-ChildItem tests/*.test.js | ForEach-Object FullName)`: **9/9 aprobadas**, sin omitidas. Total nuevo: **32 tests** entre Python y Node.
- `node --check web/app.js`, `node --check web/map.js`, `node --check web/gnat-client.js`, `node --check bridge/diagnostico_contrato_gnat.js`: **exit 0**.
- Smoke HTTP integrado en 5 tests con **32 sitios de aserción**; servidor real loopback/puerto efímero, DB/capturas temporales. Cubre importación/confirmación por clase, exportación/roundtrip, validación/origen, salud/estáticos, edición/búsqueda/capturas y MOCK sin alterar puntos.
- Arranque CMD con stubs controlados: `py -3 iniciar.py` y fallback `python iniciar.py` observados; no abrió navegador. Python real disponible; no se instalaron dependencias.
- SHA-256 antes/después: **41 archivos originales/referencias preservados**, sin diferencias. `datos` nuevo contiene solo `.keep`; ningún SQLite/captura del usuario copiado ni modificado.
- Lectura de documentación completada: README, arquitectura, contrato GNAT, cambios y contexto vigente. Ejemplos recorrido/aperturas son sintéticos y conservan la advertencia sobre CSV corruptos.
- `impeccable ... detect --json web/index.html web/styles.css web/app.js web/map.js web/gnat-client.js`: exit 0 con advertencias de estilo heredado (tipografías pequeñas, bordes laterales de colores y tabla compacta). Se preservó la identidad existente; no se inició un rediseño. Prueba visual manual sigue pendiente.
- No ejecutado: GNAT real, diagnóstico en sesión oficial, CORS localhost, WMTS autorizado, importación manual de fichas oficiales y pruebas visuales autenticadas. No hay promesa de conexión ni datos oficiales cacheados.
- Sin RDD iniciado por el escritor; lo gestiona el coordinador. Sin commits por prohibición explícita. Engram/mirror sigue pendiente: identidad runtime no registrada; ninguna escritura atribuida.

## Siguiente paso y rollback
Coordinador: comprobar independientemente el candidato, resolver el estado RDD nativo sin inventar HEAD/commits, empaquetar por allowlist sin datos corporativos, probar extracción y completar T4. Renombrado externo solo al final y dentro del permiso aplicable.

Rollback se mantiene: piloto original intacto; eliminar únicamente la copia nueva si aún no se usó. Después de introducir datos reales, detener servidor y respaldar `datos` antes de cualquier reversión. La migración anterior puede revertirse usando una copia del `.bak` previo con el código anterior; nunca sobrescribir la única base activa.

## Corrección de codificación y cierre del escritor
Se detectó por lectura de bytes que PowerShell 5 enviaba a stdin Python los literales no ASCII como `?`. Se corrigieron los textos nuevos usando `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` antes del pipe y lectura UTF-8 explícita. No era corrupción de los originales. Se comprobaron los operadores JS para no alterar `??`/`?.` ni expresiones ternarias.

Después de corregir la codificación: suite Python **30/30**, suite Node **9/9**, cuatro `node --check` **exit 0** nuevamente. Lectura de docs confirmó que solo quedan signos `?` legítimos de query string; la UI conserva tildes y separadores. T1–T3 cerradas; T4 queda para el coordinador. Sin nuevos cambios de alcance.

## T4 — bloqueo CSV reabierto por verificación independiente
Estado: **reabierto**. La exportación por defecto mezcla `Tipo` y `Clase`, pero el alias histórico `Clase` pertenece a `tipo`; al reimportar se detecta una columna duplicada. No se puede entregar el candidato hasta probar ida/vuelta por defecto y `kind=legacy` con ambas clases sin perder números, IDs externos, colores ni bloques. Se conservará el contrato histórico `Clase` como tipo; el nuevo campo de clase debe tener un encabezado inequívoco. TDD estricto y runner no cambian. Sin revisión nativa (preflight no disponible), staging ni commits.

## T4 — bloqueo CSV resuelto por corrección acotada
- RED observado antes de tocar producción: `python -B -m unittest discover -s tests -v`, **32 pruebas, 2 subcasos fallidos** de la regresión `test_default_and_legacy_export_roundtrip_preserves_both_point_kinds`; ambas rutas (`/api/export.csv` y `?kind=legacy`) devolvían 400 `Columna repetida: Clase` al reimportar. La prueba de preservación `test_legacy_clase_header_remains_asset_type_not_point_kind` ya aprobaba y debe seguir aprobando.
- Causa: el alias histórico `Clase` se resolvía como `tipo`, mientras la nueva exportación emitía a la vez `Tipo` y `Clase` con un significado distinto. Corrección mínima: exportar la nueva clase como **`ClasePunto`**, importable también como `clase_punto`; mantener `Clase` como alias histórico de tipo. No cambian esquema SQLite ni campos JSON.
- GREEN: mismo runner **32/32 aprobadas**; `node --test (Get-ChildItem tests/*.test.js | ForEach-Object FullName)` **9/9 aprobadas**. Los cuatro `node --check` solicitados: **exit 0**. Sin omitidas. Total actual: 7 Python originales + 25 Python nuevas + 9 Node = **34 tests nuevos**.
- La regresión HTTP comprueba ida/vuelta de ambas rutas con recorrido y apertura, IDs externos, números con huecos, colores, bloques compartidos y coordenadas preservadas. Datos de prueba siempre temporales; no se probaron respuestas oficiales GNAT.
- Archivos acotados: `app/importers.py`, `app/server.py`, `tests/test_http.py`, `tests/test_compat.py`, `README.md`, `docs/ARQUITECTURA.md`, `docs/CAMBIOS.md` y este documento. El banner de consola usa nombre estable; `GET /api/health` conserva su versión por compatibilidad. El título HTML ya usaba nombre estable y no se cambió.
- Estado del bloqueo: **resuelto con prueba observada**. T4 completo sigue pendiente del coordinador (verificación independiente posterior, paquete y extracción). Candidato **sin revisión nativa**: preflight informado como no disponible; no se inició ni se inventó aprobación. Sin staging/commits ni cambios en originales. Espejo Engram pendiente por la restricción de identidad de esta sesión.

## Cierre verificado T4
- Verificador independiente: 32/32 Python, 9/9 Node y cuatro comprobaciones de sintaxis JS aprobadas, tanto en la raíz como desde una extracción temporal con espacios. Nueva carpeta final: mismas suites aprobadas nuevamente.
- CSV general corregido: ClasePunto distingue recorrido/apertura; Clase conserva su significado legado como tipo de activo. Roundtrip por HTTP devuelve 200 para exportación general y legacy; conserva números, clases, IDs externos, colores, bloques compartidos y coordenadas.
- ZIP por allowlist: dist/centrality-local.zip, 36 entradas, 68.490 bytes, SHA256 282f62f043072f274876dadcb342ee948dbe400e56c84e5c4afd55119d3a4b5a. CRC, exclusiones de datos privados y equivalencia JS/TXT del diagnóstico verificadas. Sin bases, imágenes, capturas JSON, referencias ni metadatos internos.
- Arranque real del paquete extraído probado con SQLite/capturas temporales y puerto loopback efímero: salud, estáticos, esquema, base vacía y GNAT desconectado. Servidor detenido y temporales limpiados. El primer harness de inspección dejó una conexión SQLite abierta; se corrigió solo ese harness y se verificó la limpieza en una repetición acotada. No era un defecto del producto.
- Preservación del coordinador: 33 archivos del piloto original, 7 referencias principales y 23 recursos guardados conservan sus hashes agregados originales. Copia final comprobada byte a byte: 129 archivos, excluyendo el índice CodeGraph. Índice nuevo e independiente inicializado en centrality-local; no se reutilizó otro índice.
- Renombrado directo intentado con permiso: Windows rechazó la carpeta activa por estar en uso. Alternativa segura ejecutada: copia completa verificada a C:/Users/Supervisor/Desktop/centrality-local; v4 intacta como respaldo. Rama feat/gnat-integration conservada, sin commits.
- Prueba visual pendiente: los dos intentos con el controlador de navegador indicaron que no existe navegador disponible. No se abrieron sesiones corporativas. El servidor temporal del coordinador se detuvo y el puerto 55150 dejó de escuchar.
- Evaluación nativa: riesgo high/unassessable por archivos nuevos sin seguimiento. Preflight local falló por acceso denegado; intento autorizado fuera del sandbox falló con invalid negotiated review failure message. No hubo START, consentimiento, target, autoridad ni aprobación. Se preservó el estado; no se fabricó revisión ni se alteró el switch RDD. Verificación funcional independiente realizada.
- Engram y espejo permanecen pendientes: identidad runtime no registrada, proyecto nuevo no registrado; ninguna escritura atribuida ni sesión sustituta.
- Pendiente para GNAT vivo: contrato/permisos/sesión y CORS validados por el usuario. Ejecutar voluntariamente bridge/diagnostico_contrato_gnat.txt según docs/CONTRATO_GNAT.md; el programa solo tiene desconectado y MOCK. Importación manual oficial y caché oficial siguen diferidas.
- Próximo paso de uso: abrir la carpeta centrality-local, ejecutar INICIAR.bat, importar los ejemplos sintéticos o el KMZ original; no reutilizar los CSV de coordenadas ya dañadas.