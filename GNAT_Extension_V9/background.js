// Launcher de Centrality V9: requiere un clic del usuario en la pestaña activa.
// No usa depuración remota, no obtiene cookies y no solicita permisos globales.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    const [inspection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN", // V9 necesita acceder a webMap_ y OpenLayers del sitio.
      func: () => {
        const iframe = document.querySelector("iframe#content");
        if (!iframe) {
          return { status: "not_ready", message: "Abre el módulo Mapas en GNAT antes de pulsar Centrality Local." };
        }
        try {
          const w = iframe.contentWindow;
          if (!w?.webMap_?.map || !w?.ol) {
            return { status: "not_ready", message: "El mapa todavía no está listo. Abre Mapas y deja que cargue." };
          }
          if (typeof w.__superponerKMZ?.abrirPlanilla === "function") {
            return { status: "running" };
          }
          return { status: "ready" };
        } catch (_) {
          return { status: "not_ready", message: "No se puede acceder al mapa dentro del iframe. Revisa la sesión de GNAT." };
        }
      }
    });

    const state = inspection?.result;
    if (state?.status === "running") {
      // Evitar inyectar V9 nuevamente y perder ediciones pendientes.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => {
          const w = document.querySelector("iframe#content")?.contentWindow;
          w?.__superponerKMZ?.abrirPlanilla?.();
        }
      });
      return;
    }
    if (state?.status === "ready") {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        files: ["centrality_v9.js"]
      });
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (message) => alert(message),
      args: [state?.message || "Abre el módulo Mapas de GNAT y vuelve a intentarlo."]
    });
  } catch (error) {
    // No mostrar tokens ni información de la pestaña en los mensajes de error.
    console.warn("Centrality Local: no se pudo iniciar:", error?.message || String(error));
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b42318" });
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    } catch (_) { /* cerrar sin impedir uso manual de V9 */ }
  }
});
