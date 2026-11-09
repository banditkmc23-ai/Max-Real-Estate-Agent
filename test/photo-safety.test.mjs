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
  assert.ok(pullAt >= 0 && pushAt > pullAt, 'full pull must run before push');
  assert.match(loop, /needsFullPullBeforePush/);
  assert.match(sync, /notePhotoDeleted/);
  assert.match(sync, /refused photo deletion batch/);
  const features = read('features.js');
  assert.match(features, /refusing to overwrite published imgs with an empty list/);
  assert.match(features, /shareDecision\(/);
  assert.match(features, /imgsKept/);
  const html = read('index.html');
  assert.match(html, /const APP_VERSION = '9\.35'/);
  assert.match(html, /photo-safety\.js\?v=48/);
  assert.match(html, /UNIT_SHAPE\.normalizeUnits/);
  assert.doesNotMatch(html, /v9\.3(?!\d)/);
  assert.match(html, /function coverSrc/);
  assert.match(html, /function markPhotosUserDeleted/);
  assert.match(html, /SYNC\.notePhotoDeleted/);
  assert.match(read('sw.js'), /const VERSION = 'v70'/);
  assert.match(read('sw.js'), /unit-shape\.js/);
  assert.match(sync, /canonicalJson/);
  assert.match(sync, /needsFullPullBeforePush/);
  assert.match(sync, /planUnitPushes/);
  assert.match(sync, /refused bulk unit push/);
  assert.doesNotMatch(sync, /Object\.values\(st\.retry\)/);
  assert.match(read('sw.js'), /photo-safety\.js/);
  // The Edge Function is still the writer. This change does not edit it; the client stops sending [].
  const edge = read('supabase/functions/share-room/index.ts');
  assert.match(edge, /imgs: urls/);
});

test('stale device, login, and an old pull all require a full pull before push', () => {
  const base = { uid: 'owner', init: true, pulled: 1_000 };
  assert.equal(S.needsFullPullBeforePush(base, { uid: 'owner', login: true, sessionPulled: true, now: 2_000 }), true);
  assert.equal(S.needsFullPullBeforePush(base, { uid: 'owner', login: false, sessionPulled: false, now: 2_000 }), true);
  const caught = { uid: 'owner', init: true, pulled: 1_000, cursor: '2026-11-08T01:02:03.000Z' };
  assert.equal(S.cursorCaughtUp(caught), true);
  assert.equal(S.cursorCaughtUp(base), false);
  assert.equal(S.cursorCaughtUp({ cursor: '1970-01-01T00:00:00Z' }), false);
  assert.equal(S.needsFullPullBeforePush(caught, { uid: 'owner', login: false, sessionPulled: false, now: 2_000, appVersion: '9.33' }), false);
  assert.equal(S.needsFullPullBeforePush({ uid: 'owner', init: true }, { uid: 'owner', login: false, sessionPulled: true, now: 2_000 }), true);
  assert.equal(S.needsFullPullBeforePush(base, { uid: 'other', login: false, sessionPulled: true, now: 2_000 }), true);
  assert.equal(S.needsFullPullBeforePush({ uid: 'owner', init: false, pulled: 1_000 }, { uid: 'owner', sessionPulled: true, now: 2_000 }), true);
  assert.equal(S.needsFullPullBeforePush(base, { uid: 'owner', login: false, sessionPulled: true, now: base.pulled + S.STALE_PULL_MS + 1 }), true);
  assert.equal(S.needsFullPullBeforePush(base, { uid: 'owner', login: false, sessionPulled: true, now: base.pulled + 1000 }), false);
});

test('stale-device login does not mass-push and the new cloud unit appears locally', () => {
  const local = {};
  const acked = {};
  for (let i = 0; i < 389; i++) {
    local['unit|u' + i] = 'same';
    acked['unit|u' + i] = 100;
  }
  // one local row is older than the cloud copy
  local['unit|u0'] = 'old-body';
  const cloud = [];
  for (let i = 0; i < 389; i++) cloud.push({ key: 'unit|u' + i, hash: i === 0 ? 'new-body' : 'same', rev: i === 0 ? 500 : 100 });
  cloud.push({ key: 'unit|temp_1794027118785_ej309z', hash: 'brand-new', rev: 900 });
  const pushed = [];
  for (const row of cloud) {
    const decision = S.decideIncoming({ localHash: local[row.key] || null, cloudHash: row.hash, cloudRev: row.rev, ackedRev: acked[row.key] || 0, sessionEditAt: 0 });
    if (decision.action === 'keep-local') pushed.push(row.key);
    else local[row.key] = row.hash;
  }
  assert.deepEqual(pushed, []);
  assert.equal(local['unit|temp_1794027118785_ej309z'], 'brand-new');
  assert.equal(local['unit|u0'], 'new-body');
  assert.equal(Object.keys(local).length, 390);
  const guard = S.planUnitPushes({ keys: Object.keys(local), knownCount: 390, bulkConfirmed: false });
  assert.equal(guard.refused, true);
  assert.equal(guard.allow.length, 0);
  assert.ok(guard.count > 20);
});

test('equal content is not pushed, a real single edit is, a bulk edit needs confirmation', () => {
  assert.equal(S.decideIncoming({ localHash: 'a', cloudHash: 'a', cloudRev: 50, ackedRev: 10, sessionEditAt: 0 }).action, 'equal');
  assert.equal(S.decideIncoming({ localHash: 'local', cloudHash: 'cloud', cloudRev: 80, ackedRev: 10, sessionEditAt: 0 }).action, 'apply');
  assert.equal(S.decideIncoming({ localHash: 'local', cloudHash: 'cloud', cloudRev: 80, ackedRev: 80, sessionEditAt: 90 }).action, 'keep-local');
  const one = S.planUnitPushes({ keys: ['unit|u1'], knownCount: 390, bulkConfirmed: false });
  assert.equal(one.refused, false);
  assert.deepEqual(one.allow, ['unit|u1']);
  const many = [];
  for (let i = 0; i < 25; i++) many.push('unit|u' + i);
  const blocked = S.planUnitPushes({ keys: many, knownCount: 389, bulkConfirmed: false });
  assert.equal(blocked.refused, true);
  assert.equal(blocked.reason, 'bulk-unit-push-guard');
  const confirmed = S.planUnitPushes({ keys: many, knownCount: 389, bulkConfirmed: true });
  assert.equal(confirmed.refused, false);
  assert.equal(confirmed.allow.length, 25);
});

test('private 400s fall back or fail without a tombstone and the queue does not restart', () => {
  const err400 = { status: 400, message: 'Bad Request' };
  assert.equal(S.isStorageMissing(err400), true);
  assert.equal(S.isStorageMissing({ statusCode: 404, message: 'Object not found' }), true);
  const fallback = S.photoAttemptPlan({ missing: true, hasPublicUrl: true, attempts: 0, now: 1000 });
  assert.equal(fallback.action, 'fallback');
  assert.equal(fallback.retry, false);
  assert.equal(fallback.tombstone, false);
  let attempts = 0;
  let plan;
  for (let n = 0; n < 5; n++) {
    plan = S.photoAttemptPlan({ missing: true, hasPublicUrl: false, attempts, now: 5000 });
    if (!plan.retry) break;
    attempts = plan.attempts;
  }
  assert.equal(plan.action, 'failed');
  assert.equal(plan.tombstone, false);
  assert.equal(plan.attempts, S.PHOTO_TRY_MAX);
  let q = S.enqueuePhotos(null, Array.from({ length: 399 }, (_, i) => ({ id: 'p' + i })));
  assert.equal(q.total, 399);
  assert.equal(q.done, 0);
  for (let i = 0; i < 260; i++) q = S.notePhotoFinished(q, 'p' + i, false);
  assert.equal(q.done, 260);
  // a restart of the same ids must not zero the counter or grow the total
  q = S.enqueuePhotos(q, Array.from({ length: 399 }, (_, i) => ({ id: 'p' + i })));
  assert.equal(q.total, 399);
  assert.equal(q.done, 260);
  for (let i = 260; i < 399; i++) q = S.notePhotoFinished(q, 'p' + i, i >= 390);
  assert.equal(q.done, 399);
  assert.equal(Object.keys(q.failed).length, 9);
  const chip = S.syncChipState({ signedIn: true, online: true, busy: false, failedPhotos: 9 });
  assert.equal(chip.state, 'pending');
  assert.match(chip.detail, /9/);
  assert.notEqual(chip.state, 'off');
  assert.equal(S.syncChipState({ signedIn: true, online: true, busy: false, failedPhotos: 0, dirty: 0 }).state, 'ok');
});

test('sync stays quiet in the header and still parses', () => {
  const html = read('index.html');
  const chipAt = html.indexOf('id="syncChip"');
  const chip = html.slice(chipAt, chipAt + 800);
  assert.match(chip, /class="sync-pill /);
  assert.match(html, /\.sync-pill \{ width: 40px; height: 40px;/);
  assert.equal(chip.includes('<span>'), false);
  assert.equal(chip.includes('ซิงก์ '), false);
  const sync = read('sync.js');
  new Function(sync);
  new Function(read('photo-safety.js'));
  const ui = sync.slice(sync.indexOf('function setStatus'), sync.indexOf('let view'));
  assert.match(ui, /paintChip\(\)/);
  assert.match(ui, /paintProgress\(\)/);
  assert.match(ui, /< 2000/);
  assert.equal(ui.includes('lucide.createIcons'), false);
  assert.equal(ui.includes("innerHTML = `<i"), false);
  assert.match(sync, /id="syncProgress"/);
  assert.match(sync, /id="syncProgressFill"/);
  const pull = sync.slice(sync.indexOf('async function pull'), sync.indexOf('function queuePhotos'));
  assert.match(pull, /await yieldThread\(\)/);
  assert.match(pull, /gt\('server_at', since\)/);
  const apply = sync.slice(sync.indexOf('async function applyRows'), sync.indexOf('function publicPhotoUrl'));
  assert.match(apply, /queueAppRefresh\(false\)/);
  assert.equal(apply.includes('reloadFromStorage()'), false);
  const photos = sync.slice(sync.indexOf('async function applyPhotos'), sync.indexOf('function resetPhotoQueue'));
  assert.match(photos, /splice\(0, 8\)/);
  assert.match(photos, /await yieldThread\(\)/);
  assert.match(sync, /requestIdleCallback/);
  const tap = sync.slice(sync.indexOf('chip:'), sync.indexOf('confirmUnits'));
  assert.equal(tap.includes('full: true'), false);
  assert.match(html, /keepMedia/);
  assert.match(html, /#c2552d/);
});
