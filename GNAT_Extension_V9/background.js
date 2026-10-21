// Centrality V9.3 — one-click launcher: MAIN = GNAT map, ISOLATED = extension storage.
// Needs the authenticated GNAT Mapas tab; it never reads tokens or executes remote scripts.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    const [inspection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: () => {
        const iframe = document.querySelector('iframe#content');
        if (!iframe) return {status:'not_ready', message:'Abre Mapas en GNAT antes de pulsar Centrality Local.'};
        try {
          const w = iframe.contentWindow;
          if (!w?.webMap_?.map || !w.ol) return {status:'not_ready', message:'El mapa todavía está cargando.'};
          if (typeof w.__superponerKMZ?.abrirPlanilla === 'function') return {status:'running'};
          return {status:'ready'};
        } catch (_) {return {status:'not_ready', message:'No se puede acceder al mapa del iframe de GNAT.'};}
      }
    });
    const state = inspection?.result;
    if (state?.status === 'running') {
      await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',
        func:()=>document.querySelector('iframe#content')?.contentWindow?.__superponerKMZ?.abrirPlanilla?.()});
      return;
    }
    if (state?.status !== 'ready') {
      await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',
        func:(msg)=>alert(msg),args:[state?.message||'Abre GNAT → Mapas e inténtalo de nuevo.']});
      return;
    }
    // Chrome APIs cannot be called from the site's MAIN world. Isolate access to storage.
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',
      files:['src/background/storage-bridge.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:[
      'src/core/state.js', 'src/core/autosave.js',
      'src/gis/map-bridge.js', 'src/ui/grid-engine.js', 'centrality_v9.js'
    ]});
  } catch (err) {
    console.warn('Centrality Local: no se pudo iniciar:',err?.message||String(err));
    try {
      await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#b42318'});
      await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    } catch (_) { /* Do not alter GNAT */ }
  }
});
