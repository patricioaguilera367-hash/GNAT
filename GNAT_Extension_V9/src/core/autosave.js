/* MAIN-world automatic saving. The extension storage is ONLY in the ISOLATED bridge.
 * Requests are JSON-only; never transmit cookies or GNAT session information. */
(() => {
  'use strict';
  const CHANNEL = 'centrality-local-autosave-v1';
  function createAutosave({ win, build, onStatus, onSaved, captureDraft, minIntervalMs = 3000,
                             tickMs = 8000 }) {
    // Never overwrite a previous backup merely because the panel was opened.
    let lastSerialized = '';
    try { lastSerialized = JSON.stringify(build()); } catch (_) { /* loaded later */ }
    let busy = false;
    let closed = false;
    let nextId = 0;
    const requests = new Map();
    let lastError = '';
    const send = (action, payload) => new Promise((resolve, reject) => {
      if (closed) return reject(Error('Autosave cerrado'));
      const requestId = ++nextId;
      const timeout = win.setTimeout(() => {
        requests.delete(requestId);
        reject(Error('No hay respuesta del almacenamiento de Chrome'));
      }, 12000);
      requests.set(requestId, {resolve, reject, timeout});
      win.postMessage({ channel: CHANNEL, side: 'app', requestId, action, payload }, win.location.origin);
    });
    const onMessage = e => {
      if (e.source !== win || e.origin !== win.location.origin ||
          e.data?.channel !== CHANNEL || e.data?.side !== 'bridge') return;
      const req = requests.get(e.data.requestId);
      if (!req) return;
      requests.delete(e.data.requestId);
      win.clearTimeout(req.timeout);
      if (e.data.ok) req.resolve(e.data.value);
      else req.reject(Error(e.data.error || 'No se pudo acceder al almacenamiento'));
    };
    win.addEventListener('message', onMessage);
    async function save(force = false) {
      if (closed || busy) return;
      try {
        captureDraft?.();
        const project = build();
        const valid = win.__centralityProjectState?.isMeaningful(project);
        if (!valid) return;
        const serialized = JSON.stringify(project);
        if (serialized === lastSerialized) return;
        busy = true;
        const envelope = { schema: 1, timestamp: Date.now(), project };
        await send('set', envelope);
        lastSerialized = serialized;
        lastError = '';
        onSaved?.(envelope);
        onStatus?.('Guardado automático: ' + new Date(envelope.timestamp).toLocaleTimeString('es-CL'), false);
      } catch (err) {
        const currentError = String(err.message || err);
        if (lastError !== currentError) onStatus?.('Autosave falló: ' + currentError, true);
        lastError = currentError;
      } finally {
        busy = false;
      }
    }
    async function read() {
      const data = await send('get');
      if (!data) return null;
      if (data.schema !== 1 || !Number.isFinite(data.timestamp) ||
          data.project?.formato !== 'CentralityLocal' ||
          ![1,2,3,4].includes(data.project?.version) ||
          !Array.isArray(data.project.registros) || !Array.isArray(data.project.bloques)) {
        throw Error('Respaldo automático incompatible');
      }
      return data;
    }
    // Polling is deliberate: it catches valid edits in both editors even when an
    // individual DOM event isn't available, without writing on every keystroke.
    const interval = win.setInterval(() => { void save(); }, Math.max(tickMs, minIntervalMs));
    const onHidden = () => { if (win.document?.visibilityState === 'hidden') void save(); };
    win.document?.addEventListener('visibilitychange', onHidden);
    return { save, read, destroy() {
      closed = true;
      win.clearInterval(interval);
      win.removeEventListener('message', onMessage);
      win.document?.removeEventListener('visibilitychange', onHidden);
      for (const req of requests.values()) { win.clearTimeout(req.timeout); req.reject(Error('Autosave cerrado')); }
      requests.clear();
    } };
  }
  const API = Object.freeze({ createAutosave });
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.__centralityAutosave = API;
})();
