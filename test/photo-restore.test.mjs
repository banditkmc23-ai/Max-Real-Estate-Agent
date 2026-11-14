import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const R = require('../photo-restore.js');
const S = require('../photo-safety.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const OWNER = '051c9fdb-a563-4b3c-8a33-2e3661d7b4cc';
const sha256 = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

function item(over) {
  const bytes = Buffer.from(over.bytes || 'jpeg-bytes');
  return {
    photoId: over.photoId,
    unitId: over.unitId,
    sha256: over.sha256 || sha256(bytes),
    image_bytes: over.image_bytes == null ? bytes.length : over.image_bytes,
    order: over.order === undefined ? 4 : over.order,
    cover: !!over.cover,
    ts: over.ts === undefined ? 20 : over.ts,
    bytes
  };
}

function harness(opts) {
  const uploads = [];
  const pushes = [];
  const shares = [];
  const gone = [];
  const rows = opts.rows;
  const names = opts.names;
  let sharePending = (opts.sharePending || []).slice();
  const deps = {
    isOwner: opts.isOwner !== false,
    userId: opts.userId || '051c9fdb-a563-4b3c-8a33-2e3661d7b4cc',
    now: () => opts.now || 5000,
    loadRows: async () => {
      opts.rowReads = (opts.rowReads || 0) + 1;
      return rows;
    },
    listNames: async () => names,
    readAsset: async (it) => {
      const found = opts.items.find(x => x.photoId === it.photoId);
      if (!found) throw new Error('missing asset');
      opts.reads = (opts.reads || 0) + 1;
      return found.bytes;
    },
    sha256,
    objectUrl: path => 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/authenticated/user-photos/' + path,
    upload: async spec => {
      uploads.push(spec);
      if (opts.failUpload === spec.photoId) throw new Error('network');
      const len = spec.bytes.length || spec.bytes.byteLength;
      return { fsz: len, tsz: len, blob: spec.bytes };
    },
    pushLive: async row => {
      pushes.push(row);
      if (opts.failPush === row.id) throw new Error('rpc');
      rows.set(row.id, { id: row.id, deleted: false, rev: row.rev, data: row.data });
      names.add(R.objectName(row.id));
    },
    unmarkGone: async id => { gone.push(id); },
    loadSharePending: async () => sharePending.slice(),
    saveSharePending: async ids => { sharePending = ids.slice(); },
    photosForUnit: async unitId => (opts.photos && opts.photos[unitId]) || [],
    refreshShare: async (unitId, photos) => {
      if (!photos || !photos.length) throw new Error('empty imgs must not be written');
      shares.push({ unitId, photos });
      if (opts.failShare === unitId) throw new Error('share down');
      return opts.shareResult && opts.shareResult[unitId] ? opts.shareResult[unitId] : { pending: false, updated: true };
    },
    onProgress: opts.onProgress || (() => {})
  };
  return { deps, uploads, pushes, shares, gone, pending: () => sharePending };
}

test('the card is owner-only and the restore pack is addressed by the manifest', () => {
  assert.equal(R.isOwner(null), false);
  assert.equal(R.isOwner({ id: 'someone-else' }), false);
  assert.equal(R.isOwner({ id: OWNER }), true);
  assert.equal(R.OWNER_ID, OWNER);
  assert.equal(R.MANIFEST_URL, 'restore/2026-11-07/missing_restore_pending_upload_manifest.json');
  assert.equal(R.assetUrl({ unitId: 'u1', photoId: 'p1' }), 'restore/2026-11-07/missing_source_assets/u1/p1.jpg');
  assert.equal(R.storagePath(OWNER, 'p1'), OWNER + '/p1.jpg');
  assert.equal(R.thumbPath(OWNER, 'p1'), OWNER + '/p1_t.jpg');
});

test('a live row with its file already in the bucket is skipped', async () => {
  const a = item({ photoId: 'p1', unitId: 'u1', cover: true });
  const rows = new Map([['p1', { id: 'p1', deleted: false, rev: 3, data: { url: 'x' } }]]);
  const names = new Set(['p1.jpg']);
  const h = harness({ items: [a], rows, names });
  const result = await R.runRestore([a], h.deps);
  assert.equal(result.skipped, 1);
  assert.equal(result.restored, 0);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.pushes.length, 0);
  assert.equal(h.gone.length, 0);
});

test('a deleted row is uploaded on the normal path then unmarked deleted with the same identity', async () => {
  const a = item({ photoId: 'p9', unitId: 'room-1', order: 15, cover: true, ts: 99 });
  const rows = new Map([['p9', { id: 'p9', deleted: true, rev: 40 }]]);
  const names = new Set();
  const progress = [];
  const h = harness({ items: [a], rows, names, onProgress: p => progress.push(p.status || p.phase), photos: { 'room-1': [{ id: 'p9', url: 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/AbCdEf/p-p9.jpg' }] } });
  const result = await R.runRestore([a], h.deps);
  assert.equal(result.restored, 1);
  assert.equal(h.uploads.length, 1);
  const up = h.uploads[0];
  assert.equal(up.bucket, 'user-photos');
  assert.equal(up.path, OWNER + '/p9.jpg');
  assert.equal(up.thumbPath, OWNER + '/p9_t.jpg');
  assert.equal(up.contentType, 'image/jpeg');
  assert.equal(up.upsert, true);
  assert.equal(up.cacheControl, '3600');
  assert.equal(up.alreadyStored, false);
  const row = h.pushes[0];
  assert.equal(row.kind, 'photo');
  assert.equal(row.id, 'p9');
  assert.equal(row.deleted, false);
  assert.equal(row.restore, true);
  assert.equal(row.rev > 40, true);
  assert.equal(row.data.unitId, 'room-1');
  assert.equal(row.data.order, 15);
  assert.equal(row.data.cover, true);
  assert.equal(row.data.ts, 99);
  assert.match(row.data.url, /\/user-photos\/.+\/p9\.jpg$/);
  assert.deepEqual(h.gone, ['p9']);
  assert.equal(h.shares.length, 1);
  assert.equal(h.shares[0].photos.length, 1);
  assert.ok(progress.includes('restored'));
});

test('order null is preserved and an existing object is not uploaded again', async () => {
  const a = item({ photoId: 'p2', unitId: 'u2', order: null, cover: false, ts: 0 });
  const rows = new Map([['p2', { id: 'p2', deleted: true, rev: 8 }]]);
  const names = new Set(['p2.jpg']);
  const h = harness({ items: [a], rows, names, photos: { u2: [{ id: 'p2' }] } });
  await R.runRestore([a], h.deps);
  assert.equal(h.uploads[0].alreadyStored, true);
  assert.equal(h.pushes[0].data.order, null);
  assert.equal(h.pushes[0].data.ts, 0);
  assert.equal(h.pushes[0].data.cover, false);
  assert.equal(h.pushes[0].id, 'p2');
});

test('a sha256 mismatch stops the run before upload and before later photos', async () => {
  const a = item({ photoId: 'p1', unitId: 'u1' });
  const b = item({ photoId: 'p2', unitId: 'u1', sha256: 'a'.repeat(64) });
  const c = item({ photoId: 'p3', unitId: 'u1' });
  const rows = new Map([
    ['p1', { deleted: true, rev: 1 }],
    ['p2', { deleted: true, rev: 1 }],
    ['p3', { deleted: true, rev: 1 }]
  ]);
  const h = harness({ items: [a, b, c], rows, names: new Set() });
  await assert.rejects(() => R.runRestore([a, b, c], h.deps), err => err.code === 'sha256' && /p2/.test(err.message));
  assert.deepEqual(h.uploads.map(u => u.photoId), ['p1']);
  assert.deepEqual(h.pushes.map(p => p.id), ['p1']);
  assert.equal(h.shares.length, 0);
});

test('a missing photo row, an upload error, and a push error each stop the queue', async () => {
  const a = item({ photoId: 'p1', unitId: 'u1' });
  const b = item({ photoId: 'p2', unitId: 'u1' });
  const missing = harness({ items: [a], rows: new Map(), names: new Set() });
  await assert.rejects(() => R.runRestore([a], missing.deps), err => err.code === 'missing-row');
  assert.equal(missing.uploads.length, 0);

  const up = harness({ items: [a, b], rows: new Map([['p1', { deleted: true, rev: 1 }], ['p2', { deleted: true, rev: 1 }]]), names: new Set(), failUpload: 'p1' });
  await assert.rejects(() => R.runRestore([a, b], up.deps), err => err.code === 'upload');
  assert.deepEqual(up.uploads.map(x => x.photoId), ['p1']);
  assert.equal(up.pushes.length, 0);

  const push = harness({ items: [a, b], rows: new Map([['p1', { deleted: true, rev: 1 }], ['p2', { deleted: true, rev: 1 }]]), names: new Set(), failPush: 'p1' });
  await assert.rejects(() => R.runRestore([a, b], push.deps), err => err.code === 'push');
  assert.deepEqual(push.pushes.map(x => x.id), ['p1']);
});

test('resume is idempotent and share refresh never receives an empty list', async () => {
  const a = item({ photoId: 'p1', unitId: 'u1', cover: true });
  const b = item({ photoId: 'p2', unitId: 'u2' });
  const rows = new Map([['p1', { deleted: true, rev: 2 }], ['p2', { deleted: true, rev: 2 }]]);
  const names = new Set();
  const photos = { u1: [{ id: 'p1', url: 'https://example.test/a.jpg' }], u2: [] };
  const h = harness({ items: [a, b], rows, names, photos, sharePending: ['u-old'] });
  const first = await R.runRestore([a, b], h.deps);
  assert.equal(first.restored, 2);
  assert.equal(h.shares.length, 1);
  assert.equal(h.shares[0].unitId, 'u1');
  assert.ok(h.shares[0].photos.length > 0);
  assert.deepEqual(h.pending(), ['u-old', 'u2']);

  h.uploads.length = 0;
  h.pushes.length = 0;
  h.shares.length = 0;
  const second = await R.runRestore([a, b], h.deps);
  assert.equal(second.skipped, 2);
  assert.equal(second.restored, 0);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.pushes.length, 0);
  assert.equal(h.shares.length, 0);
  assert.deepEqual(h.pending(), ['u-old', 'u2']);
});

test('a share failure stops later rooms and keeps the unit pending', async () => {
  const a = item({ photoId: 'p1', unitId: 'u1' });
  const b = item({ photoId: 'p2', unitId: 'u2' });
  const rows = new Map([['p1', { deleted: false, rev: 1 }], ['p2', { deleted: false, rev: 1 }]]);
  const names = new Set(['p1.jpg', 'p2.jpg']);
  const h = harness({
    items: [a, b],
    rows,
    names,
    sharePending: ['u1', 'u2'],
    photos: { u1: [{ id: 'p1' }], u2: [{ id: 'p2' }] },
    failShare: 'u1'
  });
  await assert.rejects(() => R.runRestore([a, b], h.deps), err => err.code === 'share');
  assert.deepEqual(h.shares.map(s => s.unitId), ['u1']);
  assert.deepEqual(h.pending(), ['u1', 'u2']);
});

test('a non-owner cannot run the restore', async () => {
  let reads = 0;
  await assert.rejects(() => R.runRestore([], { isOwner: false, userId: 'x', loadRows: async () => { reads++; return new Map(); } }), err => err.code === 'not-owner');
  assert.equal(reads, 0);
});

test('restoring the whole manifest is not a photo deletion', () => {
  const dirty = {};
  const explicitDel = {};
  for (let i = 0; i < 1103; i++) dirty['photo|p' + i] = { rev: 1000 + i, restore: true, explicit: true };
  const plan = S.planPhotoTombstones({ dirty, explicitDel, knownPhotoCount: 1103, bulkConfirmed: false, now: 1 });
  assert.equal(plan.allow.length, 0);
  assert.equal(plan.refused, false);
  assert.equal(R.shareRefreshPlan([]).action, 'keep');
  assert.equal(R.shareRefreshPlan([{ id: 'p1' }]).action, 'refresh');
  assert.deepEqual(R.unmarkGoneList([{ k: 'p1', t: 1 }, { k: 'p2', t: 2 }], 'p1'), [{ k: 'p2', t: 2 }]);
});

test('the hosted manifest has 1,103 verified photos', () => {
  const manifest = JSON.parse(read('restore/2026-11-07/missing_restore_pending_upload_manifest.json'));
  assert.equal(manifest.length, 1103);
  const ids = new Set();
  const units = new Set();
  for (const raw of manifest) {
    const item = R.normalizeItem(raw);
    ids.add(item.photoId);
    units.add(item.unitId);
    const file = new URL('restore/2026-11-07/missing_source_assets/' + item.unitId + '/' + item.photoId + '.jpg', root);
    const buf = fs.readFileSync(file);
    assert.equal(buf.length, raw.image_bytes);
    assert.equal(sha256(buf), raw.sha256);
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
  }
  assert.equal(ids.size, 1103);
  assert.equal(units.size, 110);
});

test('settings shows กู้รูป only in the sheet, version 9.45, and the sync path stays a live write', () => {
  const html = read('index.html');
  const nav = html.slice(html.indexOf('bottom-nav'), html.indexOf('id="cfgSheet"'));
  assert.equal(nav.includes('กู้รูป'), false);
  assert.equal(nav.includes('photoRestore'), false);
  assert.match(html, /id="photoRestoreCard" class="hidden/);
  assert.match(html, /กู้รูปที่หาย/);
  assert.match(html, /#c2552d/);
  assert.match(html, /lg:max-w-\[460px\]/);
  assert.match(html, /const APP_VERSION = '9\.45'/);
  assert.match(html, /photo-restore\.js\?v=46/);
  assert.match(html, /PHOTO_RESTORE\.refresh\(\)/);
  const sw = read('sw.js');
  assert.match(sw, /const VERSION = 'v84'/);
  assert.match(sw, /photo-restore\.js/);
  assert.match(sw, /\/restore\//);
  const sync = read('sync.js');
  const restoreFn = sync.slice(sync.indexOf('async function restorePhoto'), sync.indexOf('function photoDeletePlan'));
  assert.match(restoreFn, /deleted: false, data: meta/);
  assert.match(restoreFn, /restore: true, explicit: true/);
  assert.equal(restoreFn.includes('.remove('), false);
  assert.match(sync, /d\.restore && photoRestoreHold/);
  assert.match(sync, /uploadBlob/);
  const tool = read('photo-restore.js');
  assert.equal(tool.includes('service_role'), false);
  assert.equal(tool.includes('SERVICE_ROLE'), false);
  assert.match(tool, /user-photos/);
  assert.match(tool, /sync_push|restorePhoto/);
  assert.match(read('supabase/sync.sql'), /user_id = auth\.uid\(\)/);
});
