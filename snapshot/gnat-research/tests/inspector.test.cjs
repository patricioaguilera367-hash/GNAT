'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let api = {};
try { api = require('../inspector/core.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const origin = 'https://st.saesa.cl:8082';
const endpoint = origin + '/backend/saesa/svc_wmc.php';
const request = (id, action = 'get_objects_geojson', url = endpoint) => ({ method: 'Network.requestWillBeSent', params: { requestId: id, type: 'XHR', request: { url, method: 'POST', postData: 'action=' + action + '&object_ids=%5B101%5D', headers: { Cookie: 'SYNTHETIC_SECRET' } } } });
const response = (id, extra = {}) => ({ method: 'Network.responseReceived', params: { requestId: id, type: 'XHR', response: { url: endpoint, status: 200, mimeType: 'application/json', ...extra } } });
function setup() {
  assert.equal(typeof api.Collector, 'function', 'passive collector must exist');
  const records = [], commands = [];
  const collector = new api.Collector({ origin, emit: record => records.push(record), send: async (method, params) => { commands.push({ method, params }); return { body: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 101, geometry: { type: 'Point', coordinates: [-72, -40] }, properties: { object_id: 101, class: 'elec_pole', owner_name: 'Person Private', token: 'SYNTHETIC_SECRET' } }] }) }; } });
  return { collector, records, commands };
}
test('ingress removes sensitive keys recursively and never returns raw invalid frames', () => {
  assert.equal(typeof api.parseFrame, 'function', 'privacy ingress must exist');
  assert.deepEqual(api.parseFrame('{"id":1,"result":{"headers":{"Cookie":"SYNTHETIC_SECRET"},"nested":{"access_token":"SYNTHETIC_SECRET","object_id":12}}}'), { id: 1, result: { nested: { object_id: 12 } } });
  assert.equal(api.parseFrame('SYNTHETIC_SECRET'), null);
});
test('authorized geometry preserves safe IDs/coordinates but not personal fields', async () => {
  const { collector, records, commands } = setup();
  await collector.handle(request('secret-raw-id'));
  await collector.handle(response('secret-raw-id'));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'secret-raw-id', encodedDataLength: 300 } });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].method, 'Network.getResponseBody');
  const capture = records.find(x => x.kind === 'body');
  assert.deepEqual(capture.data.features[0].geometry, { type: 'Point', coordinates: [-72, -40] });
  assert.equal(capture.data.features[0].properties.object_id, 101);
  assert.equal(capture.data.features[0].properties.owner_name, undefined);
  assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_SECRET|Person Private|secret-raw-id/);
  assert.equal(collector.size, 0);
});
test('off-origin redirect discards request and cannot retrieve body', async () => {
  const { collector, records, commands } = setup();
  await collector.handle(request('r'));
  await collector.handle(request('r', 'get_objects_geojson', 'https://other.invalid/private?token=SYNTHETIC_SECRET'));
  await collector.handle(response('r'));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
  assert.equal(commands.length, 0);
  assert.doesNotMatch(JSON.stringify(records), /other.invalid|SYNTHETIC_SECRET/);
});
test('unknown action or endpoint records metadata only', async () => {
  for (const req of [request('r', 'delete_asset'), request('r', 'get_objects_geojson', origin + '/backend/saesa/unknown.php')]) {
    const { collector, records, commands } = setup();
    await collector.handle(req); await collector.handle(response('r'));
    await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
    assert.equal(commands.length, 0);
    assert.equal(records[0].kind, 'request');
    assert.equal(records[0].action, 'unknown');
  }
});
test('oversized, unknown MIME and non-success responses are not retrieved', async () => {
  for (const [extra, size] of [[{}, 65537], [{ mimeType: 'image/png' }, 10], [{ status: 302 }, 10], [{ url: 'https://other.invalid/' }, 10]]) {
    const { collector, commands } = setup();
    await collector.handle(request('r')); await collector.handle(response('r', extra));
    await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: size } });
    assert.equal(commands.length, 0);
  }
});
test('invalid JSON and oversized decoded bodies are schema-only failures', async () => {
  for (const body of ['not-json SYNTHETIC_SECRET', 'x'.repeat(65537)]) {
    const { collector, records } = setup(); collector.send = async () => ({ body });
    await collector.handle(request('r')); await collector.handle(response('r'));
    await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
    assert.equal(records.at(-1).kind, 'skipped');
    assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_SECRET|xxxxxxxxxxxxxxxx/);
    assert.equal(collector.size, 0);
  }
});
test('network errors and late events are sanitized and cleanup is bounded', async () => {
  const { collector, records, commands } = setup();
  await collector.handle(request('r'));
  await collector.handle({ method: 'Network.loadingFailed', params: { requestId: 'r', errorText: 'SYNTHETIC_SECRET' } });
  await collector.handle(response('r'));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 1 } });
  assert.equal(commands.length, 0); assert.equal(collector.size, 0);
  assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_SECRET/);
  for (let i = 0; i < 101; i++) await collector.handle(request(String(i)));
  assert.ok(collector.size <= 100);
  collector.stop(); assert.equal(collector.size, 0);
});
test('body and marker projection cannot retain arbitrary text or HTML', () => {
  assert.equal(typeof api.project, 'function', 'business projection must exist');
  const result = api.project({ title: '<p>Private Person</p>', content: '<b>SYNTHETIC_SECRET</b>', description: 'Private Person', object_id: 101, widget_definition: { tab_widgets: [{ id: 3, component_class: 'AM.component.PartsGrid', component_has_content_generator: false }] } });
  assert.equal(result.object_id, 101);
  assert.equal(result.widget_definition.tab_widgets[0].component_class, 'AM.component.PartsGrid');
  assert.doesNotMatch(JSON.stringify(result), /Private Person|SYNTHETIC_SECRET/);
});
test('target selection rejects ambiguity and all non-loopback CDP endpoints', () => {
  assert.equal(typeof api.selectTarget, 'function', 'target validation must exist');
  const page = { id: '1', type: 'page', url: origin + '/backend/saesa/centrality.php', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' };
  assert.equal(api.selectTarget([page], origin).id, '1');
  assert.throws(() => api.selectTarget([page, { ...page, id: '2' }], origin));
  assert.throws(() => api.validateEndpoint('http://remote.invalid:9222'));
  assert.throws(() => api.validateEndpoint('http://127.0.0.1:9222/?token=bad'));
  assert.throws(() => api.selectTarget([{ ...page, webSocketDebuggerUrl: 'ws://remote.invalid/devtools/page/1' }], origin));
});
test('protocol transport rejects mutation and sensitive commands before send', async () => {
  assert.equal(typeof api.Protocol, 'function', 'safe protocol transport must exist');
  const wire = { send() { throw Error('must not send'); }, close() {} };
  const protocol = new api.Protocol(wire);
  for (const method of ['Runtime.evaluate', 'Network.getAllCookies', 'Fetch.enable', 'Page.navigate', 'Network.setCacheDisabled']) await assert.rejects(protocol.send(method, {}));
  protocol.close(); assert.equal(protocol.pending.size, 0);
});
test('summary counts repeats, nulls and type variations without retaining values', () => {
  assert.equal(typeof api.Summary, 'function', 'offline summary must exist');
  const s = new api.Summary();
  s.add({ kind: 'body', endpoint: '/safe.php', action: 'a', data: { object_id: null } });
  s.add({ kind: 'body', endpoint: '/safe.php', action: 'a', data: { object_id: 1, extra: true } });
  const out = s.snapshot(); assert.equal(out.records, 2);
  assert.deepEqual(out.groups[0].schema['$.object_id'], ['null', 'number']);
  assert.equal(out.groups[0].present['$.extra'], 1);
});
test('private writer refuses symlinks and serializes only sanitized records', () => {
  assert.equal(typeof api.openPrivateWriter, 'function', 'private writer must exist');
  if (process.platform === 'win32') return; // Windows ACL integration is verified separately on this host.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnat-offline-'));
  try {
    const writer = api.openPrivateWriter(path.join(dir, 'private'));
    writer.write({ kind: 'marker', marker: 'select_1', cookie: 'SYNTHETIC_SECRET' }); writer.close();
    assert.doesNotMatch(fs.readFileSync(writer.file, 'utf8'), /SYNTHETIC_SECRET/);
    assert.equal(fs.statSync(writer.file).mode & 0o077, 0);
    fs.symlinkSync(path.join(dir, 'private'), path.join(dir, 'linked'));
    assert.throws(() => api.openPrivateWriter(path.join(dir, 'linked')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('widget headers survive privacy ingress while actual HTTP headers do not', () => {
  const result = api.parseFrame('{"header_widgets":[{"id":7}],"responseHeaders":{"Cookie":"SYNTHETIC_SECRET"}}');
  assert.deepEqual(result.header_widgets, [{ id: 7 }]);
  assert.equal(result.responseHeaders, undefined);
});
test('same-origin response path mismatch cannot retrieve another endpoint body', async () => {
  const { collector, commands } = setup();
  await collector.handle(request('r'));
  await collector.handle(response('r', { url: origin + '/backend/saesa/private.php' }));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
  assert.equal(commands.length, 0);
});
test('POST with query action retains safe parameters but never token values', async () => {
  const { collector, records, commands } = setup();
  const req = request('r');
  req.params.request.url = origin + '/backend/saesa/AM/component/svc_location.php?action=list_location_parts';
  req.params.request.postData = 'object_id=101&token=SYNTHETIC_SECRET';
  await collector.handle(req);
  assert.equal(records[0].action, 'list_location_parts');
  assert.deepEqual(records[0].params, { object_id: '101' });
  assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_SECRET/);
  assert.equal(commands.length, 0);
});
test('base64 response decoded limit and expired request prevent retention', async () => {
  const { collector, records, commands } = setup();
  collector.send = async () => ({ body: Buffer.from(JSON.stringify({ object_id: 201 })).toString('base64'), base64Encoded: true });
  await collector.handle(request('r')); await collector.handle(response('r'));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
  assert.equal(records.at(-1).data.object_id, 201);
  await collector.handle(request('late')); collector.now = () => Date.now() + 31000;
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'late', encodedDataLength: 10 } });
  assert.equal(collector.size, 0); assert.equal(commands.length, 0);
});
test('known JSON action labelled text/html retains only valid bounded JSON projection', async () => {
  const { collector, records, commands } = setup();
  await collector.handle(request('r'));
  await collector.handle(response('r', { mimeType: 'text/html; charset=UTF-8' }));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 300 } });
  assert.equal(commands.length, 1);
  assert.equal(records.at(-1).kind, 'body');
  assert.equal(records.at(-1).data.features[0].properties.object_id, 101);
  assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_SECRET|Person Private/);
});
test('text/html action containing HTML is skipped and unknown actions never retrieve it', async () => {
  const { collector, records } = setup();
  collector.send = async () => ({ body: '<html>SYNTHETIC_SECRET Private Person</html>' });
  await collector.handle(request('r'));
  await collector.handle(response('r', { mimeType: 'text/html' }));
  await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 60 } });
  assert.equal(records.at(-1).kind, 'skipped');
  assert.doesNotMatch(JSON.stringify(records), /SYNTHETIC_SECRET|Private Person/);
  const unknown = setup();
  await unknown.collector.handle(request('u', 'unknown_action'));
  await unknown.collector.handle(response('u', { mimeType: 'text/html' }));
  await unknown.collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'u', encodedDataLength: 10 } });
  assert.equal(unknown.commands.length, 0);
});
test('scalar ID arrays preserve IDs without manufacturing nulls from dropped values', () => {
  const result = api.project({ header_widgets: [7, '8', null, 'Private Person', { id: 9 }] });
  assert.deepEqual(result.header_widgets, [7, '8', null, { id: 9 }]);
  assert.equal(JSON.parse(JSON.stringify(result)).header_widgets.filter(x => x === null).length, 1);
});
test('schema sanitation retains recognized union types while dropping unsupported types', () => {
  const result = api.sanitizeRecord({ kind: 'body', endpoint: '/backend/saesa/svc_wmc.php', action: 'get_objects_geojson', schema: { '$.object_id': ['null', 'number', 'undefined'], '$.extra': ['undefined'] } });
  assert.deepEqual(result.schema['$.object_id'], ['null', 'number']);
  assert.equal(result.schema['$.extra'], undefined);
});
test('duplicate or conflicting action parameters cannot authorize body retrieval', async () => {
  for (const [query, form] of [
    ['?action=get_objects_geojson&action=delete_asset', 'object_ids=%5B101%5D'],
    ['', 'action=get_objects_geojson&action=delete_asset'],
    ['?action=delete_asset', 'action=get_objects_geojson'],
    ['?action=get_objects_geojson', 'action=get_objects_geojson']
  ]) {
    const { collector, commands } = setup();
    const req = request('r'); req.params.request.url += query; req.params.request.postData = form;
    await collector.handle(req); await collector.handle(response('r', { url: endpoint + query }));
    await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
    assert.equal(commands.length, 0);
  }
});
test('changed response query cannot inherit original request read authorization', async () => {
  for (const query of ['?action=delete_asset', '?action=get_objects_geojson', '?object_id=202', '?unverified=1', '?action=get_objects_geojson&action=delete_asset']) {
    const { collector, commands } = setup();
    await collector.handle(request('r'));
    await collector.handle(response('r', { url: endpoint + query }));
    await collector.handle({ method: 'Network.loadingFinished', params: { requestId: 'r', encodedDataLength: 10 } });
    assert.equal(commands.length, 0);
  }
});
