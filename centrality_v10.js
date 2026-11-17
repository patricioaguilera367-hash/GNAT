/*
 * CENTRALITY LOCAL V10
 * Interfaz espacial limpia sobre OpenLayers (GNAT):
 * - Barra superior compacta + Dock de cursor inferior + Cajón lateral de tabla
 * - Autoguardado y Proyectos recientes en IndexedDB + Carpeta de respaldo opcional
 * - Paleta de alto contraste para mapa, Envolventes de zona y Ruta secuencial (1->2->3)
 * - Modo Supervisor "fantasma" por defecto (CC, TL, RD, JB disponibles bajo demanda)
 * - Selección directa en mapa (clic / Shift+arrastrar / caja) y menú clic derecho
 */
(() => {
  "use strict";

  const frame = document.querySelector("iframe#content");
  if (!frame) {
    console.error("Centrality V10: Abre primero el módulo Mapas de Centrality.");
    return;
  }

  let w, map, ol, doc;
  try {
    w = frame.contentWindow;
    map = w.webMap_?.map;
    ol = w.ol;
    doc = w.document;
  } catch (e) {
    console.error("Centrality V10: No es posible acceder al mapa de Centrality:", e);
    return;
  }

  if (!map || !ol?.layer?.Vector || !ol?.source?.Vector || !ol?.format?.KML ||
      !ol?.Feature || !ol?.geom?.Point || !ol?.style?.Style || !ol?.style?.Circle ||
      !ol?.style?.Text || !ol?.style?.Fill || !ol?.style?.Stroke || !ol?.style?.RegularShape) {
    console.error("Centrality V10: OpenLayers no expone los componentes requeridos.");
    return;
  }

  // Cerrar instancias previas limpiamente
  try { w.__centralityV10?.destroy?.(); } catch (_) {}
  try { w.__superponerKMZ?.cerrar?.(); } catch (_) {}
  try { w.__pruebaDetalleCentrality?.cerrar?.(); } catch (_) {}
  try { w.__centralityAtlasPDF?.destruir?.(); } catch (_) {}

  // =========================================================================
  // 1. CONSTANTES, PALETA DE ALTO CONTRASTE Y DIRECTORIO DE SUPERVISORES
  // =========================================================================
  const HIGH_CONTRAST_PALETTE = [
    "#00C853", // Verde neón
    "#FF6D00", // Naranjo intenso
    "#2979FF", // Azul eléctrico
    "#00BFA5", // Verde turquesa claro (JB)
    "#D500F9", // Magenta vivo
    "#FFD600", // Amarillo alto contraste
    "#00E5FF", // Cian eléctrico
    "#E11D48", // Carmesí
    "#65A30D", // Lima
    "#4F46E5"  // Índigo
  ];

  const DEFAULT_SUPERVISORS = [
    { id: "default", initials: "—", name: "Sin asignar", color: "#64748B", isDefault: true },
    { id: "CC", initials: "CC", name: "César Castro", color: "#FF6D00" },
    { id: "TL", initials: "TL", name: "Tomás Lemunao", color: "#2979FF" },
    { id: "RD", initials: "RD", name: "Ricardo Díaz", color: "#15803D" },
    { id: "JB", initials: "JB", name: "Jorge Burgos", color: "#00BFA5" }
  ];

  const LEGACY_COLOR_TO_SUP = {
    "Naranjo": "CC",
    "Azul": "TL",
    "Verde": "RD",
    "Sin asignar": "default"
  };

  const OPENING_COLOR = "#DC2626";
  const UNASSIGNED_ZONE_COLOR = "#475569";
  const UMBRAL_ETIQUETA = 25;

  // =========================================================================
  // 2. ESTADO DE LA APLICACIÓN
  // =========================================================================
  const state = {
    projectId: "proj-" + Date.now(),
    projectName: "Proyecto sin título",
    dirty: false,
    savingText: "Listo",
    points: [],            // Array<ol.Feature>
    zones: new Map(),      // id -> { id, name, color }
    supervisors: new Map(DEFAULT_SUPERVISORS.map(s => [s.id, { ...s }])),
    multiSupervisorEnabled: false,
    selected: new Set(),   // Set<number> (indices in state.points)
    focused: -1,           // index in state.points
    cursorMode: "nav",     // "nav" | "box" | "add" | "link-opening"
    pendingLinkIndices: [],// indices waiting to be linked to clicked/created opening
    drawerOpen: true,
    collapsed: false,
    // Filtros dinámicos
    search: "",
    filterType: "all",     // "all" | "PUNTO" | "APERTURA"
    filterZones: new Set(),// empty = all; can include "__NONE__" for unzoned
    filterSups: new Set(), // empty = all
    // Opciones de visualización en mapa
    colorBy: "zone",       // "zone" | "supervisor"
    showHulls: true,       // envolventes suaves por zona
    showRoute: false,      // línea secuencial 1->2->3
    labelMode: "cerca",    // "cerca" | "siempre" | "ninguna"
    labelContent: "numero",// "numero" | "completo"
    mtbtDetail: 0,         // 0 | 1 | 2
    backupDirHandle: null
  };

  let styleCache = new WeakMap();
  let vectorLayer = null;
  let hullLayer = null;
  let routeLayer = null;
  let dragBoxInteraction = null;
  let addPointDropCoord = null;
  let activePopover = null;
  let autosaveTimer = null;
  let atlasRunning = false;
  let atlasCancel = false;
  let atlasCaptures = null;
  let rendererExport = null;

  // =========================================================================
  // 3. UTILIDADES Y HELPERS
  // =========================================================================
  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  const contrastText = (hex) => {
    if (!isHex(hex)) return "#FFFFFF";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#0F172A" : "#FFFFFF";
  };

  const hexToRgba = (hex, alpha) => {
    if (!isHex(hex)) return `rgba(71,85,105,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const getPointCode = (f) => {
    const raw = String(f.get("codigo") || "Sin código").trim();
    const num = String(f.get("numero") || "");
    const pref = new RegExp("^" + num + "(?:\\s*[-–—·.:#/]\\s*|\\s+)");
    return raw.replace(pref, "").trim() || raw;
  };

  const getPointZoneIds = (f) => {
    if (f.get("tipo") === "APERTURA") {
      const explicit = Array.isArray(f.get("bloques")) ? f.get("bloques") : [];
      const apId = String(f.get("id"));
      const derived = state.points
        .filter(p => p.get("tipo") !== "APERTURA" && p.get("bloqueId") && (p.get("aperturasIds") || []).includes(apId))
        .map(p => String(p.get("bloqueId")));
      return [...new Set([...explicit, ...derived].filter(Boolean))];
    }
    const z = String(f.get("bloqueId") || "").trim();
    return z ? [z] : [];
  };

  const getSupId = (f) => {
    const raw = String(f.get("supervisorId") || f.get("bloque") || "default").trim();
    if (state.supervisors.has(raw)) return raw;
    if (LEGACY_COLOR_TO_SUP[raw]) return LEGACY_COLOR_TO_SUP[raw];
    return "default";
  };

  const isMultiSupActive = () => {
    if (state.multiSupervisorEnabled) return true;
    const used = new Set();
    for (const f of state.points) {
      const sid = getSupId(f);
      if (sid !== "default") used.add(sid);
      if (used.size > 1) return true;
    }
    return false;
  };

  const getPointColor = (f) => {
    if (f.get("tipo") === "APERTURA") return OPENING_COLOR;
    if (state.colorBy === "supervisor" && isMultiSupActive()) {
      const sup = state.supervisors.get(getSupId(f));
      return sup ? sup.color : UNASSIGNED_ZONE_COLOR;
    }
    const zid = String(f.get("bloqueId") || "").trim();
    if (zid && state.zones.has(zid)) {
      return state.zones.get(zid).color || HIGH_CONTRAST_PALETTE[0];
    }
    const custom = f.get("colorPersonalizado");
    if (isHex(custom)) return custom;
    return UNASSIGNED_ZONE_COLOR;
  };

  const nextHighContrastColor = (usedColors) => {
    for (const c of HIGH_CONTRAST_PALETTE) {
      if (!usedColors.has(c.toUpperCase())) return c;
    }
    return HIGH_CONTRAST_PALETTE[usedColors.size % HIGH_CONTRAST_PALETTE.length];
  };

  const autoAssignHighContrastZones = () => {
    let i = 0;
    for (const z of state.zones.values()) {
      z.color = HIGH_CONTRAST_PALETTE[i % HIGH_CONTRAST_PALETTE.length];
      i++;
    }
    styleCache = new WeakMap();
    refreshAll();
    markDirty();
    showToast("Colores de alto contraste aplicados a todas las zonas.");
  };

  // =========================================================================
  // 4. ALMACENAMIENTO LOCAL (IndexedDB + Carpeta Opcional)
  // =========================================================================
  const DB_NAME = "CentralityLocalV10";
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = w.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPutProject(proj) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(proj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbListProjects() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readonly");
      const req = tx.objectStore("projects").getAll();
      req.onsuccess = () => {
        const arr = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDeleteProject(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbSaveSetting(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetSetting(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readonly");
      const req = tx.objectStore("settings").get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  function serializeProjectPayload() {
    const registros = state.points.map(f => {
      const [longitud, latitud] = ol.proj.toLonLat(f.getGeometry().getCoordinates(), map.getView().getProjection());
      const sid = getSupId(f);
      const legacySup = sid === "CC" ? "Naranjo" : sid === "TL" ? "Azul" : sid === "RD" ? "Verde" : "Sin asignar";
      return {
        id: String(f.get("id")),
        numero: Number(f.get("numero")),
        tipo: f.get("tipo") || "PUNTO",
        codigo: String(f.get("codigo") || ""),
        longitud,
        latitud,
        supervisorColor: legacySup,
        supervisorId: sid,
        bloqueId: String(f.get("bloqueId") || ""),
        bloques: Array.isArray(f.get("bloques")) ? f.get("bloques") : [],
        aperturasIds: Array.isArray(f.get("aperturasIds")) ? f.get("aperturasIds") : [],
        tipoEquipo: String(f.get("tipoEquipo") || ""),
        colorPersonalizado: String(f.get("colorPersonalizado") || "")
      };
    });
    return {
      version: 5,
      formato: "CentralityLocal",
      id: state.projectId,
      nombre: state.projectName,
      updatedAt: Date.now(),
      multiSupervisorEnabled: state.multiSupervisorEnabled,
      supervisors: [...state.supervisors.values()],
      bloques: [...state.zones.values()].map(z => ({ id: z.id, nombre: z.name, color: z.color })),
      registros
    };
  }

  function markDirty() {
    state.dirty = true;
    updateSaveIndicator("Guardando...");
    w.clearTimeout(autosaveTimer);
    autosaveTimer = w.setTimeout(() => {
      autosaveNow().catch(err => console.warn("Autosave error:", err));
    }, 650);
  }

  async function autosaveNow() {
    if (!state.points.length) {
      state.dirty = false;
      updateSaveIndicator("Sin datos");
      return;
    }
    const payload = serializeProjectPayload();
    await dbPutProject({
      id: state.projectId,
      name: state.projectName,
      updatedAt: payload.updatedAt,
      pointCount: payload.registros.length,
      zoneCount: payload.bloques.length,
      payload
    });
    state.dirty = false;
    updateSaveIndicator("✓ Guardado");

    if (state.backupDirHandle) {
      try {
        const perm = await state.backupDirHandle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          const safeName = state.projectName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "proyecto";
          const fh = await state.backupDirHandle.getFileHandle(safeName + ".json", { create: true });
          const writable = await fh.createWritable();
          await writable.write(JSON.stringify(payload, null, 2));
          await writable.close();
        }
      } catch (e) {
        console.warn("Respaldo en carpeta omitido:", e);
      }
    }
  }

  // =========================================================================
  // 5. SHELL DOM AISLADO (SHADOW DOM) + ESTILOS DESIGN SYSTEM
  // =========================================================================
  const host = doc.createElement("div");
  host.id = "centrality-v10-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = doc.createElement("style");
  styleEl.textContent = `
    :host {
      --bg-surface: rgba(255, 255, 255, 0.97);
      --bg-muted: #F1F5F9;
      --bg-hover: #E2E8F0;
      --border: #CBD5E1;
      --border-strong: #94A3B8;
      --text-primary: #0F172A;
      --text-secondary: #475569;
      --accent: #1D4ED8;
      --accent-soft: #DBEAFE;
      --danger: #DC2626;
      --danger-soft: #FEE2E2;
      --success: #15803D;
      --success-soft: #DCFCE7;
      --radius: 8px;
      --shadow: 0 4px 18px rgba(15, 23, 42, 0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 13px;
      color: var(--text-primary);
    }
    * { box-sizing: border-box; }
    button, input, select { font: inherit; color: inherit; }
    button {
      cursor: pointer;
      border: 1px solid transparent;
      background: transparent;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      transition: background 120ms ease, border-color 120ms ease;
    }
    button:hover:not(:disabled) { background: var(--bg-muted); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.btn-primary {
      background: var(--accent);
      color: #fff;
      font-weight: 600;
    }
    button.btn-primary:hover:not(:disabled) { background: #1E40AF; }
    button.btn-outline {
      background: #fff;
      border-color: var(--border);
    }
    button.btn-outline:hover:not(:disabled) { background: var(--bg-muted); border-color: var(--border-strong); }
    button.btn-danger {
      background: var(--danger-soft);
      color: var(--danger);
      font-weight: 600;
    }
    button.btn-danger:hover:not(:disabled) { background: #FECACA; }
    button.active-pill {
      background: var(--accent-soft);
      color: var(--accent);
      border-color: #93C5FD;
      font-weight: 600;
    }

    /* TOP CONTEXT BAR */
    .topbar {
      pointer-events: auto;
      position: fixed;
      top: 10px;
      left: 10px;
      right: 10px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    .topbar-left, .topbar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .divider {
      width: 1px;
      height: 22px;
      background: var(--border);
      margin: 0 2px;
      flex-shrink: 0;
    }
    .proj-name {
      font-weight: 600;
      font-size: 13px;
      border: 1px solid transparent;
      border-radius: 5px;
      padding: 3px 6px;
      max-width: 190px;
      background: transparent;
      text-overflow: ellipsis;
    }
    .proj-name:hover { border-color: var(--border); background: #fff; }
    .proj-name:focus { outline: none; border-color: var(--accent); background: #fff; }
    .save-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 99px;
      background: var(--success-soft);
      color: var(--success);
      white-space: nowrap;
    }
    .save-badge.dirty { background: #FEF3C7; color: #92400E; }

    /* BOTTOM-CENTER CURSOR DOCK */
    .dock {
      pointer-events: auto;
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    .dock button {
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .dock button.active {
      background: var(--text-primary);
      color: #fff;
    }

    /* RIGHT TABLE DRAWER */
    .drawer {
      pointer-events: auto;
      position: fixed;
      top: 64px;
      right: 10px;
      bottom: 14px;
      width: 356px;
      max-width: calc(100vw - 20px);
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .drawer.hidden { display: none; }
    .drawer-head {
      padding: 10px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #fff;
    }
    .search-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .search-box {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 8px;
      background: #F8FAFC;
    }
    .search-box:focus-within { border-color: var(--accent); background: #fff; }
    .search-box input {
      border: none;
      outline: none;
      background: transparent;
      width: 100%;
      font-size: 12px;
    }
    .stepper {
      display: flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #fff;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      font-weight: 600;
    }
    .stepper button { padding: 4px 6px; border-radius: 4px; }
    .stepper span { padding: 0 5px; color: var(--text-secondary); white-space: nowrap; }

    .filter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .chip {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 99px;
      border: 1px solid var(--border);
      background: #fff;
      color: var(--text-secondary);
      gap: 5px;
    }
    .chip:hover { background: var(--bg-muted); color: var(--text-primary); }
    .chip.on {
      background: var(--text-primary);
      color: #fff;
      border-color: var(--text-primary);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }

    /* TABLE */
    .table-wrap {
      flex: 1;
      overflow: auto;
      background: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #F8FAFC;
      border-bottom: 1px solid var(--border);
      padding: 7px 6px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    tbody tr {
      border-bottom: 1px solid #F1F5F9;
      cursor: pointer;
    }
    tbody tr:hover { background: #F8FAFC; }
    tbody tr.focused { background: #EFF6FF; }
    tbody tr.selected { background: #F0F9FF; }
    tbody td {
      padding: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    .num-cell {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
    }
    .zone-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 700;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sup-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 20px;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 700;
    }

    /* CONTEXTUAL BOTTOM BAR */
    .ctx-bar {
      padding: 8px 10px;
      background: #0F172A;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
    }
    .ctx-bar.hidden { display: none; }
    .ctx-bar button {
      color: #fff;
      background: rgba(255,255,255,0.12);
      font-size: 11px;
      font-weight: 600;
      padding: 5px 8px;
    }
    .ctx-bar button:hover { background: rgba(255,255,255,0.22); }
    .ctx-bar button.ctx-accent { background: var(--accent); }
    .ctx-bar button.ctx-danger { background: var(--danger); }

    /* POPOVER / DROPDOWN */
    .popover {
      pointer-events: auto;
      position: fixed;
      min-width: 240px;
      max-width: 340px;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
      padding: 8px;
      z-index: 20;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pop-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      padding: 4px 6px 2px;
    }
    .pop-item {
      width: 100%;
      justify-content: flex-start;
      padding: 6px 8px;
      font-size: 12px;
      border-radius: 6px;
    }
    .pop-sep { height: 1px; background: var(--border); margin: 4px 0; }
    .palette-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
      padding: 6px;
    }
    .swatch {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: 2px solid rgba(0,0,0,0.12);
      cursor: pointer;
      padding: 0;
    }
    .swatch:hover { transform: scale(1.1); }

    /* MODAL / START SCREEN */
    .modal-backdrop {
      pointer-events: auto;
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      display: grid;
      place-items: center;
      z-index: 30;
    }
    .modal-backdrop.hidden { display: none; }
    .modal-card {
      width: min(560px, 94vw);
      max-height: 86vh;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-head {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body {
      padding: 16px 18px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dropzone {
      border: 2px dashed var(--border-strong);
      border-radius: 10px;
      padding: 22px;
      text-align: center;
      background: #F8FAFC;
      cursor: pointer;
      transition: border-color 150ms, background 150ms;
    }
    .dropzone.drag { border-color: var(--accent); background: var(--accent-soft); }
    .recent-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 11px;
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
    }
    .recent-item:hover { background: #F8FAFC; border-color: var(--border-strong); }

    /* BANNER DE MODO ACTIVO & TOAST */
    .mode-banner {
      pointer-events: auto;
      position: fixed;
      top: 64px;
      left: 50%;
      transform: translateX(-50%);
      background: #0F172A;
      color: #fff;
      padding: 7px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 25;
    }
    .mode-banner.hidden { display: none; }
    .toast {
      pointer-events: none;
      position: fixed;
      bottom: 72px;
      left: 50%;
      transform: translateX(-50%);
      background: #1E293B;
      color: #fff;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: var(--shadow);
      z-index: 40;
      opacity: 0;
      transition: opacity 160ms ease;
    }
    .toast.show { opacity: 1; }
    .toast.err { background: #991B1B; }

    /* INLINE PIN POPOVER */
    .pin-form {
      pointer-events: auto;
      position: fixed;
      width: 260px;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      box-shadow: var(--shadow);
      z-index: 28;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pin-form input, .pin-form select {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      width: 100%;
    }

    /* COLLAPSED FAB */
    .fab {
      pointer-events: auto;
      position: fixed;
      top: 10px;
      right: 10px;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      justify-content: center;
      font-size: 18px;
      font-weight: 700;
    }
    .fab.hidden { display: none; }
  `;
  shadow.appendChild(styleEl);

  const root = doc.createElement("div");
  shadow.appendChild(root);

  const el = (tag, cls, text, parent = root) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };

  // =========================================================================
  // 6. CONSTRUCCIÓN DE LA INTERFAZ (3 ZONAS)
  // =========================================================================
  // 6.1 TOPBAR
  const topbar = el("header", "topbar");
  const topLeft = el("div", "topbar-left", null, topbar);
  const topRight = el("div", "topbar-right", null, topbar);

  const btnArchivo = el("button", "btn-outline", "📁 Archivo ▾", topLeft);
  btnArchivo.title = "Proyectos recientes, importar o guardar copia";

  const projNameInput = el("input", "proj-name", null, topLeft);
  projNameInput.type = "text";
  projNameInput.value = state.projectName;
  projNameInput.title = "Nombre del proyecto (clic para renombrar)";
  projNameInput.addEventListener("change", () => {
    state.projectName = projNameInput.value.trim() || "Proyecto sin título";
    projNameInput.value = state.projectName;
    markDirty();
  });

  const saveBadge = el("span", "save-badge", "Sin datos", topLeft);
  el("div", "divider", null, topLeft);

  const btnZonas = el("button", "btn-outline", "Zonas ▾", topLeft);
  btnZonas.title = "Crear, filtrar o cambiar colores de zonas desconectadas";

  const btnVista = el("button", "btn-outline", "Vista mapa ▾", topLeft);
  btnVista.title = "Envolventes, línea de ruta 1→2→3, etiquetas y detalle MT/BT";

  const btnHerramientas = el("button", "btn-outline", "Herramientas ▾", topLeft);
  btnHerramientas.title = "Pegar lista de códigos, equipo/supervisores y exportar plano PDF";

  const btnToggleDrawer = el("button", "active-pill", "☰ Tabla", topRight);
  btnToggleDrawer.title = "Mostrar u ocultar listado lateral de postes";

  const btnCollapse = el("button", "btn-outline", "—", topRight);
  btnCollapse.title = "Minimizar barra";

  const btnClose = el("button", "btn-outline", "×", topRight);
  btnClose.title = "Cerrar Centrality V10 (no cierra GNAT)";

  // 6.2 DOCK INFERIOR DE CURSOR
  const dock = el("div", "dock");
  const btnModeNav = el("button", "active", "↖ Navegar", dock);
  btnModeNav.title = "Clic para centrar punto · Ctrl+clic para multiselección";
  const btnModeBox = el("button", "", "⬚ Seleccionar área", dock);
  btnModeBox.title = "Arrastra un rectángulo en el mapa para seleccionar varios puntos (atajo: Shift+arrastrar)";
  const btnModeAdd = el("button", "", "+ Agregar en mapa", dock);
  btnModeAdd.title = "Pincha en el mapa para crear un poste o apertura nueva";

  // 6.3 CAJÓN LATERAL DE TABLA
  const drawer = el("aside", "drawer");
  const drawerHead = el("div", "drawer-head", null, drawer);
  const searchRow = el("div", "search-row", null, drawerHead);

  const searchBox = el("div", "search-box", null, searchRow);
  el("span", "", "🔍", searchBox);
  const searchInput = el("input", "", null, searchBox);
  searchInput.type = "search";
  searchInput.placeholder = "Buscar N°, código o zona...";

  const stepper = el("div", "stepper", null, searchRow);
  const btnPrev = el("button", "", "◀", stepper);
  btnPrev.title = "Poste anterior";
  const stepLabel = el("span", "", "0/0", stepper);
  const btnNext = el("button", "", "▶", stepper);
  btnNext.title = "Siguiente poste";

  const filterChips = el("div", "filter-chips", null, drawerHead);

  const tableWrap = el("div", "table-wrap", null, drawer);
  const table = el("table", "", null, tableWrap);
  const thead = el("thead", "", null, table);
  const tbody = el("tbody", "", null, table);

  const ctxBar = el("div", "ctx-bar hidden", null, drawer);

  // 6.4 BANNER, TOAST, MODAL, FAB
  const modeBanner = el("div", "mode-banner hidden");
  const modeBannerText = el("span", "", "", modeBanner);
  const modeBannerCancel = el("button", "", "Cancelar (Esc)", modeBanner);
  modeBannerCancel.style.cssText = "background:rgba(255,255,255,0.18);color:#fff;padding:2px 8px;font-size:11px;";

  const toastEl = el("div", "toast");
  const modalBackdrop = el("div", "modal-backdrop hidden");
  const fab = el("button", "fab hidden", "☰");
  fab.title = "Restaurar Centrality V10";

  // Inputs ocultos para archivos
  const hiddenFileInput = el("input", "", null, root);
  hiddenFileInput.type = "file";
  hiddenFileInput.accept = ".kmz,.kml,.json,.csv";
  hiddenFileInput.style.display = "none";

  function updateSaveIndicator(txt) {
    saveBadge.textContent = txt;
    saveBadge.classList.toggle("dirty", state.dirty);
  }

  let toastTimer = null;
  function showToast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isError ? " err" : "");
    w.clearTimeout(toastTimer);
    toastTimer = w.setTimeout(() => toastEl.classList.remove("show"), 3200);
  }

  function closePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }

  // =========================================================================
  // 7. MOTOR DE CAPAS OPENLAYERS (PUNTOS + ENVOLVENTES + RUTA)
  // =========================================================================
  function getFilteredPoints() {
    const q = state.search.trim().toLocaleLowerCase("es");
    return state.points.filter(f => {
      if (state.filterType !== "all" && (f.get("tipo") || "PUNTO") !== state.filterType) return false;
      if (state.filterZones.size > 0) {
        const zids = getPointZoneIds(f);
        const matchNone = state.filterZones.has("__NONE__") && zids.length === 0;
        const matchSome = zids.some(z => state.filterZones.has(z));
        if (!matchNone && !matchSome) return false;
      }
      if (state.filterSups.size > 0 && !state.filterSups.has(getSupId(f))) return false;
      if (q) {
        const zId = String(f.get("bloqueId") || "");
        const zName = state.zones.get(zId)?.name || "";
        const haystack = `${f.get("numero")} ${getPointCode(f)} ${zId} ${zName}`.toLocaleLowerCase("es");
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  function pointStyleFn(f, resolution) {
    const visibleSet = pointStyleFn._visibleSet;
    if (visibleSet && !visibleSet.has(f)) return null;

    const idx = state.points.indexOf(f);
    const isOpening = f.get("tipo") === "APERTURA";
    const isFocused = state.focused === idx;
    const isSelected = state.selected.has(idx);
    const color = getPointColor(f);
    const showText = state.labelMode === "siempre" ||
      (state.labelMode === "cerca" && resolution < UMBRAL_ETIQUETA);
    const key = `${color}|${isOpening}|${isFocused}|${isSelected}|${showText}|${state.labelContent}`;

    let cache = styleCache.get(f);
    if (!cache) {
      cache = new Map();
      styleCache.set(f, cache);
    }
    if (cache.has(key)) return cache.get(key);

    const style = new ol.style.Style({
      image: isOpening
        ? new ol.style.RegularShape({
            points: 4,
            radius: isFocused ? 13 : isSelected ? 12 : 10,
            radius2: 0,
            angle: Math.PI / 4,
            stroke: new ol.style.Stroke({
              color: isSelected ? "#1D4ED8" : OPENING_COLOR,
              width: isFocused ? 5 : 4
            })
          })
        : new ol.style.Circle({
            radius: isFocused ? 10 : isSelected ? 9 : 7,
            fill: new ol.style.Fill({ color }),
            stroke: new ol.style.Stroke({
              color: isSelected ? "#1D4ED8" : isFocused ? "#0F172A" : "#FFFFFF",
              width: isSelected || isFocused ? 3 : 2
            })
          }),
      text: showText ? new ol.style.Text({
        text: state.labelContent === "completo"
          ? `${f.get("numero")} · ${getPointCode(f)}`
          : String(f.get("numero")),
        font: "700 12px Arial,sans-serif",
        offsetY: isFocused ? -22 : -18,
        fill: new ol.style.Fill({ color: "#FFFFFF" }),
        stroke: new ol.style.Stroke({ color: "#0F172A", width: 3.5 })
      }) : undefined,
      zIndex: isFocused ? 100 : isSelected ? 50 : 10
    });
    cache.set(key, style);
    return style;
  }

  // Convex Hull simple (Andrew's monotone chain) para dibujar envolventes de zona
  function convexHull(coords) {
    if (coords.length < 3) return coords;
    const pts = coords.slice().sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function rebuildOverlayLayers() {
    const visible = getFilteredPoints();
    pointStyleFn._visibleSet = new Set(visible);

    if (hullLayer) {
      map.removeLayer(hullLayer);
      hullLayer = null;
    }
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }

    if (state.showHulls && ol.geom?.Polygon && state.zones.size > 0) {
      const hullFeatures = [];
      for (const z of state.zones.values()) {
        const zCoords = visible
          .filter(f => getPointZoneIds(f).includes(z.id))
          .map(f => f.getGeometry().getCoordinates().slice(0, 2));
        if (zCoords.length >= 3) {
          const hull = convexHull(zCoords);
          hull.push(hull[0]);
          const hf = new ol.Feature({ geometry: new ol.geom.Polygon([hull]) });
          hf.setStyle(new ol.style.Style({
            fill: new ol.style.Fill({ color: hexToRgba(z.color, 0.12) }),
            stroke: new ol.style.Stroke({ color: z.color, width: 2, lineDash: [6, 4] }),
            text: new ol.style.Text({
              text: z.name || z.id,
              font: "700 13px Arial,sans-serif",
              fill: new ol.style.Fill({ color: z.color }),
              stroke: new ol.style.Stroke({ color: "#FFFFFF", width: 4 })
            })
          }));
          hullFeatures.push(hf);
        }
      }
      if (hullFeatures.length) {
        hullLayer = new ol.layer.Vector({
          source: new ol.source.Vector({ features: hullFeatures }),
          zIndex: 99998
        });
        map.addLayer(hullLayer);
      }
    }

    if (state.showRoute && ol.geom?.LineString) {
      const routePts = visible
        .filter(f => (f.get("tipo") || "PUNTO") === "PUNTO")
        .slice()
        .sort((a, b) => Number(a.get("numero")) - Number(b.get("numero")));
      if (routePts.length >= 2) {
        const coords = routePts.map(f => f.getGeometry().getCoordinates().slice(0, 2));
        const rf = new ol.Feature({ geometry: new ol.geom.LineString(coords) });
        rf.setStyle(new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "#1D4ED8", width: 2.5, lineDash: [8, 6] })
        }));
        routeLayer = new ol.layer.Vector({
          source: new ol.source.Vector({ features: [rf] }),
          zIndex: 99999
        });
        map.addLayer(routeLayer);
      }
    }

    if (vectorLayer) vectorLayer.changed();
  }

  function ensureVectorLayer() {
    if (vectorLayer) map.removeLayer(vectorLayer);
    vectorLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features: state.points }),
      zIndex: 100000,
      style: pointStyleFn
    });
    map.addLayer(vectorLayer);
  }

  function navigateTo(index) {
    const f = state.points[index];
    if (!f) return;
    state.focused = index;
    const view = map.getView();
    const zoom = Math.max(Number.isFinite(view.getZoom()) ? view.getZoom() : 0, 17.5);
    const xy = f.getGeometry().getCoordinates();
    const res = view.getResolutionForZoom?.(zoom);
    const drawerRightOffset = state.drawerOpen && !state.collapsed ? 180 : 0;
    const center = Number.isFinite(res) && drawerRightOffset
      ? [xy[0] + drawerRightOffset * res, xy[1]]
      : xy;
    view.animate({ center, zoom, duration: 280 });
    renderTable();
    rebuildOverlayLayers();
    const rowEl = tbody.querySelector(`tr[data-idx="${index}"]`);
    rowEl?.scrollIntoView({ block: "nearest" });
  }

  function fitPoints(indices) {
    const coords = indices.map(i => state.points[i]?.getGeometry().getCoordinates()).filter(Boolean);
    if (!coords.length) return;
    if (coords.length === 1) { navigateTo(indices[0]); return; }
    const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
    const padRight = state.drawerOpen && !state.collapsed ? 380 : 40;
    map.getView().fit([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], {
      size: map.getSize(),
      padding: [70, padRight, 70, 40],
      maxZoom: 17.5,
      duration: 300
    });
  }

  // =========================================================================
  // 8. RENDER DE TABLA, CHIPS DINÁMICOS Y BARRA CONTEXTUAL
  // =========================================================================
  function renderFilterChips() {
    filterChips.replaceChildren();
    const makeChip = (label, isOn, onClick, dotColor = null) => {
      const c = el("button", "chip" + (isOn ? " on" : ""), null, filterChips);
      if (dotColor) {
        const d = el("span", "dot", null, c);
        d.style.background = dotColor;
      }
      el("span", "", label, c);
      c.onclick = onClick;
      return c;
    };

    makeChip("Todos", state.filterType === "all", () => { state.filterType = "all"; refreshAll(); });
    makeChip("Postes", state.filterType === "PUNTO", () => {
      state.filterType = state.filterType === "PUNTO" ? "all" : "PUNTO";
      refreshAll();
    });
    makeChip("Aperturas ✕", state.filterType === "APERTURA", () => {
      state.filterType = state.filterType === "APERTURA" ? "all" : "APERTURA";
      refreshAll();
    }, OPENING_COLOR);

    makeChip("Sin zona", state.filterZones.has("__NONE__"), () => {
      if (state.filterZones.has("__NONE__")) state.filterZones.delete("__NONE__");
      else state.filterZones.add("__NONE__");
      refreshAll();
    });

    for (const z of state.zones.values()) {
      makeChip(z.name || z.id, state.filterZones.has(z.id), () => {
        if (state.filterZones.has(z.id)) state.filterZones.delete(z.id);
        else state.filterZones.add(z.id);
        refreshAll();
      }, z.color);
    }

    if (isMultiSupActive()) {
      for (const s of state.supervisors.values()) {
        if (s.id === "default") continue;
        makeChip(s.initials, state.filterSups.has(s.id), () => {
          if (state.filterSups.has(s.id)) state.filterSups.delete(s.id);
          else state.filterSups.add(s.id);
          refreshAll();
        }, s.color);
      }
    }
  }

  function renderTable() {
    const visible = getFilteredPoints();
    const multiSup = isMultiSupActive();

    // Header
    thead.replaceChildren();
    const trh = el("tr", "", null, thead);
    const thCheck = el("th", "", null, trh);
    thCheck.style.width = "30px";
    const checkAll = el("input", "", null, thCheck);
    checkAll.type = "checkbox";
    checkAll.title = "Seleccionar todos los visibles";
    checkAll.checked = visible.length > 0 && visible.every(f => state.selected.has(state.points.indexOf(f)));
    checkAll.indeterminate = !checkAll.checked && visible.some(f => state.selected.has(state.points.indexOf(f)));
    checkAll.onchange = () => {
      for (const f of visible) {
        const idx = state.points.indexOf(f);
        if (checkAll.checked) state.selected.add(idx);
        else state.selected.delete(idx);
      }
      renderTable();
      rebuildOverlayLayers();
    };

    const thN = el("th", "", "N°", trh);
    thN.style.width = "40px";
    el("th", "", "Código", trh);
    const thZ = el("th", "", "Zona", trh);
    thZ.style.width = "92px";
    if (multiSup) {
      const thS = el("th", "", "Sup.", trh);
      thS.style.width = "42px";
    }

    // Body via DocumentFragment
    const frag = doc.createDocumentFragment();
    for (const f of visible) {
      const idx = state.points.indexOf(f);
      const isSel = state.selected.has(idx);
      const isFoc = state.focused === idx;
      const tr = doc.createElement("tr");
      tr.dataset.idx = String(idx);
      if (isSel) tr.classList.add("selected");
      if (isFoc) tr.classList.add("focused");

      const tdCb = doc.createElement("td");
      const cb = doc.createElement("input");
      cb.type = "checkbox";
      cb.checked = isSel;
      cb.onclick = (ev) => ev.stopPropagation();
      cb.onchange = () => {
        if (cb.checked) state.selected.add(idx);
        else state.selected.delete(idx);
        renderTable();
        rebuildOverlayLayers();
      };
      tdCb.appendChild(cb);
      tr.appendChild(tdCb);

      const tdN = doc.createElement("td");
      tdN.className = "num-cell";
      tdN.textContent = String(f.get("numero"));
      tr.appendChild(tdN);

      const tdCode = doc.createElement("td");
      const isAp = f.get("tipo") === "APERTURA";
      tdCode.textContent = (isAp ? "✕ " : "") + getPointCode(f);
      tdCode.title = tdCode.textContent;
      if (isAp) tdCode.style.color = OPENING_COLOR;
      tdCode.style.fontWeight = "600";
      tr.appendChild(tdCode);

      const tdZ = doc.createElement("td");
      const zids = getPointZoneIds(f);
      if (zids.length) {
        const z = state.zones.get(zids[0]);
        const pill = doc.createElement("span");
        pill.className = "zone-pill";
        const c = z?.color || HIGH_CONTRAST_PALETTE[0];
        pill.style.background = hexToRgba(c, 0.16);
        pill.style.color = "#0F172A";
        pill.style.border = `1px solid ${c}`;
        pill.textContent = zids.length > 1 ? `${z?.name || zids[0]} +${zids.length - 1}` : (z?.name || zids[0]);
        tdZ.appendChild(pill);
      } else {
        tdZ.textContent = "—";
        tdZ.style.color = "#94A3B8";
      }
      tr.appendChild(tdZ);

      if (multiSup) {
        const tdS = doc.createElement("td");
        const sup = state.supervisors.get(getSupId(f)) || DEFAULT_SUPERVISORS[0];
        const b = doc.createElement("span");
        b.className = "sup-badge";
        b.style.background = sup.color;
        b.style.color = contrastText(sup.color);
        b.textContent = sup.initials;
        b.title = sup.name;
        tdS.appendChild(b);
        tr.appendChild(tdS);
      }

      tr.onclick = () => navigateTo(idx);
      tr.oncontextmenu = (ev) => {
        ev.preventDefault();
        if (!state.selected.has(idx)) {
          state.selected.clear();
          state.selected.add(idx);
          renderTable();
          rebuildOverlayLayers();
        }
        openContextMenu(ev.clientX, ev.clientY, idx);
      };
      frag.appendChild(tr);
    }
    tbody.replaceChildren(frag);

    // Stepper
    const pos = visible.findIndex(f => state.points.indexOf(f) === state.focused);
    stepLabel.textContent = visible.length ? `${pos >= 0 ? pos + 1 : 0}/${visible.length}` : "0/0";
    btnPrev.disabled = btnNext.disabled = visible.length === 0;

    renderContextActionBar();
  }

  function renderContextActionBar() {
    ctxBar.replaceChildren();
    if (state.selected.size === 0) {
      ctxBar.classList.add("hidden");
      return;
    }
    ctxBar.classList.remove("hidden");
    const count = el("span", "", `${state.selected.size} sel.`, ctxBar);
    count.style.fontWeight = "700";

    const btnZone = el("button", "ctx-accent", "Zona ▾", ctxBar);
    btnZone.onclick = (ev) => openAssignZonePopover(ev.currentTarget);

    const btnLink = el("button", "", "Vincular ✕", ctxBar);
    btnLink.title = "Clic en una apertura del mapa (o en punto vacío para crearla) y asociar los postes seleccionados";
    btnLink.onclick = () => startLinkOpeningMode([...state.selected]);

    const btnMore = el("button", "", "Más ▾", ctxBar);
    btnMore.onclick = (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      openSelectionMorePopover(r.left, r.top - 8);
    };

    const btnClear = el("button", "", "×", ctxBar);
    btnClear.title = "Deseleccionar (Esc)";
    btnClear.onclick = () => { state.selected.clear(); refreshAll(); };
  }

  function refreshAll() {
    renderFilterChips();
    renderTable();
    rebuildOverlayLayers();
  }

  // =========================================================================
  // 9. ACCIONES DE ASIGNACIÓN, ZONAS, SUPERVISORES Y EDICIÓN
  // =========================================================================
  function assignZoneToIndices(indices, zoneId) {
    if (!indices.length) return;
    for (const idx of indices) {
      const f = state.points[idx];
      if (!f) continue;
      if (f.get("tipo") === "APERTURA") {
        const cur = Array.isArray(f.get("bloques")) ? f.get("bloques") : [];
        f.set("bloques", zoneId ? [...new Set([...cur, zoneId])] : []);
      } else {
        f.set("bloqueId", zoneId || "");
      }
    }
    styleCache = new WeakMap();
    markDirty();
    refreshAll();
    showToast(zoneId ? `Asignados ${indices.length} punto(s) a ${state.zones.get(zoneId)?.name || zoneId}.` : "Zona quitada.");
  }

  function assignSupervisorToIndices(indices, supId) {
    if (!indices.length) return;
    if (supId !== "default") state.multiSupervisorEnabled = true;
    for (const idx of indices) {
      const f = state.points[idx];
      if (!f) continue;
      f.set("supervisorId", supId);
    }
    styleCache = new WeakMap();
    markDirty();
    refreshAll();
    const s = state.supervisors.get(supId);
    showToast(`Responsable: ${s?.name || supId} (${indices.length} punto(s)).`);
  }

  function deleteIndices(indices) {
    if (!indices.length) return;
    const toRemove = new Set(indices);
    const removedOpeningIds = new Set(
      indices.map(i => state.points[i]).filter(f => f?.get("tipo") === "APERTURA").map(f => String(f.get("id")))
    );
    state.points = state.points.filter((_, i) => !toRemove.has(i));
    if (removedOpeningIds.size) {
      for (const f of state.points) {
        const refs = f.get("aperturasIds");
        if (Array.isArray(refs)) {
          f.set("aperturasIds", refs.filter(id => !removedOpeningIds.has(String(id))));
        }
      }
    }
    state.selected.clear();
    state.focused = -1;
    ensureVectorLayer();
    markDirty();
    refreshAll();
    showToast(`Eliminados ${indices.length} elemento(s).`);
  }

  function createZone(name, color) {
    let n = state.zones.size + 1;
    while (state.zones.has("D" + n)) n++;
    const id = "D" + n;
    const used = new Set([...state.zones.values()].map(z => z.color.toUpperCase()));
    const chosenColor = isHex(color) ? color : nextHighContrastColor(used);
    state.zones.set(id, { id, name: name || `Zona ${n}`, color: chosenColor });
    markDirty();
    refreshAll();
    return id;
  }

  // =========================================================================
  // 10. POPOVERS Y MENÚ CONTEXTUAL
  // =========================================================================
  function showPopoverAt(x, y, buildFn, anchorBottom = false) {
    closePopover();
    const pop = el("div", "popover");
    buildFn(pop);
    root.appendChild(pop);
    const rect = pop.getBoundingClientRect();
    const left = Math.min(Math.max(8, x), w.innerWidth - rect.width - 8);
    const top = anchorBottom
      ? Math.max(8, y - rect.height)
      : Math.min(Math.max(8, y), w.innerHeight - rect.height - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    activePopover = pop;
    return pop;
  }

  function openAssignZonePopover(anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    showPopoverAt(r.left, r.top - 6, (pop) => {
      el("div", "pop-title", "Agrupar en Zona", pop);
      for (const z of state.zones.values()) {
        const b = el("button", "pop-item", null, pop);
        const d = el("span", "dot", null, b);
        d.style.background = z.color;
        el("span", "", z.name || z.id, b);
        b.onclick = () => { closePopover(); assignZoneToIndices([...state.selected], z.id); };
      }
      const bNone = el("button", "pop-item", "Quitar de zona", pop);
      bNone.onclick = () => { closePopover(); assignZoneToIndices([...state.selected], ""); };
      el("div", "pop-sep", null, pop);
      const bNew = el("button", "pop-item", "+ Crear zona con seleccionados...", pop);
      bNew.style.fontWeight = "600";
      bNew.style.color = "var(--accent)";
      bNew.onclick = () => {
        const nombre = w.prompt("Nombre de la nueva zona (ej. Desconexión 1):", `Zona ${state.zones.size + 1}`);
        if (!nombre) return;
        const zid = createZone(nombre.trim());
        closePopover();
        assignZoneToIndices([...state.selected], zid);
      };
    }, true);
  }

  function openSelectionMorePopover(x, y) {
    showPopoverAt(x, y, (pop) => {
      const bFit = el("button", "pop-item", "🔍 Encuadrar selección en mapa", pop);
      bFit.onclick = () => { closePopover(); fitPoints([...state.selected]); };

      el("div", "pop-sep", null, pop);
      el("div", "pop-title", "Responsable (opcional)", pop);
      for (const s of state.supervisors.values()) {
        const b = el("button", "pop-item", null, pop);
        const d = el("span", "dot", null, b);
        d.style.background = s.color;
        el("span", "", s.id === "default" ? "Sin asignar" : `${s.initials} · ${s.name}`, b);
        b.onclick = () => { closePopover(); assignSupervisorToIndices([...state.selected], s.id); };
      }

      el("div", "pop-sep", null, pop);
      const bDel = el("button", "pop-item", "🗑 Eliminar seleccionados", pop);
      bDel.style.color = "var(--danger)";
      bDel.onclick = () => { closePopover(); deleteIndices([...state.selected]); };
    }, true);
  }

  function openContextMenu(x, y, idx) {
    showPopoverAt(x, y, (pop) => {
      const f = state.points[idx];
      el("div", "pop-title", `${f.get("numero")} · ${getPointCode(f)}`, pop);
      const bCenter = el("button", "pop-item", "🎯 Centrar en mapa", pop);
      bCenter.onclick = () => { closePopover(); navigateTo(idx); };

      const bZone = el("button", "pop-item", "🏷 Asignar a Zona ▾", pop);
      bZone.onclick = () => openAssignZonePopover(bZone);

      const bLink = el("button", "pop-item", "✕ Vincular con apertura...", pop);
      bLink.onclick = () => { closePopover(); startLinkOpeningMode([...state.selected]); };

      el("div", "pop-sep", null, pop);
      const bDel = el("button", "pop-item", "🗑 Eliminar", pop);
      bDel.style.color = "var(--danger)";
      bDel.onclick = () => { closePopover(); deleteIndices([...state.selected]); };
    });
  }

  // =========================================================================
  // 11. MENÚS DE LA BARRA SUPERIOR
  // =========================================================================
  btnArchivo.onclick = () => {
    const r = btnArchivo.getBoundingClientRect();
    showPopoverAt(r.left, r.bottom + 6, (pop) => {
      const bRec = el("button", "pop-item", "🏠 Proyectos recientes (Inicio)", pop);
      bRec.onclick = () => { closePopover(); openStartModal(); };

      const bImp = el("button", "pop-item", "📂 Abrir / Importar archivo...", pop);
      bImp.onclick = () => { closePopover(); hiddenFileInput.click(); };

      el("div", "pop-sep", null, pop);
      const bSaveCopy = el("button", "pop-item", "💾 Guardar copia (.json)", pop);
      bSaveCopy.disabled = state.points.length === 0;
      bSaveCopy.onclick = () => { closePopover(); downloadJSON(); };

      const bExpCsv = el("button", "pop-item", "📊 Exportar tabla (.csv)", pop);
      bExpCsv.disabled = state.points.length === 0;
      bExpCsv.onclick = () => { closePopover(); downloadCSV(); };

      if (typeof w.showDirectoryPicker === "function") {
        el("div", "pop-sep", null, pop);
        const bDir = el("button", "pop-item", state.backupDirHandle ? "📁 Carpeta respaldo: Activa ✓" : "📁 Vincular carpeta respaldo...", pop);
        bDir.onclick = async () => {
          closePopover();
          try {
            state.backupDirHandle = await w.showDirectoryPicker({ mode: "readwrite" });
            showToast("Carpeta de respaldo vinculada.");
            autosaveNow();
          } catch (_) {}
        };
      }
    });
  };

  btnZonas.onclick = () => {
    const r = btnZonas.getBoundingClientRect();
    showPopoverAt(r.left, r.bottom + 6, (pop) => {
      el("div", "pop-title", "Zonas y colores", pop);
      for (const z of state.zones.values()) {
        const row = el("div", "", null, pop);
        row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 4px;";
        const colorBtn = el("button", "swatch", "", row);
        colorBtn.style.background = z.color;
        colorBtn.style.width = "20px";
        colorBtn.style.height = "20px";
        colorBtn.title = "Cambiar color";
        colorBtn.onclick = () => openColorPickerPopover(colorBtn, z.color, (newColor) => {
          z.color = newColor;
          styleCache = new WeakMap();
          markDirty();
          refreshAll();
        });
        const nameSpan = el("span", "", z.name || z.id, row);
        nameSpan.style.cssText = "flex:1;font-size:12px;font-weight:600;cursor:pointer;";
        nameSpan.title = "Clic para renombrar";
        nameSpan.onclick = () => {
          const n = w.prompt("Nuevo nombre de zona:", z.name);
          if (n && n.trim()) { z.name = n.trim(); markDirty(); refreshAll(); closePopover(); }
        };
      }
      if (state.zones.size === 0) {
        const empty = el("div", "", "Sin zonas aún. Crea una o agrupa puntos.", pop);
        empty.style.cssText = "font-size:12px;color:var(--text-secondary);padding:4px 6px;";
      }
      el("div", "pop-sep", null, pop);
      const bAuto = el("button", "pop-item", "🎨 Auto-asignar colores alto contraste", pop);
      bAuto.disabled = state.zones.size === 0;
      bAuto.onclick = () => { closePopover(); autoAssignHighContrastZones(); };

      const bNew = el("button", "pop-item", "+ Nueva zona", pop);
      bNew.style.color = "var(--accent)";
      bNew.style.fontWeight = "600";
      bNew.onclick = () => {
        const n = w.prompt("Nombre de la nueva zona:", `Zona ${state.zones.size + 1}`);
        if (n && n.trim()) { createZone(n.trim()); closePopover(); }
      };
    });
  };

  function openColorPickerPopover(anchorEl, currentColor, onPick) {
    const r = anchorEl.getBoundingClientRect();
    showPopoverAt(r.right + 6, r.top, (pop) => {
      el("div", "pop-title", "Paleta alto contraste", pop);
      const grid = el("div", "palette-grid", null, pop);
      for (const c of HIGH_CONTRAST_PALETTE) {
        const sw = el("button", "swatch", "", grid);
        sw.style.background = c;
        if (c.toUpperCase() === currentColor.toUpperCase()) sw.style.outline = "2px solid #0F172A";
        sw.onclick = () => { onPick(c); closePopover(); };
      }
      el("div", "pop-sep", null, pop);
      const customRow = el("label", "pop-item", "Color libre: ", pop);
      customRow.style.justifyContent = "space-between";
      const inp = el("input", "", null, customRow);
      inp.type = "color";
      inp.value = isHex(currentColor) ? currentColor : "#00C853";
      inp.oninput = () => onPick(inp.value);
    });
  }

  btnVista.onclick = () => {
    const r = btnVista.getBoundingClientRect();
    showPopoverAt(r.left, r.bottom + 6, (pop) => {
      el("div", "pop-title", "Capas de análisis", pop);
      const bHulls = el("button", "pop-item", (state.showHulls ? "☑ " : "☐ ") + "Envolventes de zona", pop);
      bHulls.onclick = () => { state.showHulls = !state.showHulls; rebuildOverlayLayers(); closePopover(); };

      const bRoute = el("button", "pop-item", (state.showRoute ? "☑ " : "☐ ") + "Línea de ruta (1→2→3)", pop);
      bRoute.onclick = () => { state.showRoute = !state.showRoute; rebuildOverlayLayers(); closePopover(); };

      if (isMultiSupActive()) {
        const bColBy = el("button", "pop-item", `🎨 Colorear por: ${state.colorBy === "zone" ? "Zona" : "Supervisor"}`, pop);
        bColBy.onclick = () => {
          state.colorBy = state.colorBy === "zone" ? "supervisor" : "zone";
          styleCache = new WeakMap();
          rebuildOverlayLayers();
          closePopover();
        };
      }

      el("div", "pop-sep", null, pop);
      el("div", "pop-title", "Etiquetas de mapa", pop);
      for (const [val, lbl] of [["cerca", "Al acercar zoom"], ["siempre", "Siempre visibles"], ["ninguna", "Ocultar etiquetas"]]) {
        const b = el("button", "pop-item", (state.labelMode === val ? "● " : "○ ") + lbl, pop);
        b.onclick = () => { state.labelMode = val; styleCache = new WeakMap(); rebuildOverlayLayers(); closePopover(); };
      }
      const bTxt = el("button", "pop-item", state.labelContent === "numero" ? "Texto: Solo N° (clic para N° + Código)" : "Texto: N° + Código", pop);
      bTxt.onclick = () => {
        state.labelContent = state.labelContent === "numero" ? "completo" : "numero";
        styleCache = new WeakMap();
        rebuildOverlayLayers();
        closePopover();
      };

      el("div", "pop-sep", null, pop);
      el("div", "pop-title", "Detalle red MT/BT (WMTS)", pop);
      const mtRow = el("div", "", null, pop);
      mtRow.style.cssText = "display:flex;gap:4px;padding:4px;";
      for (const lvl of [0, 1, 2]) {
        const b = el("button", state.mtbtDetail === lvl ? "active-pill" : "btn-outline", lvl === 0 ? "Original" : `+${lvl}`, mtRow);
        b.style.flex = "1";
        b.style.justifyContent = "center";
        b.onclick = () => { setMtBtDetail(lvl); closePopover(); };
      }
    });
  };

  btnHerramientas.onclick = () => {
    const r = btnHerramientas.getBoundingClientRect();
    showPopoverAt(r.left, r.bottom + 6, (pop) => {
      const bPaste = el("button", "pop-item", "📋 Seleccionar por lista de códigos...", pop);
      bPaste.onclick = () => { closePopover(); openPasteCodesModal(); };

      const bTeam = el("button", "pop-item", "👥 Equipo / Supervisores (CC, TL, RD, JB)...", pop);
      bTeam.onclick = () => { closePopover(); openSupervisorsModal(); };

      el("div", "pop-sep", null, pop);
      const bPdf = el("button", "pop-item", "🖨 Exportar plano PDF (A1 / Atlas)...", pop);
      bPdf.onclick = () => { closePopover(); openAtlasPdfModal(); };
    });
  };

  // =========================================================================
  // 12. INTERACCIÓN CON EL MAPA OPENLAYERS (CLIC, CAJA, AGREGAR, VINCULAR)
  // =========================================================================
  function setCursorMode(mode, bannerMsg = "") {
    state.cursorMode = mode;
    btnModeNav.classList.toggle("active", mode === "nav");
    btnModeBox.classList.toggle("active", mode === "box");
    btnModeAdd.classList.toggle("active", mode === "add" || mode === "link-opening");

    const viewport = map.getViewport?.();
    if (viewport) {
      viewport.style.cursor = (mode === "add" || mode === "link-opening") ? "crosshair"
        : mode === "box" ? "crosshair" : "";
    }

    if (dragBoxInteraction) {
      map.removeInteraction(dragBoxInteraction);
      dragBoxInteraction = null;
    }

    if (ol.interaction?.DragBox) {
      dragBoxInteraction = new ol.interaction.DragBox({
        condition: mode === "box"
          ? () => true
          : (ol.events?.condition?.shiftKeyOnly || ((e) => e.originalEvent?.shiftKey))
      });
      dragBoxInteraction.on("boxend", () => {
        const extent = dragBoxInteraction.getGeometry().getExtent();
        const visible = new Set(getFilteredPoints());
        let added = 0;
        state.points.forEach((f, idx) => {
          if (!visible.has(f)) return;
          const xy = f.getGeometry().getCoordinates();
          if (xy[0] >= extent[0] && xy[0] <= extent[2] && xy[1] >= extent[1] && xy[1] <= extent[3]) {
            state.selected.add(idx);
            added++;
          }
        });
        renderTable();
        rebuildOverlayLayers();
        if (added) showToast(`${added} punto(s) seleccionado(s) en el área.`);
        if (mode === "box") setCursorMode("nav");
      });
      map.addInteraction(dragBoxInteraction);
    }

    if (bannerMsg) {
      modeBannerText.textContent = bannerMsg;
      modeBanner.classList.remove("hidden");
    } else {
      modeBanner.classList.add("hidden");
    }
  }

  function startLinkOpeningMode(indices) {
    state.pendingLinkIndices = indices;
    setCursorMode("link-opening", `Haz clic en una apertura (✕) del mapa o en un punto vacío para vincular ${indices.length} elemento(s)`);
  }

  const onMapSingleClick = (evt) => {
    closePopover();
    if (state.cursorMode === "add") {
      openDropPointPopover(evt.pixel, evt.coordinate, false);
      return;
    }
    if (state.cursorMode === "link-opening") {
      let hitOpening = null;
      map.forEachFeatureAtPixel(evt.pixel, (feat, layer) => {
        if (layer === vectorLayer && feat.get("tipo") === "APERTURA") {
          hitOpening = feat;
          return true;
        }
      });
      if (hitOpening) {
        const apId = String(hitOpening.get("id"));
        let count = 0;
        for (const idx of state.pendingLinkIndices) {
          const f = state.points[idx];
          if (f && f.get("tipo") !== "APERTURA") {
            const cur = Array.isArray(f.get("aperturasIds")) ? f.get("aperturasIds") : [];
            if (!cur.includes(apId)) f.set("aperturasIds", [...cur, apId]);
            count++;
          }
        }
        state.pendingLinkIndices = [];
        setCursorMode("nav");
        markDirty();
        refreshAll();
        showToast(`${count} poste(s) vinculados a apertura ${getPointCode(hitOpening)}.`);
      } else {
        openDropPointPopover(evt.pixel, evt.coordinate, true);
      }
      return;
    }

    let hitFeature = null;
    map.forEachFeatureAtPixel(evt.pixel, (feat, layer) => {
      if (layer === vectorLayer) {
        hitFeature = feat;
        return true;
      }
    });
    if (hitFeature) {
      const idx = state.points.indexOf(hitFeature);
      if (idx >= 0) {
        if (evt.originalEvent?.ctrlKey || evt.originalEvent?.metaKey) {
          if (state.selected.has(idx)) state.selected.delete(idx);
          else state.selected.add(idx);
          renderTable();
          rebuildOverlayLayers();
        } else {
          state.focused = idx;
          renderTable();
          rebuildOverlayLayers();
          tbody.querySelector(`tr[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
        }
      }
    }
  };

  const onMapContextMenu = (ev) => {
    const pixel = map.getEventPixel(ev);
    let hit = null;
    map.forEachFeatureAtPixel(pixel, (feat, layer) => {
      if (layer === vectorLayer) {
        hit = feat;
        return true;
      }
    });
    if (!hit) return;
    ev.preventDefault();
    const idx = state.points.indexOf(hit);
    if (idx < 0) return;
    if (!state.selected.has(idx)) {
      state.selected.clear();
      state.selected.add(idx);
      renderTable();
      rebuildOverlayLayers();
    }
    openContextMenu(ev.clientX, ev.clientY, idx);
  };

  map.on("singleclick", onMapSingleClick);
  map.getViewport?.()?.addEventListener("contextmenu", onMapContextMenu);

  function openDropPointPopover(pixel, coordinate, forceOpening) {
    if (addPointDropCoord) addPointDropCoord.remove();
    const mapRect = map.getViewport().getBoundingClientRect();
    const form = el("div", "pin-form");
    form.style.left = Math.min(mapRect.left + pixel[0] + 10, w.innerWidth - 275) + "px";
    form.style.top = Math.min(mapRect.top + pixel[1] + 10, w.innerHeight - 210) + "px";

    el("strong", "", forceOpening ? "Nueva apertura vinculada" : "Nuevo punto en mapa", form);
    const inpCode = el("input", "", null, form);
    inpCode.type = "text";
    inpCode.placeholder = forceOpening ? "Código apertura (ej. DF-412)" : "Código poste / equipo";

    const selType = el("select", "", null, form);
    const optP = el("option", "", "Poste / Punto", selType); optP.value = "PUNTO";
    const optA = el("option", "", "Apertura (✕ roja)", selType); optA.value = "APERTURA";
    selType.value = forceOpening ? "APERTURA" : "PUNTO";
    selType.disabled = forceOpening;

    const btnRow = el("div", "", null, form);
    btnRow.style.cssText = "display:flex;gap:6px;justify-content:flex-end;";
    const bCancel = el("button", "btn-outline", "Cancelar", btnRow);
    const bSave = el("button", "btn-primary", "Crear", btnRow);

    const cleanup = () => {
      form.remove();
      addPointDropCoord = null;
      state.pendingLinkIndices = [];
      setCursorMode("nav");
    };

    const submit = () => {
      const code = inpCode.value.trim() || "Sin código";
      const tipo = selType.value;
      const usedIds = new Set(state.points.map(p => String(p.get("id"))));
      let n = state.points.length + 1;
      const prefix = tipo === "APERTURA" ? "ap-" : "marker-";
      while (usedIds.has(prefix + n)) n++;
      const newId = prefix + n;
      const nextNum = 1 + Math.max(0, ...state.points.filter(p => (p.get("tipo") || "PUNTO") === tipo).map(p => Number(p.get("numero")) || 0));

      const feat = new ol.Feature({
        geometry: new ol.geom.Point(coordinate),
        id: newId,
        numero: nextNum,
        tipo,
        codigo: code,
        bloqueId: "",
        bloques: [],
        aperturasIds: [],
        supervisorId: "default"
      });
      state.points.push(feat);

      if (forceOpening && state.pendingLinkIndices.length) {
        for (const idx of state.pendingLinkIndices) {
          const p = state.points[idx];
          if (p && p.get("tipo") !== "APERTURA") {
            const cur = Array.isArray(p.get("aperturasIds")) ? p.get("aperturasIds") : [];
            p.set("aperturasIds", [...cur, newId]);
          }
        }
      }

      ensureVectorLayer();
      markDirty();
      refreshAll();
      cleanup();
      showToast(forceOpening ? `Apertura ${code} creada y vinculada.` : `Punto ${code} creado.`);
    };

    bCancel.onclick = cleanup;
    bSave.onclick = submit;
    inpCode.onkeydown = (ev) => {
      if (ev.key === "Enter") submit();
      if (ev.key === "Escape") cleanup();
    };
    addPointDropCoord = form;
    w.setTimeout(() => inpCode.focus(), 20);
  }

  btnModeNav.onclick = () => setCursorMode("nav");
  btnModeBox.onclick = () => setCursorMode("box", "Arrastra un rectángulo sobre el mapa para seleccionar puntos");
  btnModeAdd.onclick = () => setCursorMode("add", "Haz clic en el mapa para ubicar el nuevo punto");
  modeBannerCancel.onclick = () => { state.pendingLinkIndices = []; setCursorMode("nav"); };

  // =========================================================================
  // 13. CARGA INTELIGENTE DE ARCHIVOS (CONTENT-SNIFFING) + EXPORTACIÓN
  // =========================================================================
  async function readKmzBytes(ab) {
    const v = new DataView(ab);
    let end = -1;
    for (let i = ab.byteLength - 22; i >= Math.max(0, ab.byteLength - 65557); --i) {
      if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw Error("Índice ZIP no válido.");
    const total = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    const list = [];
    for (let i = 0; i < total; i++) {
      const metodo = v.getUint16(p + 10, true);
      const comp = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true);
      const el = v.getUint16(p + 30, true);
      const cl = v.getUint16(p + 32, true);
      const loc = v.getUint32(p + 42, true);
      const nombre = new TextDecoder().decode(new Uint8Array(ab, p + 46, nl));
      if (nombre.toLowerCase().endsWith(".kml") && !nombre.startsWith("__MACOSX/")) {
        list.push({ nombre, metodo, comp, loc });
      }
      p += 46 + nl + el + cl;
    }
    list.sort((a, b) => Number(b.nombre.toLowerCase().endsWith("doc.kml")) - Number(a.nombre.toLowerCase().endsWith("doc.kml")));
    const a = list[0];
    if (!a) throw Error("El KMZ no contiene ningún KML.");
    const inicio = a.loc + 30 + v.getUint16(a.loc + 26, true) + v.getUint16(a.loc + 28, true);
    const bytes = new Uint8Array(ab, inicio, a.comp);
    if (a.metodo === 0) return new TextDecoder().decode(bytes);
    if (a.metodo !== 8) throw Error("Compresión ZIP no compatible.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  function extractGeoms(g) {
    if (!g) return [];
    const t = g.getType();
    if (t === "Point") return [g.getCoordinates()];
    if (t === "MultiPoint") return g.getCoordinates();
    if (t === "GeometryCollection") return g.getGeometries().flatMap(extractGeoms);
    return [];
  }

  function loadProjectData(data) {
    state.zones.clear();
    let idx = 0;
    for (const b of data.bloques || []) {
      const color = isHex(b.color) ? b.color : HIGH_CONTRAST_PALETTE[idx % HIGH_CONTRAST_PALETTE.length];
      state.zones.set(b.id, { id: b.id, name: b.nombre || b.id, color });
      idx++;
    }
    if (Array.isArray(data.supervisors)) {
      state.supervisors.clear();
      for (const s of data.supervisors) {
        if (s?.id) state.supervisors.set(s.id, { ...s });
      }
    } else {
      state.supervisors = new Map(DEFAULT_SUPERVISORS.map(s => [s.id, { ...s }]));
    }
    state.multiSupervisorEnabled = Boolean(data.multiSupervisorEnabled);

    const feats = (data.registros || []).map(r => {
      const sid = r.supervisorId || LEGACY_COLOR_TO_SUP[r.supervisorColor] || "default";
      return new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([Number(r.longitud), Number(r.latitud)], map.getView().getProjection())),
        id: String(r.id),
        numero: Number(r.numero),
        tipo: r.tipo || "PUNTO",
        codigo: String(r.codigo || ""),
        supervisorId: sid,
        bloqueId: String(r.bloqueId || ""),
        bloques: Array.isArray(r.bloques) ? r.bloques : [],
        aperturasIds: Array.isArray(r.aperturasIds) ? r.aperturasIds : [],
        tipoEquipo: String(r.tipoEquipo || ""),
        colorPersonalizado: String(r.colorPersonalizado || "")
      });
    });

    state.projectId = data.id || ("proj-" + Date.now());
    state.projectName = data.nombre || "Proyecto importado";
    projNameInput.value = state.projectName;
    state.points = feats;
    state.selected.clear();
    state.focused = -1;
    state.filterZones.clear();
    state.filterSups.clear();
    styleCache = new WeakMap();
    ensureVectorLayer();
    refreshAll();
    fitPoints(state.points.map((_, i) => i));
    autosaveNow();
  }

  async function handleSmartFile(file) {
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      const head = new Uint8Array(ab.slice(0, 4));
      const isZip = head[0] === 0x50 && head[1] === 0x4B;

      if (isZip) {
        const kmlText = await readKmzBytes(ab);
        await applyKmlText(kmlText, file.name.replace(/\.(kmz|kml)$/i, ""));
        return;
      }

      const text = new TextDecoder().decode(ab).replace(/^\ufeff/, "").trim();
      if (text.startsWith("{")) {
        const data = JSON.parse(text);
        if (data?.formato === "CentralityLocal" && Array.isArray(data.registros)) {
          if (state.points.length > 0 && state.dirty) {
            if (!w.confirm("¿Abrir este proyecto y reemplazar el actual?")) return;
          }
          loadProjectData(data);
          closeModal();
          showToast(`Proyecto cargado (${state.points.length} puntos).`);
          return;
        }
      }

      if (text.includes("<kml") || text.includes("<Placemark")) {
        await applyKmlText(text, file.name.replace(/\.(kmz|kml)$/i, ""));
        return;
      }

      // CSV simple (recorrido o aperturas)
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length >= 2 && (lines[0].includes(";") || lines[0].includes(","))) {
        const sep = lines[0].includes(";") ? ";" : ",";
        const cols = lines[0].split(sep).map(c => c.trim().toLowerCase());
        const lonIdx = cols.findIndex(c => c.includes("long"));
        const latIdx = cols.findIndex(c => c.includes("lat"));
        const codeIdx = cols.findIndex(c => c.includes("subest") || c.includes("cod"));
        if (lonIdx >= 0 && latIdx >= 0) {
          const isOpeningCsv = cols.some(c => c === "bloques") && !cols.some(c => c.includes("subest"));
          const feats = [];
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(sep);
            const lon = Number(String(parts[lonIdx] || "").replace(",", "."));
            const lat = Number(String(parts[latIdx] || "").replace(",", "."));
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            feats.push(new ol.Feature({
              geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat], map.getView().getProjection())),
              id: `${isOpeningCsv ? "ap" : "marker"}-${i}`,
              numero: i,
              tipo: isOpeningCsv ? "APERTURA" : "PUNTO",
              codigo: String(parts[codeIdx] || `Punto ${i}`).trim(),
              bloqueId: "",
              bloques: [],
              aperturasIds: [],
              supervisorId: "default"
            }));
          }
          if (!feats.length) throw Error("No se encontraron coordenadas válidas en el CSV.");
          const append = state.points.length > 0 && w.confirm("Ya hay puntos en el mapa.\nAceptar = Agregar al proyecto actual\nCancelar = Iniciar proyecto nuevo");
          if (!append) {
            state.points = feats;
            state.zones.clear();
            state.projectId = "proj-" + Date.now();
            state.projectName = file.name.replace(/\.csv$/i, "");
            projNameInput.value = state.projectName;
          } else {
            state.points.push(...feats);
          }
          ensureVectorLayer();
          refreshAll();
          fitPoints(state.points.map((_, i) => i));
          closeModal();
          autosaveNow();
          showToast(`Importados ${feats.length} registros desde CSV.`);
          return;
        }
      }

      throw Error("Formato de archivo no reconocido. Usa KMZ, KML, Proyecto JSON o CSV con coordenadas.");
    } catch (e) {
      showToast("Error al abrir: " + e.message, true);
    } finally {
      hiddenFileInput.value = "";
    }
  }

  async function applyKmlText(kmlText, baseName) {
    const xml = new DOMParser().parseFromString(kmlText, "application/xml");
    if (xml.querySelector("parsererror")) throw Error("El KML interno no es XML válido.");
    const fmt = new ol.format.KML({ extractStyles: false, showPointNames: false });
    const rawFeats = fmt.readFeatures(kmlText, {
      dataProjection: "EPSG:4326",
      featureProjection: map.getView().getProjection()
    });
    const newFeats = [];
    for (const orig of rawFeats) {
      const code = String(orig.get("name") || "").trim() || "Sin código";
      for (const xy of extractGeoms(orig.getGeometry())) {
        if (!xy.every(Number.isFinite)) continue;
        newFeats.push(new ol.Feature({
          geometry: new ol.geom.Point(xy),
          id: "marker-" + (newFeats.length + 1),
          numero: newFeats.length + 1,
          tipo: "PUNTO",
          codigo: code,
          bloqueId: "",
          bloques: [],
          aperturasIds: [],
          supervisorId: "default"
        }));
      }
    }
    if (!newFeats.length) throw Error("El archivo KMZ/KML no contiene puntos.");

    let append = false;
    if (state.points.length > 0) {
      append = w.confirm(`Ya tienes ${state.points.length} punto(s) cargados.\n\nAceptar = AGREGAR estos ${newFeats.length} puntos al proyecto actual\nCancelar = CREAR un proyecto nuevo con este archivo`);
    }

    if (append) {
      const startNum = 1 + Math.max(0, ...state.points.map(p => Number(p.get("numero")) || 0));
      newFeats.forEach((f, i) => {
        f.set("numero", startNum + i);
        f.set("id", `marker-${startNum + i}-${Date.now()}`);
      });
      state.points.push(...newFeats);
    } else {
      state.projectId = "proj-" + Date.now();
      state.projectName = baseName || "Nuevo proyecto";
      projNameInput.value = state.projectName;
      state.points = newFeats;
      state.zones.clear();
      state.selected.clear();
      state.focused = -1;
    }
    styleCache = new WeakMap();
    ensureVectorLayer();
    refreshAll();
    fitPoints(state.points.map((_, i) => i));
    closeModal();
    await autosaveNow();
    showToast(`${newFeats.length} puntos cargados desde ${baseName}.`);
  }

  hiddenFileInput.onchange = () => handleSmartFile(hiddenFileInput.files?.[0]);

  function downloadBlob(name, content, mime) {
    const url = w.URL.createObjectURL(new Blob([content], { type: mime }));
    const a = doc.createElement("a");
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    w.setTimeout(() => w.URL.revokeObjectURL(url), 2000);
  }

  function downloadJSON() {
    const payload = serializeProjectPayload();
    const safe = state.projectName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "centrality-proyecto";
    downloadBlob(safe + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    showToast("Copia JSON descargada.");
  }

  function downloadCSV() {
    const q = (v) => {
      const s = String(v ?? "");
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [["Tipo", "Numero", "Codigo", "Longitud", "Latitud", "Zona", "Supervisor"]];
    for (const f of state.points) {
      const [lon, lat] = ol.proj.toLonLat(f.getGeometry().getCoordinates(), map.getView().getProjection());
      const zids = getPointZoneIds(f).map(id => state.zones.get(id)?.name || id).join("|");
      const sup = state.supervisors.get(getSupId(f))?.name || "Sin asignar";
      rows.push([f.get("tipo") || "PUNTO", f.get("numero"), getPointCode(f), lon, lat, zids, sup]);
    }
    const safe = state.projectName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "centrality-tabla";
    downloadBlob(safe + ".csv", "\ufeff" + rows.map(r => r.map(q).join(";")).join("\r\n"), "text/csv;charset=utf-8");
    showToast("Tabla CSV exportada.");
  }

  // =========================================================================
  // 14. MODALES: INICIO/RECIENTES, PEGAR CÓDIGOS, SUPERVISORES, ATLAS PDF
  // =========================================================================
  function closeModal() {
    modalBackdrop.classList.add("hidden");
    modalBackdrop.replaceChildren();
  }

  async function openStartModal() {
    modalBackdrop.replaceChildren();
    modalBackdrop.classList.remove("hidden");
    const card = el("div", "modal-card", null, modalBackdrop);
    const head = el("div", "modal-head", null, card);
    el("h2", "", "Centrality · Proyectos", head);
    if (state.points.length > 0) {
      const bClose = el("button", "btn-outline", "Volver al mapa", head);
      bClose.onclick = closeModal;
    }

    const body = el("div", "modal-body", null, card);
    const dz = el("div", "dropzone", null, body);
    el("div", "", "📂 Arrastra aquí un KMZ, KML, Proyecto (.json) o CSV", dz).style.fontWeight = "700";
    el("div", "", "Detección automática de formato · o haz clic para examinar", dz).style.cssText = "font-size:12px;color:var(--text-secondary);margin-top:4px;";
    dz.onclick = () => hiddenFileInput.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("drag"); };
    dz.ondragleave = () => dz.classList.remove("drag");
    dz.ondrop = (e) => {
      e.preventDefault();
      dz.classList.remove("drag");
      handleSmartFile(e.dataTransfer?.files?.[0]);
    };

    const recHeader = el("div", "", "Proyectos recientes (guardados automáticamente)", body);
    recHeader.style.cssText = "font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;margin-top:6px;";

    const recList = el("div", "", null, body);
    recList.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    try {
      const projs = await dbListProjects();
      if (!projs.length) {
        const empty = el("div", "", "Aún no tienes proyectos guardados en este navegador.", recList);
        empty.style.cssText = "font-size:12px;color:var(--text-secondary);padding:8px 0;";
      } else {
        for (const p of projs.slice(0, 8)) {
          const item = el("div", "recent-item", null, recList);
          const info = el("div", "", null, item);
          el("div", "", p.name, info).style.fontWeight = "600";
          const dt = new Date(p.updatedAt || Date.now()).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
          el("div", "", `${p.pointCount || 0} puntos · ${p.zoneCount || 0} zonas · ${dt}`, info).style.cssText = "font-size:11px;color:var(--text-secondary);";

          const actions = el("div", "", null, item);
          actions.style.cssText = "display:flex;gap:4px;";
          const bDel = el("button", "btn-outline", "🗑", actions);
          bDel.title = "Eliminar del historial local";
          bDel.onclick = async (ev) => {
            ev.stopPropagation();
            await dbDeleteProject(p.id);
            openStartModal();
          };
          item.onclick = () => {
            loadProjectData(p.payload);
            closeModal();
            showToast(`Abierto: ${p.name}`);
          };
        }
      }
    } catch (e) {
      el("div", "", "No se pudo leer IndexedDB.", recList);
    }
  }

  function openPasteCodesModal() {
    modalBackdrop.replaceChildren();
    modalBackdrop.classList.remove("hidden");
    const card = el("div", "modal-card", null, modalBackdrop);
    const head = el("div", "modal-head", null, card);
    el("h2", "", "Seleccionar por lista de códigos", head);
    const bClose = el("button", "btn-outline", "×", head);
    bClose.onclick = closeModal;

    const body = el("div", "modal-body", null, card);
    el("div", "", "Pega códigos de postes o aperturas desde Excel o WhatsApp (uno por línea, o separados por coma/espacio):", body).style.fontSize = "12px";
    const ta = el("textarea", "", null, body);
    ta.style.cssText = "width:100%;height:170px;border:1px solid var(--border);border-radius:8px;padding:10px;font:12px monospace;";
    ta.placeholder = "626402\nBE9950\n626401";

    const footer = el("div", "", null, body);
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
    const bCancel = el("button", "btn-outline", "Cancelar", footer);
    bCancel.onclick = closeModal;
    const bRun = el("button", "btn-primary", "Buscar y seleccionar en mapa", footer);
    bRun.onclick = () => {
      const tokens = [...new Set(ta.value.split(/[\s,;|]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
      if (!tokens.length) return;
      state.selected.clear();
      const matched = [];
      const missing = [];
      for (const tok of tokens) {
        const foundIdx = state.points.findIndex(f => getPointCode(f).toUpperCase() === tok || String(f.get("numero")) === tok);
        if (foundIdx >= 0) {
          state.selected.add(foundIdx);
          matched.push(foundIdx);
        } else {
          missing.push(tok);
        }
      }
      renderTable();
      rebuildOverlayLayers();
      if (matched.length) fitPoints(matched);
      closeModal();
      showToast(missing.length ? `${matched.length} seleccionados · ${missing.length} no encontrados (${missing.slice(0, 3).join(", ")}...)` : `${matched.length} puntos seleccionados.`);
    };
  }

  function openSupervisorsModal() {
    modalBackdrop.replaceChildren();
    modalBackdrop.classList.remove("hidden");
    const card = el("div", "modal-card", null, modalBackdrop);
    const head = el("div", "modal-head", null, card);
    el("h2", "", "Equipo y modo multi-supervisor", head);
    const bClose = el("button", "btn-outline", "Listo", head);
    bClose.onclick = () => { closeModal(); refreshAll(); };

    const body = el("div", "modal-body", null, card);
    const chkRow = el("label", "", null, body);
    chkRow.style.cssText = "display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;background:var(--bg-muted);padding:10px;border-radius:8px;";
    const chk = el("input", "", null, chkRow);
    chk.type = "checkbox";
    chk.checked = state.multiSupervisorEnabled;
    el("span", "", "Mostrar columna y filtros por supervisor (para repartir una zona entre varios)", chkRow);
    chk.onchange = () => { state.multiSupervisorEnabled = chk.checked; markDirty(); refreshAll(); };

    for (const s of state.supervisors.values()) {
      if (s.id === "default") continue;
      const row = el("div", "", null, body);
      row.style.cssText = "display:flex;align-items:center;gap:8px;border:1px solid var(--border);padding:8px;border-radius:8px;";
      const sw = el("button", "swatch", "", row);
      sw.style.background = s.color;
      sw.onclick = () => openColorPickerPopover(sw, s.color, (c) => {
        s.color = c;
        sw.style.background = c;
        styleCache = new WeakMap();
        markDirty();
        refreshAll();
      });
      el("strong", "", s.initials, row).style.width = "30px";
      el("span", "", s.name, row).style.flex = "1";
    }
  }

  // =========================================================================
  // 15. DETALLE MT/BT (WMTS) + MODAL ATLAS PDF A1 (MOTOR PRESERVADO)
  // =========================================================================
  const MTBT_LAYERS = new Set([
    "webmap.distribution.medium_voltage",
    "webmap.distribution.low_voltage",
    "webmap.infrastructure"
  ]);
  const mtbtSources = new Set();
  const originalGrids = new Map();
  (function scanLayers(col) {
    for (const layer of col?.getArray?.() || []) {
      const name = layer.get?.("title") || layer.get?.("name");
      if (MTBT_LAYERS.has(name)) {
        const src = layer.getSource?.();
        const grid = src?.getTileGrid?.();
        if (grid && typeof grid.getZForResolution === "function") {
          if (!originalGrids.has(grid)) originalGrids.set(grid, grid.getZForResolution);
          mtbtSources.add(src);
        }
      }
      if (layer.getLayers) scanLayers(layer.getLayers());
    }
  })(map.getLayers());

  function setMtBtDetail(n) {
    state.mtbtDetail = Number(n) || 0;
    for (const [grid, orig] of originalGrids) {
      grid.getZForResolution = !state.mtbtDetail ? orig : function (res, dir) {
        const z = orig.call(this, res, dir);
        const max = Number.isFinite(this.getMaxZoom?.()) ? this.getMaxZoom() : z + 2;
        return Math.min(max, z + state.mtbtDetail);
      };
    }
    mtbtSources.forEach(s => s.changed?.());
    map.render?.();
    showToast(state.mtbtDetail ? `Detalle MT/BT forzado +${state.mtbtDetail}` : "Detalle MT/BT original");
  }

  function openAtlasPdfModal() {
    if (!state.points.length) { showToast("Carga puntos primero para generar planos.", true); return; }
    modalBackdrop.replaceChildren();
    modalBackdrop.classList.remove("hidden");
    const card = el("div", "modal-card", null, modalBackdrop);
    const head = el("div", "modal-head", null, card);
    el("h2", "", "Exportar Planos PDF (A1 / Atlas)", head);
    const bClose = el("button", "btn-outline", "×", head);
    bClose.onclick = () => { if (!atlasRunning) closeModal(); };

    const body = el("div", "modal-body", null, card);
    const selModo = el("select", "", null, body);
    selModo.style.cssText = "padding:8px;border:1px solid var(--border);border-radius:6px;";
    [["ambos", "Plano general + Atlas de detalle"], ["general", "Solo Plano general"], ["atlas", "Solo Atlas de detalle"]].forEach(([v, t]) => {
      const o = el("option", "", t, selModo); o.value = v;
    });

    const row2 = el("div", "", null, body);
    row2.style.cssText = "display:flex;gap:8px;";
    const selPapel = el("select", "", null, row2);
    selPapel.style.cssText = "flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;";
    [["A1L", "A1 Horizontal (841×594 mm)"], ["A1P", "A1 Vertical"], ["A3L", "A3 Horizontal"], ["A4L", "A4 Horizontal"]].forEach(([v, t]) => {
      const o = el("option", "", t, selPapel); o.value = v;
    });
    const selDpi = el("select", "", null, row2);
    selDpi.style.cssText = "flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;";
    [["100", "100 dpi (Recomendado)"], ["150", "150 dpi (Alta)"], ["75", "75 dpi (Rápido)"]].forEach(([v, t]) => {
      const o = el("option", "", t, selDpi); o.value = v;
    });

    const status = el("div", "", "Listo para preparar la exportación.", body);
    status.style.cssText = "font-size:12px;color:var(--text-secondary);background:var(--bg-muted);padding:10px;border-radius:8px;";

    const footer = el("div", "", null, body);
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
    const bPrep = el("button", "btn-primary", "Preparar planos", footer);
    const bPrint = el("button", "btn-outline", "Abrir e imprimir / Guardar PDF", footer);
    bPrint.disabled = true;

    const PAPERS = { A1L: [841, 594], A1P: [594, 841], A3L: [420, 297], A4L: [297, 210] };
    const getRes = (z) => map.getView().getResolutionForZoom?.(z) ?? (map.getView().getResolution() * Math.pow(2, map.getView().getZoom() - z));

    bPrep.onclick = async () => {
      if (atlasRunning) return;
      atlasRunning = true;
      atlasCancel = false;
      bPrep.disabled = true;
      bPrint.disabled = true;
      try {
        const dpi = Number(selDpi.value);
        const [wMm, hMm] = PAPERS[selPapel.value];
        const size = [Math.round((wMm - 20) * dpi / 25.4), Math.round((hMm - 36) * dpi / 25.4)];
        const vis = getFilteredPoints().map(f => ({
          numero: String(f.get("numero")),
          codigo: getPointCode(f),
          tipo: f.get("tipo") || "PUNTO",
          color: getPointColor(f),
          xy: f.getGeometry().getCoordinates().slice(0, 2)
        }));
        const xs = vis.map(p => p.xy[0]), ys = vis.map(p => p.xy[1]);
        const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
        const tasks = [];
        if (selModo.value !== "atlas") {
          const res = Math.max((xmax - xmin) * 1.14 / size[0], (ymax - ymin) * 1.14 / size[1], getRes(18));
          tasks.push({ center: [(xmin + xmax) / 2, (ymin + ymax) / 2], resolution: res, titulo: "Plano general" });
        }
        if (selModo.value !== "general") {
          const res = getRes(16.5) * 100 / dpi;
          const width = size[0] * res, height = size[1] * res;
          const sx = width * 0.88, sy = height * 0.88;
          const cols = Math.max(1, 1 + Math.ceil(Math.max(0, xmax - xmin - width) / sx));
          const rows = Math.max(1, 1 + Math.ceil(Math.max(0, ymax - ymin - height) / sy));
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            tasks.push({
              center: [cols === 1 ? (xmin + xmax) / 2 : xmin + width / 2 + c * sx, rows === 1 ? (ymin + ymax) / 2 : ymax - height / 2 - r * sy],
              resolution: res,
              titulo: "Detalle MT/BT"
            });
          }
        }
        if (tasks.length > 40 && !w.confirm(`Se generarán ${tasks.length} páginas. ¿Continuar?`)) throw Error("Cancelado.");

        const target = doc.createElement("div");
        target.style.cssText = `position:fixed;left:0;top:0;width:${size[0]}px;height:${size[1]}px;overflow:hidden;pointer-events:none;opacity:0.01;z-index:-1;`;
        doc.body.appendChild(target);
        const layers = [];
        const allowed = new Set(["webmap.osm", "webmap.gm", "webmap.gs", "webmap.cartography", "webmap.distribution.medium_voltage", "webmap.distribution.low_voltage", "webmap.infrastructure"]);
        (function walk(col) {
          for (const l of col?.getArray?.() || []) {
            if (l.getVisible?.() === false) continue;
            if (l.getLayers) { walk(l.getLayers()); continue; }
            const n = l.get?.("title") || l.get?.("name");
            if (allowed.has(n) && l.getSource?.()) {
              const Cls = (ol.source?.ImageWMS && l.getSource() instanceof ol.source.ImageWMS) ? ol.layer.Image : ol.layer.Tile;
              layers.push(new Cls({ source: l.getSource(), visible: true, opacity: l.getOpacity?.() ?? 1 }));
            }
          }
        })(map.getLayers());

        const rMap = new ol.Map({
          target, layers, pixelRatio: 1, controls: [], interactions: [],
          view: new ol.View({ projection: map.getView().getProjection(), center: map.getView().getCenter().slice(), resolution: getRes(15) })
        });
        rMap.updateSize();
        rendererExport = { rendererMap: rMap, target };

        atlasCaptures = [];
        for (let i = 0; i < tasks.length; i++) {
          if (atlasCancel) throw Error("Cancelado.");
          status.textContent = `Renderizando hoja ${i + 1} de ${tasks.length}...`;
          rMap.getView().setCenter(tasks[i].center);
          rMap.getView().setResolution(tasks[i].resolution);
          await new Promise(res => {
            const done = () => { rMap.un("rendercomplete", done); res(); };
            rMap.on("rendercomplete", done);
            w.setTimeout(done, 12000);
            rMap.renderSync();
          });
          const canvas = doc.createElement("canvas");
          canvas.width = size[0]; canvas.height = size[1];
          const ctx = canvas.getContext("2d", { alpha: false });
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size[0], size[1]);
          for (const c of rMap.getViewport().querySelectorAll("canvas")) {
            if (c.width > 0 && c.height > 0) ctx.drawImage(c, 0, 0);
          }
          const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
          const url = w.URL.createObjectURL(blob);
          atlasCaptures.push({ ...tasks[i], image: url, size, dpi, vis });
        }
        bPrint.disabled = false;
        status.textContent = `Listo: ${atlasCaptures.length} página(s) preparadas.`;
      } catch (e) {
        status.textContent = "Detenido: " + e.message;
      } finally {
        if (rendererExport) {
          try { rendererExport.rendererMap.setTarget(null); rendererExport.target.remove(); } catch (_) {}
          rendererExport = null;
        }
        atlasRunning = false;
        bPrep.disabled = false;
      }
    };

    bPrint.onclick = () => {
      if (!atlasCaptures?.length) return;
      const [wMm, hMm] = PAPERS[selPapel.value];
      const win = w.open("", "_blank");
      if (!win) return showToast("Permite ventanas emergentes para imprimir.", true);
      const pages = atlasCaptures.map((p, i) => {
        const [W, H] = p.size;
        const svg = p.vis.map(pt => {
          const x = W / 2 + (pt.xy[0] - p.center[0]) / p.resolution;
          const y = H / 2 - (pt.xy[1] - p.center[1]) / p.resolution;
          if (x < 0 || x > W || y < 0 || y > H) return "";
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${pt.color}" stroke="#fff" stroke-width="2"/>` +
            `<text x="${(x + 9).toFixed(1)}" y="${(y - 9).toFixed(1)}" font-family="Arial" font-size="14" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3" fill="#0f172a">${esc(pt.numero)}</text>`;
        }).join("");
        return `<section class="sheet"><header><b>${esc(state.projectName)} · ${esc(p.titulo)} (${i + 1}/${atlasCaptures.length})</b></header><div class="frame"><img src="${p.image}"><svg viewBox="0 0 ${W} ${H}">${svg}</svg></div></section>`;
      }).join("");
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(state.projectName)}</title><style>@page{size:${wMm}mm ${hMm}mm;margin:0}body{margin:0;background:#e2e8f0;font:12px Arial}.bar{padding:10px;background:#0f172a;color:#fff}.sheet{width:${wMm}mm;height:${hMm}mm;padding:8mm 10mm;background:#fff;margin:10px auto;display:flex;flex-direction:column;page-break-after:always}.frame{flex:1;position:relative;overflow:hidden}.frame img,.frame svg{position:absolute;inset:0;width:100%;height:100%}@media print{.bar{display:none}.sheet{margin:0}}</style></head><body><div class="bar"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>${pages}</body></html>`);
      win.document.close();
    };
  }

  // =========================================================================
  // 16. EVENTOS GLOBALES, ATAJOS Y CICLO DE VIDA
  // =========================================================================
  searchInput.oninput = () => {
    state.search = searchInput.value;
    refreshAll();
  };

  const stepFocus = (delta) => {
    const visible = getFilteredPoints();
    if (!visible.length) return;
    const curPos = visible.findIndex(f => state.points.indexOf(f) === state.focused);
    const nextPos = curPos < 0 ? 0 : (curPos + delta + visible.length) % visible.length;
    navigateTo(state.points.indexOf(visible[nextPos]));
  };
  btnPrev.onclick = () => stepFocus(-1);
  btnNext.onclick = () => stepFocus(1);

  btnToggleDrawer.onclick = () => {
    state.drawerOpen = !state.drawerOpen;
    drawer.classList.toggle("hidden", !state.drawerOpen);
    btnToggleDrawer.classList.toggle("active-pill", state.drawerOpen);
  };

  btnCollapse.onclick = () => {
    state.collapsed = true;
    topbar.style.display = "none";
    dock.style.display = "none";
    drawer.style.display = "none";
    fab.classList.remove("hidden");
  };

  fab.onclick = () => {
    state.collapsed = false;
    topbar.style.display = "";
    dock.style.display = "";
    drawer.style.display = "";
    fab.classList.add("hidden");
  };

  const onKeyDown = (ev) => {
    if (ev.key === "Escape") {
      closePopover();
      if (state.cursorMode !== "nav") {
        state.pendingLinkIndices = [];
        setCursorMode("nav");
      } else if (state.selected.size > 0) {
        state.selected.clear();
        refreshAll();
      }
    }
  };
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("mousedown", (ev) => {
    if (activePopover && !ev.composedPath().includes(activePopover)) {
      closePopover();
    }
  });

  function destroy() {
    w.clearTimeout(autosaveTimer);
    atlasCancel = true;
    setCursorMode("nav");
    if (dragBoxInteraction) map.removeInteraction(dragBoxInteraction);
    map.un("singleclick", onMapSingleClick);
    map.getViewport?.()?.removeEventListener("contextmenu", onMapContextMenu);
    doc.removeEventListener("keydown", onKeyDown);
    if (vectorLayer) map.removeLayer(vectorLayer);
    if (hullLayer) map.removeLayer(hullLayer);
    if (routeLayer) map.removeLayer(routeLayer);
    setMtBtDetail(0);
    host.remove();
    if (w.__centralityV10?.destroy === destroy) delete w.__centralityV10;
  }

  btnClose.onclick = destroy;

  w.__centralityV10 = {
    destroy,
    toggle: () => state.collapsed ? fab.click() : btnCollapse.click(),
    openRecent: openStartModal
  };

  // Inicialización
  setCursorMode("nav");
  refreshAll();
  openStartModal();
})();
