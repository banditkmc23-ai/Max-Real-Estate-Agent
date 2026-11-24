import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const S = require('../photo-safety.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const BASE = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos';
const pub = (room, id) => `${BASE}/${room}/p-${id}.jpg`;

function cloudAfterPush(photos, storedHashes, sessionIds, dirty, cloudUrls) {
  const plan = S.photosToPush({ photos, storedHashes, sessionIds, dirty });
  const cloud = { ...cloudUrls };
  const writes = [];
  for (const k of plan.push) {
    const id = k.slice(6);
    const photo = photos.find(p => String(p.id) === id);
    const resolved = S.resolvePhotoUrl({ incomingUrl: photo && photo.url, existingUrl: cloud[id] == null ? '' : cloud[id] });
    writes.push({ id, ...resolved });
    if (!resolved.blocked) cloud[id] = resolved.url;
  }
  return { plan, cloud, writes };
}

test('only photo ids edited this session are pushed', () => {
  const photos = [];
  const stored = {};
  const dirty = {};
  for (let i = 0; i < 20; i++) {
    photos.push({ id: 'p' + i, hash: 'local-' + i, url: '' });
    stored['photo|p' + i] = 'cloud-' + i;
    dirty['photo|p' + i] = { rev: 1 };
  }
  const none = S.photosToPush({ photos, storedHashes: stored, sessionIds: [], dirty });
  assert.deepEqual(none.push, []);
  assert.equal(none.skipped.length, 20);
  assert.equal(Object.keys(none.dirty).length, 0);

  const one = S.photosToPush({ photos, storedHashes: stored, sessionIds: ['p3'], dirty });
  assert.deepEqual(one.push, ['photo|p3']);
  assert.equal(one.skipped.length, 19);
  assert.ok(one.dirty['photo|p3']);
  assert.equal(one.dirty['photo|p4'], undefined);

  const explicit = S.photosToPush({
    photos: [{ id: 'gone', hash: 'x' }],
    storedHashes: {},
    sessionIds: [],
    dirty: { 'photo|gone': { rev: 4, del: true, explicit: true } }
  });
  assert.deepEqual(explicit.push, ['photo|gone']);
});

test('a stale device cannot blank public photo urls', () => {
  const N = 4900;
  const photos = [];
  const stored = {};
  const dirty = {};
  const cloud = {};
  for (let i = 0; i < N; i++) {
    const id = 'p' + i;
    photos.push({ id, hash: 'stale-' + i, url: '' });
    stored['photo|' + id] = 'cloud-' + i;
    dirty['photo|' + id] = { rev: 1793981980053 };
    cloud[id] = pub('AbCdEf', id);
  }
  const idle = cloudAfterPush(photos, stored, [], dirty, cloud);
  assert.deepEqual(idle.plan.push, []);
  assert.equal(Object.values(idle.cloud).filter(u => !u).length, 0);
  assert.equal(idle.cloud.p0, cloud.p0);
  assert.equal(idle.cloud['p' + (N - 1)], cloud['p' + (N - 1)]);

  const saved = cloudAfterPush(photos, stored, ['p7'], dirty, cloud);
  assert.deepEqual(saved.plan.push, ['photo|p7']);
  assert.equal(saved.writes.length, 1);
  assert.equal(saved.writes[0].kept, true);
  assert.equal(saved.writes[0].blocked, false);
  assert.equal(saved.cloud.p7, cloud.p7);
  assert.equal(Object.values(saved.cloud).filter(u => !S.isPublicRoomPhoto(u)).length, 0);
  assert.equal(saved.plan.skipped.length, N - 1);
});

test('empty url never replaces a public url on push or pull, and a real url still wins', () => {
  const kept = pub('room01', 'cover');
  const next = pub('room01', 'new');
  assert.equal(S.resolvePhotoUrl({ incomingUrl: '', existingUrl: kept }).url, kept);
  assert.equal(S.resolvePhotoUrl({ incomingUrl: '   ', existingUrl: kept }).url, kept);
  assert.equal(S.resolvePhotoUrl({ incomingUrl: undefined, existingUrl: kept }).url, kept);
  assert.equal(S.resolvePhotoUrl({ incomingUrl: '', existingUrl: null }).blocked, true);
  assert.equal(S.resolvePhotoUrl({ incomingUrl: '', existingUrl: '' }).url, '');
  assert.equal(S.resolvePhotoUrl({ incomingUrl: next, existingUrl: kept }).url, next);
  assert.equal(S.resolvePhotoUrl({ incomingUrl: next, existingUrl: '' }).url, next);
  const pull = S.resolvePhotoUrl({ incomingUrl: '', existingUrl: kept });
  assert.equal(pull.kept, true);
  assert.equal(pull.url, kept);
});

test('sharing a public url is wired to mark that photo dirty', () => {
  const features = read('features.js');
  const off = features.slice(features.indexOf('async function offloadUploaded'), features.indexOf('const photoKey'));
  assert.match(off, /SYNC\.notePhotoEdited\(p\.id\)/);
  assert.match(features, /const MAX_PHOTOS = 40/);
  const sync = read('sync.js');
  assert.match(sync, /function notePhotoEdited/);
  assert.match(sync, /notePhotoEdited,/);
  assert.match(sync, /sessionPhotoIds/);
  assert.equal(sync.includes('photoWriteAt'), false);
  const scan = sync.slice(sync.indexOf('async function scanPhotos'), sync.indexOf('/* ---------- push ----------'));
  assert.match(scan, /sessionPhotoIds/);
  assert.equal(scan.includes('markDirty(k, true)'), false);
});

test('a missing private file uses the public room-photos object once and does not retry', () => {
  const url = pub('gEs7Xn', 'p9');
  const cands = S.publicRoomPhotoCandidates({
    photoId: 'p/9 id',
    shareId: 'gEs7Xn',
    base: BASE,
    knownUrls: [`${BASE}/gEs7Xn/og-old.jpg`]
  });
  assert.equal(S.photoFileKey('p/9 id'), 'p-9-id');
  assert.ok(cands.includes(`${BASE}/gEs7Xn/p-p-9-id.jpg`));
  const fromShare = S.publicRoomPhotoCandidates({ photoId: 'p9', shareId: 'gEs7Xn', base: BASE });
  assert.deepEqual(fromShare, [`${BASE}/gEs7Xn/p-p9.jpg`]);

  let downloads = 0;
  let state = { stopped: false, url: '' };
  for (let tick = 0; tick < 10; tick++) {
    const plan = S.privateMissPlan({
      status: 400,
      publicUrl: '',
      publicObjectUrl: state.url || url,
      stopped: state.stopped,
      privMiss: state.stopped
    });
    if (state.stopped) {
      assert.equal(plan.action, 'skip');
      assert.equal(plan.retry, false);
      assert.equal(plan.stop, true);
      continue;
    }
    downloads++;
    assert.equal(plan.action, 'use-public');
    assert.equal(plan.retry, false);
    assert.equal(plan.stop, true);
    assert.equal(plan.tombstone, false);
    assert.equal(plan.url, url);
    state = { stopped: true, url: plan.url };
  }
  assert.equal(downloads, 1);
  assert.equal(state.url, url);

  const docUrl = S.privateMissPlan({ status: 404, publicUrl: url });
  assert.equal(docUrl.action, 'use-public');
  assert.equal(docUrl.retry, false);
  assert.equal(docUrl.url, url);

  const sync = read('sync.js');
  const fill = sync.slice(sync.indexOf('async function fillFulls'), sync.indexOf('/* ---------- room list preview'));
  assert.match(fill, /photoFail/);
  assert.match(fill, /privMiss/);
  assert.match(fill, /findPublicRoomPhoto/);
  assert.match(sync, /guardedPhotoMeta/);
  assert.match(sync, /resolvePhotoUrl/);
  assert.match(read('sw.js'), /const VERSION = 'v94'/);
  assert.match(read('index.html'), /const APP_VERSION = '9\.55'/);
});
