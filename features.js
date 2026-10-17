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
let shareState = {};
async function buildLink(u, opts) {
  const c = cfg();
  const o = { v: 1, p: u.project || '', b: u.building || '', r: opts.hideRoom ? '' : (u.room || ''), f: u.floor || '', rent: Number(u.rent) || 0, sale: u.salePrice || '', sz: Number(u.size) || 0, t: u.type || '', bt: u.bath || '', vw: u.view || '', st: u.status || '', d: (u.notes || '').slice(0, 900), a: { n: c.agentName || '', ph: opts.showPhone ? (c.phone || '') : '', l: c.lineId || '' } };
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
  return `${u.project || ''}${u.type ? ' · ' + u.type : ''}${u.size ? ' · ' + u.size + ' ตร.ม.' : ''}\nค่าเช่า ${B(u.rent)}/เดือน\nดูรายละเอียดและรูป: ${link}`;
}
async function renderShare() {
  const u = units_().find(x => x.id === shareState.id); if (!u) return;
  const el = $('fxShareBody'); if (!el) return;
  el.querySelector('#fxShareLink').textContent = 'กำลังสร้างลิงก์...';
  shareState.link = await buildLink(u, shareState);
  el.querySelector('#fxShareLink').textContent = shareState.link;
  el.querySelector('#fxShareLen').textContent = `ความยาวลิงก์ ${shareState.link.length.toLocaleString()} ตัวอักษร${shareState.link.includes('"img"') ? '' : ''}`;
}
const tog = (key, label) => `<label class="flex items-center justify-between gap-3 py-2 text-xs text-slate-500 cursor-pointer"><span>${label}</span><input type="checkbox" ${shareState[key] ? 'checked' : ''} onchange="FX.shareOpt('${key}', this.checked)" class="inp-check"></label>`;
FX.shareOpt = (k, v) => { shareState[k] = v; renderShare(); };
FX.openShare = function (id) {
  const u = units_().find(x => x.id === id); if (!u) return;
  shareState = { id, hideRoom: false, showPhone: true, photo: true, link: '' };
  FX.open(FX.sheetHead('แชร์ห้องให้ลูกค้า', 'ลูกค้าเปิดดูรูป ราคา และทักไลน์ได้ทันที ไม่ต้องติดตั้งแอป') + `<div id="fxShareBody">
    <div class="flex gap-3 p-3 bg-slate-950 rounded-2xl mb-4"><div class="w-14 h-14 rounded-xl bg-brick-500/10 flex items-center justify-center shrink-0"><i data-lucide="home" class="w-6 h-6 text-brick-500"></i></div><div class="min-w-0"><p class="text-sm font-semibold truncate">${E(u.project || '-')}${u.room ? ' · ' + E(u.room) : ''}</p><p class="text-xs text-brick-600 font-bold">${B(u.rent)}/เดือน</p><p class="text-[11px] text-slate-400">${E(u.type || '')}${u.size ? ' · ' + u.size + ' ตร.ม.' : ''}${u.floor ? ' · ชั้น ' + E(u.floor) : ''}</p></div></div>
    <p class="text-[11px] text-slate-500 mb-1">ลิงก์สำหรับลูกค้า</p>
    <div class="bg-white border border-slate-700 rounded-2xl p-3"><p id="fxShareLink" class="text-[11px] text-slate-400 break-all max-h-16 overflow-hidden"></p></div>
    <p id="fxShareLen" class="text-[10px] text-slate-400 mt-1"></p>
    <div class="mt-2 divide-y divide-slate-800">${tog('photo', 'แนบรูปปก (ย่อขนาด)')}${tog('showPhone', 'แสดงเบอร์โทรของฉัน')}${tog('hideRoom', 'ซ่อนเลขห้อง')}</div>
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

/* ---------- boot ---------- */
try { FX.injectTools(); } catch (e) {}
