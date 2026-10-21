'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { module: { exports: {} }, document: { querySelector: () => null }, console: { error() {} } };
vm.runInNewContext(fs.readFileSync('v4.js', 'utf8'), sandbox);
const tables = sandbox.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const routeHeader = 'ID;Numero;Subestacion;Longitud;Latitud;SupervisorColor;BloqueID';
const openingHeader = 'ID;Numero;Codigo;Longitud;Latitud;SupervisorColor;Bloques';
const route = (overrides = {}) => ({ id: 'route-a', numero: 27, subestacion: 'Station A',
  longitud: -72.5, latitud: -38.75, supervisorColor: 'Verde', bloqueId: 'B1', ...overrides });
const opening = (overrides = {}) => ({ id: 'opening-a', numero: 4, codigo: 'Opening A',
  longitud: -72.25, latitud: -38.5, supervisorColor: 'Azul', bloques: ['B1', 'B2'], ...overrides });

test('route CSV imports semicolon data with stable numbers, decimal comma/dot and one block', () => {
  assert.equal(typeof tables.parseRouteCSV, 'function', 'Independent route CSV import must exist');
  assert.deepEqual(plain(tables.parseRouteCSV('\ufeff' + routeHeader + '\r\n' +
    'route-a;27;Station A;-72,5;-38,75;Verde;B1\r\n' +
    'route-b;2;Station B;-72.25;-38.5;Sin asignar;')), [route(),
    route({ id: 'route-b', numero: 2, subestacion: 'Station B', longitud: -72.25, latitud: -38.5,
      supervisorColor: 'Sin asignar', bloqueId: '' })]);
});

test('opening CSV supports multiple unique shared block references', () => {
  assert.equal(typeof tables.parseOpeningCSV, 'function', 'Independent opening CSV import must exist');
  assert.deepEqual(plain(tables.parseOpeningCSV(openingHeader + '\n' +
    'opening-a;4;Opening A;-72,25;-38.5;Azul;B1|B2|B1')), [opening()]);
});

test('both tables round trip every field, quoted multiline text and noncompact numbering', () => {
  assert.equal(typeof tables.serializeRouteCSV, 'function');
  assert.equal(typeof tables.serializeOpeningCSV, 'function');
  const routes = [route({ numero: 90, subestacion: 'Station; "North"\nline' }),
    route({ id: 'route-b', numero: 2, subestacion: '', bloqueId: '' })];
  const openings = [opening({ codigo: 'Switch; "North"\nline' }),
    opening({ id: 'opening-b', numero: 1, codigo: '', bloques: [] })];
  const routeCSV = tables.serializeRouteCSV(routes), openingCSV = tables.serializeOpeningCSV(openings);
  assert.equal(routeCSV.split('\r\n')[0], routeHeader);
  assert.equal(openingCSV.split('\r\n')[0], openingHeader);
  assert.deepEqual(plain(tables.parseRouteCSV(routeCSV)), routes);
  assert.deepEqual(plain(tables.parseOpeningCSV(openingCSV)), openings);
  assert.deepEqual(plain(tables.parseOpeningCSV(tables.serializeOpeningCSV([]))), []);
});

test('blank IDs avoid explicit IDs in both tables and become stable after export', () => {
  assert.equal(typeof tables.normalizeRouteRows, 'function');
  const routes = tables.normalizeRouteRows([route({ id: '', numero: 11 }), route({ id: 'marker-1' })], ['marker-2']);
  assert.equal(routes[1].id, 'marker-1');
  assert.ok(routes[0].id && !['marker-1', 'marker-2'].includes(routes[0].id));
  const openings = tables.normalizeOpeningRows([opening({ id: '' })], routes.map(row => row.id));
  assert.equal(new Set([...routes, ...openings].map(row => row.id)).size, 3);
  assert.deepEqual(plain(tables.parseRouteCSV(tables.serializeRouteCSV(routes))), plain(routes));
});

test('both tables reject duplicate or invalid identities including cross-table ID collisions', () => {
  assert.equal(typeof tables.normalizeRouteRows, 'function');
  assert.equal(typeof tables.normalizeOpeningRows, 'function');
  for (const [normalize, make] of [[tables.normalizeRouteRows, route], [tables.normalizeOpeningRows, opening]]) {
    for (const rows of [[make(), make({ numero: 2 })], [make(), make({ id: 'other' })],
      [make({ id: 'bad id' })], [make({ id: 'bad|id' })], [make({ numero: 0 })],
      [make({ numero: -1 })], [make({ numero: 1.5 })], [make({ numero: '2abc' })],
      [make({ numero: Number.MAX_SAFE_INTEGER + 1 })]]) assert.throws(() => normalize(rows), /ID|Numero/);
    assert.throws(() => normalize([make({ id: 'reserved' })], ['reserved']), /ID/);
  }
});

test('rejects multiple route blocks, invalid coordinates/supervisors and malformed or wrong-schema CSV', () => {
  assert.equal(typeof tables.normalizeRouteRows, 'function');
  assert.throws(() => tables.normalizeRouteRows([route({ bloqueId: 'B1|B2' })]), /BloqueID/);
  for (const [normalize, make] of [[tables.normalizeRouteRows, route], [tables.normalizeOpeningRows, opening]]) {
    for (const overrides of [{ longitud: '' }, { longitud: '72oops' }, { longitud: 181 },
      { latitud: -91 }, { latitud: Infinity }, { supervisorColor: 'Red' }]) assert.throws(() => normalize([make(overrides)]));
  }
  for (const csv of [openingHeader, 'Numero;Codigo\n1;A', routeHeader + '\n"unclosed',
    routeHeader + '\na;1;Code;-72;-38;Verde', routeHeader + '\na;1;Co"de;-72;-38;Verde;']) {
    assert.throws(() => tables.parseRouteCSV(csv));
  }
});

function browserPanel() {
  const elements = [], downloads = [], atlasSleeps = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; this.events = {}; this.attributes = {}; elements.push(this); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, listener) { this.events[event] = listener; }
    after() {}
    remove() {}
    click() { return this.events.click?.(); }
  }
  class Feature {
    constructor(properties) { this.properties = properties; }
    get(key) { return this.properties[key]; }
    set(key, value) { this.properties[key] = value; }
    getGeometry() { return this.get('geometry'); }
  }
  class Point {
    constructor(xy) { this.xy = xy; }
    getCoordinates() { return this.xy; }
    getType() { return 'Point'; }
  }
  class Vector {
    constructor(options) { Object.assign(this, options); }
    getFeatures() { return this.features; }
    removeFeature(feature) { this.features = this.features.filter(value => value !== feature); }
    getSource() { return this.source; }
    getZIndex() { return this.zIndex; }
    changed() {}
  }
  const doc = { createElement: tag => new Element(tag), createTextNode: text => ({ text }), body: new Element('body') };
  const layers = [], animations = []; 
  const map = { getLayers: () => ({ getArray: () => layers }), addLayer: layer => layers.push(layer),
    removeLayer: layer => layers.splice(layers.indexOf(layer), 1),
    getSize: () => [1000, 800],
    getView: () => ({ getProjection: () => 'test-projection', getResolutionForZoom: () => 1, getZoom: () => 18,
      animate: options => animations.push(options), fit() {} }) };
  const ol = { Feature, geom: { Point }, source: { Vector }, layer: { Vector }, format: { KML: class {} },
    style: Object.fromEntries(['Style', 'Circle', 'Icon', 'Text', 'Fill', 'Stroke'].map(key => [key, class { constructor(options) { this.options = options; } }])),
    proj: { fromLonLat: xy => xy.map(value => value * 100), toLonLat: xy => xy.map(value => value / 100) } };
  const window = { document: doc, webMap_: { map }, ol,
    URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} }, setTimeout(callback, delay) { if (delay === 800) atlasSleeps.push(callback); } };
  const reload = () => vm.runInNewContext(fs.readFileSync('v4.js', 'utf8').replace(
    'w.__superponerKMZ = {', 'w.__superponerKMZ = { atlasPoints: puntosParaAtlas, atlasSVG: svgPuntos, seedAtlas: () => { capturasAtlas = [{}]; }, atlasPrepared: () => Boolean(capturasAtlas), prepareAtlas: () => { obtenerPlanAtlas = () => ({total: 1, estimated: 1, paper: {dpi: 100}, sheets: [{}]}); crearRenderizador = () => ({}); destruirRenderizador = () => {}; capturarHoja = async () => ({}); return prepararAtlas(); },'), {
    document: { querySelector: () => ({ contentWindow: window }) }, Blob,
    console: { log() {}, error() {}, warn() {} }
  });
  reload();
  const input = elements.find(element => element.accept === '.csv,text/csv');
  return { window, downloads, layers, reload, animations, atlasSleeps,
    control: label => elements.findLast(element => element.attributes['aria-label'] === label),
    button: label => elements.find(element => element.tag === 'button' && element.textContent === label),
    rows: () => elements.find(element => element.tag === 'tbody').children,
    change: (element, value) => { assert.ok(element, 'The requested control must exist');
      if (element.type === 'checkbox') element.checked = value; else element.value = value;
      element.events.change?.(); },
    importCSV: async (kind, csv) => {
      elements.find(element => element.textContent === (kind === 'route' ? 'Importar recorrido CSV' : 'Importar aperturas CSV')).click();
      input.files = [{ name: kind + '.csv', text: async () => csv }]; await input.events.change();
    },
    exportCSV: kind => elements.find(element => element.textContent ===
      (kind === 'route' ? 'Guardar recorrido CSV' : 'Guardar aperturas CSV')).click() };
}

test('browser imports tables independently, preserves fields and retains data on rejected replacement', async () => {
  const browser = browserPanel();
  await browser.importCSV('route', routeHeader + '\na;27;;-72,5;-38,75;Verde;B1');
  await browser.importCSV('opening', openingHeader + '\nb;4;Opening A;-72.25;-38.5;Azul;B1|B2');
  const points = browser.window.__superponerKMZ.getPuntos();
  assert.equal(points.length, 2);
  assert.deepEqual(plain(points[0].getGeometry().getCoordinates()), [-7250, -3875]);
  browser.exportCSV('route'); browser.exportCSV('opening');
  assert.deepEqual(plain(tables.parseRouteCSV(await browser.downloads[0].text())), [route({ id: 'a', subestacion: '' })]);
  assert.deepEqual(plain(tables.parseOpeningCSV(await browser.downloads[1].text())), [opening({ id: 'b' })]);
  await browser.importCSV('opening', openingHeader + '\nb;4;Edited;-71;-37;Naranjo;B4');
  assert.equal(browser.window.__superponerKMZ.getPuntos().length, 2);
  assert.equal(browser.window.__superponerKMZ.getPuntos().find(point => point.get('id') === 'a').get('numero'), 27);
  await browser.importCSV('route', routeHeader + '\nc;90;Replacement;-71;-37;Verde;B4');
  assert.deepEqual(plain(browser.window.__superponerKMZ.getPuntos().map(point => point.get('id')).sort()), ['b', 'c']);
  await browser.importCSV('route', routeHeader + '\nb;1;Collision;-71;-37;Verde;B4');
  assert.deepEqual(plain(browser.window.__superponerKMZ.getPuntos().map(point => point.get('id')).sort()), ['b', 'c']);
  await browser.importCSV('opening', openingHeader);
  assert.deepEqual(plain(browser.window.__superponerKMZ.getPuntos().map(point => point.get('id'))), ['c']);
  assert.equal(browser.layers.length, 1);
});


test('rerunning the panel retains both tables when their visible numbers overlap', async () => {
  const browser = browserPanel();
  await browser.importCSV('route', routeHeader + '\na;1;Station;-72;-38;Verde;B1');
  await browser.importCSV('opening', openingHeader + '\nb;1;Opening;-72;-38;Azul;B1|B2');
  browser.reload();
  assert.deepEqual(plain(browser.window.__superponerKMZ.getPuntos().map(point => point.get('id')).sort()), ['a', 'b']);
  assert.equal(browser.layers.length, 1);
});


async function markerFixture() {
  const browser = browserPanel();
  await browser.importCSV('route', routeHeader + '\na;27;Station A;-72.5;-38.75;Verde;B1\nc;90;Station C;-72;-38;Naranjo;B2');
  await browser.importCSV('opening', openingHeader + '\nb;27;Switch B;-72.25;-38.5;Azul;B1|B2');
  return browser;
}
const rowCheckbox = row => row.children[0].children[0];
const styleFor = (browser, id, resolution = 1) => browser.layers[0].style(
  browser.window.__superponerKMZ.getPuntos().find(point => point.get('id') === id), resolution);

test('overlapping numbers select, focus, assign and delete by stable ID without renumbering survivors', async () => {
  const browser = await markerFixture();
  browser.change(rowCheckbox(browser.rows()[2]), true);
  assert.equal(styleFor(browser, 'b').options.zIndex, 50);
  assert.equal(styleFor(browser, 'a').options.zIndex, 0);
  const selectedSVG = decodeURIComponent(styleFor(browser, 'b').options.image.options.src.split(',')[1]);
  assert.match(selectedSVG, /width="20"/);
  browser.rows()[2].click();
  const focusedSVG = decodeURIComponent(styleFor(browser, 'b').options.image.options.src.split(',')[1]);
  assert.match(focusedSVG, /width="23"/);
  assert.deepEqual(plain(browser.animations[0].center), [-7225, -3850]);
  browser.button('Naranjo').click();
  assert.equal(browser.window.__superponerKMZ.getPuntos().find(point => point.get('id') === 'b').get('bloque'), 'Naranjo');
  assert.equal(browser.window.__superponerKMZ.getPuntos().find(point => point.get('id') === 'a').get('bloque'), 'Verde');
  const remove = browser.button('Eliminar seleccionados');
  assert.ok(remove, 'Removal must explicitly target selected markers');
  remove.click();
  assert.equal(browser.window.__superponerKMZ.getPuntos().length, 3);
  browser.change(rowCheckbox(browser.rows()[2]), true);
  remove.click();
  assert.deepEqual(plain(browser.window.__superponerKMZ.getPuntos().map(point => [point.get('id'), point.get('numero')])), [['a', 27], ['c', 90]]);
  browser.change(rowCheckbox(browser.rows()[0]), true);
  remove.click();
  assert.deepEqual(plain(browser.window.__superponerKMZ.getPuntos().map(point => point.get('numero'))), [90]);
});

test('operational blocks and supervisors filter independently across table, map and atlas', async () => {
  const browser = await markerFixture();
  const block = browser.control('Filtrar por bloque operativo'), supervisor = browser.control('Filtrar por supervisor');
  browser.change(block, 'B1');
  assert.equal(browser.rows().length, 2);
  assert.equal(styleFor(browser, 'c'), null);
  assert.deepEqual(plain(browser.window.__superponerKMZ.atlasPoints().map(point => point.id)), ['a', 'b']);
  browser.change(supervisor, 'Azul');
  assert.equal(browser.rows().length, 1);
  browser.change(block, 'B2');
  assert.equal(browser.rows().length, 1);
  assert.deepEqual(plain(browser.window.__superponerKMZ.atlasPoints().map(point => point.id)), ['b']);
  browser.change(supervisor, '');
  assert.equal(browser.rows().length, 2);
  browser.change(block, '');
  browser.change(rowCheckbox(browser.rows()[2]), true);
  browser.button('Eliminar seleccionados').click();
  browser.change(rowCheckbox(browser.rows()[0]), true);
  browser.button('Eliminar seleccionados').click();
  assert.deepEqual(block.children.map(option => option.value), ['', 'B2']);
});

test('point and X symbols share base bounds and both independent label switches control map and atlas', async () => {
  const browser = await markerFixture();
  const point = styleFor(browser, 'a').options.image.options;
  const icon = styleFor(browser, 'b').options.image.options;
  assert.equal(typeof icon.src, 'string', 'Openings must use an X symbol instead of a circle');
  const svg = decodeURIComponent(icon.src.split(',')[1]);
  assert.match(svg, /<path/);
  assert.match(svg, /#2469d8/);
  assert.equal(Number(svg.match(/width="([\d.]+)"/)[1]), (point.radius + point.stroke.options.width / 2) * 2);
  browser.change(browser.control('Mostrar numero'), false);
  browser.change(browser.control('Mostrar codigo'), true);
  assert.equal(styleFor(browser, 'b').options.text.options.text, 'Switch B');
  assert.equal(styleFor(browser, 'b', 25).options.text, undefined);
  const api = browser.window.__superponerKMZ;
  const points = api.atlasPoints();
  assert.equal(points.find(point => point.id === 'b').tipo, 'APERTURA');
  const sheet = { size: [100, 100], resolution: 10, center: [-7225, -3850], ps: points, dpi: 100 };
  let atlas = api.atlasSVG(sheet);
  assert.match(atlas, /<path/); assert.match(atlas, /<circle/); assert.match(atlas, /Switch B/);
  browser.change(browser.control('Mostrar numero'), true);
  assert.match(styleFor(browser, 'b').options.text.options.text, /^27.*Switch B$/);
  browser.change(browser.control('Mostrar codigo'), false);
  assert.equal(styleFor(browser, 'b').options.text.options.text, '27');
  browser.change(browser.control('Mostrar numero'), false);
  assert.equal(styleFor(browser, 'b').options.text, undefined);
  assert.doesNotMatch(api.atlasSVG(sheet), /<text/);
  browser.change(browser.control('Mostrar codigo'), true);
  assert.doesNotMatch(api.atlasSVG({ ...sheet, resolution: 25 }), /<text/);
  browser.change(browser.control('Momento de etiquetas'), 'siempre');
  assert.match(api.atlasSVG({ ...sheet, resolution: 25 }), /Switch B/);
  browser.change(browser.control('Momento de etiquetas'), 'ninguna');
  assert.equal(styleFor(browser, 'b').options.text, undefined);
  assert.doesNotMatch(api.atlasSVG(sheet), /<text/);
});


test('CSV replacement invalidates previously prepared atlas pages', async () => {
  const browser = await markerFixture();
  const api = browser.window.__superponerKMZ;
  api.seedAtlas();
  await browser.importCSV('route', routeHeader + '\nc;90;Edited;-72;-38;Verde;B2');
  assert.equal(api.atlasPrepared(), false, 'Old atlas pages cannot remain printable after replacing route data');
});


test('a label mutation during the final atlas wait prevents stale pages from becoming printable', async () => {
  const browser = await markerFixture();
  const api = browser.window.__superponerKMZ;
  const preparation = api.prepareAtlas();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(browser.atlasSleeps.length, 1, 'Preparation must be paused after its final capture');
  browser.change(browser.control('Mostrar codigo'), true);
  browser.atlasSleeps.shift()();
  await preparation;
  assert.equal(api.atlasPrepared(), false, 'Changing labels must discard an active atlas plan');
  assert.equal(browser.button('Abrir e imprimir / Guardar PDF').disabled, true);
});
