/* MAX Agent — กู้รูป (owner-only).
   Restores soft-deleted user_docs photo rows from restore/2026-11-07/.
   Uses the signed-in user's session, the user-photos bucket, and sync_push.
   The folder is safe to remove after the owner finishes the restore.
   No service keys and no policy changes. */
(function (root) {
  'use strict';
  var OWNER_ID = '051c9fdb-a563-4b3c-8a33-2e3661d7b4cc';
  var RESTORE_DIR = 'restore/2026-11-07/';
  var MANIFEST_URL = RESTORE_DIR + 'missing_restore_pending_upload_manifest.json';
  var SHARE_KEY = 'max_photo_restore_shares_v1';
  var GONE_KEY = 'max_gone_photos';
  var ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }
  function isOwner(user) {
    return !!(user && user.id === OWNER_ID);
  }
  function objectName(photoId) {
    return encodeURIComponent(photoId) + '.jpg';
  }
  function storagePath(userId, photoId) {
    return userId + '/' + objectName(photoId);
  }
  function thumbPath(userId, photoId) {
    return userId + '/' + encodeURIComponent(photoId) + '_t.jpg';
  }
  function assetUrl(item) {
    return RESTORE_DIR + 'missing_source_assets/' + encodeURIComponent(item.unitId) + '/' + encodeURIComponent(item.photoId) + '.jpg';
  }
  function byteLen(bytes) {
    if (!bytes) return 0;
    if (typeof bytes.byteLength === 'number') return bytes.byteLength;
    return bytes.length || 0;
  }
  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') throw err('bad-manifest', 'รายการกู้รูปไม่ถูกต้อง');
    var photoId = String(raw.photoId || '');
    var unitId = String(raw.unitId || '');
    if (!ID_RE.test(photoId) || !ID_RE.test(unitId)) throw err('bad-manifest', 'รหัสรูปไม่ถูกต้อง');
    var sha = String(raw.sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) throw err('bad-manifest', 'ไม่มีรหัสตรวจไฟล์ ' + photoId);
    var order = raw.order == null ? null : raw.order;
    var ts = raw.ts == null ? null : raw.ts;
    var imageBytes = raw.image_bytes == null ? null : Number(raw.image_bytes);
    if (imageBytes != null && !Number.isFinite(imageBytes)) throw err('bad-manifest', 'ขนาดไฟล์ไม่ถูกต้อง ' + photoId);
    return { photoId: photoId, unitId: unitId, sha256: sha, image_bytes: imageBytes, order: order, cover: !!raw.cover, ts: ts };
  }
  function isAlreadyLive(row, names, photoId) {
    if (!row || row.deleted) return false;
    if (!names || typeof names.has !== 'function') return false;
    return names.has(objectName(photoId));
  }
  function pendingCount(items, rows, names) {
    var n = 0;
    (items || []).forEach(function (item) {
      var row = rows && rows.get ? rows.get(item.photoId) : null;
      if (!isAlreadyLive(row, names, item.photoId)) n++;
    });
    return n;
  }
  function shareRefreshPlan(photos) {
    var list = [];
    (photos || []).forEach(function (p) {
      if (!p) return;
      if (typeof p === 'string') { if (p) list.push(p); return; }
      if (p.id || p.photoId || p.url) list.push(p);
    });
    if (!list.length) return { action: 'keep', reason: 'empty-list', imgs: [] };
    return { action: 'refresh', count: list.length, imgs: list };
  }
  function unmarkGoneList(list, id) {
    var key = String(id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
    return (list || []).filter(function (x) { return x && x.k !== key; });
  }
  function liveData(item, url, fsz, tsz) {
    return {
      unitId: item.unitId,
      ts: item.ts ?? null,
      order: item.order ?? null,
      cover: !!item.cover,
      url: url || '',
      fsz: fsz,
      tsz: tsz
    };
  }

  async function runRestore(items, deps) {
    deps = deps || {};
    if (!deps.isOwner || !deps.userId) throw err('not-owner', 'ใช้ได้เฉพาะบัญชีเจ้าของ');
    var list = (items || []).map(normalizeItem);
    var rows = await deps.loadRows(list.map(function (item) { return item.photoId; }));
    var names = await deps.listNames();
    if (!rows || !rows.get) throw err('rows', 'อ่านแถวรูปไม่สำเร็จ');
    var sharePending = new Set(await (deps.loadSharePending ? deps.loadSharePending() : []));
    var skipped = 0;
    var restored = 0;
    var total = list.length;
    function report(extra) {
      if (!deps.onProgress) return;
      deps.onProgress(Object.assign({ done: skipped + restored, total: total, skipped: skipped, restored: restored }, extra || {}));
    }
    async function saveShares() {
      if (deps.saveSharePending) await deps.saveSharePending(Array.from(sharePending));
    }
    report({ phase: 'run' });
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var row = rows.get(item.photoId);
      if (isAlreadyLive(row, names, item.photoId)) { skipped++; report({ phase: 'run', photoId: item.photoId, status: 'skip' }); continue; }
      if (!row) throw err('missing-row', 'ไม่พบแถวรูปเดิม ' + item.photoId + ' — หยุดไว้');
      var bytes;
      try { bytes = await deps.readAsset(item); }
      catch (e) { throw err('asset', 'โหลดไฟล์รูปไม่ได้ ' + item.photoId + ' — หยุดไว้'); }
      var len = byteLen(bytes);
      if (item.image_bytes != null && len !== item.image_bytes) throw err('sha256', 'ไฟล์ไม่ตรงกับต้นฉบับ ' + item.photoId + ' — หยุดไว้');
      var hash = String(await deps.sha256(bytes)).toLowerCase();
      if (hash !== item.sha256) throw err('sha256', 'ไฟล์ไม่ตรงกับต้นฉบับ ' + item.photoId + ' — หยุดไว้');
      var path = storagePath(deps.userId, item.photoId);
      var alreadyStored = names.has(objectName(item.photoId));
      var uploaded;
      try {
        uploaded = await deps.upload({
          bucket: 'user-photos',
          path: path,
          thumbPath: thumbPath(deps.userId, item.photoId),
          photoId: item.photoId,
          bytes: bytes,
          contentType: 'image/jpeg',
          upsert: true,
          cacheControl: '3600',
          alreadyStored: alreadyStored
        });
      } catch (e) {
        throw err('upload', 'อัปโหลดไม่สำเร็จ ' + item.photoId + ' — หยุดไว้');
      }
      if (!alreadyStored) names.add(objectName(item.photoId));
      var fsz = uploaded && uploaded.fsz != null ? uploaded.fsz : len;
      var tsz = uploaded && uploaded.tsz != null ? uploaded.tsz : len;
      var url = deps.objectUrl ? deps.objectUrl(path) : '';
      var rev = Math.max(typeof deps.now === 'function' ? deps.now() : Date.now(), (Number(row.rev) || 0) + 1);
      var data = liveData(item, url, fsz, tsz);
      try {
        await deps.pushLive({
          kind: 'photo',
          id: item.photoId,
          rev: rev,
          deleted: false,
          restore: true,
          data: data,
          blob: uploaded && uploaded.blob
        });
      } catch (e) {
        throw err('push', 'บันทึกแถวรูปไม่สำเร็จ ' + item.photoId + ' — หยุดไว้');
      }
      if (deps.unmarkGone) await deps.unmarkGone(item.photoId);
      sharePending.add(item.unitId);
      await saveShares();
      restored++;
      report({ phase: 'run', photoId: item.photoId, status: 'restored' });
    }
    var shareIds = Array.from(sharePending);
    for (var s = 0; s < shareIds.length; s++) {
      var unitId = shareIds[s];
      var photos = deps.photosForUnit ? await deps.photosForUnit(unitId) : [];
      var plan = shareRefreshPlan(photos);
      report({ phase: 'share', unitId: unitId, shareIndex: s + 1, shareTotal: shareIds.length });
      if (plan.action !== 'refresh') continue;
      var result;
      try { result = await deps.refreshShare(unitId, plan.imgs); }
      catch (e) { throw err('share', 'อัปเดตหน้ารูปที่แชร์ไม่สำเร็จ — หยุดไว้'); }
      if (!result || !result.pending) {
        sharePending.delete(unitId);
        await saveShares();
      }
    }
    report({ phase: 'done' });
    return { total: total, skipped: skipped, restored: restored, sharePending: Array.from(sharePending) };
  }

  var api = {
    OWNER_ID: OWNER_ID,
    RESTORE_DIR: RESTORE_DIR,
    MANIFEST_URL: MANIFEST_URL,
    SHARE_KEY: SHARE_KEY,
    isOwner: isOwner,
    objectName: objectName,
    storagePath: storagePath,
    thumbPath: thumbPath,
    assetUrl: assetUrl,
    normalizeItem: normalizeItem,
    isAlreadyLive: isAlreadyLive,
    pendingCount: pendingCount,
    shareRefreshPlan: shareRefreshPlan,
    unmarkGoneList: unmarkGoneList,
    liveData: liveData,
    runRestore: runRestore
  };
  root.PHOTO_RESTORE_CORE = api;

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  var counting = false;
  var running = false;
  var lastPending = null;
  var lastTotal = null;
  var lastRooms = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { try { return Number(n).toLocaleString('th-TH'); } catch (e) { return String(n); } }
  function sessionUser() {
    try { return window.SYNC && SYNC.user ? SYNC.user() : null; } catch (e) { return null; }
  }
  function setMsg(text, bad) {
    var el = $('photoRestoreMsg');
    if (!el) return;
    el.style.color = bad ? '#be123c' : '#6b625a';
    el.textContent = text || '';
  }
  function setBar(done, total) {
    var bar = $('photoRestoreBar');
    if (!bar) return;
    var pct = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    bar.style.width = pct + '%';
  }
  function paintCount() {
    var el = $('photoRestoreCount');
    if (!el) return;
    if (lastPending == null) { el.textContent = 'กำลังตรวจรูปที่หาย...'; return; }
    if (!lastPending) el.textContent = 'กู้ครบแล้ว · ' + fmt(lastTotal || 0) + ' รูป';
    else el.textContent = 'เหลือ ' + fmt(lastPending) + ' รูป · ' + fmt(lastRooms || 0) + ' ห้อง';
  }
  function paintButton() {
    var btn = $('photoRestoreBtn');
    if (!btn) return;
    var shares = readShares().length;
    btn.disabled = !!running || (lastPending === 0 && !shares);
    btn.style.opacity = btn.disabled ? '0.55' : '1';
    if (running) btn.textContent = 'กำลังกู้รูป...';
    else if (lastPending > 0 || lastPending == null) btn.textContent = 'กู้รูปที่หาย';
    else if (shares) btn.textContent = 'อัปเดตลิงก์ที่แชร์';
    else btn.textContent = 'กู้ครบแล้ว';
  }
  function sha256Hex(bytes) {
    var view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    return crypto.subtle.digest('SHA-256', view).then(function (dig) {
      return Array.from(new Uint8Array(dig)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function projectUrl() {
    return (window.FX && FX.sb && FX.sb.url) || 'https://ekpavjlebbclapjdupwf.supabase.co';
  }
  function client() {
    if (!window.SYNC || !SYNC.client) throw err('auth', 'กรุณาเข้าสู่ระบบก่อน');
    return SYNC.client;
  }
  async function listNames(sb, userId) {
    var names = new Set();
    var offset = 0;
    for (;;) {
      var res = await sb.storage.from('user-photos').list(userId, { limit: 1000, offset: offset });
      if (res.error) throw res.error;
      var rows = res.data || [];
      rows.forEach(function (o) { if (o && o.name) names.add(o.name); });
      if (rows.length < 1000) break;
      offset += rows.length;
    }
    return names;
  }
  async function loadRows(sb, ids) {
    var map = new Map();
    for (var i = 0; i < ids.length; i += 80) {
      var chunk = ids.slice(i, i + 80);
      var res = await sb.from('user_docs').select('id,data,rev,deleted').eq('kind', 'photo').in('id', chunk);
      if (res.error) throw res.error;
      (res.data || []).forEach(function (row) { map.set(row.id, row); });
    }
    return map;
  }
  function readShares() {
    try {
      var a = JSON.parse(localStorage.getItem(SHARE_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (id) { return ID_RE.test(String(id)); }) : [];
    } catch (e) { return []; }
  }
  function writeShares(ids) {
    try { localStorage.setItem(SHARE_KEY, JSON.stringify(ids)); } catch (e) {}
  }
  function unmarkGone(id) {
    try {
      var a = JSON.parse(localStorage.getItem(GONE_KEY) || '[]');
      var next = unmarkGoneList(Array.isArray(a) ? a : [], id);
      if (next.length !== a.length) localStorage.setItem(GONE_KEY, JSON.stringify(next));
    } catch (e) {}
  }
  function makeDeps(user) {
    var sb = client();
    return {
      isOwner: true,
      userId: user.id,
      now: function () { return Date.now(); },
      loadRows: function (ids) { return loadRows(sb, ids); },
      listNames: function () { return listNames(sb, user.id); },
      readAsset: async function (item) {
        var res = await fetch(assetUrl(item), { cache: 'no-store' });
        if (!res.ok) throw err('asset', 'โหลดไฟล์รูปไม่ได้');
        return await res.arrayBuffer();
      },
      sha256: sha256Hex,
      objectUrl: function (path) {
        return projectUrl().replace(/\/$/, '') + '/storage/v1/object/authenticated/user-photos/' + path;
      },
      upload: async function (spec) {
        var blob = new Blob([spec.bytes], { type: 'image/jpeg' });
        var sig = blob.size + '/' + blob.size;
        if (spec.alreadyStored) SYNC.rememberUpload(spec.photoId, sig);
        else {
          SYNC.forgetUpload(spec.photoId);
          await SYNC.uploadBlob(spec.photoId, blob, blob);
        }
        return { fsz: blob.size, tsz: blob.size, blob: blob };
      },
      pushLive: async function (row) {
        if (typeof req === 'function' && typeof tx === 'function') {
          await req(tx('readwrite').put({
            id: row.id,
            unitId: row.data.unitId,
            ts: row.data.ts,
            order: row.data.order,
            cover: row.data.cover,
            url: row.data.url,
            full: row.blob,
            thumb: row.blob,
            fsz: row.data.fsz,
            cloud: true
          }));
        }
        await SYNC.restorePhoto(row.id, row.data, row.rev);
      },
      unmarkGone: unmarkGone,
      loadSharePending: async function () { return readShares(); },
      saveSharePending: async function (ids) { writeShares(ids); },
      photosForUnit: function (unitId) {
        if (typeof getUnitPhotos !== 'function') return [];
        return getUnitPhotos(unitId);
      },
      refreshShare: async function (unitId, photos) {
        var plan = shareRefreshPlan(photos);
        if (plan.action !== 'refresh') return { pending: true };
        var list = (typeof units !== 'undefined' && units) || [];
        var u = list.find(function (x) { return x && x.id === unitId; });
        if (!u || !u.share || !u.share.id || !u.share.secret) return { pending: false };
        if (!window.FX || !FX.buildRoomLink) return { pending: true };
        var nw = FX.noWait;
        FX.noWait = true;
        try {
          await FX.buildRoomLink(u, Object.assign({}, u.share.opts || {}, { photo: true }));
        } finally { FX.noWait = nw; }
        return { pending: false, updated: true };
      },
      onProgress: function (p) {
        if (p.phase === 'share') setMsg('กำลังอัปเดตหน้ารูปที่แชร์ ' + fmt(p.shareIndex) + '/' + fmt(p.shareTotal));
        else if (p.total) setMsg('กำลังกู้รูป ' + fmt(p.done) + '/' + fmt(p.total));
        if (p.total) setBar(p.done, p.total);
      }
    };
  }

  async function refresh(opts) {
    var user = sessionUser();
    var card = $('photoRestoreCard');
    if (!card) return false;
    card.classList.toggle('hidden', !isOwner(user));
    if (!isOwner(user) || counting) return false;
    if (running && !(opts && opts.force)) return false;
    counting = true;
    paintCount();
    paintButton();
    try {
      var res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw err('manifest', 'โหลดรายการกู้รูปไม่ได้');
      var items = (await res.json()).map(normalizeItem);
      var deps = makeDeps(user);
      var rows = await deps.loadRows(items.map(function (item) { return item.photoId; }));
      var names = await deps.listNames();
      lastTotal = items.length;
      lastPending = pendingCount(items, rows, names);
      var rooms = {};
      items.forEach(function (item) {
        if (!isAlreadyLive(rows.get(item.photoId), names, item.photoId)) rooms[item.unitId] = true;
      });
      lastRooms = Object.keys(rooms).length;
      setMsg(lastPending ? 'แตะปุ่มเพื่อกู้รูปที่ถูกลบ โดยใช้บัญชีนี้' : 'รูปในชุดนี้กลับมาครบแล้ว');
      setBar(lastTotal - lastPending, lastTotal);
      return true;
    } catch (e) {
      if (lastPending == null) setMsg(e.message || 'ตรวจรายการไม่สำเร็จ', true);
      return false;
    } finally {
      counting = false;
      paintCount();
      paintButton();
      try { window.lucide && lucide.createIcons(); } catch (e) {}
    }
  }

  function syncOwner(user) {
    var card = $('photoRestoreCard');
    if (!card) return;
    var show = isOwner(user);
    card.classList.toggle('hidden', !show);
    if (!show) return;
    if (!running && !counting) refresh();
  }

  async function start() {
    if (running) return;
    var user = sessionUser();
    if (!isOwner(user)) return;
    running = true;
    var outcome = null;
    paintButton();
    setMsg('กำลังเริ่มกู้รูป...');
    try { SYNC.holdRestores(true); } catch (e) {}
    try {
      var res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw err('manifest', 'โหลดรายการกู้รูปไม่ได้');
      var items = await res.json();
      outcome = await runRestore(items, makeDeps(user));
      setBar(outcome.skipped + outcome.restored, outcome.total);
    } catch (e) {
      setMsg(e.message || 'กู้รูปไม่สำเร็จ', true);
    } finally {
      running = false;
      try { SYNC.holdRestores(false); } catch (e) {}
    }
    if (outcome) {
      await refresh({ force: true });
      setMsg('กู้แล้ว ' + fmt(outcome.restored) + ' รูป · ข้าม ' + fmt(outcome.skipped) + ' รูปที่มีอยู่แล้ว');
    }
    paintButton();
  }

  root.PHOTO_RESTORE = {
    start: start,
    refresh: refresh,
    syncOwner: syncOwner,
    isOwner: isOwner
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  syncOwner(sessionUser());
})(typeof globalThis !== 'undefined' ? globalThis : this);
