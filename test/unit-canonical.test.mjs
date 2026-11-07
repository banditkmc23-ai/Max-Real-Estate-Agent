import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SHAPE = require('../unit-shape.js');
const SAFETY = require('../photo-safety.js');

function cloudUnit(i, extra) {
  // Key order is the order sync_push stored, not the order reloadFromStorage builds.
  return Object.assign({
    id: 'u' + i,
    project: i === 389 ? 'New Tower' : 'The Base Park East',
    room: String(100 + i),
    rent: 16000 + i,
    status: i % 5 === 0 ? 'OCCUPIED' : 'AVAILABLE',
    notes: 'ใกล้ BTS ' + i,
    type: '1 Bed',
    size: 32,
    floor: '8',
    owner: 'Owner ' + i,
    ownerPhone: '0622423154',
    fav: i % 11 === 0,
    share: { secret: 'sec' + i, id: 's' + i, opts: { photo: true, hideRoom: false } }
  }, extra || {});
}

function dirtyIds(cloudList) {
  const applied = JSON.parse(JSON.stringify(cloudList));
  const cloudCanon = new Map(applied.map(u => [u.id, SHAPE.canonicalJson('unit', u)]));
  const normalized = SHAPE.normalizeUnits(applied);
  const persisted = JSON.parse(JSON.stringify(normalized));
  return persisted.filter(u => SHAPE.canonicalJson('unit', u) !== cloudCanon.get(u.id)).map(u => u.id);
}

test('reloadFromStorage normalization does not make a pulled unit look edited', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /UNIT_SHAPE\.normalizeUnits\(load\(KEY/);
  assert.match(html, /UNIT_SHAPE\.normalizeUnits\(load\(KEY, \[\]\)\)/);
  const cloud = cloudUnit(7);
  const rawCloud = JSON.stringify(cloud);
  const normalized = SHAPE.normalizeUnits([JSON.parse(rawCloud)])[0];
  const rawLocal = JSON.stringify(normalized);
  assert.notEqual(rawLocal, rawCloud);
  assert.ok(Object.prototype.hasOwnProperty.call(normalized, 'createdAt'));
  assert.equal(normalized.bath, '1');
  assert.equal(normalized.building, '');
  assert.equal(SHAPE.canonicalJson('unit', JSON.parse(rawLocal)), SHAPE.canonicalJson('unit', cloud));
  const same = SAFETY.decideIncoming({
    localHash: SHAPE.canonicalJson('unit', JSON.parse(rawLocal)),
    cloudHash: SHAPE.canonicalJson('unit', cloud),
    cloudRev: 100,
    ackedRev: 100,
    sessionEditAt: 0
  });
  assert.equal(same.action, 'equal');
});

test('390 units through normalizeUnits stay clean, and one rent edit is the only dirty row', () => {
  const cloud = Array.from({ length: 390 }, (_, i) => cloudUnit(i));
  assert.deepEqual(dirtyIds(cloud), []);
  const applied = JSON.parse(JSON.stringify(cloud));
  const persisted = JSON.parse(JSON.stringify(SHAPE.normalizeUnits(applied)));
  persisted[12].rent = 99999;
  const cloudCanon = new Map(cloud.map(u => [u.id, SHAPE.canonicalJson('unit', u)]));
  const dirty = persisted.filter(u => SHAPE.canonicalJson('unit', u) !== cloudCanon.get(u.id)).map(u => 'unit|' + u.id);
  assert.deepEqual(dirty, ['unit|u12']);
  const one = SAFETY.planUnitPushes({ keys: dirty, knownCount: 390, bulkConfirmed: false });
  assert.equal(one.refused, false);
  assert.deepEqual(one.allow, ['unit|u12']);
  const falseBulk = persisted.map(u => 'unit|' + u.id);
  const guard = SAFETY.planUnitPushes({ keys: falseBulk, knownCount: 390, bulkConfirmed: false });
  assert.equal(guard.refused, true);
  assert.equal(guard.allow.length, 0);
});
