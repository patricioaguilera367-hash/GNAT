// Centrality Local V10.1 + Centrality Tools V1.
// Mantiene el launcher V10 y añade dos módulos de herramientas al mismo clic.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    const [inspection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        const iframe = document.querySelector("iframe#content");
        if (!iframe) {
          return { status: "not_ready", message: "Abre el módulo Mapas en GNAT antes de iniciar Centrality Local." };
        }
        try {
          const w = iframe.contentWindow;
          if (!w?.webMap_?.map || !w?.ol) {
            return { status: "not_ready", message: "El mapa todavía no está listo. Espera a que cargue GNAT." };
          }
          if (typeof w.__centralityV10?.toggle === "function") return { status: "running" };
          return { status: "ready" };
        } catch (_) {
          return { status: "not_ready", message: "No se puede acceder al mapa dentro del iframe. Revisa la sesión de GNAT." };
        }
      }
    });

    const state = inspection?.result;
    if (state?.status === "running") {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => {
          const w = document.querySelector("iframe#content")?.contentWindow;
          w?.__centralityV10?.toggle?.();
        }
      });
      // Ensure the tools add-on is present without resetting its current UI state.
      const [toolsState] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => ({
          installed: Boolean(document.querySelector("iframe#content")?.contentWindow?.__centralityToolsV1?.toggle)
        })
      });
      if (!toolsState?.result?.installed) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          files: [
            "tools/gnat-adapter/gnat-adapter.js",
            "tools/gnat-adapter/gnat-adapter.browser.js",
            "centrality_tools_core.js",
            "centrality_tools_v1.js"
          ]
        });
      }
      return;
    }
    if (state?.status === "ready") {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        files: [
          "tools/gnat-adapter/gnat-adapter.js",
          "tools/gnat-adapter/gnat-adapter.browser.js",
          "centrality_v10.js",
          "centrality_tools_core.js",
          "centrality_tools_v1.js"
        ]
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
    console.warn("Centrality Local V10:", error?.message || String(error));
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#dc2626" });
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    } catch (_) {}
  }
});
