const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'GNAT_Extension_V9');
const script = fs.readFileSync(path.join(root, 'centrality_v9.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('la extensión V9 está configurada y su JS compila', () => {
  assert.equal(manifest.version, '9.0.0');
  assert.deepEqual(manifest.permissions.sort(), ['activeTab','scripting']);
  assert.equal(new vm.Script(script).constructor.name, 'Script');
  assert.match(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), /centrality_v9\.js/);
});
test('mantiene el render de aperturas separado de colores de zonas', () => {
  assert.match(script, /const COLOR_APERTURAS = "#e53935"/);
  assert.match(script, /if \(f\?\.get\?\.\("tipo"\) === "APERTURA"\) return COLOR_APERTURAS;/);
});
test('la paleta de zonas se guarda en JSON versión 4', () => {
  assert.match(script, /const proyecto = \{version:4,formato:'CentralityLocal'/);
  assert.match(script, /!\[1,2,3,4\]\.includes\(data\.version\)/);
  assert.match(script, /responsablesBloques/);
});
test('la exportación CSV de la planilla usa códigos humanos', () => {
  assert.match(script, /function guardarCSVHumano/);
  assert.match(script, /Código poste/);
  assert.match(script, /openings\.get\(id\)\|\|id/);
  assert.match(script, /Exportar tabla CSV/);
});
test('el parser anterior continúa disponible para proyectos históricos', () => {
  const api = require(path.join(root, 'centrality_v9.js'));
  const parsed = api.parseRouteCSV('ID;Numero;Subestacion;Longitud;Latitud;SupervisorColor;BloqueID\r\n' +
    'p-001;1;F1001;-72.60;-38.73;Verde;D1');
  assert.equal(parsed[0].subestacion, 'F1001');
  assert.equal(parsed[0].bloqueId, 'D1');
});
