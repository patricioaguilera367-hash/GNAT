'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const LIMIT = 65536;
const SENSITIVE = /header|cookie|authorization|credential|password|secret|token|session|storage|email|phone|address|owner|user|person/i;
const sensitive = key => key !== 'header_widgets' && SENSITIVE.test(key);
const ENDPOINTS = {
  '/backend/saesa/svc_wmc.php': ['textual_search', 'get_objects_geojson'],
  '/backend/saesa/Web/component/svc_object_view.php': ['get_object_definition', 'get_widget_content'],
  '/backend/saesa/AM/component/svc_location.php': ['list_location_parts']
};
const NUMBERS = new Set(['id', 'object_id', 'surrogate_in_map_id', 'widget_id', 'managed_by_id', 'installed_assets', 'total', 'count', 'action_provider_id']);
const BOOLEANS = new Set(['success', 'component_has_content_generator', 'action_has_params']);
const CONTAINERS = new Set(['data', 'items', 'results', 'features', 'properties', 'geometry', 'geometries', 'widget_definition', 'header_widgets', 'tab_widgets', 'action_widgets', 'tool_widgets', 'container_children', 'pin_location', 'coords', 'crs']);
const STRINGS = new Set(['class', 'component_class', 'type', 'code', 'name', 'display', 'exposition']);
const GEOMETRIES = new Set(['FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);
const SCHEMA_KEYS = new Set([...NUMBERS, ...BOOLEANS, ...CONTAINERS, ...STRINGS, 'coordinates', 'x', 'y', 'title', 'description', 'content', 'message_error', 'class_display', 'type_display', 'component_config', 'extra', 'installed_assets', 'name']);

function parseFrame(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 262144) return null;
  try { return JSON.parse(text, (key, value) => sensitive(key) ? undefined : value); } catch { return null; }
}
function numeric(value) { return typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^\d{1,16}$/.test(value); }
function coordinates(value, depth = 0) {
  if (depth > 6 || !Array.isArray(value) || value.length > 2048) return undefined;
  if (value.every(x => typeof x === 'number' && Number.isFinite(x))) return value;
  const result = value.map(x => coordinates(x, depth + 1));
  return result.every(x => x !== undefined) ? result : undefined;
}
function project(value, depth = 0) {
  if (depth > 12) return undefined;
  if (value === null || numeric(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(x => project(x, depth + 1)).filter(x => x !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 300)) {
    if (sensitive(key)) continue;
    if (item === null && (NUMBERS.has(key) || CONTAINERS.has(key))) out[key] = null;
    else if (NUMBERS.has(key) && numeric(item)) out[key] = item;
    else if (BOOLEANS.has(key) && typeof item === 'boolean') out[key] = item;
    else if (key === 'coordinates') { const coords = coordinates(item); if (coords) out[key] = coords; }
    else if ((key === 'x' || key === 'y') && typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    else if (STRINGS.has(key) && typeof item === 'string' && item.length <= 96) {
      if (GEOMETRIES.has(item) || /^[A-Z][A-Za-z0-9]*\.component\.[A-Z][A-Za-z0-9]*$/.test(item) || /^elec_[a-z0-9_]+$/.test(item) || /^F(?:AP)?\d{3,8}(?: \[F\d{3,8}\])?$/.test(item) || /^EPSG:\d{4,6}$/.test(item)) out[key] = item;
    } else if (CONTAINERS.has(key) && typeof item === 'object') out[key] = project(item, depth + 1);
  }
  return out;
}
function schema(value, out = {}, key = '$', depth = 0, budget = { n: 0 }) {
  if (depth > 12 || ++budget.n > 1500) return out;
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  out[key] = [...new Set([...(out[key] || []), type])].sort();
  if (Array.isArray(value)) for (const item of value.slice(0, 50)) schema(item, out, key + '[]', depth + 1, budget);
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value).slice(0, 100)) {
    if (!sensitive(name)) schema(item, out, key + '.' + (SCHEMA_KEYS.has(name) ? name : '[unknown]'), depth + 1, budget);
  }
  return out;
}
function validateOrigin(value) {
  const url = new URL(value);
  if (url.origin !== 'https://st.saesa.cl:8082' || value !== url.origin) throw Error('origin_not_authorized');
  return url.origin;
}
function validateEndpoint(value, websocket = false) {
  const url = new URL(value);
  if (url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.protocol !== (websocket ? 'ws:' : 'http:') || !url.port) throw Error('loopback_endpoint_required');
  if (!websocket && url.pathname !== '/') throw Error('loopback_endpoint_required');
  if (websocket && !/^\/devtools\/page\/[A-Za-z0-9-]+$/.test(url.pathname)) throw Error('page_endpoint_required');
  return url;
}
function selectTarget(targets, origin, id) {
  validateOrigin(origin);
  const matches = targets.filter(target => {
    try { return target.type === 'page' && new URL(target.url).origin === origin && (!id || target.id === id); } catch { return false; }
  });
  if (matches.length !== 1) throw Error('target_missing_or_ambiguous');
  validateEndpoint(matches[0].webSocketDebuggerUrl, true);
  return matches[0];
}
function queryIdentity(url) {
  if (url.search.length > 4096) return null;
  const pairs = [...url.searchParams]; const names = new Set();
  for (const [key, value] of pairs) {
    if (names.has(key)) return null;
    names.add(key);
    if (key === 'action') { if (!Object.values(ENDPOINTS).some(actions => actions.includes(value))) return null; }
    else if (['object_ids', 'widget_ids'].includes(key)) {
      try { const values = JSON.parse(value); if (!Array.isArray(values) || values.length > 2 || !values.every(numeric)) return null; } catch { return null; }
    } else if (!['_dc', 'object_id', 'query', 'text', 'start', 'limit', 'page'].includes(key) || !(numeric(value) || /^F(?:AP)?\d{3,8}$/i.test(value))) return null;
  }
  return JSON.stringify(pairs.sort(([a], [b]) => a.localeCompare(b)));
}
function requestInfo(request, origin) {
  try {
    const url = new URL(request.url);
    if (url.origin !== origin || url.username || url.password) return null;
    if (!['GET', 'POST'].includes(request.method)) return null;
    const endpoint = ENDPOINTS[url.pathname] ? url.pathname : 'unknown';
    const query = queryIdentity(url);
    let params = new URLSearchParams(url.search.length <= 4096 ? url.search : '');
    if (request.method === 'POST') {
      if (typeof request.postData !== 'string' || Buffer.byteLength(request.postData) > 4096) return { endpoint, action: 'unknown', method: request.method, params: {} };
      const post = new URLSearchParams(request.postData);
      if (params.getAll('action').length + post.getAll('action').length > 1) return { endpoint, action: 'unknown', method: request.method, params: {} };
      for (const [key, val] of post) params.set(key, val);
    }
    const action = params.get('action');
    const allowed = query !== null && params.getAll('action').length === 1 && ENDPOINTS[endpoint]?.includes(action);
    const safe = {};
    if (allowed) for (const key of ['object_id', 'object_ids', 'widget_ids', 'query', 'text', 'start', 'limit', 'page']) {
      const val = params.get(key); if (val === null) continue;
      if (['object_ids', 'widget_ids'].includes(key)) {
        try { const list = JSON.parse(val); if (Array.isArray(list) && list.length <= 2 && list.every(numeric)) safe[key] = list; } catch {}
      } else if (numeric(val) || /^F(?:AP)?\d{3,8}$/i.test(val)) safe[key] = val;
    }
    return { endpoint, action: allowed ? action : 'unknown', method: request.method, params: safe, query };
  } catch { return null; }
}
class Collector {
  constructor({ origin, send, emit, now = Date.now }) {
    this.origin = validateOrigin(origin); this.send = send; this.emit = emit; this.now = now;
    this.requests = new Map(); this.sequence = 0; this.events = 0; this.closed = false;
  }
  get size() { return this.requests.size; }
  record(kind, data) { if (!this.closed) this.emit({ kind, at: this.now(), ...data }); }
  stop() { this.closed = true; this.requests.clear(); }
  async handle(event) {
    if (this.closed) return;
    if (++this.events > 10000) { this.record('limit', { reason: 'event_limit' }); this.stop(); return; }
    const now = this.now();
    for (const [id, req] of this.requests) if (now - req.started > 30000) this.requests.delete(id);
    const p = event?.params;
    if (!p || typeof p.requestId !== 'string') return;
    if (event.method === 'Network.requestWillBeSent') {
      this.requests.delete(p.requestId); // A redirect must pass origin and action checks again.
      if (!['XHR', 'Fetch'].includes(p.type)) return;
      const info = requestInfo(p.request || {}, this.origin); if (!info) return;
      if (this.requests.size >= 100) { this.record('limit', { reason: 'pending_limit' }); return; }
      const req = { ...info, correlation: ++this.sequence, started: now };
      this.requests.set(p.requestId, req); this.record('request', infoWithId(req)); return;
    }
    const req = this.requests.get(p.requestId); if (!req) return;
    if (event.method === 'Network.responseReceived') {
      const r = p.response || {};
      let sameOrigin = false; try { const url = new URL(r.url); const query = queryIdentity(url); sameOrigin = url.origin === this.origin && url.pathname === req.endpoint && !url.username && !url.password && query !== null && query === req.query; } catch {}
      req.readable = sameOrigin && ['XHR', 'Fetch'].includes(p.type) && Number.isInteger(r.status) && r.status >= 200 && r.status < 300 && /^(application\/json|application\/geo\+json|text\/html)(?:;|$)/i.test(r.mimeType || '');
      req.status = Number.isInteger(r.status) ? r.status : 0;
      this.record('response', { ...infoWithId(req), status: req.status, readable: req.readable }); return;
    }
    if (event.method === 'Network.loadingFailed') {
      this.requests.delete(p.requestId); this.record('error', { ...infoWithId(req), reason: 'network_failed' }); return;
    }
    if (event.method !== 'Network.loadingFinished') return;
    this.requests.delete(p.requestId);
    if (req.action === 'unknown' || !req.readable || !Number.isFinite(p.encodedDataLength) || p.encodedDataLength < 0 || p.encodedDataLength > LIMIT) {
      this.record('skipped', { ...infoWithId(req), reason: 'body_not_eligible' }); return;
    }
    try {
      const result = await this.send('Network.getResponseBody', { requestId: p.requestId });
      if (this.closed) return;
      if (typeof result.body !== 'string' || Buffer.byteLength(result.body) > (result.base64Encoded ? 87384 : LIMIT)) throw Error();
      const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
      if (Buffer.byteLength(body) > LIMIT) throw Error();
      const value = parseFrame(body); if (value === null) throw Error();
      this.record('body', { ...infoWithId(req), data: project(value), schema: schema(value), evidence: 'observed_response_projection' });
    } catch { this.record('skipped', { ...infoWithId(req), reason: 'body_unavailable_invalid_or_large' }); }
  }
}
function infoWithId(req) { return { endpoint: req.endpoint, action: req.action, method: req.method, params: req.params, correlation: req.correlation }; }

class Protocol {
  constructor(socket, onEvent = () => {}) {
    this.socket = socket; this.pending = new Map(); this.nextId = 0; this.closed = false;
    socket.addEventListener?.('message', event => {
      const message = parseFrame(event.data); if (!message) return;
      if (message.id) {
        const task = this.pending.get(message.id); if (!task) return;
        this.pending.delete(message.id); clearTimeout(task.timer);
        if (message.error) task.reject(Error('cdp_command_failed')); else task.resolve(message.result || {});
      } else if (['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'].includes(message.method)) {
        Promise.resolve(onEvent(message)).catch(() => this.close());
      }
    });
    socket.addEventListener?.('close', () => this.close());
    socket.addEventListener?.('error', () => this.close());
  }
  async send(method, params = {}) {
    const valid = method === 'Network.enable' && JSON.stringify(params) === JSON.stringify({ maxTotalBufferSize: 131072, maxResourceBufferSize: 65536, maxPostDataSize: 4096 }) || method === 'Network.disable' && Object.keys(params).length === 0 || method === 'Network.getResponseBody' && Object.keys(params).length === 1 && typeof params.requestId === 'string' && params.requestId.length <= 128;
    if (!valid || this.closed || this.pending.size >= 32) throw Error('cdp_command_not_allowed_or_closed');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('cdp_timeout')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch { clearTimeout(timer); this.pending.delete(id); reject(Error('cdp_send_failed')); }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(Error('cdp_closed')); }
    this.pending.clear(); this.socket.close();
  }
}
class Summary {
  constructor() { this.records = 0; this.groups = new Map(); this.markers = []; }
  add(record) {
    if (++this.records > 10000) throw Error('summary_record_limit');
    if (record.kind === 'marker') { if (this.markers.length < 100) this.markers.push({ at: record.at, marker: record.marker, causality: 'unproven' }); return; }
    const key = record.endpoint + ':' + record.action;
    if (!this.groups.has(key)) { if (this.groups.size >= 64) return; this.groups.set(key, { endpoint: record.endpoint, action: record.action, count: 0, errors: 0, schema: {}, present: {} }); }
    const group = this.groups.get(key); group.count++;
    if (['error', 'skipped'].includes(record.kind)) group.errors++;
    const fields = record.schema || (record.data !== undefined ? schema(record.data) : {});
    for (const [field, types] of Object.entries(fields).slice(0, 1500)) {
      group.schema[field] = [...new Set([...(group.schema[field] || []), ...types])].sort();
      group.present[field] = (group.present[field] || 0) + 1;
    }
  }
  snapshot() { return { records: this.records, groups: [...this.groups.values()], markers: this.markers, note: 'Presence counts are observed body counts, not proof of server optionality. Markers show timing, not causality.' }; }
}

function secureWindows(target, create) {
  const escaped = target.replace(/'/g, "''");
  const script = `$ErrorActionPreference='Stop'; $p='${escaped}'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; ` +
    (create ? "$acl=Get-Acl -LiteralPath $p; $acl.SetAccessRuleProtection($true,$false); @($acl.Access) | ForEach-Object { [void]$acl.RemoveAccessRuleSpecific($_) }; $acl.SetOwner($sid); $inherit=if(Test-Path -LiteralPath $p -PathType Container){'ContainerInherit,ObjectInherit'}else{'None'}; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl; " : '') +
    "$acl=Get-Acl -LiteralPath $p; if($acl.Owner -ne $sid.Value -and ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'owner'}; foreach($r in $acl.Access){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'access'}}; if(-not $acl.AreAccessRulesProtected){throw 'inheritance'}; 'PRIVATE_OK'";
  let result;
  try { result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 10000 }); } catch { throw Error('private_acl_unverified'); }
  if (result.trim() !== 'PRIVATE_OK') throw Error('private_acl_unverified');
}
function noLinks(target) {
  let part = path.resolve(target);
  while (true) {
    if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw Error('private_symlink_refused');
    const parent = path.dirname(part); if (parent === part) break; part = parent;
  }
}
function sanitizeRecord(record) {
  if (!record || !['request', 'response', 'body', 'marker', 'error', 'skipped', 'limit'].includes(record.kind)) throw Error('invalid_record');
  const out = { kind: record.kind };
  if (Number.isFinite(record.at)) out.at = record.at;
  if (Number.isInteger(record.correlation) && record.correlation > 0) out.correlation = record.correlation;
  if (record.kind === 'marker') {
    if (!/^(search|select_pole|select_equipment|open_view|consult_widget|batch|area|topology)_\d{1,3}$/.test(record.marker)) throw Error('invalid_marker');
    out.marker = record.marker; out.causality = 'unproven'; return out;
  }
  out.endpoint = ENDPOINTS[record.endpoint] ? record.endpoint : 'unknown';
  out.action = ENDPOINTS[out.endpoint]?.includes(record.action) ? record.action : 'unknown';
  if (['GET', 'POST'].includes(record.method)) out.method = record.method;
  if (record.params) {
    const params = new URLSearchParams();
    params.set('action', out.action);
    for (const [key, value] of Object.entries(record.params)) params.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    out.params = requestInfo({ url: 'https://st.saesa.cl:8082' + out.endpoint, method: 'POST', postData: params.toString() }, 'https://st.saesa.cl:8082')?.params || {};
  }
  if (Number.isInteger(record.status) && record.status >= 0 && record.status <= 599) out.status = record.status;
  if (typeof record.readable === 'boolean') out.readable = record.readable;
  if (['network_failed', 'body_not_eligible', 'body_unavailable_invalid_or_large', 'event_limit', 'pending_limit'].includes(record.reason)) out.reason = record.reason;
  if (record.data !== undefined) out.data = project(record.data);
  if (record.schema) {
    out.schema = {};
    for (const [field, types] of Object.entries(record.schema).slice(0, 1500)) {
      const names = field.replaceAll('[]', '').replaceAll('[unknown]', '').split('.').slice(1);
      const recognized = Array.isArray(types) ? types.filter(type => ['null', 'object', 'array', 'string', 'number', 'boolean'].includes(type)) : [];
      if (field.length < 512 && field.startsWith('$') && names.every(name => !name || SCHEMA_KEYS.has(name)) && recognized.length) out.schema[field] = [...new Set(recognized)].sort();
    }
  }
  if (record.evidence === 'observed_response_projection') out.evidence = record.evidence;
  return out;
}
function openPrivateWriter(directory) {
  noLinks(directory);
  const existed = fs.existsSync(directory);
  if (!existed) fs.mkdirSync(directory, { mode: 0o700 });
  if (process.platform === 'win32') secureWindows(directory, !existed);
  else if ((fs.statSync(directory).mode & 0o077) !== 0) throw Error('private_permissions_unverified');
  const file = path.join(directory, `capture-${Date.now()}-${process.pid}.jsonl`);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { if (process.platform === 'win32') secureWindows(file, true); } catch { fs.closeSync(fd); throw Error('private_acl_unverified'); }
  let count = 0, bytes = 0, closed = false;
  return { file, write(record) {
    if (closed || ++count > 10000) throw Error('writer_limit');
    const clean = sanitizeRecord(record);
    const line = JSON.stringify(clean) + '\n'; bytes += Buffer.byteLength(line);
    if (Buffer.byteLength(line) > 131072 || bytes > 8388608) throw Error('writer_limit');
    fs.writeSync(fd, line);
  }, close() { if (!closed) { fs.closeSync(fd); closed = true; } } };
}
module.exports = { Collector, Protocol, Summary, parseFrame, project, schema, sanitizeRecord, validateOrigin, validateEndpoint, selectTarget, openPrivateWriter, LIMIT };
