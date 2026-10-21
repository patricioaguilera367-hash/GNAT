/*
 * CENTRALITY V8 - PLANILLA / VINCULOS COMPARTIDOS / BLOQUES / PLANOS
 * Ejecutar en la consola del navegador con el mapa de Centrality abierto.
 * Lee archivos locales. No envia archivos ni cambia datos de Centrality.
 * Los colores y filtros se guardan en el proyecto JSON; CSV solo guarda las categorias.
 * La exportación PDF usa solo la cartografía renderizada a zoom fijo.
 * Las capas WMTS no se convierten en líneas vectoriales.
 */
(() => {
  "use strict";

  const CSV_TABLES = {
    route: { columns: ["ID", "Numero", "Subestacion", "Longitud", "Latitud", "SupervisorColor", "BloqueID", "AperturasIDs"],
      keys: ["id", "numero", "subestacion", "longitud", "latitud", "supervisorColor", "bloqueId", "aperturasIds"], tipo: "PUNTO" },
    opening: { columns: ["ID", "Numero", "Codigo", "Longitud", "Latitud", "SupervisorColor", "Bloques"],
      keys: ["id", "numero", "codigo", "longitud", "latitud", "supervisorColor", "bloques"], tipo: "APERTURA" }
  };

  function normalizeTableRows(rows, kind, reservedIds = []) {
    const ids = new Set(reservedIds), numbers = new Set();
    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      if (id && (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) || ids.has(id))) {
        throw Error("ID inválido o duplicado: " + id);
      }
      if (id) ids.add(id);
    }
    let nextId = 1;
    return rows.map(row => {
      let id = String(row.id ?? "").trim();
      if (!id) {
        while (ids.has("marker-" + nextId)) nextId++;
        id = "marker-" + nextId++;
        ids.add(id);
      }
      const numero = Number(row.numero);
      if (!Number.isSafeInteger(numero) || numero < 1 || numbers.has(numero)) {
        throw Error("Numero inválido o duplicado: " + row.numero);
      }
      numbers.add(numero);
      const coordinate = (value, limit, name) => {
        const text = String(value ?? "").trim();
        const number = Number(text.replace(",", "."));
        if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text) ||
            !Number.isFinite(number) || Math.abs(number) > limit) throw Error(name + " inválida.");
        return number;
      };
      const supervisorColor = String(row.supervisorColor ?? "").trim();
      if (!["Verde", "Naranjo", "Azul", "Sin asignar"].includes(supervisorColor)) {
        throw Error("SupervisorColor inválido: " + supervisorColor);
      }
      const result = { id, numero, longitud: coordinate(row.longitud, 180, "Longitud"),
        latitud: coordinate(row.latitud, 90, "Latitud"), supervisorColor };
      if (kind === "route") {
        result.subestacion = String(row.subestacion ?? "");
        result.bloqueId = String(row.bloqueId ?? "").trim();
        if (result.bloqueId.includes("|")) throw Error("BloqueID admite un solo bloque.");
        const refs = Array.isArray(row.aperturasIds) ? row.aperturasIds : String(row.aperturasIds ?? "").split("|");
        result.aperturasIds = [...new Set(refs.map(v=>String(v).trim()).filter(Boolean))];
      } else {
        result.codigo = String(row.codigo ?? "");
        const blocks = Array.isArray(row.bloques) ? row.bloques : String(row.bloques ?? "").split("|");
        result.bloques = [...new Set(blocks.map(value => String(value).trim()).filter(Boolean))];
        if (result.bloques.some(value => value.includes("|"))) throw Error("Bloques inválidos.");
      }
      return result;
    });
  }

  function parseTableCSV(text, kind, reservedIds = []) {
    const records = [];
    let record = [], value = "", quoted = false, closed = false;
    text = String(text).replace(/^\ufeff/, "");
    for (let i = 0; i <= text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === undefined) throw Error("CSV con comillas incompletas.");
        if (c === '"') {
          if (text[i + 1] === '"') { value += '"'; i++; }
          else { quoted = false; closed = true; }
        } else value += c;
      } else if (c === ";" || c === "\r" || c === "\n" || c === undefined) {
        record.push(value);
        value = ""; closed = false;
        if (c !== ";") {
          if (record.some(part => part.trim())) records.push(record);
          record = [];
          if (c === "\r" && text[i + 1] === "\n") i++;
        }
      } else if (c === '"' && !value && !closed) quoted = true;
      else {
        if (closed || c === '"') throw Error("CSV con comillas inválidas.");
        value += c;
      }
    }
    const { columns, keys } = CSV_TABLES[kind];
    const legacy = kind === "route" && records[0]?.join(";") === columns.slice(0,-1).join(";");
    const effectiveColumns = legacy ? columns.slice(0,-1) : columns;
    const effectiveKeys = legacy ? keys.slice(0,-1) : keys;
    if (!records.length || records[0].join(";") !== effectiveColumns.join(";")) {
      throw Error("Selecciona un CSV con las columnas " + columns.join(";") + " (también se admite recorrido antiguo sin AperturasIDs).");
    }
    return normalizeTableRows(records.slice(1).map(values => {
      if (values.length !== effectiveColumns.length) throw Error("CSV con columnas incompletas o adicionales.");
      return Object.fromEntries(effectiveKeys.map((key, index) => [key, values[index]]));
    }), kind, reservedIds);
  }

  function serializeTableCSV(rows, kind) {
    const quote = value => /[;"\r\n]/.test(String(value))
      ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
    const { columns, keys } = CSV_TABLES[kind];
    const emitLinks = kind === "route" && rows.some(r => (Array.isArray(r.aperturasIds) ? r.aperturasIds.length : String(r.aperturasIds||"").trim()));
    const activeColumns = kind === "route" && !emitLinks ? columns.slice(0,-1) : columns;
    const activeKeys = kind === "route" && !emitLinks ? keys.slice(0,-1) : keys;
    return [activeColumns.join(";"), ...normalizeTableRows(rows, kind).map(row =>
      activeKeys.map(key => quote(["bloques", "aperturasIds"].includes(key) ? row[key].join("|") : row[key])).join(";"))].join("\r\n");
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeRouteRows: (rows, reservedIds) => normalizeTableRows(rows, "route", reservedIds),
      normalizeOpeningRows: (rows, reservedIds) => normalizeTableRows(rows, "opening", reservedIds),
      parseRouteCSV: (text, reservedIds) => parseTableCSV(text, "route", reservedIds),
      parseOpeningCSV: (text, reservedIds) => parseTableCSV(text, "opening", reservedIds),
      serializeRouteCSV: rows => serializeTableCSV(rows, "route"),
      serializeOpeningCSV: rows => serializeTableCSV(rows, "opening")
    };
    if (typeof document === "undefined") return;
  }

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
      !ol?.style?.Text || !ol?.style?.Fill || !ol?.style?.Stroke ||
      !ol?.style?.RegularShape) {
    console.error("El mapa no expone los componentes necesarios de OpenLayers.");
    return;
  }

  // Si viene de V1/V2, copiar puntos ANTES de cerrar su panel para no perder
  // la carga ni los bloques ya trabajados en esta sesión.
  const bloquesAnteriores = (() => {
    try { return w.__superponerKMZ?.getBloques?.() || []; }
    catch (_) { return []; }
  })();
  const preferenciasAnteriores = (() => {
    try { return w.__superponerKMZ?.getPreferencias?.() || null; }
    catch (_) { return null; }
  })();
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
              id: f.get('id'), tipo: f.get('tipo'), bloqueId: f.get('bloqueId'), bloques: f.get('bloques'), aperturasIds:f.get('aperturasIds'),
              codigo: String(f.get('codigo') ?? f.get('nombre') ?? f.get('name') ?? 'Sin código'),
              bloque: String(f.get('bloque') || 'Sin asignar')});
          }
        }
        if (layer.getLayers) visitarAnteriores(layer.getLayers());
      }
    }
    visitarAnteriores(map.getLayers());
    anteriores.sort((a,b) => a.numero - b.numero);
    if (new Set(anteriores.map(x => (x.tipo || 'PUNTO') + ':' + x.numero)).size !== anteriores.length) anteriores.length = 0;
  } catch(e) { anteriores.length = 0; console.warn('No fue posible conservar la carga anterior:',e); }

  // Cerrar paneles anteriores para evitar ediciones simultáneas de la malla WMTS.
  try { w.__pruebaDetalleCentrality?.cerrar?.(); } catch (e) { console.warn(e); }
  try { w.__centralityAtlasPDF?.destruir?.(); } catch (e) { console.warn(e); }
  try { w.__superponerKMZ?.cerrar?.(); } catch (e) {
    console.warn("No se pudo retirar el panel anterior:", e);
  }

  const SIN_BLOQUE = "Sin asignar";
  const COLOR_APERTURAS = "#e53935"; // SIEMPRE rojo, independiente del supervisor.
  const COLORES_DEFECTO = Object.freeze({
    [SIN_BLOQUE]: "#e53935",
    Verde: "#198754",
    Naranjo: "#ef8b16",
    Azul: "#2469d8"
  });
  const COLORES = { ...COLORES_DEFECTO };
  const BLOQUES = ["Verde", "Naranjo", "Azul"];
  const OPCIONES_BLOQUE = [SIN_BLOQUE, ...BLOQUES];
  const visiblesSupervisores = new Set(OPCIONES_BLOQUE);
  const colorSeguro = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  if (preferenciasAnteriores) {
    for (const b of OPCIONES_BLOQUE) {
      const color = preferenciasAnteriores.colores?.[b];
      if (colorSeguro(color)) COLORES[b] = color;
    }
    if (Array.isArray(preferenciasAnteriores.visibles) &&
        preferenciasAnteriores.visibles.every(b => OPCIONES_BLOQUE.includes(b))) {
      visiblesSupervisores.clear();
      preferenciasAnteriores.visibles.forEach(b => visiblesSupervisores.add(b));
    }
  }
  let puntos = [];
  // El código del bloque es estable (B1, B2...). Su nombre es solo descriptivo.
  const definicionesBloques = new Map();
  for (const item of bloquesAnteriores) {
    if (item && typeof item.id === "string" && /^[\w.-]{1,40}$/.test(item.id)) {
      definicionesBloques.set(item.id, String(item.nombre || item.id).slice(0, 120));
    }
  }
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
  let textoAviso = "";
  let cacheEstilos = new WeakMap();

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
  const tituloTexto = crear(titulo, "strong", "Centrality · Puntos y bloques", "font-size:15px;");
  const abrirPlanillaBtn = btn(titulo, "Abrir planilla ↗", "padding:5px 8px;font-weight:bold;background:#e9f3ff;");
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

  // Visibilidad por categoria independiente del bloque B1/B2.
  // Las X siempre son rojas, aunque su categoria siga filtrandose igual que los puntos.
  const filtrosSupervisores = crear(controles, "details", null,
    "border:1px solid #dbe3ea;border-radius:7px;padding:8px;margin:5px 0;");
  filtrosSupervisores.open = true;
  crear(filtrosSupervisores, "summary", "Supervisores · mostrar / ocultar y colores",
    "font-size:12px;font-weight:bold;cursor:pointer;");
  const cajaFiltros = crear(filtrosSupervisores, "div", null,
    "display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px;");
  const filtrosCategoria = new Map();
  const colorPickers = new Map();
  for (const grupo of OPCIONES_BLOQUE) {
    const caja = crear(cajaFiltros, "div", null,
      "display:flex;align-items:center;gap:4px;border:1px solid #dce3eb;"+
      "border-radius:6px;padding:5px;min-width:0;");
    const check = crear(caja, "input");
    check.type = "checkbox";
    check.checked = visiblesSupervisores.has(grupo);
    check.title = "Mostrar u ocultar " + grupo;
    const texto = crear(caja,"label",grupo,
      "font:11px Arial,sans-serif;flex:1;cursor:pointer;min-width:0;");
    const checkId = "centrality-supervisor-" + grupo.replace(/\s/g, "-");
    check.id = checkId;
    texto.htmlFor = checkId;
    const solo = btn(caja, "Solo", "font-size:10px;padding:3px 4px;");
    solo.title = "Mostrar únicamente " + grupo;
    const picker = crear(caja, "input", null,
      "width:24px;height:23px;padding:0;border:0;cursor:pointer;flex:none;");
    picker.type = "color";
    picker.value = COLORES[grupo];
    picker.title = "Cambiar color de puntos " + grupo + " (no cambia el rojo de las X)";
    filtrosCategoria.set(grupo, {check,solo});
    colorPickers.set(grupo,picker);
  }
  const barraVisibilidad = fila(filtrosSupervisores, "margin-top:7px;");
  const mostrarTodosSupervisores = btn(barraVisibilidad,"Mostrar todos","flex:1;font-size:11px;padding:5px;");
  const ocultarTodosSupervisores = btn(barraVisibilidad,"Ocultar todos","flex:1;font-size:11px;padding:5px;");
  crear(filtrosSupervisores, "div", "Las aperturas siempre son X rojas; el filtro usa su supervisor.",
    "font-size:10px;color:#526174;margin-top:6px;");

  // Este filtro es distinto del color del supervisor; usa BloqueID/Bloques del CSV.
  const filtroBloqueFila = fila(controles, "margin:2px 0 8px;");
  crear(filtroBloqueFila, "span", "Ver bloque:", "font-size:12px;white-space:nowrap;");
  const filtroBloqueTrabajo = crear(filtroBloqueFila, "select", null,
    ESTILO_CONTROL + "flex:1;min-width:180px;");
  const lista = crear(controles, "select", null,
    ESTILO_CONTROL + "display:block;width:100%;margin:5px 0 8px 0;");
  lista.setAttribute("aria-label", "Ir a un punto");

  const resumen = crear(controles, "div", "",
    "font-size:12px;margin:7px 0;line-height:1.6;");

  const agrupacion = crear(controles, "div", null,
    "background:#f3f6f9;border:1px solid #dbe3ea;border-radius:7px;" +
    "padding:9px;margin:8px 0;");
  crear(agrupacion, "strong", "Asignar color de supervisor a seleccionados",
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

  // Editor compacto: nombres humanos y asignaciones, sin confundir bloques y supervisores.
  const gestorBloques = crear(controles, "details", null,
    "border:1px solid #dbe3ea;border-radius:7px;padding:8px;margin:7px 0;");
  crear(gestorBloques, "summary", "Administrar bloques (IDs y nombres)",
    "font-size:12px;font-weight:bold;cursor:pointer;");
  const gestorCuerpo = crear(gestorBloques, "div", null, "padding-top:8px;");
  crear(gestorCuerpo, "div", "Selecciona un bloque para renombrarlo o asignar los puntos marcados:",
    "font-size:11px;color:#526174;margin-bottom:6px;");
  const editarBloque = crear(gestorCuerpo, "select", null,
    ESTILO_CONTROL + "display:block;width:100%;margin-bottom:5px;");
  const nombreBloque = crear(gestorCuerpo, "input", null,
    ESTILO_CONTROL + "display:block;width:100%;margin-bottom:5px;");
  nombreBloque.type = "text";
  nombreBloque.maxLength = 120;
  nombreBloque.placeholder = "Nombre: p. ej. Desconexión 1";
  const guardarNombreBloque = btn(gestorCuerpo, "Guardar nombre del bloque",
    "width:100%;margin-bottom:8px;");
  const gestorAsignacion = fila(gestorCuerpo, "margin-bottom:7px;");
  const asignarBloque = btn(gestorAsignacion, "Asociar seleccionados", "flex:1;");
  const desasignarBloque = btn(gestorAsignacion, "Quitar asociación", "flex:1;");
  crear(gestorCuerpo, "div", "Crear bloque nuevo:",
    "font-size:11px;color:#526174;margin-bottom:4px;");
  const nuevoIdBloque = crear(gestorCuerpo, "input", null,
    ESTILO_CONTROL + "width:29%;margin-right:2%;");
  nuevoIdBloque.placeholder = "B3";
  nuevoIdBloque.maxLength = 40;
  const nuevoNombreBloque = crear(gestorCuerpo, "input", null,
    ESTILO_CONTROL + "width:68%;");
  nuevoNombreBloque.placeholder = "Nombre del bloque";
  nuevoNombreBloque.maxLength = 120;
  const crearNuevoBloque = btn(gestorCuerpo, "Crear bloque", "width:100%;margin-top:5px;");
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
  th("Supervisor", "100px");
  const tbody = crear(tabla, "tbody");
  const pieTabla = crear(controles, "div", "",
    "font-size:11px;color:#566575;margin:5px 0 9px 0;");

  const acciones = fila(panel, "margin-top:10px;");
  const verTodos = btn(acciones, "Ver todos", "flex:1;");
  const verSeleccion = btn(acciones, "Ver selección", "flex:1;");
  const quitar = btn(acciones, "Quitar puntos", "flex:1;");
  const acciones2 = fila(panel, "margin-top:7px;");
  const exportar = btn(acciones2, "Guardar recorrido CSV", "flex:1;");
  const importar = btn(acciones2, "Importar recorrido CSV", "flex:1;");
  const accionesAperturas = fila(panel, "margin-top:7px;");
  const exportarAperturas = btn(accionesAperturas, "Guardar aperturas CSV", "flex:1;");
  const importarAperturas = btn(accionesAperturas, "Importar aperturas CSV", "flex:1;");
  let csvKind = "route";
  const cerrar = btn(acciones2, "Cerrar", "flex:0.6;");
  const botonesProyecto = fila(panel, "margin-top:7px;");
  const guardarProyectoBtn = btn(botonesProyecto, "Guardar proyecto JSON", "flex:1;");
  const abrirProyectoBtn = btn(botonesProyecto, "Abrir proyecto JSON", "flex:1;");
  const archivoProyecto = crear(panel, "input", null, "display:none;");
  archivoProyecto.type = "file";
  archivoProyecto.accept = ".json,application/json";
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

  function bloquesDe(f) {
    return f.get("tipo") === "APERTURA"
      ? (Array.isArray(f.get("bloques")) ? f.get("bloques") : [])
      : (f.get("bloqueId") ? [String(f.get("bloqueId"))] : []);
  }
  function perteneceAlBloque(f, id = filtroBloqueTrabajo.value) {
    if (!id || bloquesDe(f).includes(id)) return true;
    // Aperturas compartidas: la pertenencia se deriva de los recorridos que la referencian.
    if (f?.get("tipo") !== "APERTURA") return false;
    const aperturaId = String(f.get("id"));
    return puntos.some(p => p.get("tipo") === "PUNTO" && p.get("bloqueId") === id &&
      (p.get("aperturasIds") || []).includes(aperturaId));
  }
  function categoriaSupervisor(f) {
    const b = f?.get?.("bloque");
    return OPCIONES_BLOQUE.includes(b) ? b : SIN_BLOQUE;
  }
  function puntoVisibleEnMapa(f) {
    return Boolean(f) && perteneceAlBloque(f) && visiblesSupervisores.has(categoriaSupervisor(f));
  }
  function puntosFiltrados() {
    const q = busqueda.value.trim().toLocaleLowerCase("es");
    return puntos.filter(f => {
      const valor = String(f.get("numero")) + " " + puntoCodigo(f);
      return puntoVisibleEnMapa(f) && valor.toLocaleLowerCase("es").includes(q);
    });
  }
  function registrarBloquesUsados() {
    for (const f of puntos) for (const id of bloquesDe(f)) {
      if (id && !definicionesBloques.has(id)) definicionesBloques.set(id, id);
    }
  }
  function actualizarControlesBloques() {
    registrarBloquesUsados();
    const anteriorFiltro = filtroBloqueTrabajo.value;
    const anteriorEditor = editarBloque.value;
    const items = [...definicionesBloques.entries()].sort((a,b) =>
      a[0].localeCompare(b[0], "es", {numeric:true}));
    filtroBloqueTrabajo.replaceChildren();
    const todos = crear(filtroBloqueTrabajo, "option", "Todos los bloques");
    todos.value = "";
    editarBloque.replaceChildren();
    for (const [id,nombre] of items) {
      const etiqueta = id + " — " + nombre;
      const o1 = crear(filtroBloqueTrabajo,"option",etiqueta); o1.value=id;
      const o2 = crear(editarBloque,"option",etiqueta); o2.value=id;
    }
    filtroBloqueTrabajo.value = definicionesBloques.has(anteriorFiltro) ? anteriorFiltro : "";
    editarBloque.value = definicionesBloques.has(anteriorEditor)
      ? anteriorEditor : (items[0]?.[0] || "");
    nombreBloque.value = definicionesBloques.get(editarBloque.value) || "";
    const habilitado = Boolean(editarBloque.value);
    nombreBloque.disabled = guardarNombreBloque.disabled = !habilitado;
    asignarBloque.disabled = desasignarBloque.disabled = !habilitado;
  }
  function refrescarVista() {
    actualizarControlesBloques();
    reconstruirLista();
    dibujarTabla();
    redibujarMapa();
    if (typeof estimarAtlas === "function") estimarAtlas();
  }

  function estiloPunto(f, resolution) {
    if (!puntoVisibleEnMapa(f)) return null;
    const bloque = categoriaSupervisor(f);
    const indice = puntos.indexOf(f);
    const apertura = f.get("tipo") === "APERTURA";
    const activo = enfocado === indice;
    const marcado = seleccionado.has(indice);
    const conTexto = etiquetas === "siempre" ||
      (etiquetas === "cerca" && resolution < UMBRAL_ETIQUETA);
    const clave = [bloque, COLORES[bloque], apertura, activo, marcado, conTexto, contenidoEtiqueta].join("|");
    let cache = cacheEstilos.get(f);
    if (!cache) {
      cache = new Map();
      cacheEstilos.set(f, cache);
    }
    if (cache.has(clave)) return cache.get(clave);
    const estilo = new ol.style.Style({
      image: apertura
        ? new ol.style.RegularShape({
            points: 4, radius: activo ? 13 : marcado ? 12 : 10,
            radius2: 0, angle: Math.PI / 4,
            stroke: new ol.style.Stroke({
              color: COLOR_APERTURAS, width: activo ? 5 : 4
            })
          })
        : new ol.style.Circle({
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
    puntos.filter(puntoVisibleEnMapa).forEach(f => {
      const b = categoriaSupervisor(f);
      cuentas[b in cuentas ? b : SIN_BLOQUE]++;
    });
    resumen.replaceChildren();
    const visibles = puntos.filter(puntoVisibleEnMapa);
    const aperturas = visibles.filter(f => f.get("tipo") === "APERTURA").length;
    crear(resumen, "span", `${visibles.length} objetos (${aperturas} aperturas X) · `);
    OPCIONES_BLOQUE.forEach((b, i) => {
      const dato = crear(resumen, "strong", `${b}: ${cuentas[b]}`,
        `color:${COLORES[b]};opacity:${visiblesSupervisores.has(b) ? 1 : .45};`);
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
      if (!puntoVisibleEnMapa(f)) return;
      const marca = f.get("tipo") === "APERTURA" ? "✕ " : "";
      const opt = crear(lista, "option", `${marca}${f.get("numero")} · ${puntoCodigo(f)}`);
      opt.value = String(i);
    });
    lista.value = [...lista.options].some(o => o.value === actual) ? actual : "";
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
      const indice = puntos.indexOf(f);
      const grupo = f.get("bloque");
      const tr = crear(tbody, "tr", null,
        "cursor:pointer;border-bottom:1px solid #e5e9ee;" +
        (indice === enfocado ? "background:#e8f0fb;" : "") +
        `border-left:4px solid ${f.get("tipo") === "APERTURA" ? COLOR_APERTURAS : COLORES[categoriaSupervisor(f)]};`);
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
      td((f.get("tipo") === "APERTURA" ? "✕ " : "") + puntoCodigo(f),
        "font-weight:600;word-break:break-word;");
      const tBloque = td("");
      const s = crear(tBloque, "select", null,
        "font:11px Arial,sans-serif;width:100%;max-width:100%;" +
        "padding:5px 2px;border:1px solid #c4cdd8;border-radius:4px;");
       OPCIONES_BLOQUE.forEach(b => {
        const op = crear(s, "option", b);
        op.value = b;
      });
      s.value = grupo;
      s.style.color = COLORES[categoriaSupervisor(f)];
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
    const todos = n > 0 && visibles.every(f => seleccionado.has(puntos.indexOf(f)));
    const algunos = visibles.some(f => seleccionado.has(puntos.indexOf(f)));
    checkTodo.checked = todos;
    checkTodo.indeterminate = algunos && !todos;
    mostrarResumen();
  }

  function refrescarSeleccion() {
    const visibles = puntosFiltrados();
    checkTodo.checked = visibles.length > 0 && visibles.every(f =>
      seleccionado.has(puntos.indexOf(f)));
    checkTodo.indeterminate = !checkTodo.checked && visibles.some(f =>
      seleccionado.has(puntos.indexOf(f)));
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
    mensaje(`${indices.length} punto(s) con supervisor/color ${bloque}.`);
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
    filtroBloqueTrabajo.value = "";
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
            id: "marker-" + (nuevos.length + 1),
            tipo: "PUNTO",
            bloqueId: "",
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
      map.addLayer(capa);
      refrescarVista();
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

  function featuresForTable(kind) {
    return puntos.filter(f => (f.get("tipo") || "PUNTO") === CSV_TABLES[kind].tipo);
  }

  function guardarCSV(kind) {
    try {
      if (!ol.proj?.toLonLat) throw Error("No es posible convertir coordenadas a EPSG:4326.");
      const features = featuresForTable(kind);
      const reserved = puntos.filter(f => !features.includes(f)).map(f => f.get("id"));
      const rows = normalizeTableRows(features.map(f => {
        const [longitud, latitud] = ol.proj.toLonLat(
          f.getGeometry().getCoordinates(), map.getView().getProjection());
        return { id: f.get("id"), numero: f.get("numero"),
          subestacion: String(f.get("codigo") ?? ""), codigo: String(f.get("codigo") ?? ""),
          longitud, latitud, supervisorColor: f.get("bloque"),
          bloqueId: f.get("bloqueId") || "", bloques: f.get("bloques") || [],
          aperturasIds: f.get("aperturasIds") || [] };
      }), kind, reserved);
      const blob = new Blob(["\ufeff" + serializeTableCSV(rows, kind)], {type: "text/csv;charset=utf-8"});
      rows.forEach((row, i) => features[i].set("id", row.id));
      const url = w.URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = kind === "route" ? "recorrido.csv" : "aperturas.csv";
      doc.body.appendChild(a);
      a.click();
      a.remove();
      w.setTimeout(() => w.URL.revokeObjectURL(url), 2000);
      mensaje("CSV guardado localmente: " + a.download);
    } catch (e) { mensaje("Error al guardar CSV: " + e.message, true); }
  }

  async function recuperarCSV(file, kind) {
    if (!file) return;
    const token = ++cargaId;
    try {
      const texto = await file.text();
      if (!abierto || token !== cargaId) return;
      const retained = puntos.filter(f => (f.get("tipo") || "PUNTO") !== CSV_TABLES[kind].tipo);
      const rows = parseTableCSV(texto, kind, retained.map(f => f.get("id")));
      if (!ol.proj?.fromLonLat) throw Error("No es posible convertir coordenadas desde EPSG:4326.");
      const nuevos = rows.map(row => new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat(
          [row.longitud, row.latitud], map.getView().getProjection())),
        id: row.id, numero: row.numero, tipo: CSV_TABLES[kind].tipo,
        codigo: kind === "route" ? row.subestacion : row.codigo,
        bloque: row.supervisorColor, bloqueId: row.bloqueId, bloques: row.bloques, aperturasIds:row.aperturasIds||[]
      }));
      const combined = kind === "route" ? [...nuevos, ...retained] : [...retained, ...nuevos];
      const nuevaCapa = new ol.layer.Vector({
        source: new ol.source.Vector({features: combined}), zIndex: 100000, style: estiloPunto
      });
      retirarCapa();
      puntos = combined;
      capa = nuevaCapa;
      map.addLayer(capa);
      refrescarVista();
      mensaje(`Recuperados ${rows.length} registros desde ${kind === "route" ? "recorrido.csv" : "aperturas.csv"}.`);
    } catch (e) {
      if (abierto && token === cargaId) mensaje("Error al recuperar CSV: " + e.message, true);
    } finally {
      archivoCSV.value = "";
    }
  }

  function asociarSeleccionados(quitar = false) {
    const id = editarBloque.value;
    if (!definicionesBloques.has(id)) return mensaje("Primero selecciona un bloque.", true);
    if (!seleccionado.size) return mensaje("Selecciona uno o más registros en la tabla.", true);
    let afectados = 0;
    for (const indice of seleccionado) {
      const f = puntos[indice];
      if (!f) continue;
      if (f.get("tipo") === "APERTURA") {
        const antes = bloquesDe(f);
        f.set("bloques", quitar ? antes.filter(b => b !== id) : [...new Set([...antes, id])]);
      } else {
        if (quitar) { if (f.get("bloqueId") === id) f.set("bloqueId", ""); }
        else f.set("bloqueId", id);
      }
      afectados++;
    }
    seleccionado.clear();
    refrescarVista();
    mensaje(`${afectados} registro(s) ${quitar ? "desasociados de" : "asociados a"} ${id}.`);
  }
  filtroBloqueTrabajo.addEventListener("change", () => {
    // El bloque B1/B2 es independiente de que categorias esten visibles.
    seleccionado.clear();
    enfocado = -1;
    reconstruirLista();
    dibujarTabla();
    redibujarMapa();
    estimarAtlas();
  });
  editarBloque.addEventListener("change", () => {
    nombreBloque.value = definicionesBloques.get(editarBloque.value) || "";
  });
  guardarNombreBloque.addEventListener("click", () => {
    const id = editarBloque.value;
    if (!definicionesBloques.has(id)) return;
    const nombre = nombreBloque.value.trim();
    if (!nombre) return mensaje("Escribe un nombre para el bloque.", true);
    definicionesBloques.set(id,nombre);
    actualizarControlesBloques();
    mensaje(`Bloque ${id}: ${nombre}`);
  });
  crearNuevoBloque.addEventListener("click", () => {
    const id = nuevoIdBloque.value.trim();
    const nombre = nuevoNombreBloque.value.trim() || id;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(id)) {
      return mensaje("Código de bloque inválido. Usa letras, números, punto, guion o _.", true);
    }
    if (definicionesBloques.has(id)) return mensaje("Ese código de bloque ya existe.", true);
    definicionesBloques.set(id,nombre);
    actualizarControlesBloques();
    editarBloque.value=id;
    nombreBloque.value=nombre;
    nuevoIdBloque.value="";
    nuevoNombreBloque.value="";
    mensaje(`Bloque ${id} creado. Selecciona puntos para asociarlos.`);
  });
  asignarBloque.addEventListener("click", () => asociarSeleccionados(false));
  desasignarBloque.addEventListener("click", () => asociarSeleccionados(true));
  archivo.addEventListener("change", () => cargar(archivo.files?.[0]));
  busqueda.addEventListener("input", dibujarTabla);
  function cambiarVisibilidad() {
    for (const i of [...seleccionado]) {
      if (!puntoVisibleEnMapa(puntos[i])) seleccionado.delete(i);
    }
    if (!puntoVisibleEnMapa(puntos[enfocado])) enfocado = -1;
    for (const [grupo, {check}] of filtrosCategoria) check.checked = visiblesSupervisores.has(grupo);
    reconstruirLista();
    dibujarTabla();
    redibujarMapa();
    estimarAtlas();
  }
  for (const grupo of OPCIONES_BLOQUE) {
    const {check,solo} = filtrosCategoria.get(grupo);
    check.addEventListener("change", () => {
      if (check.checked) visiblesSupervisores.add(grupo);
      else visiblesSupervisores.delete(grupo);
      cambiarVisibilidad();
    });
    solo.addEventListener("click", () => {
      visiblesSupervisores.clear();
      visiblesSupervisores.add(grupo);
      cambiarVisibilidad();
    });
    colorPickers.get(grupo).addEventListener("input", e => {
      const color = e.target.value;
      if (!colorSeguro(color)) return;
      COLORES[grupo] = color;
      cacheEstilos = new WeakMap(); // evitar conservar un estilo por cada color explorado
      if (botonesColores[grupo]) {
        botonesColores[grupo].style.backgroundColor = color;
        botonesColores[grupo].style.borderColor = color;
      }
      dibujarTabla();
      redibujarMapa();
    });
  }
  mostrarTodosSupervisores.addEventListener("click", () => {
    OPCIONES_BLOQUE.forEach(b => visiblesSupervisores.add(b));
    cambiarVisibilidad();
  });
  ocultarTodosSupervisores.addEventListener("click", () => {
    visiblesSupervisores.clear();
    cambiarVisibilidad();
  });
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
      const i = puntos.indexOf(f);
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
    encuadrar(puntosFiltrados().map(f => puntos.indexOf(f)));
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
  exportar.addEventListener("click", () => guardarCSV("route"));
  exportarAperturas.addEventListener("click", () => guardarCSV("opening"));
  importar.addEventListener("click", () => { csvKind = "route"; archivoCSV.click(); });
  importarAperturas.addEventListener("click", () => { csvKind = "opening"; archivoCSV.click(); });
  archivoCSV.addEventListener("change", () => recuperarCSV(archivoCSV.files?.[0], csvKind));

  function descargarTexto(nombre, texto, tipo) {
    const url = w.URL.createObjectURL(new Blob([texto], {type:tipo}));
    const a = crear(doc.body,"a");
    a.href=url;
    a.download=nombre;
    a.click();
    a.remove();
    w.setTimeout(() => w.URL.revokeObjectURL(url), 2000);
  }
  guardarProyectoBtn.addEventListener("click", () => {
    if (!ol.proj?.toLonLat) return mensaje("Conversión de coordenadas no disponible.", true);
    const registros = puntos.map(f => {
      const [longitud,latitud] = ol.proj.toLonLat(f.getGeometry().getCoordinates(), map.getView().getProjection());
      return {id:String(f.get('id')),numero:Number(f.get('numero')),tipo:f.get('tipo')||'PUNTO',
        codigo:String(f.get('codigo')||''),longitud,latitud,supervisorColor:f.get('bloque')||SIN_BLOQUE,
        bloqueId:String(f.get('bloqueId')||''),bloques:bloquesDe(f),aperturasIds:f.get('aperturasIds')||[]};
    });
    const proyecto = {version:3,formato:'CentralityLocal',
      bloques:[...definicionesBloques].map(([id,nombre])=>({id,nombre})),
      coloresSupervisores:{...COLORES},visiblesSupervisores:[...visiblesSupervisores],registros};
    descargarTexto('centrality-proyecto.json',JSON.stringify(proyecto,null,2), 'application/json;charset=utf-8');
    mensaje(`Proyecto guardado: ${registros.length} registros y ${proyecto.bloques.length} bloques.`);
  });
  abrirProyectoBtn.addEventListener("click", () => archivoProyecto.click());
  archivoProyecto.addEventListener("change", async () => {
    const file = archivoProyecto.files?.[0];
    if (!file) return;
    const token = ++cargaId;
    try {
      if (file.size > 10_000_000) throw Error("Proyecto demasiado grande (máx. 10 MB).");
      const data = JSON.parse(await file.text());
      if (!abierto || token !== cargaId) return;
      if (data?.formato !== 'CentralityLocal' || ![1,2,3].includes(data.version) ||
          !Array.isArray(data.registros) || !Array.isArray(data.bloques)) {
        throw Error("Formato de proyecto incompatible.");
      }
      if (data.registros.length > 50000 || data.bloques.length > 10000) {
        throw Error("Proyecto supera los límites de seguridad.");
      }
      const coloresProyecto = { ...COLORES_DEFECTO };
      if (data.coloresSupervisores !== undefined) {
        if (!data.coloresSupervisores || typeof data.coloresSupervisores !== 'object' ||
            Array.isArray(data.coloresSupervisores)) throw Error("Paleta de colores inválida.");
        for (const b of OPCIONES_BLOQUE) {
          const color = data.coloresSupervisores[b];
          if (color !== undefined && !colorSeguro(color)) throw Error("Color inválido: " + b);
          if (color) coloresProyecto[b] = color;
        }
      }
      const visiblesProyecto = data.visiblesSupervisores === undefined
        ? [...OPCIONES_BLOQUE] : data.visiblesSupervisores;
      if (!Array.isArray(visiblesProyecto) ||
          visiblesProyecto.some(b => !OPCIONES_BLOQUE.includes(b))) {
        throw Error("Filtros de supervisores inválidos.");
      }
      const nuevosBloques = new Map();
      for (const b of data.bloques) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(b?.id) || nuevosBloques.has(b.id)) {
          throw Error("Código de bloque inválido o duplicado en el proyecto.");
        }
        nuevosBloques.set(b.id,String(b.nombre || b.id).slice(0,120));
      }
      const filasRuta = data.registros.filter(r => r.tipo === 'PUNTO').map(r => ({
        id:r.id,numero:r.numero,subestacion:r.codigo,longitud:r.longitud,latitud:r.latitud,
        supervisorColor:r.supervisorColor,bloqueId:r.bloqueId || '',aperturasIds:r.aperturasIds||[]
      }));
      const filasApertura = data.registros.filter(r => r.tipo === 'APERTURA').map(r => ({
        id:r.id,numero:r.numero,codigo:r.codigo,longitud:r.longitud,latitud:r.latitud,
        supervisorColor:r.supervisorColor,bloques:r.bloques || []
      }));
      if (filasRuta.length + filasApertura.length !== data.registros.length) {
        throw Error("Hay tipos de registros desconocidos.");
      }
      const ruta = normalizeTableRows(filasRuta, 'route');
      const aperturas = normalizeTableRows(filasApertura, 'opening', ruta.map(r=>r.id));
      const validas = new Set(aperturas.map(a => a.id));
      for (const r of ruta) if (r.aperturasIds.some(id=>!validas.has(id)))
        throw Error("Referencias a aperturas inexistentes en " + r.id);
      if (!ol.proj?.fromLonLat) throw Error("Conversión de coordenadas no disponible.");
      const features = [...ruta.map(r=>({...r,tipo:'PUNTO',codigo:r.subestacion})),
        ...aperturas.map(r=>({...r,tipo:'APERTURA'}))].map(r=>new ol.Feature({
          geometry:new ol.geom.Point(ol.proj.fromLonLat([r.longitud,r.latitud],map.getView().getProjection())),
          id:r.id,numero:r.numero,tipo:r.tipo,codigo:r.codigo,bloque:r.supervisorColor,
          bloqueId:r.bloqueId||'',bloques:r.bloques||[],aperturasIds:r.aperturasIds||[]
        }));
      // No reemplazar ningún dato de trabajo hasta validar todo el proyecto.
      retirarCapa();
      definicionesBloques.clear();
      for (const [id,nombre] of nuevosBloques) definicionesBloques.set(id,nombre);
      for (const b of OPCIONES_BLOQUE) {
        COLORES[b] = coloresProyecto[b];
        colorPickers.get(b).value = COLORES[b];
        if (botonesColores[b]) {
          botonesColores[b].style.backgroundColor = COLORES[b];
          botonesColores[b].style.borderColor = COLORES[b];
        }
      }
      visiblesSupervisores.clear();
      visiblesProyecto.forEach(b=>visiblesSupervisores.add(b));
      for (const b of OPCIONES_BLOQUE) filtrosCategoria.get(b).check.checked = visiblesSupervisores.has(b);
      puntos=features;
      capa=new ol.layer.Vector({source:new ol.source.Vector({features}),zIndex:100000,style:estiloPunto});
      map.addLayer(capa);
      refrescarVista();
      mensaje(`Proyecto abierto: ${features.length} registros, ${definicionesBloques.size} bloques.`);
    } catch(e) { mensaje("Error al abrir proyecto: " + e.message,true); }
    finally { archivoProyecto.value=''; }
  });

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

  const incompletasFila = fila(cuerpoHerramientas, 'margin:4px 0 7px;');
  const incompletas = crear(incompletasFila, 'input'); incompletas.type = 'checkbox';
  crear(incompletasFila, 'span', 'Permitir hojas con teselas sin terminar', 'font-size:11px;');
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
  const MAX_HOJAS_ATLAS = 90;
  const ESPERA_HOJA = 30000;
  const sleep = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const htmlEscape = value => String(value).replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function atlasMensaje(mensaje, error = false) {
    statusAtlas.textContent = mensaje;
    statusAtlas.style.color = error ? '#b42318' : '#526174';
  }
  function puntosParaAtlas() {
    return puntosFiltrados().map(f => ({
      id: puntos.indexOf(f), numero: String(f.get('numero')), codigo: puntoCodigo(f),
      tipo: f.get('tipo') || 'PUNTO',
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
      salida, incompletas, calcularBtn, ...detailButtons].forEach(x=>x.disabled=disabled);
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
  function esperarRender(mapExport) {
    return new Promise((resolve,reject)=>{
      let done=false;
      let timer;
      const finish=ok=>{
        if(done)return;
        done=true;
        w.clearTimeout(timer);
        mapExport.un('rendercomplete',completed);
        if(atlasCancelar) reject(Error('Cancelado por el usuario.'));
        else if(ok||incompletas.checked)resolve(ok);
        else reject(Error('30 segundos sin confirmar todas las teselas de la hoja.'));
      };
      const completed=()=>finish(true);
      mapExport.on('rendercomplete',completed);
      timer=w.setTimeout(()=>finish(false),ESPERA_HOJA);
      try {mapExport.renderSync();} catch(e) {
        if(!done) {done=true;w.clearTimeout(timer);mapExport.un('rendercomplete',completed);reject(e);}
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
  async function capturarHoja(sheet,plan) {
    if(atlasCancelar)throw Error('Cancelado por el usuario.');
    const e=rendererExport.rendererMap;
    e.getView().setCenter(sheet.center);
    e.getView().setResolution(sheet.resolution);
    const complete=await esperarRender(e);
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
      const color=p.tipo==='APERTURA'
        ? COLOR_APERTURAS : (COLORES[p.bloque]||COLORES[SIN_BLOQUE]);
      const label=contenidoEtiqueta==='completo'?p.numero+' · '+p.codigo:p.numero;
      const marca = p.tipo === 'APERTURA'
        ? `<path d="M${(x-7*factor).toFixed(2)} ${(y-7*factor).toFixed(2)} `+
          `L${(x+7*factor).toFixed(2)} ${(y+7*factor).toFixed(2)} `+
          `M${(x+7*factor).toFixed(2)} ${(y-7*factor).toFixed(2)} `+
          `L${(x-7*factor).toFixed(2)} ${(y+7*factor).toFixed(2)}" `+
          `fill="none" stroke="${color}" stroke-width="${(4*factor).toFixed(2)}"/>`
        : `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(7*factor).toFixed(2)}" `+
          `fill="${color}" stroke="#fff" stroke-width="${(2*factor).toFixed(2)}"/>`;
      return `<g>${marca}`+
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
    const paper=dimensionesPapel();
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
      `${capturasAtlas.length} páginas · ${papel.value}. Elegir A1, escala 100%, sin márgenes.`+
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
    let plan;
    try{plan=obtenerPlanAtlas();}catch(e){atlasMensaje(e.message,true);return;}
    if(plan.total>MAX_HOJAS_ATLAS+1 ||
       (salida.value!=='general'&&(!plan.sheets.length || plan.estimated>MAX_HOJAS_ATLAS))){
      atlasMensaje('Demasiadas hojas. Baja zoom o cambia la distribución.',true);return;
    }
    if(plan.total>16 && !w.confirm(`Preparar ${plan.total} páginas ${papel.value} a ${plan.paper.dpi} dpi. Puede tardar y usar mucha memoria. ¿Continuar?`))return;
    atlasActivo=true;atlasCancelar=false;
    // Antes de sustituir los blobs anteriores, revocar solo si no están siendo impresos.
    // Conservamos URLs de la sesión anterior para no invalidar una ventana ya abierta.
    capturasAtlas=[];abrirBtn.disabled=true;deshabilitarControles(true);
    try{
      atlasMensaje('Iniciando mapa de impresión independiente…');
      rendererExport=crearRenderizador(plan.paper);
      const tasks=[];
      if(plan.general)tasks.push(plan.general);
      tasks.push(...plan.sheets);
      for(let i=0;i<tasks.length;i++){
        if(atlasCancelar)throw Error('Cancelado por el usuario.');
        atlasMensaje(`Hoja ${i+1} de ${tasks.length} · ${papel.value} · ${plan.paper.dpi} dpi…`);
        capturasAtlas.push(await capturarHoja(tasks[i],plan));
        await sleep(800);
      }
      abrirBtn.disabled=false;
      atlasMensaje(`Listo: ${capturasAtlas.length} página(s) ${papel.value}. Abrir e imprimir en PDF.`);
    }catch(e){
      capturasAtlas=null;
      atlasMensaje('Preparación detenida: '+e.message,true);
      console.error('Centrality V4 atlas:',e);
    }finally{
      destruirRenderizador();
      atlasActivo=false;deshabilitarControles(false);
      estimarAtlas();
      if(capturasAtlas?.length) {
        abrirBtn.disabled=false;
        atlasMensaje(`Listo: ${capturasAtlas.length} página(s) ${papel.value}. Pulsa «Abrir e imprimir».`);
      }
    }
  }
  function cerrarAtlas() {
    atlasCancelar=true;
    capturasAtlas=null;
    destruirRenderizador();
  }
  calcularBtn.addEventListener('click',estimarAtlas);
  [salida,papel,calidad,zoomAtlas,limiteHojas,distribucion].forEach(x=>
    x.addEventListener('change',()=>{
      // El atlas previo corresponde a otras dimensiones: exigir nueva preparación.
      if(!atlasActivo){capturasAtlas=null;abrirBtn.disabled=true;estimarAtlas();}
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
    abrirPlanillaBtn.style.display = oculto ? "none" : "";
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
  // V8: hoja de trabajo en una ventana propia, conectada al mismo estado del mapa.
  // No accede a los servicios GNAT ni instala bibliotecas remotas.
  let editorVentana = null;
  let editorDocumento = null;
  let editorFilas = { PUNTO: [], APERTURA: [] };
  let editorBloques = [];
  let editorTab = "APERTURA";
  let editorEstado = null;
  let editorBody = null;
  let editorTitle = null;
  let editorCount = null;
  let editorQuery = null;
  const editorCols = {
    APERTURA: [
      ["numero", "N°", "number"], ["codigo", "Código de apertura", "text"],
      ["longitud", "Longitud", "decimal"], ["latitud", "Latitud", "decimal"],
      ["supervisorColor", "Supervisor", "select"], ["bloques", "Bloques manuales", "text"]
    ],
    PUNTO: [
      ["numero", "N°", "number"], ["codigo", "Código de poste", "text"],
      ["longitud", "Longitud", "decimal"], ["latitud", "Latitud", "decimal"],
      ["supervisorColor", "Supervisor", "select"], ["bloqueId", "Bloque", "text"],
      ["aperturasIds", "Aperturas asociadas", "text"]
    ],
    BLOQUE: [["id", "Código interno", "readonly"], ["nombre", "Nombre humano", "text"]]
  };
  const e = (tag, parent, textValue, className) => {
    const x=editorDocumento.createElement(tag);
    if (textValue !== undefined) x.textContent = String(textValue);
    if (className) x.className=className;
    parent.appendChild(x);
    return x;
  };
  const editorSeparar = value => (Array.isArray(value) ? value : String(value||"").split(/[|;,\n]/))
    .map(v=>String(v).trim()).filter(Boolean);
  const editorTexto = a => (Array.isArray(a) ? a.join(" | ") : String(a||""));
  function editorSnapshot() {
    if (!ol.proj?.toLonLat) throw Error("El mapa no dispone de conversión geográfica.");
    editorFilas={PUNTO:[], APERTURA:[]};
    for (const f of puntos) {
      const tipo = f.get('tipo') === 'APERTURA' ? 'APERTURA' : 'PUNTO';
      const [longitud,latitud] = ol.proj.toLonLat(f.getGeometry().getCoordinates(),map.getView().getProjection());
      editorFilas[tipo].push({id:String(f.get('id')||''),numero:String(f.get('numero')),
        codigo:String(f.get('codigo')||''),longitud:String(longitud),latitud:String(latitud),
        supervisorColor:categoriaSupervisor(f),bloqueId:String(f.get('bloqueId')||''),
        bloques:editorTexto(f.get('bloques')),aperturasIds:editorTexto(f.get('aperturasIds'))});
    }
    editorBloques=[...definicionesBloques].map(([id,nombre])=>({id,nombre}));
  }
  const editorInfo = (message, danger=false) => {
    if (!editorEstado) return;
    editorEstado.textContent=message;
    editorEstado.className=danger ? 'bad' : '';
  };
  function editorValidar() {
    const ids=new Set(), openings=new Map(), codeIndex=new Map(), bIds=new Set();
    for (const block of editorBloques) {
      const id=String(block.id||'').trim(), name=String(block.nombre||'').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(id) || bIds.has(id) || !name)
        throw Error('Bloque inválido o duplicado: '+id);
      bIds.add(id);
    }
    const validate=(kind,rows)=>rows.map((r,index)=>{
      const id=String(r.id||'').trim(), numero=Number(String(r.numero).trim());
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)||ids.has(id))
        throw Error('ID repetido o inválido en '+kind+' fila '+(index+1)+': '+id);
      ids.add(id);
      if (!Number.isSafeInteger(numero)||numero<1 || rows.some((item,i)=>i<index && Number(item.numero)===numero))
        throw Error('Número inválido o duplicado en '+kind+' fila '+(index+1));
      const codigo=String(r.codigo||'').trim();
      if (!codigo) throw Error('Falta código en '+kind+' fila '+(index+1));
      const coord=(s,max,label)=>{
        const raw=String(s??'').trim().replace(',','.');
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw Error(label+' incompleta en '+kind+' '+codigo);
        const n=Number(raw);
        if (!Number.isFinite(n)||Math.abs(n)>max) throw Error(label+' fuera de rango en '+codigo);
        return n;
      };
      const longitude=coord(r.longitud,180,'Longitud'), latitude=coord(r.latitud,90,'Latitud');
      const supervisorColor=String(r.supervisorColor||'');
      if (!OPCIONES_BLOQUE.includes(supervisorColor)) throw Error('Supervisor inválido en '+codigo);
      const bloqueId=String(r.bloqueId||'').trim();
      if (kind==='PUNTO' && bloqueId && !bIds.has(bloqueId)) throw Error('Crea primero el bloque '+bloqueId+' (punto '+codigo+')');
      const bloques=editorSeparar(r.bloques);
      if (kind==='APERTURA' && bloques.some(id=>!bIds.has(id))) throw Error('Bloque de apertura inexistente en '+codigo);
      return {id,numero,codigo,longitud:longitude,latitud:latitude,supervisorColor,bloqueId,
        bloques,aperturasIds: editorSeparar(r.aperturasIds),tipo:kind};
    });
    const aperturas=validate('APERTURA',editorFilas.APERTURA);
    const rutas=validate('PUNTO',editorFilas.PUNTO);
    for (const a of aperturas) {
      openings.set(a.id,a);
      const k=a.codigo.toLocaleLowerCase('es');
      if (!codeIndex.has(k)) codeIndex.set(k,[]);
      codeIndex.get(k).push(a.id);
    }
    for(const r of rutas) {
      const refs=[];
      for (const userRef of r.aperturasIds) {
        const direct=openings.get(userRef);
        const choices=codeIndex.get(userRef.toLocaleLowerCase('es'))||[];
        const ref=direct ? direct.id : choices.length===1 ? choices[0] : '';
        if (!ref) throw Error('Apertura desconocida o ambigua «'+userRef+'» en '+r.codigo+'. Usa el ID único.');
        if (!refs.includes(ref)) refs.push(ref);
      }
      r.aperturasIds=refs;
    }
    return {aperturas,rutas};
  }
  function editorAplicar(silencioso=false) {
    try {
      if (!abierto || !map?.getView) throw Error('La pestaña de GNAT está cerrada.');
      const {rutas,aperturas}=editorValidar();
      const nuevas=[...rutas,...aperturas].map(r=>new ol.Feature({
        geometry:new ol.geom.Point(ol.proj.fromLonLat([r.longitud,r.latitud],map.getView().getProjection())),
        id:r.id,numero:r.numero,tipo:r.tipo,codigo:r.codigo,bloque:r.supervisorColor,
        bloqueId:r.bloqueId,bloques:r.bloques,aperturasIds:r.aperturasIds
      }));
      const nuevaCapa = new ol.layer.Vector({source:new ol.source.Vector({features:nuevas}),zIndex:100000,style:estiloPunto});
      const oldCapa=capa;
      map.addLayer(nuevaCapa);
      if (oldCapa) map.removeLayer(oldCapa);
      puntos=nuevas; capa=nuevaCapa;
      definicionesBloques.clear();
      for(const b of editorBloques) definicionesBloques.set(b.id,b.nombre);
      seleccionado.clear(); enfocado=-1;
      refrescarVista();
      mensaje('Planilla sincronizada: '+rutas.length+' puntos y '+aperturas.length+' aperturas.');
      editorInfo('Sincronizado con el mapa · '+(rutas.length+aperturas.length)+' registros');
      if (!silencioso) editorMostrar();
      return true;
    } catch(err) {
      editorInfo('Cambios pendientes: '+err.message,true);
      return false;
    }
  }
  function editorRowsActuales(){return editorTab==='BLOQUE' ? editorBloques : editorFilas[editorTab];}
  function editorAsociadasA(id) {
    return editorFilas.PUNTO.filter(r=>editorSeparar(r.aperturasIds).includes(id)).length;
  }
  function editorMostrar() {
    if (!editorDocumento || editorVentana?.closed) return;
    const headings=editorDocumento.querySelector('#tabs');
    headings.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tab===editorTab));
    editorTitle.textContent=editorTab==='APERTURA'?'Aperturas · catálogo único':editorTab==='PUNTO'?'Recorrido · vínculos con aperturas':'Bloques · códigos y nombres';
    const cols=editorCols[editorTab],data=editorRowsActuales();
    editorDocumento.querySelector('#thead').replaceChildren();
    editorBody.replaceChildren();
    const tr=e('tr',editorDocumento.querySelector('#thead'));
    e('th',tr,'Sel.'); e('th',tr,'ID');
    for(const [,name] of cols) e('th',tr,name);
    if(editorTab==='APERTURA') e('th',tr,'Postes vinculados');
    e('th',tr,'Mapa');
    const q=String(editorQuery.value||'').toLowerCase().trim();
    let rendered=0;
    data.forEach((r,i)=>{
      if(q && !Object.values(r).join(' ').toLowerCase().includes(q))return;
      if(rendered++>=500)return;
      const row=e('tr',editorBody);
      row.dataset.index=String(i);
      const check=e('input',e('td',row));check.type='checkbox';check.className='rowSel';
      const idcol=e('td',row,r.id,'id');idcol.title='Identificador interno estable';
      for(const [key,,type] of cols) {
        const td=e('td',row);
        if(type==='readonly') {td.textContent=r[key];continue;}
        let input;
        if(type==='select') {
          input=e('select',td);
          for(const v of OPCIONES_BLOQUE){const opt=e('option',input,v);opt.value=v;}
        } else {
          input=e('input',td);
          input.type='text'; input.autocomplete='off';
          if(type==='decimal')input.inputMode='decimal';
        }
        input.className='cell';input.dataset.key=key;input.dataset.index=String(i);
        input.value=r[key]??'';
        input.title=key==='aperturasIds'?'IDs o códigos únicos separados por |. Usa Elegir para seleccionar varias.':key==='bloques'?'IDs de bloques manuales separados por |':'';
        if(key==='aperturasIds') {
          const chooser=e('button',td,'Elegir','mini');chooser.type='button';
          chooser.addEventListener('click',()=>editorElegirAperturas(i));
        }
      }
      if(editorTab==='APERTURA')e('td',row,editorAsociadasA(r.id),'count');
      const td=e('td',row);
      if(editorTab!=='BLOQUE') {
        const go=e('button',td,'Ir ↗','mini');go.type='button';
        go.addEventListener('click',()=>{
          if(!editorAplicar(true))return;
          const n=puntos.findIndex(f=>f.get('id')===r.id);
          if(n>=0){navegar(n); window.focus();}
        });
      }
    });
    editorCount.textContent=editorFilas.APERTURA.length+' aperturas · '+editorFilas.PUNTO.length+' puntos · '+editorBloques.length+' bloques'+(rendered>500?' · mostrando 500 registros (filtra para localizar otros)':'');
  }
  function editorElegirAperturas(index){
    const row=editorFilas.PUNTO[index];
    const chosen=new Set(editorSeparar(row.aperturasIds));
    const dlg=editorDocumento.querySelector('#chooser');
    const pane=editorDocumento.querySelector('#chooserItems');
    pane.replaceChildren();
    for(const op of editorFilas.APERTURA){
      const label=e('label',pane,undefined,'choice');
      const cb=e('input',label);cb.type='checkbox';cb.checked=chosen.has(op.id);
      cb.addEventListener('change',()=>cb.checked?chosen.add(op.id):chosen.delete(op.id));
      e('span',label,op.codigo+'  ('+op.id+')');
    }
    editorDocumento.querySelector('#chooserSave').onclick=()=>{
      row.aperturasIds=[...chosen].join(' | ');
      dlg.hidden=true;editorMostrar();editorAplicar(true);
    };
    dlg.hidden=false;
  }
  function editorFilaNueva(){
    const kind=editorTab;
    const arr=editorRowsActuales();
    if (kind==='BLOQUE') {
      let idx=1;while(editorBloques.some(b=>b.id==='B'+idx))idx++;
      editorBloques.push({id:'B'+idx,nombre:'Nuevo bloque '+idx});
    } else {
      let idx=1;const prefix=kind==='PUNTO'?'p-':'a-';
      const used=new Set([...editorFilas.PUNTO,...editorFilas.APERTURA].map(x=>x.id));
      while(used.has(prefix+String(idx).padStart(3,'0')))idx++;
      let n=1;while(arr.some(r=>Number(r.numero)===n))n++;
      arr.push({id:prefix+String(idx).padStart(3,'0'),numero:String(n),codigo:'',
        longitud:'',latitud:'',supervisorColor:'Sin asignar',bloqueId:'',bloques:'',aperturasIds:''});
    }
    editorQuery.value='';editorMostrar();
    editorInfo('Completa la fila y sus coordenadas. Se sincronizará cuando los datos sean válidos.',true);
    const last=editorBody.lastElementChild?.querySelector('input[data-key="codigo"],input[data-key="nombre"]');
    last?.focus();
  }
  function editorEliminar() {
    const checked=[...editorBody.querySelectorAll('tr')].filter(tr=>tr.querySelector('.rowSel')?.checked)
      .map(tr=>Number(tr.dataset.index));
    if(!checked.length)return editorInfo('Marca una o más filas para eliminar.',true);
    const target=editorRowsActuales();
    const ids=new Set(checked.map(i=>target[i].id));
    if(editorTab==='APERTURA'){
      const refs=editorFilas.PUNTO.reduce((n,r)=>n+editorSeparar(r.aperturasIds).filter(id=>ids.has(id)).length,0);
      if(refs && !editorVentana.confirm('Estas aperturas están vinculadas a '+refs+' registro(s). ¿Eliminar y quitar sus asociaciones locales?'))return;
      for(const r of editorFilas.PUNTO) r.aperturasIds=editorSeparar(r.aperturasIds).filter(id=>!ids.has(id)).join(' | ');
    } else if(editorTab==='BLOQUE') {
      if(editorFilas.PUNTO.some(r=>ids.has(r.bloqueId))||editorFilas.APERTURA.some(r=>editorSeparar(r.bloques).some(x=>ids.has(x)))){
        return editorInfo('No se puede eliminar un bloque en uso. Desasócialo primero.',true);
      }
    }
    for(const i of checked.sort((a,b)=>b-a))target.splice(i,1);
    editorMostrar();editorAplicar(true);
  }
  function editorPaste(ev) {
    const target=ev.target;
    if(!target?.classList?.contains('cell'))return;
    const paste=ev.clipboardData?.getData('text/plain');
    if(!paste || !/[\t\r\n]/.test(paste))return;
    ev.preventDefault();
    const rows=paste.replace(/\r\n?/g,'\n').trimEnd().split('\n').map(line=>line.split('\t'));
    const kind=editorTab, data=editorRowsActuales();
    const first=Number(target.dataset.index), keys=editorCols[kind].filter(([,,type])=>type!=='readonly').map(([k])=>k);
    const start=keys.indexOf(target.dataset.key);
    if(first+rows.length>50000)return editorInfo('El pegado excede 50.000 registros.',true);
    rows.forEach((values,idx)=>{
      while(first+idx>=data.length){
        const n=1+Math.max(0,...data.map(x=>Number(x.numero)||0));
        const prefix=kind==='PUNTO'?'p-':'a-';
        let suffix=1; const allIds=new Set([...editorFilas.PUNTO,...editorFilas.APERTURA].map(r=>r.id));
        while(allIds.has(prefix+'paste-'+suffix))suffix++;
        data.push({id:prefix+'paste-'+suffix,numero:String(n),codigo:'',longitud:'',latitud:'',supervisorColor:'Sin asignar',bloqueId:'',bloques:'',aperturasIds:''});
      }
      const obj=data[first+idx];
      values.forEach((val,j)=>{const key=keys[start+j];if(key!==undefined)obj[key]=val.trim();});
    });
    editorMostrar();editorAplicar(true);
  }
  function abrirEditorV8(){
    if(editorVentana && !editorVentana.closed){editorVentana.focus();return;}
    try {editorSnapshot();}catch(err){return mensaje('No se pudo abrir la planilla: '+err.message,true);}
    editorVentana=window.open('', 'centrality-planilla-v8', 'width=1450,height=850,resizable=yes,scrollbars=yes');
    if(!editorVentana)return mensaje('Chrome bloqueó la pestaña. Permite ventanas emergentes para Centrality.',true);
    const page=editorVentana;
    editorDocumento=page.document;
    editorDocumento.open();
    editorDocumento.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Centrality · Planilla de trabajo</title></head><body></body></html>');
    editorDocumento.close();
    const style=e('style',editorDocumento.head);
    style.textContent=`*{box-sizing:border-box}body{margin:0;background:#f4f6fa;font:13px system-ui,Arial;color:#1e2c39}header{padding:14px 20px;background:#fff;border-bottom:1px solid #dae1e9;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}h1{margin:0;font-size:18px}h2{font-size:15px;margin:0}button{cursor:pointer;border:1px solid #c8d3e0;border-radius:6px;background:white;padding:7px 12px;font:inherit}button:hover{background:#edf4fc}button.primary{background:#1766ae;border-color:#1766ae;color:white}button.active{background:#dbeafe;border-color:#7faee8;color:#143d70;font-weight:650}.mini{padding:4px 6px;font-size:11px;margin-left:4px;white-space:nowrap}.muted{color:#66788b;font-size:12px}#tabs{display:flex;gap:8px;margin:14px 20px}main{margin:0 20px 20px;background:#fff;border:1px solid #d5dee9;border-radius:9px;padding:14px}#toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.grid{border:1px solid #cbd5e1;overflow:auto;max-height:65vh}table{border-spacing:0;border-collapse:collapse;width:100%;min-width:1040px}th{position:sticky;top:0;background:#eaf0f5;z-index:1;text-align:left;padding:9px 7px;border-right:1px solid #d8e0e9;white-space:nowrap}td{border:1px solid #e1e7ee;padding:4px 6px}tr:nth-child(even){background:#fafbfd}td.id{font-family:ui-monospace,monospace;color:#64748b;white-space:nowrap}td.count{text-align:center;font-weight:bold}input.cell,select.cell{font:inherit;border:1px solid transparent;border-radius:3px;padding:6px;width:100%;min-width:80px;background:transparent;color:#1c2c3a}input.cell:focus,select.cell:focus{background:#fff;border-color:#3b82f6;outline:2px solid #bfdbfe}td:has(input[data-key="aperturasIds"]){min-width:230px}td:has(input[data-key="codigo"]){min-width:175px}td:has(input[data-key="bloqueId"]){min-width:100px}#status{padding:10px;border-radius:6px;background:#e9f5ec;color:#126337;flex:1}#status.bad{background:#fff2e0;color:#8a4511}#query{padding:8px;border:1px solid #d5dee9;border-radius:6px;min-width:250px}#chooser{position:fixed;inset:0;background:#0007;z-index:100;display:grid;place-items:center}#chooser[hidden]{display:none}#chooser>div{width:min(520px,94vw);background:#fff;border-radius:12px;padding:22px;box-shadow:0 10px 35px #0004}#chooserItems{display:grid;gap:9px;max-height:55vh;overflow:auto;margin:15px 0}.choice{display:flex;gap:9px;align-items:center;padding:6px;border-bottom:1px solid #eee} .foot{padding:10px 20px;color:#64748b;font-size:12px}`;
    const head=e('header',editorDocumento.body);
    const hd=e('div',head);e('h1',hd,'Centrality · Planilla de trabajo');e('div',hd,'Edita las aperturas una sola vez y vincúlalas a varios postes.','muted');
    const controls=e('div',head);
    const apply=e('button',controls,'Aplicar al mapa','primary');
    const backup=e('button',controls,'Guardar proyecto JSON');
    const importCSV=e('button',controls,'Abrir CSV');
    const exportCSV=e('button',controls,'Guardar CSV');
    const inputCSV=e('input',controls); inputCSV.type='file';inputCSV.accept='.csv,text/csv';inputCSV.hidden=true;
    const reload=e('button',controls,'Recargar desde mapa');
    const nav=e('nav',editorDocumento.body,undefined);nav.id='tabs';
    for(const [kind,label] of [['APERTURA','Aperturas'],['PUNTO','Recorrido'],['BLOQUE','Bloques']]){
      const b=e('button',nav,label);b.dataset.tab=kind;b.onclick=()=>{editorTab=kind;editorQuery.value='';editorMostrar();};
    }
    const main=e('main',editorDocumento.body);
    editorTitle=e('h2',main);
    const bar=e('div',main);bar.id='toolbar';
    const add=e('button',bar,'+ Agregar fila');const del=e('button',bar,'Eliminar seleccionadas');
    editorQuery=e('input',bar);editorQuery.id='query';editorQuery.type='search';editorQuery.placeholder='Buscar en esta tabla...';
    editorCount=e('span',bar,undefined,'muted');
    const wrapper=e('div',main);wrapper.className='grid';
    const table=e('table',wrapper);e('thead',table).id='thead';editorBody=e('tbody',table);
    const footer=e('div',main);footer.style.display='flex';footer.style.gap='12px';footer.style.marginTop='10px';footer.style.alignItems='center';
    editorEstado=e('div',footer,'Cambios cargados desde GNAT.');editorEstado.id='status';
    e('div',editorDocumento.body,'Aperturas vinculadas = referencia de planificación, no prueba de aislamiento ni indicación operativa. Guarda periódicamente el proyecto JSON.','foot');
    const modal=e('div',editorDocumento.body);modal.id='chooser';modal.hidden=true;
    const inner=e('div',modal);e('h2',inner,'Vincular aperturas a este poste');
    e('div',inner,'Una misma apertura puede servir para varios puntos.','muted');
    e('div',inner).id='chooserItems';
    const save=e('button',inner,'Aceptar selección','primary');save.id='chooserSave';
    const cancel=e('button',inner,'Cancelar');cancel.onclick=()=>modal.hidden=true;
    apply.onclick=()=>editorAplicar();
    backup.onclick=()=>{if(editorAplicar(true))guardarProyectoBtn.click();};
    exportCSV.onclick=()=>{
      if(editorTab==='BLOQUE')return editorInfo('Usa Guardar proyecto JSON para guardar los nombres de bloques.',true);
      if(editorAplicar(true)) guardarCSV(editorTab==='PUNTO'?'route':'opening');
    };
    importCSV.onclick=()=>{
      if(editorTab==='BLOQUE')return editorInfo('Los bloques se editan aquí y se guardan en el proyecto JSON.',true);
      inputCSV.value=''; inputCSV.click();
    };
    inputCSV.onchange=async()=>{
      const file=inputCSV.files?.[0];if(!file)return;
      const kind=editorTab, tableKind=kind==='PUNTO'?'route':'opening';
      try{
        if(file.size>10_000_000)throw Error('CSV demasiado grande (máx. 10 MB).');
        const other=editorFilas[kind==='PUNTO'?'APERTURA':'PUNTO'].map(r=>r.id);
        const parsed=parseTableCSV(await file.text(),tableKind,other);
        const mapped=parsed.map(r=>({id:r.id,numero:String(r.numero),codigo:r.codigo??r.subestacion,
          longitud:String(r.longitud),latitud:String(r.latitud),supervisorColor:r.supervisorColor,
          bloqueId:r.bloqueId||'',bloques:editorTexto(r.bloques),aperturasIds:editorTexto(r.aperturasIds)}));
        editorFilas[kind]=mapped;
        for(const row of mapped){
          for(const id of kind==='PUNTO'?[row.bloqueId]:editorSeparar(row.bloques)){
            if(id && !editorBloques.some(b=>b.id===id))editorBloques.push({id,nombre:id});
          }
        }
        editorQuery.value='';editorMostrar();
        if(!editorAplicar(true))editorInfo('CSV abierto; revisa y completa los campos pendientes antes de aplicar.',true);
      }catch(err){editorInfo('Error al importar CSV: '+err.message,true);}
      finally{inputCSV.value='';}
    };
    reload.onclick=()=>{if(page.confirm('Descartar los cambios pendientes y volver a leer el mapa?')){editorSnapshot();editorMostrar();editorInfo('Datos recargados del mapa.');}};
    add.onclick=editorFilaNueva;del.onclick=editorEliminar;
    editorQuery.oninput=editorMostrar;
    editorBody.addEventListener('change',ev=>{
      const field=ev.target;
      if(!field?.classList?.contains('cell'))return;
      const i=Number(field.dataset.index),key=field.dataset.key;
      editorRowsActuales()[i][key]=field.value;
      editorAplicar(true);
    });
    editorBody.addEventListener('paste',editorPaste);
    editorBody.addEventListener('keydown',ev=>{
      if(ev.key==='Enter' && ev.target?.classList?.contains('cell')) {
        ev.preventDefault();ev.target.blur();
        const i=Number(ev.target.dataset.index)+1;
        editorBody.querySelector(`input[data-index="${i}"][data-key="${ev.target.dataset.key}"]`)?.focus();
      }
    });
    editorMostrar();
    if(!oculto) ocultar.click();
    page.focus();
  }
  abrirPlanillaBtn.addEventListener('click',abrirEditorV8);

  w.__superponerKMZ = { cerrar: cerrarPanel, getPuntos: () => puntos.slice(),
    getCapa: () => capa, getBloques: () => [...definicionesBloques].map(([id,nombre])=>({id,nombre})),
    getPreferencias: () => ({colores:{...COLORES},visibles:[...visiblesSupervisores]}), abrirPlanilla: abrirEditorV8 };
  if (anteriores.length) {
    puntos = anteriores.map(a => new ol.Feature({
      geometry: new ol.geom.Point(a.xy),
      codigo: a.codigo,
      numero: a.numero,
      id: a.id, tipo: a.tipo || "PUNTO", bloqueId: a.bloqueId || "", bloques: a.bloques || [], aperturasIds:a.aperturasIds||[],
      bloque: OPCIONES_BLOQUE.includes(a.bloque) ? a.bloque : SIN_BLOQUE
    }));
    capa = new ol.layer.Vector({
      source: new ol.source.Vector({ features: puntos }),
      zIndex: 100000,
      style: estiloPunto
    });
    map.addLayer(capa);
    refrescarVista();
    mensaje(`Recuperados ${puntos.length} puntos desde tu visor anterior, con sus bloques.`);
  } else {
    retirarCapa();
    actualizarControlesBloques();
    console.log('Panel V7.1 listo: selecciona KMZ o KML.');
  }
})();
