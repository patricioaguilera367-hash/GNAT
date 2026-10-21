/* Centrality V9.3: model of the project, shared by manual JSON and autosave.
 * Loaded into the MAIN world before centrality_v9.js. No external dependencies. */
(() => {
  'use strict';
  const projectVersion = 4;
  const isHexColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  function buildProject({ features, toLonLat, projection, zoneEntries, zoneColors,
                          zoneSupervisors, fallbackColor, supervisorColors,
                          visibleSupervisors, excelDraft }) {
    if (!Array.isArray(features) || typeof toLonLat !== 'function') {
      throw Error('Proyecto no disponible para guardado.');
    }
    const registros = features.map(f => {
      const coords = f.getGeometry()?.getCoordinates?.();
      if (!Array.isArray(coords) || coords.length < 2) throw Error('Punto sin geometría');
      const [longitud, latitud] = toLonLat(coords, projection);
      if (![longitud, latitud].every(Number.isFinite)) throw Error('Coordenadas inválidas');
      const tipo = f.get('tipo') || 'PUNTO';
      const bloques = tipo === 'APERTURA'
        ? (Array.isArray(f.get('bloques')) ? f.get('bloques') : [])
        : (f.get('bloqueId') ? [String(f.get('bloqueId'))] : []);
      return {
        id: String(f.get('id')), numero: Number(f.get('numero')), tipo,
        codigo: String(f.get('codigo') || ''), longitud, latitud,
        supervisorColor: f.get('bloque') || 'Sin asignar',
        bloqueId: String(f.get('bloqueId') || ''), bloques,
        aperturasIds: f.get('aperturasIds') || [],
        colorPersonalizado: String(f.get('colorPersonalizado') || ''),
        tipoEquipo: String(f.get('tipoEquipo') || ''),
        supervisorNombre: String(f.get('supervisorNombre') || ''),
        fechaPlanificacion: String(f.get('fechaPlanificacion') || '')
      };
    });
    const bloques = [...zoneEntries].map(([id, nombre], i) => ({
      id, nombre, color: zoneColors.get(id) || fallbackColor(i),
      responsable: zoneSupervisors.get(id) || ''
    }));
    const coloresSupervisores = { ...supervisorColors };
    for (const color of Object.values(coloresSupervisores)) {
      if (!isHexColor(color)) throw Error('Color de supervisor inválido');
    }
    return {
      version: projectVersion, formato: 'CentralityLocal', bloques,
      coloresSupervisores, visiblesSupervisores: [...visibleSupervisors], registros,
      ...(excelDraft ? { excelBorrador: excelDraft } : {})
    };
  }
  function isMeaningful(project) {
    const filled = rows => rows?.some(r => r && Object.entries(r).some(([key, value]) =>
      key !== 'numero' && !key.startsWith('__') &&
      typeof value === 'string' && value.trim() !== ''));
    const excel = project?.excelBorrador;
    return project?.formato === 'CentralityLocal' &&
      (project.registros.length > 0 || project.bloques.length > 0 ||
       filled(excel?.recorrido) || filled(excel?.aperturas) || filled(excel?.masivo?.filas));
  }
  const API = Object.freeze({ buildProject, isMeaningful, projectVersion });
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.__centralityProjectState = API;
})();
