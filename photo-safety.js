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
    isPublicRoomPhoto: isPublicRoomPhoto,
    deletionLimit: deletionLimit,
    reconcilePhotoAbsence: reconcilePhotoAbsence,
    planPhotoTombstones: planPhotoTombstones,
    shareImageWrite: shareImageWrite,
    previewSrc: previewSrc,
    recordAfterPrivateFetch: recordAfterPrivateFetch
  };
  root.MAX_PHOTO_SAFETY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
