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
FX.buildRoomLink = buildLink;
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
  for (const m of top) { const link = FX.buildRoomLink ? await FX.buildRoomLink(m.u, { photo: false, showPhone: true, hideRoom: false }) : ''; lines.push(`🏢 ${unitName(m.u)} · ${m.u.type || ''} ${m.u.size ? m.u.size + ' ตร.ม.' : ''}\n💰 ${B(m.u.rent)}/เดือน\n${link}`); }
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

/* ---------- boot ---------- */
try { FX.injectTools(); } catch (e) {}
