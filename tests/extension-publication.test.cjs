const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'GNAT_Extension');
const sources = {
  'background.js': [2541, '9F6E70BADFF550EBF4615153A08057DE46182CD53736218F8A0CD1462AE1957E'],
  'centrality_v8.js': [110755, '5F83B0FD6EEAE76FED4C6EE7ED4DC3F12C051749576C5EC696EB4F8C1C7238A5'],
  'LEEME.txt': [2253, '06E7F6B0579D75351885BFF35861D31A5365DF987180C3C505351C39293331B0'],
  'manifest.json': [348, '04DE80740D2235525031410234072504553C5CC19D4415ED4F3E4C8544887D84']
};
test('current baseline preserves exactly four original source files', () => {
  assert.deepEqual(fs.readdirSync(extension).sort(), Object.keys(sources).sort());
  for (const [name, [size, digest]] of Object.entries(sources)) {
    const bytes = fs.readFileSync(path.join(extension, name));
    assert.equal(bytes.length, size);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(), digest);
  }
});
test('MV3 launcher uses bounded permissions and existing worker/action', () => {
  const m = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, '8.0.0');
  assert.deepEqual(m.permissions, ['activeTab', 'scripting']);
  assert.equal(m.background.service_worker, 'background.js');
  assert.equal(typeof m.action.default_title, 'string');
  assert.equal(m.host_permissions, undefined);
  assert.equal(m.content_scripts, undefined);
});
test('both scripts parse without executing browser code', () => {
  for (const name of ['background.js', 'centrality_v8.js']) {
    new vm.Script(fs.readFileSync(path.join(extension, name), 'utf8'), {filename: name});
  }
});
test('six CSV exports load under Node without document', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const api = require('../GNAT_Extension/centrality_v8.js');
  assert.deepEqual(Object.keys(api).sort(), ['normalizeOpeningRows', 'normalizeRouteRows',
    'parseOpeningCSV', 'parseRouteCSV', 'serializeOpeningCSV', 'serializeRouteCSV'].sort());
  assert.ok(Object.values(api).every(value => typeof value === 'function'));
});
test('synthetic route and opening CSV round trips preserve stable planning links', () => {
  const api = require('../GNAT_Extension/centrality_v8.js');
  const shared = {numero: 1, longitud: -72.5, latitud: -40.1, supervisorColor: 'Verde'};
  const route = [{...shared, id: 'route-1', subestacion: 'SYNTHETIC; "S/E"',
    bloqueId: 'B1', aperturasIds: ['opening-1']}];
  const opening = [{...shared, id: 'opening-1', codigo: 'SYNTHETIC', bloques: ['B1', 'B2']}];
  assert.deepEqual(api.parseRouteCSV(api.serializeRouteCSV(route)), api.normalizeRouteRows(route));
  assert.deepEqual(api.parseOpeningCSV(api.serializeOpeningCSV(opening)), api.normalizeOpeningRows(opening));
  const legacy = [{...route[0], aperturasIds: []}];
  assert.deepEqual(api.parseRouteCSV(api.serializeRouteCSV(legacy)), api.normalizeRouteRows(legacy));
  assert.throws(() => api.normalizeRouteRows(route, ['route-1']));
  assert.throws(() => api.normalizeOpeningRows([{...opening[0], latitud: 91}]));
});
