'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const api = require('../inspector/core.cjs');
const cli = path.resolve(__dirname, '../inspector/cli.cjs');
// A fake CDP peer avoids attaching any real browser during development.
class Peer extends EventEmitter {
  addEventListener(name, fn) { this.on(name, fn); }
  send(text) {
    const { id, method } = JSON.parse(text);
    if (method === 'Network.getResponseBody') queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id, result: { body: '{"object_id":101,"headers":{"Cookie":"SYNTHETIC_SECRET"}}' } }) }));
    else queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id, result: {} }) }));
  }
  close() { this.emit('close'); }
}
test('fake CDP response resolves safely and disconnect rejects outstanding work', async () => {
  const peer = new Peer(); const protocol = new api.Protocol(peer);
  const result = await protocol.send('Network.getResponseBody', { requestId: 'r' });
  assert.equal(api.parseFrame(result.body).object_id, 101);
  assert.equal(api.parseFrame(result.body).headers, undefined);
  peer.send = () => {};
  const waiting = protocol.send('Network.getResponseBody', { requestId: 'late' });
  protocol.close(); await assert.rejects(waiting, /cdp_closed/);
  peer.emit('message', { data: '{"id":2,"result":{"body":"SYNTHETIC_SECRET"}}' });
  assert.equal(protocol.pending.size, 0);
});
test('private JSONL rejects arbitrary record values on the actual host', () => {
  const root = fs.mkdtempSync(path.join(__dirname, 'private-test-'));
  try {
    const writer = api.openPrivateWriter(path.join(root, 'private'));
    writer.write({ kind: 'marker', marker: 'select_pole_1', cookie: 'SYNTHETIC_SECRET', extra: 'Private Person' });
    writer.write({ kind: 'body', endpoint: '/untrusted/PrivatePerson', action: 'SYNTHETIC_SECRET', data: { object_id: 101, title: 'Private Person', content: '<b>Private Person</b>' } });
    writer.close();
    const text = fs.readFileSync(writer.file, 'utf8');
    assert.doesNotMatch(text, /SYNTHETIC_SECRET|Private Person|PrivatePerson/);
    const records = text.trim().split('\n').map(JSON.parse);
    assert.equal(records[0].marker, 'select_pole_1');
    assert.equal(records[1].data.object_id, 101);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('CLI help is offline and unsafe command errors do not echo arguments', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /observe/); assert.match(help.stdout, /summary/);
  const bad = spawnSync(process.execPath, [cli, 'observe', '--origin', 'https://private.invalid/?token=SYNTHETIC_SECRET'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.doesNotMatch(bad.stdout + bad.stderr, /SYNTHETIC_SECRET|private.invalid/);
});
test('offline fixture summary preserves schema and rejects oversized lines', () => {
  const root = fs.mkdtempSync(path.join(__dirname, 'summary-test-'));
  try {
    const file = path.join(root, 'synthetic.jsonl');
    fs.writeFileSync(file, JSON.stringify({ kind: 'body', endpoint: '/backend/saesa/svc_wmc.php', action: 'get_objects_geojson', data: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/geojson.synthetic.json'), 'utf8')) }) + '\n');
    const run = spawnSync(process.execPath, [cli, 'summary', file], { encoding: 'utf8' });
    assert.equal(run.status, 0); assert.match(run.stdout, /coordinates/); assert.doesNotMatch(run.stdout, /-72|-40/);
    fs.writeFileSync(file, 'x'.repeat(131073));
    const large = spawnSync(process.execPath, [cli, 'summary', file], { encoding: 'utf8' });
    assert.equal(large.status, 1); assert.ok(large.stderr.length < 200);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
