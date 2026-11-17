/* Centrality Tools Engine V1 — pure helpers, no GNAT transport. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CentralityToolsEngineV1 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EARTH_RADIUS_M = 6371008.8;
  const ALLOWED_TYPES = new Set(["PUNTO", "APERTURA"]);

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function normalizeType(value) {
    return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  function parseRelationRefs(value) {
    if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
    if (value == null || value === "") return [];
    return String(value).split(/[|,;\n]+/).map(cleanText).filter(Boolean);
  }

  function haversineMeters(a, b) {
    const lat1 = Number(a?.lat);
    const lon1 = Number(a?.lon);
    const lat2 = Number(b?.lat);
    const lon2 = Number(b?.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite) ||
        Math.abs(lat1) > 90 || Math.abs(lat2) > 90 ||
        Math.abs(lon1) > 180 || Math.abs(lon2) > 180) {
      throw new TypeError("Coordenadas inválidas para calcular distancia.");
    }
    const rad = value => value * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function identityValues(record) {
    return new Set([
      cleanText(record?.id),
      cleanText(record?.featureId),
      cleanText(record?.code),
      cleanText(record?.number)
    ].filter(Boolean));
  }

  function hasPlannedLink(origin, opening) {
    const refs = parseRelationRefs(origin?.plannedOpeningRefs ?? origin?.aperturasIds);
    const candidate = identityValues(opening);
    return refs.some(ref => candidate.has(ref));
  }

  function nearestOpenings(origin, candidates, options = {}) {
    if (!origin || !Number.isFinite(Number(origin.lat)) || !Number.isFinite(Number(origin.lon))) {
      throw new TypeError("El objeto de partida no tiene coordenadas válidas.");
    }
    const radiusM = options.radiusM == null ? Infinity : Number(options.radiusM);
    if (!(radiusM > 0) && radiusM !== Infinity) throw new TypeError("El radio debe ser mayor que cero.");

    return (Array.isArray(candidates) ? candidates : [])
      .filter(item => item && normalizeType(item.type) === "APERTURA" &&
        Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) &&
        (!options.equipmentType || normalizeType(item.equipmentType) === normalizeType(options.equipmentType)))
      .map(item => ({
        ...item,
        distanceM: haversineMeters(origin, item),
        plannedLink: hasPlannedLink(origin, item)
      }))
      .filter(item => item.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM || cleanText(a.id).localeCompare(cleanText(b.id)));
  }

  function formatDistance(distanceM) {
    const value = Number(distanceM);
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value < 1000) return `${Math.round(value)} m`;
    return `${(value / 1000).toFixed(2).replace(/\.00$/, "")} km`;
  }

  function isCentralityPointType(value) {
    return ALLOWED_TYPES.has(normalizeType(value));
  }

  return Object.freeze({
    EARTH_RADIUS_M,
    cleanText,
    normalizeType,
    parseRelationRefs,
    haversineMeters,
    hasPlannedLink,
    nearestOpenings,
    formatDistance,
    isCentralityPointType
  });
});
