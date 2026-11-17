/*
 * Centrality Tools V1 — add-on panel for Centrality Local / GNAT Mapas.
 * Reads only existing in-memory OpenLayers vector features whose `tipo` is
 * PUNTO or APERTURA. It does not call GNAT endpoints or inspect credentials.
 */
(() => {
  "use strict";

  const ENGINE = window.CentralityToolsEngineV1;
  if (!ENGINE) {
    console.error("Centrality Tools: falta centrality_tools_core.js antes de este archivo.");
    return;
  }

  const frame = document.querySelector("iframe#content");
  if (!frame) {
    console.warn("Centrality Tools: abre primero Mapas de GNAT.");
    return;
  }

  let w;
  let doc;
  let map;
  let ol;
  try {
    w = frame.contentWindow;
    doc = frame.contentDocument || w.document;
    map = w.webMap_?.map;
    ol = w.ol;
  } catch (_) {
    console.warn("Centrality Tools: no se pudo acceder al mapa de GNAT.");
    return;
  }
  if (!map || !ol?.layer?.Vector || !ol?.source?.Vector || !ol?.Feature || !ol?.geom?.Point) {
    console.warn("Centrality Tools: el mapa OpenLayers todavía no está listo.");
    return;
  }

  if (w.__centralityToolsV1?.toggle) {
    w.__centralityToolsV1.toggle();
    return;
  }

  const TOOL_REGISTRY = Object.freeze([
    {
      id: "nearest-opening",
      label: "Apertura más cercana",
      description: "Ordena las aperturas del proyecto por distancia geométrica a un poste.",
      status: "ready",
      input: "PUNTO",
      relations: ["APERTURA"],
      fields: ["tipo", "tipoEquipo", "geometry", "aperturasIds"],
      filters: ["equipmentType", "radiusM"],
      source: "Centrality/OpenLayers vector layers"
    },
    {
      id: "inspect-object",
      label: "Explorar atributos",
      description: "Inspecciona los atributos locales de un poste o apertura.",
      status: "ready",
      input: "PUNTO|APERTURA",
      relations: [],
      fields: ["id", "codigo", "numero", "tipo", "tipoEquipo", "bloqueId", "bloques", "aperturasIds"],
      filters: [],
      source: "Centrality/OpenLayers vector layers"
    },
    {
      id: "dms-neighbors-phases",
      label: "Vecinos y fases DMS",
      description: "Requiere un adaptador de lectura autorizado y un contrato de datos verificado.",
      status: "planned",
      input: "GNAT object_id",
      relations: ["NeighborObservation", "PhaseBehaviorObservation"],
      fields: ["object_id", "section_id", "phase", "real", "normal"],
      filters: [],
      source: "No conectado"
    }
  ]);

  const host = doc.createElement("div");
  host.id = "centrality-tools-v1-host";
  host.style.cssText = "position:fixed;z-index:2147483000;top:76px;right:14px;pointer-events:auto;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `
    :host{all:initial;color-scheme:light}
    *{box-sizing:border-box}
    .launcher{border:1px solid #1e3a5f;background:#183653;color:#fff;border-radius:10px;padding:9px 12px;font:600 12px/1.2 system-ui,Arial;box-shadow:0 5px 18px #0f172a33;cursor:pointer}
    .panel{width:min(390px,calc(100vw - 28px));max-height:calc(100vh - 100px);display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#172b3d;border:1px solid #cbd5e1;border-radius:13px;box-shadow:0 12px 40px #0f172a44;font:13px/1.45 system-ui,Arial}
    .panel[hidden],.launcher[hidden]{display:none}
    .head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;background:#183653;color:#fff}
    .head strong{font-size:14px}.head small{display:block;color:#c6d4e2;font-size:10px;font-weight:500}
    .badge{font-size:10px;border:1px solid #94a3b8;border-radius:20px;padding:2px 7px;color:#dbeafe;white-space:nowrap}
    .body{padding:12px;overflow:auto;display:grid;gap:11px}
    .intro{margin:0;color:#526477;font-size:11px}
    label{display:grid;gap:4px;color:#34495e;font-weight:600;font-size:11px}
    select,input{width:100%;min-width:0;border:1px solid #cbd5e1;border-radius:7px;padding:8px;background:#fff;color:#172b3d;font:12px system-ui,Arial}
    button{border:1px solid #b8c5d3;background:#f8fafc;color:#183653;border-radius:7px;padding:7px 9px;font:600 11px system-ui,Arial;cursor:pointer}
    button.primary{background:#1d5f91;color:#fff;border-color:#1d5f91}
    button:disabled{opacity:.45;cursor:not-allowed}
    .row{display:flex;gap:7px;align-items:end}.row>*{flex:1}
    .status{padding:8px 9px;border-radius:7px;background:#eef4f8;color:#42566a;font-size:11px}
    .status.warn{background:#fff7e8;color:#824b08}.status.ok{background:#edf8f0;color:#17633a}
    .section{display:grid;gap:7px;border-top:1px solid #e2e8f0;padding-top:9px}
    .section h3{margin:0;font-size:12px;color:#1e3a5f}
    .result{display:grid;gap:6px}
    .item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px;border:1px solid #e2e8f0;border-radius:8px}
    .item strong{display:block;font-size:11px;overflow-wrap:anywhere}.item small{display:block;color:#64748b;font-size:10px}
    .distance{font-weight:700;font-variant-numeric:tabular-nums;color:#1d5f91;font-size:12px;white-space:nowrap}
    .tag{display:inline-block;margin-top:3px;font-size:9px;padding:1px 5px;border-radius:5px;background:#e9f1f8;color:#31536f}
    .tag.linked{background:#eaf7ed;color:#17633a}
    .empty{font-size:11px;color:#64748b;padding:9px;border:1px dashed #cbd5e1;border-radius:8px}
    .attrs{display:grid;grid-template-columns:112px minmax(0,1fr);gap:5px 8px;margin:0;font-size:11px}
    .attrs dt{color:#64748b}.attrs dd{margin:0;overflow-wrap:anywhere;color:#172b3d}
    .foot{padding:8px 12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:9px;background:#f8fafc}
    .btns{display:flex;gap:6px}.btns button{flex:1}
  `;
  shadow.appendChild(style);

  const launcher = doc.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.textContent = "Centrality · Herramientas";
  const panel = doc.createElement("section");
  panel.className = "panel";
  panel.hidden = false;
  panel.setAttribute("aria-label", "Herramientas de análisis Centrality");
  shadow.append(launcher, panel);

  const make = (tag, cls, text, parent) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  };
  const head = make("header", "head", null, panel);
  const headTitle = make("div", "", null, head);
  make("strong", "", "Centrality · Herramientas", headTitle);
  make("small", "", "Módulos sobre datos ya cargados en el mapa", headTitle);
  make("span", "badge", "LECTURA LOCAL", head);
  const body = make("div", "body", null, panel);
  make("p", "intro", "El motor comparte el mapa de Centrality y cada herramienta declara sus datos de entrada, relaciones y criterio. Esta versión no consulta endpoints de GNAT.", body);

  const toolLabel = make("label", "", "Herramienta", body);
  const toolSelect = make("select", "", null, toolLabel);
  for (const tool of TOOL_REGISTRY) {
    const option = make("option", "", tool.status === "planned" ? `${tool.label} · pendiente` : tool.label, toolSelect);
    option.value = tool.id;
    option.disabled = tool.status !== "ready";
  }
  const dataStatus = make("div", "status", "Leyendo capas vectoriales de Centrality…", body);

  const inputSection = make("section", "section", null, body);
  make("h3", "", "Objeto de partida", inputSection);
  const pointLabel = make("label", "", "Poste / punto de recorrido", inputSection);
  const pointSelect = make("select", "", null, pointLabel);
  const objectLabel = make("label", "", "Objeto para inspeccionar", inputSection);
  const objectSelect = make("select", "", null, objectLabel);
  const radiusRow = make("div", "row", null, inputSection);
  const radiusLabel = make("label", "", "Radio máximo (metros)", radiusRow);
  const radiusInput = make("input", "", null, radiusLabel);
  radiusInput.type = "number";
  radiusInput.min = "1";
  radiusInput.max = "100000";
  radiusInput.step = "10";
  radiusInput.value = "1000";
  const refreshButton = make("button", "", "Actualizar objetos", radiusRow);
  const equipmentLabel = make("label", "", "Tipo de apertura", inputSection);
  const equipmentSelect = make("select", "", null, equipmentLabel);
  const actions = make("div", "btns", null, inputSection);
  const runButton = make("button", "primary", "Buscar aperturas cercanas", actions);
  const inspectButton = make("button", "", "Explorar atributos", actions);

  const outputSection = make("section", "section", null, body);
  make("h3", "", "Resultado", outputSection);
  const output = make("div", "empty", "Selecciona un poste y ejecuta una herramienta.", outputSection);

  const plannedSection = make("section", "section", null, body);
  make("h3", "", "Otros módulos", plannedSection);
  const planned = make("div", "empty", "Vecinos DMS y comportamiento R/S/T están registrados como módulos pendientes. Se habilitarán cuando exista un adaptador de lectura autorizado y se verifique el contrato de esos campos.", plannedSection);

  make("div", "foot", "Distancia geométrica ≠ conexión eléctrica. Los vínculos aperturasIds son asociaciones de planificación, no prueba de terminales, aislamiento ni maniobra.", panel);

  let records = [];
  let lastOverlay = null;
  let visible = true;
  let disposed = false;

  function layerName(layer) {
    try { return ENGINE.cleanText(layer.get("title") || layer.get("name") || layer.get("id")) || "Capa vectorial"; }
    catch (_) { return "Capa vectorial"; }
  }

  function collectLayers(collection, result = []) {
    const layers = collection?.getArray?.() || [];
    for (const layer of layers) {
      if (typeof layer?.getLayers === "function") collectLayers(layer.getLayers(), result);
      else result.push(layer);
    }
    return result;
  }

  function toLonLat(coordinate) {
    const projection = map.getView?.().getProjection?.();
    if (!projection) throw new Error("No se pudo identificar la proyección del mapa.");
    if (ol.proj?.toLonLat) return ol.proj.toLonLat(coordinate, projection);
    if (ol.proj?.transform) return ol.proj.transform(coordinate, projection, "EPSG:4326");
    throw new Error("OpenLayers no expone una conversión a EPSG:4326.");
  }

  function recordFromFeature(feature, sourceName) {
    if (!feature?.getProperties || !feature?.getGeometry) return null;
    const props = feature.getProperties();
    const type = ENGINE.normalizeType(props.tipo);
    const geometry = feature.getGeometry();
    if (!ENGINE.isCentralityPointType(type) || !geometry || geometry.getType?.() !== "Point") return null;
    const coordinate = geometry.getCoordinates?.();
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const lonLat = toLonLat(coordinate);
    if (!Array.isArray(lonLat) || !Number.isFinite(Number(lonLat[0])) || !Number.isFinite(Number(lonLat[1]))) return null;
    const id = ENGINE.cleanText(props.id || feature.getId?.());
    const code = ENGINE.cleanText(props.codigo || props.code || props.nombre || "");
    const number = ENGINE.cleanText(props.numero || "");
    return {
      feature, geometry, coordinate: coordinate.slice(0, 2), sourceName,
      id, featureId: ENGINE.cleanText(feature.getId?.()), code, number,
      type, equipmentType: ENGINE.cleanText(props.tipoEquipo || props.equipmentType || ""),
      lat: Number(lonLat[1]), lon: Number(lonLat[0]),
      plannedOpeningRefs: props.aperturasIds,
      properties: Object.fromEntries(Object.entries(props).filter(([key, value]) => key !== "geometry" && ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value)))
    };
  }

  function scanMap() {
    const found = [];
    const seen = new Set();
    const add = (feature, sourceName) => {
      if (!feature || seen.has(feature)) return;
      seen.add(feature);
      const record = recordFromFeature(feature, sourceName);
      if (record) found.push(record);
    };

    // V8's public in-memory accessor, when that version is running.
    try {
      const legacy = w.__superponerKMZ?.getPuntos?.() || [];
      legacy.forEach(feature => add(feature, "Centrality Local API"));
    } catch (_) { /* fall back to OpenLayers layer inspection */ }

    // V10/V9-style vector layers. Raster WMTS layers expose no individual features.
    for (const layer of collectLayers(map.getLayers?.())) {
      try {
        const source = layer.getSource?.();
        const features = source?.getFeatures?.();
        if (Array.isArray(features)) features.forEach(feature => add(feature, layerName(layer)));
      } catch (_) { /* skip inaccessible or non-vector source */ }
    }
    return found;
  }

  function labelFor(record) {
    const typeLabel = record.type === "APERTURA" ? `${record.equipmentType || "Apertura"}` : "Poste";
    const identifier = record.code || (record.number ? `N° ${record.number}` : record.id || "sin código");
    return `${typeLabel} · ${identifier}${record.number && record.code ? ` · N° ${record.number}` : ""}`;
  }

  function refreshObjects() {
    records = scanMap();
    const previous = pointSelect.value;
    const previousObject = objectSelect.value;
    const previousEquipment = equipmentSelect.value;
    pointSelect.replaceChildren();
    objectSelect.replaceChildren();
    equipmentSelect.replaceChildren();
    const allTypes = make("option", "", "Todas", equipmentSelect);
    allTypes.value = "";
    const equipmentTypes = [...new Set(records.filter(item => item.type === "APERTURA").map(item => item.equipmentType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    for (const type of equipmentTypes) {
      const option = make("option", "", type, equipmentSelect);
      option.value = type;
    }
    const points = records.filter(item => item.type === "PUNTO");
    const openings = records.filter(item => item.type === "APERTURA");
    for (const record of points) {
      const option = make("option", "", labelFor(record), pointSelect);
      option.value = String(points.indexOf(record));
    }
    for (const record of records) {
      const option = make("option", "", labelFor(record), objectSelect);
      option.value = String(records.indexOf(record));
    }
    const found = `${points.length} puntos y ${openings.length} aperturas legibles en ${records.length ? "capas vectoriales" : "el mapa"}.`;
    dataStatus.textContent = found;
    dataStatus.className = records.length ? "status ok" : "status warn";
    if (previous && [...pointSelect.options].some(option => option.value === previous)) pointSelect.value = previous;
    if (previousObject && [...objectSelect.options].some(option => option.value === previousObject)) objectSelect.value = previousObject;
    if ([...equipmentSelect.options].some(option => option.value === previousEquipment)) equipmentSelect.value = previousEquipment;
    runButton.disabled = !points.length || !openings.length;
    inspectButton.disabled = !records.length;
    if (!records.length) {
      output.className = "empty";
      output.textContent = "No se encontraron objetos PUNTO/APERTURA en las capas vectoriales. Importa o abre primero un proyecto de Centrality con postes y aperturas. Las capas WMTS raster no exponen activos individuales a este módulo.";
    }
    return { points: points.length, openings: openings.length };
  }

  function selectedPoint() {
    const index = Number(pointSelect.value);
    const record = records.filter(item => item.type === "PUNTO")[index];
    return record || null;
  }

  function formatCode(record) {
    return record.code || record.id || (record.number ? `N° ${record.number}` : "sin código");
  }

  function clearOverlay() {
    if (lastOverlay) {
      try { map.removeLayer(lastOverlay); } catch (_) {}
      lastOverlay = null;
    }
  }

  function showOnMap(origin, opening) {
    clearOverlay();
    if (!ol.geom?.LineString || !ol.style?.Style || !ol.style?.Circle || !ol.style?.Stroke || !ol.style?.Fill) {
      throw new Error("OpenLayers no dispone de los componentes gráficos requeridos.");
    }
    const source = new ol.source.Vector();
    const originFeature = new ol.Feature({ geometry: origin.geometry.clone(), centralityToolsRole: "origin" });
    const openingFeature = new ol.Feature({ geometry: opening.geometry.clone(), centralityToolsRole: "opening" });
    const lineFeature = new ol.Feature({
      geometry: new ol.geom.LineString([origin.coordinate, opening.coordinate]),
      centralityToolsRole: "link"
    });
    source.addFeatures([lineFeature, originFeature, openingFeature]);
    const layer = new ol.layer.Vector({
      source,
      style: feature => {
        const role = feature.get("centralityToolsRole");
        if (role === "link") return new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "#0f172a", width: 3, lineDash: [7, 5] })
        });
        const isOrigin = role === "origin";
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: isOrigin ? 8 : 9,
            fill: new ol.style.Fill({ color: isOrigin ? "#2563eb" : "#ea580c" }),
            stroke: new ol.style.Stroke({ color: "#ffffff", width: 2 })
          })
        });
      }
    });
    layer.set("centralityToolsOverlay", true);
    layer.setZIndex?.(1000000);
    map.addLayer(layer);
    lastOverlay = layer;
    try {
      const extent = ol.extent?.boundingExtent?.([origin.coordinate, opening.coordinate]);
      if (extent && map.getView?.().fit) {
        map.getView().fit(extent, { padding: [90, 420, 90, 90], maxZoom: 19, duration: 250 });
      }
    } catch (_) { /* showing the overlay still succeeds if fitting is unavailable */ }
  }

  function renderNearest(origin, matches) {
    output.replaceChildren();
    output.className = "result";
    make("div", "status ok", `${matches.length} apertura(s) encontrada(s) dentro del radio configurado.`, output);
    if (!matches.length) {
      make("div", "empty", "No hay aperturas de Centrality dentro del radio. Aumenta el radio o verifica que existan puntos de tipo APERTURA.", output);
      return;
    }
    for (const item of matches.slice(0, 10)) {
      const row = make("div", "item", null, output);
      const detail = make("div", "", null, row);
      make("strong", "", labelFor(item), detail);
      make("small", "", `Fuente: ${item.sourceName}`, detail);
      make("span", "tag", item.plannedLink ? "Vínculo de planificación registrado" : "Sin vínculo de planificación detectado", detail).classList.toggle("linked", item.plannedLink);
      make("span", "distance", ENGINE.formatDistance(item.distanceM), row);
      const btn = make("button", "", "Ver en mapa", detail);
      btn.addEventListener("click", () => {
        try { showOnMap(origin, item); }
        catch (error) { showMessage(error.message, true); }
      });
    }
    make("div", "foot", "Ordenado por distancia geométrica. El primer resultado no se interpreta como conexión eléctrica ni como apertura operativamente correspondiente.", output);
  }

  function showMessage(message, warning = false) {
    output.replaceChildren();
    output.className = warning ? "status warn" : "status";
    output.textContent = message;
  }

  function runNearest() {
    try {
      const origin = selectedPoint();
      if (!origin) throw new Error("Selecciona un poste válido.");
      const radiusM = Number(radiusInput.value);
      if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 100000) throw new Error("El radio debe estar entre 1 y 100.000 metros.");
      const matches = ENGINE.nearestOpenings(origin, records, { radiusM, equipmentType: equipmentSelect.value || undefined });
      renderNearest(origin, matches);
      if (matches[0]) showOnMap(origin, matches[0]);
    } catch (error) {
      showMessage(error?.message || "No se pudo ejecutar el análisis.", true);
    }
  }

  function runInspect() {
    const target = records[Number(objectSelect.value)] || null;
    if (!target) return showMessage("Selecciona un objeto para inspeccionar.", true);
    output.replaceChildren();
    output.className = "result";
    make("div", "status", `${labelFor(target)} · ${target.sourceName}`, output);
    const dl = make("dl", "attrs", null, output);
    const props = target.properties || {};
    const preferred = ["id", "object_id", "objectId", "codigo", "numero", "tipo", "tipoEquipo", "bloqueId", "bloques", "aperturasIds"];
    const keys = [...new Set([...preferred.filter(key => key in props), ...Object.keys(props)])].slice(0, 24);
    for (const key of keys) {
      const value = props[key];
      make("dt", "", key, dl);
      make("dd", "", Array.isArray(value) ? value.join(" | ") : String(value ?? ""), dl);
    }
  }


  toolSelect.addEventListener("change", () => {
    const tool = TOOL_REGISTRY.find(item => item.id === toolSelect.value);
    if (!tool || tool.status !== "ready") return;
    const nearest = tool.id === "nearest-opening";
    radiusRow.hidden = !nearest;
    equipmentLabel.hidden = !nearest;
    pointLabel.hidden = !nearest;
    objectLabel.hidden = tool.id !== "inspect-object";
    runButton.hidden = !nearest;
    inspectButton.hidden = tool.id !== "inspect-object";
  });
  runButton.addEventListener("click", runNearest);
  inspectButton.addEventListener("click", runInspect);
  refreshButton.addEventListener("click", refreshObjects);
  launcher.addEventListener("click", () => setVisible(!visible));

  function setVisible(next) {
    visible = Boolean(next);
    panel.hidden = !visible;
    launcher.hidden = visible;
  }
  function toggle() { setVisible(!visible); }
  function destroy() {
    if (disposed) return;
    disposed = true;
    clearOverlay();
    host.remove();
    if (w.__centralityToolsV1?.destroy === destroy) delete w.__centralityToolsV1;
  }

  doc.body.appendChild(host);
  refreshObjects();
  toolSelect.dispatchEvent(new doc.defaultView.Event("change"));
  w.__centralityToolsV1 = Object.freeze({
    version: "1.0.0",
    toggle,
    open: () => setVisible(true),
    refresh: refreshObjects,
    destroy,
    getRegistry: () => TOOL_REGISTRY.map(({id,label,description,status,input,relations,fields,filters,source}) => ({id,label,description,status,input,relations,fields,filters,source}))
  });
  console.info("Centrality Tools V1 listo. Fuente: capas vectoriales ya cargadas; sin consultas GNAT.");
})();
