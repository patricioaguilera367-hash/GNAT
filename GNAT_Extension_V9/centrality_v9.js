/*
 * CENTRALITY V9.3 - V9.2 + AUTOSAVE Y MÓDULOS VANILLA JS
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

  const frame = window.__centralityMapBridge?.resolveHost(document)?.frame
    || document.querySelector("iframe#content");
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
              bloque: String(f.get('bloque') || 'Sin asignar'),
              colorPersonalizado: String(f.get('colorPersonalizado') || ''),
              tipoEquipo: String(f.get('tipoEquipo') || ''),
              supervisorNombre: String(f.get('supervisorNombre') || ''),
              fechaPlanificacion: String(f.get('fechaPlanificacion') || '')});
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
  // Persists unlocated Excel rows and mass-assignment worksheets without inventing coordinates.
  let excelBorrador = null;
  // El código del bloque es estable (B1, B2...). Su nombre es solo descriptivo.
  const definicionesBloques = new Map();
  // Estilos de planificación independientes de la cartografía GNAT.
  const coloresBloques = new Map();
  const responsablesBloques = new Map();
  const paletaBloques = ["#198754", "#ef8b16", "#2469d8", "#8b5cf6", "#0d9488", "#be185d"];
  const colorBloqueDefault = (indice) => paletaBloques[indice % paletaBloques.length];
  for (const item of bloquesAnteriores) {
    if (item && typeof item.id === "string" && /^[\w.-]{1,40}$/.test(item.id)) {
      definicionesBloques.set(item.id, String(item.nombre || item.id).slice(0, 120));
      if (colorSeguro(item.color)) coloresBloques.set(item.id, item.color);
      if (item.responsable) responsablesBloques.set(item.id, String(item.responsable).slice(0, 100));
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
  crear(filtrosSupervisores, "div", "Las X de aperturas siguen rojas; filtros de categorías independientes.",
    "font-size:10px;color:#526174;margin-top:6px;");

  // Este filtro es distinto del color del supervisor; usa BloqueID/Bloques del CSV.
  const filtroBloqueFila = fila(controles, "margin:2px 0 8px;");
  crear(filtroBloqueFila, "span", "Ver bloque:", "font-size:12px;white-space:nowrap;");
  const filtroBloqueTrabajo = crear(filtroBloqueFila, "select", null,
    ESTILO_CONTROL + "flex:1;min-width:180px;");
  const listaTitulo = crear(controles, "label", "Ir a un poste o apertura:",
    "display:block;font-size:11px;font-weight:bold;margin:7px 0 3px;");
  const lista = crear(controles, "select", null,
    ESTILO_CONTROL + "display:block;width:100%;margin:0 0 8px 0;");
  lista.setAttribute("aria-label", "Ir a un poste o apertura");
  listaTitulo.htmlFor = "centrality-v91-lista-puntos";
  lista.id = "centrality-v91-lista-puntos";

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
  const filaAutosave = fila(panel, "margin:5px 0 0;gap:4px;");
  const recuperarAutoBtn = btn(filaAutosave, 'Recuperar autosave',
    'flex:0 0 auto;font-size:11px;padding:4px 7px;');
  recuperarAutoBtn.disabled = true;
  recuperarAutoBtn.title = 'Cargar un respaldo guardado en este navegador; no se recupera automáticamente.';
  const estadoAutosave = crear(filaAutosave, 'span', 'Verificando respaldo local…',
    'font-size:10px;color:#59677a;flex:1;min-width:100px;');
  let respaldoDisponible = null;
  let autosave = null;
  function estadoAutosaveTexto(text, error = false) {
    estadoAutosave.textContent = text;
    estadoAutosave.style.color = error ? '#b42318' : '#59677a';
  }
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
  crear(panel, "div", "Guarda el proyecto JSON para conservar tus cambios.",
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
  function colorDePunto(f) {
    // Invariante cartográfica: supervisor = color de poste, zona = agrupación.
    // Los colores históricos de zona y colorPersonalizado siguen en el JSON,
    // pero nunca deben sustituir el color del supervisor en el marcador.
    if (f?.get?.("tipo") === "APERTURA") return COLOR_APERTURAS;
    return COLORES[categoriaSupervisor(f)] || COLORES[SIN_BLOQUE];
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
    const color = colorDePunto(f);
    const indice = puntos.indexOf(f);
    const apertura = f.get("tipo") === "APERTURA";
    const activo = enfocado === indice;
    const marcado = seleccionado.has(indice);
    const conTexto = etiquetas === "siempre" ||
      (etiquetas === "cerca" && resolution < UMBRAL_ETIQUETA);
    const clave = [bloque, color, apertura, activo, marcado, conTexto, contenidoEtiqueta].join("|");
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
            fill: new ol.style.Fill({ color }),
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
    crear(resumen, "span", `${visibles.length} visibles · ${aperturas} aperturas X · ${definicionesBloques.size} zonas`);
    nSel.textContent = seleccionado.size + " seleccionados";
  }

  function reconstruirLista() {
    const actual = lista.value;
    lista.replaceChildren();
    const visibles = puntosFiltrados();
    const inicial = crear(lista, "option",
      visibles.length ? `Elegir entre ${visibles.length} registros...` : "Sin resultados para los filtros");
    inicial.value = "";
    for (const f of visibles) {
      const i = puntos.indexOf(f);
      const marca = f.get("tipo") === "APERTURA" ? "✕ " : "";
      const opt = crear(lista, "option", `${marca}${f.get("numero")} · ${puntoCodigo(f)}`);
      opt.value = String(i);
    }
    lista.disabled = visibles.length === 0;
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
        `border-left:4px solid ${colorDePunto(f)};`);
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
  busqueda.addEventListener("input", () => {
    reconstruirLista();
    dibujarTabla();
  });
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
  function construirProyectoActual() {
    if (!ol.proj?.toLonLat) throw Error('Conversión de coordenadas no disponible.');
    return window.__centralityProjectState.buildProject({
      features: puntos,
      toLonLat: (coords, projection) => ol.proj.toLonLat(coords, projection),
      projection: map.getView().getProjection(),
      zoneEntries: definicionesBloques, zoneColors: coloresBloques,
      zoneSupervisors: responsablesBloques,
      fallbackColor: colorBloqueDefault,
      supervisorColors: COLORES, visibleSupervisors: visiblesSupervisores,
      excelDraft: excelBorrador
    });
  }
  guardarProyectoBtn.addEventListener('click', () => {
    try {
      excelAvanzado?.capturar?.();
      const proyecto = construirProyectoActual();
      descargarTexto('centrality-proyecto.json', JSON.stringify(proyecto, null, 2),
        'application/json;charset=utf-8');
      mensaje(`Proyecto guardado: ${proyecto.registros.length} registros y ${proyecto.bloques.length} bloques.`);
    } catch (e) { mensaje('No se pudo guardar el proyecto: ' + e.message, true); }
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
      if (data?.formato !== 'CentralityLocal' || ![1,2,3,4].includes(data.version) ||
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
        if (b.color !== undefined && !colorSeguro(b.color)) throw Error("Color de zona inválido: " + b.id);
        if (b.responsable !== undefined && typeof b.responsable !== 'string') throw Error("Responsable inválido: " + b.id);
      }
      const filasRuta = data.registros.filter(r => r.tipo === 'PUNTO').map(r => ({
        id:r.id,numero:r.numero,subestacion:r.codigo,longitud:r.longitud,latitud:r.latitud,
        supervisorColor:r.supervisorColor,bloqueId:r.bloqueId || '',aperturasIds:r.aperturasIds||[],
        colorPersonalizado:r.colorPersonalizado||'',
        supervisorNombre:r.supervisorNombre||'',fechaPlanificacion:r.fechaPlanificacion||''
      }));
      const filasApertura = data.registros.filter(r => r.tipo === 'APERTURA').map(r => ({
        id:r.id,numero:r.numero,codigo:r.codigo,longitud:r.longitud,latitud:r.latitud,
        supervisorColor:r.supervisorColor,bloques:r.bloques || [],tipoEquipo:r.tipoEquipo||''
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
      const features = [...ruta.map(r=>({...r,tipo:'PUNTO',codigo:r.subestacion,
        colorPersonalizado:filasRuta.find(v=>v.id===r.id)?.colorPersonalizado||'',
        supervisorNombre:filasRuta.find(v=>v.id===r.id)?.supervisorNombre||'',
        fechaPlanificacion:filasRuta.find(v=>v.id===r.id)?.fechaPlanificacion||''})),
        ...aperturas.map(r=>({...r,tipo:'APERTURA',
        tipoEquipo:filasApertura.find(v=>v.id===r.id)?.tipoEquipo||''}))].map(r=>new ol.Feature({
          geometry:new ol.geom.Point(ol.proj.fromLonLat([r.longitud,r.latitud],map.getView().getProjection())),
          id:r.id,numero:r.numero,tipo:r.tipo,codigo:r.codigo,bloque:r.supervisorColor,
          bloqueId:r.bloqueId||'',bloques:r.bloques||[],aperturasIds:r.aperturasIds||[],
          colorPersonalizado:r.colorPersonalizado||'',tipoEquipo:r.tipoEquipo||'',
          supervisorNombre:r.supervisorNombre||'',fechaPlanificacion:r.fechaPlanificacion||''
        }));
      // No reemplazar ningún dato de trabajo hasta validar todo el proyecto.
      retirarCapa();
      definicionesBloques.clear();
      coloresBloques.clear(); responsablesBloques.clear();
      let blockIndex=0;
      for (const [id,nombre] of nuevosBloques) {
        definicionesBloques.set(id,nombre);
        const source=data.bloques.find(b=>b.id===id);
        coloresBloques.set(id, source.color || colorBloqueDefault(blockIndex++));
        if (source.responsable) responsablesBloques.set(id,source.responsable.slice(0,100));
      }
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
      excelBorrador=(data.excelBorrador?.version===1 &&
        Array.isArray(data.excelBorrador.recorrido) && Array.isArray(data.excelBorrador.aperturas) &&
        data.excelBorrador.recorrido.length<=50000 && data.excelBorrador.aperturas.length<=50000)
        ? data.excelBorrador : null;
      puntos=features;
      capa=new ol.layer.Vector({source:new ol.source.Vector({features}),zIndex:100000,style:estiloPunto});
      map.addLayer(capa);
      refrescarVista();
      mensaje(`Proyecto abierto: ${features.length} registros, ${definicionesBloques.size} bloques.`);
    } catch(e) { mensaje("Error al abrir proyecto: " + e.message,true); }
    finally { archivoProyecto.value=''; }
  });

  recuperarAutoBtn.addEventListener('click', async () => {
    if (!respaldoDisponible?.project) return;
    const n = respaldoDisponible.project.registros.length;
    const fecha = new Date(respaldoDisponible.timestamp).toLocaleString('es-CL');
    const ok = window.confirm(`¿Recuperar el respaldo local del ${fecha} con ${n} registros?\n\n` +
      'Reemplazará los datos actualmente visibles. Guarda antes tu JSON si los necesitas.');
    if (!ok) return;
    try {
      const data = JSON.stringify(respaldoDisponible.project);
      const file = new File([data], 'centrality-autosave.json', {type:'application/json'});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      archivoProyecto.files = transfer.files;
      archivoProyecto.dispatchEvent(new Event('change', {bubbles:true}));
    } catch (e) { estadoAutosaveTexto('No se pudo restaurar: ' + e.message, true); }
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

  // V9: visualizador compacto. La planilla contiene la gestión; el atlas no se ofrece
  // mientras no esté validado. Mantenerlo en código permite recuperar V8 sin pérdida.
  tituloTexto.textContent = "Centrality · Mapa V9.2";
  panel.style.width = "340px";
  panel.style.padding = "10px";
  panel.style.maxHeight = "min(85vh,750px)";
  const labelArchivo = archivo.previousElementSibling;
  if (labelArchivo) labelArchivo.style.display="none";
  archivo.style.display="none";
  const cargarKMZBtn=btn(titulo,"KMZ/KML","padding:5px 8px;font-size:11px;");
  cargarKMZBtn.onclick=()=>archivo.click();
  const cerrarRapido=btn(titulo,"×","padding:4px 7px;font-size:15px;");
  cerrarRapido.title="Cerrar Centrality Local sin cerrar GNAT";
  cerrarRapido.onclick=()=>cerrar.click();
  // La lista de navegación vuelve a quedar a la vista inmediatamente bajo el buscador.
  controles.insertBefore(listaTitulo,barraFiltros);
  controles.insertBefore(lista,barraFiltros);
  controles.insertBefore(detailRow,resumen);
  controles.insertBefore(detailStatus,resumen);
  detailRow.style.margin="6px 0 0";
  detailStatus.style.margin="0 0 4px";
  // Mantener búsqueda, filtros de zonas y navegación a la vista.
  const opcionesAvanzadas=crear(controles,"details",null,
    "margin-top:6px;border-top:1px solid #d8e0ea;padding-top:6px;");
  crear(opcionesAvanzadas,"summary","Ajustes de etiquetas y filtros de categorías",
    "font-size:11px;cursor:pointer;color:#566575;");
  opcionesAvanzadas.append(barraFiltros,filtrosSupervisores);
  [agrupacion,gestorBloques,tablaWrap,pieTabla,acciones,acciones2,accionesAperturas,herramientas]
    .forEach(el=>el.style.display="none");
  // Las preferencias antiguas permanecen dentro de la planilla / proyecto JSON.
  if (botonesProyecto.parentElement===panel) {
    botonesProyecto.style.marginTop="4px";
    for(const b of [guardarProyectoBtn,abrirProyectoBtn]) {
      b.style.padding="6px 4px"; b.style.fontSize="11px";
    }
  }

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
    abrirExcelBtn.style.display = oculto ? "none" : "";
    cargarKMZBtn.style.display = oculto ? "none" : "";
    cerrarRapido.style.display = oculto ? "none" : "";
    titulo.style.marginBottom = oculto ? "0" : "8px";
    titulo.style.gap = oculto ? "0" : "7px";
    panel.style.width = oculto ? "36px" : "340px";
    panel.style.padding = oculto ? "0" : "10px";
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
    void autosave?.save().finally(() => autosave?.destroy());
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
  let editorTab = "BLOQUE";
  let editorEstado = null;
  let editorBody = null;
  let editorTitle = null;
  let editorCount = null;
  let editorQuery = null;
  const editorCols = {
    APERTURA: [
      ["numero", "N°", "number"], ["codigo", "Código de apertura", "text"],
      ["tipoEquipo", "Tipo (DF / DBC / DC / Pole Top)", "text"],
      ["longitud", "Longitud", "decimal"], ["latitud", "Latitud", "decimal"],
      ["supervisorColor", "Categoría", "select"], ["bloques", "Zonas asociadas", "text"]
    ],
    PUNTO: [
      ["numero", "N°", "number"], ["codigo", "Código de poste", "text"],
      ["longitud", "Longitud", "decimal"], ["latitud", "Latitud", "decimal"],
      ["supervisorColor", "Color / supervisor", "select"], ["bloqueId", "Zona", "text"],
      ["aperturasIds", "Aperturas asociadas", "text"]
    ],
    BLOQUE: [["id", "Código de zona", "readonly"], ["nombre", "Nombre de la zona", "text"],
      ["responsable", "Supervisor / responsable", "text"], ["color", "Color de zona (solo referencia)", "color"]]
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
        bloques:editorTexto(f.get('bloques')),aperturasIds:editorTexto(f.get('aperturasIds')),
        colorPersonalizado:String(f.get('colorPersonalizado')||''),tipoEquipo:String(f.get('tipoEquipo')||''),
        supervisorNombre:String(f.get('supervisorNombre')||''),fechaPlanificacion:String(f.get('fechaPlanificacion')||'')});
    }
    editorBloques=[...definicionesBloques].map(([id,nombre],i)=>({id,nombre,
      responsable:responsablesBloques.get(id)||'',color:coloresBloques.get(id)||colorBloqueDefault(i)}));
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
      if (!colorSeguro(block.color)) throw Error('Color de zona inválido: '+id);
      if (String(block.responsable||'').length > 100) throw Error('Nombre de supervisor demasiado largo: '+id);
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
      const colorPersonalizado=String(r.colorPersonalizado||'').trim();
      if (kind==='PUNTO' && colorPersonalizado && !colorSeguro(colorPersonalizado))
        throw Error('Color propio inválido en '+codigo);
      if (kind==='APERTURA' && bloques.some(id=>!bIds.has(id))) throw Error('Bloque de apertura inexistente en '+codigo);
      return {id,numero,codigo,longitud:longitude,latitud:latitude,supervisorColor,bloqueId,
        bloques,aperturasIds: editorSeparar(r.aperturasIds),tipo:kind,
        colorPersonalizado, tipoEquipo:String(r.tipoEquipo||'').trim().slice(0,100),
        supervisorNombre:String(r.supervisorNombre||''),fechaPlanificacion:String(r.fechaPlanificacion||'')};
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
        bloqueId:r.bloqueId,bloques:r.bloques,aperturasIds:r.aperturasIds,
        colorPersonalizado:r.colorPersonalizado||'',tipoEquipo:r.tipoEquipo||'',
        supervisorNombre:r.supervisorNombre||'',fechaPlanificacion:r.fechaPlanificacion||''
      }));
      const nuevaCapa = new ol.layer.Vector({source:new ol.source.Vector({features:nuevas}),zIndex:100000,style:estiloPunto});
      const oldCapa=capa;
      map.addLayer(nuevaCapa);
      if (oldCapa) map.removeLayer(oldCapa);
      puntos=nuevas; capa=nuevaCapa;
      excelBorrador=null; // zone changes become authoritative; reopen Excel for a fresh snapshot.
      definicionesBloques.clear();
      for(const b of editorBloques) {
        definicionesBloques.set(b.id,b.nombre);
        coloresBloques.set(b.id,b.color);
        responsablesBloques.set(b.id,String(b.responsable||''));
      }
      for (const id of [...coloresBloques.keys()]) if(!definicionesBloques.has(id)) coloresBloques.delete(id);
      for (const id of [...responsablesBloques.keys()]) if(!definicionesBloques.has(id)) responsablesBloques.delete(id);
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
    const opening=editorFilas.APERTURA.find(a=>a.id===id);
    const zoneIds=new Set(editorSeparar(opening?.bloques));
    return editorFilas.PUNTO.filter(r=>editorSeparar(r.aperturasIds).includes(id) ||
      (r.bloqueId && zoneIds.has(r.bloqueId))).length;
  }
  function editorMostrar() {
    if (!editorDocumento || editorVentana?.closed) return;
    const headings=editorDocumento.querySelector('#tabs');
    headings.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tab===editorTab));
    editorTitle.textContent=editorTab==='APERTURA'?'Aperturas · catálogo único':editorTab==='PUNTO'?'Recorrido · puntos de trabajo':'Zonas · nombres, responsables y colores';
    const cols=editorCols[editorTab],data=editorRowsActuales();
    editorDocumento.querySelector('#thead').replaceChildren();
    editorBody.replaceChildren();
    const tr=e('tr',editorDocumento.querySelector('#thead'));
    e('th',tr,'Sel.');
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
      // Los IDs internos solo viven en el JSON; nunca aparecen en la planilla.
      for(const [key,,type] of cols) {
        const td=e('td',row);
        if(type==='readonly') {td.textContent=r[key];continue;}
        let input;
        if(type==='select') {
          input=e('select',td);
          for(const v of OPCIONES_BLOQUE){const opt=e('option',input,v);opt.value=v;}
        } else {
          input=e('input',td);
          input.type=type==='color'||type==='optionalColor'?'color':'text';
          input.autocomplete='off';
          if(type==='decimal')input.inputMode='decimal';
        }
        input.className='cell';input.dataset.key=key;input.dataset.index=String(i);
        input.value=(type==='optionalColor' ? (r[key]||'#777777') : r[key]??'');
        if(type==='optionalColor'){
          const clear=e('button',td,'Automático','mini');clear.type='button';
          clear.onclick=()=>{r[key]=''; editorMostrar();editorAplicar(true);};
        }
        input.title=key==='aperturasIds'?'IDs o códigos únicos separados por |. Usa Elegir para seleccionar varias.':key==='bloques'?'IDs de bloques manuales separados por |':'';
        if(key==='aperturasIds') {
          const chooser=e('button',td,'Elegir','mini');chooser.type='button';
          chooser.addEventListener('click',()=>editorElegirAperturas(i));
        }
      }
      if(editorTab==='APERTURA')e('td',row,editorAsociadasA(r.id),'count');
       const td=e('td',row);
       if(editorTab==='BLOQUE'){
         const manage=e('button',td,'Editar zona ↗','mini');manage.type='button';
         manage.onclick=()=>editorEditarZona(i);
       }
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
  function editorEditarZona(index) {
    const zone=editorBloques[index];if(!zone)return;
    const dlg=editorDocumento.querySelector('#zoneChooser');
    const codes=editorDocumento.querySelector('#zoneCodes');
    const openings=editorDocumento.querySelector('#zoneOpenings');
    const hint=editorDocumento.querySelector('#zoneHint');
    editorDocumento.querySelector('#zoneName').textContent=zone.id+' · '+zone.nombre;
    codes.value=editorFilas.PUNTO.filter(r=>r.bloqueId===zone.id).map(r=>r.codigo).join('\n');
    openings.value=editorFilas.APERTURA.filter(r=>editorSeparar(r.bloques).includes(zone.id))
      .map(r=>r.codigo).join('\n');
    hint.textContent='Pega códigos ya registrados. Las coordenadas deben existir en el catálogo; la búsqueda GNAT automática aún no está implementada.';
    const split=s=>[...new Set(s.split(/[\s,;|]+/).map(x=>x.trim()).filter(Boolean))];
    const resolve=(wanted,rows)=>{
      const found=new Set();const missing=[];const ambiguous=[];
      for(const c of wanted){
        const matches=rows.filter(r=>String(r.codigo).toUpperCase()===c.toUpperCase());
        if(matches.length===1)found.add(matches[0].id);
        else if(matches.length===0)missing.push(c);
        else ambiguous.push(c);
      }
      return {found,missing,ambiguous};
    };
    editorDocumento.querySelector('#zoneApply').onclick=()=>{
      const p=resolve(split(codes.value),editorFilas.PUNTO);
      const a=resolve(split(openings.value),editorFilas.APERTURA);
      if(p.missing.length||p.ambiguous.length||a.missing.length||a.ambiguous.length){
        hint.textContent='No se aplicó. Códigos sin coordenadas/registro: '+[...p.missing,...a.missing].join(', ')+
          (p.ambiguous.length||a.ambiguous.length?' · Códigos ambiguos: '+[...p.ambiguous,...a.ambiguous].join(', '):'');
        return;
      }
      const oldP=editorFilas.PUNTO.map(r=>r.bloqueId);
      const oldA=editorFilas.APERTURA.map(r=>r.bloques);
      editorFilas.PUNTO.forEach(r=>{
        if(p.found.has(r.id))r.bloqueId=zone.id;
        else if(r.bloqueId===zone.id)r.bloqueId='';
      });
      editorFilas.APERTURA.forEach(r=>{
        const zoneSet=new Set(editorSeparar(r.bloques));
        if(a.found.has(r.id))zoneSet.add(zone.id);else zoneSet.delete(zone.id);
        r.bloques=[...zoneSet].join(' | ');
      });
      if(!editorAplicar(true)){
        editorFilas.PUNTO.forEach((r,i)=>r.bloqueId=oldP[i]);
        editorFilas.APERTURA.forEach((r,i)=>r.bloques=oldA[i]);
        hint.textContent='Error de validación. No se guardaron cambios.';
        return;
      }
      dlg.hidden=true;editorMostrar();
    };
    dlg.hidden=false;
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
      let idx=1;while(editorBloques.some(b=>b.id==='D'+idx))idx++;
      editorBloques.push({id:'D'+idx,nombre:'Zona '+idx,responsable:'',color:colorBloqueDefault(editorBloques.length)});
    } else {
      let idx=1;const prefix=kind==='PUNTO'?'p-':'a-';
      const used=new Set([...editorFilas.PUNTO,...editorFilas.APERTURA].map(x=>x.id));
      while(used.has(prefix+String(idx).padStart(3,'0')))idx++;
      let n=1;while(arr.some(r=>Number(r.numero)===n))n++;
      arr.push({id:prefix+String(idx).padStart(3,'0'),numero:String(n),codigo:'',
        longitud:'',latitud:'',supervisorColor:'Sin asignar',bloqueId:'',bloques:'',aperturasIds:'',colorPersonalizado:'',tipoEquipo:''});
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
    if(editorTab==='BLOQUE')return editorInfo('Para pegar listas de postes o aperturas usa Editar zona ↗.',true);
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
        data.push({id:prefix+'paste-'+suffix,numero:String(n),codigo:'',longitud:'',latitud:'',supervisorColor:'Sin asignar',bloqueId:'',bloques:'',aperturasIds:'',colorPersonalizado:'',tipoEquipo:''});
      }
      const obj=data[first+idx];
      values.forEach((val,j)=>{const key=keys[start+j];if(key!==undefined)obj[key]=val.trim();});
    });
    editorMostrar();editorAplicar(true);
  }
  function guardarCSVHumano(kind) {
    const clean=v=>{
      let t=String(v??'');
      // Prevent spreadsheet formula interpretation for untrusted human labels.
      if (/^[\s]*[=+@]/.test(t) || /^[\s]*-(?![0-9.,])/.test(t)) t="'"+t;
      return /[;"\n\r]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;
    };
    const serial=rows=>rows.map(row=>row.map(clean).join(';')).join('\r\n');
    const zones=new Map(editorBloques.map(b=>[b.id,b.nombre]));
    const openings=new Map(editorFilas.APERTURA.map(a=>[a.id,a.codigo]));
    const data=kind==='APERTURA'
      ? [['Código apertura','Tipo','Latitud','Longitud','Zonas'],...editorFilas.APERTURA.map(a=>
          [a.codigo,a.tipoEquipo||'',a.latitud,a.longitud,editorSeparar(a.bloques).map(id=>zones.get(id)||id).join(' | ')])]
      : [['N°','Código poste','Latitud','Longitud','Zona','Supervisor','Aperturas'],...editorFilas.PUNTO.map(r=>
          [r.numero,r.codigo,r.latitud,r.longitud,zones.get(r.bloqueId)||r.bloqueId,r.supervisorColor,
           [...new Set([...editorSeparar(r.aperturasIds).map(id=>openings.get(id)||id),
             ...editorFilas.APERTURA.filter(a=>r.bloqueId && editorSeparar(a.bloques).includes(r.bloqueId))
               .map(a=>a.codigo)])].join(' | ')])];
    descargarTexto(kind==='APERTURA'?'aperturas-legible.csv':'recorrido-legible.csv','\ufeff'+serial(data),'text/csv;charset=utf-8');
  }
  function abrirEditorV8(){
    if(editorVentana && !editorVentana.closed){editorVentana.focus();return;}
    try {editorSnapshot();}catch(err){return mensaje('No se pudo abrir la planilla: '+err.message,true);}
    editorVentana=window.open('', 'centrality-planilla-v9', 'width=1450,height=850,resizable=yes,scrollbars=yes');
    if(!editorVentana)return mensaje('Chrome bloqueó la pestaña. Permite ventanas emergentes para Centrality.',true);
    const page=editorVentana;
    editorDocumento=page.document;
    editorDocumento.open();
    editorDocumento.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Centrality · Planilla de trabajo</title></head><body></body></html>');
    editorDocumento.close();
    const style=e('style',editorDocumento.head);
    style.textContent=`*{box-sizing:border-box}body{margin:0;background:#f4f6fa;font:13px system-ui,Arial;color:#1e2c39}header{padding:14px 20px;background:#fff;border-bottom:1px solid #dae1e9;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}h1{margin:0;font-size:18px}h2{font-size:15px;margin:0}button{cursor:pointer;border:1px solid #c8d3e0;border-radius:6px;background:white;padding:7px 12px;font:inherit}button:hover{background:#edf4fc}button.primary{background:#1766ae;border-color:#1766ae;color:white}button.active{background:#dbeafe;border-color:#7faee8;color:#143d70;font-weight:650}.mini{padding:4px 6px;font-size:11px;margin-left:4px;white-space:nowrap}.muted{color:#66788b;font-size:12px}#tabs{display:flex;gap:8px;margin:14px 20px}main{margin:0 20px 20px;background:#fff;border:1px solid #d5dee9;border-radius:9px;padding:14px}#toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.grid{border:1px solid #cbd5e1;overflow:auto;max-height:65vh}table{border-spacing:0;border-collapse:collapse;width:100%;min-width:1040px}th{position:sticky;top:0;background:#eaf0f5;z-index:1;text-align:left;padding:9px 7px;border-right:1px solid #d8e0e9;white-space:nowrap}td{border:1px solid #e1e7ee;padding:4px 6px}tr:nth-child(even){background:#fafbfd}td.id{font-family:ui-monospace,monospace;color:#64748b;white-space:nowrap}td.count{text-align:center;font-weight:bold}input.cell,select.cell{font:inherit;border:1px solid transparent;border-radius:3px;padding:6px;width:100%;min-width:80px;background:transparent;color:#1c2c3a}input.cell:focus,select.cell:focus{background:#fff;border-color:#3b82f6;outline:2px solid #bfdbfe}td:has(input[data-key="aperturasIds"]){min-width:230px}td:has(input[data-key="codigo"]){min-width:175px}td:has(input[data-key="bloqueId"]){min-width:100px}#status{padding:10px;border-radius:6px;background:#e9f5ec;color:#126337;flex:1}#status.bad{background:#fff2e0;color:#8a4511}#query{padding:8px;border:1px solid #d5dee9;border-radius:6px;min-width:250px}#chooser{position:fixed;inset:0;background:#0007;z-index:100;display:grid;place-items:center}#chooser[hidden]{display:none}#chooser>div{width:min(520px,94vw);background:#fff;border-radius:12px;padding:22px;box-shadow:0 10px 35px #0004}#chooserItems{display:grid;gap:9px;max-height:55vh;overflow:auto;margin:15px 0}.choice{display:flex;gap:9px;align-items:center;padding:6px;border-bottom:1px solid #eee} .foot{padding:10px 20px;color:#64748b;font-size:12px}`;
    style.textContent += '#zoneChooser{position:fixed;inset:0;background:#0007;z-index:110;display:grid;place-items:center}' +
      '#zoneChooser[hidden]{display:none}#zoneChooser>div{background:#fff;padding:24px;border-radius:12px;width:min(920px,95vw);box-shadow:0 10px 35px #0004}' +
      '.zoneGrid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:15px 0}.zoneGrid textarea{width:100%;height:240px;display:block;margin-top:8px;font:13px ui-monospace,monospace;padding:10px;border:1px solid #b9c9d9;border-radius:6px}';
    const head=e('header',editorDocumento.body);
    const hd=e('div',head);e('h1',hd,'Centrality · Planilla de trabajo');e('div',hd,'Edita las aperturas una sola vez y vincúlalas a varios postes.','muted');
    const controls=e('div',head);
    const apply=e('button',controls,'Aplicar al mapa','primary');
    const backup=e('button',controls,'Guardar proyecto JSON');
    // Edición centralizada en JSON; los CSV legibles son solo exportación.
    const exportCSV=e('button',controls,'Exportar tabla CSV');
    // Importación CSV heredada solo mediante V8; la V9 usa JSON como fuente editable.
    const reload=e('button',controls,'Recargar desde mapa');
    const nav=e('nav',editorDocumento.body,undefined);nav.id='tabs';
    for(const [kind,label] of [['BLOQUE','Zonas'],['PUNTO','Recorrido'],['APERTURA','Aperturas']]){
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
    editorEstado=e('div',footer,'Cambios cargados desde mapa.');editorEstado.id='status';
    e('div',editorDocumento.body,'Las zonas y aperturas son asociaciones de planificación, no prueba de aislamiento eléctrico. Guarda periódicamente tu proyecto JSON.','foot');
    const zona=e('div',editorDocumento.body);zona.id='zoneChooser';zona.hidden=true;
    const zoneInner=e('div',zona);e('h2',zoneInner,undefined).id='zoneName';
    e('div',zoneInner,'Pega códigos humanos, uno por línea. Cada apertura queda en su catálogo y puede compartirse entre varias zonas.','muted');
    const zoneGrid=e('div',zoneInner);zoneGrid.className='zoneGrid';
    const postBox=e('div',zoneGrid);e('strong',postBox,'Postes de la zona');e('textarea',postBox).id='zoneCodes';
    const openBox=e('div',zoneGrid);e('strong',openBox,'Aperturas asociadas');e('textarea',openBox).id='zoneOpenings';
    e('div',zoneInner,'','muted').id='zoneHint';
    e('button',zoneInner,'Aplicar a zona','primary').id='zoneApply';
    const cancelZone=e('button',zoneInner,'Cancelar');cancelZone.onclick=()=>zona.hidden=true;
    const modal=e('div',editorDocumento.body);modal.id='chooser';modal.hidden=true;
    const inner=e('div',modal);e('h2',inner,'Vincular aperturas a este poste');
    e('div',inner,'Una misma apertura puede servir para varios puntos.','muted');
    e('div',inner).id='chooserItems';
    const save=e('button',inner,'Aceptar selección','primary');save.id='chooserSave';
    const cancel=e('button',inner,'Cancelar');cancel.onclick=()=>modal.hidden=true;
    apply.onclick=()=>editorAplicar();
    backup.onclick=()=>{if(editorAplicar(true))guardarProyectoBtn.click();};
    exportCSV.onclick=()=>{
      if(editorTab==='BLOQUE')return editorInfo('Abre Recorrido o Aperturas para exportar una tabla legible.',true);
      if(editorAplicar(true)) guardarCSVHumano(editorTab);
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

  function construirEditorExcel() {
  // ============================================================================
  // PLANILLA ESTILO EXCEL REAL (Con Traducción de IDs JSON, Rango 2D y Normalización)
  // ============================================================================
  let editorVentana = null;
  let editorDocumento = null;
  let activeSheet = "RECORRIDO"; // "RECORRIDO" | "MASIVO" | "APERTURAS"
  let filtroTexto = "";

  // Estado de selección de rango 2D estilo Excel
  let selStart = { r: 0, c: 0 };
  let selEnd = { r: 0, c: 0 };
  let isSelecting = false;
  let isFilling = false;
  let editingCell = null;

  // Estado de las 3 hojas
  let sheetRecorrido = [];
  let sheetAperturas = [];
  let sheetMasivo = {
    zona: "D1",
    supervisor: "",
    filas: Array.from({ length: 35 }, () => ({ subestacion: "", apertura: "" }))
  };

  const PALETA_ZONAS = ["#198754", "#ef8b16", "#2469d8", "#8b5cf6", "#0d9488", "#be185d", "#d97706", "#0284c7"];

  const fmtComma = (val) => {
    if (val === undefined || val === null || String(val).trim() === "") return "";
    const n = Number(String(val).trim().replace(",", "."));
    return Number.isFinite(n) ? String(n).replace(".", ",") : String(val);
  };

  const parseCoord = (val, maxAbs) => {
    const raw = String(val ?? "").trim().replace(",", ".");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) > maxAbs) return null;
    return n;
  };

  // Extrae el número real de desconexión desde el nombre del bloque ("DESC 1, 2 aperturas" -> "1") o desde su ID ("D1" -> "1")
  const extraerNumeroDesc = (bloqueId) => {
    const id = String(bloqueId ?? "").trim().replace(/^-->\s*/i, "");
    if (!id) return "";
    const nombre = String(definicionesBloques.get(id) || "").trim();
    const matchNombre = /DESC(?:ONEXI[OÓ]N)?\s*[:#.-]?\s*(\d+)/i.exec(nombre);
    if (matchNombre) return matchNombre[1];
    const matchId = /^[DB](\d+)$/i.exec(id);
    if (matchId) return matchId[1];
    return id;
  };

  const normDescToZoneId = (desc) => {
    const clean = String(desc ?? "").trim().replace(/^-->\s*/i, "");
    if (!clean) return "";
    const m = /^D?(\d+)$/i.exec(clean);
    return m ? "D" + m[1] : clean;
  };

  function contarAperturasFila(r) {
    const count = [r.ap1, r.ap2, r.ap3, r.ap4].map(x => String(x || "").trim()).filter(Boolean).length;
    return count > 0 ? String(count) : "";
  }

  function rangoNormalizado(a = selStart, b = selEnd) {
    return {
      minR: Math.min(a.r, b.r),
      maxR: Math.max(a.r, b.r),
      minC: Math.min(a.c, b.c),
      maxC: Math.max(a.c, b.c)
    };
  }

  // Lee los puntos y aperturas del mapa/JSON traduciendo IDs a códigos visibles
  function sincronizarDesdeMapa() {
    if (!ol.proj?.toLonLat) throw Error("No hay conversión geográfica disponible.");
    // Borradores incluyen puntos sin coordenadas, que no se pueden dibujar aún.
    if (excelBorrador?.version === 1 && Array.isArray(excelBorrador.recorrido) &&
        Array.isArray(excelBorrador.aperturas) && excelBorrador.recorrido.length <= 50000 &&
        excelBorrador.aperturas.length <= 50000) {
      sheetRecorrido = excelBorrador.recorrido.map(r=>({...r}));
      sheetAperturas = excelBorrador.aperturas.map(r=>({...r}));
      if (excelBorrador.masivo?.filas && Array.isArray(excelBorrador.masivo.filas)) {
        sheetMasivo = {zona:String(excelBorrador.masivo.zona||'D1'),
          supervisor:String(excelBorrador.masivo.supervisor||''),
          filas:excelBorrador.masivo.filas.slice(0,50000).map(r=>({...r}))};
      }
      return;
    }
    const openingIndex = new Map();
    const codeIndex = new Map();
    for (const f of puntos) {
      if (f.get('tipo') !== 'APERTURA') continue;
      const code = puntoCodigo(f).trim();
      openingIndex.set(String(f.get('id')),code);
      const key=code.toUpperCase();
      codeIndex.set(key,(codeIndex.get(key)||0)+1);
    }
    sheetAperturas=[]; sheetRecorrido=[];
    for (const f of puntos) {
      const [lon,lat]=ol.proj.toLonLat(f.getGeometry().getCoordinates(),map.getView().getProjection());
      const id=String(f.get('id'));
      if (f.get('tipo') === 'APERTURA') {
        sheetAperturas.push({__id:id,codigo:puntoCodigo(f),latitud:fmtComma(lat),longitud:fmtComma(lon)});
      } else {
        const refs=Array.isArray(f.get('aperturasIds'))?f.get('aperturasIds'):[];
        // Preserve every original reference, including the ones beyond four columns.
        const translate=id=>openingIndex.get(String(id))||String(id);
        const r={__id:id,numero:String(f.get('numero')||''),
          supervisor:String(f.get('supervisorNombre')||categoriaSupervisor(f)),
          subestacion:puntoCodigo(f),latitud:fmtComma(lat),longitud:fmtComma(lon),
          ap1:translate(refs[0]||''),ap2:translate(refs[1]||''),
          ap3:translate(refs[2]||''),ap4:translate(refs[3]||''),
          __originalRefs:refs.slice(0,4),__extraRefs:refs.slice(4),
          nDesc:String(f.get('bloqueId')||''),nAperturas:'',
          fecha:String(f.get('fechaPlanificacion')||'')};
        r.nAperturas=contarAperturasFila(r);
        sheetRecorrido.push(r);
      }
    }
    if (!sheetRecorrido.length) sheetRecorrido=Array.from({length:30},(_,i)=>({numero:String(i+1),supervisor:'',subestacion:'',latitud:'',longitud:'',ap1:'',ap2:'',ap3:'',ap4:'',nDesc:'',nAperturas:'',fecha:''}));
    if (!sheetAperturas.length) sheetAperturas=Array.from({length:25},()=>({codigo:'',latitud:'',longitud:''}));
  }

  // Normaliza códigos, IDs ("p-001", "a-001") y numeración hacia el mapa y para exportación JSON
  function guardarBorradorExcel() {
    // JSON is the source of truth: preserve incomplete rows and pasted lists.
    excelBorrador={version:1,
      recorrido:sheetRecorrido.map(x=>({...x})),
      aperturas:sheetAperturas.map(x=>({...x})),
      masivo:{zona:sheetMasivo.zona,supervisor:sheetMasivo.supervisor,
        filas:sheetMasivo.filas.map(x=>({...x}))}};
  }

  function sincronizarHaciaMapa(reRender = false) {
    try {
      if (!abierto || !map?.getView || !ol.proj?.fromLonLat) throw Error('El mapa no está disponible.');
      guardarBorradorExcel();
      const oldById=new Map(puntos.map(f=>[String(f.get('id')),f]));
      const newById=new Map();
      let pendientes=0;
      const usedIds=new Set(oldById.keys());
      const newId=(prefix)=>{let i=1;while(usedIds.has(prefix+i))i++;const id=prefix+i;usedIds.add(id);return id;};
      const codeIndex=new Map();
      const openingRefs=new Map();
      for (const f of puntos) {
        if (f.get('tipo')!=='APERTURA') continue;
        const key=String(f.get('codigo')||'').trim().toUpperCase();
        if (!codeIndex.has(key)) codeIndex.set(key,[]);
        codeIndex.get(key).push(String(f.get('id')));
      }
      const project=(f, row, kind)=>{
        const code=String(kind==='PUNTO'?row.subestacion:row.codigo||'').trim();
        if (!code) return false;
        const lat=parseCoord(row.latitud,90), lon=parseCoord(row.longitud,180);
        if (lat===null || lon===null) {pendientes++;return false;}
        if (!f && !row.__id) row.__id=newId(kind==='PUNTO'?'p-excel-':'a-excel-');
        const id=String(row.__id||'');
        if (oldById.has(id) && oldById.get(id).get('tipo')!==kind) throw Error('Tipo incompatible para '+code);
        if (newById.has(id)) throw Error('ID duplicado en planilla: '+id);
        const props=f?{...f.getProperties()}:{id,numero:0,tipo:kind,bloque:SIN_BLOQUE,
          aperturasIds:[],bloques:[],bloqueId:'',colorPersonalizado:'',tipoEquipo:''};
        props.geometry=new ol.geom.Point(ol.proj.fromLonLat([lon,lat],map.getView().getProjection()));
        props.codigo=code;
        if (kind==='PUNTO') {
          const n=Number(row.numero);
          if (Number.isSafeInteger(n)&&n>0)props.numero=n;
          props.supervisorNombre=String(row.supervisor||'').trim();
          const alias=props.supervisorNombre;
          if (OPCIONES_BLOQUE.includes(alias)) props.bloque=alias;
          // The supervisor category from GNAT/JSON is authoritative; never force Naranjo.
          props.bloqueId=normDescToZoneId(row.nDesc);
          props.fechaPlanificacion=String(row.fecha||'');
          const ids=[];
          for (let i=0;i<4;i++){
            const text=String(row['ap'+(i+1)]||'').trim();
            if (!text) continue;
            const oldRef=Array.isArray(row.__originalRefs)?row.__originalRefs[i]:null;
            const candidates=codeIndex.get(text.toUpperCase())||[];
            const unchanged=oldRef&&oldById.has(String(oldRef))&&
              String(oldById.get(String(oldRef)).get('codigo')||'').trim().toUpperCase()===text.toUpperCase();
            const ref=unchanged?String(oldRef):candidates.length===1?candidates[0]:'';
            if (!ref) {pendientes++;continue;}
            if (!ids.includes(ref))ids.push(ref);
          }
          for(const ref of row.__extraRefs||[])if(oldById.has(String(ref))&&!ids.includes(String(ref)))ids.push(String(ref));
          props.aperturasIds=ids;
          // Zone name/color/responsible are not recreated from the table.
          const zid=props.bloqueId;
          if(zid&&!definicionesBloques.has(zid)){
            definicionesBloques.set(zid,'Desconexión '+zid.replace(/^D/i,''));
            coloresBloques.set(zid,colorBloqueDefault(definicionesBloques.size-1));
          }
        } else {
          // Opening appearance, type, manual zone links remain untouched.
          if(!props.numero) props.numero=1;
        }
        const feature=new ol.Feature(props);
        newById.set(id,feature);
        return true;
      };
      // Resolve existing opening identities first; new codes get unique IDs.
      for(const row of sheetAperturas){
        const code=String(row.codigo||'').trim();
        if(!code)continue;
        const original=row.__id?oldById.get(String(row.__id)):null;
        if (!original && !row.__id && (codeIndex.get(code.toUpperCase())||[]).length===1) {
          row.__id=codeIndex.get(code.toUpperCase())[0];
        }
        if(project(original||oldById.get(String(row.__id)),row,'APERTURA')){
          const key=code.toUpperCase();const arr=codeIndex.get(key)||[];
          if(!arr.includes(String(row.__id)))arr.push(String(row.__id));
          codeIndex.set(key,arr);
        }
      }
      for(const row of sheetRecorrido){
        if(!String(row.subestacion||'').trim())continue;
        const original=row.__id?oldById.get(String(row.__id)):null;
        project(original,row,'PUNTO');
      }
      // Never silently remove an original feature because a row was incomplete/cleared.
      for(const [id,feature] of oldById)if(!newById.has(id))newById.set(id,feature);
      const updated=[...newById.values()];
      const capaNueva=new ol.layer.Vector({source:new ol.source.Vector({features:updated}),zIndex:100000,style:estiloPunto});
      map.addLayer(capaNueva);
      if(capa)map.removeLayer(capa);
      puntos=updated;capa=capaNueva;
      seleccionado.clear();enfocado=-1;
      refrescarVista();
      guardarBorradorExcel();
      const note=pendientes?` · ${pendientes} dato(s) pendientes (guardados en JSON)`:' ';
      const msg=`Planilla sincronizada: ${updated.length} objetos`+note;
      mensaje(msg);setExcelStatus(msg,Boolean(pendientes));
      if(reRender)renderExcelGrid();
      return true;
    }catch(err){setExcelStatus('No se aplicaron cambios: '+err.message,true);return false;}
  }

  function ejecutarAsociacionMasiva() {
    const descNum = extraerNumeroDesc(sheetMasivo.zona || "D1");
    if (!descNum) {
      setExcelStatus("Indica un código de zona válido (ej. D1 o 1).", true);
      return;
    }

    const subCodigos = sheetMasivo.filas.map(f => String(f.subestacion || "").trim()).filter(Boolean);
    const apCodigos = [...new Set(sheetMasivo.filas.map(f => String(f.apertura || "").trim()).filter(Boolean))];

    if (!subCodigos.length) {
      setExcelStatus("Pega al menos un código de subestación en la columna A.", true);
      return;
    }

    if (apCodigos.length > 4) {
      setExcelStatus('Hay más de 4 aperturas; esta vista tiene 4 columnas. Revisa en Zonas antes de asociar.',true);
      return;
    }
    let actualizados = 0, creados = 0;
    sheetRecorrido = sheetRecorrido.filter(r =>
      String(r.subestacion || r.latitud || r.longitud || r.ap1 || "").trim() !== ""
    );

    for (const codSub of subCodigos) {
      const existentes = sheetRecorrido.filter(
        r => String(r.subestacion || "").trim().toUpperCase() === codSub.toUpperCase()
      );
      if (existentes.length > 0) {
        for (const fila of existentes) {
          if (!fila.supervisor && sheetMasivo.supervisor) fila.supervisor = sheetMasivo.supervisor;
          fila.ap1 = apCodigos[0] || "";
          fila.ap2 = apCodigos[1] || "";
          fila.ap3 = apCodigos[2] || "";
          fila.ap4 = apCodigos[3] || "";
          fila.nDesc = descNum;
          fila.nAperturas = contarAperturasFila(fila);
          actualizados++;
        }
      } else {
        const nextNum = 1 + Math.max(0, ...sheetRecorrido.map(r => Number(r.numero) || 0));
        const nueva = {
          numero: String(nextNum),
          supervisor: sheetMasivo.supervisor || "",
          subestacion: codSub,
          latitud: "", longitud: "",
          ap1: apCodigos[0] || "", ap2: apCodigos[1] || "", ap3: apCodigos[2] || "", ap4: apCodigos[3] || "",
          nDesc: descNum, nAperturas: "", fecha: ""
        };
        nueva.nAperturas = contarAperturasFila(nueva);
        sheetRecorrido.push(nueva);
        creados++;
      }
    }

    for (const apCod of apCodigos) {
      const existeAp = sheetAperturas.some(a => String(a.codigo || "").trim().toUpperCase() === apCod.toUpperCase());
      if (!existeAp) {
        const filaVacia = sheetAperturas.find(a => !String(a.codigo || "").trim());
        if (filaVacia) filaVacia.codigo = apCod;
        else sheetAperturas.push({ codigo: apCod, latitud: "", longitud: "" });
      }
    }

    sincronizarHaciaMapa(false);
    activeSheet = "RECORRIDO";
    selStart = { r: 0, c: 0 };
    selEnd = { r: 0, c: 0 };
    renderExcelGrid();
    setExcelStatus(
      `Zona DESC ${descNum} asociada: ${actualizados} subestación(es) actualizada(s)` +
      (creados ? `, ${creados} nueva(s)` : "") +
      ` con ${apCodigos.length} apertura(s).`
    );
  }

  function setExcelStatus(text, isError = false) {
    if (!editorDocumento || editorVentana?.closed) return;
    const st = editorDocumento.getElementById("excelStatus");
    if (st) {
      st.textContent = text;
      st.style.color = isError ? "#b42318" : "#1e3a5f";
      st.style.fontWeight = isError ? "bold" : "normal";
    }
  }

  const DEFINICION_HOJAS = {
    RECORRIDO: {
      letras: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
      columnas: [
        { key: "numero", title: "N°", width: "52px", align: "center" },
        { key: "supervisor", title: "Supervisor", width: "130px", align: "left", style: "supervisor" },
        { key: "subestacion", title: "Subestación", width: "105px", align: "center" },
        { key: "latitud", title: "Latitud", width: "95px", align: "right" },
        { key: "longitud", title: "Longitud", width: "95px", align: "right" },
        { key: "ap1", title: "Apertura 1", width: "100px", align: "center", isLink: true },
        { key: "ap2", title: "Apertura 2", width: "100px", align: "center", isLink: true },
        { key: "ap3", title: "Apertura 3", width: "100px", align: "center", isLink: true },
        { key: "ap4", title: "Apertura 4", width: "100px", align: "center", isLink: true },
        { key: "nDesc", title: "N° DESC", width: "80px", align: "center" },
        { key: "nAperturas", title: "N° Aperturas", width: "95px", align: "center", readonly: true },
        { key: "fecha", title: "Fecha planificación", width: "135px", align: "center" }
      ]
    },
    APERTURAS: {
      letras: ["A", "B", "C", "D"],
      columnas: [
        { key: "codigo", title: "Código", width: "120px", align: "center" },
        { key: "latitud", title: "Latitud", width: "130px", align: "right" },
        { key: "longitud", title: "Longitud", width: "130px", align: "right" }
      ]
    }
  };

  function leerValorCelda(r, c) {
    if (activeSheet === "MASIVO") {
      if (c === 0) return sheetMasivo.filas[r]?.subestacion ?? "";
      if (c === 3 && r >= 1) return sheetMasivo.filas[r - 1]?.apertura ?? "";
      return "";
    }
    const config = DEFINICION_HOJAS[activeSheet];
    const datos = activeSheet === "RECORRIDO" ? sheetRecorrido : sheetAperturas;
    const col = config.columnas[c];
    if (!col || !datos[r]) return "";
    return datos[r][col.key] ?? "";
  }

  function escribirValorCelda(r, c, val) {
    if (activeSheet === "MASIVO") {
      while (r >= sheetMasivo.filas.length) {
        sheetMasivo.filas.push({ subestacion: "", apertura: "" });
      }
      if (c === 0) {
        sheetMasivo.filas[r].subestacion = val;
      } else if (c === 3 && r >= 1) {
        while (r - 1 >= sheetMasivo.filas.length) {
          sheetMasivo.filas.push({ subestacion: "", apertura: "" });
        }
        sheetMasivo.filas[r - 1].apertura = val;
      }
      const inp = editorDocumento?.querySelector(`input.excel-input[data-r="${r}"][data-c="${c}"]`);
      if (inp) inp.value = val;
      return;
    }

    const config = DEFINICION_HOJAS[activeSheet];
    const datos = activeSheet === "RECORRIDO" ? sheetRecorrido : sheetAperturas;
    const col = config.columnas[c];
    if (!col || col.readonly) return;

    while (r >= datos.length) {
      if (activeSheet === "RECORRIDO") {
        datos.push({
          numero: String(datos.length + 1), supervisor: "", subestacion: "",
          latitud: "", longitud: "", ap1: "", ap2: "", ap3: "", ap4: "",
          nDesc: "", nAperturas: "", fecha: ""
        });
      } else {
        datos.push({ codigo: "", latitud: "", longitud: "" });
      }
    }

    datos[r][col.key] = val;
    const inp = editorDocumento?.querySelector(`input.excel-input[data-r="${r}"][data-c="${c}"]`);
    if (inp) {
      inp.value = val;
      const td = inp.closest("td.excel-cell");
      if (col.style === "supervisor" && td) {
        td.classList.toggle("cell-supervisor", Boolean(String(val).trim()));
      }
    }

    if (activeSheet === "RECORRIDO" && ["ap1", "ap2", "ap3", "ap4"].includes(col.key)) {
      datos[r].nAperturas = contarAperturasFila(datos[r]);
      const inpCount = editorDocumento?.querySelector(`input.excel-input[data-r="${r}"][data-key="nAperturas"]`);
      if (inpCount) inpCount.value = datos[r].nAperturas;
    }
  }

  function pintarRecuadroSeleccion() {
    if (!editorDocumento || editorVentana?.closed) return;
    const { minR, maxR, minC, maxC } = rangoNormalizado();

    editorDocumento.querySelectorAll("td.excel-cell").forEach(td => {
      td.classList.remove("sel-in", "sel-anchor", "sel-top", "sel-bottom", "sel-left", "sel-right", "sel-handle");
    });
    editorDocumento.querySelectorAll(".hdr-active").forEach(el => el.classList.remove("hdr-active"));

    for (let c = minC; c <= maxC; c++) {
      editorDocumento.querySelector(`.excel-col-letters th[data-col="${c}"]`)?.classList.add("hdr-active");
    }
    for (let r = minR; r <= maxR; r++) {
      editorDocumento.querySelector(`td.excel-row-num[data-row="${r}"]`)?.classList.add("hdr-active");
    }

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const td = editorDocumento.querySelector(`td.excel-cell[data-r="${r}"][data-c="${c}"]`);
        if (!td) continue;
        if (r === selStart.r && c === selStart.c) td.classList.add("sel-anchor");
        else td.classList.add("sel-in");
        if (r === minR) td.classList.add("sel-top");
        if (r === maxR) td.classList.add("sel-bottom");
        if (c === minC) td.classList.add("sel-left");
        if (c === maxC) td.classList.add("sel-right");
        if (r === maxR && c === maxC) td.classList.add("sel-handle");
      }
    }

    const nameBox = editorDocumento.getElementById("excelNameBox");
    const fxInput = editorDocumento.getElementById("excelFxInput");
    const c1 = String.fromCharCode(65 + minC) + (minR + 2);
    const c2 = String.fromCharCode(65 + maxC) + (maxR + 2);
    if (nameBox) {
      nameBox.textContent = (minR === maxR && minC === maxC) ? c1 : `${c1}:${c2}`;
    }

    const anchorVal = leerValorCelda(selStart.r, selStart.c);
    if (fxInput && editorDocumento.activeElement !== fxInput) {
      const colCfg = DEFINICION_HOJAS[activeSheet]?.columnas?.[selStart.c];
      if (colCfg?.isLink && anchorVal) {
        const idxAp = sheetAperturas.findIndex(
          a => String(a.codigo || "").trim().toUpperCase() === String(anchorVal).trim().toUpperCase()
        );
        fxInput.value = `=HIPERVINCULO("#gid=APERTURAS&range=A${idxAp >= 0 ? idxAp + 2 : 2}"; "${anchorVal}")`;
      } else {
        fxInput.value = anchorVal;
      }
    }
  }

  function activarModoEdicionCelda(r, c, seleccionarTodo = false) {
    editingCell = { r, c };
    const inp = editorDocumento?.querySelector(`input.excel-input[data-r="${r}"][data-c="${c}"]`);
    if (!inp || inp.readOnly) return;
    inp.classList.add("editing");
    inp.focus();
    if (seleccionarTodo) inp.select();
    else {
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }
  }

  function salirModoEdicionCelda() {
    if (!editingCell || !editorDocumento) return;
    const inp = editorDocumento.querySelector(`input.excel-input.editing`);
    if (inp) inp.classList.remove("editing");
    editingCell = null;
  }

  function renderExcelGrid() {
    if (!editorDocumento || editorVentana?.closed) return;
    const container = editorDocumento.getElementById("excelSheetContainer");
    if (!container) return;
    container.replaceChildren();
    editingCell = null;

    editorDocumento.querySelectorAll(".sheet-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.sheet === activeSheet);
    });

    if (activeSheet === "MASIVO") {
      renderHojaMasiva(container);
      pintarRecuadroSeleccion();
      return;
    }

    const config = DEFINICION_HOJAS[activeSheet];
    const datos = activeSheet === "RECORRIDO" ? sheetRecorrido : sheetAperturas;

    const minFilas = activeSheet === "RECORRIDO" ? 30 : 22;
    while (datos.length < minFilas) {
      if (activeSheet === "RECORRIDO") {
        datos.push({
          numero: String(datos.length + 1), supervisor: "", subestacion: "",
          latitud: "", longitud: "", ap1: "", ap2: "", ap3: "", ap4: "",
          nDesc: "", nAperturas: "", fecha: ""
        });
      } else {
        datos.push({ codigo: "", latitud: "", longitud: "" });
      }
    }

    const table = editorDocumento.createElement("table");
    table.className = "excel-table";

    const thead = editorDocumento.createElement("thead");
    const trLetters = editorDocumento.createElement("tr");
    trLetters.className = "excel-col-letters";
    const thCorner = editorDocumento.createElement("th");
    thCorner.className = "excel-row-num corner";
    thCorner.textContent = "◢";
    thCorner.onclick = () => {
      selStart = { r: 0, c: 0 };
      selEnd = { r: datos.length - 1, c: config.columnas.length - 1 };
      pintarRecuadroSeleccion();
    };
    trLetters.appendChild(thCorner);

    config.columnas.forEach((col, cIdx) => {
      const th = editorDocumento.createElement("th");
      th.style.width = col.width;
      th.dataset.col = String(cIdx);
      th.textContent = config.letras[cIdx] || String.fromCharCode(65 + cIdx);
      th.onclick = (ev) => {
        if (ev.shiftKey) selEnd = { r: datos.length - 1, c: cIdx };
        else { selStart = { r: 0, c: cIdx }; selEnd = { r: datos.length - 1, c: cIdx }; }
        pintarRecuadroSeleccion();
      };
      trLetters.appendChild(th);
    });
    const thMapLetter = editorDocumento.createElement("th");
    thMapLetter.style.width = "46px";
    thMapLetter.textContent = config.letras[config.columnas.length] || "";
    trLetters.appendChild(thMapLetter);
    thead.appendChild(trLetters);

    const trHeader = editorDocumento.createElement("tr");
    trHeader.className = "excel-dark-header";
    const thRow1 = editorDocumento.createElement("th");
    thRow1.className = "excel-row-num";
    thRow1.textContent = "1";
    trHeader.appendChild(thRow1);

    config.columnas.forEach(col => {
      const th = editorDocumento.createElement("th");
      th.innerHTML = `<div class="hdr-flex"><span>${col.title}</span><span class="filter-icon">⏷</span></div>`;
      trHeader.appendChild(th);
    });
    const thAction = editorDocumento.createElement("th");
    thAction.innerHTML = `<div class="hdr-flex"><span>Mapa</span></div>`;
    trHeader.appendChild(thAction);
    thead.appendChild(trHeader);
    table.appendChild(thead);

    const tbody = editorDocumento.createElement("tbody");
    const q = filtroTexto.trim().toLowerCase();

    datos.forEach((fila, rIdx) => {
      if (q && !Object.values(fila).join(" ").toLowerCase().includes(q)) return;

      const tr = editorDocumento.createElement("tr");
      const tdNum = editorDocumento.createElement("td");
      tdNum.className = "excel-row-num";
      tdNum.dataset.row = String(rIdx);
      tdNum.textContent = String(rIdx + 2);
      tdNum.onclick = (ev) => {
        if (ev.shiftKey) selEnd = { r: rIdx, c: config.columnas.length - 1 };
        else { selStart = { r: rIdx, c: 0 }; selEnd = { r: rIdx, c: config.columnas.length - 1 }; }
        pintarRecuadroSeleccion();
      };
      tr.appendChild(tdNum);

      config.columnas.forEach((col, cIdx) => {
        const td = editorDocumento.createElement("td");
        td.className = "excel-cell";
        td.dataset.r = String(rIdx);
        td.dataset.c = String(cIdx);
        if (col.style === "supervisor" && String(fila[col.key] || "").trim()) {
          td.classList.add("cell-supervisor");
        }

        const input = editorDocumento.createElement("input");
        input.type = "text";
        input.className = "excel-input";
        input.style.textAlign = col.align || "left";
        input.readOnly = Boolean(col.readonly);
        input.value = fila[col.key] ?? "";
        input.dataset.r = String(rIdx);
        input.dataset.c = String(cIdx);
        input.dataset.key = col.key;

        input.addEventListener("input", () => {
          escribirValorCelda(rIdx, cIdx, input.value);
        });
        input.addEventListener("change", () => {
          sincronizarHaciaMapa(false);
        });

        const handle = editorDocumento.createElement("div");
        handle.className = "fill-handle";
        handle.title = "Arrastrar para rellenar celdas";
        handle.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          salirModoEdicionCelda();
          isFilling = true;
        });

        td.appendChild(input);
        td.appendChild(handle);
        tr.appendChild(td);
      });

      const tdGo = editorDocumento.createElement("td");
      tdGo.className = "excel-cell-action";
      const btnGo = editorDocumento.createElement("button");
      btnGo.type = "button";
      btnGo.className = "btn-map-pin";
      btnGo.textContent = "📍";
      btnGo.title = "Centrar este código en el mapa";
      btnGo.onclick = () => {
        sincronizarHaciaMapa(false);
        const codeBuscado = String(activeSheet === "RECORRIDO" ? fila.subestacion : fila.codigo).trim();
        if (!codeBuscado) return;
        const idxMapa = puntos.findIndex(f => puntoCodigo(f).toUpperCase() === codeBuscado.toUpperCase());
        if (idxMapa >= 0) { navegar(idxMapa); w.focus(); }
      };
      tdGo.appendChild(btnGo);
      tr.appendChild(tdGo);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
    pintarRecuadroSeleccion();
  }

  function renderHojaMasiva(container) {
    const table = editorDocumento.createElement("table");
    table.className = "excel-table masivo-table";

    const thead = editorDocumento.createElement("thead");
    const trLetters = editorDocumento.createElement("tr");
    trLetters.className = "excel-col-letters";
    ["◢", "A", "B", "C", "D"].forEach((L, idx) => {
      const th = editorDocumento.createElement("th");
      if (idx === 0) th.className = "excel-row-num corner";
      else th.dataset.col = String(idx - 1);
      th.style.width = idx === 0 ? "38px" : idx === 1 ? "250px" : idx === 2 ? "125px" : idx === 3 ? "135px" : "180px";
      th.textContent = L;
      trLetters.appendChild(th);
    });
    thead.appendChild(trLetters);
    table.appendChild(thead);

    const tbody = editorDocumento.createElement("tbody");

    const tr1 = editorDocumento.createElement("tr");
    tr1.innerHTML = `<td class="excel-row-num">1</td>`;

    const tdBlueLeft = editorDocumento.createElement("td");
    tdBlueLeft.className = "masivo-blue-header";
    tdBlueLeft.textContent = "Ingresar cods. zona desconectada";
    tr1.appendChild(tdBlueLeft);

    const tdZone = editorDocumento.createElement("td");
    tdZone.className = "excel-cell";
    const inpZone = editorDocumento.createElement("input");
    inpZone.type = "text";
    inpZone.className = "excel-input editing";
    inpZone.style.fontWeight = "bold";
    inpZone.value = "-->D" + extraerNumeroDesc(sheetMasivo.zona || "D1");
    inpZone.addEventListener("input", () => {
      sheetMasivo.zona = inpZone.value.replace(/^-->\s*/i, "").trim() || "D1";
    });
    tdZone.appendChild(inpZone);
    tr1.appendChild(tdZone);

    const tdSupLabel = editorDocumento.createElement("td");
    tdSupLabel.className = "excel-cell";
    tdSupLabel.style.textAlign = "right";
    tdSupLabel.style.paddingRight = "6px";
    tdSupLabel.style.fontWeight = "bold";
    tdSupLabel.textContent = "Supervisor:";
    tr1.appendChild(tdSupLabel);

    const tdSup = editorDocumento.createElement("td");
    tdSup.className = "excel-cell cell-supervisor";
    const inpSup = editorDocumento.createElement("input");
    inpSup.type = "text";
    inpSup.className = "excel-input editing";
    inpSup.value = sheetMasivo.supervisor || "";
    inpSup.addEventListener("input", () => { sheetMasivo.supervisor = inpSup.value; });
    tdSup.appendChild(inpSup);
    tr1.appendChild(tdSup);
    tbody.appendChild(tr1);

    sheetMasivo.filas.forEach((par, rIdx) => {
      const rowNumber = rIdx + 2;
      const tr = editorDocumento.createElement("tr");

      const tdN = editorDocumento.createElement("td");
      tdN.className = "excel-row-num";
      tdN.dataset.row = String(rIdx);
      tdN.textContent = String(rowNumber);
      tr.appendChild(tdN);

      const tdSub = editorDocumento.createElement("td");
      tdSub.className = "excel-cell";
      tdSub.dataset.r = String(rIdx);
      tdSub.dataset.c = "0";
      const inpSub = editorDocumento.createElement("input");
      inpSub.type = "text";
      inpSub.className = "excel-input";
      inpSub.value = par.subestacion || "";
      inpSub.dataset.r = String(rIdx);
      inpSub.dataset.c = "0";
      inpSub.addEventListener("input", () => { par.subestacion = inpSub.value; });
      const handleA = editorDocumento.createElement("div");
      handleA.className = "fill-handle";
      tdSub.appendChild(inpSub);
      tdSub.appendChild(handleA);
      tr.appendChild(tdSub);

      const tdSep = editorDocumento.createElement("td");
      tdSep.className = "excel-cell";
      tdSep.dataset.r = String(rIdx);
      tdSep.dataset.c = "1";
      tr.appendChild(tdSep);

      const tdArrow = editorDocumento.createElement("td");
      tdArrow.className = "excel-cell";
      tdArrow.style.textAlign = "center";
      if (rowNumber === 6) {
        const btnRun = editorDocumento.createElement("button");
        btnRun.type = "button";
        btnRun.className = "btn-masivo-arrow";
        btnRun.textContent = "---> Asociar";
        btnRun.onclick = ejecutarAsociacionMasiva;
        tdArrow.appendChild(btnRun);
      } else if (rowNumber === 8) {
        const btnClear = editorDocumento.createElement("button");
        btnClear.type = "button";
        btnClear.className = "btn-masivo-clear";
        btnClear.textContent = "Limpiar listas";
        btnClear.onclick = () => {
          sheetMasivo.filas.forEach(f => { f.subestacion = ""; f.apertura = ""; });
          renderExcelGrid();
        };
        tdArrow.appendChild(btnClear);
      }
      tr.appendChild(tdArrow);

      if (rowNumber === 2) {
        const tdBlueRight = editorDocumento.createElement("td");
        tdBlueRight.className = "masivo-blue-header";
        tdBlueRight.style.textAlign = "center";
        tdBlueRight.textContent = "COD apertura";
        tr.appendChild(tdBlueRight);
      } else {
        const apIndex = rIdx - 1;
        const tdAp = editorDocumento.createElement("td");
        tdAp.className = "excel-cell";
        tdAp.dataset.r = String(rIdx);
        tdAp.dataset.c = "3";
        const inpAp = editorDocumento.createElement("input");
        inpAp.type = "text";
        inpAp.className = "excel-input";
        inpAp.style.textAlign = "center";
        inpAp.value = sheetMasivo.filas[apIndex]?.apertura || "";
        inpAp.dataset.r = String(rIdx);
        inpAp.dataset.c = "3";
        inpAp.addEventListener("input", () => {
          if (sheetMasivo.filas[apIndex]) sheetMasivo.filas[apIndex].apertura = inpAp.value;
        });
        const handleD = editorDocumento.createElement("div");
        handleD.className = "fill-handle";
        tdAp.appendChild(inpAp);
        tdAp.appendChild(handleD);
        tr.appendChild(tdAp);
      }

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function copiarRangoSeleccionado(ev) {
    if (editingCell) return;
    const { minR, maxR, minC, maxC } = rangoNormalizado();
    const filasTexto = [];

    editorDocumento?.querySelectorAll("td.excel-cell.copied-cell").forEach(el => el.classList.remove("copied-cell"));

    for (let r = minR; r <= maxR; r++) {
      const filaArr = [];
      for (let c = minC; c <= maxC; c++) {
        filaArr.push(leerValorCelda(r, c));
        editorDocumento?.querySelector(`td.excel-cell[data-r="${r}"][data-c="${c}"]`)?.classList.add("copied-cell");
      }
      filasTexto.push(filaArr.join("\t"));
    }

    const textoPlano = filasTexto.join("\r\n");
    if (ev?.clipboardData) {
      ev.preventDefault();
      ev.clipboardData.setData("text/plain", textoPlano);
    } else {
      editorVentana?.navigator?.clipboard?.writeText?.(textoPlano).catch(() => {});
    }
    setExcelStatus(`Copiado rango de ${maxR - minR + 1} fila(s) × ${maxC - minC + 1} columna(s).`);
  }

  function manejarPegadoExcel(ev) {
    const clip = ev.clipboardData?.getData("text/plain");
    if (!clip) return;
    if (editingCell && !clip.includes("\n") && !clip.includes("\t")) return;

    ev.preventDefault();
    salirModoEdicionCelda();

    const matrix = window.__centralityGridEngine.parseClipboardMatrix(clip);

    const { minR, maxR, minC, maxC } = rangoNormalizado();
    const selH = maxR - minR + 1;
    const selW = maxC - minC + 1;

    const targetRows = (matrix.length === 1 && selH > 1) ? selH : matrix.length;
    const targetCols = (matrix[0].length === 1 && selW > 1) ? selW : matrix[0].length;

    const totalExistentes = activeSheet === "MASIVO"
      ? sheetMasivo.filas.length
      : (activeSheet === "RECORRIDO" ? sheetRecorrido.length : sheetAperturas.length);
    const necesitaMasFilas = (minR + targetRows) > totalExistentes;

    for (let rOff = 0; rOff < targetRows; rOff++) {
      const srcRow = matrix[rOff % matrix.length];
      for (let cOff = 0; cOff < targetCols; cOff++) {
        const val = srcRow[cOff % srcRow.length];
        escribirValorCelda(minR + rOff, minC + cOff, val);
      }
    }

    selStart = { r: minR, c: minC };
    selEnd = { r: minR + targetRows - 1, c: minC + targetCols - 1 };

    if (necesitaMasFilas) renderExcelGrid();
    else pintarRecuadroSeleccion();

    if (activeSheet !== "MASIVO") sincronizarHaciaMapa(false);
    setExcelStatus(`Pegadas ${targetRows} fila(s) × ${targetCols} columna(s).`);
  }

  function borrarRangoSeleccionado() {
    const { minR, maxR, minC, maxC } = rangoNormalizado();
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        escribirValorCelda(r, c, "");
      }
    }
    pintarRecuadroSeleccion();
    if (activeSheet !== "MASIVO") sincronizarHaciaMapa(false);
    setExcelStatus("Vaciadas celdas del rango seleccionado.");
  }

  function exportarExcelCSV() {
    const q = v => {
      const s = String(v ?? "");
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    if (activeSheet === "APERTURAS") {
      const headers = ["Código", "Latitud", "Longitud"];
      const rows = sheetAperturas
        .filter(a => String(a.codigo || "").trim())
        .map(a => [a.codigo, fmtComma(a.latitud), fmtComma(a.longitud)]);
      const csv = [headers.join(";"), ...rows.map(r => r.map(q).join(";"))].join("\r\n");
      descargarTexto("catalogo_aperturas.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
    } else {
      const headers = [
        "N°", "Supervisor", "Subestación", "Latitud", "Longitud",
        "Apertura 1", "Apertura 2", "Apertura 3", "Apertura 4",
        "N° DESC", "N° Aperturas", "Fecha planificación"
      ];
      const rows = sheetRecorrido
        .filter(r => String(r.subestacion || r.latitud || r.longitud || "").trim())
        .map(r => [
          r.numero, r.supervisor, r.subestacion, fmtComma(r.latitud), fmtComma(r.longitud),
          r.ap1, r.ap2, r.ap3, r.ap4, r.nDesc, contarAperturasFila(r), r.fecha
        ]);
      const csv = [headers.join(";"), ...rows.map(r => r.map(q).join(";"))].join("\r\n");
      descargarTexto("planilla_recorrido.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
    }
  }

  // Si se carga un proyecto JSON o un KMZ estando la ventana Excel abierta, refrescar automáticamente
  archivoProyecto.addEventListener("change", () => {
    w.setTimeout(() => {
      if (editorVentana && !editorVentana.closed) {
        sincronizarDesdeMapa();
        renderExcelGrid();
        setExcelStatus("Proyecto JSON cargado: códigos de apertura y N° DESC traducidos automáticamente.");
      }
    }, 250);
  });

  function abrirEditorExcel() {
    if (editorVentana && !editorVentana.closed) {
      editorVentana.focus();
      return;
    }
    try {
      sincronizarDesdeMapa();
    } catch (err) {
      return mensaje("No se pudo abrir la planilla Excel: " + err.message, true);
    }

    editorVentana = window.open("", "centrality-excel-v9", "width=1480,height=860,resizable=yes,scrollbars=yes");
    if (!editorVentana) {
      return mensaje("Chrome bloqueó la ventana emergente. Permite popups para este sitio.", true);
    }

    editorDocumento = editorVentana.document;
    editorDocumento.open();
    editorDocumento.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Planilla de Desconexiones · GNAT Excel</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 12px Calibri, "Segoe UI", Arial, sans-serif;
    background: #ffffff;
    color: #111827;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    user-select: none;
  }
  .excel-ribbon {
    background: #107c41;
    color: #fff;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .excel-ribbon-left { display: flex; align-items: center; gap: 8px; }
  .excel-title { font-weight: 700; font-size: 14px; margin-right: 10px; }
  .ribbon-btn {
    background: rgba(255,255,255,0.14);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 3px;
    padding: 4px 10px;
    font: 12px "Segoe UI", Arial, sans-serif;
    cursor: pointer;
  }
  .ribbon-btn:hover { background: rgba(255,255,255,0.26); }
  .ribbon-btn.primary { background: #ffffff; color: #107c41; font-weight: 700; }
  .excel-formula-bar {
    display: flex;
    align-items: center;
    background: #f3f2f1;
    border-bottom: 1px solid #d2d0ce;
    padding: 3px 8px;
    gap: 6px;
  }
  #excelNameBox {
    min-width: 72px;
    background: #fff;
    border: 1px solid #c8c6c4;
    padding: 2px 6px;
    text-align: center;
    font-weight: 600;
    color: #323130;
  }
  .fx-symbol {
    font-family: Georgia, serif;
    font-style: italic;
    font-weight: bold;
    color: #605e5c;
    padding: 0 6px;
  }
  #excelFxInput {
    flex: 1;
    border: 1px solid #c8c6c4;
    padding: 3px 8px;
    font: 12px Consolas, monospace;
    background: #fff;
    user-select: text;
  }
  #excelSearch {
    width: 210px;
    border: 1px solid #c8c6c4;
    padding: 3px 8px;
    background: #fff;
    user-select: text;
  }
  #excelSheetContainer {
    flex: 1;
    overflow: auto;
    background: #fff;
    outline: none;
  }
  .excel-table {
    border-collapse: collapse;
    table-layout: fixed;
    width: max-content;
    min-width: 100%;
    cursor: cell;
  }
  .excel-col-letters th {
    position: sticky;
    top: 0;
    z-index: 4;
    background: #e8f5e9;
    color: #1f2937;
    font-weight: 600;
    font-size: 11px;
    height: 22px;
    border: 1px solid #b6c4b8;
    text-align: center;
    cursor: pointer;
  }
  .excel-col-letters th.hdr-active,
  .excel-row-num.hdr-active {
    background: #bbdefb !important;
    color: #0d47a1 !important;
    font-weight: 700;
  }
  .excel-dark-header th {
    position: sticky;
    top: 22px;
    z-index: 3;
    background: #10253f;
    color: #ffffff;
    font-weight: 700;
    font-size: 12px;
    height: 30px;
    padding: 2px 6px;
    border: 1px solid #2c4360;
    white-space: nowrap;
  }
  .hdr-flex { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .filter-icon { font-size: 10px; color: #93c5fd; opacity: 0.85; }
  .excel-row-num {
    position: sticky;
    left: 0;
    z-index: 2;
    width: 38px;
    background: #e8f5e9 !important;
    color: #374151 !important;
    font-weight: 600;
    font-size: 11px;
    text-align: center;
    border: 1px solid #b6c4b8;
    cursor: pointer;
  }
  .excel-row-num.corner { z-index: 5; color: #6b7280 !important; }
  .excel-cell {
    border: 1px solid #d4d4d4;
    padding: 0;
    height: 23px;
    background: #ffffff;
    position: relative;
  }
  .excel-cell.cell-supervisor { background: #f9d8b6; }
  .excel-cell.cell-supervisor .excel-input { color: #b45309; font-weight: 600; }

  .excel-cell.sel-in { background-color: rgba(26, 115, 232, 0.14) !important; }
  .excel-cell.sel-anchor { background-color: #ffffff !important; }
  .excel-cell.cell-supervisor.sel-anchor { background-color: #fde6cc !important; }
  .excel-cell.sel-top { border-top: 2px solid #1a73e8 !important; }
  .excel-cell.sel-bottom { border-bottom: 2px solid #1a73e8 !important; }
  .excel-cell.sel-left { border-left: 2px solid #1a73e8 !important; }
  .excel-cell.sel-right { border-right: 2px solid #1a73e8 !important; }

  .excel-cell.copied-cell {
    outline: 1.5px dashed #107c41;
    outline-offset: -2px;
  }

  .fill-handle {
    display: none;
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 7px;
    height: 7px;
    background: #1a73e8;
    border: 1px solid #ffffff;
    cursor: crosshair;
    z-index: 6;
  }
  .excel-cell.sel-handle .fill-handle { display: block; }

  .excel-input {
    width: 100%;
    height: 100%;
    border: none;
    outline: none;
    padding: 2px 5px;
    font: 12px Calibri, "Segoe UI", Arial, sans-serif;
    background: transparent;
    color: #111827;
    pointer-events: none;
  }
  .excel-input.editing {
    pointer-events: auto;
    background: #ffffff;
    cursor: text;
    user-select: text;
  }

  .excel-cell-action {
    border: 1px solid #d4d4d4;
    text-align: center;
    padding: 0;
    background: #f9fafb;
  }
  .btn-map-pin {
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    width: 100%;
    height: 22px;
  }
  .btn-map-pin:hover { background: #e0f2fe; }
  .masivo-blue-header {
    background: #2f75b5;
    color: #000000;
    font-weight: 600;
    padding: 3px 6px;
    border: 1px solid #1e4e79;
    height: 24px;
  }
  .btn-masivo-arrow {
    background: #10253f;
    color: #fff;
    font-weight: bold;
    border: 1px solid #0a192f;
    border-radius: 3px;
    padding: 2px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn-masivo-arrow:hover { background: #1e3a8a; }
  .btn-masivo-clear {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .excel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f3f2f1;
    border-top: 1px solid #c8c6c4;
    height: 30px;
    padding: 0 10px;
  }
  .sheet-tabs { display: flex; align-items: flex-end; height: 100%; gap: 2px; }
  .sheet-tab {
    background: #e1dfdd;
    border: 1px solid #c8c6c4;
    border-top: none;
    padding: 5px 14px;
    font: 12px "Segoe UI", Arial, sans-serif;
    cursor: pointer;
    color: #323130;
  }
  .sheet-tab.active {
    background: #ffffff;
    color: #107c41;
    font-weight: 700;
    border-bottom: 3px solid #107c41;
  }
  #excelStatus {
    font-size: 11px;
    color: #1e3a5f;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
  <div class="excel-ribbon">
    <div class="excel-ribbon-left">
      <span class="excel-title">📊 Centrality · Libro de Desconexiones</span>
      <button type="button" class="ribbon-btn primary" id="btnSyncMap">Aplicar y Sincronizar Mapa</button>
      <button type="button" class="ribbon-btn" id="btnAddRows">+ 15 Filas</button>
      <button type="button" class="ribbon-btn" id="btnExportCSV">Exportar Hoja CSV</button>
      <button type="button" class="ribbon-btn" id="btnSaveJSON">Guardar JSON Limpio</button>
      <button type="button" class="ribbon-btn" id="btnLoadJSON">Abrir JSON</button>
    </div>
    <div>
      <button type="button" class="ribbon-btn" id="btnReloadFromMap">Recargar desde Mapa</button>
    </div>
  </div>

  <div class="excel-formula-bar">
    <div id="excelNameBox">A2</div>
    <span class="fx-symbol">fx</span>
    <input type="text" id="excelFxInput" placeholder="Selecciona un rango arrastrando el mouse, o edita aquí...">
    <input type="search" id="excelSearch" placeholder="Filtrar código o supervisor...">
  </div>

  <div id="excelSheetContainer" tabindex="0"></div>

  <div class="excel-footer">
    <div class="sheet-tabs">
      <button type="button" class="sheet-tab active" data-sheet="RECORRIDO">Planilla Recorrido</button>
      <button type="button" class="sheet-tab" data-sheet="MASIVO">Ingreso Masivo (Zonas -->D1)</button>
      <button type="button" class="sheet-tab" data-sheet="APERTURAS">Catálogo Aperturas</button>
    </div>
    <div id="excelStatus">Códigos de apertura y N° DESC sincronizados. Arrastra para seleccionar rango · Ctrl+C / Ctrl+V / Supr.</div>
  </div>
</body>
</html>`);
    editorDocumento.close();

    const container = editorDocumento.getElementById("excelSheetContainer");
    const fxInput = editorDocumento.getElementById("excelFxInput");

    fxInput.addEventListener("input", () => {
      if (fxInput.value.startsWith("=HIPERVINCULO")) return;
      escribirValorCelda(selStart.r, selStart.c, fxInput.value);
    });
    fxInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        sincronizarHaciaMapa(false);
        container.focus();
      }
    });

    container.addEventListener("mousedown", (ev) => {
      const td = ev.target.closest("td.excel-cell[data-r][data-c]");
      if (!td) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);

      if (editingCell && editingCell.r === r && editingCell.c === c) return;

      ev.preventDefault();
      salirModoEdicionCelda();
      container.focus();

      if (ev.shiftKey) {
        selEnd = { r, c };
      } else {
        selStart = { r, c };
        selEnd = { r, c };
      }
      isSelecting = true;
      pintarRecuadroSeleccion();
    });

    container.addEventListener("mouseover", (ev) => {
      if (!isSelecting && !isFilling) return;
      const td = ev.target.closest("td.excel-cell[data-r][data-c]");
      if (!td) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      if (selEnd.r !== r || selEnd.c !== c) {
        selEnd = { r, c };
        pintarRecuadroSeleccion();
      }
    });

    editorDocumento.addEventListener("mouseup", () => {
      if (isFilling) {
        isFilling = false;
        const baseVal = leerValorCelda(selStart.r, selStart.c);
        const { minR, maxR, minC, maxC } = rangoNormalizado();
        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            escribirValorCelda(r, c, baseVal);
          }
        }
        pintarRecuadroSeleccion();
        if (activeSheet !== "MASIVO") sincronizarHaciaMapa(false);
      }
      isSelecting = false;
    });

    container.addEventListener("dblclick", (ev) => {
      const td = ev.target.closest("td.excel-cell[data-r][data-c]");
      if (!td) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      const colCfg = DEFINICION_HOJAS[activeSheet]?.columnas?.[c];
      const val = String(leerValorCelda(r, c) || "").trim();

      if (colCfg?.isLink && val && ev.ctrlKey) {
        const apIdx = sheetAperturas.findIndex(a => String(a.codigo || "").trim().toUpperCase() === val.toUpperCase());
        if (apIdx >= 0) {
          activeSheet = "APERTURAS";
          selStart = { r: apIdx, c: 0 };
          selEnd = { r: apIdx, c: 0 };
          renderExcelGrid();
          return;
        }
      }
      activarModoEdicionCelda(r, c, false);
    });

    editorDocumento.addEventListener("keydown", (ev) => {
      const tag = ev.target?.tagName;
      if (ev.target?.id === "excelSearch" || ev.target?.id === "excelFxInput") return;

      if (editingCell) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          salirModoEdicionCelda();
          container.focus();
          pintarRecuadroSeleccion();
        } else if (ev.key === "Enter" || ev.key === "Tab") {
          ev.preventDefault();
          const { r, c } = editingCell;
          salirModoEdicionCelda();
          sincronizarHaciaMapa(false);
          if (ev.key === "Enter") selStart = selEnd = { r: r + 1, c };
          else selStart = selEnd = { r, c: c + (ev.shiftKey ? -1 : 1) };
          container.focus();
          pintarRecuadroSeleccion();
        }
        return;
      }

      if (tag === "INPUT" && ev.target.classList.contains("editing")) return;

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        const maxRows = activeSheet === "MASIVO" ? sheetMasivo.filas.length - 1 :
          (activeSheet === "RECORRIDO" ? sheetRecorrido.length - 1 : sheetAperturas.length - 1);
        const maxCols = activeSheet === "MASIVO" ? 3 : DEFINICION_HOJAS[activeSheet].columnas.length - 1;
        selStart = { r: 0, c: 0 };
        selEnd = { r: maxRows, c: maxCols };
        pintarRecuadroSeleccion();
        return;
      }

      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        borrarRangoSeleccionado();
        return;
      }

      if (ev.key === "F2") {
        ev.preventDefault();
        activarModoEdicionCelda(selStart.r, selStart.c, false);
        return;
      }

      if (ev.key === "Enter") {
        ev.preventDefault();
        selStart = selEnd = { r: selStart.r + (ev.shiftKey ? -1 : 1), c: selStart.c };
        pintarRecuadroSeleccion();
        return;
      }

      if (ev.key === "Tab") {
        ev.preventDefault();
        selStart = selEnd = { r: selStart.r, c: Math.max(0, selStart.c + (ev.shiftKey ? -1 : 1)) };
        pintarRecuadroSeleccion();
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) {
        ev.preventDefault();
        const dR = ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : 0;
        const dC = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
        if (ev.shiftKey) {
          selEnd = { r: Math.max(0, selEnd.r + dR), c: Math.max(0, selEnd.c + dC) };
        } else {
          const next = { r: Math.max(0, selStart.r + dR), c: Math.max(0, selStart.c + dC) };
          selStart = next;
          selEnd = next;
        }
        pintarRecuadroSeleccion();
        const activeTd = editorDocumento.querySelector(`td.excel-cell[data-r="${selEnd.r}"][data-c="${selEnd.c}"]`);
        activeTd?.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }

      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        escribirValorCelda(selStart.r, selStart.c, "");
        activarModoEdicionCelda(selStart.r, selStart.c, false);
      }
    });

    editorDocumento.addEventListener("copy", copiarRangoSeleccionado);
    editorDocumento.addEventListener("paste", manejarPegadoExcel);

    editorDocumento.querySelectorAll(".sheet-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        activeSheet = btn.dataset.sheet;
        selStart = { r: 0, c: 0 };
        selEnd = { r: 0, c: 0 };
        renderExcelGrid();
        container.focus();
      });
    });

    editorDocumento.getElementById("btnSyncMap").onclick = () => sincronizarHaciaMapa(true);
    editorDocumento.getElementById("btnAddRows").onclick = () => {
      if (activeSheet === "RECORRIDO") {
        for (let i = 0; i < 15; i++) {
          sheetRecorrido.push({
            numero: String(sheetRecorrido.length + 1), supervisor: "", subestacion: "",
            latitud: "", longitud: "", ap1: "", ap2: "", ap3: "", ap4: "",
            nDesc: "", nAperturas: "", fecha: ""
          });
        }
      } else if (activeSheet === "APERTURAS") {
        for (let i = 0; i < 15; i++) sheetAperturas.push({ codigo: "", latitud: "", longitud: "" });
      } else {
        for (let i = 0; i < 15; i++) sheetMasivo.filas.push({ subestacion: "", apertura: "" });
      }
      renderExcelGrid();
    };
    editorDocumento.getElementById("btnExportCSV").onclick = exportarExcelCSV;
    editorDocumento.getElementById("btnSaveJSON").onclick = () => {
      if (sincronizarHaciaMapa(false)) guardarProyectoBtn.click();
    };
    editorDocumento.getElementById("btnLoadJSON").onclick = () => abrirProyectoBtn.click();
    editorDocumento.getElementById("btnReloadFromMap").onclick = () => {
      excelBorrador=null;
      sincronizarDesdeMapa();
      renderExcelGrid();
      setExcelStatus("Datos recargados desde el mapa; borrador anterior descartado.");
    };

    const searchInput = editorDocumento.getElementById("excelSearch");
    searchInput.addEventListener("input", () => {
      filtroTexto = searchInput.value;
      renderExcelGrid();
    });

    renderExcelGrid();
    container.focus();
    if (!oculto) ocultar.click();
    editorVentana.focus();
  }

  return {
    abrir:abrirEditorExcel,
    abierta:()=>Boolean(editorVentana&&!editorVentana.closed),
    cerrar:()=>{if(editorVentana&&!editorVentana.closed){guardarBorradorExcel();editorVentana.close();}},
    capturar:()=>{if(editorVentana&&!editorVentana.closed)guardarBorradorExcel();}
  };
  }

  const excelAvanzado=construirEditorExcel();
  const abrirExcelBtn=btn(titulo,'Excel ↗','padding:5px 8px;font-weight:bold;background:#e9f3ff;');
  abrirExcelBtn.title='Planilla avanzada: selección de rangos, pegado masivo y hoja de aperturas';
  abrirPlanillaBtn.textContent='Zonas ↗';
  abrirPlanillaBtn.title='Administrar zonas, responsables, aperturas y tipos de equipo';
  // Two editors must not overwrite one another's changes.
  abrirExcelBtn.onclick=()=>{
    if(editorVentana&&!editorVentana.closed) {
      if(!editorAplicar(true))return mensaje('Corrige cambios pendientes de Zonas antes de abrir Excel.',true);
      editorVentana.close();
    }
    excelAvanzado.abrir();
  };
  abrirPlanillaBtn.addEventListener('click',(event)=>{
    if(excelAvanzado.abierta()){
      event.stopImmediatePropagation();
      excelAvanzado.cerrar();
      mensaje('Borrador de Excel conservado. Guarda proyecto JSON antes de cambiar de editor.');
      // Restore the zone editor on the next click; never silently overwrite sheet edits.
    }
  },true);

  w.__superponerKMZ = { cerrar: cerrarPanel, getPuntos: () => puntos.slice(),
    getCapa: () => capa, getBloques: () => [...definicionesBloques].map(([id,nombre],i)=>({id,nombre,color:coloresBloques.get(id)||colorBloqueDefault(i),responsable:responsablesBloques.get(id)||''})),
    getPreferencias: () => ({colores:{...COLORES},visibles:[...visiblesSupervisores]}), abrirPlanilla: abrirEditorV8 };
  if (anteriores.length) {
    puntos = anteriores.map(a => new ol.Feature({
      geometry: new ol.geom.Point(a.xy),
      codigo: a.codigo,
      numero: a.numero,
      id: a.id, tipo: a.tipo || "PUNTO", bloqueId: a.bloqueId || "", bloques: a.bloques || [], aperturasIds:a.aperturasIds||[],
      colorPersonalizado:a.colorPersonalizado||'',tipoEquipo:a.tipoEquipo||'',
      supervisorNombre:a.supervisorNombre||'',fechaPlanificacion:a.fechaPlanificacion||'',
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
    console.log('Centrality V9.3 listo: abre la planilla o un proyecto JSON.');
  }
  // Automatic local recovery is separate from the manual JSON export.
  // MAIN-world script cannot access chrome.storage.local; the ISOLATED bridge owns it.
  autosave = window.__centralityAutosave.createAutosave({
    win: window, build: construirProyectoActual,
    captureDraft: () => excelAvanzado.capturar(),
    onStatus: (text, error) => estadoAutosaveTexto(text, error),
    onSaved: envelope => {
      respaldoDisponible = envelope;
      recuperarAutoBtn.disabled = false;
    }
  });
  void autosave.read().then(snapshot => {
    if (!abierto) return;
    respaldoDisponible = snapshot;
    recuperarAutoBtn.disabled = !snapshot;
    estadoAutosaveTexto(snapshot
      ? 'Respaldo disponible: ' + new Date(snapshot.timestamp).toLocaleString('es-CL')
      : 'Autosave activo · sin respaldo previo');
  }).catch(err => estadoAutosaveTexto('Autosave no disponible: ' + err.message, true));

})();
