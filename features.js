/* MAX Agent — features v2 (share, appointments, matching, availability, expiring, revenue, invoices).
   All data is local (localStorage). New keys are additive and never touch existing data. */
(function () {
'use strict';
const W = window;
const $ = id => document.getElementById(id);
const E = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
const B = n => (typeof baht === 'function' ? baht(n) : '฿' + Number(n || 0).toLocaleString('th-TH'));
const T = m => (typeof toast === 'function' ? toast(m) : alert(m));
const icons = () => { try { lucide.createIcons(); } catch (e) {} };
const ls = { get(k, d) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { T('บันทึกไม่สำเร็จ (พื้นที่เต็ม?)'); } } };
const TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_ML = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ymOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const thDate = s => { if (!s) return '-'; const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + TH_M[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(2); };
const thMonth = ym => { const [y, m] = ym.split('-').map(Number); return TH_ML[m - 1] + ' ' + (y + 543); };
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return ymOf(d); };
const units_ = () => (typeof units !== 'undefined' ? units : []);
const custs_ = () => (typeof customers !== 'undefined' ? customers : []);
const unitName = u => u ? `${u.project || '(ไม่ระบุ)'}${u.room ? ' · ' + u.room : ''}` : '(ห้องถูกลบ)';
const cfg = () => (typeof getPostConfig === 'function' ? getPostConfig() : {});
W.FX = W.FX || {};
const FX = W.FX;

/* ---------- generic sheet ---------- */
function ensureSheet() {
  if ($('fxSheet')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="fxOverlay" class="fixed inset-0 bg-black/40 z-[86] hidden" onclick="FX.close()"></div>
  <div id="fxSheet" class="sheet fixed bottom-0 left-0 right-0 mx-auto w-full max-w-[calc(100vw-24px)] lg:max-w-[560px] bg-white rounded-t-3xl lg:rounded-3xl z-[87] p-5 pb-[max(20px,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto hide-scrollbar" onclick="event.stopPropagation()"></div>`);
}
FX.open = function (html) {
  ensureSheet();
  $('fxSheet').innerHTML = '<div class="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4 lg:hidden"></div>' + html;
  $('fxOverlay').classList.remove('hidden');
  const s = $('fxSheet'); s.classList.add('open'); s.scrollTop = 0;
  document.body.style.overflow = 'hidden'; icons();
};
FX.close = function () {
  if (!$('fxSheet')) return;
  $('fxOverlay').classList.add('hidden'); $('fxSheet').classList.remove('open');
  const others = document.querySelector('.sheet.open:not(#fxSheet)') || ((typeof detailUnitId !== 'undefined' && detailUnitId) || (typeof detailCustId !== 'undefined' && detailCustId));
  if (!others) document.body.style.overflow = '';
};
const sheetHead = (title, sub) => `<div class="flex items-start justify-between gap-3 mb-4"><div><h2 class="text-base font-bold text-ink">${title}</h2>${sub ? `<p class="text-xs text-slate-400 mt-0.5">${sub}</p>` : ''}</div><button onclick="FX.close()" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0" aria-label="ปิด"><i data-lucide="x" class="w-4 h-4 text-slate-500"></i></button></div>`;
FX.sheetHead = sheetHead;

/* ---------- extra views (tools) ---------- */
const VIEWS = {};
let fxView = null;
function ensureViewBox() {
  if ($('viewFx')) return;
  const ref = $('viewCustomers');
  ref.insertAdjacentHTML('afterend', '<div id="viewFx" class="pt-4 lg:pt-6 hidden"></div>');
}
FX.registerView = (name, def) => { VIEWS[name] = def; };
FX.show = function (name) {
  ensureViewBox();
  fxView = name;
  ['viewDashboard', 'viewRooms', 'viewCustomers'].forEach(id => $(id) && $(id).classList.add('hidden'));
  $('viewFx').classList.remove('hidden');
  document.querySelectorAll('.nav-link[data-nav], .bottom-nav-item[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === 'fx-' + name));
  try { if (detailUnitId) closeDetailView(); } catch (e) {}
  try { if (detailCustId) closeCustDetail(); } catch (e) {}
  FX.refresh();
  const mw = document.querySelector('.main-wrapper'); if (mw) mw.scrollTo({ top: 0 }); window.scrollTo({ top: 0 });
};
FX.refresh = function () {
  if (!fxView || !VIEWS[fxView] || !$('viewFx') || $('viewFx').classList.contains('hidden')) return;
  const v = VIEWS[fxView];
  $('viewFx').innerHTML = `<div class="flex items-center gap-2 mb-1"><button onclick="switchView('dashboard')" class="w-8 h-8 rounded-full bg-white border border-slate-700 flex items-center justify-center lg:hidden" aria-label="กลับ"><i data-lucide="arrow-left" class="w-4 h-4"></i></button><h2 class="text-lg lg:text-xl font-bold text-ink tracking-tight">${v.title}</h2></div>` + v.render();
  icons();
};
const _switchView = W.switchView;
W.switchView = function (v) {
  if ($('viewFx')) { $('viewFx').classList.add('hidden'); fxView = null; }
  return _switchView.apply(this, arguments);
};
const _render = W.render;
W.render = function () { const r = _render.apply(this, arguments); try { injectTools(); } catch (e) {} try { FX.refresh(); } catch (e) {} return r; };

const TOOLS = [];
FX.addTool = t => { TOOLS.push(t); };
function injectTools() {
  if (!TOOLS.length) return;
  const dash = $('viewDashboard'); if (!dash) return;
  let box = $('fxTools');
  if (!box) { dash.insertAdjacentHTML('afterbegin', '<div id="fxTools" class="mb-5"></div>'); box = $('fxTools'); }
  box.innerHTML = `<div class="flex items-center justify-between mb-3"><h3 class="text-base font-bold text-ink tracking-tight">เครื่องมือ</h3></div><div class="grid grid-cols-3 lg:grid-cols-6 gap-2">${TOOLS.map(t => `<button onclick="${t.action}" class="bg-white border border-slate-700 rounded-2xl p-3 flex flex-col items-center gap-1.5 text-center hover:border-brick-500 active:scale-[0.97] transition-all shadow-sm relative"><span class="w-9 h-9 rounded-xl bg-brick-500/10 flex items-center justify-center"><i data-lucide="${t.icon}" class="w-4 h-4 text-brick-600"></i></span><span class="text-[11px] font-semibold text-ink leading-tight">${t.label}</span>${t.badge && t.badge() ? `<span class="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">${t.badge()}</span>` : ''}</button>`).join('')}</div>`;
  // desktop sidebar links
  const side = document.querySelector('button.nav-link[onclick="openBackup()"]');
  if (side && !$('fxSideLinks')) {
    side.insertAdjacentHTML('beforebegin', `<div id="fxSideLinks"></div>`);
  }
  const sl = $('fxSideLinks');
  if (sl) sl.innerHTML = TOOLS.map(t => `<button onclick="${t.action}" data-nav="fx-${t.view || ''}" class="nav-link w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium mb-0.5"><i data-lucide="${t.icon}" class="w-4 h-4"></i><span class="flex-1 text-left">${t.label}</span></button>`).join('');
  icons();
}
FX.injectTools = injectTools;

/* ---------- backup hooks ---------- */
const BK = [];
FX.addBackup = (name, get, set) => BK.push({ name, get, set });
FX.exportAll = () => { const o = {}; BK.forEach(b => { try { o[b.name] = b.get(); } catch (e) {} }); return o; };
FX.importAll = d => { if (!d || typeof d !== 'object') return; BK.forEach(b => { if (d[b.name] !== undefined) { try { b.set(d[b.name]); } catch (e) {} } }); };

/* ---------- small utils shared ---------- */
FX.u = { $, E, B, T, ls, icons, pad, ymd, ymOf, thDate, thMonth, addMonths, units_, custs_, unitName, cfg, TH_M, TH_ML };
FX.lineShare = text => { const url = 'https://line.me/R/share?text=' + encodeURIComponent(text); window.open(url, '_blank'); };
FX.copy = async text => { try { await navigator.clipboard.writeText(text); T('คัดลอกแล้ว'); } catch (e) { try { fallbackCopy(text); T('คัดลอกแล้ว'); } catch (_) { T('คัดลอกไม่สำเร็จ'); } } };
})();

/* ===================== 1) SHARE ROOM LINK ===================== */
(function () {
const { $, E, B, T, icons, cfg, units_ } = FX.u;
const b64u = bytes => { let s = ''; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
async function encode(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    try { const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(); return '1.' + b64u(new Uint8Array(buf)); } catch (e) {}
  }
  return '0.' + b64u(raw);
}
async function tinyThumb(unitId, w, q) {
  try {
    const ps = await getUnitPhotos(unitId); if (!ps.length) return null;
    const bmp = await createImageBitmap(ps[0].thumb);
    const c = document.createElement('canvas'); const r = w / bmp.width; c.width = w; c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  } catch (e) { return null; }
}
const BASE = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'room.html';
let shareState = {}; let shareNote = '';
const SB_URL = 'https://ekpavjlebbclapjdupwf.supabase.co';
const SB_KEY = 'sb_publishable_XJ1PWYWqWWN571OTaGpjRg_0owD5pyW';
const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const cloudCache = {};
// eslint-disable-next-line
const _rid = () => { const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(6)); return Array.from(r, x => a[x % a.length]).join(''); };
async function toJpeg(blob, max, q) {
  const bmp = await createImageBitmap(blob); const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(res, 'image/jpeg', q || 0.8));
}
// After a confirmed upload, swap the local full-size blob for the cloud URL (thumb kept for fast/offline previews).
// Each photo is only changed if: the server returned its URL, that URL answers 200 with an image, and the record is unchanged locally.
async function offloadUploaded(sorted, sent, urls) {
  if (urls.length !== sorted.length) return;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i], url = urls[i];
    if (sent[i] !== 'new' || !p.full || !url || !url.startsWith(SB_URL + '/storage/v1/object/public/room-photos/')) continue;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/') || (await r.blob()).size < 100) continue;
      const cur = await new Promise((res, rej) => { const q = db.transaction('photos', 'readonly').objectStore('photos').get(p.id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      if (!cur || !cur.full) continue;
      const rec = { ...cur, url }; delete rec.full; if (!rec.thumb) rec.thumb = cur.full;
      await new Promise((res, rej) => { const t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    } catch (e) { console.warn('keep local photo', p.id, e); }
  }
}
// Photos are stored once per room at a stable path (<roomId>/p-<photoKey>.jpg) and reused by every later share,
// so re-sharing never re-uploads a photo that is already in the cloud.
const photoKey = p => String(p.id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
const MAX_PHOTOS = 40;
let shareProg = null;
async function cloudLink(u, o, withPhotos) {
  if (!navigator.onLine) throw new Error('offline');
  const ps = withPhotos ? (await getUnitPhotos(u.id).catch(() => [])) : [];
  const sorted = ps.slice().sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0)).slice(0, MAX_PHOTOS);
  const sig = JSON.stringify(o) + '|' + sorted.map(p => p.id).join(',');
  const linkOf = id => BASE().replace(/room\.html$/, 'r/') + id + '/';
  const sh = u.share && u.share.id && u.share.secret ? u.share : null;
  // unchanged room (or a text-only link): the permanent link is returned instantly, nothing is uploaded
  if (sh && (sh.sig === sig || !withPhotos)) { FX.lastShareStats = { uploaded: 0, reused: sorted.length, instant: true }; return linkOf(sh.id); }
  const say = t => { const el = $('fxShareLink'); if (el) el.textContent = t; if (shareProg) shareProg(t); };
  const call = async body => { const r = await fetch(`${SB_URL}/functions/v1/share-room`, { method: 'POST', headers: { ...SB_H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.id) throw new Error('share-room ' + r.status + ' ' + (j.error || '')); return j; };
  const PUBP = SB_URL + '/storage/v1/object/public/room-photos/';
  // photos that already have a public cloud URL are reused as-is; the rest get a stable per-room path
  const needKey = sorted.filter(p => !(p.url && p.url.startsWith(PUBP)));
  const coverKey = sorted[0] ? sorted[0].id : '';
  const ogFresh = !!sorted[0] && !(sh && sh.og && sh.ogKey === coverKey);
  say('กำลังตรวจรูปบนคลาวด์...');
  const init = await call({ action: 'init', keys: needKey.map(photoKey), og: ogFresh, ...(sh ? { id: sh.id, secret: sh.secret } : {}) });
  const byKey = new Map((init.uploads || []).map(x => [x.key, x]));
  const images = [], sent = [], jobs = [], failed = new Set(); let done = 0;
  const todo = (init.uploads || []).filter(x => !x.exists).length;
  for (const p of sorted) {
    if (p.url && p.url.startsWith(PUBP)) { images.push({ url: p.url }); sent.push(null); continue; }
    const up = byKey.get(photoKey(p)); if (!up) { failed.add(p.id); images.push(null); sent.push(null); continue; }
    images.push({ url: up.url }); sent.push(p.full ? 'new' : null);
    if (up.exists) continue;
    jobs.push(async () => {
      let jpg = null;
      try { const src = p.full || (W.fullBlobOf ? await W.fullBlobOf(p) : p.thumb); for (const [m, q] of [[1080, 0.72], [1080, 0.6], [900, 0.6]]) { jpg = await toJpeg(src, m, q); if (jpg.size <= 600000) break; } } catch (e) { jpg = null; }
      let ok = false;
      for (let t = 0; jpg && t < 3 && !ok; t++) { const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/room-photos/${up.path}?token=${encodeURIComponent(up.token)}`, { method: 'PUT', headers: { ...SB_H, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: jpg }).catch(() => null); ok = !!(r && r.ok); }
      if (!ok) failed.add(p.id);
      say(`กำลังอัปโหลดรูปใหม่ ${++done}/${todo}...`);
    });
  }
  if (todo) say(`กำลังอัปโหลดรูปใหม่ 0/${todo}...`);
  if (init.og && sorted[0]) jobs.push(async () => {
    try { const s0 = sorted[0]; const bmp = await createImageBitmap(s0.full || (!s0.url && W.fullBlobOf ? await W.fullBlobOf(s0) : null) || (s0.url ? await (await fetch(s0.url)).blob() : s0.thumb)); const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
      const sc = Math.max(1200 / bmp.width, 630 / bmp.height), w = bmp.width * sc, h = bmp.height * sc; c.getContext('2d').drawImage(bmp, (1200 - w) / 2, (630 - h) / 2, w, h);
      const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
      const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/room-photos/${init.og.path}?token=${encodeURIComponent(init.og.token)}`, { method: 'PUT', headers: { ...SB_H, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: jpg });
      if (!r.ok) init.og = null;
    } catch (e) { init.og = null; console.warn('og image skipped', e); }
  });
  let qi = 0; await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => { while (qi < jobs.length) await jobs[qi++](); }));
  const keep = sorted.map((p, i) => images[i] && !failed.has(p.id) ? i : -1).filter(i => i >= 0);
  if (sorted.length && !keep.length) throw new Error('อัปโหลดรูปไม่สำเร็จ');
  const secret = sh ? sh.secret : Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  const ogName = init.og ? init.og.name : (sh && sh.ogKey === coverKey ? sh.og : '');
  say('กำลังบันทึกลิงก์...');
  const j = await call({ action: 'commit', id: init.id, data: o, images: keep.map(i => images[i]), secret, v: init.v, og: ogName });
  if (failed.size) shareNote = `อัปโหลดรูปไม่สำเร็จ ${failed.size} รูป ระบบจะลองใหม่ครั้งถัดไป`;
  const keptSorted = keep.map(i => sorted[i]), keptSent = keep.map(i => sent[i]);
  u.share = { id: j.id, secret, sig: failed.size ? '' : sig, at: Date.now(), cover: (j.imgs || [])[0] || '', og: j.og || ogName || '', ogKey: (j.og || ogName) ? coverKey : '', opts: u.share && u.share.opts };
  try { (window.persist || (() => {}))(); } catch (e) {}
  FX.lastShareStats = { uploaded: todo - [...failed].length, reused: keep.length - (todo - [...failed].length), failed: failed.size, total: sorted.length };
  setTimeout(() => offloadUploaded(keptSorted, keptSent, j.imgs || []).catch(e => console.warn('offload skipped', e)), 0);
  const link = linkOf(j.id);
  if (j.page && withPhotos && !FX.noWait) {
    say('กำลังเตรียมพรีวิว LINE... (ประมาณ 1 นาที)');
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < 180000) { try { const r = await fetch(link + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { const t = await r.text(); if (t.includes('og:title') && (!init.v || t.includes('content="' + init.v + '"'))) { ok = true; break; } } } catch (e) {} await new Promise(r => setTimeout(r, 5000)); say(`กำลังเตรียมพรีวิว LINE... ${Math.round((Date.now() - t0) / 1000)} วินาที`); }
    if (!ok) shareNote = 'พรีวิว LINE ยังไม่พร้อม ลิงก์ใช้ได้แล้ว แต่ถ้าส่งตอนนี้ LINE อาจไม่แสดงรูป รอสักครู่แล้วค่อยส่ง';
  }
  return link;
}
async function buildLink(u, opts) {
  const c = cfg();
  const o = { v: 1, p: u.project || '', b: u.building || '', r: opts.hideRoom ? '' : (u.room || ''), f: u.floor || '', rent: Number(u.rent) || 0, sale: u.salePrice || '', sz: Number(u.size) || 0, t: u.type || '', bt: u.bath || '', vw: u.view || '', sn: u.station || '', sd: Number(u.stationDist) || 0, st: u.status || '', d: (opts.hideRoom && u.room ? (u.notes || '').replace(new RegExp('(?:ห้อง(?:เลขที่)?|room|unit|no\\.?|#)?\\s*[:：#]?\\s*' + String(u.room).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').replace(/[ \t]{2,}/g, ' ').trim() : (u.notes || '')).slice(0, 900), hr: opts.hideRoom ? 1 : 0, a: { n: c.agentName || '', ph: opts.showPhone ? (c.phone || '') : '', l: c.lineId || '' } };
  if (!opts.long) {
    let err;
    for (let t = 0; t < 2; t++) { try { return await cloudLink(u, o, !!opts.photo); } catch (e) { err = e; console.warn('cloud share failed', e); if (!navigator.onLine) break; await new Promise(r => setTimeout(r, 1500)); } }
    const m = String(err && err.message || err || '');
    const e2 = new Error(!navigator.onLine || m === 'offline' ? 'ไม่มีอินเทอร์เน็ต' : / 429/.test(m) ? 'แชร์ถี่เกินไป รอสักครู่แล้วลองใหม่' : / 403/.test(m) ? 'ลิงก์นี้แก้ไขจากเครื่องนี้ไม่ได้' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ'); e2.detail = m; throw e2;
  }
  let link = BASE() + '#' + await encode(o);
  if (opts.photo) {
    for (const [w, q] of [[360, 0.5], [260, 0.45], [200, 0.4]]) {
      const img = await tinyThumb(u.id, w, q); if (!img) break;
      const l2 = BASE() + '#' + await encode({ ...o, img });
      if (l2.length <= 9000) { link = l2; break; }
    }
  }
  return link;
}
function shareText(u, link) {
  return `${u.project || ''}${u.type ? ' · ' + u.type : ''}${u.size ? ' · ' + u.size + ' ตร.ม.' : ''}${u.station ? '\n🚇 ' + u.station + (Number(u.stationDist) ? ' ' + Number(u.stationDist).toLocaleString('th-TH') + ' ม.' : '') : ''}\nค่าเช่า ${B(u.rent)}/เดือน\nดูรายละเอียดและรูป: ${link}`;
}
async function renderShare() {
  const u = units_().find(x => x.id === shareState.id); if (!u) return;
  const el = $('fxShareBody'); if (!el) return;
  el.querySelector('#fxShareLink').textContent = 'กำลังสร้างลิงก์...';
  shareNote = ''; shareState.link = '';
  try { shareBusy++; shareState.link = await buildLink(u, shareState); if (shareState.photo && u.share && shareState.link.includes('/r/')) { const op = { hideRoom: !!shareState.hideRoom, showPhone: !!shareState.showPhone, photo: true }; if (JSON.stringify(u.share.opts) !== JSON.stringify(op)) { u.share.opts = op; try { window.persist(); } catch (e) {} } } }
  catch (e) {
    el.querySelector('#fxShareLink').innerHTML = `<span class="text-rose-600 font-semibold">สร้างลิงก์สั้นไม่สำเร็จ: ${E(e.message)}</span><br><span class="text-[10px] text-slate-400">${E(e.detail || '')}</span>`;
    el.querySelector('#fxShareLen').innerHTML = `<span class="flex gap-2 mt-1"><button onclick="FX.shareRetry()" class="px-3 py-1.5 rounded-full bg-brick-500 text-white text-[11px] font-semibold">ลองใหม่</button><button onclick="FX.shareLong()" class="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">ใช้ลิงก์ยาวแทน</button></span>`;
    return;
  }
  finally { shareBusy--; }
  el.querySelector('#fxShareLink').textContent = shareState.link;
  el.querySelector('#fxShareLen').textContent = shareState.link.includes('/r/') ? (shareNote || 'ลิงก์ถาวรของห้องนี้ · แก้ข้อมูลแล้วแชร์อีกครั้ง ลิงก์เดิมจะอัปเดตให้') : `ออฟไลน์/เชื่อมต่อไม่ได้ ใช้ลิงก์แบบยาวแทน (${shareState.link.length.toLocaleString()} ตัวอักษร)`;
}
const tog = (key, label) => `<label class="flex items-center justify-between gap-3 py-2 text-xs text-slate-500 cursor-pointer"><span>${label}</span><input type="checkbox" ${shareState[key] ? 'checked' : ''} onchange="FX.shareOpt('${key}', this.checked)" class="inp-check"></label>`;
FX.buildRoomLink = buildLink;
// Background auto-update: rooms that already have a link get it refreshed (new photos only) a few seconds after an edit.
let shareBusy = 0, bgTimer = null, bgRun = false;
async function bgShareUpdate() {
  if (bgRun || shareBusy || !navigator.onLine) return; bgRun = true;
  try {
    for (const u of units_().filter(x => x.share && x.share.id && x.share.secret && x.share.opts)) {
      if (shareBusy || !navigator.onLine) break;
      const before = u.share.sig; const nw = FX.noWait; FX.noWait = true;
      try { await buildLink(u, { ...u.share.opts }); } catch (e) { console.warn('bg share update failed', u.id, e); } finally { FX.noWait = nw; }
      if (u.share && u.share.sig !== before) console.log('link auto-updated', u.share.id, FX.lastShareStats);
    }
  } finally { bgRun = false; }
}
FX.bgShareUpdate = bgShareUpdate;
FX.scheduleShareUpdate = (ms) => { clearTimeout(bgTimer); bgTimer = setTimeout(() => bgShareUpdate().catch(() => {}), ms == null ? 6000 : ms); };
{ const _pp = window.persist; if (_pp) window.persist = function () { const r = _pp.apply(this, arguments); FX.scheduleShareUpdate(); return r; }; }
addEventListener('online', () => FX.scheduleShareUpdate(3000));
setInterval(() => FX.scheduleShareUpdate(0), 180000);
FX.sb = { url: SB_URL, h: SB_H };
FX.shareRetry = () => renderShare();
FX.shareLong = async function () {
  const u = units_().find(x => x.id === shareState.id); if (!u) return; const el = $('fxShareBody');
  shareState.link = await buildLink(u, { ...shareState, long: true });
  el.querySelector('#fxShareLink').textContent = shareState.link;
  el.querySelector('#fxShareLen').textContent = `ลิงก์ยาว (สำรอง) ${shareState.link.length.toLocaleString()} ตัวอักษร · ไม่ใช่ลิงก์ถาวร`;
};
FX.shareNew = function () {
  const u = units_().find(x => x.id === shareState.id); if (!u || !u.share) return renderShare();
  if (!confirm('สร้างลิงก์ใหม่ให้ห้องนี้? ลิงก์เดิมจะยังเปิดได้ แต่จะไม่อัปเดตข้อมูลอีก')) return;
  delete u.share; try { window.persist(); } catch (e) {} renderShare();
};
FX.shareOpt = (k, v) => { shareState[k] = v; try { const o = JSON.parse(localStorage.getItem('max_share_opts') || '{}'); o[k] = v; localStorage.setItem('max_share_opts', JSON.stringify(o)); } catch (e) {} renderShare(); };
FX.openShare = function (id) {
  const u = units_().find(x => x.id === id); if (!u) return;
  let so = {}; try { so = JSON.parse(localStorage.getItem('max_share_opts') || '{}'); } catch (e) {}
  shareState = { hideRoom: false, showPhone: true, photo: true, ...so, id, link: '' };
  FX.open(FX.sheetHead('แชร์ห้องให้ลูกค้า', 'ลูกค้าเปิดดูรูป ราคา และทักไลน์ได้ทันที ไม่ต้องติดตั้งแอป') + `<div id="fxShareBody">
    <div class="flex gap-3 p-3 bg-slate-950 rounded-2xl mb-4"><div class="w-14 h-14 rounded-xl bg-brick-500/10 flex items-center justify-center shrink-0"><i data-lucide="home" class="w-6 h-6 text-brick-500"></i></div><div class="min-w-0"><p class="text-sm font-semibold truncate">${E(u.project || '-')}${u.room ? ' · ' + E(u.room) : ''}</p><p class="text-xs text-brick-600 font-bold">${B(u.rent)}/เดือน</p><p class="text-[11px] text-slate-400">${E(u.type || '')}${u.size ? ' · ' + u.size + ' ตร.ม.' : ''}${u.floor ? ' · ชั้น ' + E(u.floor) : ''}</p></div></div>
    <p class="text-[11px] text-slate-500 mb-1">ลิงก์สำหรับลูกค้า</p>
    <div class="bg-white border border-slate-700 rounded-2xl p-3"><p id="fxShareLink" class="text-[11px] text-slate-400 break-all max-h-16 overflow-hidden"></p></div>
    <p id="fxShareLen" class="text-[10px] text-slate-400 mt-1"></p>
    <div class="mt-2 divide-y divide-slate-800">${tog('photo', 'แนบรูปห้อง')}${tog('showPhone', 'แสดงเบอร์โทรของฉัน')}${tog('hideRoom', 'ไม่แสดงเลขห้อง')}</div>
    <button onclick="FX.shareNew()" class="mt-2 text-[11px] text-brick-600 font-semibold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3 h-3"></i>สร้างลิงก์ใหม่</button>
    <p class="text-[10px] text-slate-400 mt-1">ไม่รวมข้อมูลเจ้าของห้อง โน้ตภายใน และลิงก์ต้นทาง</p>
    <div class="grid grid-cols-3 gap-2 mt-4">
      <button onclick="FX.shareDo('line')" class="py-2.5 rounded-full text-white text-xs font-semibold flex items-center justify-center gap-1.5" style="background:#06C755"><i data-lucide="message-circle" class="w-4 h-4"></i>LINE</button>
      <button onclick="FX.shareDo('copy')" class="py-2.5 rounded-full bg-brick-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"><i data-lucide="copy" class="w-4 h-4"></i>คัดลอก</button>
      <button onclick="FX.shareDo('open')" class="py-2.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5"><i data-lucide="external-link" class="w-4 h-4"></i>ดูตัวอย่าง</button>
    </div>
    ${navigator.share ? `<button onclick="FX.shareDo('native')" class="w-full mt-2 py-2.5 rounded-full bg-white border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"><i data-lucide="share-2" class="w-4 h-4"></i>แชร์ช่องทางอื่น</button>` : ''}
  </div>`);
  renderShare();
};
FX.shareDo = async function (how) {
  const u = units_().find(x => x.id === shareState.id); if (!u || !shareState.link) return T('กำลังสร้างลิงก์...');
  const text = shareText(u, shareState.link);
  if (how === 'copy') return FX.copy(shareState.link);
  if (how === 'open') return window.open(shareState.link, '_blank');
  if (how === 'native') { try { await navigator.share({ title: u.project || 'ห้องให้เช่า', text: shareText(u, '').replace(/\nดูรายละเอียดและรูป: $/, ''), url: shareState.link }); } catch (e) {} return; }
  if (how === 'line') {
    if (('https://line.me/R/share?text=' + encodeURIComponent(text)).length > 7500) {
      const short = await buildLink(u, { ...shareState, photo: false });
      T('ลิงก์ยาวเกินไปสำหรับ LINE จึงส่งแบบไม่มีรูป');
      return FX.lineShare(shareText(u, short));
    }
    return FX.lineShare(text);
  }
};
// hook into room detail view: add a share button
const _rdv = window.renderDetailView;
if (_rdv) window.renderDetailView = function () {
  const r = _rdv.apply(this, arguments);
  try {
    const btn = document.querySelector('#detailViewContent button[onclick^="quickCopy"]');
    if (btn && !document.getElementById('fxShareBtn')) {
      const id = (btn.getAttribute('onclick').match(/quickCopy\('([^']+)'\)/) || [])[1];
      btn.parentElement.insertAdjacentHTML('afterend', `<button id="fxShareBtn" onclick="FX.openShare('${id}')" class="w-full mb-4 -mt-1 py-3 rounded-full text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md" style="background:#06C755"><i data-lucide="link" class="w-4 h-4"></i>แชร์ลิงก์ห้องให้ลูกค้า</button>`);
      icons();
    }
  } catch (e) {}
  return r;
};
})();

/* ===================== 2) APPOINTMENTS + CALENDAR ===================== */
(function () {
const { $, E, T, ls, icons, pad, ymd, ymOf, thDate, thMonth, addMonths, units_, custs_, unitName, TH_M } = FX.u;
const KEY = 'staylow_appointments_v1';
let appts = ls.get(KEY, []);
if (!Array.isArray(appts)) appts = [];
const save = () => { ls.set(KEY, appts); };
const TYPES = { VIEW: ['นัดดูห้อง', 'bg-brick-500'], SIGN: ['เซ็นสัญญา', 'bg-sky-500'], HANDOVER: ['ส่งมอบห้อง', 'bg-amber-500'], FOLLOW: ['ติดตาม', 'bg-emerald-500'] };
const REM = [[0, 'ไม่เตือน'], [15, '15 นาที'], [60, '1 ชม.'], [1440, '1 วัน']];
let calMonth = ymOf(new Date()), selDay = ymd(new Date());
FX.appts = () => appts;
(FX.reloaders = FX.reloaders || []).push(() => { appts = ls.get(KEY, []); if (!Array.isArray(appts)) appts = []; });
FX.addBackup('appointments', () => appts, v => { if (!Array.isArray(v)) return; v.forEach(a => { const i = appts.findIndex(x => x.id === a.id); if (i >= 0) appts[i] = { ...appts[i], ...a }; else appts.push(a); }); save(); });
const cust = id => custs_().find(c => c.id === id);
const unit = id => units_().find(u => u.id === id);
const sorted = list => list.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
const todayCount = () => appts.filter(a => a.date === ymd(new Date()) && !a.done).length;

function apptCard(a) {
  const c = cust(a.custId), u = unit(a.unitId), t = TYPES[a.type] || TYPES.VIEW;
  const rem = REM.find(r => r[0] === Number(a.reminder));
  return `<div class="bg-white rounded-2xl p-3 shadow-sm border border-slate-700 flex gap-3 ${a.done ? 'opacity-60' : ''}">
    <div class="text-center w-12 shrink-0"><p class="text-sm font-bold">${E(a.time || '--:--')}</p><p class="text-[10px] text-slate-400">${E(a.endTime || '')}</p></div>
    <div class="w-1 rounded-full ${t[1]}"></div>
    <div class="flex-1 min-w-0" onclick="FX.editAppt('${a.id}')"><p class="text-sm font-semibold truncate ${a.done ? 'line-through' : ''}">${E(c ? c.name : (a.custName || 'ไม่ระบุลูกค้า'))}</p><p class="text-[11px] text-slate-400 truncate">${E(unitName(u))}</p>
      <div class="flex flex-wrap gap-1.5 mt-2"><span class="text-[10px] px-2 py-0.5 rounded-full bg-brick-50 text-brick-700">${t[0]}</span>${rem && rem[0] ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">เตือน ${rem[1]} ก่อน</span>` : ''}${a.done ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700">เสร็จแล้ว</span>' : ''}</div>${a.note ? `<p class="text-[11px] text-slate-400 mt-1.5 line-clamp-2">${E(a.note)}</p>` : ''}</div>
    <div class="flex flex-col gap-1.5 shrink-0">
      ${c && c.phone ? `<a href="tel:${E(String(c.phone).replace(/[^0-9+]/g, ''))}" class="w-8 h-8 rounded-full bg-brick-500/10 text-brick-600 flex items-center justify-center" aria-label="โทร"><i data-lucide="phone" class="w-3.5 h-3.5"></i></a>` : ''}
      <button onclick="FX.apptLine('${a.id}')" class="w-8 h-8 rounded-full flex items-center justify-center" style="background:#06C7551a;color:#06C755" aria-label="ส่ง LINE"><i data-lucide="message-circle" class="w-3.5 h-3.5"></i></button>
      <button onclick="FX.toggleAppt('${a.id}')" class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center" aria-label="เสร็จ"><i data-lucide="${a.done ? 'rotate-ccw' : 'check'}" class="w-3.5 h-3.5"></i></button>
    </div></div>`;
}
FX.apptCard = apptCard;
function calendar() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
  const today = ymd(new Date());
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${calMonth}-${pad(d)}`, on = ds === selDay, isT = ds === today;
    const dots = appts.filter(a => a.date === ds).slice(0, 3).map(a => `<span class="w-1 h-1 rounded-full ${on ? 'bg-white' : (TYPES[a.type] || TYPES.VIEW)[1]}"></span>`).join('');
    cells += `<button onclick="FX.selDay('${ds}')" class="flex flex-col items-center py-1.5 rounded-xl ${on ? 'bg-brick-500 text-white' : isT ? 'bg-brick-50 text-brick-700' : 'hover:bg-slate-100'}"><span class="text-xs ${on || isT ? 'font-bold' : ''}">${d}</span><span class="flex gap-0.5 h-1 mt-1">${dots}</span></button>`;
  }
  return `<div class="bg-white rounded-2xl p-4 shadow-sm border border-slate-700"><div class="flex items-center justify-between mb-3"><button onclick="FX.calNav(-1)" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="เดือนก่อน"><i data-lucide="chevron-left" class="w-4 h-4"></i></button><p class="text-sm font-semibold">${thMonth(calMonth)}</p><button onclick="FX.calNav(1)" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="เดือนถัดไป"><i data-lucide="chevron-right" class="w-4 h-4"></i></button></div>
  <div class="grid grid-cols-7 text-center text-[10px] text-slate-400 mb-1"><span>อา</span><span>จ</span><span>อ</span><span>พ</span><span>พฤ</span><span>ศ</span><span>ส</span></div><div class="grid grid-cols-7 gap-y-1 text-center">${cells}</div>
  <div class="flex flex-wrap gap-3 mt-3 text-[10px] text-slate-400">${Object.values(TYPES).map(t => `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full ${t[1]}"></span>${t[0]}</span>`).join('')}</div></div>`;
}
FX.registerView('appts', { title: 'นัดดูห้อง', render() {
  const mCount = appts.filter(a => a.date.startsWith(calMonth)).length;
  const day = sorted(appts.filter(a => a.date === selDay));
  const d = new Date(selDay + 'T00:00:00');
  const upcoming = sorted(appts.filter(a => a.date > selDay && !a.done)).slice(0, 5);
  return `<div class="flex items-center justify-between mb-4"><p class="text-xs text-slate-400">${thMonth(calMonth)} ${mCount} นัด · วันนี้ ${todayCount()} นัด</p><button onclick="FX.editAppt()" class="bg-brick-500 hover:bg-brick-400 text-white text-xs font-semibold px-3 py-2 rounded-full flex items-center gap-1.5 shadow-md shadow-brick-500/25"><i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>เพิ่มนัด</button></div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div>${calendar()}</div><div class="space-y-2">
  <div class="flex items-center justify-between"><h3 class="text-sm font-semibold">${['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'][d.getDay()]} ${thDate(selDay)}</h3><span class="text-[11px] text-slate-400">${day.length} นัด</span></div>
  ${day.length ? day.map(apptCard).join('') : (typeof emptyStateHTML === 'function' ? emptyStateHTML('calendar-days', 'ไม่มีนัดในวันนี้', 'เพิ่มนัดดูห้อง เซ็นสัญญา หรือส่งมอบห้อง แล้วระบบจะเตือนในแอป', 'เพิ่มนัด', `FX.editAppt(null,'${selDay}')`) : '')}
  ${upcoming.length ? `<h3 class="text-sm font-semibold pt-3">นัดถัดไป</h3>${upcoming.map(a => `<button onclick="FX.selDay('${a.date}')" class="w-full text-left flex items-center gap-3 p-2.5 bg-white border border-slate-700 rounded-xl"><span class="w-1.5 h-8 rounded-full ${(TYPES[a.type] || TYPES.VIEW)[1]}"></span><span class="flex-1 min-w-0"><span class="block text-xs font-semibold truncate">${E((cust(a.custId) || {}).name || a.custName || 'ไม่ระบุลูกค้า')}</span><span class="block text-[10px] text-slate-400 truncate">${E(unitName(unit(a.unitId)))}</span></span><span class="text-[11px] text-slate-500 shrink-0">${thDate(a.date)} ${E(a.time || '')}</span></button>`).join('')}` : ''}
  </div></div>`;
} });
FX.selDay = d => { selDay = d; calMonth = d.slice(0, 7); FX.refresh(); };
FX.calNav = n => { calMonth = addMonths(calMonth, n); selDay = calMonth + '-01'; FX.refresh(); };
FX.toggleAppt = id => { const a = appts.find(x => x.id === id); if (!a) return; a.done = !a.done; save(); FX.refresh(); FX.injectTools(); };
FX.apptLine = id => {
  const a = appts.find(x => x.id === id); if (!a) return; const c = cust(a.custId), u = unit(a.unitId), cf = FX.u.cfg();
  const t = (TYPES[a.type] || TYPES.VIEW)[0];
  FX.lineShare(`สวัสดีค่ะ${c ? ' ' + c.name : ''} ขอยืนยัน${t}\n🏢 ${unitName(u)}\n📅 ${thDate(a.date)} เวลา ${a.time || '-'}${a.note ? '\n📝 ' + a.note : ''}${u && u.project ? '\n📍 https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(u.project) : ''}\n— ${cf.agentName || ''}${cf.phone ? ' ' + cf.phone : ''}`);
};
const opt = (list, val) => list.map(([v, l]) => `<option value="${E(v)}" ${String(v) === String(val) ? 'selected' : ''}>${E(l)}</option>`).join('');
FX.editAppt = function (id, date, preset) {
  const a = id ? appts.find(x => x.id === id) : { id: '', date: date || selDay, time: '10:00', endTime: '', type: 'VIEW', reminder: 60, custId: '', unitId: '', note: '', ...(preset || {}) };
  if (!a) return;
  const cOpts = [['', '— เลือกลูกค้า —'], ...custs_().map(c => [c.id, c.name || '(ไม่มีชื่อ)'])];
  const uOpts = [['', '— เลือกห้อง —'], ...units_().map(u => [u.id, unitName(u)])];
  const chip = (name, v, l, cur) => `<label class="cursor-pointer"><input type="radio" name="${name}" value="${v}" ${String(v) === String(cur) ? 'checked' : ''} class="peer hidden"><span class="inline-block px-3 py-1.5 rounded-full text-[11px] bg-slate-100 text-slate-500 peer-checked:bg-brick-500 peer-checked:text-white peer-checked:font-semibold">${l}</span></label>`;
  FX.open(FX.sheetHead(id ? 'แก้ไขนัด' : 'เพิ่มนัดดูห้อง') + `<div class="space-y-3 text-[11px] text-slate-500">
    <label class="block">ลูกค้า<select id="fxA_c" class="inp">${opt(cOpts, a.custId)}</select></label>
    <label class="block">ห้อง<select id="fxA_u" class="inp">${opt(uOpts, a.unitId)}</select></label>
    <div class="grid grid-cols-3 gap-2"><label>วันที่<input id="fxA_d" type="date" class="inp" value="${E(a.date)}"></label><label>เริ่ม<input id="fxA_t" type="time" class="inp" value="${E(a.time)}"></label><label>ถึง<input id="fxA_e" type="time" class="inp" value="${E(a.endTime || '')}"></label></div>
    <div>ประเภท<div class="flex flex-wrap gap-1.5 mt-1.5">${Object.entries(TYPES).map(([k, t]) => chip('fxA_type', k, t[0], a.type)).join('')}</div></div>
    <div>แจ้งเตือนในแอป<div class="flex flex-wrap gap-1.5 mt-1.5">${REM.map(([v, l]) => chip('fxA_rem', v, l, a.reminder)).join('')}</div></div>
    <label class="block">หมายเหตุ<textarea id="fxA_n" rows="2" class="inp" placeholder="เช่น เจอกันที่ล็อบบี้">${E(a.note || '')}</textarea></label>
    <p class="text-[10px] text-slate-400">การแจ้งเตือนจะขึ้นในแอปเมื่อเปิดแอปอยู่ (ไม่มีระบบส่งแจ้งเตือนจากเซิร์ฟเวอร์) · ส่ง LINE ยืนยันให้ลูกค้าได้จากปุ่ม LINE</p>
  </div>
  <div class="grid ${id ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mt-5">${id ? `<button onclick="FX.delAppt('${id}')" class="py-2.5 rounded-full bg-rose-500/10 text-rose-600 text-sm font-semibold">ลบ</button>` : ''}<button onclick="FX.close()" class="py-2.5 rounded-full bg-slate-100 text-slate-600 text-sm font-semibold">ยกเลิก</button><button onclick="FX.saveAppt('${id || ''}')" class="py-2.5 rounded-full bg-brick-500 text-white text-sm font-semibold">บันทึกนัด</button></div>`);
};
FX.saveAppt = function (id) {
  const v = s => ($(s) || {}).value || '';
  const r = n => (document.querySelector(`input[name="${n}"]:checked`) || {}).value;
  const date = v('fxA_d'); if (!date) return T('เลือกวันที่');
  const data = { custId: v('fxA_c'), unitId: v('fxA_u'), date, time: v('fxA_t'), endTime: v('fxA_e'), type: r('fxA_type') || 'VIEW', reminder: Number(r('fxA_rem') || 0), note: v('fxA_n').trim() };
  if (id) { const a = appts.find(x => x.id === id); Object.assign(a, data, { notified: false }); }
  else appts.push({ id: 'a' + Date.now().toString(36), done: false, createdAt: Date.now(), ...data });
  save(); FX.close(); selDay = date; calMonth = date.slice(0, 7); T('บันทึกนัดแล้ว');
  if (!$('viewFx') || $('viewFx').classList.contains('hidden')) FX.show('appts'); else FX.refresh();
  FX.injectTools();
};
FX.delAppt = id => { if (!confirm('ลบนัดนี้?')) return; appts = appts.filter(a => a.id !== id); save(); FX.close(); FX.refresh(); FX.injectTools(); };
FX.addTool({ label: 'นัดดูห้อง', icon: 'calendar-days', view: 'appts', action: "FX.show('appts')", badge: () => todayCount() });
// in-app reminders
function checkReminders() {
  const now = Date.now(); let changed = false;
  appts.forEach(a => {
    if (a.done || a.notified || !Number(a.reminder) || !a.date) return;
    const at = new Date(`${a.date}T${a.time || '09:00'}:00`).getTime();
    if (now >= at - a.reminder * 60000 && now < at + 3600000) {
      const c = cust(a.custId); a.notified = true; changed = true;
      T(`⏰ ${(TYPES[a.type] || TYPES.VIEW)[0]} ${a.time || ''} · ${c ? c.name : ''} ${unitName(unit(a.unitId))}`);
    }
  });
  if (changed) save();
}
setTimeout(checkReminders, 3000); setInterval(checkReminders, 60000);
})();

/* ===================== 3) CUSTOMER ↔ ROOM MATCHING ===================== */
(function () {
const { $, E, B, T, icons, units_, custs_, unitName } = FX.u;
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const bedOf = t => { t = norm(t); if (!t) return null; if (t.includes('studio')) return 0; const m = t.match(/(\d)/); return m ? Number(m[1]) : (t.includes('duplex') ? 2 : null); };
function score(c, u) {
  const reasons = [], misses = [];
  let s = 0;
  const rent = Number(u.rent) || 0, mn = Number(c.budgetMin) || 0, mx = Number(c.budgetMax) || 0;
  if (mn || mx) {
    if ((!mn || rent >= mn) && (!mx || rent <= mx)) { s += 40; reasons.push('งบตรง'); }
    else if (mx && rent > mx && rent <= mx * 1.1) { s += 22; misses.push('เกินงบ ' + B(rent - mx)); }
    else if (mn && rent < mn) { s += 30; reasons.push('ถูกกว่างบ'); }
    else misses.push('เกินงบ ' + B(rent - mx));
  } else s += 20;
  const ip = norm(c.interestProject), ib = norm(c.interestBuilding), hay = norm(u.project + ' ' + u.building + ' ' + u.notes);
  if (ip) {
    if (norm(u.project).includes(ip) || ip.includes(norm(u.project))) { s += 25; reasons.push('โครงการตรง'); }
    else if (ip.split(/[\s,\/]+/).filter(w => w.length > 2).some(w => hay.includes(w))) { s += 15; reasons.push('ทำเลใกล้เคียง'); }
    else misses.push('คนละโครงการ');
  } else s += 10;
  if (ib && norm(u.building).includes(ib)) { s += 5; reasons.push('อาคารตรง'); }
  if (/bts|mrt|arl|รถไฟฟ้า/i.test(u.notes || '')) reasons.push('ใกล้รถไฟฟ้า');
  const cb = bedOf(c.interestType), ub = bedOf(u.type);
  if (cb !== null) { if (cb === ub) { s += 25; reasons.push(u.type); } else if (ub !== null && Math.abs(cb - ub) === 1) { s += 8; misses.push(u.type || 'คนละแบบ'); } else misses.push(u.type || 'คนละแบบ'); }
  else s += 10;
  const dl = typeof daysLeft === 'function' ? daysLeft(u.end) : null;
  if (u.status === 'AVAILABLE') { s += 10; reasons.push('ว่างพร้อมเข้าอยู่'); }
  else if (u.status === 'OCCUPIED' && dl !== null && dl >= 0 && dl <= 60) { s += 4; reasons.push('ว่างใน ' + dl + ' วัน'); }
  return { pct: Math.max(0, Math.min(100, s)), reasons, misses };
}
FX.matchScore = score;
FX.matchesFor = function (c) {
  return units_().filter(u => u.status === 'AVAILABLE' || (u.status === 'OCCUPIED' && (() => { const d = typeof daysLeft === 'function' ? daysLeft(u.end) : null; return d !== null && d >= 0 && d <= 60; })()))
    .map(u => ({ u, ...score(c, u) })).filter(m => m.pct >= 40).sort((a, b) => b.pct - a.pct || (a.u.rent || 0) - (b.u.rent || 0));
};
function section(c) {
  const list = FX.matchesFor(c), top = list.slice(0, 4);
  const card = m => { const col = m.pct >= 85 ? 'text-emerald-700 bg-emerald-500/10' : m.pct >= 65 ? 'text-amber-700 bg-amber-500/10' : 'text-slate-500 bg-slate-100';
    return `<div class="p-3 rounded-2xl border border-slate-700 bg-white"><div class="flex gap-3"><button onclick="openDetailView('${m.u.id}')" class="w-12 h-12 rounded-xl bg-brick-500/10 flex items-center justify-center shrink-0"><i data-lucide="building-2" class="w-5 h-5 text-brick-600"></i></button><div class="flex-1 min-w-0"><div class="flex items-start justify-between gap-2"><p class="text-xs font-semibold truncate">${E(unitName(m.u))}</p><span class="text-xs font-bold px-2 py-0.5 rounded-full ${col} shrink-0">${m.pct}%</span></div><p class="text-xs text-brick-600 font-bold">${B(m.u.rent)}/เดือน${m.u.size ? ` <span class="text-slate-400 font-normal">· ${m.u.size} ตร.ม.</span>` : ''}</p>
    <div class="flex flex-wrap gap-1 mt-1.5">${m.reasons.map(r => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-brick-50 text-brick-700 flex items-center gap-0.5"><i data-lucide="check" class="w-3 h-3"></i>${E(r)}</span>`).join('')}${m.misses.map(r => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">${E(r)}</span>`).join('')}</div></div></div>
    <div class="flex gap-2 mt-2.5"><button onclick="FX.openShare('${m.u.id}')" class="flex-1 py-2 rounded-full text-white text-xs font-semibold flex items-center justify-center gap-1" style="background:#06C755"><i data-lucide="send" class="w-3.5 h-3.5"></i>ส่งให้ลูกค้า</button><button onclick="FX.editAppt && FX.editAppt(null,null,{custId:'${c.id}',unitId:'${m.u.id}'})" class="px-4 py-2 rounded-full bg-slate-100 text-xs font-semibold text-slate-600 flex items-center gap-1"><i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>นัดดู</button></div></div>`; };
  const noCrit = !(c.budgetMin || c.budgetMax || c.interestProject || c.interestType);
  return `<div id="fxMatch" class="bg-white border border-slate-700 rounded-2xl p-4 mb-3"><div class="flex items-center justify-between mb-3"><h3 class="text-xs font-bold text-ink flex items-center gap-1.5"><i data-lucide="sparkles" class="w-4 h-4 text-brick-500"></i>ห้องที่เข้ากับลูกค้า (${list.length})</h3>${list.length > 1 ? `<button onclick="FX.sendMatches('${c.id}')" class="text-[11px] font-semibold flex items-center gap-1" style="color:#06C755"><i data-lucide="send" class="w-3.5 h-3.5"></i>ส่ง ${Math.min(3, list.length)} ห้องทาง LINE</button>` : ''}</div>
    ${noCrit ? '<p class="text-[11px] text-slate-400 mb-2">ใส่งบประมาณ โครงการ หรือจำนวนห้องนอนที่ลูกค้าสนใจ เพื่อให้จับคู่แม่นขึ้น</p>' : ''}
    ${top.length ? `<div class="space-y-2">${top.map(card).join('')}</div>` : '<p class="text-xs text-slate-400 text-center py-4">ยังไม่มีห้องว่างที่ตรงกับความต้องการ</p>'}</div>`;
}
FX.sendMatches = async function (cid) {
  const c = custs_().find(x => x.id === cid); if (!c) return;
  const top = FX.matchesFor(c).slice(0, 3); if (!top.length) return;
  T('กำลังสร้างลิงก์...');
  const lines = [];
  for (const m of top) { let link = ''; try { link = FX.buildRoomLink ? await FX.buildRoomLink(m.u, { photo: false, showPhone: true, hideRoom: false }) : ''; } catch (e) { T('สร้างลิงก์ไม่สำเร็จ: ' + e.message); return; } lines.push(`🏢 ${unitName(m.u)} · ${m.u.type || ''} ${m.u.size ? m.u.size + ' ตร.ม.' : ''}\n💰 ${B(m.u.rent)}/เดือน\n${link}`); }
  FX.lineShare(`สวัสดีค่ะ ${c.name || ''} ห้องที่น่าจะตรงกับที่มองหาค่ะ\n\n${lines.join('\n\n')}`);
};
const _rcd = window.renderCustDetail;
if (_rcd) window.renderCustDetail = function () {
  const r = _rcd.apply(this, arguments);
  try {
    const c = custs_().find(x => x.id === detailCustId); const box = $('custDetailContent');
    if (c && box) {
      box.insertAdjacentHTML('beforeend', section(c));
      const m = $('fxMatch'); const target = [...box.children].find(d => d !== m && /ห้องที่สนใจ/.test(d.textContent));
      if (target) box.insertBefore(m, target);
      icons(); }
  } catch (e) { console.warn(e); }
  return r;
};
})();

/* ===================== 4) AVAILABILITY CALENDAR ===================== */
(function () {
const { $, E, B, icons, ymOf, thMonth, addMonths, units_, unitName, TH_M } = FX.u;
const mStart = ym => ym + '-01';
const mEnd = ym => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1, 1)) + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0'); };
const marks = () => (typeof monthlyOcc !== 'undefined' && monthlyOcc) || {};
/* State of a room in a month: 'O' occupied, 'V' vacant, 'R' reserved.
   Priority: monthly mark (dashboard toggle) > contract dates > current status (current/future months only). */
FX.occState = function (u, ym) {
  const m = marks()[ym];
  if (m && Object.prototype.hasOwnProperty.call(m, u.id)) return m[u.id] ? 'O' : 'V';
  const cur = ymOf(new Date());
  if (u.start || u.end) {
    const s = u.start || '0000-01-01', e = u.end || '9999-12-31';
    if (s <= mEnd(ym) && e >= mStart(ym)) return 'O';
    if (ym < cur) return 'V';
    if (u.status === 'RESERVED' && ym <= addMonths(cur, 1)) return 'R';
    return u.end && u.end < mStart(ym) ? 'V' : (u.status === 'OCCUPIED' && !u.end ? 'O' : 'V');
  }
  if (ym < cur) return 'V';
  if (u.status === 'OCCUPIED') return 'O';
  if (u.status === 'RESERVED') return ym <= addMonths(cur, 1) ? 'R' : 'V';
  return 'V';
};
FX.occIn = (u, ym) => FX.occState(u, ym) === 'O';
const COL = { O: 'bg-brick-500', V: 'bg-emerald-400', R: 'bg-amber-400' };
const LBL = { O: 'มีผู้เช่า', V: 'ว่าง', R: 'จอง' };
let startOff = 0, span = 6;
FX.registerView('avail', { title: 'ปฏิทินห้องว่าง', render() {
  const cur = ymOf(new Date()); const first = addMonths(cur, startOff);
  const months = Array.from({ length: span }, (_, i) => addMonths(first, i));
  const us = units_().slice().sort((a, b) => (a.project || '').localeCompare(b.project || '') || String(a.room).localeCompare(String(b.room)));
  const nowCounts = { O: 0, V: 0, R: 0 }; us.forEach(u => nowCounts[FX.occState(u, cur)]++);
  const soon = us.map(u => { const i = months.findIndex((ym, k) => k > 0 && FX.occState(u, ym) === 'V' && FX.occState(u, months[k - 1]) === 'O'); return i > 0 && months[i] > cur ? { u, ym: months[i] } : null; }).filter(Boolean).slice(0, 3);
  const head = `<div class="grid gap-0.5 text-[10px] text-slate-400 mb-1" style="grid-template-columns:repeat(${span},1fr)">${months.map(ym => `<span class="text-center ${ym === cur ? 'text-brick-600 font-bold' : ''}">${TH_M[Number(ym.slice(5)) - 1]}${ym.endsWith('-01') ? ' ' + String(Number(ym.slice(0, 4)) + 543).slice(2) : ''}</span>`).join('')}</div>`;
  const row = u => `<div class="py-2.5 border-b border-slate-800 last:border-0"><button onclick="openDetailView('${u.id}')" class="w-full text-left flex justify-between gap-2 mb-1.5"><p class="text-xs font-semibold truncate">${E(unitName(u))}</p><span class="text-[10px] text-slate-400 shrink-0">${B(u.rent)}</span></button><div class="grid gap-0.5" style="grid-template-columns:repeat(${span},1fr)">${months.map((ym, i) => { const s = FX.occState(u, ym); const prev = i ? FX.occState(u, months[i - 1]) : null, next = i < span - 1 ? FX.occState(u, months[i + 1]) : null; return `<div title="${thMonth(ym)}: ${LBL[s]}" class="h-5 ${COL[s]} ${prev !== s ? 'rounded-l-full' : ''} ${next !== s ? 'rounded-r-full' : ''}"></div>`; }).join('')}</div></div>`;
  return `<p class="text-xs text-slate-400 mb-4">ดูล่วงหน้า ${span} เดือน · ${us.length} ห้อง · คำนวณจากวันสัญญาและการติ๊กมีผู้เช่ารายเดือน</p>
  <div class="grid grid-cols-3 gap-2 text-center mb-3">${['O', 'V', 'R'].map(k => `<div class="bg-white border border-slate-700 rounded-2xl p-3 shadow-sm"><p class="text-[10px] text-slate-400">${LBL[k]} (เดือนนี้)</p><p class="text-lg font-bold ${k === 'O' ? 'text-brick-600' : k === 'V' ? 'text-emerald-600' : 'text-amber-600'}">${nowCounts[k]}</p></div>`).join('')}</div>
  ${us.length ? `<div class="bg-white border border-slate-700 rounded-2xl p-4 shadow-sm"><div class="flex items-center justify-between mb-3"><button onclick="FX.availNav(-${span})" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="ก่อนหน้า"><i data-lucide="chevron-left" class="w-4 h-4"></i></button><div class="flex gap-1 text-[11px]">${[6, 12].map(n => `<button onclick="FX.availSpan(${n})" class="px-3 py-1 rounded-full ${span === n ? 'bg-brick-500 text-white font-semibold' : 'bg-slate-100 text-slate-500'}">${n} เดือน</button>`).join('')}${startOff ? `<button onclick="FX.availNav(0)" class="px-3 py-1 rounded-full bg-brick-50 text-brick-700">เดือนนี้</button>` : ''}</div><button onclick="FX.availNav(${span})" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="ถัดไป"><i data-lucide="chevron-right" class="w-4 h-4"></i></button></div>${head}${us.map(row).join('')}
  <div class="flex gap-3 mt-3 text-[10px] text-slate-400">${['O', 'V', 'R'].map(k => `<span class="flex items-center gap-1"><span class="w-3 h-2 rounded-full ${COL[k]}"></span>${LBL[k]}</span>`).join('')}</div></div>
  ${soon.map(s => `<div class="bg-white border border-slate-700 rounded-2xl p-3 shadow-sm flex items-center gap-3 mt-3"><div class="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0"><i data-lucide="megaphone" class="w-4 h-4 text-emerald-600"></i></div><p class="text-xs flex-1">${E(unitName(s.u))} จะว่างตั้งแต่ ${thMonth(s.ym)} — เริ่มหาผู้เช่าได้เลย</p><button onclick="FX.openShare('${s.u.id}')" class="text-[11px] bg-brick-500 text-white px-3 py-1.5 rounded-full font-semibold shrink-0">แชร์</button></div>`).join('')}`
  : (typeof emptyStateHTML === 'function' ? emptyStateHTML('calendar-range', 'ยังไม่มีห้อง', 'เพิ่มห้องพร้อมวันเริ่ม/สิ้นสุดสัญญา เพื่อดูช่วงว่างล่วงหน้า', 'เพิ่มห้อง', "openSheet('add')") : '')}`;
} });
FX.availNav = n => { startOff = n === 0 ? 0 : startOff + n; FX.refresh(); };
FX.availSpan = n => { span = n; FX.refresh(); };
FX.addTool({ label: 'ปฏิทินห้องว่าง', icon: 'calendar-range', view: 'avail', action: "FX.show('avail')" });
})();

/* ===================== 5) EXPIRING CONTRACTS 30/60/90 ===================== */
(function () {
const { $, E, B, T, icons, ymd, thDate, units_, custs_, unitName, cfg } = FX.u;
let filt = 'all';
const dl = u => (typeof daysLeft === 'function' ? daysLeft(u.end) : null);
const tenantOf = u => custs_().find(c => (c.linkedUnits || []).includes(u.id) && c.status === 'WON') || null;
const list = () => units_().filter(u => u.end && u.status === 'OCCUPIED').map(u => ({ u, d: dl(u) })).filter(x => x.d !== null && x.d >= -30 && x.d <= 90).sort((a, b) => a.d - b.d);
const bucket = d => d < 0 ? 'over' : d <= 30 ? '30' : d <= 60 ? '60' : '90';
const BC = { over: 'bg-rose-600 text-white', '30': 'bg-rose-500/10 text-rose-600', '60': 'bg-amber-500/10 text-amber-700', '90': 'bg-sky-500/10 text-sky-700' };
FX.expiringCount = () => list().filter(x => x.d >= 0 && x.d <= 30).length;
function msgTenant(u) { const c = cfg(); const t = tenantOf(u); return `สวัสดีค่ะ${t ? ' ' + t.name : ''}\nสัญญาเช่า ${unitName(u)} จะครบกำหนดวันที่ ${thDate(u.end)}\nสนใจต่อสัญญาไหมคะ? ตอบกลับได้เลยค่ะ 🙏\n— ${c.agentName || ''}${c.phone ? ' ' + c.phone : ''}`; }
function alertText(u, d) { return `⏰ สัญญาใกล้หมด ${d < 0 ? 'เลยมา ' + (-d) : d} วัน\n${unitName(u)}\nหมด ${thDate(u.end)} · ค่าเช่า ${B(u.rent)}/เดือน`; }
FX.registerView('expiring', { title: 'สัญญาใกล้หมด', render() {
  const all = list(); const shown = all.filter(x => filt === 'all' || bucket(x.d) === filt);
  const risk = all.filter(x => x.d >= 0).reduce((s, x) => s + Number(x.u.rent || 0), 0);
  const cnt = k => all.filter(x => bucket(x.d) === k).length;
  const chip = (k, l, cls) => `<button onclick="FX.expFilter('${k}')" class="px-3 py-1.5 rounded-full whitespace-nowrap ${filt === k ? 'bg-brick-500 text-white font-semibold' : cls}">${l}</button>`;
  const card = ({ u, d }) => { const t = tenantOf(u); const b = bucket(d);
    return `<div class="bg-white border border-slate-700 rounded-2xl p-3 shadow-sm"><div class="flex items-start gap-3"><span class="text-[11px] font-bold px-2.5 py-1 rounded-full ${BC[b]} shrink-0">${d < 0 ? 'เลย ' + (-d) + ' วัน' : d + ' วัน'}</span><button onclick="openDetailView('${u.id}')" class="flex-1 min-w-0 text-left"><p class="text-xs font-semibold truncate">${E(unitName(u))}</p><p class="text-[11px] text-slate-400 truncate">${t ? 'ผู้เช่า ' + E(t.name) + ' · ' : ''}หมด ${thDate(u.end)} · ${B(u.rent)}</p></button></div>
    <div class="grid grid-cols-3 gap-1.5 mt-2.5"><button onclick="FX.renew('${u.id}')" class="py-1.5 rounded-full bg-brick-500 text-white text-[11px] font-semibold flex items-center justify-center gap-1"><i data-lucide="refresh-cw" class="w-3 h-3"></i>ต่อสัญญา</button><button onclick="FX.expLine('${u.id}')" class="py-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center gap-1" style="background:#06C7551a;color:#06C755"><i data-lucide="message-circle" class="w-3 h-3"></i>ผู้เช่า</button>${u.ownerPhone || u.ownerLine ? `<button onclick="${u.ownerPhone ? `contactOwner('${u.id}')` : `openOwnerLine('${u.id}')`}" class="py-1.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold flex items-center justify-center gap-1"><i data-lucide="${u.ownerPhone ? 'phone' : 'message-circle'}" class="w-3 h-3"></i>เจ้าของ</button>` : `<button onclick="FX.copy(${E(JSON.stringify(alertText(u, d)))})" class="py-1.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold flex items-center justify-center gap-1"><i data-lucide="copy" class="w-3 h-3"></i>คัดลอก</button>`}</div></div>`; };
  const first = all.find(x => x.d >= 0);
  return `<p class="text-xs text-slate-400 mb-3">${all.length} สัญญาใน 90 วัน · รายได้เสี่ยง ${B(risk)}/เดือน</p>
  <div class="flex gap-1.5 text-[11px] mb-3 overflow-x-auto hide-scrollbar pb-1">${chip('all', 'ทั้งหมด ' + all.length, 'bg-white border border-slate-700 text-slate-500')}${cnt('over') ? chip('over', 'เลยกำหนด ' + cnt('over'), 'bg-rose-600/10 text-rose-700') : ''}${chip('30', '≤30 วัน ' + cnt('30'), 'bg-rose-500/10 text-rose-600')}${chip('60', '≤60 วัน ' + cnt('60'), 'bg-amber-500/10 text-amber-700')}${chip('90', '≤90 วัน ' + cnt('90'), 'bg-sky-500/10 text-sky-700')}</div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">${shown.length ? shown.map(card).join('') : (typeof emptyStateHTML === 'function' ? emptyStateHTML('calendar-check', 'ไม่มีสัญญาใกล้หมดในช่วงนี้ 🎉', 'ห้องที่มีผู้เช่าและมีวันสิ้นสุดสัญญาภายใน 90 วันจะแสดงที่นี่', '', '') : '')}</div>
  ${first ? `<div class="mt-4"><p class="text-[11px] text-slate-400 mb-2 flex items-center gap-1"><i data-lucide="message-square" class="w-3.5 h-3.5"></i>ข้อความตัวอย่างที่ส่งผ่าน LINE (กดปุ่ม "ผู้เช่า" เพื่อส่งเอง)</p>
  <div class="rounded-2xl p-3 max-w-md" style="background:#8cabd9"><div class="flex gap-2"><div class="w-8 h-8 rounded-full bg-brick-500 text-white text-xs font-bold flex items-center justify-center shrink-0">${E((cfg().agentName || 'M').slice(0, 1))}</div><div class="bg-white rounded-2xl rounded-tl-md p-3 text-xs shadow-sm whitespace-pre-line">${E(msgTenant(first.u))}</div></div></div>
  <p class="text-[10px] text-slate-400 mt-2">หมายเหตุ: แอปนี้ไม่มีเซิร์ฟเวอร์ จึงส่งแจ้งเตือนอัตโนมัติไม่ได้ จะแจ้งเตือนในแอปเมื่อเปิดใช้งาน และส่ง LINE ผ่านปุ่มแชร์</p></div>` : ''}`;
} });
FX.expFilter = k => { filt = k; FX.refresh(); };
FX.expLine = id => { const u = units_().find(x => x.id === id); if (u) FX.lineShare(msgTenant(u)); };
FX.renew = function (id) {
  const u = units_().find(x => x.id === id); if (!u) return;
  FX.open(FX.sheetHead('ต่อสัญญา', E(unitName(u)) + ' · หมด ' + thDate(u.end)) + `<div class="space-y-3 text-[11px] text-slate-500">
    <div>ระยะเวลา<div class="flex gap-1.5 mt-1.5">${[6, 12, 24].map(n => `<label class="cursor-pointer"><input type="radio" name="fxR_m" value="${n}" ${n === 12 ? 'checked' : ''} class="peer hidden"><span class="inline-block px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 peer-checked:bg-brick-500 peer-checked:text-white peer-checked:font-semibold">${n} เดือน</span></label>`).join('')}</div></div>
    <label class="block">ค่าเช่าใหม่ (บาท/เดือน)<input id="fxR_rent" type="number" inputmode="numeric" class="inp" value="${Number(u.rent) || ''}"></label>
    <p class="text-[10px] text-slate-400">สัญญาใหม่จะเริ่มต่อจากวันสิ้นสุดเดิม และปรับวันสิ้นสุดให้อัตโนมัติ</p></div>
    <div class="grid grid-cols-2 gap-2 mt-5"><button onclick="FX.close()" class="py-2.5 rounded-full bg-slate-100 text-slate-600 text-sm font-semibold">ยกเลิก</button><button onclick="FX.doRenew('${id}')" class="py-2.5 rounded-full bg-brick-500 text-white text-sm font-semibold">บันทึกต่อสัญญา</button></div>`);
};
FX.doRenew = function (id) {
  const u = units_().find(x => x.id === id); if (!u || !u.end) return;
  const n = Number((document.querySelector('input[name="fxR_m"]:checked') || {}).value || 12);
  const old = new Date(u.end + 'T00:00:00'); const s = new Date(old); s.setDate(s.getDate() + 1);
  const e = new Date(s); e.setMonth(e.getMonth() + n); e.setDate(e.getDate() - 1);
  u.start = ymd(s); u.end = ymd(e); const r = Number(($('fxR_rent') || {}).value); if (r > 0) u.rent = r;
  u.expiredNotified = false; u.status = 'OCCUPIED';
  try { persist(); } catch (_) {} FX.close(); T('ต่อสัญญาถึง ' + thDate(u.end));
  try { render(); } catch (_) { FX.refresh(); }
};
FX.addTool({ label: 'สัญญาใกล้หมด', icon: 'alarm-clock', view: 'expiring', action: "FX.show('expiring')", badge: () => FX.expiringCount() });
})();

/* ===================== 6) MONTHLY REVENUE REPORT ===================== */
(function () {
const { $, E, B, T, icons, ymOf, thMonth, addMonths, units_, unitName, TH_M } = FX.u;
let endYm = ymOf(new Date()), selYm = null;
const occ = (u, ym) => (ym === ymOf(new Date()) && typeof isOccupiedIn === 'function') ? isOccupiedIn(u, ym) : FX.occIn(u, ym);
FX.revOcc = occ;
function series(end) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
  const us = units_();
  return months.map(ym => { const o = us.filter(u => occ(u, ym)); return { ym, rev: o.reduce((s, u) => s + Number(u.rent || 0), 0), occ: o.length, total: us.length, pct: us.length ? Math.round(o.length / us.length * 100) : 0 }; });
}
FX.revenueSeries = series;
function chart(data, sel) {
  const W = 360, H = 170, P = 22, max = Math.max(...data.map(d => d.rev), 1), bw = (W - P) / data.length;
  const bars = data.map((d, i) => { const h = Math.round(d.rev / max * (H - 40)); const x = P + i * bw + 3; return `<g onclick="FX.revSel('${d.ym}')" style="cursor:pointer"><rect x="${x}" y="${H - 20 - h}" width="${bw - 6}" height="${Math.max(h, 1)}" rx="4" fill="${d.ym === sel ? '#b85c38' : '#f0c4a8'}"><title>${thMonth(d.ym)}: ${B(d.rev)}</title></rect><text x="${x + (bw - 6) / 2}" y="${H - 6}" font-size="8" text-anchor="middle" fill="#8a8078">${TH_M[Number(d.ym.slice(5)) - 1]}</text></g>`; }).join('');
  const pts = data.map((d, i) => `${P + i * bw + bw / 2},${H - 20 - d.pct / 100 * (H - 40)}`).join(' ');
  const grid = [0, 0.5, 1].map(f => `<line x1="${P}" x2="${W}" y1="${H - 20 - f * (H - 40)}" y2="${H - 20 - f * (H - 40)}" stroke="#f1eeea"/><text x="0" y="${H - 17 - f * (H - 40)}" font-size="7" fill="#8a8078">${Math.round(max * f / 1000)}K</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="กราฟรายได้ 12 เดือน">${grid}${bars}<polyline points="${pts}" fill="none" stroke="#1c1917" stroke-width="1.2" stroke-dasharray="3 2"/>${data.map((d, i) => `<circle cx="${P + i * bw + bw / 2}" cy="${H - 20 - d.pct / 100 * (H - 40)}" r="1.8" fill="#1c1917"/>`).join('')}</svg>`;
}
FX.registerView('revenue', { title: 'รายงานรายได้', render() {
  const data = series(endYm); const sel = selYm && data.some(d => d.ym === selYm) ? selYm : endYm;
  const cur = data.find(d => d.ym === sel), prev = data[data.indexOf(cur) - 1];
  const diff = prev && prev.rev ? Math.round((cur.rev - prev.rev) / prev.rev * 1000) / 10 : null;
  const year = data.reduce((s, d) => s + d.rev, 0);
  const by = {}; units_().forEach(u => { const p = u.project || '(ไม่ระบุ)'; by[p] = by[p] || { rev: 0, occ: 0, n: 0 }; by[p].n++; if (occ(u, sel)) { by[p].rev += Number(u.rent || 0); by[p].occ++; } });
  const projs = Object.entries(by).sort((a, b) => b[1].rev - a[1].rev); const pmax = Math.max(...projs.map(p => p[1].rev), 1);
  if (!units_().length) return (typeof emptyStateHTML === 'function' ? '<div class="mt-4">' + emptyStateHTML('bar-chart-3', 'ยังไม่มีข้อมูลรายได้', 'เพิ่มห้องและติ๊กมีผู้เช่ารายเดือน เพื่อดูรายงาน', 'เพิ่มห้อง', "openSheet('add')") + '</div>' : '');
  return `<div class="flex items-center justify-between mb-4 gap-2"><p class="text-xs text-slate-400">12 เดือน ถึง ${thMonth(endYm)}</p><div class="flex items-center gap-1"><button onclick="FX.revNav(-12)" class="w-8 h-8 rounded-full bg-white border border-slate-700 flex items-center justify-center" aria-label="ก่อนหน้า"><i data-lucide="chevron-left" class="w-4 h-4"></i></button><button onclick="FX.revNav(12)" class="w-8 h-8 rounded-full bg-white border border-slate-700 flex items-center justify-center" aria-label="ถัดไป"><i data-lucide="chevron-right" class="w-4 h-4"></i></button><button onclick="FX.revExcel()" class="text-xs bg-white border border-slate-700 px-3 py-2 rounded-full flex items-center gap-1 font-semibold"><i data-lucide="download" class="w-3.5 h-3.5"></i>Excel</button></div></div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
  <div class="space-y-3"><div class="bg-gradient-to-br from-brick-500 to-brick-700 rounded-2xl p-4 text-white shadow-lg shadow-brick-500/25"><p class="text-[11px] text-white/80">รายได้ ${thMonth(sel)}</p><p class="text-3xl font-bold">${B(cur.rev)}</p><p class="text-xs text-white/80 mt-1">${diff === null ? '' : (diff >= 0 ? '▲ ' : '▼ ') + Math.abs(diff) + '% จากเดือนก่อน · '}เข้าพัก ${cur.occ}/${cur.total} ห้อง (${cur.pct}%) · 12 เดือน ${B(year)}</p></div>
  <div class="bg-white border border-slate-700 rounded-2xl p-4 shadow-sm"><h3 class="text-sm font-semibold mb-2">รายได้และอัตราเข้าพัก</h3>${chart(data, sel)}<div class="flex gap-3 mt-2 text-[10px] text-slate-400"><span class="flex items-center gap-1"><span class="w-3 h-2 rounded bg-brick-200"></span>รายได้ (แตะแท่งเพื่อเลือกเดือน)</span><span class="flex items-center gap-1"><span class="w-3 border-t border-dashed border-ink"></span>อัตราเข้าพัก</span></div></div></div>
  <div class="bg-white border border-slate-700 rounded-2xl p-4 shadow-sm space-y-3"><h3 class="text-sm font-semibold">แยกตามโครงการ (${thMonth(sel)})</h3>${projs.map(([n, d]) => `<button onclick="gotoProject(${E(JSON.stringify(n))})" class="w-full text-left"><div class="flex justify-between text-xs mb-1 gap-2"><span class="font-medium truncate">${E(n)}</span><span class="font-bold text-brick-600 shrink-0">${B(d.rev)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(d.rev / pmax * 100)}%"></div></div><p class="text-[10px] text-slate-400 mt-1">${d.occ}/${d.n} ห้องมีผู้เช่า</p></button>`).join('')}
  <p class="text-[10px] text-slate-400 pt-1">คำนวณจากการติ๊ก "มีผู้เช่า" รายเดือนบนแดชบอร์ด ถ้าเดือนไหนไม่ได้ติ๊ก จะใช้วันเริ่ม/สิ้นสุดสัญญา</p></div></div>${FX.commHTML ? FX.commHTML(sel) : ''}`;
} });
FX.revSel = ym => { selYm = ym; FX.refresh(); };
FX.revNav = n => { endYm = addMonths(endYm, n); if (endYm > addMonths(ymOf(new Date()), 12)) endYm = addMonths(ymOf(new Date()), 12); selYm = null; FX.refresh(); };
FX.revExcel = function () {
  if (typeof XLSX === 'undefined') return T('กำลังโหลดตัวสร้าง Excel ลองอีกครั้ง');
  const data = series(endYm), us = units_();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['เดือน', 'รายได้ (บาท)', 'ห้องมีผู้เช่า', 'ห้องทั้งหมด', 'อัตราเข้าพัก %'], ...data.map(d => [thMonth(d.ym), d.rev, d.occ, d.total, d.pct])]), 'รายเดือน');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['โครงการ', 'ห้อง', 'ค่าเช่า', ...data.map(d => thMonth(d.ym))], ...us.map(u => [u.project || '', u.room || '', Number(u.rent) || 0, ...data.map(d => occ(u, d.ym) ? Number(u.rent) || 0 : 0)])]), 'รายห้อง');
  const by = {}; us.forEach(u => { const p = u.project || '(ไม่ระบุ)'; by[p] = by[p] || data.map(() => 0); data.forEach((d, i) => { if (occ(u, d.ym)) by[p][i] += Number(u.rent) || 0; }); });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['โครงการ', ...data.map(d => thMonth(d.ym)), 'รวม'], ...Object.entries(by).map(([p, a]) => [p, ...a, a.reduce((s, x) => s + x, 0)])]), 'รายโครงการ');
  if (FX.commRows) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['เดือน', 'ห้อง', 'ผู้ปิด', 'สถานะ', 'ค่าคอม (บาท)', 'หมายเหตุ'], ...FX.commRows()]), 'ค่าคอม');
  XLSX.writeFile(wb, `max-agent-revenue-${endYm}.xlsx`); T('ส่งออก Excel แล้ว');
};
FX.addTool({ label: 'รายงานรายได้', icon: 'bar-chart-3', view: 'revenue', action: "FX.show('revenue')" });
})();

/* ===================== 7) RENT INVOICES + PROMPTPAY ===================== */
(function () {
const { $, E, B, T, ls, icons, pad, ymd, ymOf, thDate, thMonth, addMonths, units_, custs_, unitName, cfg } = FX.u;
const KEY = 'staylow_invoices_v1', CKEY = 'staylow_invoice_cfg_v1';
let inv = ls.get(KEY, {}); if (!inv || typeof inv !== 'object' || Array.isArray(inv)) inv = {};
let icfg = { ppId: '', ppName: '', dueDay: 5, ...ls.get(CKEY, {}) };
const save = () => ls.set(KEY, inv), saveC = () => ls.set(CKEY, icfg);
FX.addBackup('invoices', () => inv, v => { if (!v || typeof v !== 'object') return; Object.entries(v).forEach(([ym, m]) => { inv[ym] = { ...(inv[ym] || {}), ...m }; }); save(); });
FX.addBackup('invoiceCfg', () => icfg, v => { if (v && typeof v === 'object') { icfg = { ...icfg, ...v }; saveC(); } });
(FX.reloaders = FX.reloaders || []).push(() => { inv = ls.get(KEY, {}); if (!inv || typeof inv !== 'object' || Array.isArray(inv)) inv = {}; icfg = { ppId: '', ppName: '', dueDay: 5, ...ls.get(CKEY, {}) }; });
let ym = ymOf(new Date());
/* ---- PromptPay (EMVCo) ---- */
const tlv = (id, v) => id + pad(v.length) + v;
function crc16(s) { let c = 0xFFFF; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, '0'); }
function ppTarget(id) {
  const d = String(id || '').replace(/[^0-9]/g, '');
  if (d.length === 10 && d[0] === '0') return tlv('01', ('0066' + d.slice(1)).padStart(13, '0'));
  if (d.length === 13) return tlv('02', d);
  if (d.length === 15) return tlv('03', d);
  return null;
}
FX.promptPayPayload = function (id, amount) {
  const t = ppTarget(id); if (!t) return null;
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('29', tlv('00', 'A000000677010111') + t) + tlv('58', 'TH') + tlv('53', '764');
  if (amount) s += tlv('54', Number(amount).toFixed(2));
  s += '6304'; return s + crc16(s);
};
let qrLib = null;
function loadQr() { if (window.qrcode) return Promise.resolve(window.qrcode); if (qrLib) return qrLib; qrLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/qrcode.js?v=1'; sc.onload = () => res(window.qrcode); sc.onerror = rej; document.head.appendChild(sc); }); return qrLib; }
async function qrSvg(text, cell) { const q = (await loadQr())(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true }); }
/* ---- model ---- */
const dueDate = m => { const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); return `${m}-${pad(Math.min(Number(icfg.dueDay) || 5, last))}`; };
const tenantOf = u => custs_().find(c => (c.linkedUnits || []).includes(u.id) && c.status === 'WON') || null;
const rec = (m, id) => (inv[m] && inv[m][id]) || null;
const ensure = (m, u) => { inv[m] = inv[m] || {}; if (!inv[m][u.id]) inv[m][u.id] = { status: 'pending', water: 0, elec: 0, other: 0, no: `INV-${Number(m.slice(0, 4)) + 543}-${m.slice(5)}-${String(Object.keys(inv[m]).length + 1).padStart(3, '0')}` }; return inv[m][u.id]; };
const total = (u, r) => Number(u.rent || 0) + Number(r && r.water || 0) + Number(r && r.elec || 0) + Number(r && r.other || 0);
function statusOf(m, u) { const r = rec(m, u.id); if (r && r.status === 'paid') return 'paid'; return ymd(new Date()) > dueDate(m) ? 'overdue' : 'pending'; }
const ST = { paid: ['ชำระแล้ว', 'bg-emerald-500/10 text-emerald-700'], pending: ['รอชำระ', 'bg-amber-500/10 text-amber-700'], overdue: ['เกินกำหนด', 'bg-rose-500/10 text-rose-600'] };
const billed = m => units_().filter(u => FX.revOcc ? FX.revOcc(u, m) : FX.occIn(u, m));
FX.invoiceAlerts = () => { const m = ymOf(new Date()); const today = ymd(new Date()); const soon = ymd(new Date(Date.now() + 3 * 864e5)); return billed(m).filter(u => statusOf(m, u) === 'overdue' || (statusOf(m, u) === 'pending' && dueDate(m) <= soon && dueDate(m) >= today)).length; };
FX.registerView('invoices', { title: 'แจ้งหนี้ค่าเช่า', render() {
  const list = billed(ym); const sum = { paid: 0, pending: 0, overdue: 0 };
  list.forEach(u => { sum[statusOf(ym, u)] += total(u, rec(ym, u.id)); });
  const unpaid = list.filter(u => statusOf(ym, u) !== 'paid');
  const row = u => { const st = statusOf(ym, u), r = rec(ym, u.id), t = tenantOf(u);
    return `<button onclick="FX.openInvoice('${u.id}')" class="w-full text-left flex items-center gap-3 py-2.5 border-b border-slate-800 last:border-0"><div class="w-9 h-9 rounded-xl bg-brick-500/10 flex items-center justify-center shrink-0"><i data-lucide="receipt" class="w-4 h-4 text-brick-600"></i></div><div class="flex-1 min-w-0"><p class="text-xs font-semibold truncate">${E(unitName(u))}</p><p class="text-[10px] text-slate-400 truncate">${t ? E(t.name) + ' · ' : ''}ครบกำหนด ${thDate(dueDate(ym))}${r && r.paidAt ? ' · จ่าย ' + thDate(r.paidAt) : ''}</p></div><div class="text-right shrink-0"><p class="text-xs font-bold">${B(total(u, r))}</p><span class="text-[10px] px-2 py-0.5 rounded-full ${ST[st][1]}">${ST[st][0]}</span></div></button>`; };
  return `<div class="flex items-center justify-between mb-4"><p class="text-xs text-slate-400">รอบบิล ${thMonth(ym)} · ครบกำหนดทุกวันที่ ${icfg.dueDay}</p><div class="flex items-center gap-1"><button onclick="FX.invNav(-1)" class="w-8 h-8 rounded-full bg-white border border-slate-700 flex items-center justify-center" aria-label="เดือนก่อน"><i data-lucide="chevron-left" class="w-4 h-4"></i></button><button onclick="FX.invNav(1)" class="w-8 h-8 rounded-full bg-white border border-slate-700 flex items-center justify-center" aria-label="เดือนถัดไป"><i data-lucide="chevron-right" class="w-4 h-4"></i></button></div></div>
  <div class="grid grid-cols-3 gap-2 text-center mb-3">${['paid', 'pending', 'overdue'].map(k => `<div class="bg-white border border-slate-700 rounded-2xl p-3 shadow-sm"><p class="text-[10px] text-slate-400">${ST[k][0]}</p><p class="text-sm lg:text-base font-bold ${k === 'paid' ? 'text-emerald-600' : k === 'pending' ? 'text-amber-600' : 'text-rose-600'}">${B(sum[k])}</p></div>`).join('')}</div>
  <button onclick="FX.invSettings()" class="w-full bg-white border border-slate-700 rounded-2xl p-3 shadow-sm flex items-center gap-3 mb-3 text-left"><div class="w-9 h-9 rounded-xl bg-brick-500 text-white flex items-center justify-center shrink-0"><i data-lucide="qr-code" class="w-4 h-4"></i></div><div class="flex-1 min-w-0"><p class="text-xs font-semibold">PromptPay ${icfg.ppId ? E(icfg.ppId) : '— ยังไม่ได้ตั้งค่า'}</p><p class="text-[10px] text-slate-400">${icfg.ppId ? 'QR ในใบแจ้งหนี้ใส่ยอดเงินให้อัตโนมัติ' : 'ตั้งค่าเบอร์/เลขบัตรประชาชนสำหรับรับเงิน'} · แตะเพื่อแก้ไข</p></div><i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i></button>
  ${list.length ? `<div class="bg-white border border-slate-700 rounded-2xl px-4 py-1 shadow-sm">${list.map(row).join('')}</div>${unpaid.length ? `<button onclick="FX.remindAll()" class="w-full mt-3 py-2.5 rounded-full text-white text-xs font-semibold flex items-center justify-center gap-1.5" style="background:#06C755"><i data-lucide="send" class="w-3.5 h-3.5"></i>ส่งเตือนห้องที่ยังไม่ชำระ (${unpaid.length}) ทาง LINE</button>` : ''}` : (typeof emptyStateHTML === 'function' ? emptyStateHTML('receipt', 'ไม่มีห้องที่ต้องออกบิลเดือนนี้', 'ห้องที่มีผู้เช่าในเดือนนี้จะแสดงที่นี่ (ติ๊กมีผู้เช่ารายเดือนบนแดชบอร์ดหรือใส่วันสัญญา)', '', '') : '')}
  <p class="text-[10px] text-slate-400 mt-3">แอปนี้ไม่มีเซิร์ฟเวอร์ จึงส่งบิลอัตโนมัติไม่ได้ ใช้ปุ่ม LINE เพื่อส่งเอง และดูการเตือนครบกำหนดที่ไอคอนเครื่องมือบนแดชบอร์ด</p>`;
} });
FX.invNav = n => { ym = addMonths(ym, n); FX.refresh(); };
FX.invSettings = function () {
  FX.open(FX.sheetHead('ตั้งค่ารับชำระ', 'ใช้สร้าง QR PromptPay ในใบแจ้งหนี้') + `<div class="space-y-3 text-[11px] text-slate-500">
    <label class="block">PromptPay (เบอร์มือถือ / เลขบัตรประชาชน / เลขผู้เสียภาษี)<input id="fxI_pp" class="inp" inputmode="numeric" placeholder="0812345678" value="${E(icfg.ppId)}"></label>
    <label class="block">ชื่อบัญชี (แสดงในใบแจ้งหนี้)<input id="fxI_nm" class="inp" placeholder="เช่น นาย แม็กซ์ ใจดี" value="${E(icfg.ppName)}"></label>
    <label class="block">ครบกำหนดชำระทุกวันที่<input id="fxI_due" type="number" min="1" max="31" class="inp" value="${E(icfg.dueDay)}"></label></div>
    <div class="grid grid-cols-2 gap-2 mt-5"><button onclick="FX.close()" class="py-2.5 rounded-full bg-slate-100 text-slate-600 text-sm font-semibold">ยกเลิก</button><button onclick="FX.saveInvSettings()" class="py-2.5 rounded-full bg-brick-500 text-white text-sm font-semibold">บันทึก</button></div>`);
};
FX.saveInvSettings = function () {
  const pp = ($('fxI_pp').value || '').trim();
  if (pp && !ppTarget(pp)) return T('PromptPay ต้องเป็นเบอร์ 10 หลัก หรือเลข 13 หลัก');
  icfg.ppId = pp; icfg.ppName = $('fxI_nm').value.trim(); icfg.dueDay = Math.min(31, Math.max(1, Number($('fxI_due').value) || 5));
  saveC(); FX.close(); FX.refresh(); FX.injectTools(); T('บันทึกแล้ว');
};
let curInv = { id: null, tab: 'invoice' };
function docHTML(u, r, tab, qr) {
  const t = tenantOf(u), st = statusOf(ym, u), c = cfg(), tot = total(u, r);
  const line = (l, v) => `<div class="flex justify-between py-2"><span>${l}</span><span>${B(v)}</span></div>`;
  return `<div class="border border-slate-700 rounded-2xl p-4 bg-white"><div class="flex justify-between items-start gap-2"><div><p class="text-[10px] font-bold tracking-widest text-brick-600">${E((c.agentName || 'MAX') + ' AGENT').toUpperCase()}</p><p class="text-base font-bold">${tab === 'receipt' ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้ค่าเช่า'}</p><p class="text-[10px] text-slate-400">เลขที่ ${E(tab === 'receipt' ? r.no.replace('INV', 'RC') : r.no)} · ${tab === 'receipt' && r.paidAt ? 'รับเงิน ' + thDate(r.paidAt) : 'ออก ' + thDate(ymd(new Date()))}</p></div><span class="text-[10px] px-2 py-0.5 rounded-full ${ST[st][1]} shrink-0">${ST[st][0]}</span></div>
  <div class="mt-3 text-[11px] text-slate-400 space-y-0.5"><p>ผู้เช่า: <span class="text-ink font-medium">${E(t ? t.name : '-')}</span></p><p>ห้อง: <span class="text-ink font-medium">${E(unitName(u))}</span></p><p>รอบบิล: <span class="text-ink font-medium">${thMonth(ym)}</span> · ครบกำหนด <span class="text-ink font-medium">${thDate(dueDate(ym))}</span></p></div>
  <div class="mt-3 text-xs divide-y divide-slate-800 border-y border-slate-800">${line('ค่าเช่า ' + thMonth(ym), u.rent)}${Number(r.water) ? line('ค่าน้ำ', r.water) : ''}${Number(r.elec) ? line('ค่าไฟ', r.elec) : ''}${Number(r.other) ? line('อื่นๆ', r.other) : ''}</div>
  <div class="flex justify-between py-2 text-sm font-bold"><span>รวมทั้งสิ้น</span><span class="text-brick-600">${B(tot)}</span></div>
  ${tab === 'receipt' ? `<div class="mt-2 rounded-xl border-2 border-emerald-500 text-emerald-700 text-center py-2 text-sm font-bold">${st === 'paid' ? 'ได้รับชำระเรียบร้อยแล้ว' : 'ยังไม่ได้รับชำระ'}</div>` : (qr ? `<div class="flex items-center gap-3 mt-2 bg-slate-950 rounded-xl p-3"><div class="bg-white p-1 rounded-lg w-28 h-28 shrink-0">${qr}</div><div class="text-[11px]"><p class="font-semibold" style="color:#003d6a">PromptPay</p><p class="text-slate-400">สแกนจ่าย ${B(tot)}</p>${icfg.ppName ? `<p class="text-slate-400">ชื่อบัญชี: ${E(icfg.ppName)}</p>` : ''}<p class="text-slate-400">${E(icfg.ppId)}</p></div></div>` : `<p class="text-[11px] text-slate-400 mt-2">ตั้งค่า PromptPay เพื่อแสดง QR รับเงิน</p>`)}</div>`;
}
FX.openInvoice = async function (id, tab) {
  const u = units_().find(x => x.id === id); if (!u) return;
  const r = ensure(ym, u); save(); curInv = { id, tab: tab || (r.status === 'paid' ? 'receipt' : 'invoice') };
  const pl = icfg.ppId ? FX.promptPayPayload(icfg.ppId, total(u, r)) : null;
  let qr = ''; if (pl && curInv.tab === 'invoice') { try { qr = await qrSvg(pl); } catch (e) { qr = ''; } }
  const tb = (k, l) => `<button onclick="FX.openInvoice('${id}','${k}')" class="px-3 py-1.5 rounded-full ${curInv.tab === k ? 'bg-brick-500 text-white font-semibold' : 'bg-slate-100 text-slate-500'}">${l}</button>`;
  const numIn = (k, l) => `<label class="text-[11px] text-slate-500">${l}<input type="number" inputmode="decimal" class="inp" value="${Number(r[k]) || ''}" placeholder="0" onchange="FX.invSet('${id}','${k}',this.value)"></label>`;
  FX.open(FX.sheetHead(curInv.tab === 'receipt' ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้', E(unitName(u)) + ' · ' + thMonth(ym)) + `<div class="flex gap-1.5 text-[11px] mb-3">${tb('invoice', 'ใบแจ้งหนี้')}${tb('receipt', 'ใบเสร็จ')}</div>
    <div id="fxInvDoc">${docHTML(u, r, curInv.tab, qr)}</div>
    ${r.status !== 'paid' ? `<div class="grid grid-cols-3 gap-2 mt-3">${numIn('water', 'ค่าน้ำ')}${numIn('elec', 'ค่าไฟ')}${numIn('other', 'อื่นๆ')}</div>` : ''}
    <div class="grid grid-cols-3 gap-2 mt-4"><button onclick="FX.invLine('${id}')" class="py-2.5 rounded-full text-white text-xs font-semibold flex items-center justify-center gap-1" style="background:#06C755"><i data-lucide="send" class="w-3.5 h-3.5"></i>LINE</button><button onclick="FX.invPrint()" class="py-2.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold flex items-center justify-center gap-1"><i data-lucide="printer" class="w-3.5 h-3.5"></i>PDF/พิมพ์</button>${r.status === 'paid' ? `<button onclick="FX.invPaid('${id}',false)" class="py-2.5 rounded-full bg-white border border-slate-700 text-xs font-semibold">ยกเลิกชำระ</button>` : `<button onclick="FX.invPaid('${id}',true)" class="py-2.5 rounded-full bg-brick-500 text-white text-xs font-semibold flex items-center justify-center gap-1"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i>รับชำระ</button>`}</div>`);
};
FX.invSet = (id, k, v) => { const u = units_().find(x => x.id === id); if (!u) return; ensure(ym, u)[k] = Math.max(0, Number(v) || 0); save(); FX.openInvoice(id, curInv.tab); FX.refresh(); };
FX.invPaid = (id, paid) => { const u = units_().find(x => x.id === id); if (!u) return; const r = ensure(ym, u); r.status = paid ? 'paid' : 'pending'; r.paidAt = paid ? ymd(new Date()) : ''; save(); T(paid ? 'บันทึกรับชำระแล้ว' : 'ยกเลิกการชำระแล้ว'); FX.openInvoice(id, paid ? 'receipt' : 'invoice'); FX.refresh(); FX.injectTools(); };
function lineText(u) { const r = ensure(ym, u), t = tenantOf(u), c = cfg(), st = statusOf(ym, u);
  return `${st === 'paid' ? '🧾 ใบเสร็จค่าเช่า' : '📄 แจ้งค่าเช่า'} ${thMonth(ym)}\n${t ? 'คุณ' + t.name.replace(/^คุณ/, '') + '\n' : ''}🏢 ${unitName(u)}\nค่าเช่า ${B(u.rent)}${Number(r.water) ? '\nค่าน้ำ ' + B(r.water) : ''}${Number(r.elec) ? '\nค่าไฟ ' + B(r.elec) : ''}${Number(r.other) ? '\nอื่นๆ ' + B(r.other) : ''}\nรวม ${B(total(u, r))}\n${st === 'paid' ? '✅ ได้รับชำระแล้ว ' + thDate(r.paidAt) + ' ขอบคุณค่ะ' : '📅 ครบกำหนด ' + thDate(dueDate(ym)) + (icfg.ppId ? `\n💳 PromptPay ${icfg.ppId}${icfg.ppName ? ' (' + icfg.ppName + ')' : ''}` : '') + (st === 'overdue' ? '\n⚠️ เลยกำหนดชำระแล้ว รบกวนชำระด้วยค่ะ' : '')}\n— ${c.agentName || ''}${c.phone ? ' ' + c.phone : ''}`; }
FX.invLine = id => { const u = units_().find(x => x.id === id); if (u) { save(); FX.lineShare(lineText(u)); } };
FX.remindAll = () => { const list = billed(ym).filter(u => statusOf(ym, u) !== 'paid'); if (!list.length) return; FX.lineShare(list.map(lineText).join('\n\n———\n\n')); };
const loadJs = src => new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
async function invoicePdf() {
  const doc = $('fxInvDoc'); if (!doc) throw new Error('no doc');
  if (!window.html2canvas) await loadJs('vendor/html2canvas.min.js?v=1');
  if (!window.jspdf) await loadJs('vendor/jspdf.umd.min.js?v=1');
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:560px;padding:24px;background:#fff;font-family:Poppins,"Noto Sans Thai",sans-serif';
  box.innerHTML = doc.innerHTML;
  box.querySelectorAll('svg').forEach(svg => { svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', '600'); svg.setAttribute('height', '600'); svg.removeAttribute('style'); const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)); img.style.cssText = 'width:100%;height:100%'; svg.replaceWith(img); });
  document.body.appendChild(box);
  try {
    await Promise.all([...box.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    const cv = await window.html2canvas(box, { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' });
    const W = 148 - 16, H = W * cv.height / cv.width;
    pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 8, 8, W, Math.min(H, 210 - 16));
    return pdf.output('blob');
  } finally { box.remove(); }
}
FX.invoicePdf = invoicePdf;
let readyPdf = null;
FX.sharePdf = async function () {
  if (!readyPdf) return;
  const f = readyPdf;
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: f.name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); T('ดาวน์โหลด PDF แล้ว');
};
const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
FX.invPrint = async function (mode) {
  const doc = $('fxInvDoc'); if (!doc) return;
  if (mode !== 'pdf' && !isMobile()) {
    let p = $('fxPrint'); if (!p) { document.body.insertAdjacentHTML('beforeend', '<div id="fxPrint"></div>'); p = $('fxPrint'); }
    p.innerHTML = doc.innerHTML; document.body.classList.add('fx-printing');
    const done = () => { document.body.classList.remove('fx-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 1500); return;
  }
  T('กำลังสร้าง PDF...');
  let blob; try { blob = await invoicePdf(); } catch (e) { console.error(e); return T('สร้าง PDF ไม่สำเร็จ'); }
  const no = (doc.textContent.match(/เลขที่\s*(\S+)/) || [])[1] || 'invoice';
  readyPdf = new File([blob], no.replace(/[^\w-]/g, '_') + '.pdf', { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [readyPdf] })) {
    try { await navigator.share({ files: [readyPdf], title: readyPdf.name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
    // iOS may block share after async work (no user gesture) — offer a one-tap button
    const btn = $('fxPdfReady') || (doc.insertAdjacentHTML('afterend', '<button id="fxPdfReady" onclick="FX.sharePdf()" class="w-full mt-3 py-3 rounded-full bg-brick-500 text-white text-xs font-semibold">PDF พร้อมแล้ว · แตะเพื่อบันทึก/แชร์</button>'), $('fxPdfReady'));
    return;
  }
  FX.sharePdf();
};
if (!$('fxPrintCss')) document.head.insertAdjacentHTML('beforeend', `<style id="fxPrintCss">#fxPrint{display:none}@media print{body.fx-printing>*:not(#fxPrint){display:none!important}body.fx-printing #fxPrint{display:block!important;max-width:520px;margin:0 auto;padding:16px}body.fx-printing{background:#fff!important}#fxPrint svg{width:112px;height:112px}}</style>`);
/* rent-invoice tile + reminder toast removed (v32); data kept & still synced */
})();

/* ---------- boot ---------- */
try { FX.injectTools(); } catch (e) {}

/* ===================== PUBLIC AVAILABLE-ROOMS CATALOG (/a/<id>/) ===================== */
(function () {
const { $, E, T, cfg, units_ } = FX.u;
const CK = 'max_catalog';
const getC = () => { try { return JSON.parse(localStorage.getItem(CK) || 'null'); } catch (e) { return null; } };
const setC = v => { try { localStorage.setItem(CK, JSON.stringify(v)); } catch (e) {} };
FX.addBackup('catalog', getC, v => { if (v && v.id && v.secret) setC(v); });
const SITE = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const avail = () => units_().filter(u => u.status === 'AVAILABLE');
const linkOf = c => SITE() + 'a/' + c.id + '/';
const sigOf = () => JSON.stringify(avail().map(u => [u.id, u.share && u.share.id, u.rent, u.salePrice, u.project, u.type, u.size, u.bath, u.floor, u.station, u.stationDist])) + '|' + JSON.stringify([cfg().agentName, cfg().phone, cfg().lineId]);
async function avatarThumb() {
  try { const src = localStorage.getItem(typeof AVATAR_KEY !== 'undefined' ? AVATAR_KEY : 'staylow_avatar'); if (!src) return '';
    const img = new Image(); img.src = src; await img.decode(); const c = document.createElement('canvas'); c.width = c.height = 160;
    const s = Math.min(img.width, img.height); c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160); return c.toDataURL('image/jpeg', 0.8);
  } catch (e) { return ''; }
}
let busy = false;
async function publish(progress) {
  if (busy) return null; busy = true;
  const say = t => { if (progress) progress(t); };
  try {
    if (!navigator.onLine) throw new Error('ไม่มีอินเทอร์เน็ต');
    const list = avail(); const rooms = [];
    let so = {}; try { so = JSON.parse(localStorage.getItem('max_share_opts') || '{}'); } catch (e) {}
    FX.noWait = true;
    for (let i = 0; i < list.length; i++) {
      const u = list[i]; say(`เตรียมลิงก์ห้อง ${i + 1}/${list.length}...`);
      if (!(u.share && u.share.id)) { try { await FX.buildRoomLink(u, { photo: true, hideRoom: true, showPhone: so.showPhone !== false }); } catch (e) { console.warn('room link failed', u.id, e); continue; } }
      if (!(u.share && u.share.id)) continue;
      if (u.share.cover === undefined) { try { const r = await fetch(`${FX.sb.url}/functions/v1/share-room?id=${u.share.id}`, { headers: FX.sb.h }); const j = await r.json(); u.share.cover = (j.data && j.data.imgs && j.data.imgs[0]) || ''; } catch (e) {} }
      rooms.push({ id: u.share.id, p: u.project || '', b: u.building || '', t: u.type || '', sz: Number(u.size) || 0, bt: u.bath || '', f: u.floor || '', vw: u.view || '', rent: Number(u.rent) || 0, sale: Number(u.salePrice) || 0, cover: u.share.cover || '' });
    }
    try { window.persist(); } catch (e) {}
    say('กำลังเผยแพร่หน้าห้องว่าง...');
    const c = getC(); const c2 = cfg();
    const secret = c && c.secret || Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    const body = { action: 'catalog', id: c && c.id || '', secret, agent: { n: c2.agentName || '', l: c2.lineId || '', ph: c2.phone || '', av: await avatarThumb() }, rooms };
    const r = await fetch(`${FX.sb.url}/functions/v1/share-room`, { method: 'POST', headers: { ...FX.sb.h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(r.status === 429 ? 'อัปเดตถี่เกินไป รอสักครู่' : r.status === 403 ? 'แก้หน้านี้จากเครื่องนี้ไม่ได้' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (' + r.status + ')');
    const nc = { id: j.id, secret, sig: sigOf(), at: Date.now(), count: j.count, first: !(c && c.id) };
    setC(nc); return nc;
  } finally { FX.noWait = false; busy = false; }
}
FX.publishCatalog = publish;
function sheet(msg) {
  const c = getC(); const n = avail().length;
  FX.open(FX.sheetHead('หน้าห้องว่างของฉัน', 'หน้าเว็บสาธารณะแสดงเฉพาะห้องที่ "ว่าง" · ไม่แสดงเลขห้อง ข้อมูลเจ้าของ และโน้ตภายใน') + `<div id="fxCat">
    <div class="bg-white border border-slate-700 rounded-2xl p-3 mb-3"><p class="text-[11px] text-slate-500">ลิงก์ถาวร</p><p class="text-xs font-semibold break-all ${c ? 'text-brick-600' : 'text-slate-400'}">${c ? E(linkOf(c)) : 'ยังไม่ได้สร้าง'}</p>
    <p id="fxCatMsg" class="text-[10px] text-slate-400 mt-1">${E(msg || (c ? `แสดงอยู่ ${c.count ?? '-'} ห้อง · อัปเดตล่าสุด ${new Date(c.at).toLocaleString('th-TH')}` : `ห้องว่างตอนนี้ ${n} ห้อง`))}</p></div>
    <button onclick="FX.catPublish()" class="w-full py-3 rounded-full bg-brick-500 text-white text-sm font-semibold flex items-center justify-center gap-2"><i data-lucide="refresh-cw" class="w-4 h-4"></i>อัปเดตหน้าห้องว่าง</button>
    ${c ? `<div class="grid grid-cols-3 gap-2 mt-2"><button onclick="FX.lineShare('ห้องว่างพร้อมเข้าอยู่ ดูรูปและราคาได้ที่นี่ 👉 ' + '${linkOf(c)}')" class="py-2.5 rounded-full text-white text-xs font-semibold" style="background:#06C755">LINE</button><button onclick="FX.copy('${linkOf(c)}')" class="py-2.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">คัดลอก</button><button onclick="window.open('${linkOf(c)}','_blank')" class="py-2.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">เปิดดู</button></div>` : ''}
    <p class="text-[10px] text-slate-400 mt-3">อัปเดตอัตโนมัติเมื่อสถานะห้องเปลี่ยน (เมื่อออนไลน์) · ห้องที่ไม่ว่างจะหายจากหน้าเอง</p></div>`);
}
FX.openCatalog = () => sheet();
FX.catPublish = async function () {
  const m = () => $('fxCatMsg');
  try { const c = await publish(t => { if (m()) m().textContent = t; }); if (c) { sheet(`อัปเดตแล้ว · แสดง ${c.count} ห้อง${c.first ? ' · พรีวิว LINE พร้อมในประมาณ 1 นาที' : ''}`); T('อัปเดตหน้าห้องว่างแล้ว'); } }
  catch (e) { if (m()) m().innerHTML = `<span class="text-rose-600 font-semibold">${E(e.message)}</span>`; }
};
// auto-update when the set of available rooms changes
let timer = null;
const _p = window.persist;
if (_p) window.persist = function () { const r = _p.apply(this, arguments); const c = getC(); if (c && !busy && c.sig !== sigOf()) { clearTimeout(timer); timer = setTimeout(() => publish().catch(e => console.warn('catalog auto-update failed', e)), 4000); } return r; };
FX.addTool({ label: 'หน้าห้องว่าง', icon: 'store', action: 'FX.openCatalog()' });
})();

/* ===================== 8) COMMISSIONS (v32) ===================== */
(function () {
const { $, E, B, T, ls, ymOf, thMonth, units_, unitName } = FX.u;
const KEY = 'max_commissions_v1';
let comms = ls.get(KEY, []); if (!Array.isArray(comms)) comms = [];
const save = () => ls.set(KEY, comms);
const DEAL = ['RESERVED', 'OCCUPIED'];
const SL = { RESERVED: 'จอง', OCCUPIED: 'มีผู้เช่า' };
let snap = {};
const takeSnap = () => { snap = {}; units_().forEach(u => { snap[u.id] = u.status; }); };
(FX.reloaders = FX.reloaders || []).push(() => { comms = ls.get(KEY, []); if (!Array.isArray(comms)) comms = []; takeSnap(); });
FX.addBackup && FX.addBackup('commissions', () => comms, v => { if (!Array.isArray(v)) return; const ids = new Set(comms.map(c => c.id)); v.forEach(c => { if (c && c.id && !ids.has(c.id)) comms.push(c); }); save(); });
takeSnap();
const queue = [];
const _persist = window.persist;
if (typeof _persist === 'function') window.persist = function () {
  try {
    units_().forEach(u => {
      const prev = snap[u.id];
      if (DEAL.includes(u.status) && prev !== u.status && !(prev === 'RESERVED' && u.status === 'OCCUPIED' && comms.some(c => c.unitId === u.id && c.ym >= ymOf(new Date(Date.now() - 62 * 864e5))))) {
        if (!queue.some(q => q.id === u.id)) queue.push({ id: u.id, status: u.status });
      }
      snap[u.id] = u.status;
    });
    Object.keys(snap).forEach(id => { if (!units_().some(u => u.id === id)) delete snap[id]; });
  } catch (e) {}
  const r = _persist.apply(this, arguments);
  if (queue.length) setTimeout(next, 350);
  return r;
};
let cur = null;
function next() {
  if (cur || !queue.length) return;
  if ($('fxSheet') && $('fxSheet').classList.contains('open')) { setTimeout(next, 800); return; }
  cur = queue.shift(); askWho(cur.id, cur.status);
}
const rentOf = u => Number(u && u.rent) || 0;
const amt = (u, closer) => closer === 'self' ? rentOf(u) : Math.round(rentOf(u) * 0.5);
const btn = (on, l, sub) => `<button ${on} class="w-full text-left bg-white border border-slate-700 rounded-2xl p-3 flex items-center gap-3 active:scale-[.98]"><div class="flex-1"><p class="text-sm font-semibold">${l}</p>${sub ? `<p class="text-[11px] text-slate-400">${sub}</p>` : ''}</div><i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i></button>`;
function askWho(id, status) {
  const u = units_().find(x => x.id === id); if (!u) { cur = null; return next(); }
  FX.open(FX.sheetHead('🎉 ปิดดีลได้แล้ว?', E(unitName(u)) + ' · เปลี่ยนเป็น "' + SL[status] + '"') + `<p class="text-xs text-slate-500 mb-3">ใครเป็นคนปิดดีลห้องนี้? จะบันทึกค่าคอมเข้ารายงานรายได้</p><div class="space-y-2">
    ${btn(`onclick="FX.commForm('${id}','self','${status}')"`, 'ฉันปิดเอง', 'ค่าคอม 1 เดือน = ' + B(amt(u, 'self')))}
    ${btn(`onclick="FX.commForm('${id}','co','${status}')"`, 'คนอื่นปิด (co-agent)', 'แบ่ง 50% = ' + B(amt(u, 'co')))}
    <button onclick="FX.commSkip()" class="w-full py-3 rounded-full bg-slate-100 text-slate-500 text-sm font-semibold">ไม่มีค่าคอม / ข้าม</button></div>`);
}
FX.commSkip = () => { FX.close(); cur = null; setTimeout(next, 300); };
FX.commForm = function (unitId, closer, status, editId) {
  const ex = editId ? comms.find(c => c.id === editId) : null;
  const u = units_().find(x => x.id === (ex ? ex.unitId : unitId));
  if (ex) { closer = ex.closer; status = ex.status; }
  const rent = ex ? Number(ex.rent) || rentOf(u) : rentOf(u);
  const mode = ex ? (ex.mode || 'custom') : (closer === 'self' ? 'full' : 'half');
  const val = ex ? ex.amount : (mode === 'full' ? rent : Math.round(rent / 2));
  const rb = (m, l) => `<label class="flex items-center gap-2 text-sm py-1"><input type="radio" name="fxCm_mode" value="${m}" ${mode === m ? 'checked' : ''} onchange="FX.commMode(${rent})" class="accent-[#b85c38]"> ${l}</label>`;
  FX.open(FX.sheetHead(ex ? 'แก้ไขค่าคอม' : 'บันทึกค่าคอม', E(ex ? (ex.unitName || unitName(u)) : unitName(u)) + ' · ค่าเช่า ' + B(rent)) + `<div class="space-y-3">
    <div class="flex gap-1.5 text-xs"><button id="fxCm_self" onclick="FX.commCloser('self',${rent})" class="px-3 py-1.5 rounded-full ${closer === 'self' ? 'bg-brick-500 text-white font-semibold' : 'bg-slate-100 text-slate-500'}">ฉันปิดเอง</button><button id="fxCm_co" onclick="FX.commCloser('co',${rent})" class="px-3 py-1.5 rounded-full ${closer === 'co' ? 'bg-brick-500 text-white font-semibold' : 'bg-slate-100 text-slate-500'}">คนอื่นปิด (co-agent)</button></div>
    <input type="hidden" id="fxCm_closer" value="${closer}">
    <div class="bg-white border border-slate-700 rounded-2xl px-3 py-2">${rb('full', '1 เดือนของค่าเช่า (' + B(rent) + ')')}${rb('half', '50% ของค่าเช่า 1 เดือน (' + B(Math.round(rent / 2)) + ')')}${rb('custom', 'กำหนดเอง')}</div>
    <label class="block text-[11px] text-slate-500">จำนวนเงิน (บาท)<input id="fxCm_amt" type="number" inputmode="numeric" class="inp" value="${Number(val) || 0}" oninput="document.querySelector('input[name=fxCm_mode][value=custom]').checked=true"></label>
    <label class="block text-[11px] text-slate-500">นับเป็นรายได้เดือน<input id="fxCm_ym" type="month" class="inp" value="${ex ? ex.ym : ymOf(new Date())}"></label>
    <label class="block text-[11px] text-slate-500">หมายเหตุ (ไม่บังคับ)<input id="fxCm_note" class="inp" value="${E(ex ? ex.note || '' : '')}" placeholder="เช่น ชื่อ co-agent"></label>
    <button onclick="FX.commSave('${ex ? '' : unitId}','${status}','${editId || ''}')" class="w-full py-3 rounded-full bg-brick-500 text-white text-sm font-semibold">บันทึก</button>
    ${ex ? `<button onclick="FX.commDel('${editId}')" class="w-full py-3 rounded-full bg-slate-100 text-red-600 text-sm font-semibold">ลบรายการนี้</button>` : `<button onclick="FX.commSkip()" class="w-full py-2 text-slate-400 text-xs">ข้าม</button>`}</div>`);
};
FX.commMode = rent => { const m = (document.querySelector('input[name=fxCm_mode]:checked') || {}).value; if (m === 'full') $('fxCm_amt').value = rent; else if (m === 'half') $('fxCm_amt').value = Math.round(rent / 2); };
FX.commCloser = (c, rent) => { $('fxCm_closer').value = c; ['self', 'co'].forEach(k => { $('fxCm_' + k).className = 'px-3 py-1.5 rounded-full ' + (k === c ? 'bg-brick-500 text-white font-semibold' : 'bg-slate-100 text-slate-500'); }); const r = document.querySelector(`input[name=fxCm_mode][value=${c === 'self' ? 'full' : 'half'}]`); if (r) { r.checked = true; FX.commMode(rent); } };
FX.commSave = function (unitId, status, editId) {
  const amount = Math.max(0, Number($('fxCm_amt').value) || 0), ym = $('fxCm_ym').value || ymOf(new Date());
  const closer = $('fxCm_closer').value, mode = (document.querySelector('input[name=fxCm_mode]:checked') || {}).value || 'custom', note = $('fxCm_note').value.trim();
  if (editId) { const c = comms.find(x => x.id === editId); if (c) Object.assign(c, { amount, ym, closer, mode, note, updatedAt: Date.now() }); }
  else { const u = units_().find(x => x.id === unitId); comms.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5), unitId, unitName: unitName(u), rent: rentOf(u), status, closer, mode, amount, ym, note, createdAt: Date.now() }); }
  save(); FX.close(); T('✓ บันทึกค่าคอมแล้ว'); cur = null; FX.refresh(); setTimeout(next, 300);
};
FX.commDel = id => { if (!confirm('ลบรายการค่าคอมนี้?')) return; comms = comms.filter(c => c.id !== id); save(); FX.close(); T('ลบแล้ว'); FX.refresh(); };
FX.commEdit = id => FX.commForm(null, null, null, id);
FX.commAdd = function () {
  const us = units_().slice().sort((a, b) => (a.project || '').localeCompare(b.project || ''));
  FX.open(FX.sheetHead('เพิ่มค่าคอม', 'เลือกห้อง') + `<div class="space-y-1 max-h-[60vh] overflow-y-auto">${us.map(u => `<button onclick="FX.commAskAdd('${u.id}')" class="w-full text-left text-sm py-2 border-b border-slate-800">${E(unitName(u))} <span class="text-[11px] text-slate-400">${B(u.rent)}</span></button>`).join('') || '<p class="text-xs text-slate-400">ยังไม่มีห้อง</p>'}</div>`);
};
FX.commAskAdd = id => { const u = units_().find(x => x.id === id); askWho(id, u && DEAL.includes(u.status) ? u.status : 'OCCUPIED'); };
const CL = { self: 'ปิดเอง', co: 'co-agent' };
FX.commRows = () => comms.slice().sort((a, b) => a.ym.localeCompare(b.ym)).map(c => [thMonth(c.ym), c.unitName || '', CL[c.closer] || '', SL[c.status] || '', Number(c.amount) || 0, c.note || '']);
FX.commHTML = function (ym) {
  const list = comms.filter(c => c.ym === ym).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const sum = k => list.filter(c => !k || c.closer === k).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const yr = ym.slice(0, 4), ytd = comms.filter(c => c.ym.slice(0, 4) === yr && c.ym <= ym).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  return `<div class="bg-white border border-slate-700 rounded-2xl p-4 shadow-sm mt-3"><div class="flex items-center justify-between mb-2"><h3 class="text-sm font-semibold">ค่าคอมมิชชั่น ${thMonth(ym)}</h3><button onclick="FX.commAdd()" class="text-xs bg-brick-500 text-white px-3 py-1.5 rounded-full font-semibold flex items-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>เพิ่ม</button></div>
  <p class="text-2xl font-bold text-brick-600">${B(sum())}</p>
  <div class="grid grid-cols-2 gap-2 mt-2 text-xs"><div class="bg-slate-100 rounded-xl p-2"><p class="text-slate-500">ปิดเอง</p><p class="font-bold">${B(sum('self'))} · ${list.filter(c => c.closer === 'self').length} ดีล</p></div><div class="bg-slate-100 rounded-xl p-2"><p class="text-slate-500">co-agent</p><p class="font-bold">${B(sum('co'))} · ${list.filter(c => c.closer === 'co').length} ดีล</p></div></div>
  <div class="mt-3">${list.map(c => `<button onclick="FX.commEdit('${c.id}')" class="w-full text-left flex items-center gap-2 py-2 border-b border-slate-800 last:border-0"><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${E(c.unitName || '')}</p><p class="text-[11px] text-slate-400">${CL[c.closer] || ''} · ${SL[c.status] || ''}${c.note ? ' · ' + E(c.note) : ''}</p></div><span class="text-sm font-bold text-brick-600">${B(c.amount)}</span><i data-lucide="pencil" class="w-3.5 h-3.5 text-slate-400"></i></button>`).join('') || '<p class="text-xs text-slate-400">ยังไม่มีค่าคอมเดือนนี้ — จะถามอัตโนมัติเมื่อเปลี่ยนห้องเป็น "จอง" หรือ "มีผู้เช่า"</p>'}</div>
  <p class="text-[10px] text-slate-400 mt-2">ค่าคอมสะสมปี ${Number(yr) + 543} ถึงเดือนนี้: ${B(ytd)} · แตะรายการเพื่อแก้ไข/ลบ</p></div>`;
};
})();

