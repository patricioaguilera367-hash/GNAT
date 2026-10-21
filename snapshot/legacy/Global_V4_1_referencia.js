/*
 * CENTRALITY V4.1 - KMZ / SUPERVISORES / DETALLE MT-BT / PLANOS A1
 * Ejecutar en la consola del navegador con el mapa de Centrality abierto.
 * Lee archivos locales. No envia archivos ni cambia datos de Centrality.
 * Los colores son temporales; puedes exportar/importar el reparto como CSV.
 * La exportación PDF usa solo la cartografía renderizada a zoom fijo.
 * Las capas WMTS no se convierten en líneas vectoriales.
 */
(() => {
  "use strict";

  const frame = document.querySelector("iframe#content");
  if (!frame) {
    console.error("Abre primero el modulo Mapas de Centrality.");
    return;
  }

  let w, map, ol, doc;
  try {
    w = frame.contentWindow;
    map = w.webMap_?.map;
    ol = w.ol;
    doc = w.document;
  } catch (e) {
    console.error("No es posible acceder al mapa de Centrality:", e);
    return;
  }

  if (!map || !ol?.layer?.Vector || !ol?.source?.Vector ||
      !ol?.format?.KML || !ol?.Feature || !ol?.geom?.Point ||
      !ol?.style?.Style || !ol?.style?.Circle ||
      !ol?.style?.Text || !ol?.style?.Fill || !ol?.style?.Stroke) {
    console.error("El mapa no expone los componentes necesarios de OpenLayers.");
    return;
  }

  // Si viene de V1/V2, copiar puntos ANTES de cerrar su panel para no perder
  // la carga ni los bloques ya trabajados en esta sesión.
  const anteriores = [];
  try {
    function visitarAnteriores(collection) {
      for (const layer of collection?.getArray?.() || []) {
        const features = layer.getSource?.()?.getFeatures?.();
        if (layer.getZIndex?.() >= 99999 && Array.isArray(features)) {
          for (const f of features) {
            const geom = f.getGeometry?.();
            const numero = Number(f.get?.('numero'));
            if (geom?.getType?.() !== 'Point' || !Number.isInteger(numero) || numero < 1) continue;
            const xy = geom.getCoordinates();
            if (!xy?.slice(0,2).every(Number.isFinite)) continue;
            anteriores.push({numero, xy:xy.slice(0,2),
              codigo: String(f.get('codigo') || f.get('nombre') || f.get('name') || 'Sin código'),
              bloque: String(f.get('bloque') || 'Sin asignar')});
          }
        }
        if (layer.getLayers) visitarAnteriores(layer.getLayers());
      }
    }
    visitarAnteriores(map.getLayers());
    anteriores.sort((a,b) => a.numero - b.numero);
    if (new Set(anteriores.map(x => x.numero)).size !== anteriores.length) anteriores.length = 0;
  } catch(e) { anteriores.length = 0; console.warn('No fue posible conservar la carga anterior:',e); }

  // Cerrar paneles anteriores para evitar ediciones simultáneas de la malla WMTS.
  try { w.__pruebaDetalleCentrality?.cerrar?.(); } catch (e) { console.warn(e); }
  try { w.__centralityAtlasPDF?.destruir?.(); } catch (e) { console.warn(e); }
  try { w.__superponerKMZ?.cerrar?.(); } catch (e) {
    console.warn("No se pudo retirar el panel anterior:", e);
  }

  const SIN_BLOQUE = "Sin asignar";
  const COLORES = Object.freeze({
    [SIN_BLOQUE]: "#e53935", // rojo por defecto, sin supervisor asignado
    Verde: "#198754",
    Naranjo: "#ef8b16",
    Azul: "#2469d8"
  });
  const BLOQUES = ["Verde", "Naranjo", "Azul"];
  const OPCIONES_BLOQUE = [SIN_BLOQUE, ...BLOQUES];
  let puntos = [];
  let capa = null;
  let seleccionado = new Set();
  let enfocado = -1;
  let etiquetas = "cerca";
  let contenidoEtiqueta = "numero";
  // El primer visor mostraba los números únicamente cerca (resolución <25).
  const UMBRAL_ETIQUETA = 25;
  let atlasActivo = false;
  let atlasCancelar = false;
  let cargaId = 0;
  let abierto = true;
  let nombreArchivo = "puntos";
  let textoAviso = "";
  const cacheEstilos = new WeakMap();

  // Una sola interfaz, dentro del iframe que contiene el mapa.
  const panel = doc.createElement("div");
  panel.style.cssText = [
    "position:fixed", "top:12px", "right:12px",
    "z-index:2147483647", "width:450px",
    "max-width:calc(100vw - 24px)", "max-height:calc(100vh - 24px)",
    "overflow:auto", "box-sizing:border-box", "padding:14px",
    "background:#fff", "color:#17212b", "font:13px Arial,sans-serif",
    "border:1px solid #bdc7d0", "border-radius:10px",
    "box-shadow:0 7px 30px #0004"
  ].join(";");

  const crear = (padre, tag, texto, css) => {
    const el = doc.createElement(tag);
    if (texto !== undefined && texto !== null) el.textContent = texto;
    if (css) el.style.cssText = css;
    padre.appendChild(el);
    return el;
  };

  const ESTILO_CONTROL =
    "font:12px Arial,sans-serif;box-sizing:border-box;border:1px solid #abb6c1;" +
    "border-radius:5px;padding:7px;background:#fff;color:#17212b;";
  const ESTILO_BOTON = ESTILO_CONTROL + "cursor:pointer;background:#f5f7fa;";
  const btn = (padre, titulo, cssExtra = "") => {
    const el = crear(padre, "button", titulo, ESTILO_BOTON + cssExtra);
    el.type = "button";
    return el;
  };
  const fila = (padre, cssExtra = "") =>
    crear(padre, "div", null, "display:flex;align-items:center;gap:7px;flex-wrap:wrap;" + cssExtra);
  const titulo = fila(panel, "justify-content:space-between;margin-bottom:8px;");
  const tituloTexto = crear(titulo, "strong", "Puntos KMZ · Supervisores", "font-size:15px;");
  const ocultar = btn(titulo, "Contraer", "padding:5px 8px;");

  crear(panel, "div", "Importa tu archivo KMZ o KML:", "margin-bottom:5px;");
  const archivo = crear(panel, "input", null,
    "display:block;width:100%;margin:4px 0 7px 0;font-size:12px;");
  archivo.type = "file";
  archivo.accept = ".kmz,.kml";

  const estado = crear(panel, "div", "Esperando archivo...",
    "margin:7px 0;color:#314355;font-size:12px;");

  const controles = crear(panel, "div");
  const busqueda = crear(controles, "input", null,
    ESTILO_CONTROL + "display:block;width:100%;margin:8px 0 6px 0;");
  busqueda.type = "search";
  busqueda.placeholder = "Buscar N° o código de poste...";
  busqueda.setAttribute("aria-label", "Buscar punto por numero o codigo");
  const barraFiltros = fila(controles, "margin:0 0 7px 0;");
  const bloqueFiltro = crear(barraFiltros, "select", null,
    ESTILO_CONTROL + "flex:1;min-width:100px;");
  ["Todos los bloques", ...OPCIONES_BLOQUE].forEach((v, i) => {
    const opt = crear(bloqueFiltro, "option", v);
    opt.value = i ? v : "";
  });
  const modoEtiqueta = crear(barraFiltros, "select", null,
    ESTILO_CONTROL + "flex:1.5;min-width:160px;");
  [
    ["cerca", "Etiquetas al acercar"],
    ["siempre", "Etiquetas siempre"],
    ["ninguna", "Ocultar etiquetas"]
  ].forEach(([v, s]) => {
    const opt = crear(modoEtiqueta, "option", s);
    opt.value = v;
  });
  modoEtiqueta.title = "Cuándo se muestran etiquetas; usa el umbral de la versión original.";
  const textoEtiqueta = crear(barraFiltros, "select", null,
    ESTILO_CONTROL + "flex:1;min-width:116px;");
  [["numero", "Solo número"], ["completo", "N° + código"]].forEach(([v, label]) => {
    const op = crear(textoEtiqueta, "option", label);
    op.value = v;
  });
  textoEtiqueta.value = "numero";
  textoEtiqueta.title = "Texto a dibujar junto al marcador; también se conserva en la tabla.";

  const lista = crear(controles, "select", null,
    ESTILO_CONTROL + "display:block;width:100%;margin:5px 0 8px 0;");
  lista.setAttribute("aria-label", "Ir a un punto");

  const resumen = crear(controles, "div", "",
    "font-size:12px;margin:7px 0;line-height:1.6;");

  const agrupacion = crear(controles, "div", null,
    "background:#f3f6f9;border:1px solid #dbe3ea;border-radius:7px;" +
    "padding:9px;margin:8px 0;");
  crear(agrupacion, "strong", "Asignar bloque a los seleccionados",
    "display:block;font-size:12px;margin-bottom:7px;");
  const coloresFila = fila(agrupacion);
  const botonesColores = {};
  for (const bloque of BLOQUES) {
    const b = btn(coloresFila, bloque,
      "background:" + COLORES[bloque] + ";border-color:" + COLORES[bloque] +
      ";color:white;font-weight:bold;flex:1;min-width:80px;");
    botonesColores[bloque] = b;
  }
  const bSinAsignar = btn(agrupacion, "Quitar supervisor a seleccionados",
    "display:block;width:100%;margin-top:6px;padding:5px;");
  const filaSeleccion = fila(agrupacion, "margin-top:7px;justify-content:space-between;");
  const nSel = crear(filaSeleccion, "span", "0 seleccionados", "font-size:12px;");
  const limpiarSel = btn(filaSeleccion, "Deseleccionar", "padding:5px 8px;");

  const tablaWrap = crear(controles, "div", null,
    "border:1px solid #ccd5df;border-radius:6px;overflow:auto;" +
    "max-height:min(38vh,350px);background:#fff;");
  const tabla = crear(tablaWrap, "table", null,
    "width:100%;border-collapse:collapse;table-layout:fixed;font:12px Arial,sans-serif;");
  const thead = crear(tabla, "thead");
  const trh = crear(thead, "tr", null, "background:#eaf0f5;");
  const th = (texto, ancho) => crear(trh, "th", texto,
    "position:sticky;top:0;z-index:2;background:#eaf0f5;" +
    "padding:7px 4px;text-align:left;border-bottom:1px solid #c4cdd8;" +
    (ancho ? "width:" + ancho + ";" : ""));
  const celdaCheck = th("", "31px");
  const checkTodo = crear(celdaCheck, "input");
  checkTodo.type = "checkbox";
  checkTodo.title = "Seleccionar todos los puntos visibles en la tabla";
  th("N°", "36px");
  th("Código de poste", "auto");
  th("Bloque", "100px");
  const tbody = crear(tabla, "tbody");
  const pieTabla = crear(controles, "div", "",
    "font-size:11px;color:#566575;margin:5px 0 9px 0;");

  const acciones = fila(panel, "margin-top:10px;");
  const verTodos = btn(acciones, "Ver todos", "flex:1;");
  const verSeleccion = btn(acciones, "Ver selección", "flex:1;");
  const quitar = btn(acciones, "Quitar puntos", "flex:1;");
  const acciones2 = fila(panel, "margin-top:7px;");
  const exportar = btn(acciones2, "Guardar reparto CSV", "flex:1;");
  const importar = btn(acciones2, "Recuperar CSV", "flex:1;");
  const cerrar = btn(acciones2, "Cerrar", "flex:0.6;");
  const archivoCSV = crear(panel, "input", null, "display:none;");
  archivoCSV.type = "file";
  archivoCSV.accept = ".csv,text/csv";
  // Mapa y PDF compartidos dentro de este mismo panel global.
  const herramientas = crear(panel, "details", null,
    "margin-top:10px;border:1px solid #d6e1e9;border-radius:7px;padding:9px;");
  crear(herramientas, "summary", "Detalle MT/BT y atlas PDF",
    "font-size:13px;font-weight:bold;cursor:pointer;");
  const cuerpoHerramientas = crear(herramientas, "div", null, "margin-top:9px;");
  crear(panel, "div", "Reparto temporal: guarda CSV para recuperarlo.",
    "font-size:11px;color:#657181;margin-top:8px;");
  doc.body.appendChild(panel);

  function mensaje(s, error = false) {
    textoAviso = s;
    estado.textContent = s;
    estado.style.color = error ? "#b42318" : "#314355";
  }

  // Mantener el nombre original para no invalidar los CSV ya guardados.
  function puntoCodigoOriginal(f) {
    return String(f.get("codigo") || "Sin código");
  }

  // Si el KML trae "15 - F51755", no mostrar dos veces la numeración.
  function puntoCodigo(f) {
    const codigo = puntoCodigoOriginal(f).trim();
    const numero = String(f.get("numero"));
    const prefijo = new RegExp("^" + numero + "(?:\\s*[-–—·.:#/]\\s*|\\s+)");
    return codigo.replace(prefijo, "").trim() || codigo;
  }

  function puntosFiltrados() {
    const q = busqueda.value.trim().toLocaleLowerCase("es");
    const grupo = bloqueFiltro.value;
    return puntos.filter(f => {
      const coincideGrupo = !grupo || f.get("bloque") === grupo;
      const valor = String(f.get("numero")) + " " + puntoCodigo(f);
      return coincideGrupo && valor.toLocaleLowerCase("es").includes(q);
    });
  }

  function estiloPunto(f, resolution) {
    const bloque = OPCIONES_BLOQUE.includes(f.get("bloque"))
      ? f.get("bloque") : SIN_BLOQUE;
    const activo = enfocado === Number(f.get("numero")) - 1;
    const marcado = seleccionado.has(Number(f.get("numero")) - 1);
    const conTexto = etiquetas === "siempre" ||
      (etiquetas === "cerca" && resolution < UMBRAL_ETIQUETA);
    const clave = [bloque, activo, marcado, conTexto, contenidoEtiqueta].join("|");
    let cache = cacheEstilos.get(f);
    if (!cache) {
      cache = new Map();
      cacheEstilos.set(f, cache);
    }
    if (cache.has(clave)) return cache.get(clave);
    const estilo = new ol.style.Style({
      image: new ol.style.Circle({
        radius: activo ? 10 : (marcado ? 8.5 : 7),
        fill: new ol.style.Fill({ color: COLORES[bloque] }),
        stroke: new ol.style.Stroke({
          color: activo ? "#17212b" : "#ffffff",
          width: activo ? 3 : marcado ? 3 : 2
        })
      }),
      text: conTexto ? new ol.style.Text({
         text: contenidoEtiqueta === "completo"
           ? f.get("numero") + " · " + puntoCodigo(f)
           : String(f.get("numero")),
        font: "bold 12px Arial,sans-serif",
        offsetY: activo ? -23 : -20,
        fill: new ol.style.Fill({color: "#ffffff"}),
        stroke: new ol.style.Stroke({color: "#142332", width: 3.5})
      }) : undefined,
      zIndex: activo ? 100 : marcado ? 50 : 0
    });
    cache.set(clave, estilo);
    return estilo;
  }

  function redibujarMapa() {
    if (capa) capa.changed();
  }

  function mostrarResumen() {
    const cuentas = Object.fromEntries(OPCIONES_BLOQUE.map(b => [b, 0]));
    puntos.forEach(f => {
      const b = f.get("bloque");
      cuentas[b in cuentas ? b : SIN_BLOQUE]++;
    });
    resumen.replaceChildren();
    crear(resumen, "span", `${puntos.length} puntos  ·  `);
    OPCIONES_BLOQUE.forEach((b, i) => {
      const dato = crear(resumen, "strong", `${b}: ${cuentas[b]}`,
        `color:${COLORES[b]};`);
      if (i < OPCIONES_BLOQUE.length - 1) dato.after(doc.createTextNode("  ·  "));
    });
    nSel.textContent = seleccionado.size + " seleccionados";
  }

  function reconstruirLista() {
    const actual = lista.value;
    lista.replaceChildren();
    const inicial = crear(lista, "option", "Ir a un punto...");
    inicial.value = "";
    puntos.forEach((f, i) => {
      const opt = crear(lista, "option", `${f.get("numero")} · ${puntoCodigo(f)}`);
      opt.value = String(i);
    });
    lista.value = (actual !== "" && Number(actual) < puntos.length) ? actual : "";
  }

  // Reserva un espacio visual a la derecha para que el panel NO tape el poste.
  function margenDerechoMapa() {
    const tamano = map.getSize();
    const mapaEl = map.getTargetElement?.();
    if (!tamano?.[0] || !mapaEl) return 0;
    const m = mapaEl.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const anchoSolapado = Math.max(0,
      Math.min(m.right, p.right) - Math.max(m.left, p.left));
    const panelALaDerecha = (p.left + p.right) / 2 > (m.left + m.right) / 2;
    return panelALaDerecha
      ? Math.min(anchoSolapado + 16, Math.max(0, tamano[0] - 130))
      : 0;
  }

  function navegar(indice) {
    const f = puntos[indice];
    if (!f) return;
    enfocado = indice;
    lista.value = String(indice);
    const view = map.getView();
    const actual = view.getZoom();
    const zoom = Math.max(Number.isFinite(actual) ? actual : 0, 17.5);
    const xy = f.getGeometry().getCoordinates();
    const res = view.getResolutionForZoom?.(zoom);
    const margen = margenDerechoMapa();
    const centro = Number.isFinite(res) && margen
      ? [xy[0] + margen * res / 2, xy[1]]
      : xy;
    view.animate({ center: centro, zoom, duration: 350 });
    redibujarMapa();
    dibujarTabla();
  }

  function dibujarTabla() {
    const visibles = puntosFiltrados();
    tbody.replaceChildren();
    for (const f of visibles) {
      const indice = Number(f.get("numero")) - 1;
      const grupo = f.get("bloque");
      const tr = crear(tbody, "tr", null,
        "cursor:pointer;border-bottom:1px solid #e5e9ee;" +
        (indice === enfocado ? "background:#e8f0fb;" : "") +
        `border-left:4px solid ${COLORES[grupo]};`);
      tr.title = "Ir a este punto en el mapa";
      const td = (texto, css = "") => crear(tr, "td", texto,
        "padding:6px 4px;overflow:hidden;text-overflow:ellipsis;" + css);
      const tCheck = td("");
      const check = crear(tCheck, "input");
      check.type = "checkbox";
      check.checked = seleccionado.has(indice);
      check.setAttribute("aria-label", `Seleccionar punto ${f.get("numero")}`);
      check.addEventListener("click", e => e.stopPropagation());
      check.addEventListener("change", () => {
        if (check.checked) seleccionado.add(indice);
        else seleccionado.delete(indice);
        refrescarSeleccion();
      });
      td(String(f.get("numero")), "font-weight:bold;");
      td(puntoCodigo(f), "font-weight:600;word-break:break-word;");
      const tBloque = td("");
      const s = crear(tBloque, "select", null,
        "font:11px Arial,sans-serif;width:100%;max-width:100%;" +
        "padding:5px 2px;border:1px solid #c4cdd8;border-radius:4px;");
       OPCIONES_BLOQUE.forEach(b => {
        const op = crear(s, "option", b);
        op.value = b;
      });
      s.value = grupo;
      s.style.color = COLORES[grupo];
      s.style.fontWeight = "bold";
      s.title = "Cambiar solo este punto de bloque";
      s.addEventListener("click", e => e.stopPropagation());
      s.addEventListener("change", () => {
        asignar([indice], s.value);
      });
      tr.addEventListener("click", () => navegar(indice));
    }
    const n = visibles.length;
    pieTabla.textContent = `Mostrando ${n} de ${puntos.length} puntos. ` +
      "Marca casillas para asignar varios; pulsa una fila para ir al mapa.";
    const todos = n > 0 && visibles.every(f =>
      seleccionado.has(Number(f.get("numero")) - 1));
    const algunos = visibles.some(f => seleccionado.has(Number(f.get("numero")) - 1));
    checkTodo.checked = todos;
    checkTodo.indeterminate = algunos && !todos;
    mostrarResumen();
  }

  function refrescarSeleccion() {
    const visibles = puntosFiltrados();
    checkTodo.checked = visibles.length > 0 && visibles.every(f =>
      seleccionado.has(Number(f.get("numero")) - 1));
    checkTodo.indeterminate = !checkTodo.checked && visibles.some(f =>
      seleccionado.has(Number(f.get("numero")) - 1));
    nSel.textContent = seleccionado.size + " seleccionados";
    redibujarMapa();
  }

  function asignar(indices, bloque) {
    if (!OPCIONES_BLOQUE.includes(bloque)) return;
    if (!indices.length) {
      mensaje("Primero selecciona uno o más puntos en la tabla.", true);
      return;
    }
    for (const i of indices) {
      if (puntos[i]) puntos[i].set("bloque", bloque);
    }
    seleccionado.clear();
    dibujarTabla();
    redibujarMapa();
    mensaje(`${indices.length} punto(s) asignado(s) al bloque ${bloque}.`);
  }

  function retirarCapa() {
    if (capa) {
      map.removeLayer(capa);
      capa = null;
    }
    puntos = [];
    seleccionado.clear();
    enfocado = -1;
    busqueda.value = "";
    bloqueFiltro.value = "";
    lista.replaceChildren();
    const op = crear(lista, "option", "Ir a un punto...");
    op.value = "";
    dibujarTabla();
    estimarAtlas();
  }

  // Lee el KML contenido en un KMZ (ZIP) sin llamar a servidores.
  async function leerKMZ(file) {
    const ab = await file.arrayBuffer();
    if (ab.byteLength > 30000000) throw Error("KMZ demasiado grande (>30 MB).");
    const v = new DataView(ab);
    let end = -1;
    for (let i = ab.byteLength - 22; i >= Math.max(0, ab.byteLength - 65557); --i) {
      if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw Error("No se encontró el índice ZIP.");
    const total = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    const encontrados = [];
    for (let i = 0; i < total; i++) {
      if (p + 46 > ab.byteLength || v.getUint32(p, true) !== 0x02014b50) {
        throw Error("Índice ZIP inválido.");
      }
      const metodo = v.getUint16(p + 10, true);
      const comprimido = v.getUint32(p + 20, true);
      const descomprimido = v.getUint32(p + 24, true);
      const nl = v.getUint16(p + 28, true);
      const el = v.getUint16(p + 30, true);
      const cl = v.getUint16(p + 32, true);
      const loc = v.getUint32(p + 42, true);
      const nombre = new TextDecoder().decode(new Uint8Array(ab, p + 46, nl));
      if (nombre.toLowerCase().endsWith(".kml") &&
          !nombre.startsWith("__MACOSX/")) {
        encontrados.push({ nombre, metodo, comprimido, descomprimido, loc });
      }
      p += 46 + nl + el + cl;
    }
    encontrados.sort((a, b) =>
      Number(b.nombre.toLowerCase().endsWith("doc.kml")) -
      Number(a.nombre.toLowerCase().endsWith("doc.kml")));
    const a = encontrados[0];
    if (!a) throw Error("El KMZ no contiene archivos KML.");
    if (a.descomprimido > 30000000) throw Error("KML interno demasiado grande.");
    if (a.loc + 30 > ab.byteLength || v.getUint32(a.loc, true) !== 0x04034b50) {
      throw Error("Entrada ZIP inválida.");
    }
    const inicio = a.loc + 30 + v.getUint16(a.loc + 26, true) +
      v.getUint16(a.loc + 28, true);
    if (inicio + a.comprimido > ab.byteLength) throw Error("Entrada ZIP incompleta.");
    const bytes = new Uint8Array(ab, inicio, a.comprimido);
    if (a.metodo === 0) return new TextDecoder().decode(bytes);
    if (a.metodo !== 8) throw Error("Compresión ZIP no admitida.");
    if (typeof DecompressionStream !== "function") {
      throw Error("Tu navegador no permite descomprimir KMZ; prueba con KML.");
    }
    const flujo = new Blob([bytes]).stream().pipeThrough(
      new DecompressionStream("deflate-raw"));
    const salida = await new Response(flujo).arrayBuffer();
    if (salida.byteLength > 30000000) {
      throw Error("KML descomprimido demasiado grande.");
    }
    return new TextDecoder().decode(salida);
  }

  function extraerPuntos(g) {
    if (!g) return [];
    const tipo = g.getType();
    if (tipo === "Point") return [g.getCoordinates()];
    if (tipo === "MultiPoint") return g.getCoordinates();
    if (tipo === "GeometryCollection") return g.getGeometries().flatMap(extraerPuntos);
    return [];
  }

  async function cargar(file) {
    if (!file) return;
    const token = ++cargaId;
    mensaje("Leyendo " + file.name + "...");
    try {
      const kml = /\.kmz$/i.test(file.name) ? await leerKMZ(file) : await file.text();
      if (!abierto || token !== cargaId) return;
      const xml = new DOMParser().parseFromString(kml, "application/xml");
      if (xml.querySelector("parsererror")) throw Error("El KML no es XML válido.");
      const formato = new ol.format.KML({ extractStyles: false, showPointNames: false });
      const entidades = formato.readFeatures(kml, {
        dataProjection: "EPSG:4326",
        featureProjection: map.getView().getProjection()
      });
      const nuevos = [];
      for (const original of entidades) {
        const codigo = String(original.get("name") || "").trim();
        for (const xy of extraerPuntos(original.getGeometry())) {
          if (!xy.every(Number.isFinite)) continue;
          const punto = new ol.Feature({
            geometry: new ol.geom.Point(xy),
            codigo: codigo || "Sin código",
            numero: nuevos.length + 1,
            bloque: SIN_BLOQUE
          });
          nuevos.push(punto);
        }
      }
      if (!nuevos.length) throw Error("El archivo no contiene puntos.");
      const nuevaCapa = new ol.layer.Vector({
        source: new ol.source.Vector({features: nuevos}),
        zIndex: 100000,
        style: estiloPunto
      });
      retirarCapa();
      puntos = nuevos;
      capa = nuevaCapa;
      nombreArchivo = file.name.replace(/\.(kmz|kml)$/i, "");
      map.addLayer(capa);
      reconstruirLista();
      dibujarTabla();
      mensaje(`Cargados ${puntos.length} puntos rojos sin asignar. ` +
        "Selecciona y reparte entre Verde, Naranjo y Azul.");
      estimarAtlas();
      console.log("Centrality: puntos cargados", puntos.length);
    } catch (e) {
      if (abierto && token === cargaId) {
        mensaje("Error: " + e.message, true);
        console.error("Centrality: error al cargar archivo", e);
      }
    }
  }

  function encuadrar(indices) {
    if (!capa) { mensaje("Carga un KMZ o KML primero.", true); return; }
    if (!indices.length) { mensaje("Selecciona al menos un punto.", true); return; }
    if (indices.length === 1) { navegar(indices[0]); return; }
    const coords = indices.map(i => puntos[i]?.getGeometry().getCoordinates()).filter(Boolean);
    if (!coords.length) return;
    const xs = coords.map(c => c[0]);
    const ys = coords.map(c => c[1]);
    const extent = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    map.getView().fit(extent, {
      size: map.getSize(),
      padding: [55, margenDerechoMapa() + 20, 55, 45],
      maxZoom: 17.5, duration: 350
    });
  }

  // CSV con separador ; para abrir cómodamente en Excel en Chile.
  const entreComillas = v => '"' + String(v).replace(/"/g, '""') + '"';
  function guardarCSV() {
    if (!puntos.length) { mensaje("Carga puntos antes de exportar.", true); return; }
    const lineas = ["Numero;CodigoPoste;Bloque;Longitud;Latitud"];
    for (const f of puntos) {
      const xy = f.getGeometry().getCoordinates();
      let lng = "", lat = "";
      if (ol.proj?.toLonLat) {
        [lng, lat] = ol.proj.toLonLat(xy, map.getView().getProjection());
      }
      lineas.push([
        f.get("numero"), entreComillas(puntoCodigoOriginal(f)), f.get("bloque"), lng, lat
      ].join(";"));
    }
    const blob = new Blob(["\ufeff" + lineas.join("\r\n")],
      {type: "text/csv;charset=utf-8"});
    const url = w.URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = `${nombreArchivo}_reparto_supervisores.csv`;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    w.setTimeout(() => w.URL.revokeObjectURL(url), 2000);
    mensaje("CSV guardado localmente con el reparto actual.");
  }

  function leerFilaCSV(linea) {
    const partes = [];
    let valor = "", comillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') {
        if (comillas && linea[i + 1] === '"') { valor += '"'; i++; }
        else comillas = !comillas;
      } else if (c === ";" && !comillas) {
        partes.push(valor);
        valor = "";
      } else valor += c;
    }
    if (comillas) throw Error("CSV con comillas incompletas.");
    partes.push(valor);
    return partes;
  }

  async function recuperarCSV(file) {
    if (!file || !puntos.length) {
      if (!puntos.length) mensaje("Carga primero el KMZ/KML original.", true);
      return;
    }
    try {
      const texto = (await file.text()).replace(/^\ufeff/, "");
      const lineas = texto.split(/\r?\n/).filter(x => x.trim() !== "");
      if (lineas.length < 2 ||
          leerFilaCSV(lineas[0]).slice(0, 3).join(";") !==
          "Numero;CodigoPoste;Bloque") {
        throw Error("Selecciona un CSV exportado por este panel.");
      }
      const cambios = new Map();
      for (const linea of lineas.slice(1)) {
        const [n, codigo, bloque] = leerFilaCSV(linea);
        const i = Number(n) - 1;
        if (!Number.isInteger(i) || !puntos[i] ||
            puntoCodigoOriginal(puntos[i]) !== codigo || !OPCIONES_BLOQUE.includes(bloque) ||
            cambios.has(i)) {
          throw Error("El CSV no corresponde a los mismos puntos y orden del KMZ/KML.");
        }
        cambios.set(i, bloque);
      }
      if (cambios.size !== puntos.length) {
        throw Error("La cantidad de puntos del CSV no coincide con el archivo cargado.");
      }
      for (const [i, bloque] of cambios) puntos[i].set("bloque", bloque);
      seleccionado.clear();
      dibujarTabla();
      redibujarMapa();
      mensaje(`Recuperado reparto de ${cambios.size} puntos desde CSV.`);
    } catch (e) {
      mensaje("Error al recuperar CSV: " + e.message, true);
    } finally {
      archivoCSV.value = "";
    }
  }

  archivo.addEventListener("change", () => cargar(archivo.files?.[0]));
  busqueda.addEventListener("input", dibujarTabla);
  bloqueFiltro.addEventListener("change", dibujarTabla);
  modoEtiqueta.addEventListener("change", () => {
    etiquetas = modoEtiqueta.value;
    redibujarMapa();
  });
  textoEtiqueta.addEventListener("change", () => {
    contenidoEtiqueta = textoEtiqueta.value;
    redibujarMapa();
  });
  lista.addEventListener("change", () => {
    if (lista.value !== "") navegar(Number(lista.value));
  });
  checkTodo.addEventListener("change", () => {
    const visibles = puntosFiltrados();
    const marcar = checkTodo.checked;
    for (const f of visibles) {
      const i = Number(f.get("numero")) - 1;
      if (marcar) seleccionado.add(i);
      else seleccionado.delete(i);
    }
    dibujarTabla();
    redibujarMapa();
  });
  limpiarSel.addEventListener("click", () => {
    seleccionado.clear(); dibujarTabla(); redibujarMapa();
  });
  for (const bloque of BLOQUES) {
    botonesColores[bloque].addEventListener("click", () =>
      asignar([...seleccionado], bloque));
  }
  bSinAsignar.addEventListener("click", () =>
    asignar([...seleccionado], SIN_BLOQUE));
  verTodos.addEventListener("click", () => {
    encuadrar(puntos.map((_, i) => i));
  });
  verSeleccion.addEventListener("click", () => {
    encuadrar([...seleccionado]);
  });
  quitar.addEventListener("click", () => {
    ++cargaId;
    retirarCapa();
    archivo.value = "";
    mensaje("Puntos retirados.");
  });
  exportar.addEventListener("click", guardarCSV);
  importar.addEventListener("click", () => {
    if (!puntos.length) { mensaje("Carga primero el KMZ/KML original.", true); return; }
    archivoCSV.click();
  });
  archivoCSV.addEventListener("change", () => recuperarCSV(archivoCSV.files?.[0]));

  // ========================================================================
  // Herramientas integradas: detalle MT/BT + atlas por hojas de zoom fijo.
  // ========================================================================
  crear(cuerpoHerramientas, 'strong', 'Detalle de líneas MT/BT',
    'display:block;margin-bottom:5px;font-size:12px;');
  const detailRow = fila(cuerpoHerramientas, 'margin-bottom:5px;');
  const detailButtons = [0, 1, 2].map(n => btn(detailRow,
    n === 0 ? 'Original' : 'Forzar +' + n,
    'flex:1;min-width:75px;padding:6px;'));
  const detailStatus = crear(cuerpoHerramientas, 'div', '',
    'font-size:11px;color:#64748b;margin-bottom:8px;line-height:1.3;');
  const nombresMTBT = new Set([
    'webmap.distribution.medium_voltage',
    'webmap.distribution.low_voltage',
    'webmap.infrastructure'
  ]);
  const fuentesDetalle = new Set();
  const mallasOriginales = new Map();
  function revisarMallas(col) {
    (col?.getArray?.() || []).forEach(layer => {
      const name = layer.get?.('title') || layer.get?.('name');
      if (nombresMTBT.has(name)) {
        const src = layer.getSource?.();
        const tileGrid = src?.getTileGrid?.();
        if (tileGrid && typeof tileGrid.getZForResolution === 'function') {
          if (!mallasOriginales.has(tileGrid)) {
            mallasOriginales.set(tileGrid, tileGrid.getZForResolution);
          }
          fuentesDetalle.add(src);
        }
      }
      if (layer.getLayers) revisarMallas(layer.getLayers());
    });
  }
  revisarMallas(map.getLayers());
  let detalleForzado = 0;
  function cambiarDetalle(n) {
    detalleForzado = Number(n) || 0;
    for (const [grid, original] of mallasOriginales) {
      if (!detalleForzado) {
        grid.getZForResolution = original;
      } else {
        grid.getZForResolution = function (resolucion, direccion) {
          const z = original.call(this, resolucion, direccion);
          const niveles = this.getResolutions?.();
          const max = Number.isFinite(this.getMaxZoom?.())
            ? this.getMaxZoom() : (niveles?.length ? niveles.length - 1 : z);
          return Math.min(max, z + detalleForzado);
        };
      }
    }
    fuentesDetalle.forEach(source => source.changed?.());
    map.render?.();
    detailButtons.forEach((button, i) => {
      button.style.fontWeight = i === detalleForzado ? 'bold' : 'normal';
      button.style.background = i === detalleForzado ? '#e4edf8' : '#f5f7fa';
    });
    detailStatus.textContent = !mallasOriginales.size
      ? 'No se encontraron mallas WMTS manipulables.'
      : detalleForzado
        ? 'Forzado +' + detalleForzado + ' (experimental). No recupera vectores ni garantiza líneas a menor zoom.'
        : 'Detalle original. Puedes activar +1 o +2 si necesitas otra escala de teselas.';
  }
  detailButtons.forEach((b, i) => b.addEventListener('click', () => {
    if (atlasActivo) return;
    cambiarDetalle(i);
    if(estadoPreparacion){estadoPreparacion=null;capturasAtlas=null;abrirBtn.disabled=true;prepararBtn.textContent='Preparar planos';estimarAtlas();}
  }));
  cambiarDetalle(0);

  crear(cuerpoHerramientas, 'div', '',
    'border-top:1px solid #dbe3ea;margin:9px 0;');
  crear(cuerpoHerramientas, 'strong', 'Planos A1 · General / Atlas',
    'display:block;margin-bottom:7px;font-size:12px;');

  const fModo = fila(cuerpoHerramientas, 'margin:0 0 7px;');
  const salida = crear(fModo, 'select', null,
    ESTILO_CONTROL + 'flex:1;min-width:200px;');
  [['ambos','Plano general + atlas'], ['general','Un solo plano general'],
    ['atlas','Solo atlas de detalle']].forEach(([value, name]) => {
    const op = crear(salida, 'option', name); op.value = value;
  });
  salida.value = 'ambos';

  const fPapel = fila(cuerpoHerramientas, 'margin-bottom:7px;');
  const papel = crear(fPapel, 'select', null,
    ESTILO_CONTROL + 'flex:1;min-width:155px;');
  [['A1L','A1 horizontal (841 × 594 mm)'],
   ['A1P','A1 vertical (594 × 841 mm)'],
   ['A3L','A3 horizontal'], ['A4L','A4 horizontal']].forEach(([value, name]) => {
    const op = crear(papel, 'option', name); op.value = value;
  });
  papel.value = 'A1L';
  const calidad = crear(fPapel, 'select', null,
    ESTILO_CONTROL + 'flex:1;min-width:135px;');
  [['100','100 dpi (recomendado)'], ['150','150 dpi (pesado)'],
   ['75','75 dpi (rápido)']].forEach(([value, name]) => {
    const op = crear(calidad, 'option', name); op.value = value;
  });
  calidad.value = '100';

  const opcionesAtlas = fila(cuerpoHerramientas, 'margin-bottom:7px;');
  const zoomAtlas = crear(opcionesAtlas, 'select', null,
    ESTILO_CONTROL + 'flex:1;min-width:155px;');
  [['auto','Auto: máximo detalle permitido'],
    ['14','Zoom 14'], ['14.5','Zoom 14.5'],
    ['15','Zoom 15'], ['15.5','Zoom 15.5'],
    ['16','Zoom 16'], ['16.5','Zoom 16.5'],
    ['17','Zoom 17'], ['17.5','Zoom 17.5'],
    ['18','Zoom 18']].forEach(([value, name]) => {
    const op = crear(zoomAtlas, 'option', name); op.value = value;
  });
  zoomAtlas.value = 'auto';
  const limiteHojas = crear(opcionesAtlas, 'select', null,
    ESTILO_CONTROL + 'flex:0.8;min-width:120px;');
  [[12,'Máx. 12 hojas'],[24,'Máx. 24 hojas'],[40,'Máx. 40 hojas'],
    [90,'Máx. 90 hojas']].forEach(([n, name]) => {
    const op = crear(limiteHojas, 'option', name); op.value = String(n);
  });
  limiteHojas.value = '24';

  const opFila = fila(cuerpoHerramientas, 'margin-bottom:7px;');
  const distribucion = crear(opFila, 'select', null,
    ESTILO_CONTROL + 'width:100%;');
  [['compacto','Agrupar puntos próximos (menos hojas)'],
    ['continua','Cuadrícula continua (toda el área)'],
    ['individual','Una hoja por punto']].forEach(([value, name]) => {
    const op = crear(distribucion, 'option', name); op.value = value;
  });
  distribucion.value = 'continua';

  const pruebaFila = fila(cuerpoHerramientas, 'margin:5px 0 7px;');
  const soloPrueba = crear(pruebaFila, 'input'); soloPrueba.type = 'checkbox';
  soloPrueba.checked = true;
  crear(pruebaFila, 'span', 'Prueba: preparar solo la primera hoja', 'font-size:11px;');
  const timeoutFila = fila(cuerpoHerramientas, 'margin-bottom:8px;');
  crear(timeoutFila, 'span', 'Espera máxima por hoja:', 'font-size:11px;');
  const esperaHojaSelector = crear(timeoutFila, 'select', null,
    ESTILO_CONTROL + 'flex:1;min-width:110px;');
  [['45000','45 s'],['90000','90 s (recomendado)'],['180000','180 s (muy lento)']]
    .forEach(([v,n])=>{const opt=crear(esperaHojaSelector,'option',n);opt.value=v;});
  esperaHojaSelector.value='90000';
  const incompletasFila = fila(cuerpoHerramientas, 'margin:4px 0 7px;');
  const incompletas = crear(incompletasFila, 'input'); incompletas.type = 'checkbox';
  crear(incompletasFila, 'span', 'Permitir hojas con teselas sin terminar (solo borradores)', 'font-size:11px;');
  const atlasInfo = crear(cuerpoHerramientas, 'div',
    'A1 real a escala de hoja constante: elegir 150 dpi mejora la definición sin alterar la cobertura. Números en SVG vectorial; MT/BT sigue siendo imagen WMTS.',
    'font-size:11px;color:#657181;line-height:1.35;margin-bottom:7px;');

  const botonesAtlas = fila(cuerpoHerramientas, 'margin:4px 0;');
  const calcularBtn = btn(botonesAtlas, 'Calcular hojas', 'flex:1;');
  const prepararBtn = btn(botonesAtlas, 'Preparar planos', 'flex:1;');
  const cancelarBtn = btn(botonesAtlas, 'Cancelar'); cancelarBtn.disabled = true;
  const abrirBtn = btn(cuerpoHerramientas, 'Abrir e imprimir / Guardar PDF',
    'width:100%;margin:5px 0 0;'); abrirBtn.disabled = true;
  const statusAtlas = crear(cuerpoHerramientas, 'div', '',
    'font-size:11px;color:#526174;line-height:1.45;margin-top:7px;white-space:pre-line;');

  let capturasAtlas = null;
  let urlsAtlas = [];
  let rendererExport = null;
  let estadoPreparacion = null; // Permite reanudar sin perder hojas terminadas.
  const MAX_HOJAS_ATLAS = 90;
  const sleep = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const htmlEscape = value => String(value).replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function atlasMensaje(mensaje, error = false) {
    statusAtlas.textContent = mensaje;
    statusAtlas.style.color = error ? '#b42318' : '#526174';
  }
  function puntosParaAtlas() {
    return puntos.map((f, id) => ({
      id, numero: String(f.get('numero')), codigo: puntoCodigo(f),
      bloque: OPCIONES_BLOQUE.includes(f.get('bloque')) ? f.get('bloque') : SIN_BLOQUE,
      xy: f.getGeometry().getCoordinates().slice(0, 2)
    }));
  }
  const FORMATOS_PAPEL = Object.freeze({
    A1L:[841,594], A1P:[594,841], A3L:[420,297], A4L:[297,210]
  });
  function dimensionesPapel() {
    const medidas = FORMATOS_PAPEL[papel.value];
    if (!medidas) throw Error('Formato de papel no reconocido.');
    const dpi = Number(calidad.value);
    const [anchoMm, altoMm] = medidas;
    // Hojas: 10 mm de margen lateral, 8/7 mm arriba/abajo,
    // 11 mm encabezado, 10 mm pie. El resto es mapa verdadero.
    const mapaAnchoMm = anchoMm - 20;
    const mapaAltoMm = altoMm - 36;
    const size = [Math.round(mapaAnchoMm*dpi/25.4),
                  Math.round(mapaAltoMm*dpi/25.4)];
    if (size[0] * size[1] > 22000000) {
      throw Error('La calidad seleccionada supera el límite seguro de renderizado.');
    }
    return {anchoMm, altoMm, mapaAnchoMm, mapaAltoMm, size, dpi};
  }
  function resolucionAtlas(zoom) {
    const view = map.getView();
    return view.getResolutionForZoom?.(zoom) ??
      (view.getResolution()*Math.pow(2, view.getZoom()-zoom));
  }
  const dentro = (p, center, halfW, halfH) =>
    Math.abs(p.xy[0]-center[0]) <= halfW && Math.abs(p.xy[1]-center[1]) <= halfH;
  const centroBbox = ps => [
    (Math.min(...ps.map(p=>p.xy[0]))+Math.max(...ps.map(p=>p.xy[0])))/2,
    (Math.min(...ps.map(p=>p.xy[1]))+Math.max(...ps.map(p=>p.xy[1])))/2
  ];
  function planGeneral(ps, paper) {
    const center = centroBbox(ps);
    const xmin = Math.min(...ps.map(p=>p.xy[0])), xmax = Math.max(...ps.map(p=>p.xy[0]));
    const ymin = Math.min(...ps.map(p=>p.xy[1])), ymax = Math.max(...ps.map(p=>p.xy[1]));
    // Adaptar extensión al papel físico, con 7% de margen alrededor.
    const res = Math.max((xmax-xmin)*1.14/paper.size[0],
      (ymax-ymin)*1.14/paper.size[1], resolucionAtlas(18));
    const zoom = map.getView().getZoomForResolution?.(res) ?? 14;
    return {center, resolution:res, zoom, ids:ps.map(p=>p.id), titulo:'Plano general'};
  }
  function planHojas(ps, zoom, modo, paper) {
    const size = paper.size;
    const resolution = resolucionAtlas(zoom) * 100 / paper.dpi;
    if (!Number.isFinite(resolution) || resolution <= 0) throw Error('Zoom inválido.');
    const width = size[0]*resolution, height=size[1]*resolution;
    const sheets = [];
    const maxPages = MAX_HOJAS_ATLAS;
    if (modo === 'continua') {
      const xs=ps.map(p=>p.xy[0]), ys=ps.map(p=>p.xy[1]);
      const xmin=Math.min(...xs),xmax=Math.max(...xs);
      const ymin=Math.min(...ys),ymax=Math.max(...ys);
      // 12% de superposición para no cortar los extremos de línea.
      const sx=width*.88, sy=height*.88;
      const cols=Math.max(1, 1+Math.ceil(Math.max(0,xmax-xmin-width)/sx));
      const rows=Math.max(1, 1+Math.ceil(Math.max(0,ymax-ymin-height)/sy));
      const estimated=cols*rows;
      if (estimated>maxPages) return {sheets:[],estimated,resolution,size,zoom};
      for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
        const center=[cols===1?(xmin+xmax)/2:xmin+width/2+col*sx,
          rows===1?(ymin+ymax)/2:ymax-height/2-row*sy];
        sheets.push({center, resolution, zoom,
          ids:ps.filter(p=>dentro(p,center,width/2,height/2)).map(p=>p.id),
          titulo:'Red MT/BT · Cuadrícula'});
      }
      return {sheets,estimated,resolution,size,zoom};
    }
    const remaining=new Set(ps.map(p=>p.id));
    while(remaining.size) {
      const rest=ps.filter(p=>remaining.has(p.id));
      // Utilizar el 86% interior para conservar márgenes alrededor de puntos.
      const halfW=width*.43, halfH=height*.43;
      let group=[rest[0]];
      if(modo!=='individual') {
        for(const anchor of rest) {
          const nearby=rest.filter(p=>dentro(p,anchor.xy,halfW,halfH));
          if(nearby.length>group.length) group=nearby;
        }
      }
      const center=centroBbox(group);
      const real=group.filter(p=>dentro(p,center,width*.49,height*.49));
      if(!real.length) throw Error('No fue posible agrupar puntos.');
      real.forEach(p=>remaining.delete(p.id));
      sheets.push({center, resolution, zoom, ids:real.map(p=>p.id),
        titulo:'Detalle de red MT/BT'});
      if(sheets.length>maxPages) break;
    }
    sheets.sort((a,b)=>b.center[1]-a.center[1]||a.center[0]-b.center[0]);
    return {sheets,estimated:sheets.length,resolution,size,zoom};
  }
  function obtenerPlanAtlas() {
    const ps=puntosParaAtlas();
    if(!ps.length) throw Error('Carga el KMZ/KML para calcular hojas.');
    const paper=dimensionesPapel();
    const general=salida.value!=='atlas' ? planGeneral(ps,paper) : null;
    if(salida.value==='general') return {ps,paper,general,sheets:[],estimated:0,total:1};
    const max=Number(limiteHojas.value);
    const modo=distribucion.value;
    let plan;
    if(zoomAtlas.value!=='auto') {
      plan=planHojas(ps,Number(zoomAtlas.value),modo,paper);
    } else {
      // El zoom automático busca el zoom más alto que cumpla el límite de hojas.
      for(const z of [18,17.5,17,16.5,16,15.5,15,14.5,14,13.5,13]) {
        const candidate=planHojas(ps,z,modo,paper);
        plan=candidate;
        if(candidate.estimated<=max) break;
      }
    }
    return {ps,paper,general, ...plan, total:plan.estimated+Number(Boolean(general)),
      auto:zoomAtlas.value==='auto', limite:max};
  }
  function estimarAtlas() {
    if(atlasActivo) return;
    try {
      const plan=obtenerPlanAtlas();
      const tipo=salida.value==='general'?'Plano único':`Atlas de ${plan.estimated} hojas`;
      const detalle=plan.zoom!==undefined ? ` · Zoom ${Number(plan.zoom).toFixed(2)}` : '';
      const notas=[];
      if(plan.general?.zoom<16.5) notas.push('El plano general puede omitir líneas MT/BT por la escala del WMTS.');
      if(plan.zoom!==undefined && plan.zoom<16.5) notas.push('Zoom de detalle bajo: comprueba presencia de MT/BT.');
      if(plan.estimated>MAX_HOJAS_ATLAS) notas.push('Se supera el máximo de 90 hojas.');
      if(plan.auto&&plan.estimated>plan.limite) notas.push('No se logró cumplir el máximo deseado de hojas.');
      if(plan.paper.dpi>=150 && plan.total>12) notas.push('150 dpi y muchas páginas puede consumir bastante memoria.');
      if(plan.paper.dpi>=150 && detalleForzado>0) notas.push('AVISO: 150 dpi con Forzar +' + detalleForzado + ' puede sobrecargar la descarga de teselas. Prueba a 100 dpi.');
      const sheetWidth=plan.paper.size[0], sheetHeight=plan.paper.size[1];
      atlasMensaje(`${plan.ps.length} puntos · ${papel.value} · ${plan.paper.dpi} dpi · ${sheetWidth}×${sheetHeight} px por hoja.\n` +
        `${tipo}${detalle} · Total ${plan.total} página(s).` +
        (notas.length?'\n'+notas.join('\n'):''));
      prepararBtn.disabled=plan.total>MAX_HOJAS_ATLAS+1 ||
        (salida.value!=='general' && (plan.estimated>MAX_HOJAS_ATLAS || !plan.sheets.length));
    } catch(e) { prepararBtn.disabled=true; atlasMensaje(e.message,true); }
  }
  function deshabilitarControles(disabled) {
    [archivo, quitar, zoomAtlas, limiteHojas, distribucion, papel, calidad,
      salida, incompletas, soloPrueba, esperaHojaSelector, calcularBtn, ...detailButtons].forEach(x=>x.disabled=disabled);
    prepararBtn.disabled=disabled;
    cancelarBtn.disabled=!disabled;
  }
  function enumerarCapasImprimibles() {
    const nombres=new Set(['webmap.osm','webmap.gm','webmap.gs','webmap.cartography',
      'webmap.distribution.medium_voltage', 'webmap.distribution.low_voltage',
      'webmap.infrastructure']);
    const respuesta=[];
    function walk(collection, visiblePadre=true) {
      for(const layer of collection?.getArray?.()||[]) {
        const visible=visiblePadre && layer.getVisible?.()!==false;
        if(layer.getLayers) {walk(layer.getLayers(),visible); continue;}
        const name=layer.get?.('title')||layer.get?.('name');
        const source=layer.getSource?.();
        if(visible && source && nombres.has(name)) {
          respuesta.push({layer,name,source});
        }
      }
    }
    walk(map.getLayers());
    return respuesta;
  }
  function crearRenderizador(paper) {
    if(!ol.Map || !ol.View || !ol.layer?.Tile || !ol.layer?.Image) {
      throw Error('Centrality no expone las clases necesarias para exportar en alta resolución.');
    }
    const lista=enumerarCapasImprimibles();
    if(!lista.length) throw Error('No hay capas cartográficas activas para imprimir.');
    const target=doc.createElement('div');
    const [width,height]=paper.size;
    // Se mantiene adjunto y renderizable sin cubrir ni alterar el mapa de trabajo.
    target.style.cssText=`position:fixed;left:0;top:0;width:${width}px;height:${height}px;`+
      'overflow:hidden;pointer-events:none;opacity:0.01;z-index:-1;';
    doc.body.appendChild(target);
    const nuevos=[];
    try {
      lista.forEach(({layer,source,name},i)=>{
        let tipo;
        if(ol.source?.ImageWMS && source instanceof ol.source.ImageWMS) tipo=ol.layer.Image;
        else tipo=ol.layer.Tile;
        const cloned=new tipo({
          source,visible:true,opacity:layer.getOpacity?.()??1,zIndex:i+1,
          minResolution:layer.getMinResolution?.(),
          maxResolution:layer.getMaxResolution?.(),
          minZoom:layer.getMinZoom?.(),maxZoom:layer.getMaxZoom?.()
        });
        nuevos.push(cloned);
      });
      const initial=map.getView();
      const rendererMap=new ol.Map({target, layers:nuevos, pixelRatio:1,
        controls:[],interactions:[],
        view:new ol.View({projection:initial.getProjection(),
          center:initial.getCenter().slice(),
          resolution:Math.max(initial.getResolution(),resolucionAtlas(14)),
          rotation:0})});
      rendererMap.updateSize();
      return {rendererMap,target,lista};
    } catch(e) { target.remove(); throw e; }
  }
  function destruirRenderizador() {
    if(!rendererExport) return;
    try{rendererExport.rendererMap.setTarget(null);}catch(e){console.warn(e);}
    try{rendererExport.target.remove();}catch(e){console.warn(e);}
    rendererExport=null;
  }
  function esperarRender(mapExport, numeroHoja, totalHojas) {
    // Importante: un rendercomplete real es la única confirmación positiva
    // de OpenLayers. No damos por completas las hojas solo porque pasaron
    // algunos segundos sin recibir eventos de carga.
    return new Promise((resolve,reject)=>{
      let done=false, timer, ticker;
      const tracking={iniciadas:0, terminadas:0, errores:0, pendientes:0};
      const subs=[];
      const uniqueSources=new Set(rendererExport?.lista?.map(e=>e.source).filter(Boolean)||[]);
      function registrar(source, event, callback) {
        if(typeof source.on==='function' && typeof source.un==='function') {
          source.on(event, callback);
          subs.push(()=>source.un(event, callback));
        }
      }
      for(const source of uniqueSources) {
        for(const prefix of ['tile','image']) {
          registrar(source,prefix+'loadstart',()=>{
            tracking.iniciadas++;tracking.pendientes++;
          });
          registrar(source,prefix+'loadend',()=>{
            tracking.terminadas++;tracking.pendientes=Math.max(0,tracking.pendientes-1);
          });
          registrar(source,prefix+'loaderror',()=>{
            tracking.errores++;tracking.pendientes=Math.max(0,tracking.pendientes-1);
          });
        }
      }
      const begun=Date.now();
      function cleanup() {
        w.clearTimeout(timer);w.clearInterval(ticker);
        mapExport.un('rendercomplete',completed);
        for(const unsubscribe of subs)unsubscribe();
      }
      function finish(ok, problem) {
        if(done)return;
        done=true;cleanup();
        if(atlasCancelar) {reject(Error('Cancelado por el usuario.'));return;}
        const complete=ok && tracking.errores===0;
        if(complete||incompletas.checked){
          resolve(complete);
        } else {
          const t=Math.round((Date.now()-begun)/1000);
          const desc=problem==='timeout'?'Tiempo de espera agotado':'Errores al cargar teselas';
          reject(Error(`${desc} en hoja ${numeroHoja}/${totalHojas} (${t}s). `+
            `Cargas iniciadas: ${tracking.iniciadas}; finalizadas: ${tracking.terminadas}; `+
            `errores: ${tracking.errores}; pendientes observadas: ${tracking.pendientes}. `+
            `Prueba Original y 100 dpi, o mayor espera. No se imprimieron hojas incompletas.`));
        }
      }
      const completed=()=>finish(true,'complete');
      mapExport.on('rendercomplete',completed);
      const deadline=Number(esperaHojaSelector.value)||90000;
      timer=w.setTimeout(()=>finish(false,'timeout'),deadline);
      ticker=w.setInterval(()=>{
        if(done)return;
        if(atlasCancelar){finish(false,'cancel');return;}
        const elapsed=Math.round((Date.now()-begun)/1000);
        atlasMensaje(`Hoja ${numeroHoja}/${totalHojas} · ${elapsed}s/${deadline/1000}s · `+
          `teselas observadas: ${tracking.terminadas}/${tracking.iniciadas} `+
          `· pendientes ${tracking.pendientes} · errores ${tracking.errores}.\n`+
          'Se espera confirmación de OpenLayers; no cierres la pestaña.');
      },2500);
      try {mapExport.renderSync();}catch(e){
        if(!done){done=true;cleanup();reject(e);}
      }
    });
  }
  async function capturarRender(rendererMap,paper) {
    const viewport=rendererMap.getViewport();
    const canvasList=[...viewport.querySelectorAll('.ol-layer canvas, canvas.ol-layer')]
      .filter(c=>c.width>0&&c.height>0);
    if(!canvasList.length)throw Error('El mapa exportador no ha producido lienzos.');
    const targetCanvas=doc.createElement('canvas');
    targetCanvas.width=paper.size[0];targetCanvas.height=paper.size[1];
    const ctx=targetCanvas.getContext('2d',{alpha:false});
    if(!ctx)throw Error('No se pudo reservar la memoria del lienzo A1.');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,targetCanvas.width,targetCanvas.height);
    const rect=viewport.getBoundingClientRect();
    for(const c of canvasList) {
      if(w.getComputedStyle(c).display==='none')continue;
      const parent=c.closest('.ol-layer')||c.parentElement;
      if(parent && w.getComputedStyle(parent).display==='none')continue;
      const opacity=parseFloat(w.getComputedStyle(parent||c).opacity||'1');
      const css=w.getComputedStyle(c).transform;
      ctx.save();ctx.globalAlpha=Number.isFinite(opacity)?opacity:1;
      if(css&&css!=='none') {
        const m=new w.DOMMatrix(css);
        ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
      }else{
        const r=c.getBoundingClientRect();
        ctx.setTransform(r.width/c.width,0,0,r.height/c.height,
          r.left-rect.left,r.top-rect.top);
      }
      try {ctx.drawImage(c,0,0);}finally{ctx.restore();}
    }
    const blob=await new Promise((resolve,reject)=>{
      try {targetCanvas.toBlob(b=>b?resolve(b):reject(Error('Imagen vacía; puede ser un problema de origen de teselas.')),
        'image/jpeg',0.91);}catch(e){reject(e);}
    });
    targetCanvas.width=1;targetCanvas.height=1;
    const url=w.URL.createObjectURL(blob);
    urlsAtlas.push(url);
    return url;
  }
  async function capturarHoja(sheet,plan,numeroHoja,totalHojas) {
    if(atlasCancelar)throw Error('Cancelado por el usuario.');
    const e=rendererExport.rendererMap;
    e.getView().setCenter(sheet.center);
    e.getView().setResolution(sheet.resolution);
    const complete=await esperarRender(e,numeroHoja,totalHojas);
    if(atlasCancelar)throw Error('Cancelado por el usuario.');
    const url=await capturarRender(e,plan.paper);
    return {...sheet,image:url,complete,size:plan.paper.size,dpi:plan.paper.dpi,
      ps:plan.ps.filter(p=>dentro(p,sheet.center,
        plan.paper.size[0]*sheet.resolution/2,
        plan.paper.size[1]*sheet.resolution/2))};
  }
  function svgPuntos(sheet) {
    const [width,height]=sheet.size;
    const halfW=width/2,halfH=height/2,res=sheet.resolution;
    const factor=(sheet.dpi||100)/100;
    const circles=sheet.ps.map(p=>{
      const x=halfW+(p.xy[0]-sheet.center[0])/res;
      const y=halfH-(p.xy[1]-sheet.center[1])/res;
      if(x<0||x>width||y<0||y>height)return '';
      const color=COLORES[p.bloque]||COLORES[SIN_BLOQUE];
      const label=contenidoEtiqueta==='completo'?p.numero+' · '+p.codigo:p.numero;
      return `<g><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(7*factor).toFixed(2)}" `+
        `fill="${color}" stroke="#fff" stroke-width="${(2*factor).toFixed(2)}"/>`+
        `<text x="${(x+9*factor).toFixed(2)}" y="${(y-9*factor).toFixed(2)}" `+
        `font-family="Arial,sans-serif" font-size="${(15*factor).toFixed(2)}" font-weight="bold" `+
        `paint-order="stroke" stroke="#fff" stroke-width="${(3*factor).toFixed(2)}" `+
        `stroke-linejoin="round" fill="#152432">${htmlEscape(label)}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" `+
      `xmlns="http://www.w3.org/2000/svg" aria-label="Puntos KMZ">${circles}</svg>`;
  }
  function imprimirAtlas() {
    if(!capturasAtlas?.length||atlasActivo)return;
    const nueva=w.open('','_blank');
    if(!nueva){atlasMensaje('Permite ventanas emergentes para abrir el atlas.',true);return;}
    const paper=estadoPreparacion?.plan?.paper || dimensionesPapel();
    const pendiente=Boolean(estadoPreparacion);
    const prevInfo=pendiente ? `VISTA PREVIA INCOMPLETA (${capturasAtlas.length}/${estadoPreparacion.tasks.length} páginas). NO usar como plano definitivo.` : `Atlas completo (${capturasAtlas.length} páginas).`;
    const sheets=capturasAtlas.map((p,i)=>{
      const title=htmlEscape(p.titulo);
      const nums=p.ps.map(x=>x.numero).join(' · ');
      const legend=nums.length>250?nums.slice(0,250)+'…':nums;
      return `<section class="sheet"><header><b>${title} · ${i+1}/${capturasAtlas.length}</b>`+
        `<span>${htmlEscape(p.zoom.toFixed(2))} zoom · ${paper.dpi} dpi</span></header>`+
        `<figure><div class="mapframe"><img src="${p.image}" alt="Mapa ${i+1}">`+
        `${svgPuntos(p)}</div></figure><footer>`+
        `${p.complete?'':'ATENCIÓN: carga de cartografía no confirmada · '}`+
        `${htmlEscape(legend||'Plano general')}</footer></section>`;
    }).join('');
    const html=`<!doctype html><html lang="es"><head><meta charset="utf-8">`+
      `<title>Centrality · Plano MT BT A1</title><style>`+
      `@page{size:${paper.anchoMm}mm ${paper.altoMm}mm;margin:0}`+
      `*{box-sizing:border-box}body{margin:0;background:#e8edf3;color:#263449;font:13px Arial}`+
      `.toolbar{padding:12px;position:sticky;top:0;background:#253b51;color:#fff;z-index:5}`+
      `.toolbar button{padding:9px 15px;cursor:pointer}`+
      `.sheet{width:${paper.anchoMm}mm;height:${paper.altoMm}mm;`+
      `padding:8mm 10mm 7mm;background:#fff;margin:12px auto;`+
      `display:flex;flex-direction:column;break-after:page;page-break-after:always;overflow:hidden}`+
      `.sheet:last-child{break-after:auto;page-break-after:auto}`+
      `header{flex:0 0 11mm;border-bottom:1px solid #ccd4db;`+
      `display:flex;justify-content:space-between;align-items:center;font-size:12px}`+
      `figure{flex:1 1 auto;min-height:0;margin:0}`+
      `.mapframe{width:100%;height:100%;position:relative;overflow:hidden;background:white}`+
      `.mapframe img,.mapframe svg{display:block;position:absolute;inset:0;width:100%;height:100%}`+
      `.mapframe img{object-fit:fill}`+
      `footer{flex:0 0 10mm;font-size:10px;border-top:1px solid #ccd4db;padding-top:2mm;overflow:hidden}`+
      `@media print{body{background:#fff}.toolbar{display:none}`+
      `.sheet{margin:0;break-after:page;page-break-after:always}`+
      `*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`+
      `</style></head><body><div class="toolbar">`+
      `<button id="centralityPrintButton" disabled>Preparando imágenes para imprimir…</button> `+
      `${htmlEscape(prevInfo)} ${capturasAtlas.length} páginas · ${papel.value}. Elegir A1, escala 100%, sin márgenes.`+
      `</div>${sheets}</body></html>`;
    nueva.document.open();nueva.document.write(html);nueva.document.close();nueva.focus();
    // La vista previa no se considera lista hasta que cada JPEG esté decodificado.
    const printButton=nueva.document.getElementById('centralityPrintButton');
    const images=[...nueva.document.images];
    Promise.all(images.map(img => img.decode().then(()=>true,()=>false))).then(results=>{
      if(!printButton || nueva.closed) return;
      if(results.some(ok=>!ok)) {
        printButton.textContent='Error cargando imágenes; revisa el atlas';
        printButton.disabled=true;
      } else {
        printButton.disabled=false;
        printButton.textContent='Imprimir / Guardar PDF';
      }
    }).catch(e=>console.warn('No se pudieron comprobar todas las imágenes:',e));
    printButton?.addEventListener('click',()=>nueva.print());
  }
  async function prepararAtlas() {
    if(atlasActivo)return;
    let plan, tasks;
    try{
      if(estadoPreparacion){
        plan=estadoPreparacion.plan;
        tasks=estadoPreparacion.tasks;
      } else {
        plan=obtenerPlanAtlas();
        if(plan.total>MAX_HOJAS_ATLAS+1 ||
          (salida.value!=='general'&&(!plan.sheets.length||plan.estimated>MAX_HOJAS_ATLAS))){
          atlasMensaje('Demasiadas hojas. Baja zoom o cambia la distribución.',true);return;
        }
        tasks=[...(plan.general?[plan.general]:[]),...plan.sheets];
      }
    }catch(e){atlasMensaje(e.message,true);return;}
    if(!estadoPreparacion&&plan.total>16 &&
       !w.confirm(`Preparar ${plan.total} páginas ${papel.value} a ${plan.paper.dpi} dpi. Puede tardar y usar mucha memoria. ¿Continuar?`)) return;
    if(!estadoPreparacion){
      estadoPreparacion={plan,tasks,next:0};
      capturasAtlas=[];
    }
    atlasActivo=true;atlasCancelar=false;
    abrirBtn.disabled=true;deshabilitarControles(true);
    try{
      atlasMensaje('Iniciando mapa de impresión independiente…');
      rendererExport=crearRenderizador(plan.paper);
      const first=estadoPreparacion.next;
      const stop=soloPrueba.checked ? Math.min(first+1,tasks.length):tasks.length;
      for(let i=first;i<stop;i++){
        if(atlasCancelar)throw Error('Cancelado por el usuario.');
        atlasMensaje(`Hoja ${i+1}/${tasks.length} · ${papel.value} · ${plan.paper.dpi} dpi…`);
        const captured=await capturarHoja(tasks[i],plan,i+1,tasks.length);
        capturasAtlas.push(captured);
        estadoPreparacion.next=i+1;
        await sleep(500);
      }
      if(estadoPreparacion.next===tasks.length){
        estadoPreparacion=null;
        prepararBtn.textContent='Preparar planos';
        atlasMensaje(`Atlas completo: ${capturasAtlas.length}/${tasks.length} páginas ${papel.value}. Abrir e imprimir en PDF.`);
      } else {
        prepararBtn.textContent='Continuar atlas';
        atlasMensaje(`Prueba lista: ${capturasAtlas.length}/${tasks.length} hoja(s). `+
          `Puedes abrir la vista previa y luego desmarcar «Prueba» para continuar todas las hojas.`);
      }
      abrirBtn.disabled=false;
    }catch(e){
      prepararBtn.textContent='Reintentar / continuar';
      atlasMensaje(`Exportación pausada en hoja ${(estadoPreparacion?.next??0)+1}/${tasks.length}. `+
        `${capturasAtlas?.length||0} hoja(s) terminadas conservadas.\n`+e.message,true);
      console.error('Centrality V4.1 atlas:',e);
    }finally{
      destruirRenderizador();
      atlasActivo=false;deshabilitarControles(false);
      // NO borrar estadoPreparacion ni volver a estimarAtlas() aquí:
      // permite reintentar la hoja fallida sin repetir las ya terminadas.
      if(capturasAtlas?.length)abrirBtn.disabled=false;
    }
  }
  function cerrarAtlas() {
    atlasCancelar=true;
    capturasAtlas=null;
    estadoPreparacion=null;
    destruirRenderizador();
  }
  calcularBtn.addEventListener('click',estimarAtlas);
  [salida,papel,calidad,zoomAtlas,limiteHojas,distribucion,incompletas].forEach(x=>
    x.addEventListener('change',()=>{
      // El atlas previo corresponde a otras dimensiones: exigir nueva preparación.
      if(!atlasActivo){estadoPreparacion=null;capturasAtlas=null;abrirBtn.disabled=true;prepararBtn.textContent='Preparar planos';estimarAtlas();}
    }));
  prepararBtn.addEventListener('click',prepararAtlas);
  cancelarBtn.addEventListener('click',()=>{atlasCancelar=true;atlasMensaje('Cancelando tras terminar la hoja actual…');});
  abrirBtn.addEventListener('click',imprimirAtlas);
  estimarAtlas();

  // Contraído: solo botón flotante 36 x 36, sin encabezado ni menú.
  // Guardar los display originales, incluido el input CSV oculto.
  const secciones = [...panel.children].filter(el => el !== titulo);
  const displayOriginal = new Map(secciones.map(el => [el, el.style.display]));
  let oculto = false;
  ocultar.addEventListener("click", () => {
    oculto = !oculto;
    secciones.forEach(el => {
      el.style.display = oculto ? "none" : displayOriginal.get(el);
    });
    tituloTexto.style.display = oculto ? "none" : "";
    titulo.style.marginBottom = oculto ? "0" : "8px";
    titulo.style.gap = oculto ? "0" : "7px";
    panel.style.width = oculto ? "36px" : "450px";
    panel.style.padding = oculto ? "0" : "14px";
    panel.style.background = oculto ? "transparent" : "#fff";
    panel.style.border = oculto ? "none" : "1px solid #bdc7d0";
    panel.style.boxShadow = oculto ? "none" : "0 7px 30px #0004";
    ocultar.textContent = oculto ? "☰" : "Contraer";
    ocultar.title = oculto ? "Mostrar panel de supervisores" : "Ocultar panel";
    ocultar.setAttribute("aria-expanded", String(!oculto));
    ocultar.style.width = oculto ? "36px" : "";
    ocultar.style.height = oculto ? "36px" : "";
    ocultar.style.padding = oculto ? "0" : "5px 8px";
    ocultar.style.fontSize = oculto ? "21px" : "12px";
  });
  function cerrarPanel() {
    if (atlasActivo) { atlasCancelar = true; mensaje("Espera a que termine de cancelar el atlas."); return; }
    abierto = false;
    ++cargaId;
    // La inicialización del módulo PDF registra su función de cierre aquí.
    try { cerrarAtlas?.(); } catch (e) { console.warn(e); }
    try { cambiarDetalle(0); } catch (e) { console.warn(e); }
    retirarCapa();
    panel.remove();
    if (w.__superponerKMZ?.cerrar === cerrarPanel) delete w.__superponerKMZ;
  }
  cerrar.addEventListener("click", cerrarPanel);
  w.__superponerKMZ = { cerrar: cerrarPanel, getPuntos: () => puntos.slice(), getCapa: () => capa };
  if (anteriores.length) {
    puntos = anteriores.map(a => new ol.Feature({
      geometry: new ol.geom.Point(a.xy),
      codigo: a.codigo,
      numero: a.numero,
      bloque: OPCIONES_BLOQUE.includes(a.bloque) ? a.bloque : SIN_BLOQUE
    }));
    capa = new ol.layer.Vector({
      source: new ol.source.Vector({ features: puntos }),
      zIndex: 100000,
      style: estiloPunto
    });
    map.addLayer(capa);
    reconstruirLista();
    dibujarTabla();
    estimarAtlas();
    mensaje(`Recuperados ${puntos.length} puntos desde tu visor anterior, con sus bloques.`);
  } else {
    retirarCapa();
    console.log('Panel V4.1 listo: selecciona KMZ o KML.');
  }
})();
