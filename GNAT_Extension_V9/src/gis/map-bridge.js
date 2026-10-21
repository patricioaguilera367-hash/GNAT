/* GNAT host adapter: locate the authenticated OpenLayers map without HTTP calls. */
(() => {
  'use strict';
  function resolveHost(doc = document) {
    const frame = doc.querySelector('iframe#content');
    if (!frame) return null;
    try {
      const host = frame.contentWindow;
      return host?.webMap_?.map && host?.ol ? {frame, host, map: host.webMap_.map, ol: host.ol, doc:host.document} : null;
    } catch (_) { return null; }
  }
  const API = Object.freeze({ resolveHost });
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.__centralityMapBridge = API;
})();
