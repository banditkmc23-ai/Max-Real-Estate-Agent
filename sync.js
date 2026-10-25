/* MAX Agent — private cloud sync (Supabase Auth + user_docs + user-photos bucket).
   Offline-first: localStorage / IndexedDB stay the source of truth; this only mirrors them.
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
const fresh = uid => ({ uid, cursor: '1970-01-01T00:00:00Z', h: {}, dirty: {}, r: {}, up: {}, retry: {}, init: false, last: 0 });
let st = J(SK, null) || fresh(null);
['h', 'dirty', 'r', 'up', 'retry'].forEach(k => { st[k] = st[k] || {}; });
const saveSt = () => { try { rawSet.call(LS, SK, JSON.stringify(st)); } catch (e) {} };
let filling = false, user = null, status = 'off', detail = '', running = false, again = false, timer = null;

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
function markDirty(k, del) { st.dirty[k] = { rev: st.init ? Math.max(now(), ((st.dirty[k] && st.dirty[k].rev) || 0) + 1) : 1, ...(del ? { del: true } : {}) }; }
function scanLS() {
  for (const a of ADP) {
    const m = explode(a), pre = a.kind + '|';
    for (const [id, s] of m) { const k = pre + id, h = hash(s); if (st.h[k] !== h) { st.h[k] = h; markDirty(k); } }
    for (const k of Object.keys(st.h)) {
      if (!k.startsWith(pre)) continue; const id = k.slice(pre.length);
      if (a.kind === 'kv' && id !== a.key) continue;
      if (!m.has(id)) { delete st.h[k]; markDirty(k, true); }
    }
  }
}
async function scanPhotos() {
  if (!P()) return;
  const all = await idb(pstore('readonly').getAll()); const seen = new Set();
  for (const p of all) { const k = 'photo|' + p.id, h = hash(JSON.stringify(pmeta(p))); seen.add(k); if (st.h[k] !== h) { st.h[k] = h; markDirty(k); } }
  for (const k of Object.keys(st.h)) if (k.startsWith('photo|') && !seen.has(k)) { delete st.h[k]; markDirty(k, true); }
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
async function push() {
  const keys = Object.keys(st.dirty); if (!keys.length) return;
  const docs = [], photoKeys = keys.filter(k => k.startsWith('photo|')), cache = {};
  for (const k of keys) {
    if (k.startsWith('photo|')) continue;
    const d = st.dirty[k], [kind] = k.split('|', 1), id = k.slice(kind.length + 1);
    if (d.del) { docs.push({ k, row: { kind, id, rev: d.rev, deleted: true } }); continue; }
    const a = adpFor(kind, id); if (!a) { delete st.dirty[k]; continue; }
    const m = cache[a.key + a.kind] || (cache[a.key + a.kind] = explode(a)); const s = m.get(id);
    if (s == null) { delete st.dirty[k]; continue; }
    docs.push({ k, row: { kind, id, rev: d.rev, data: JSON.parse(s) } });
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
        if (d.del) { try { await sb.storage.from(BUCKET).remove([path(id), path(id, 1)]); } catch (e) {} delete st.up[id]; row = { kind: 'photo', id, rev: d.rev, deleted: true }; }
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
    for (const x of b) { const d = st.dirty[x.k]; if (d && d.rev === x.row.rev) delete st.dirty[x.k]; if (!rejected.has(x.k)) st.r[x.k] = x.row.rev; }
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
  }
  st.cursor = maxSeen; st.pulled = now(); st.seen = seen; saveSt();
  // photos whose files failed to download last time
  const retry = Object.values(st.retry); if (retry.length) got += await applyRows(retry, true);
  return got;
}
async function applyRows(rows, force) {
  const groups = new Map(), photos = []; let n = 0;
  for (const r of rows) {
    const k = r.kind + '|' + r.id, d = st.dirty[k];
    if (d && d.rev >= r.rev) continue;            // our pending local edit is newer
    if (!force && st.r[k] >= r.rev) continue;     // already have this version
    if (r.kind === 'photo') { photos.push(r); continue; }
    const a = adpFor(r.kind, r.id); if (!a) continue;
    const g = groups.get(a) || []; g.push({ id: r.id, data: r.deleted ? null : r.data, k, rev: r.rev }); groups.set(a, g);
  }
  for (const [a, g] of groups) {
    applyTo(a, g); const m = explode(a);
    for (const c of g) { delete st.dirty[c.k]; st.r[c.k] = c.rev; const s = m.get(c.id); if (s == null) delete st.h[c.k]; else st.h[c.k] = hash(s); n++; }
  }
  saveSt();
  if (n) { try { W.reloadFromStorage(); FX.refresh && FX.refresh(); FX.injectTools && FX.injectTools(); } catch (e) { console.warn(e); } }   // show rooms/customers right away
  if (photos.length && P()) { const pn = await applyPhotos(photos); saveSt(); if (pn) { try { W.reloadFromStorage(); } catch (e) {} } n += pn; }
  return n;
}
async function applyPhotos(rows) {
  let n = 0, i = 0; const total = rows.length, work = rows.slice();
  async function one(r) {
    const k = 'photo|' + r.id;
    try {
      if (r.deleted) { await idb(pstore('readwrite').delete(r.id)); delete st.h[k]; }
      else {
        const m = r.data || {}, cur = await idb(pstore('readonly').get(r.id));
        let rec;
        if (cur && pmeta(cur).fsz === m.fsz && pmeta(cur).tsz === m.tsz) rec = { ...cur, unitId: m.unitId, ts: m.ts, order: m.order, cover: m.cover, ...(m.url ? { url: m.url } : {}) };
        else {
          const thumb = m.tsz ? await download(path(r.id, 1)) : null;
          // full image: downloaded in the background later (thumbnails first, so the app is usable quickly)
          rec = { id: r.id, unitId: m.unitId, ts: m.ts, order: m.order, cover: m.cover, ...(m.url ? { url: m.url } : {}), ...(thumb ? { thumb } : {}), cloud: true, fsz: m.fsz || 0 };
          if (!thumb && m.fsz) rec.thumb = await download(path(r.id));
        }
        if (!m.url) delete rec.url;
        await idb(pstore('readwrite').put(rec));
        st.h[k] = hash(JSON.stringify(pmeta(rec))); st.up[r.id] = m.fsz + '/' + m.tsz;
      }
      delete st.retry[k]; st.r[k] = r.rev; delete st.dirty[k]; n++;
    } catch (e) { console.warn('photo pull', r.id, e); st.retry[k] = r; }
    i++; if (total > 3) setStatus('busy', `ดาวน์โหลดรูป ${i}/${total}`);
  }
  await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(async () => { while (work.length) await one(work.shift()); }));
  try { await W.refreshCounts(); } catch (e) {}
  return n;
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

/* ---------- main loop ---------- */
let runStart = 0, gen = 0, wantFull = false;
async function sync(opts = {}) {
  if (opts.full) wantFull = true;
  if (!user) return setStatus('off');
  if (!navigator.onLine) return setStatus('offline');
  if (running && now() - runStart < 180000) { again = true; return; }
  const my = ++gen; running = true; runStart = now(); setStatus('busy', 'กำลังซิงก์...');
  let held = false;
  try {
    if (!st.init) { await pull(); scanLS(); await scanPhotos(); st.init = true; saveSt(); }
    scanLS(); await scanPhotos(); saveSt();
    await push();
    if (!uiBusy()) { const f = wantFull; wantFull = false; await pull({ full: f }); } else { held = true; again = true; }
    if (my !== gen) return;
    st.last = now(); saveSt();
    setStatus(held ? 'pending' : (Object.keys(st.dirty).length || Object.keys(st.retry).length ? 'pending' : 'ok'), held ? 'รอปิดหน้าแก้ไขก่อนรับข้อมูลใหม่' : undefined);
    if (!filling) { filling = true; fillFulls().then(() => setStatus(status, '')).catch(() => {}).finally(() => { filling = false; }); }
  } catch (e) { console.warn('sync failed', e); setStatus(navigator.onLine ? 'error' : 'offline', String(e && e.message || e)); }
  finally { if (my === gen) { running = false; if (again) { again = false; schedule(3000); } } }
}
function schedule(ms) { if (!user) return; clearTimeout(timer); timer = setTimeout(sync, ms); }

/* ---------- hooks ---------- */
Storage.prototype.setItem = function (k, v) { const r = rawSet.call(this, k, v); if (this === LS && TRACKED.has(k)) schedule(1500); return r; };
Storage.prototype.removeItem = function (k) { const r = rawRemove.call(this, k); if (this === LS && TRACKED.has(k)) schedule(1500); return r; };
if (typeof W.tx === 'function') { const _tx = W.tx; W.tx = function (mode) { if (mode === 'readwrite') schedule(2500); return _tx.apply(this, arguments); }; }
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
    user = u; schedule(300);
  } else if (!u && user) { user = null; setStatus('off'); }
  else if (!u) setStatus('off');
  if (ev === 'PASSWORD_RECOVERY') setTimeout(() => open('setpw'), 300);
  render();
});

/* ---------- UI ---------- */
const LABEL = { off: ['cloud-off', 'ยังไม่ซิงก์'], offline: ['wifi-off', 'ออฟไลน์'], busy: ['refresh-cw', 'กำลังซิงก์'], ok: ['cloud', 'ซิงก์แล้ว'], pending: ['cloud-upload', 'รอซิงก์'], error: ['alert-triangle', 'ซิงก์ไม่สำเร็จ'] };
function setStatus(s, d) { status = s; if (d !== undefined) detail = d; else if (s !== 'busy') detail = ''; const c = document.getElementById('syncChip'); if (c) { const [ic, tx] = LABEL[s] || LABEL.off; c.innerHTML = `<i data-lucide="${ic}" class="w-3.5 h-3.5 ${s === 'busy' ? 'animate-spin' : ''}"></i><span>${s === 'busy' && /\d+\/\d+/.test(detail) ? 'ซิงก์ ' + detail.match(/\d+\/\d+/)[0] : tx}</span>`; c.dataset.state = s; try { lucide.createIcons(); } catch (e) {} } render(); }
let view = 'login';
function render() { const el = document.getElementById('syncPanel'); if (el) el.innerHTML = body(); try { lucide.createIcons(); } catch (e) {} }
const inp = 'w-full rounded-xl border border-slate-700 bg-white px-3 py-2.5 text-sm mt-1';
const btn = 'w-full py-3 rounded-full bg-brick-500 text-white text-sm font-semibold mt-3 active:scale-[0.98]';
const btn2 = 'w-full py-2.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold mt-2';
function body() {
  if (user) {
    const [ic, tx] = LABEL[status] || LABEL.off;
    const pend = Object.keys(st.dirty).length;
    if (view === 'setpw') return `<label class="block text-xs text-slate-500">ตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัว)<input id="syPw2" type="password" autocomplete="new-password" class="${inp}"></label><button onclick="SYNC.setPw()" class="${btn}">บันทึกรหัสผ่าน</button><button onclick="SYNC.view('')" class="${btn2}">ยกเลิก</button>`;
    return `<div class="bg-white border border-slate-700 rounded-2xl p-3"><p class="text-[11px] text-slate-500">บัญชี</p><p class="text-sm font-semibold break-all">${E(user.email)}</p>
      <div class="flex items-center gap-2 mt-2 text-xs"><i data-lucide="${ic}" class="w-4 h-4 text-brick-600"></i><b>${tx}</b><span class="text-slate-400">${E(detail)}</span></div>
      <p class="text-[10px] text-slate-400 mt-1">ซิงก์ล่าสุด ${st.last ? new Date(st.last).toLocaleString('th-TH') : '-'} · ดึงข้อมูลล่าสุด ${st.pulled ? new Date(st.pulled).toLocaleTimeString('th-TH') : '-'}${pend ? ` · รอส่ง ${pend} รายการ` : ''}</p></div>
      <p class="text-[11px] text-slate-500 mt-3 leading-relaxed">ซิงก์: ห้อง/ประกาศ (รวมสัญญา) · ลูกค้า · นัดหมาย · ค่าคอม · การตั้งค่า · รูปห้อง · รูปโปรไฟล์ — เก็บแบบส่วนตัว เห็นได้เฉพาะบัญชีนี้</p>
      <button onclick="SYNC.full()" class="${btn}">ซิงก์ตอนนี้ (ดึงข้อมูลทั้งหมด)</button>
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
  open, view: v => { view = v; render(); }, now: () => sync(), full: () => sync({ full: true }), chip: () => { open(); if (user) sync({ full: true }); }, fullBlob, status: () => status, state: () => st, client: sb, user: () => user,
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
