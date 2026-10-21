/* Pure helpers for 2D Excel-like clipboard handling (no DOM or dependencies). */
(() => {
  'use strict';
  function parseClipboardMatrix(text) {
    const normalized = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    return normalized.split('\n').map(row => row.split('\t').map(value => value.trim()));
  }
  const API = Object.freeze({ parseClipboardMatrix });
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.__centralityGridEngine = API;
})();
