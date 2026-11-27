/* MAX Agent — big local values live in IndexedDB, not localStorage (v9.56).
   Safari gives each site about 5 MB of localStorage and counts Thai text at 2 bytes
   per character. Rooms + sync state + the cover photo went over that, so writes threw
   "The quota has been exceeded." and cloud sync stopped.
   This moves three large keys to IndexedDB 'max_store' and keeps a synchronous memory
   copy, so existing localStorage.getItem/setItem calls keep working unchanged.
   Migration copies a key, reads it back, and removes the localStorage copy only after
   the copy matches. Nothing is ever cleared wholesale. */
(function (root) {
  'use strict';
  var MOVED = ['max_sync_v1', 'staylow_hero_img', 'staylow_avatar'];
  var FLAG = 'max_store_v1';
  var DB_NAME = 'max_store', OS = 'kv';
  var proto = root.Storage && root.Storage.prototype;
  if (!proto || !root.localStorage) return;
  var LS = root.localStorage;
  var nGet = proto.getItem, nSet = proto.setItem, nRemove = proto.removeItem;
  var mem = new Map();          // moved key -> string (synchronous copy)
  var moved = new Set();        // keys whose source of truth is IndexedDB
  var early = new Map();        // writes made before migration finished that localStorage refused
  var isReady = false, degraded = false, db = null, lastError = null, warned = false;
  var writing = new Map(), queued = new Map();

  function isQuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || '')));
  }
  function lsGet(k) { try { return nGet.call(LS, k); } catch (e) { return null; } }
  function lsRemove(k) { try { nRemove.call(LS, k); } catch (e) {} }
  function lsSetSafe(k, v) { try { nSet.call(LS, k, v); return true; } catch (e) { return false; } }

  function openDB(ms) {
    return new Promise(function (res, rej) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; rej(new Error('IndexedDB open timeout')); } }, ms);
      var r;
      try { r = root.indexedDB.open(DB_NAME, 1); } catch (e) { clearTimeout(t); return rej(e); }
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(OS)) r.result.createObjectStore(OS); };
      r.onsuccess = function () { if (done) { try { r.result.close(); } catch (e) {} return; } done = true; clearTimeout(t); var d = r.result; d.onversionchange = function () { try { d.close(); } catch (e) {} db = null; }; res(d); };
      r.onerror = function () { if (done) return; done = true; clearTimeout(t); rej(r.error); };
      r.onblocked = function () {};
    });
  }
  function run(mode, fn) {
    return new Promise(function (res, rej) {
      if (!db) return rej(new Error('IndexedDB closed'));
      var t, out;
      try { t = db.transaction(OS, mode); } catch (e) { return rej(e); }
      var q = fn(t.objectStore(OS));
      if (q) q.onsuccess = function () { out = q.result; };
      t.oncomplete = function () { res(out); };
      t.onerror = function () { rej(t.error); };
      t.onabort = function () { rej(t.error || new Error('IndexedDB transaction aborted')); };
    });
  }
  function idbGet(k) { return run('readonly', function (s) { return s.get(k); }); }
  function idbPut(k, v) { return run('readwrite', function (s) { return s.put(v, k); }); }
  function idbDel(k) { return run('readwrite', function (s) { return s.delete(k); }); }
  async function reopen() { if (!db) db = await openDB(6000); }

  /* Coalesced background write: only the newest value of a key is written. */
  function flush(k) {
    if (writing.get(k)) return writing.get(k);
    var p = (async function () {
      while (queued.has(k)) {
        var v = queued.get(k); queued.delete(k);
        try {
          await reopen();
          if (v === null) await idbDel(k); else await idbPut(k, v);
          lastError = null;
        } catch (e) {
          lastError = e;
          console.warn('store: IndexedDB write failed', k, e);
          // Last resort: keep the value durable in localStorage. Next start copies it back.
          if (v !== null && !lsSetSafe(k, v)) { queued.set(k, v); await new Promise(function (r) { setTimeout(r, 2000); }); db = null; }
        }
      }
    })().finally(function () { writing.delete(k); });
    writing.set(k, p);
    return p;
  }
  function write(k, v) { queued.set(k, v); return flush(k); }

  function handles(k) { return moved.has(String(k)); }

  proto.getItem = function (k) {
    if (this === LS && handles(k)) return mem.has(String(k)) ? mem.get(String(k)) : null;
    if (this === LS && !isReady && early.has(String(k))) return early.get(String(k));
    return nGet.call(this, k);
  };
  proto.setItem = function (k, v) {
    if (this === LS && handles(k)) { var s = String(v); mem.set(String(k), s); write(String(k), s); lsRemove(String(k)); return; }
    try { return nSet.call(this, k, v); }
    catch (e) {
      // Before migration finishes, a moved key that does not fit is held and written to IndexedDB on ready.
      if (this === LS && !isReady && MOVED.indexOf(String(k)) >= 0 && isQuota(e)) { early.set(String(k), String(v)); return; }
      throw e;
    }
  };
  proto.removeItem = function (k) {
    if (this === LS && handles(k)) { mem.delete(String(k)); write(String(k), null); }
    if (this === LS) early.delete(String(k));
    return nRemove.call(this, k);
  };

  async function migrateKey(k) {
    var pre = early.has(k) ? early.get(k) : lsGet(k);
    if (pre != null) {
      await idbPut(k, pre);
      var back = await idbGet(k);
      if (back !== pre) throw new Error('store: read-back mismatch for ' + k);
      mem.set(k, pre); moved.add(k); early.delete(k);
      // Remove the old copy only if nobody changed it while we copied.
      if (lsGet(k) === pre) lsRemove(k);
      else if (lsGet(k) != null) { var newer = lsGet(k); mem.set(k, newer); await idbPut(k, newer); if ((await idbGet(k)) === newer && lsGet(k) === newer) lsRemove(k); }
      return 'copied';
    }
    var v = await idbGet(k);
    if (typeof v === 'string') mem.set(k, v);
    moved.add(k);
    return typeof v === 'string' ? 'loaded' : 'empty';
  }

  var report = {};
  var ready = (async function () {
    if (!root.indexedDB) { isReady = true; return report; }
    var hadMoved = lsGet(FLAG) === '1';
    for (var i = 0; i < 3 && !db; i++) { try { db = await openDB(4000); } catch (e) { lastError = e; } }
    if (!db) {
      // Keys already live in IndexedDB but it will not open: do not guess with empty values.
      if (hadMoved) { degraded = true; MOVED.forEach(function (k) { if (lsGet(k) == null) moved.add(k); }); }
      isReady = true; return report;
    }
    for (var j = 0; j < MOVED.length; j++) {
      var k = MOVED[j];
      try { report[k] = await migrateKey(k); }
      catch (e) { lastError = e; report[k] = 'kept-in-localStorage'; console.warn('store: migration kept', k, 'in localStorage', e); }
    }
    early.forEach(function (v, k) { if (!moved.has(k)) { mem.set(k, v); moved.add(k); write(k, v); } });
    early.clear();
    lsSetSafe(FLAG, '1');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
    isReady = true;
    try { if (typeof root.loadHeroImage === 'function') root.loadHeroImage(); } catch (e) {}
    try { if (typeof root.loadAvatar === 'function') root.loadAvatar(); } catch (e) {}
    return report;
  })();

  function lsUsage() {
    var n = 0;
    try { for (var i = 0; i < LS.length; i++) { var k = LS.key(i), v = nGet.call(LS, k) || ''; n += (k.length + v.length) * (/[^\u0000-\u00ff]/.test(v) ? 2 : 1); } } catch (e) {}
    return n;
  }
  /* Called by app writers (persist) when localStorage refuses a write. Retries once after
     migration has freed space; otherwise warns the user once so nothing fails silently. */
  function onWriteFail(e, retry) {
    if (!isQuota(e)) return;
    if (!isReady && typeof retry === 'function') { ready.then(function () { try { retry(true); } catch (e2) { onWriteFail(e2); } }); return; }
    if (!warned) {
      warned = true;
      try { if (typeof root.toast === 'function') root.toast('⚠️ พื้นที่เก็บข้อมูลในเครื่องเต็ม การแก้ไขล่าสุดยังไม่ถูกบันทึกในเครื่อง'); } catch (e3) {}
    }
    console.warn('store: localStorage full', lsUsage(), e);
  }

  root.MAX_STORE = {
    MOVED: MOVED.slice(),
    ready: ready,
    isReady: function () { return isReady; },
    isDegraded: function () { return degraded; },
    isQuota: isQuota,
    onWriteFail: onWriteFail,
    flushAll: function () { return Promise.all(Array.from(writing.values())); },
    lastError: function () { return lastError; },
    usage: lsUsage,
    report: function () { return report; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
