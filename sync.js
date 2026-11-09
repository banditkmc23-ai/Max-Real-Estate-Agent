/* MAX Agent — private cloud sync (Supabase Auth + user_docs + user-photos bucket).
   Offline-first for rooms and settings. Photo deletions are explicit only:
   a photo missing from IndexedDB is never pushed as deleted:true.
   A photo restore is an explicit live write (deleted:false) of the same id.
   Nothing runs until the user signs in. */
(function () {
'use strict';
if (!window.supabase || !window.FX || !FX.sb) return;
const W = window, LS = localStorage;
const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
const rawGet = k => { try { return LS.getItem(k); } catch (e) { return null; } };
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = m => { try { FX.u.T(m); } catch (e) {} };
const tfetch = (url, opt = {}) => { const ac = new AbortController(), ms = /\/storage\/v1\/object\//.test(String(url)) ? 90000 : 30000; const t = setTimeout(() => ac.abort(), ms);
  if (opt.signal) opt.signal.addEventListener('abort', () => ac.abort());
  return fetch(url, { ...opt, signal: ac.signal }).finally(() => clearTimeout(t)); };
const sb = supabase.createClient(FX.sb.url, FX.sb.h.apikey, { global: { fetch: tfetch }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'max_auth' } });
FX.sbc = sb;
const BUCKET = 'user-photos';

/* ---------- what syncs ---------- */
const ADP = [
  { kind: 'unit', key: 'staylow_units_v1', type: 'list' },
  { kind: 'cust', key: 'staylow_customers_v1', type: 'list' },
  { kind: 'appt', key: 'staylow_appointments_v1', type: 'list' },
  { kind: 'inv', key: 'staylow_invoices_v1', type: 'map2' },
  { kind: 'comm', key: 'max_commissions_v1', type: 'list' },
  { kind: 'occ', key: 'staylow_monthly_occupancy_v1', type: 'map1' },
  ...['staylow_post_cfg_v1', 'staylow_invoice_cfg_v1', 'staylow_avatar', 'staylow_hero_img', 'staylow_wm', 'max_share_opts', 'max_catalog'].map(key => ({ kind: 'kv', key, type: 'kv' }))
];
const TRACKED = new Set(ADP.map(a => a.key));
const adpFor = (kind, id) => kind === 'kv' ? ADP.find(a => a.kind === 'kv' && a.key === id) : ADP.find(a => a.kind === kind);
const J = (k, d) => { try { const s = rawGet(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } };
function explode(a) {
  const m = new Map();
  if (a.type === 'kv') { const s = rawGet(a.key); if (s != null) m.set(a.key, JSON.stringify(s)); return m; }
  const v = J(a.key, a.type === 'list' ? [] : {});
  if (a.type === 'list') { if (Array.isArray(v)) v.forEach(x => { if (x && x.id != null) m.set(String(x.id), JSON.stringify(x)); }); }
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    Object.entries(v).forEach(([k1, v1]) => {
      if (a.type === 'map1') m.set(k1, JSON.stringify(v1));
      else if (v1 && typeof v1 === 'object') Object.entries(v1).forEach(([k2, v2]) => m.set(k1 + '|' + k2, JSON.stringify(v2)));
    });
  }
  return m;
}
function applyTo(a, changes) { // changes: [{id, data|null}]
  if (a.type === 'kv') { for (const c of changes) { if (c.data == null) rawRemove.call(LS, a.key); else rawSet.call(LS, a.key, String(c.data)); } return; }
  if (a.type === 'list') {
    const arr = J(a.key, []); const list = Array.isArray(arr) ? arr : [];
    for (const c of changes) { const i = list.findIndex(x => x && String(x.id) === c.id); if (c.data == null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = c.data; else list.push(c.data); }
    rawSet.call(LS, a.key, JSON.stringify(list)); return;
  }
  let o = J(a.key, {}); if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  for (const c of changes) {
    if (a.type === 'map1') { if (c.data == null) delete o[c.id]; else o[c.id] = c.data; continue; }
    const p = c.id.indexOf('|'), k1 = c.id.slice(0, p), k2 = c.id.slice(p + 1);
    if (c.data == null) { if (o[k1]) { delete o[k1][k2]; if (!Object.keys(o[k1]).length) delete o[k1]; } }
    else { o[k1] = o[k1] && typeof o[k1] === 'object' ? o[k1] : {}; o[k1][k2] = c.data; }
  }
  rawSet.call(LS, a.key, JSON.stringify(o));
}
const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '.' + s.length; };

/* ---------- state ---------- */
const SK = 'max_sync_v1';
const fresh = uid => ({ uid, cursor: '1970-01-01T00:00:00Z', h: {}, dirty: {}, r: {}, up: {}, retry: {}, explicitDel: {}, restoreMeta: {}, cloudHash: {}, photoTry: {}, photoFail: {}, summary: {}, init: false, last: 0 });
let st = J(SK, null) || fresh(null);
['h', 'dirty', 'r', 'up', 'retry', 'explicitDel', 'restoreMeta', 'cloudHash', 'photoTry', 'photoFail', 'summary'].forEach(k => { st[k] = st[k] || {}; });
const saveSt = () => { try { rawSet.call(LS, SK, JSON.stringify(st)); } catch (e) {} };
let filling = false, user = null, status = 'off', detail = '', running = false, again = false, timer = null, photoRestoreHold = false;
let sessionPulled = false, loginPull = false, photoWriteAt = 0, draining = false;
const sessionEdits = {};
let photoQ = { order: [], done: 0, total: 0, seen: {}, failed: {} };
const photoRows = {};

/* ---------- photos (IndexedDB 'staylow_photos') ---------- */
const P = () => (typeof db !== 'undefined' && db) ? db : null;
const idb = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pstore = mode => P().transaction('photos', mode).objectStore('photos');
const pmeta = p => ({ unitId: p.unitId, ts: p.ts ?? null, order: p.order ?? null, cover: !!p.cover, url: p.url || '', fsz: p.full ? p.full.size : (p.fsz || 0), tsz: p.thumb ? p.thumb.size : 0 });
const path = (id, t) => `${user.id}/${encodeURIComponent(id)}${t ? '_t' : ''}.jpg`;
const ctype = b => /^image\/(jpeg|png|webp)$/.test(b && b.type) ? b.type : 'image/jpeg';
async function download(pth) { const { data, error } = await sb.storage.from(BUCKET).download(pth); if (error) throw error; return data; }

/* ---------- local change detection ---------- */
const now = () => Date.now();
function markDirty(k, del, explicit) {
  const prev = (st.dirty[k] && st.dirty[k].rev) || 0;
  const rev = (explicit || st.init) ? Math.max(now(), prev + 1) : 1;
  st.dirty[k] = { rev, ...(del ? { del: true } : {}), ...(explicit ? { explicit: true } : {}) };
}
/* Called only from the photo-delete UI (and delete-room, with bulk:true). */
function notePhotoDeleted(ids, opts) {
  const list = [].concat(ids || []).map(id => String(id)).filter(Boolean);
  if (!list.length) return;
  st.explicitDel = st.explicitDel || {};
  if (opts && opts.bulk) st.bulkPhotoDeleteAt = now();
  for (const id of list) {
    st.explicitDel[id] = now();
    const k = 'photo|' + id;
    delete st.h[k];
    markDirty(k, true, true);
  }
  saveSt();
}
function photoSafety() { return window.MAX_PHOTO_SAFETY || null; }
function contentHash(kind, jsonString) {
  if (jsonString == null) return '';
  const shape = window.UNIT_SHAPE;
  if (shape && shape.canonicalJson && (kind === 'unit' || kind === 'cust')) {
    try { return hash(shape.canonicalJson(kind, JSON.parse(jsonString))); }
    catch (e) { return hash(String(jsonString)); }
  }
  return hash(String(jsonString));
}
function localHashOf(kind, id) {
  const a = adpFor(kind, id); if (!a) return null;
  const s = explode(a).get(String(id));
  return s == null ? null : contentHash(kind, s);
}
function touchTracked(key, nextRaw) {
  const a = ADP.find(x => x.key === key); if (!a) return;
  const pre = a.kind + '|', t = now();
  if (a.type === 'kv') { sessionEdits[pre + a.key] = t; return; }
  let next; try { next = JSON.parse(nextRaw); } catch (e) { return; }
  const prev = explode(a), nowMap = new Map();
  if (a.type === 'list') { if (Array.isArray(next)) next.forEach(x => { if (x && x.id != null) nowMap.set(String(x.id), JSON.stringify(x)); }); }
  else if (next && typeof next === 'object' && !Array.isArray(next)) {
    Object.entries(next).forEach(([k1, v1]) => {
      if (a.type === 'map1') nowMap.set(k1, JSON.stringify(v1));
      else if (v1 && typeof v1 === 'object') Object.entries(v1).forEach(([k2, v2]) => nowMap.set(k1 + '|' + k2, JSON.stringify(v2)));
    });
  }
  for (const [id, s] of nowMap) {
    const prevS = prev.get(id);
    if (prevS == null || contentHash(a.kind, prevS) !== contentHash(a.kind, s)) sessionEdits[pre + id] = t;
  }
  for (const id of prev.keys()) if (!nowMap.has(id)) sessionEdits[pre + id] = t;
}
function stripInferredPhotoDeletes() {
  const S = photoSafety();
  if (!S) {
    let n = 0;
    for (const k of Object.keys(st.dirty)) if (k.startsWith('photo|') && st.dirty[k] && st.dirty[k].del) { delete st.dirty[k]; n++; }
    if (n) console.warn('sync: photo safety module missing; dropped photo tombstones', n);
    return;
  }
  const rec = S.reconcilePhotoAbsence({ localIds: [], hashes: st.h, dirty: st.dirty, explicitDel: st.explicitDel || {} });
  st.dirty = rec.dirty;
  if (rec.known) st.photoCount = rec.known;
  if (rec.blocked.length) console.warn('sync: refused to treat missing IndexedDB photos as deletions', rec.blocked.length);
}
function scanLS() {
  for (const a of ADP) {
    const m = explode(a), pre = a.kind + '|';
    for (const [id, s] of m) { const k = pre + id, h = contentHash(a.kind, s); if (st.h[k] !== h) { st.h[k] = h; markDirty(k); } }
    for (const k of Object.keys(st.h)) {
      if (!k.startsWith(pre)) continue; const id = k.slice(pre.length);
      if (a.kind === 'kv' && id !== a.key) continue;
      if (!m.has(id)) { delete st.h[k]; markDirty(k, true); }
    }
  }
}
async function scanPhotos() {
  if (!P()) return;
  const all = await idb(pstore('readonly').getAll());
  const localIds = [];
  for (const p of all) {
    const k = 'photo|' + p.id, h = hash(JSON.stringify(pmeta(p)));
    localIds.push(String(p.id));
    // An explicit restore stays a live write. Do not replace it with a plain edit or a tombstone.
    if (st.dirty[k] && st.dirty[k].restore) continue;
    // A live local row is an edit only when this session wrote the photo DB.
    // A stale blob (different hash, no write) must not be pushed back up.
    if (st.h[k] !== h && !(st.dirty[k] && st.dirty[k].del && st.dirty[k].explicit)) {
      if (photoWriteAt) { st.h[k] = h; sessionEdits[k] = photoWriteAt; markDirty(k); }
    }
  }
  const S = photoSafety();
  if (!S) { stripInferredPhotoDeletes(); return; }
  const rec = S.reconcilePhotoAbsence({ localIds, hashes: st.h, dirty: st.dirty, explicitDel: st.explicitDel || {} });
  st.dirty = rec.dirty;
  st.photoCount = rec.known;
  if (rec.blocked.length) console.warn('sync: refused to treat missing IndexedDB photos as deletions', rec.blocked.length);
}

/* ---------- push ---------- */
async function uploadPhoto(id) {
  const p = await idb(pstore('readonly').get(id)); if (!p) return null;
  const m = pmeta(p), sig = m.fsz + '/' + m.tsz;
  if (st.up[id] !== sig) {
    const opt = b => ({ upsert: true, contentType: ctype(b), cacheControl: '3600' });
    if (p.full) { const { error } = await sb.storage.from(BUCKET).upload(path(id), p.full, opt(p.full)); if (error) throw error; }
    else if (st.up[id] && !st.up[id].startsWith('0/')) { try { await sb.storage.from(BUCKET).remove([path(id)]); } catch (e) {} }
    if (p.thumb) { const { error } = await sb.storage.from(BUCKET).upload(path(id, 1), p.thumb, opt(p.thumb)); if (error) throw error; }
    st.up[id] = sig; saveSt();
  }
  return m;
}
/* Same bucket, path, content type, and upsert as uploadPhoto. Used by กู้รูป. */
async function uploadBlob(id, blob, thumb) {
  if (!user) throw new Error('กรุณาเข้าสู่ระบบ');
  const opt = b => ({ upsert: true, contentType: ctype(b), cacheControl: '3600' });
  if (blob) { const { error } = await sb.storage.from(BUCKET).upload(path(id), blob, opt(blob)); if (error) throw error; }
  if (thumb) { const { error } = await sb.storage.from(BUCKET).upload(path(id, 1), thumb, opt(thumb)); if (error) throw error; }
  return true;
}
/* Explicit restore: remember a live row and push it through sync_push. Never a tombstone. */
async function restorePhoto(id, meta, rev) {
  if (!user) throw new Error('กรุณาเข้าสู่ระบบ');
  const k = 'photo|' + id;
  st.explicitDel = st.explicitDel || {};
  delete st.explicitDel[id];
  st.restoreMeta = st.restoreMeta || {};
  st.restoreMeta[id] = meta;
  st.dirty[k] = { rev, restore: true, explicit: true };
  st.h[k] = hash(JSON.stringify(meta));
  saveSt();
  const row = { kind: 'photo', id, rev, deleted: false, data: meta };
  await sendDocs([{ k, row }]);
  if (st.r[k] !== rev) throw new Error('บันทึกแถวรูปไม่สำเร็จ');
  delete st.restoreMeta[id];
  saveSt();
}
function photoDeletePlan() {
  const S = photoSafety();
  const bulkConfirmed = !!(st.bulkPhotoDeleteAt && S && (now() - st.bulkPhotoDeleteAt) < S.BULK_WINDOW_MS);
  if (!S) return { allow: [], blocked: [], refused: true, overThreshold: false, explicitCount: 0, known: st.photoCount || 0, limit: 0 };
  return S.planPhotoTombstones({ dirty: st.dirty, explicitDel: st.explicitDel || {}, knownPhotoCount: st.photoCount || 0, bulkConfirmed, now: now() });
}
async function push() {
  const plan = photoDeletePlan();
  const allowDel = new Set(plan.allow);
  for (const b of plan.blocked) {
    if (b.reason === 'bulk-photo-delete-guard') continue;
    delete st.dirty[b.key];
  }
  if (plan.refused) {
    const sig = plan.explicitCount + '/' + plan.known;
    if (st.photoDelGuardSig !== sig) {
      st.photoDelGuardSig = sig;
      console.warn('sync: refused photo deletion batch', { count: plan.explicitCount, known: plan.known, limit: plan.limit, reason: 'more than 20 or 10% of photos without a confirmed bulk delete' });
    }
  } else if (plan.overThreshold) {
    console.warn('sync: pushing explicit photo deletions over the soft threshold because the user confirmed them', { count: plan.explicitCount, known: plan.known, limit: plan.limit });
  } else if (st.photoDelGuardSig) delete st.photoDelGuardSig;
  for (const k of Object.keys(st.dirty)) {
    if (!k.startsWith('photo|')) continue;
    const d = st.dirty[k];
    if (!d || d.del || d.restore || d.explicit) continue;
    if (!sessionEdits[k]) delete st.dirty[k];
  }
  const keys = Object.keys(st.dirty); if (!keys.length) return;
  const docs = [], photoKeys = keys.filter(k => {
    if (!k.startsWith('photo|')) return false;
    const d = st.dirty[k];
    if (d && d.restore && photoRestoreHold) return false;
    return !(d && d.del && !allowDel.has(k));
  }), cache = {};
  for (const k of keys) {
    if (k.startsWith('photo|')) continue;
    const d = st.dirty[k], [kind] = k.split('|', 1), id = k.slice(kind.length + 1);
    const RS = W.ROOM_SUMMARY;
    if (RS && kind === 'unit' && st.summary && st.summary[id]) {
      const how = RS.pushDecision({ summary: true, deleted: !!d.del, sessionEdit: !!sessionEdits[k], explicit: !!(d && d.explicit) });
      if (how === 'skip') continue;
      if (how === 'delete') { delete st.summary[id]; docs.push({ k, row: { kind, id, rev: d.rev, deleted: true } }); continue; }
    }
    if (d.del) { docs.push({ k, row: { kind, id, rev: d.rev, deleted: true } }); continue; }
    const a = adpFor(kind, id); if (!a) { delete st.dirty[k]; continue; }
    const m = cache[a.key + a.kind] || (cache[a.key + a.kind] = explode(a)); const s = m.get(id);
    if (s == null) { delete st.dirty[k]; continue; }
    if (st.cloudHash[k] && contentHash(kind, s) === st.cloudHash[k]) { delete st.dirty[k]; st.h[k] = st.cloudHash[k]; continue; }
    docs.push({ k, row: { kind, id, rev: d.rev, data: JSON.parse(s) } });
  }
  const S = photoSafety();
  if (S && S.planUnitPushes) {
    const unitKeys = docs.filter(x => x.row.kind === 'unit' && !x.row.deleted).map(x => x.k);
    const known = explode(ADP.find(a => a.kind === 'unit')).size;
    const up = S.planUnitPushes({ keys: unitKeys, knownCount: known, bulkConfirmed: !!(st.bulkUnitPushAt && (now() - st.bulkUnitPushAt) < (S.BULK_WINDOW_MS || 120000)) });
    if (up.refused) {
      console.warn('sync: refused bulk unit push', { count: up.count, known: up.known, limit: up.limit, reason: up.reason });
      const block = new Set(up.blocked);
      for (let i = docs.length - 1; i >= 0; i--) if (block.has(docs[i].k)) docs.splice(i, 1);
      st.unitHold = up.count;
    } else if (unitKeys.length) st.unitHold = 0;
  }
  await sendDocs(docs);
  // photos: blobs first, then the doc (so a doc always points at uploaded files)
  let done = 0; const total = photoKeys.length;
  const work = photoKeys.slice();
  async function worker() {
    while (work.length) {
      const k = work.shift(), d = st.dirty[k]; if (!d) continue; const id = k.slice(6);
      try {
        let row;
        if (d.restore) {
          const meta = (st.restoreMeta || {})[id];
          if (!meta) { delete st.dirty[k]; continue; }
          row = { kind: 'photo', id, rev: d.rev, deleted: false, data: meta };
          await sendDocs([{ k, row }]);
          if (!st.dirty[k]) delete st.restoreMeta[id];
          done++; if (total > 3) setStatus('busy', `อัปโหลดรูป ${done}/${total}`);
          continue;
        }
        if (d.del) {
          if (!d.explicit || !allowDel.has(k)) { console.warn('sync: dropped photo tombstone without an explicit user delete', id); delete st.dirty[k]; continue; }
          try { await sb.storage.from(BUCKET).remove([path(id), path(id, 1)]); } catch (e) {}
          delete st.up[id]; row = { kind: 'photo', id, rev: d.rev, deleted: true };
        }
        else { const m = await uploadPhoto(id); if (!m) { delete st.dirty[k]; continue; } row = { kind: 'photo', id, rev: d.rev, data: m }; }
        await sendDocs([{ k, row }]);
      } catch (e) { console.warn('photo sync', id, e); }
      done++; if (total > 3) setStatus('busy', `อัปโหลดรูป ${done}/${total}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
}
async function sendDocs(docs) {
  let batch = [], size = 0;
  const flush = async () => {
    if (!batch.length) return; const b = batch; batch = []; size = 0;
    const { data, error } = await sb.rpc('sync_push', { p_rows: b.map(x => x.row) }); if (error) throw error;
    const rejected = new Set((data || []).map(r => r.r_kind + '|' + r.r_id));
    for (const x of b) {
      const d = st.dirty[x.k]; if (d && d.rev === x.row.rev) delete st.dirty[x.k];
      if (!rejected.has(x.k)) {
        st.r[x.k] = x.row.rev;
        if (x.row && x.row.deleted && x.row.kind === 'photo' && st.explicitDel) delete st.explicitDel[x.row.id];
      }
    }
    saveSt();
    if (rejected.size) { for (const k of rejected) delete st.r[k]; await refetch([...rejected]); }
  };
  for (const x of docs) { const n = JSON.stringify(x.row).length; if (size + n > 1500000) await flush(); batch.push(x); size += n; }
  await flush();
}
async function refetch(keys) {
  for (const k of keys) { const [kind] = k.split('|', 1), id = k.slice(kind.length + 1); const { data } = await sb.from('user_docs').select('kind,id,data,rev,deleted,server_at').eq('kind', kind).eq('id', id).maybeSingle(); if (data) await applyRows([data], true); }
}

/* ---------- pull ---------- */
const EDIT_SHEETS = ['sheet', 'custSheet', 'cfgSheet', 'custNoteSheet'];
const uiBusy = () => EDIT_SHEETS.some(id => { const el = document.getElementById(id); return el && el.classList.contains('open'); });
function yieldThread() {
  return new Promise(resolve => {
    const go = () => resolve();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 48 });
    else setTimeout(go, 0);
  });
}
let appRefreshTimer = 0, appRefreshAt = 0;
function runAppRefresh() {
  try { if (typeof W.reloadFromStorage === 'function') W.reloadFromStorage({ keepMedia: true }); } catch (e) { console.warn(e); }
  try { FX.refresh && FX.refresh(); } catch (e) {}
}
function queueAppRefresh(force) {
  if (force) {
    if (appRefreshTimer) { clearTimeout(appRefreshTimer); appRefreshTimer = 0; }
    appRefreshAt = Date.now();
    runAppRefresh();
    return;
  }
  if (appRefreshTimer) return;
  const wait = appRefreshAt ? Math.max(0, 3000 - (Date.now() - appRefreshAt)) : 0;
  appRefreshTimer = setTimeout(() => { appRefreshTimer = 0; appRefreshAt = Date.now(); runAppRefresh(); }, wait);
}
async function pull(opts = {}) {
  const full = !!opts.full;
  const c0 = full ? '1970-01-01T00:00:00Z' : st.cursor;
  const t0 = Date.parse(String(c0).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/\+00$/, 'Z'));
  let since = isNaN(t0) ? '1970-01-01T00:00:00Z' : new Date(Math.max(0, t0 - 2 * 60000)).toISOString(), maxSeen = full ? since : st.cursor, got = 0, seen = 0;
  for (;;) {
    const { data, error } = await sb.from('user_docs').select('kind,id,data,rev,deleted,server_at').gt('server_at', since).order('server_at', { ascending: true }).limit(400);
    if (error) throw error; if (!data.length) break;
    got += await applyRows(data, !!opts.full); seen += data.length;
    since = data[data.length - 1].server_at; if (since > maxSeen) maxSeen = since;
    if (data.length < 400) break;
    await yieldThread();
  }
  st.cursor = maxSeen; st.pulled = now(); st.seen = seen; saveSt();
  return got;
}
function queuePhotos(rows) {
  const S = photoSafety();
  const list = [];
  for (const r of rows) {
    const k = 'photo|' + r.id, d = st.dirty[k];
    if (d && d.del && d.explicit && d.rev >= r.rev) continue;
    if (d && d.restore && d.rev >= r.rev) continue;
    if ((st.photoFail || {})[r.id]) continue;
    if (!sessionEdits[k] && !(d && (d.explicit || d.restore))) delete st.dirty[k];
    st.r[k] = Math.max(st.r[k] || 0, r.rev || 0);
    photoRows[r.id] = r;
    list.push(r);
  }
  if (S && S.enqueuePhotos) photoQ = S.enqueuePhotos(photoQ, list);
}
async function applyRows(rows, force) {
  const groups = new Map(), photos = []; let n = 0;
  const S = photoSafety();
  const RS = W.ROOM_SUMMARY;
  for (const r0 of rows) {
    let r = r0;
    const k = r.kind + '|' + r.id, d = st.dirty[k];
    if (d && d.del && d.explicit && d.rev >= r.rev) continue;
    if (d && d.restore && d.rev >= r.rev) continue;
    if (r.kind === 'photo') { photos.push(r); continue; }
    const a = adpFor(r.kind, r.id); if (!a) continue;
    let forceApply = false, summaryCloudHash = null;
    if (r.kind === 'unit' && st.summary && st.summary[r.id] && RS) {
      const info = st.summary[r.id];
      let local = null;
      try { const raw = explode(a).get(String(r.id)); local = raw ? JSON.parse(raw) : null; } catch (e) { local = null; }
      if (!local && sessionEdits[k]) continue;
      const up = RS.upgrade(info.base, local, { deleted: !!r.deleted, data: r.data });
      if (up.action === 'keep') continue;
      if (!local) delete st.summary[r.id];
      if (up.action === 'apply') {
        if (up.edited) summaryCloudHash = r.deleted || r.data == null ? null : contentHash('unit', JSON.stringify(r.data));
        r = Object.assign({}, r, { data: up.data, deleted: up.data == null });
        delete st.summary[r.id];
        forceApply = true;
      }
    }
    const cloudJson = r.deleted || r.data == null ? null : JSON.stringify(r.data);
    const cloudHash = cloudJson == null ? null : contentHash(r.kind, cloudJson);
    const decision = forceApply ? { action: 'apply' } : (S && S.decideIncoming ? S.decideIncoming({
      deleted: !!r.deleted,
      localHash: localHashOf(r.kind, r.id),
      cloudHash: cloudHash,
      cloudRev: r.rev,
      ackedRev: st.r[k] || 0,
      sessionEditAt: sessionEdits[k] || 0
    }) : { action: 'apply' });
    if (decision.action === 'keep-local') continue;
    if (decision.action === 'equal') {
      delete st.dirty[k]; st.r[k] = r.rev;
      if (cloudHash != null) { st.cloudHash[k] = cloudHash; st.h[k] = cloudHash; }
      continue;
    }
    const g = groups.get(a) || [];
    g.push({ id: r.id, data: r.deleted ? null : r.data, k, rev: r.rev, hash: cloudHash, summaryCloudHash });
    groups.set(a, g);
  }
  for (const [a, g] of groups) {
    applyTo(a, g); const m = explode(a);
    for (const c of g) {
      delete st.dirty[c.k]; st.r[c.k] = c.rev;
      const s = m.get(c.id);
      if (s == null) { delete st.h[c.k]; delete st.cloudHash[c.k]; }
      else { const h = contentHash(a.kind, s); st.h[c.k] = h; st.cloudHash[c.k] = c.summaryCloudHash && c.summaryCloudHash !== h ? c.summaryCloudHash : h; }
      if (c.summaryCloudHash && c.summaryCloudHash !== st.h[c.k]) markDirty(c.k);
      n++;
    }
  }
  saveSt();
  if (n) queueAppRefresh(false);
  if (photos.length) queuePhotos(photos);
  return n;
}
function publicPhotoUrl(url) {
  const S = photoSafety();
  if (S && S.isPublicRoomPhoto(url)) return url;
  return (typeof url === 'string' && url.includes('/storage/v1/object/public/room-photos/')) ? url : '';
}
async function applyPhotos(rows) {
  let n = 0, i = 0; const total = rows.length, work = rows.slice();
  async function one(r) {
    const k = 'photo|' + r.id;
    try {
      if (r.deleted) { await idb(pstore('readwrite').delete(r.id)); delete st.h[k]; if (st.explicitDel) delete st.explicitDel[r.id]; try { window.photoGone && photoGone([r.id]); } catch (e) {} }
      else {
        const m = r.data || {}, cur = await idb(pstore('readonly').get(r.id));
        const pub = publicPhotoUrl(m.url);
        let rec;
        const sameFile = cur && pmeta(cur).fsz === m.fsz && pmeta(cur).tsz === m.tsz;
        const keepFallback = cur && cur.privMiss && pub && cur.url === pub && !cur.thumb && !cur.full;
        if (sameFile || keepFallback) rec = { ...cur, unitId: m.unitId, ts: m.ts, order: m.order, cover: m.cover, ...(pub ? { url: pub } : {}) };
        else {
          let thumb = null, privErr = null;
          const needPriv = !!(m.tsz || m.fsz);
          if (needPriv) {
            if (m.tsz) { try { thumb = await download(path(r.id, 1)); } catch (e) { privErr = e; } }
            if (!thumb && m.fsz) { try { thumb = await download(path(r.id)); privErr = null; } catch (e) { privErr = e; } }
          }
          const S = photoSafety();
          const decision = S && S.recordAfterPrivateFetch
            ? S.recordAfterPrivateFetch({ meta: m, thumbOk: !!thumb, privateFailed: !!privErr || (needPriv && !thumb) })
            : (thumb || pub ? { ok: true, fallback: !thumb && !!pub, url: pub } : { ok: false });
          if (!decision.ok) throw privErr || new Error('photo file missing');
          if (decision.fallback) console.warn('photo pull: private file missing, using public room-photos url', r.id);
          rec = { id: r.id, unitId: m.unitId, ts: m.ts, order: m.order, cover: m.cover, ...(decision.url ? { url: decision.url } : {}), ...(thumb ? { thumb } : {}), cloud: true, fsz: m.fsz || 0 };
          if (decision.fallback) rec.privMiss = true;
        }
        if (!m.url) delete rec.url;
        await idb(pstore('readwrite').put(rec));
        st.h[k] = hash(JSON.stringify(pmeta(rec))); st.up[r.id] = (m.fsz || 0) + '/' + (m.tsz || 0);
        if (st.explicitDel) delete st.explicitDel[r.id];
      }
      delete st.retry[k]; st.r[k] = r.rev; delete st.dirty[k]; n++;
      if (st.photoTry) delete st.photoTry[r.id];
      if (st.photoFail) delete st.photoFail[r.id];
    } catch (e) {
      const S = photoSafety();
      const missing = !!(S && S.isStorageMissing && S.isStorageMissing(e));
      const pub = publicPhotoUrl((r.data || {}).url);
      const prevN = ((st.photoTry || {})[r.id] || {}).n || 0;
      const plan = S && S.photoAttemptPlan ? S.photoAttemptPlan({ missing, failed: !missing, hasPublicUrl: !!pub, attempts: prevN, now: now() }) : { action: 'failed', attempts: 3, tombstone: false };
      if (plan.action === 'fallback' && pub) {
        const m = r.data || {};
        const rec = { id: r.id, unitId: m.unitId, ts: m.ts, order: m.order, cover: m.cover, url: pub, cloud: true, fsz: m.fsz || 0, privMiss: true };
        await idb(pstore('readwrite').put(rec));
        st.h[k] = hash(JSON.stringify(pmeta(rec))); st.r[k] = r.rev; delete st.dirty[k]; delete st.retry[k];
        if (st.photoTry) delete st.photoTry[r.id];
        console.warn('photo pull: private 400/404, using public url', r.id);
      } else if (plan.action === 'retry') {
        st.photoTry[r.id] = { n: plan.attempts, nextAt: plan.nextAt || 0 };
        console.warn('photo pull retry', r.id, plan.attempts);
        return;
      } else {
        st.photoFail[r.id] = { at: now(), status: missing ? 400 : 0 };
        st.photoTry[r.id] = { n: plan.attempts, nextAt: 0 };
        delete st.retry[k];
        console.warn('photo pull failed', r.id, e);
      }
    }
    if (photoSafety() && photoSafety().notePhotoFinished) photoQ = photoSafety().notePhotoFinished(photoQ, r.id, !!(st.photoFail && st.photoFail[r.id]));
    if ((photoQ.total || total) > 3) setStatus('busy', `ดาวน์โหลดรูป ${photoQ.done}/${photoQ.total || total}`);
  }
  while (work.length) {
    const batch = work.splice(0, 8);
    await Promise.all(batch.map(one));
    await yieldThread();
  }
  try { await W.refreshCounts(); } catch (e) {}
  return n;
}
function resetPhotoQueue() {
  st.photoFail = {}; st.photoTry = {};
  photoQ = { order: [], done: 0, total: 0, seen: {}, failed: {} };
  Object.keys(photoRows).forEach(id => delete photoRows[id]);
}
async function drainPhotos() {
  if (draining || !P() || !photoQ.order.length) return;
  const due = photoQ.order.filter(id => photoQ.seen[id] !== 'done' && photoRows[id] && !(((st.photoTry || {})[id] || {}).nextAt > now()));
  if (!due.length) return;
  draining = true;
  try { await applyPhotos(due.map(id => photoRows[id])); }
  finally { draining = false; saveSt(); }
}
function chipNow(busy, held) {
  const S = photoSafety();
  const waiting = Object.keys(st.photoTry || {}).filter(id => st.photoTry[id] && st.photoTry[id].nextAt > now() && !(st.photoFail || {})[id]).length;
  const failed = Object.keys(st.photoFail || {}).length;
  if (!S || !S.syncChipState) return { state: user ? (busy ? 'busy' : 'ok') : 'off', detail: '' };
  return S.syncChipState({ signedIn: !!user, online: navigator.onLine, busy: !!busy, held: !!held, dirty: Object.keys(st.dirty).length, failedPhotos: failed, waitingPhotos: waiting, unitConfirm: st.unitHold || 0, detail: '' });
}
// fetch full-size images of cloud photos in the background (and on demand)
async function fullBlob(p) {
  if (!user || !p || !p.cloud || !p.fsz) return null;
  const b = await download(path(p.id));
  try { const cur = await idb(pstore('readonly').get(p.id)); if (cur && !cur.full) { cur.full = b; await idb(pstore('readwrite').put(cur)); } } catch (e) {}
  return b;
}
async function fillFulls() {
  if (!P() || !user) return;
  const all = await idb(pstore('readonly').getAll());
  const need = all.filter(p => p.cloud && !p.full && !p.url && p.fsz);
  let i = 0, fail = 0; const work = need.slice();
  await Promise.all([0, 1, 2, 3, 4, 5].map(async () => { while (work.length && user && navigator.onLine && fail < 5) { const p = work.shift(); try { await fullBlob(p); } catch (e) { fail++; } i++; if (need.length > 3 && i % 5 === 0) setStatus(status, `ดาวน์โหลดรูปเต็ม ${i}/${need.length}`); } }));
}

/* ---------- room list preview (summary only; full rows replace it) ---------- */
const PREVIEW_PAGE = 60;
const PREVIEW_COLS = 'id,rev,project,building,room,floor,rent,sale_price,type,bath,size,view,status,station,station_dist,fav,created_at,last_posted,post_count,notes,source_url,owner,owner_phone,owner_line,start_date,end_date,cover_id,cover_url,cover_tsz,cover_fsz,photo_n';
let previewing = null, previewView = true;
function localUnitCount() {
  const v = J('staylow_units_v1', []);
  return Array.isArray(v) ? v.filter(x => x && x.id != null).length : 0;
}
function needsPreview() {
  if (!user || !navigator.onLine) return false;
  if (!localUnitCount()) return true;
  if (!st.init) return true;
  return false;
}
function applySummaries(rows) {
  const RS = W.ROOM_SUMMARY;
  const a = ADP.find(x => x.kind === 'unit');
  if (!RS || !a || !rows || !rows.length) return 0;
  const have = explode(a);
  const changes = [], priv = [];
  for (const row of rows) {
    const id = String(row.id);
    const k = 'unit|' + id;
    let existing = null;
    try { const raw = have.get(id); existing = raw ? JSON.parse(raw) : null; } catch (e) { existing = null; }
    const spec = RS.coverSpec(row);
    if (spec) RS.rememberCover(id, spec);
    const gate = RS.acceptSummary({
      existing: existing,
      tracked: !!(st.summary && st.summary[id]),
      sessionEdit: !!(sessionEdits[k] || (st.dirty && st.dirty[k])),
      incomingRev: row.rev || 0,
      haveRev: (st.summary && st.summary[id] && st.summary[id].rev) || 0
    });
    if (!gate.accept) continue;
    const unit = RS.toUnit(row);
    if (!unit) continue;
    changes.push({ id, data: unit, rev: row.rev || 0 });
    if (spec && spec.privateId) priv.push(spec);
  }
  if (priv.length) signCovers(priv);
  if (!changes.length) return 0;
  applyTo(a, changes);
  const m = explode(a);
  for (const c of changes) {
    const s = m.get(c.id);
    const k = 'unit|' + c.id;
    st.summary[c.id] = { rev: c.rev, base: RS.baseOf(c.data) };
    if (s != null) st.h[k] = contentHash('unit', s);
    delete st.r[k];
    delete st.cloudHash[k];
    delete st.dirty[k];
  }
  saveSt();
  return changes.length;
}
async function signCovers(specs) {
  const RS = W.ROOM_SUMMARY;
  if (!RS || !user || !specs.length || !sb.storage || !sb.storage.from) return;
  const bucket = sb.storage.from(BUCKET);
  if (!bucket.createSignedUrls) return;
  const paths = [], owners = [];
  for (const spec of specs) {
    const leaf = encodeURIComponent(spec.privateId);
    const thumb = user.id + '/' + leaf + '_t.jpg';
    const full = user.id + '/' + leaf + '.jpg';
    paths.push(spec.preferFull ? full : thumb, spec.preferFull ? thumb : full);
    owners.push(spec);
  }
  try {
    const { data, error } = await bucket.createSignedUrls(paths, 3600);
    if (error || !data) return;
    owners.forEach((spec, i) => {
      const primary = data[i * 2] && data[i * 2].signedUrl;
      const backup = data[i * 2 + 1] && data[i * 2 + 1].signedUrl;
      const thumb = primary || backup || '';
      const full = backup || primary || '';
      if (thumb) RS.rememberCover(spec.unitId, { thumb, full: full && full !== thumb ? full : '', n: spec.n, privateId: '' });
    });
    queueAppRefresh(false);
  } catch (e) { console.warn('room summary covers', e); }
}
async function fetchPreviewPage(from) {
  if (previewView) {
    const q = await sb.from('unit_list_summary').select(PREVIEW_COLS).order('fav', { ascending: false }).order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).range(from, from + PREVIEW_PAGE - 1);
    if (!q.error) return q.data || [];
    console.warn('room summary view', q.error.message || q.error);
    previewView = false;
    if (from) return [];
  }
  const q = await sb.from('user_docs').select('id,rev,data').eq('kind', 'unit').eq('deleted', false).order('id', { ascending: true }).range(from, from + PREVIEW_PAGE - 1);
  if (q.error) throw q.error;
  return q.data || [];
}
async function upgradeSummaries() {
  const ids = Object.keys(st.summary || {});
  if (!ids.length || !user) return 0;
  let n = 0;
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const { data, error } = await sb.from('user_docs').select('kind,id,data,rev,deleted,server_at').eq('kind', 'unit').in('id', slice);
    if (error) throw error;
    if (data && data.length) n += await applyRows(data, true);
    await yieldThread();
  }
  return n;
}
async function prefetchRooms() {
  if (!W.ROOM_SUMMARY || !needsPreview()) return;
  let from = 0;
  for (;;) {
    if (!user) return;
    const data = await fetchPreviewPage(from);
    if (!data.length) break;
    const n = applySummaries(data);
    if (n) queueAppRefresh(true);
    if (data.length < PREVIEW_PAGE) break;
    from += data.length;
    await yieldThread();
  }
  const upgraded = await upgradeSummaries();
  if (upgraded) queueAppRefresh(true);
}
function startPreview() {
  if (previewing || !needsPreview()) return previewing;
  previewing = prefetchRooms().catch(e => console.warn('room summary', e)).finally(() => { previewing = null; });
  return previewing;
}

/* ---------- main loop ---------- */
let runStart = 0, gen = 0, wantFull = false;
async function sync(opts = {}) {
  if (opts.full) wantFull = true;
  if (!user) return setStatus('off');
  if (!navigator.onLine) return setStatus('offline');
  if ((running || draining) && now() - runStart < 180000) { again = true; return; }
  const my = ++gen; running = true; runStart = now(); setStatus('busy', 'กำลังซิงก์...');
  let held = false, gotChanges = 0;
  try {
    // A full pull runs only when the saved server_at cursor cannot be trusted
  // (new login, other account, never synced, or the last pull is stale).
  // Opening an updated app keeps the cursor and asks for rows newer than it.
    stripInferredPhotoDeletes();
    const S = photoSafety();
    if (needsPreview()) startPreview();
    const fullFirst = !!(opts.full || wantFull || (S && S.needsFullPullBeforePush(st, { uid: user.id, login: loginPull, sessionPulled, now: now() })));
    if (fullFirst) {
      loginPull = false; wantFull = false;
      if (!uiBusy() || !st.init) { gotChanges += await pull({ full: true }); sessionPulled = true; st.init = true; saveSt(); }
      else { held = true; again = true; }
    }
    if (held && fullFirst) {
      const chip = chipNow(false, true);
      setStatus(chip.state, chip.detail);
      return;
    }
    scanLS(); await scanPhotos(); saveSt();
    await push();
    if (!fullFirst && !uiBusy()) { gotChanges += await pull({ full: false }); sessionPulled = true; }
    else if (!fullFirst && uiBusy()) { held = true; again = true; }
    if (my !== gen) return;
    await drainPhotos();
    if (my !== gen) return;
    st.last = now(); saveSt();
    if (appRefreshTimer || gotChanges) queueAppRefresh(true);
    try { FX.injectTools && FX.injectTools(); } catch (e) {}
    const chip = chipNow(false, held);
    setStatus(chip.state, chip.detail);
    if (!filling) { filling = true; fillFulls().then(() => { const c = chipNow(false, false); setStatus(c.state, c.detail); }).catch(() => {}).finally(() => { filling = false; }); }
  } catch (e) { console.warn('sync failed', e); setStatus(navigator.onLine ? 'error' : 'offline', String(e && e.message || e)); }
  finally { if (my === gen) { running = false; if (again) { again = false; schedule(3000); } } }
}
function schedule(ms) { if (!user) return; clearTimeout(timer); timer = setTimeout(sync, ms); }

/* ---------- hooks ---------- */
Storage.prototype.setItem = function (k, v) { if (this === LS && TRACKED.has(k)) { try { touchTracked(k, v); } catch (e) {} } const r = rawSet.call(this, k, v); if (this === LS && TRACKED.has(k)) schedule(1500); return r; };
Storage.prototype.removeItem = function (k) { const r = rawRemove.call(this, k); if (this === LS && TRACKED.has(k)) schedule(1500); return r; };
if (typeof W.tx === 'function') { const _tx = W.tx; W.tx = function (mode) { if (mode === 'readwrite') { photoWriteAt = now(); schedule(2500); } return _tx.apply(this, arguments); }; }
addEventListener('online', () => schedule(500));
addEventListener('offline', () => setStatus(user ? 'offline' : 'off'));
const wake = () => { if (document.visibilityState !== 'hidden') schedule(400); };
document.addEventListener('visibilitychange', wake);
addEventListener('focus', wake); addEventListener('pageshow', wake);
// iOS Home Screen apps sometimes resume without any event: a touch after >30s idle also triggers a pull
document.addEventListener('touchstart', () => { if (user && now() - (st.pulled || 0) > 30000) schedule(200); }, { passive: true });
setInterval(() => { if (user && document.visibilityState !== 'hidden') sync(); }, 30000);

sb.auth.onAuthStateChange((ev, session) => {
  const u = session && session.user;
  if (u && (!user || user.id !== u.id)) {
    if (st.uid !== u.id) { st = fresh(u.id); saveSt(); }
    user = u; loginPull = true; sessionPulled = false; setStatus('pending', 'กำลังดึงข้อมูลก่อนส่ง'); if (needsPreview()) startPreview(); schedule(300);
  } else if (!u && user) { user = null; setStatus('off'); }
  else if (!u) setStatus('off');
  if (ev === 'PASSWORD_RECOVERY') setTimeout(() => open('setpw'), 300);
  try { window.PHOTO_RESTORE && PHOTO_RESTORE.syncOwner(u || null); } catch (e) {}
  render();
});

/* ---------- UI ---------- */
const LABEL = { off: ['off', 'ยังไม่ซิงก์'], offline: ['offline', 'ออฟไลน์'], busy: ['cloud', 'กำลังซิงก์'], ok: ['check', 'ซิงก์แล้ว'], pending: ['upload', 'รอซิงก์'], error: ['error', 'ซิงก์ไม่สำเร็จ'] };
const CHIP_SVG = {
  off: '<path d="m2 2 20 20"/><path d="M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2"/><path d="M21.5 16.5A4.5 4.5 0 0 0 18 10h-1.3A8 8 0 0 0 9.5 4"/>',
  offline: '<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="m2 2 20 20"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M12 13V3"/><path d="m8 7 4-4 4 4"/><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  error: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
};
let progress = null, sheetPaintAt = 0;
function readFraction(text) {
  const m = String(text || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const label = String(text).replace(m[0], '').trim();
  return { done: Number(m[1]), total: Number(m[2]), label: label || 'กำลังซิงก์' };
}
function chipMarkup(kind) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (CHIP_SVG[kind] || CHIP_SVG.cloud) + '</svg>';
}
function paintChip() {
  const c = document.getElementById('syncChip');
  if (!c) return;
  const pair = LABEL[status] || LABEL.off;
  const icon = pair[0], label = pair[1];
  c.classList.toggle('sync-busy', status === 'busy');
  c.setAttribute('aria-label', label);
  if (c.dataset.state === status && c.dataset.icon === icon) return;
  c.dataset.state = status;
  c.dataset.icon = icon;
  c.innerHTML = chipMarkup(icon);
}
function paintProgress() {
  const box = document.getElementById('syncProgress');
  if (!box) return;
  const on = status === 'busy' && progress && progress.total > 0;
  box.classList.toggle('hidden', !on);
  if (!on) return;
  const pct = Math.max(0, Math.min(100, Math.round(progress.done / progress.total * 100)));
  const fill = document.getElementById('syncProgressFill');
  const lab = document.getElementById('syncProgressLabel');
  const num = document.getElementById('syncProgressPct');
  if (fill) fill.style.width = pct + '%';
  if (lab) lab.textContent = progress.label || 'กำลังซิงก์';
  if (num) num.textContent = pct + '%';
}
function setStatus(s, d) {
  const prev = status;
  status = s;
  if (d !== undefined) detail = d;
  else if (s !== 'busy') detail = '';
  if (s === 'busy') progress = readFraction(detail);
  else progress = null;
  paintChip();
  const sheet = document.getElementById('syncPanel');
  if (!sheet) return;
  const t = Date.now();
  if (s !== prev || !document.getElementById('syncProgress')) { render(); sheetPaintAt = s === 'busy' ? 0 : t; return; }
  if (t - sheetPaintAt < 2000) return;
  sheetPaintAt = t;
  paintProgress();
}
let view = 'login';
function render() {
  const el = document.getElementById('syncPanel');
  if (el) el.innerHTML = body();
  paintProgress();
  try {
    const panel = document.getElementById('syncPanel');
    if (window.lucide && panel && lucide.createIcons) lucide.createIcons({ root: panel });
  } catch (e) {
    try { lucide.createIcons(); } catch (e2) {}
  }
}
const inp = 'w-full rounded-xl border border-slate-700 bg-white px-3 py-2.5 text-sm mt-1';
const btn = 'w-full py-3 rounded-full bg-brick-500 text-white text-sm font-semibold mt-3 active:scale-[0.98]';
const btn2 = 'w-full py-2.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold mt-2';
function body() {
  if (user) {
    const pair = LABEL[status] || LABEL.off;
    const tx = pair[1];
    const pend = Object.keys(st.dirty).length;
    const quiet = (status === 'busy' && progress) ? '' : detail;
    if (view === 'setpw') return `<label class="block text-xs text-slate-500">ตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัว)<input id="syPw2" type="password" autocomplete="new-password" class="${inp}"></label><button onclick="SYNC.setPw()" class="${btn}">บันทึกรหัสผ่าน</button><button onclick="SYNC.view('')" class="${btn2}">ยกเลิก</button>`;
    return `<div class="bg-white border border-slate-700 rounded-2xl p-3"><p class="text-[11px] text-slate-500">บัญชี</p><p class="text-sm font-semibold break-all">${E(user.email)}</p>
      <div class="flex items-center gap-2 mt-2 text-xs"><i data-lucide="cloud" class="w-4 h-4 text-brick-600"></i><b>${tx}</b><span class="text-slate-400">${E(quiet)}</span></div>
      <div id="syncProgress" class="mt-3${status === 'busy' && progress && progress.total ? '' : ' hidden'}"><div class="flex justify-between text-[10px] text-slate-400 mb-1"><span id="syncProgressLabel">${E(progress && progress.label || 'กำลังซิงก์')}</span><span id="syncProgressPct">0%</span></div><div class="bar-track"><div id="syncProgressFill" class="bar-fill" style="width:0%"></div></div></div>
      <p class="text-[10px] text-slate-400 mt-1">ซิงก์ล่าสุด ${st.last ? new Date(st.last).toLocaleString('th-TH') : '-'} · ดึงข้อมูลล่าสุด ${st.pulled ? new Date(st.pulled).toLocaleTimeString('th-TH') : '-'}${pend ? ` · รอส่ง ${pend} รายการ` : ''}</p></div>
      <p class="text-[11px] text-slate-500 mt-3 leading-relaxed">ซิงก์: ห้อง/ประกาศ (รวมสัญญา) · ลูกค้า · นัดหมาย · ค่าคอม · การตั้งค่า · รูปห้อง · รูปโปรไฟล์ — เก็บแบบส่วนตัว เห็นได้เฉพาะบัญชีนี้</p>
      ${st.unitHold ? `<button onclick="SYNC.confirmUnits()" class="${btn}">ยืนยันส่ง ${st.unitHold} ห้องที่ต่างจากคลาวด์</button>` : `<button onclick="SYNC.full()" class="${btn}">ซิงก์ตอนนี้ (ดึงข้อมูลทั้งหมด)</button>`}
      <button onclick="SYNC.view('setpw')" class="${btn2}">เปลี่ยนรหัสผ่าน</button>
      <button onclick="SYNC.logout()" class="${btn2}">ออกจากระบบ (ข้อมูลในเครื่องยังอยู่)</button>`;
  }
  const em = E(rawGet('max_sync_email') || '');
  if (view === 'code') return `<p class="text-xs text-slate-600">ส่งอีเมลไปที่ <b>${em}</b> แล้ว · กรอกรหัสจากอีเมล <b>หรือ</b> กดค้างที่ปุ่ม/ลิงก์ในอีเมล → คัดลอกลิงก์ → วางที่นี่</p>
      <label class="block text-xs text-slate-500 mt-3">รหัส / ลิงก์จากอีเมล<input id="syCode" inputmode="text" autocomplete="one-time-code" class="${inp}" placeholder="123456 หรือ https://...supabase.co/auth/v1/verify?..."></label>
      <button onclick="SYNC.verify()" class="${btn}">ยืนยัน</button><button onclick="SYNC.view('login')" class="${btn2}">กลับ</button><p id="syMsg" class="text-xs text-rose-600 mt-2"></p>`;
  return `<p class="text-xs text-slate-600 leading-relaxed">เข้าสู่ระบบเพื่อเก็บข้อมูลไว้บนคลาวด์แบบส่วนตัว ใช้ได้หลายเครื่อง และไม่หายถ้าเปลี่ยน/ทำโทรศัพท์หาย · ไม่ล็อกอินก็ใช้แอปได้ตามปกติ</p>
    <label class="block text-xs text-slate-500 mt-3">อีเมล<input id="syEmail" type="email" autocomplete="username" class="${inp}" value="${em}" placeholder="you@email.com"></label>
    <label class="block text-xs text-slate-500 mt-2">รหัสผ่าน (อย่างน้อย 8 ตัว)<input id="syPw" type="password" autocomplete="current-password" class="${inp}"></label>
    <button onclick="SYNC.login()" class="${btn}">เข้าสู่ระบบ</button>
    <div class="grid grid-cols-2 gap-2"><button onclick="SYNC.signup()" class="${btn2}">สมัครบัญชีใหม่</button><button onclick="SYNC.sendCode()" class="${btn2}">ลืมรหัส / รับรหัสทางอีเมล</button></div>
    <p id="syMsg" class="text-xs text-rose-600 mt-2"></p>`;
}
const $ = id => document.getElementById(id);
const msg = (t, ok) => { const m = $('syMsg'); if (m) { m.className = 'text-xs mt-2 ' + (ok ? 'text-emerald-600' : 'text-rose-600'); m.textContent = t; } };
const thErr = e => { const s = String(e && e.message || e); if (/Invalid login/i.test(s)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'; if (/already registered/i.test(s)) return 'อีเมลนี้สมัครแล้ว ให้กด "เข้าสู่ระบบ"'; if (/rate limit|too many/i.test(s)) return 'ส่งอีเมลถี่เกินไป (ระบบอีเมลฟรีจำกัดชั่วโมงละ 2 ฉบับ) รอสักครู่'; if (/Password should/i.test(s)) return 'รหัสผ่านสั้นเกินไป (อย่างน้อย 8 ตัว)'; if (/expired|invalid/i.test(s)) return 'รหัส/ลิงก์ไม่ถูกต้องหรือหมดอายุ'; if (/fetch|network/i.test(s)) return 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ต'; return s; };
const creds = () => { const email = ($('syEmail') && $('syEmail').value || '').trim().toLowerCase(), password = $('syPw') ? $('syPw').value : ''; if (email) rawSet.call(LS, 'max_sync_email', email); return { email, password }; };
function open(v) { view = v || (user ? '' : 'login'); FX.open(FX.sheetHead('บัญชี & ซิงก์คลาวด์', 'สำรองอัตโนมัติ · ใช้ได้หลายเครื่อง') + '<div id="syncPanel"></div>'); render(); }
W.SYNC = {
  open, view: v => { view = v; render(); }, now: () => sync(), full: () => { resetPhotoQueue(); sync({ full: true }); }, chip: () => { open(); if (user) schedule(400); },
  confirmUnits() { st.bulkUnitPushAt = now(); st.unitHold = 0; saveSt(); sync(); },
  fullBlob, notePhotoDeleted, uploadBlob, restorePhoto,
  holdRestores: v => { photoRestoreHold = !!v; },
  rememberUpload(id, sig) { st.up[id] = sig; saveSt(); },
  forgetUpload(id) { delete st.up[id]; saveSt(); },
  photoPath: id => user ? path(id) : '',
  status: () => status, state: () => st, client: sb, user: () => user,
  async login() { const c = creds(); if (!c.email || !c.password) return msg('กรอกอีเมลและรหัสผ่าน'); msg('กำลังเข้าสู่ระบบ...', true); const { error } = await sb.auth.signInWithPassword(c); if (error) return msg(thErr(error)); T('เข้าสู่ระบบแล้ว · เริ่มซิงก์'); view = ''; render(); },
  async signup() { const c = creds(); if (!c.email || c.password.length < 8) return msg('กรอกอีเมลและรหัสผ่านอย่างน้อย 8 ตัว'); msg('กำลังสมัคร...', true); const { data, error } = await sb.auth.signUp(c); if (error) return msg(thErr(error)); if (!data.session) return msg('สมัครแล้ว · ตรวจอีเมลเพื่อยืนยัน แล้วกลับมาเข้าสู่ระบบ', true); T('สมัครและเข้าสู่ระบบแล้ว'); view = ''; render(); },
  async sendCode() { const c = creds(); if (!c.email) return msg('กรอกอีเมลก่อน'); msg('กำลังส่ง...', true); const { error } = await sb.auth.signInWithOtp({ email: c.email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }); if (error) return msg(thErr(error)); view = 'code'; render(); },
  async verify() {
    const v = ($('syCode').value || '').trim(), email = rawGet('max_sync_email') || ''; let r;
    if (/^\d{6,10}$/.test(v)) r = await sb.auth.verifyOtp({ email, token: v, type: 'email' });
    else { let u; try { u = new URL(v); } catch (e) { return msg('รูปแบบไม่ถูกต้อง'); }
      const h = new URLSearchParams(u.hash.slice(1));
      if (h.get('access_token')) r = await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
      else { const tok = u.searchParams.get('token') || u.searchParams.get('token_hash'), type = u.searchParams.get('type') || 'magiclink'; if (!tok) return msg('ไม่พบรหัสในลิงก์'); r = await sb.auth.verifyOtp({ token_hash: tok, type }); } }
    if (r.error) return msg(thErr(r.error)); T('เข้าสู่ระบบแล้ว'); view = ''; render();
  },
  async setPw() { const p = $('syPw2').value; if (p.length < 8) return T('รหัสผ่านอย่างน้อย 8 ตัว'); const { error } = await sb.auth.updateUser({ password: p }); if (error) return T(thErr(error)); T('ตั้งรหัสผ่านแล้ว'); view = ''; render(); },
  async logout() { if (!confirm('ออกจากระบบ? ข้อมูลในเครื่องยังอยู่ครบ แต่จะไม่ซิงก์จนกว่าจะเข้าสู่ระบบใหม่')) return; await sb.auth.signOut(); st = fresh(null); saveSt(); view = 'login'; render(); }
};
try { FX.addTool({ label: 'บัญชี & ซิงก์', icon: 'cloud', action: 'SYNC.open()' }); FX.injectTools && FX.injectTools(); } catch (e) {}
setStatus('off');
})();
