/* MAX Agent — photo sync / share safety.
   A missing IndexedDB row is not a delete. Tombstones are explicit UI actions only.
   A share update must not replace a non-empty public image list with [].
   Loaded before sync.js and features.js. No network and no storage of its own. */
(function (root) {
  'use strict';
  var PHOTO_DEL_ABS = 20;
  var PHOTO_DEL_PCT = 0.10;
  var PUB_MARK = '/storage/v1/object/public/room-photos/';
  var BULK_WINDOW_MS = 120000;
  var BURST_MS = 1500;
  var STALE_PULL_MS = 10 * 60 * 1000;
  var PHOTO_TRY_MAX = 3;
  var PHOTO_BACKOFF = [15000, 60000, 180000];

  function isPublicRoomPhoto(url) {
    return typeof url === 'string' && url.indexOf(PUB_MARK) !== -1;
  }

  /* Max photo tombstones in one sync: 20, or 10% of the library, whichever is smaller. */
  function deletionLimit(known) {
    var n = Number(known) || 0;
    if (n <= 0) return PHOTO_DEL_ABS;
    var pct = Math.max(1, Math.ceil(n * PHOTO_DEL_PCT));
    return Math.min(PHOTO_DEL_ABS, pct);
  }

  /* Drop photo tombstones that were inferred because the local row is gone.
     Never creates a deletion. Explicit UI deletes (dirty.explicit + explicitDel[id]) stay. */
  function reconcilePhotoAbsence(opts) {
    opts = opts || {};
    var local = {};
    (opts.localIds || []).forEach(function (id) { local[String(id)] = true; });
    var next = {};
    var dirty = opts.dirty || {};
    Object.keys(dirty).forEach(function (k) { next[k] = dirty[k]; });
    var explicit = opts.explicitDel || {};
    var blocked = [];
    var known = 0;
    function drop(k) {
      if (!next[k] || !next[k].del) return;
      blocked.push({ key: k, reason: 'missing-indexeddb-is-not-a-delete' });
      delete next[k];
    }
    Object.keys(opts.hashes || {}).forEach(function (k) {
      if (k.indexOf('photo|') !== 0) return;
      known++;
      if (local[k.slice(6)]) return;
      var d = next[k];
      if (d && d.del && !(d.explicit && explicit[k.slice(6)])) drop(k);
    });
    Object.keys(next).forEach(function (k) {
      if (k.indexOf('photo|') !== 0) return;
      var d = next[k];
      if (d && d.del && !(d.explicit && explicit[k.slice(6)])) drop(k);
    });
    var explicitN = Object.keys(explicit).length;
    var localN = Object.keys(local).length;
    return { dirty: next, blocked: blocked, known: Math.max(known, localN, explicitN) };
  }

  /* Which photo tombstones may be pushed.
     Non-explicit deletes are always blocked.
     A burst larger than deletionLimit is blocked unless the user confirmed a bulk delete. */
  function planPhotoTombstones(opts) {
    opts = opts || {};
    var dirty = opts.dirty || {};
    var explicit = opts.explicitDel || {};
    var allow = [];
    var blocked = [];
    var stamps = [];
    Object.keys(dirty).forEach(function (k) {
      if (k.indexOf('photo|') !== 0) return;
      var d = dirty[k];
      if (!d || !d.del) return;
      var id = k.slice(6);
      if (!(d.explicit && explicit[id])) {
        blocked.push({ key: k, reason: 'missing-indexeddb-is-not-a-delete' });
        return;
      }
      allow.push(k);
      stamps.push(Number(explicit[id]) || 0);
    });
    var known = Math.max(0, Number(opts.knownPhotoCount) || 0);
    var limit = deletionLimit(known);
    var explicitCount = allow.length;
    var over = explicitCount > limit;
    var refused = false;
    if (over && !opts.bulkConfirmed) {
      var times = stamps.filter(function (t) { return t > 0; }).sort(function (a, b) { return a - b; });
      var span = times.length ? times[times.length - 1] - times[0] : 0;
      if (!times.length || span < BURST_MS) {
        refused = true;
        allow.forEach(function (k) { blocked.push({ key: k, reason: 'bulk-photo-delete-guard' }); });
        allow = [];
      }
    }
    return {
      allow: allow,
      blocked: blocked,
      overThreshold: over,
      refused: refused,
      explicitCount: explicitCount,
      known: known,
      limit: limit
    };
  }

  /* Share commit policy. publishedCount null means the current imgs list could not be read.
     action reuse = send the published URLs (do not replace them with []).
     action keep  = do not write.
     action clear = the user explicitly removed every local photo.
     action commit = send the local list. */
  function shareImageWrite(opts) {
    opts = opts || {};
    if (!opts.isUpdate || !opts.withPhotos || opts.localCount > 0) return { action: 'commit' };
    if (opts.readOk && opts.explicitClear) return { action: 'clear' };
    if (opts.publishedCount == null) return { action: 'keep', reason: 'published-unknown' };
    if (opts.publishedCount > 0) return { action: 'reuse', reason: 'local-photos-missing' };
    return { action: 'commit' };
  }

  /* Public URL used when the private user-photos object is missing. Empty if there is none. */
  function previewSrc(photo) {
    if (!photo) return '';
    if (typeof photo === 'string') return /^https?:\/\//.test(photo) ? photo : '';
    var url = photo.url;
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
    return '';
  }

  /* After a private-bucket download attempt: keep the row when a public URL can stand in. */
  /* A saved server_at cursor means this device already has the library.
     A version reload starts a new page, but it must not download every row again. */
  function cursorCaughtUp(st) {
    var c = st && st.cursor;
    if (typeof c !== 'string' || !c || c.indexOf('1970-01-01') === 0) return false;
    return !isNaN(Date.parse(String(c).replace(' ', 'T')));
  }

  /* A full pull has to finish before any push when this browser is not caught up.
     A login, a uid change, a missing cursor, or a pull older than STALE_PULL_MS counts.
     An app update does not: sessionPulled is false on every fresh page, and a
     live cursor still pulls incrementally with gt(server_at). */
  function needsFullPullBeforePush(st, ctx) {
    st = st || {};
    ctx = ctx || {};
    if (ctx.uid && st.uid && String(ctx.uid) !== String(st.uid)) return true;
    if (!st.init) return true;
    if (!st.pulled) return true;
    if (ctx.login) return true;
    if ((ctx.now || 0) - (st.pulled || 0) > STALE_PULL_MS) return true;
    if (ctx.sessionPulled === false && !cursorCaughtUp(st)) return true;
    return false;
  }

  /* What to do with one cloud row before anything is pushed.
     equal: same body, adopt the cloud rev, do not write it back.
     apply: cloud is newer or this device never acknowledged the row.
     keep-local: this session edited it, or the cloud rev is not newer than the rev we already synced. */
  function decideIncoming(opts) {
    opts = opts || {};
    if (opts.deleted) {
      if (opts.sessionEditAt && opts.sessionEditAt >= (opts.cloudRev || 0)) return { action: 'keep-local' };
      return { action: 'apply' };
    }
    if (opts.localHash && opts.cloudHash && opts.localHash === opts.cloudHash) return { action: 'equal' };
    if (!opts.localHash) return { action: 'apply' };
    if (opts.sessionEditAt && opts.sessionEditAt >= (opts.cloudRev || 0)) return { action: 'keep-local' };
    if (opts.ackedRev && opts.cloudRev && opts.cloudRev > opts.ackedRev) return { action: 'apply' };
    if (!opts.ackedRev && !opts.sessionEditAt) return { action: 'apply' };
    if (opts.ackedRev && opts.cloudRev && opts.cloudRev <= opts.ackedRev) return { action: 'keep-local' };
    return { action: 'apply' };
  }

  /* Unit updates in one push: more than 20 or more than 10% needs an explicit confirm. */
  function planUnitPushes(opts) {
    opts = opts || {};
    var keys = (opts.keys || []).filter(function (k) { return String(k).indexOf('unit|') === 0; });
    var known = Math.max(Number(opts.knownCount) || 0, keys.length);
    var limit = deletionLimit(known);
    var count = keys.length;
    var over = count > limit;
    if (over && !opts.bulkConfirmed) {
      return { allow: [], blocked: keys.slice(), refused: true, overThreshold: true, count: count, known: known, limit: limit, reason: 'bulk-unit-push-guard' };
    }
    return { allow: keys.slice(), blocked: [], refused: false, overThreshold: over, count: count, known: known, limit: limit, reason: '' };
  }

  function isStorageMissing(err) {
    if (err == null) return false;
    var status = Number(err.status != null ? err.status : err.statusCode);
    if (status === 400 || status === 404) return true;
    var msg = String(err.message || err.error || err);
    return /\b(400|404)\b/.test(msg) || /object not found|not found|bad request/i.test(msg);
  }

  /* 400/404 with a public URL is a fallback, not a retry. Otherwise at most 3 tries, then failed. Never a tombstone. */
  function photoAttemptPlan(opts) {
    opts = opts || {};
    var attempts = Number(opts.attempts) || 0;
    if (opts.thumbOk) return { action: 'save', retry: false, attempts: attempts, tombstone: false };
    if (opts.hasPublicUrl && (opts.missing || opts.failed)) return { action: 'fallback', retry: false, attempts: attempts, tombstone: false };
    if (opts.missing || opts.failed) {
      var next = attempts + 1;
      if (next >= PHOTO_TRY_MAX) return { action: 'failed', retry: false, attempts: next, tombstone: false };
      var wait = PHOTO_BACKOFF[Math.min(next - 1, PHOTO_BACKOFF.length - 1)];
      return { action: 'retry', retry: true, attempts: next, nextAt: (opts.now || 0) + wait, tombstone: false };
    }
    if (opts.hasPublicUrl) return { action: 'fallback', retry: false, attempts: attempts, tombstone: false };
    return { action: 'save', retry: false, attempts: attempts, tombstone: false };
  }

  /* Append photo ids. Does not reset done/total, and does not requeue an id already seen. */
  function enqueuePhotos(queue, rows) {
    queue = queue || { order: [], done: 0, total: 0, seen: {}, failed: {} };
    var copy = { order: (queue.order || []).slice(), done: queue.done || 0, total: queue.total || 0, seen: Object.assign({}, queue.seen || {}), failed: Object.assign({}, queue.failed || {}) };
    (rows || []).forEach(function (r) {
      var id = String(r && r.id != null ? r.id : r);
      if (!id || copy.seen[id]) return;
      copy.seen[id] = true;
      copy.order.push(id);
      copy.total++;
    });
    return copy;
  }

  function notePhotoFinished(queue, id, failed) {
    queue = queue || { order: [], done: 0, total: 0, seen: {}, failed: {} };
    var copy = { order: (queue.order || []).slice(), done: queue.done || 0, total: queue.total || 0, seen: Object.assign({}, queue.seen || {}), failed: Object.assign({}, queue.failed || {}) };
    id = String(id);
    if (copy.seen[id] === 'done') return copy;
    if (!copy.seen[id]) return copy;
    copy.seen[id] = 'done';
    copy.done++;
    if (failed) copy.failed[id] = true;
    return copy;
  }

  function syncChipState(opts) {
    opts = opts || {};
    if (!opts.signedIn) return { state: 'off', detail: '' };
    if (opts.online === false) return { state: 'offline', detail: '' };
    if (opts.busy) return { state: 'busy', detail: opts.detail || '' };
    if (opts.unitConfirm) return { state: 'pending', detail: 'รอยืนยันก่อนส่ง ' + opts.unitConfirm + ' ห้อง' };
    if (opts.failedPhotos) return { state: 'pending', detail: 'รูปดึงไม่สำเร็จ ' + opts.failedPhotos };
    if (opts.waitingPhotos) return { state: 'pending', detail: 'รูปจะลองใหม่ ' + opts.waitingPhotos };
    if (opts.dirty || opts.held) return { state: 'pending', detail: opts.held ? 'รอปิดหน้าแก้ไขก่อนรับข้อมูลใหม่' : '' };
    return { state: 'ok', detail: '' };
  }

  function recordAfterPrivateFetch(opts) {
    opts = opts || {};
    var meta = opts.meta || {};
    var url = typeof meta.url === 'string' ? meta.url : '';
    var pub = isPublicRoomPhoto(url) ? url : '';
    if (opts.thumbOk) return { ok: true, fallback: false, url: pub || (/^https?:\/\//.test(url) ? url : '') };
    if (pub) return { ok: true, fallback: true, url: pub };
    if (opts.privateFailed || meta.tsz || meta.fsz) return { ok: false, retry: true, url: '' };
    return { ok: true, fallback: false, url: /^https?:\/\//.test(url) ? url : '' };
  }

  var api = {
    PHOTO_DEL_ABS: PHOTO_DEL_ABS,
    PHOTO_DEL_PCT: PHOTO_DEL_PCT,
    PUB_MARK: PUB_MARK,
    BULK_WINDOW_MS: BULK_WINDOW_MS,
    BURST_MS: BURST_MS,
    STALE_PULL_MS: STALE_PULL_MS,
    PHOTO_TRY_MAX: PHOTO_TRY_MAX,
    isPublicRoomPhoto: isPublicRoomPhoto,
    deletionLimit: deletionLimit,
    reconcilePhotoAbsence: reconcilePhotoAbsence,
    planPhotoTombstones: planPhotoTombstones,
    shareImageWrite: shareImageWrite,
    previewSrc: previewSrc,
    recordAfterPrivateFetch: recordAfterPrivateFetch,
    cursorCaughtUp: cursorCaughtUp,
    needsFullPullBeforePush: needsFullPullBeforePush,
    decideIncoming: decideIncoming,
    planUnitPushes: planUnitPushes,
    isStorageMissing: isStorageMissing,
    photoAttemptPlan: photoAttemptPlan,
    enqueuePhotos: enqueuePhotos,
    notePhotoFinished: notePhotoFinished,
    syncChipState: syncChipState
  };
  root.MAX_PHOTO_SAFETY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
