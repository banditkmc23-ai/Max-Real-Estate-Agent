import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const S = require('../photo-safety.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const PUB = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/2mLjsu/src52-1.jpg';

test('absence of IndexedDB rows never becomes a photo tombstone', () => {
  const hashes = {};
  const dirty = {};
  for (let i = 0; i < 4000; i++) {
    hashes['photo|p' + i] = 'h' + i;
    dirty['photo|p' + i] = { rev: 1793981980053, del: true };
  }
  const rec = S.reconcilePhotoAbsence({ localIds: [], hashes, dirty, explicitDel: {} });
  assert.equal(Object.keys(rec.dirty).filter(k => rec.dirty[k] && rec.dirty[k].del).length, 0);
  assert.equal(rec.blocked.length, 4000);
  assert.equal(rec.blocked.every(b => b.reason === 'missing-indexeddb-is-not-a-delete'), true);
  const plan = S.planPhotoTombstones({ dirty: rec.dirty, explicitDel: {}, knownPhotoCount: rec.known, bulkConfirmed: false, now: 1 });
  assert.deepEqual(plan.allow, []);
  assert.equal(plan.refused, false);
});

test('a single explicit UI delete is pushed', () => {
  const dirty = { 'photo|p1': { rev: 9, del: true, explicit: true } };
  const plan = S.planPhotoTombstones({ dirty, explicitDel: { p1: 5000 }, knownPhotoCount: 4000, bulkConfirmed: false, now: 5000 });
  assert.deepEqual(plan.allow, ['photo|p1']);
  assert.equal(plan.refused, false);
  assert.equal(plan.overThreshold, false);
});

test('a burst over 20 or 10% is refused unless the user confirmed a bulk delete', () => {
  assert.equal(S.deletionLimit(4000), 20);
  assert.equal(S.deletionLimit(100), 10);
  assert.equal(S.deletionLimit(0), 20);
  const dirty = {};
  const explicitDel = {};
  for (let i = 0; i < 25; i++) {
    dirty['photo|p' + i] = { rev: i + 1, del: true, explicit: true };
    explicitDel['p' + i] = 10000;
  }
  const burst = S.planPhotoTombstones({ dirty, explicitDel, knownPhotoCount: 4000, bulkConfirmed: false, now: 10000 });
  assert.equal(burst.refused, true);
  assert.deepEqual(burst.allow, []);
  assert.equal(burst.blocked.filter(b => b.reason === 'bulk-photo-delete-guard').length, 25);

  const spread = {};
  for (let i = 0; i < 25; i++) spread['p' + i] = 10000 + i * 2000;
  const human = S.planPhotoTombstones({ dirty, explicitDel: spread, knownPhotoCount: 4000, bulkConfirmed: false, now: 10000 });
  assert.equal(human.refused, false);
  assert.equal(human.overThreshold, true);
  assert.equal(human.allow.length, 25);

  const room = S.planPhotoTombstones({ dirty, explicitDel, knownPhotoCount: 4000, bulkConfirmed: true, now: 10000 });
  assert.equal(room.refused, false);
  assert.equal(room.allow.length, 25);

  const small = S.planPhotoTombstones({
    dirty: { 'photo|a': { del: true, explicit: true }, 'photo|b': { del: true, explicit: true } },
    explicitDel: { a: 1, b: 1 },
    knownPhotoCount: 100,
    bulkConfirmed: false,
    now: 1
  });
  assert.equal(small.refused, false);
  assert.equal(small.allow.length, 2);
});

test('explicit flag without a recorded UI intent is still blocked', () => {
  const plan = S.planPhotoTombstones({
    dirty: { 'photo|p9': { del: true, explicit: true } },
    explicitDel: {},
    knownPhotoCount: 10,
    bulkConfirmed: true,
    now: 1
  });
  assert.deepEqual(plan.allow, []);
  assert.equal(plan.blocked[0].reason, 'missing-indexeddb-is-not-a-delete');
});

test('reconcile does not tombstone a photo that is merely absent', () => {
  const before = { 'unit|u1': { rev: 3 }, 'photo|gone': { rev: 4, del: true, explicit: true } };
  const rec = S.reconcilePhotoAbsence({
    localIds: ['keep'],
    hashes: { 'photo|keep': 'a', 'photo|missing': 'b', 'unit|u1': 'c' },
    dirty: before,
    explicitDel: { gone: 50 }
  });
  assert.equal(rec.dirty['photo|missing'], undefined);
  assert.deepEqual(rec.dirty['photo|gone'], before['photo|gone']);
  assert.deepEqual(rec.dirty['unit|u1'], before['unit|u1']);
  assert.equal(Object.keys(rec.dirty).some(k => k === 'photo|missing'), false);
});

test('share update does not replace a non-empty imgs list with an empty one', () => {
  const missing = S.shareImageWrite({ isUpdate: true, withPhotos: true, localCount: 0, readOk: true, explicitClear: false, publishedCount: 8 });
  assert.equal(missing.action, 'reuse');
  const unknown = S.shareImageWrite({ isUpdate: true, withPhotos: true, localCount: 0, readOk: false, explicitClear: false, publishedCount: null });
  assert.equal(unknown.action, 'keep');
  const cleared = S.shareImageWrite({ isUpdate: true, withPhotos: true, localCount: 0, readOk: true, explicitClear: true, publishedCount: 8 });
  assert.equal(cleared.action, 'clear');
  const alreadyEmpty = S.shareImageWrite({ isUpdate: true, withPhotos: true, localCount: 0, readOk: true, explicitClear: false, publishedCount: 0 });
  assert.equal(alreadyEmpty.action, 'commit');
  const hasLocal = S.shareImageWrite({ isUpdate: true, withPhotos: true, localCount: 3, readOk: true, explicitClear: false, publishedCount: 8 });
  assert.equal(hasLocal.action, 'commit');
  const fresh = S.shareImageWrite({ isUpdate: false, withPhotos: true, localCount: 0, readOk: true, explicitClear: false, publishedCount: null });
  assert.equal(fresh.action, 'commit');
});

test('private download failure falls back to the public room-photos URL', () => {
  const meta = { url: PUB, fsz: 1200, tsz: 400, unitId: 'u1' };
  const fallback = S.recordAfterPrivateFetch({ meta, thumbOk: false, privateFailed: true });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.url, PUB);
  assert.equal(S.previewSrc({ id: 'p1', url: PUB }), PUB);
  assert.equal(S.previewSrc({ id: 'p1', thumb: true, url: PUB }), PUB);
  const noPublic = S.recordAfterPrivateFetch({ meta: { fsz: 10, tsz: 4 }, thumbOk: false, privateFailed: true });
  assert.equal(noPublic.ok, false);
  assert.equal(noPublic.retry, true);
  const thumbOk = S.recordAfterPrivateFetch({ meta, thumbOk: true, privateFailed: false });
  assert.equal(thumbOk.ok, true);
  assert.equal(thumbOk.fallback, false);
});

test('client source no longer infers photo deletes and pulls before the first push', () => {
  const sync = read('sync.js');
  const scan = sync.slice(sync.indexOf('async function scanPhotos'), sync.indexOf('/* ---------- push ----------'));
  assert.equal(scan.includes('markDirty(k, true)'), false);
  assert.equal(scan.includes('!seen.has'), false);
  const loop = sync.slice(sync.indexOf('async function sync'), sync.indexOf('function schedule'));
  const pullAt = loop.indexOf('await pull(');
  const pushAt = loop.indexOf('await push(');
  assert.ok(pullAt >= 0 && pushAt > pullAt, 'init pull must run before push');
  assert.match(loop, /if \(!st\.init\)/);
  assert.match(sync, /notePhotoDeleted/);
  assert.match(sync, /refused photo deletion batch/);
  const features = read('features.js');
  assert.match(features, /refusing to overwrite published imgs with an empty list/);
  assert.match(features, /shareDecision\(/);
  assert.match(features, /imgsKept/);
  const html = read('index.html');
  assert.match(html, /const APP_VERSION = '9\.24'/);
  assert.match(html, /photo-safety\.js\?v=44/);
  assert.match(html, /function coverSrc/);
  assert.match(html, /function markPhotosUserDeleted/);
  assert.match(html, /SYNC\.notePhotoDeleted/);
  assert.match(read('sw.js'), /const VERSION = 'v59'/);
  assert.match(read('sw.js'), /photo-safety\.js/);
  // The Edge Function is still the writer. This change does not edit it; the client stops sending [].
  const edge = read('supabase/functions/share-room/index.ts');
  assert.match(edge, /imgs: urls/);
});

test('a public room-photos URL still serves an image', async () => {
  const res = await fetch(PUB, { method: 'GET' });
  assert.equal(res.status, 200);
  const type = res.headers.get('content-type') || '';
  assert.match(type, /^image\//);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
});
