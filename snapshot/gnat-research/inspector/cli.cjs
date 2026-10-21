#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Collector, Protocol, Summary, parseFrame, sanitizeRecord, validateOrigin, validateEndpoint, selectTarget, openPrivateWriter } = require('./core.cjs');
const HELP = `Passive GNAT inspector (Node 24; no dependencies)

Offline:
  node gnat-research/inspector/cli.cjs --help
  node gnat-research/inspector/cli.cjs summary <sanitized.jsonl>
Observe (requires explicit authorization for this Chrome session):
  node gnat-research/inspector/cli.cjs observe --origin https://st.saesa.cl:8082 --endpoint http://127.0.0.1:9222 --duration 180 [--target <page-id>]

Duration: 1..1800 seconds. No browser navigation or GNAT requests are generated.
Type a marker on stdin, e.g. select_pole_1, open_view_1, consult_widget_1.
Allowed markers: search/select_pole/select_equipment/open_view/consult_widget/batch/area/topology plus _1.._999.
Type stop or press Ctrl+C to stop. Output is a private bounded JSONL capture;
stdout gives incremental counts and a final value-free schema summary.
Unknown endpoint/actions have metadata only. No raw events, headers or errors.
`;

async function boundedText(stream, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw Error('input_limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function summarize(file) {
  const summary = new Summary(); let buffer = '';
  const stream = fs.createReadStream(file, { highWaterMark: 16384, encoding: 'utf8' });
  for await (const chunk of stream) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > 131072) throw Error('input_limit');
      if (line) { const record = parseFrame(line); if (!record) throw Error('invalid_record'); summary.add(sanitizeRecord(record)); }
    }
    if (Buffer.byteLength(buffer) > 131072) throw Error('input_limit');
  }
  if (buffer) { const record = parseFrame(buffer); if (!record) throw Error('invalid_record'); summary.add(sanitizeRecord(record)); }
  process.stdout.write(JSON.stringify(summary.snapshot(), null, 2) + '\n');
}
function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--origin', '--endpoint', '--duration', '--target'].includes(key) || !args[i + 1] || out[key]) throw Error('invalid_arguments');
    out[key] = args[i + 1];
  }
  validateOrigin(out['--origin']); const endpoint = validateEndpoint(out['--endpoint']);
  const duration = Number(out['--duration'] || 180);
  if (!Number.isInteger(duration) || duration < 1 || duration > 1800) throw Error('invalid_duration');
  if (out['--target'] && !/^[A-Za-z0-9-]{1,128}$/.test(out['--target'])) throw Error('invalid_target');
  return { origin: out['--origin'], endpoint, duration, target: out['--target'] };
}
async function observe(config) {
  // Create and verify private storage before contacting even the loopback service.
  const writer = openPrivateWriter(path.resolve(__dirname, '../private'));
  const summary = new Summary(); let protocol, collector, timer, tick, input = '';
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = () => finish();
  const onInput = chunk => {
    input += chunk.toString('utf8');
    if (input.length > 256) { input = ''; process.stderr.write('Marker rejected: input limit.\n'); return; }
    let n;
    while ((n = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, n).trim(); input = input.slice(n + 1);
      if (line === 'stop') { stop(); return; }
      try { const record = sanitizeRecord({ kind: 'marker', at: Date.now(), marker: line }); writer.write(record); summary.add(record); } catch { process.stderr.write('Marker rejected.\n'); }
    }
  };
  try {
    const response = await fetch(new URL('/json/list', config.endpoint), { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('debug_target_unavailable');
    const targets = parseFrame(await boundedText(response.body, 65536));
    if (!Array.isArray(targets)) throw Error('debug_target_unavailable');
    const target = selectTarget(targets, config.origin, config.target);
    const socketUrl = validateEndpoint(target.webSocketDebuggerUrl, true);
    if (socketUrl.port !== config.endpoint.port) throw Error('debug_target_unavailable');
    const socket = new WebSocket(socketUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(Error('debug_connection_failed')); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(Error('debug_connection_failed')); }, { once: true });
    });
    protocol = new Protocol(socket, event => collector.handle(event));
    socket.addEventListener('close', stop);
    collector = new Collector({ origin: config.origin, send: (method, params) => protocol.send(method, params), emit: record => {
      const safe = sanitizeRecord(record); writer.write(safe); summary.add(safe);
      if (record.kind === 'limit') stop();
    } });
    await protocol.send('Network.enable', { maxTotalBufferSize: 131072, maxResourceBufferSize: 65536, maxPostDataSize: 4096 });
    timer = setTimeout(stop, config.duration * 1000);
    tick = setInterval(() => process.stdout.write(JSON.stringify({ progress_records: summary.records }) + '\n'), 15000);
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    process.stdin.on('data', onInput); process.stdin.resume();
    process.stdout.write('Observer attached; no GNAT requests generated.\n');
    await done;
  } finally {
    clearTimeout(timer); clearInterval(tick);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('data', onInput); process.stdin.pause();
    collector?.stop();
    if (protocol && !protocol.closed) { try { await protocol.send('Network.disable'); } catch {} protocol.close(); }
    writer.close();
    process.stdout.write(JSON.stringify(summary.snapshot(), null, 2) + '\n');
  }
}
async function main(args) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return; }
  if (args[0] === 'summary' && args.length === 2) return summarize(args[1]);
  if (args[0] === 'observe') return observe(options(args.slice(1)));
  throw Error('invalid_arguments');
}
main(process.argv.slice(2)).catch(() => { process.stderr.write('Inspector stopped: validation, privacy, input or connection check failed. No raw diagnostics retained.\n'); process.exitCode = 1; });
