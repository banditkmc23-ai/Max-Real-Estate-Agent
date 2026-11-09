/* Lightweight room-list preview.
   A summary is a local copy of the fields the list needs. It is not a synced row:
   it is never pushed back, it does not take the cloud rev, and a later full row
   replaces it. A real edit made on top of a summary is kept and applied onto the
   full cloud body. Richer local rows are left alone. */
(function (root) {
  'use strict';
  var PUB = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/';
  var FILE = /^([A-Za-z0-9]{4,12})\/([A-Za-z0-9_-]{1,80})\.(jpe?g|png|webp)$/i;
  var SUMMARY_KEYS = ['project', 'room', 'floor', 'building', 'station', 'stationDist', 'rent', 'size', 'type', 'bath', 'view', 'status', 'salePrice', 'sourceUrl', 'owner', 'ownerPhone', 'ownerLine', 'start', 'end', 'notes', 'fav', 'createdAt', 'lastPosted', 'postCount'];
  var SUMMARY_SET = {};
  SUMMARY_KEYS.forEach(function (k) { SUMMARY_SET[k] = true; });
  var NUM_KEYS = { rent: 1, size: 1, salePrice: 1, stationDist: 1, postCount: 1, createdAt: 1, lastPosted: 1 };
  var covers = Object.create(null);

  function hashStr(s) {
    s = String(s || '');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '.' + s.length;
  }
  function canonVal(k, obj) {
    if (!obj) return '';
    var v = obj[k];
    if (v === undefined || v === null || v === false) return '';
    if (k === 'fav') return (v === true || v === 'true' || v === 1 || v === '1') ? '1' : '';
    if (NUM_KEYS[k]) {
      if (v === '') return '';
      var n = Number(v);
      if (!isFinite(n) || n === 0) return '';
      return String(n);
    }
    return String(v);
  }
  function first(a, b) {
    if (a !== undefined && a !== null) return a;
    return b;
  }
  function numOr(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }
  function text(v) { return v === undefined || v === null ? '' : String(v); }

  /* Accept either a summary-view row (snake columns) or a full user_docs data object. */
  function toUnit(row) {
    if (!row || typeof row !== 'object') return null;
    var src = row;
    var id = row.id;
    if (row.data && typeof row.data === 'object' && row.project == null && row.room == null && row.data.project != null) {
      src = row.data;
      id = row.id || src.id;
    }
    var sale = first(src.salePrice, src.sale_price);
    var stationDist = first(src.stationDist, src.station_dist);
    var created = first(src.createdAt, src.created_at);
    var posted = first(src.lastPosted, src.last_posted);
    var posts = first(src.postCount, src.post_count);
    var u = {
      id: String(id),
      project: text(src.project),
      building: text(src.building),
      room: text(src.room),
      floor: text(src.floor),
      rent: numOr(src.rent, 0),
      salePrice: sale === undefined || sale === null || sale === '' || Number(sale) === 0 ? '' : numOr(sale, ''),
      type: text(src.type),
      bath: text(src.bath || '1'),
      size: src.size === undefined || src.size === null || src.size === '' || Number(src.size) === 0 ? '' : numOr(src.size, ''),
      view: text(src.view),
      status: text(src.status || 'AVAILABLE'),
      station: text(src.station),
      stationDist: stationDist === undefined || stationDist === null || stationDist === '' || Number(stationDist) === 0 ? '' : numOr(stationDist, ''),
      sourceUrl: text(first(src.sourceUrl, src.source_url)),
      owner: text(src.owner),
      ownerPhone: text(first(src.ownerPhone, src.owner_phone)),
      ownerLine: text(first(src.ownerLine, src.owner_line)),
      start: text(first(src.start, src.start_date)),
      end: text(first(src.end, src.end_date)),
      notes: text(src.notes),
      lastPosted: posted ? numOr(posted, null) : null,
      postCount: numOr(posts, 0)
    };
    var createdN = numOr(created, 0);
    if (createdN) u.createdAt = createdN;
    var fav = first(src.fav, row.fav);
    if (fav === true || fav === 'true' || fav === 't' || fav === 1 || fav === '1') u.fav = true;
    return u;
  }

  function baseOf(unit) {
    var b = { notesHash: hashStr(unit && unit.notes || '') };
    SUMMARY_KEYS.forEach(function (k) {
      if (k === 'notes') return;
      b[k] = unit && unit[k] !== undefined ? unit[k] : '';
    });
    return b;
  }

  /* Keys the user changed after the summary was stored.
     Fields the summary never carried (share, internalNote, …) count only when
     the local row actually has a value, so a blank edit form cannot wipe them. */
  function changedKeys(base, local) {
    if (!base || !local) return [];
    var keys = [];
    SUMMARY_KEYS.forEach(function (k) {
      if (k === 'notes') {
        if ((base.notesHash || '') !== hashStr(local.notes || '')) keys.push('notes');
        return;
      }
      if (canonVal(k, base) !== canonVal(k, local)) keys.push(k);
    });
    Object.keys(local).forEach(function (k) {
      if (k === 'id' || SUMMARY_SET[k]) return;
      var v = local[k];
      if (v == null || v === '' || v === false) return;
      if (Array.isArray(v) && !v.length) return;
      if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return;
      keys.push(k);
    });
    return keys;
  }

  function overlay(full, local, keys) {
    var src = full && typeof full === 'object' ? full : {};
    var out = {};
    Object.keys(src).forEach(function (k) { out[k] = src[k]; });
    (keys || []).forEach(function (k) {
      var v = local ? local[k] : undefined;
      if (k === 'fav') {
        if (v === true || v === 'true' || v === 1) out.fav = true;
        else delete out.fav;
        return;
      }
      if (v === undefined || v === null || v === '') {
        if (k === 'rent' || k === 'size') out[k] = 0;
        else if (k === 'notes') out.notes = '';
        else delete out[k];
        return;
      }
      out[k] = v;
    });
    if (local && local.id != null) out.id = local.id;
    else if (src.id != null) out.id = src.id;
    return out;
  }

  /* What to do when the full cloud row arrives for a summary-only local room. */
  function upgrade(base, local, cloud) {
    cloud = cloud || {};
    var keys = changedKeys(base, local);
    if (!local) return { action: 'missing', keys: keys };
    if (cloud.deleted) {
      if (keys.length) return { action: 'keep', keys: keys };
      return { action: 'apply', data: null, edited: false, keys: [] };
    }
    if (!keys.length) return { action: 'apply', data: cloud.data, edited: false, keys: [] };
    return { action: 'apply', data: overlay(cloud.data, local, keys), edited: true, keys: keys };
  }

  /* Skip when the device already has this room for real, or the user has edited it. */
  function acceptSummary(opts) {
    opts = opts || {};
    if (opts.sessionEdit) return { accept: false, reason: 'edit' };
    if (opts.existing && !opts.tracked) return { accept: false, reason: 'richer' };
    if (opts.tracked && opts.haveRev && opts.incomingRev && Number(opts.incomingRev) <= Number(opts.haveRev)) return { accept: false, reason: 'same' };
    return { accept: true, reason: 'fill' };
  }

  /* Summary bodies are never written to the cloud. An explicit delete still is. */
  function pushDecision(opts) {
    opts = opts || {};
    if (!opts.summary) return 'body';
    if (opts.deleted && (opts.sessionEdit || opts.explicit)) return 'delete';
    return 'skip';
  }

  function coverFromUrl(url) {
    var base = String(url || '').split('?')[0];
    if (base.indexOf(PUB) !== 0) return null;
    var m = FILE.exec(base.slice(PUB.length));
    if (!m) return null;
    var stem = m[2], ext = m[3];
    var already = /-t$/i.test(stem) && /^jpe?g$/i.test(ext);
    if (already) {
      var orig = PUB + m[1] + '/' + stem.replace(/-t$/i, '') + '.jpg';
      return { thumb: base, full: orig === base ? base : orig };
    }
    return { thumb: PUB + m[1] + '/' + stem + '-t.jpg', full: base };
  }

  function coverSpec(row) {
    if (!row) return null;
    var n = Number(row.photo_n != null ? row.photo_n : row.n);
    if (!isFinite(n) || n < 0) n = 0;
    n = Math.round(n);
    var pub = coverFromUrl(row.cover_url || row.coverUrl || '');
    if (pub) return { unitId: String(row.id), thumb: pub.thumb, full: pub.full, n: n, privateId: '' };
    if (row.cover_id || row.coverId) {
      var tsz = Number(row.cover_tsz != null ? row.cover_tsz : row.coverTsz);
      return { unitId: String(row.id), thumb: '', full: '', n: n, privateId: String(row.cover_id || row.coverId), preferFull: !(tsz > 0) };
    }
    if (n > 0) return { unitId: String(row.id), thumb: '', full: '', n: n, privateId: '' };
    return null;
  }

  function rememberCover(id, spec) {
    id = String(id || (spec && spec.unitId) || '');
    if (!id) return;
    if (!spec) { delete covers[id]; return; }
    var prev = covers[id] || {};
    covers[id] = {
      thumb: spec.thumb || prev.thumb || '',
      full: spec.full || prev.full || '',
      n: spec.n != null ? spec.n : (prev.n || 0),
      privateId: spec.privateId || ''
    };
  }
  function coverFor(id) {
    var c = covers[String(id || '')];
    if (!c) return null;
    if (!c.thumb && !c.n) return null;
    return { thumb: c.thumb || '', full: c.full || '', n: c.n || 0 };
  }
  function resetCovers() { covers = Object.create(null); }

  /* In-memory stand-in for the unit list write: replace by id, never duplicate. */
  function mergeList(list, changes) {
    var out = Array.isArray(list) ? list.slice() : [];
    (changes || []).forEach(function (c) {
      var i = -1;
      for (var n = 0; n < out.length; n++) if (out[n] && String(out[n].id) === String(c.id)) { i = n; break; }
      if (c.data == null) { if (i >= 0) out.splice(i, 1); }
      else if (i >= 0) out[i] = c.data;
      else out.push(c.data);
    });
    return out;
  }

  var api = {
    PUB: PUB,
    SUMMARY_KEYS: SUMMARY_KEYS,
    hashStr: hashStr,
    toUnit: toUnit,
    baseOf: baseOf,
    changedKeys: changedKeys,
    overlay: overlay,
    upgrade: upgrade,
    acceptSummary: acceptSummary,
    pushDecision: pushDecision,
    coverFromUrl: coverFromUrl,
    coverSpec: coverSpec,
    rememberCover: rememberCover,
    coverFor: coverFor,
    resetCovers: resetCovers,
    mergeList: mergeList
  };
  root.ROOM_SUMMARY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
