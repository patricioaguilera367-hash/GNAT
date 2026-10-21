/* ISOLATED world: the only place this extension accesses chrome.storage.local. */
(() => {
  'use strict';
  if (globalThis.__centralityStorageBridgeReady) return;
  globalThis.__centralityStorageBridgeReady = true;
  const CHANNEL = 'centrality-local-autosave-v1';
  const KEY = 'centrality_autosave';
  const MAX_JSON_CHARS = 8_000_000; // also bounded by chrome.storage.local quota
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== window.location.origin ||
        event.data?.channel !== CHANNEL || event.data?.side !== 'app') return;
    const { action, payload, requestId } = event.data;
    if (!Number.isSafeInteger(requestId) || requestId < 1) return;
    const reply = (ok, value, error) => window.postMessage({
      channel: CHANNEL, side: 'bridge', requestId, ok, value, error
    }, window.location.origin);
    try {
      if (action === 'get') {
        const stored = await chrome.storage.local.get(KEY);
        reply(true, stored[KEY] || null);
      } else if (action === 'set') {
        if (payload?.schema !== 1 || payload?.project?.formato !== 'CentralityLocal' ||
            !Number.isFinite(payload.timestamp) ||
            !Array.isArray(payload.project.registros) || !Array.isArray(payload.project.bloques) ||
            payload.project.registros.length > 50000 || payload.project.bloques.length > 10000) {
          throw Error('Respaldo inválido');
        }
        if (JSON.stringify(payload).length > MAX_JSON_CHARS) throw Error('Respaldo supera el límite local');
        await chrome.storage.local.set({[KEY]: payload});
        reply(true, {timestamp:payload.timestamp});
      } else {
        reply(false, null, 'Acción no admitida');
      }
    } catch (err) { reply(false, null, err.message || 'Almacenamiento no disponible'); }
  });
})();
