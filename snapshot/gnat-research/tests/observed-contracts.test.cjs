'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { project, schema } = require('../inspector/core.cjs');
const filename = path.join(__dirname, '../fixtures/contracts.observed.anonymized.json');
function evidence() {
  assert.ok(fs.existsSync(filename), 'anonymized observed contract catalog must exist');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

test('observed singleton and two-ID geometry retain independent IDs and coordinate nesting', () => {
  const f = evidence();
  assert.equal(f.provenance.class, 'transformed_observed_response');
  const single = project(f.point);
  const batch = project(f.batch);
  assert.equal(single.data.type, 'Feature');
  assert.equal(single.data.id, 1001);
  assert.deepEqual(single.data.geometry.coordinates, [-10.915995049, -18.932875695]);
  assert.equal(batch.data.type, 'FeatureCollection');
  const byId = new Map(batch.data.features.slice().reverse().map(x => [String(x.id), x]));
  assert.deepEqual([...byId.keys()].sort(), ['1002', '1003']);
  assert.deepEqual(byId.get('1003').geometry.coordinates, [-9.999965762, -20.000055628]);
  assert.equal(byId.get('1002').geometry.type, 'Point');
});

test('observed line stays a LineString and retained source bbox is not replaced by vertex extent', () => {
  const f = evidence();
  assert.deepEqual(project(f.line).data.geometry, {
    type: 'LineString', coordinates: [[-9.999931577, -20.000079709], [-9.999151261, -20.000611599]]
  });
  assert.ok(f.line.data.bbox[1] < Math.min(...f.line.data.geometry.coordinates.map(x => x[1])));
  assert.ok(f.line.data.bbox[3] > Math.max(...f.line.data.geometry.coordinates.map(x => x[1])));
  assert.equal(Object.hasOwn(project(f.line).data, 'bbox'), false, 'observer currently omits bbox');
});

test('observed wrappers and content variants survive schema discovery without inventing a success field', () => {
  const f = evidence();
  assert.equal(Object.hasOwn(f.parts, 'success'), false);
  assert.equal(project(f.parts).total, 2);
  assert.equal(project(f.definition).success, true);
  const types = schema(f.widgetContent);
  assert.deepEqual(types['$.data[].content'], ['array', 'null', 'string']);
  assert.equal(f.externalIds.success, true);
  assert.equal(Object.hasOwn(f.externalIds, 'total'), false);
  assert.equal(f.definition.data.widget_definition.tab_widgets[0].exposition, 'read-only');
  assert.equal(f.externalIds.data[0].read_only, false, 'row flag is separate from read-only tab');
});
