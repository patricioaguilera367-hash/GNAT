# zonas-desconectadas-v1 — motor de Zona Desconectada sobre GNAT

Motor read-only que, dado un conjunto de postes seleccionados, delimita la
**Zona Desconectada (D)** de un Permiso de Trabajo: encuentra los tramos que
quedan aislados y los aparatos de maniobra que los aíslan.

Rama `feat/v10-mt-probe`. Depende de `odd/tasks/gnat-probe-v1.md` (contrato ya
medido).

## Specs

**S1 — Presupuesto de tiempo antes que optimalidad.**
«si a la vista lo voy a resolver en 3 segundos, no tiene sentido que empieces a
calcular una optimización de 10 minutos». El motor nunca debe tardar más que el
operador mirando el mapa. Presupuesto por defecto: **24 requests y 8 s**. Al
agotarse, devuelve lo que tenga con estado `parcial` o `no concluyente` y el
motivo, sin bloquear la interfaz y sin seguir explorando.

**S2 — Enfoque híbrido.**
La topología del sector se descubre por sondeo del mapa; el estado de los
aparatos de maniobra se lee sólo en el **borde** de la exploración, con
`elec_addons_cm_object_data_section.php` (`section_id=23`). No se camina borne por
borne todo el sector: eso es la optimización cara que S1 prohíbe.

**S3 — Primitivo de descubrimiento: anillo alrededor del poste.**
No existe endpoint que dado un poste devuelva sus cables. El descubrimiento
muestrea `N` puntos en un anillo de radio `R` alrededor de cada poste semilla
(`get_objects_info_for_point`) y acumula los objetos hallados.

**S4 — El par de postes del `display` es la arista.**
Un cable reporta `display: "F562540 - F562541"`. Esos dos códigos son los extremos
de la arista del grafo. Los bornes (`Borne #1` / `Borne #2`) se usan sólo para
leer estado en el borde.

**S5 — MT y BT nunca se mezclan.**
El mismo par de postes puede tener un conductor `1-fas MT` y uno `1-fas BT`. Cada
arista lleva su tensión y la exploración declara con qué tensión trabaja. Una
zona no puede contener aristas de ambas.

**S6 — La clase del objeto sale de la ficha.**
Un tramo es `title: "Detalle de Cable …"`; el `type` es el material del
conductor. Nunca clasificar por `type` solo.

**S7 — Estado desconocido no es estado cerrado.**
Si el aparato de borde no expone su estado, se marca `estado desconocido` y se
pide confirmación al operador. Nunca se asume cerrado ni abierto.

**S8 — El resultado dice por qué se detuvo.**
Salida: aristas incluidas, aparatos de borde con su estado por fase, y motivo
(`delimitada`, `parcial`, `sin borde en el presupuesto`, `no concluyente`). El
operador decide con evidencia, no con un sí/no opaco.

**S9 — Read-only.**
Sólo GET. Nada de ejecutar HTML/JS remoto, ni escribir en GNAT, ni pintar capas
del mapa del cliente. La zona se dibuja en la capa propia de Centrality V10.

**S10 — Ubicación.**
Adaptador silencioso `gnat_adapter.js` **sin DOM propio**, consumido por
`centrality_v10.js` desde su menú `Herramientas`. Es la separación que la
auditoría previa ya había concluido: una sola interfaz, un solo dueño del estado.

**S11 — Verificación.**
Adaptador probado offline contra las respuestas reales ya registradas (cable MT,
cable BT, sección 23 de un desconectador, poste sin cables). La integración en la
UI se valida con un smoke del dueño sobre el mapa.

**S12 — El motor verifica aperturas, no las elige.**
El supervisor decide qué abrir; el motor responde si esa decisión aísla la zona.
Camina el grafo MT desde los postes de trabajo, se detiene en cada apertura, y
devuelve la isla cerrada, las aperturas que la delimitan y las fuentes que aún la
alimentan. La apertura óptima no es un objetivo del motor.

**S13 — `valid: true` sólo con evidencia completa.**
Presupuesto agotado, poste sin punto cartográfico, apertura nunca alcanzada o
título ilegible ⇒ `valid: false` con el motivo. Una caminata incompleta jamás
aprueba una apertura, y un poste abierto es frontera, nunca miembro de la isla.

## Tasks

- **T1** — `probeAround(lonlat, radius, samples)` en el probe: valida que el
  anillo encuentra los cables de un poste y deduplica. Sin esto, S3 es una
  suposición.
- **T2** — `gnat_adapter.js`: descubrimiento por anillo, construcción del grafo
  por pares de postes, exploración con presupuesto, lectura de estado en el borde.
- **T3** — Integración en `centrality_v10.js`: entrada en `Herramientas`, selección
  como semilla, dibujo de la zona en la capa propia.

## Roadmap

**Objetivo único del motor:** dado el conjunto de postes donde el operador va a
trabajar, decir qué tramos quedan desenergizados y **qué aparatos de maniobra los
aíslan**, con su estado. Nada más.

Diagnóstico: 7 preguntas cerradas, 2 abiertas. Con D1 y D2 termina el probe y no
se publica otra versión de diagnóstico salvo que una medición contradiga un
supuesto.

| # | Paso | Estado |
|---|---|---|
| D1 | ¿El anillo a 5 m halla cables en un poste? | abierta |
| D2 | ¿La sección 23 de una maniobra **MT** da estado por fase? | abierta |
| T2a | Grafo por pares de códigos, tensión por arista | pendiente |
| T2b | Exploración con presupuesto 24 req / 8 s y motivo de parada | pendiente |
| T2c | Borde: maniobras, estado por fase, `desconocido` explícito | pendiente |
| T2d | Verificar el adaptador contra las respuestas registradas | pendiente |
| T3 | Ítem en `Herramientas` + dibujo de la zona | pendiente |

**D1 decide:** el descubrimiento nace del poste que el operador seleccionó. Si a
5 m y a 12 m no aparece nada, el enfoque híbrido no sirve donde importa y hay que
repensarlo antes de escribir el grafo.

**D2 decide:** el entregable es una lista de maniobras que aíslan la zona. Sin
estado por fase, la lista es un conjunto de nombres sin valor para un permiso de
trabajo, y S8 cambia de contrato.

## Log

**L1** — «C, sinceramente si a la vista lo voy a resolver en 3 segundos, no tiene
sentido que empieces a calcular una optimización de 10 minutos.» — aprobación del
enfoque híbrido con la restricción de S1 como principal.

**L2** — Contrato medido en `odd/tasks/gnat-probe-v1.md` L8: los tramos exponen
`"F562540 - F562541"` en `display`, la clase `Cable` sólo aparece en la ficha, la
geometría es un `LineString` de 2 vértices, y el estado por fase (`Real` con
timestamp / `Normal`) se lee de la sección 23 como texto.

**L3** — No existe primitivo que dado un poste devuelva sus cables: la sección 23
del poste viene vacía y el point query devuelve el poste y sus tirantes. De ahí S3.

**L4** — Primera medición del anillo. Encontró conductores reales, y con ellos dos
defectos propios: `Trintre - Colonia Miraflores` (par de localidades) entraba como
arista, y 20 m de radio no toca una línea fina (`F517570` devolvió 0 cables).
Corregido en v1.8.0: sólo un par de códigos de poste es arista, y el anillo arranca
a 5 m abriéndose a 12 m sólo si no halló nada. Pendiente de medición en vivo.

**L5** — El anillo descubre aristas pero no permite **caminar**: el `display` da
códigos de poste (`F562541`), no coordenadas, y para repetir el anillo en el poste
vecino hacen falta sus lon/lat.

**L5-corrección** — Ese eslabón **ya existía**: `resolveCode` (`probe-mt-aperturas.js:734`)
y `resolveGeometry` (`:656`) ya convierten código → lon/lat, y `probeCode` (`:1137`)
ya los usa. L5 afirmó una ausencia sin verificarla. Lo que sí faltaba es el uso
seguro de esa resolución para caminar.

**L6** — La resolución por código es **prefijo** (`F51757` trae la subestación y
`F517570..F517577`) y el mismo código se repite entre tipos de objeto: `F517572`
es el poste y también su desconectador fusible. `resolveCode` retorna con el primer
término que trae filas y el match exacto es sólo preferencia de orden, así que
caminar el grafo con esa resolución engancharía coordenadas al poste equivocado en
silencio. `probePole(code)` (v1.9.0) exige coincidencia del código inicial del
`display`, acepta la ambigüedad de varios objetos por código y usa el primero que
traiga un `Point` cartográfico.
