/* Condo pin map. Reads the in-memory unit list only — no persist, no sync, no room writes. */
(function () {
  'use strict';
  var GEO = window.CONDO_GEO;
  if (!GEO) return;

  var STATUS = [
    { id: 'AVAILABLE', label: 'ว่าง' },
    { id: 'OCCUPIED', label: 'มีผู้เช่า' },
    { id: 'PENDING', label: 'รอตรวจสอบ' },
    { id: 'RESERVED', label: 'จอง' }
  ];
  var COLORS = { AVAILABLE: '#c2552d', RESERVED: '#0284c7', PENDING: '#78716c', OCCUPIED: '#e11d48' };
  var BEDS = [
    { id: 'studio', label: 'สตูดิโอ' },
    { id: '1', label: '1 ห้องนอน' },
    { id: '2', label: '2 ห้องนอน' },
    { id: '3', label: '3 ห้องนอน' },
    { id: 'duplex', label: 'ดูเพล็กซ์' }
  ];

  var state = {
    statuses: {},
    beds: {},
    deal: 'all',
    priceMin: null,
    priceMax: null,
    sizeMin: null,
    sizeMax: null,
    q: ''
  };
  var db = null, idx = null, loadError = '';
  var map = null, cluster = null, ready = false, open = false, keep = false;
  var fitted = false, selectedKey = '';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function baht(n) {
    try { if (typeof window.baht === 'function') return window.baht(n); } catch (e) {}
    return '฿' + Number(n || 0).toLocaleString('th-TH');
  }
  function unitList() {
    try { return Array.isArray(units) ? units : []; } catch (e) { return []; }
  }
  function statusLabel(id) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].id === id) return STATUS[i].label;
    return id || '';
  }
  function pinColor(rooms) {
    var order = ['AVAILABLE', 'RESERVED', 'PENDING', 'OCCUPIED'];
    for (var i = 0; i < order.length; i++) {
      for (var j = 0; j < rooms.length; j++) if (rooms[j].status === order[i]) return COLORS[order[i]];
    }
    return COLORS.PENDING;
  }
  function displayName(raw, hit) {
    if (hit && hit.name) return hit.name;
    return GEO.englishName(raw) || String(raw || '').trim() || 'ไม่ระบุโครงการ';
  }

  function readNum(id) {
    var el = $(id);
    if (!el) return null;
    var digits = String(el.value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!digits) return null;
    var n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  function onNum(el, cap) {
    var start = el.selectionStart || 0;
    var before = el.value.slice(0, start).replace(/\D/g, '').length;
    var digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (digits.length > cap) digits = digits.slice(0, cap);
    el.value = digits;
    var pos = before > digits.length ? digits.length : before;
    try { el.setSelectionRange(pos, pos); } catch (e) {}
    syncInputs();
    schedule();
  }
  function syncInputs() {
    var p0 = readNum('cmPriceMin'), p1 = readNum('cmPriceMax');
    var s0 = readNum('cmSizeMin'), s1 = readNum('cmSizeMax');
    if (p0 != null && p1 != null && p0 > p1) { var t = p0; p0 = p1; p1 = t; }
    if (s0 != null && s1 != null && s0 > s1) { var u = s0; s0 = s1; s1 = u; }
    state.priceMin = p0; state.priceMax = p1; state.sizeMin = s0; state.sizeMax = s1;
    state.q = ($('cmSearch') && $('cmSearch').value || '').trim();
  }

  function priceOf(u) {
    var rent = GEO.amount(u.rent), sale = GEO.amount(u.salePrice);
    if (state.deal === 'sale') return sale;
    if (state.deal === 'rent') return rent;
    return rent > 0 ? rent : sale;
  }
  function pass(u) {
    if (state.statuses && Object.keys(state.statuses).length) {
      if (!state.statuses[u.status]) return false;
    }
    var rent = GEO.amount(u.rent), sale = GEO.amount(u.salePrice);
    if (state.deal === 'rent' && !(rent > 0)) return false;
    if (state.deal === 'sale' && !(sale > 0)) return false;
    var price = priceOf(u);
    if (state.priceMin != null && price < state.priceMin) return false;
    if (state.priceMax != null && price > state.priceMax) return false;
    var size = GEO.amount(u.size);
    if (state.sizeMin != null && size < state.sizeMin) return false;
    if (state.sizeMax != null && size > state.sizeMax) return false;
    var bedsOn = Object.keys(state.beds);
    if (bedsOn.length) {
      var buckets = GEO.bedBuckets(u.type);
      if (!bedsOn.some(function (b) { return state.beds[b] && buckets.indexOf(b) >= 0; })) return false;
    }
    if (state.q) {
      var hay = [u.project, u.building, u.station, u.room, u.view, GEO.englishName(u.project)].join(' ').toLowerCase();
      var parts = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!parts.every(function (p) { return hay.indexOf(p) >= 0; })) return false;
    }
    return true;
  }

  function groups() {
    var placed = Object.create(null);
    var missed = Object.create(null);
    unitList().forEach(function (u) {
      if (!pass(u)) return;
      var raw = String(u.project || '').trim();
      var hit = raw && idx ? GEO.resolve(idx, raw) : null;
      if (!hit) {
        var mk = raw || '—';
        if (!missed[mk]) missed[mk] = { key: mk, name: raw ? displayName(raw, null) : 'ไม่ระบุโครงการ', raw: raw, rooms: [] };
        missed[mk].rooms.push(u);
        return;
      }
      var k = hit.keys && hit.keys[0] ? hit.keys[0] : (hit.name || raw);
      if (!placed[k]) placed[k] = { key: k, name: hit.name || displayName(raw, hit), lat: hit.lat, lng: hit.lng, rooms: [] };
      placed[k].rooms.push(u);
    });
    var list = Object.keys(placed).map(function (k) { return placed[k]; });
    spread(list);
    var miss = Object.keys(missed).map(function (k) { return missed[k]; });
    miss.sort(function (a, b) { return b.rooms.length - a.rooms.length || a.name.localeCompare(b.name); });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { placed: list, missed: miss };
  }

  function spread(list) {
    var seen = Object.create(null);
    list.forEach(function (g) {
      var k = g.lat.toFixed(5) + ',' + g.lng.toFixed(5);
      var i = seen[k] || 0;
      seen[k] = i + 1;
      g.dlat = g.lat;
      g.dlng = g.lng;
      if (i) {
        var ang = i * 2.39996;
        var r = 0.00028 * (1 + Math.floor((i - 1) / 8));
        g.dlat = g.lat + Math.cos(ang) * r;
        g.dlng = g.lng + Math.sin(ang) * r;
      }
    });
  }

  function sortRooms(rooms) {
    var rank = { AVAILABLE: 0, RESERVED: 1, PENDING: 2, OCCUPIED: 3 };
    return rooms.slice().sort(function (a, b) {
      var d = (rank[a.status] == null ? 9 : rank[a.status]) - (rank[b.status] == null ? 9 : rank[b.status]);
      if (d) return d;
      return String(a.room || '').localeCompare(String(b.room || ''), undefined, { numeric: true });
    });
  }

  function ensureDom() {
    if ($('viewCondoMap')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#viewCondoMap{display:none}',
      'body.condo-map-open{overflow:hidden}',
      'body.condo-map-open #viewCondoMap{display:flex;flex-direction:column;position:fixed;z-index:35;background:#f4f2ef;overflow:hidden}',
      '.cm-top{flex:0 1 auto;max-height:46%;overflow:auto;background:#fff;border-bottom:1px solid #f1eeea;-webkit-overflow-scrolling:touch}',
      '.cm-head{display:flex;align-items:center;gap:8px;padding:10px 12px 4px}',
      '.cm-back{width:36px;height:36px;border-radius:999px;background:#f6f1ed;display:flex;align-items:center;justify-content:center;flex:none;color:#1c1917}',
      '.cm-title{font-size:16px;font-weight:700;color:#1c1917;line-height:1.2}',
      '.cm-sub{font-size:12px;color:#78716c;margin-top:1px}',
      '.cm-filters{padding:4px 12px 10px;display:flex;flex-direction:column;gap:8px}',
      '.cm-row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
      '.cm-row::-webkit-scrollbar{display:none}',
      '.cm-chip,.cm-seg button{flex:none;border:1px solid #ece6e1;background:#fff;color:#44403c;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600}',
      '.cm-chip.on,.cm-seg button.on{background:#c2552d;border-color:#c2552d;color:#fff}',
      '.cm-seg{display:flex;background:#f6f1ed;border-radius:999px;padding:3px;gap:2px}',
      '.cm-seg button{background:transparent;border-color:transparent}',
      '.cm-nums{display:grid;grid-template-columns:1fr 1fr;gap:8px;overflow:visible}',
      '.cm-nums label{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:#78716c;min-width:0}',
      '.cm-nums input,#cmSearch{width:100%;height:40px;border:1px solid #ece6e1;border-radius:12px;padding:0 12px;background:#fff;color:#1c1917;font-family:inherit}',
      '.cm-nums input:focus,#cmSearch:focus{outline:none;border-color:#c2552d}',
      '#cmSearch{flex:1;min-width:0}',
      '.cm-clear{align-self:flex-start;font-size:12px;font-weight:700;color:#c2552d;padding:2px 0}',
      '.cm-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#57534e}',
      '.cm-legend i{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:4px}',
      '.cm-missbtn{flex:none;margin:0;text-align:left;font-size:12px;font-weight:700;color:#9a3412;background:#fff7ed;border:0;border-bottom:1px solid #fed7aa;padding:8px 12px}',
      '#condoMap{flex:1 1 auto;min-height:180px;background:#e7e2dc;touch-action:none}',
      '#condoMap.leaflet-container{width:100%;height:100%;background:#e7e2dc;font-family:inherit;touch-action:none}',
      '.cm-pin-wrap,.cm-cluster-wrap{background:none!important;border:0!important;display:flex!important;align-items:flex-end;justify-content:center}',
      '.cm-pin{display:inline-flex;align-items:center;gap:4px;max-width:176px;background:var(--c,#c2552d);color:#fff;font:600 11px/1.2 Poppins,"Noto Sans Thai",sans-serif;padding:3px 4px 3px 8px;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(28,25,23,.28);white-space:nowrap;touch-action:manipulation}',
      '.cm-pin.sel{outline:2px solid #1c1917;outline-offset:1px}',
      '.cm-pin b{font-weight:700;max-width:132px;overflow:hidden;text-overflow:ellipsis}',
      '.cm-pin span{background:#fff;color:var(--c,#c2552d);min-width:16px;height:16px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;padding:0 4px}',
      '.cm-cluster{width:40px;height:40px;border-radius:50%;background:#c2552d;color:#fff;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font:700 13px Poppins,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
      '.cm-sheet,.cm-miss{position:absolute;left:0;right:0;bottom:0;z-index:600;background:#fff;border-radius:18px 18px 0 0;box-shadow:0 -8px 24px rgba(28,25,23,.18);max-height:58%;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}',
      '.cm-sheet[hidden],.cm-miss[hidden]{display:none}',
      '.cm-grab{width:36px;height:4px;border-radius:4px;background:#e7e5e4;margin:8px auto 4px}',
      '.cm-sh{display:flex;align-items:flex-start;gap:8px;padding:2px 12px 8px}',
      '.cm-sh h3{font-size:15px;font-weight:700;color:#1c1917;line-height:1.25}',
      '.cm-sh p{font-size:12px;color:#78716c}',
      '.cm-x{margin-left:auto;width:30px;height:30px;border-radius:99px;background:#f5f5f4;flex:none;font-size:16px}',
      '.cm-room{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 12px;border-top:1px solid #f5f5f4}',
      '.cm-room:active{background:#faf7f5}',
      '.cm-rdot{width:8px;height:8px;border-radius:99px;flex:none}',
      '.cm-room b{display:block;font-size:13px;color:#1c1917}',
      '.cm-room small{display:block;font-size:11px;color:#78716c}',
      '.cm-room em{margin-left:auto;font-style:normal;color:#c2552d;font-weight:700;font-size:13px;white-space:nowrap}',
      '.cm-miss .cm-room{border-top:1px solid #f5f5f4}',
      '.leaflet-control-attribution{font-size:10px!important}',
      '@media (max-width:1024px){#viewCondoMap input{font-size:16px!important}}'
    ].join('');
    document.head.appendChild(css);
    var main = document.querySelector('main');
    if (!main) return;
    main.insertAdjacentHTML('beforeend', [
      '<div id="viewCondoMap" class="hidden" aria-hidden="true">',
      '<div class="cm-top">',
      '<div class="cm-head"><button type="button" class="cm-back" id="cmBack" aria-label="กลับ"><i data-lucide="arrow-left" class="w-4 h-4"></i></button>',
      '<div class="min-w-0"><h2 class="cm-title">แผนที่ปักหมุดคอนโด</h2><p class="cm-sub" id="cmStats">กำลังโหลดแผนที่...</p></div></div>',
      '<div class="cm-filters">',
      '<div class="cm-row" id="cmStatus"></div>',
      '<div class="cm-row"><div class="cm-seg" id="cmDeal" role="group" aria-label="เช่าหรือขาย">',
      '<button type="button" data-deal="all" class="on">ทั้งหมด</button>',
      '<button type="button" data-deal="rent">เช่า</button>',
      '<button type="button" data-deal="sale">ขาย</button></div></div>',
      '<div class="cm-nums">',
      '<label><span id="cmPriceMinLbl">ราคาต่ำสุด</span><input id="cmPriceMin" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="0"></label>',
      '<label><span id="cmPriceMaxLbl">ราคาสูงสุด</span><input id="cmPriceMax" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="ไม่จำกัด"></label>',
      '<label>ขนาดต่ำสุด (ตร.ม.)<input id="cmSizeMin" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="0"></label>',
      '<label>ขนาดสูงสุด (ตร.ม.)<input id="cmSizeMax" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="ไม่จำกัด"></label>',
      '</div>',
      '<div class="cm-row" id="cmBeds"></div>',
      '<div class="cm-row"><input id="cmSearch" type="search" inputmode="search" autocomplete="off" placeholder="ค้นหาโครงการ หรือทำเล เช่น Thonglor, อโศก"></div>',
      '<div class="cm-legend" aria-hidden="true"><span><i style="background:#c2552d"></i>ว่าง</span><span><i style="background:#0284c7"></i>จอง</span><span><i style="background:#78716c"></i>รอตรวจสอบ</span><span><i style="background:#e11d48"></i>มีผู้เช่า</span></div>',
      '<button type="button" class="cm-clear" id="cmClear">ล้างตัวกรอง</button>',
      '</div>',
      '</div>',
      '<button type="button" class="cm-missbtn" id="cmMissBtn" hidden></button>',
      '<div id="condoMap"></div>',
      '<div class="cm-sheet" id="cmSheet" hidden></div>',
      '<div class="cm-miss" id="cmMiss" hidden></div>',
      '</div>'
    ].join(''));
    $('cmStatus').innerHTML = '<button type="button" class="cm-chip on" data-st="">ทั้งหมด</button>' + STATUS.map(function (s) {
      return '<button type="button" class="cm-chip" data-st="' + s.id + '">' + s.label + '</button>';
    }).join('');
    $('cmBeds').innerHTML = BEDS.map(function (b) {
      return '<button type="button" class="cm-chip" data-bed="' + b.id + '">' + b.label + '</button>';
    }).join('');
    bind();
  }

  function bind() {
    $('cmBack').onclick = function () { close(); };
    $('cmClear').onclick = function () { clearFilters(); };
    $('cmStatus').onclick = function (e) {
      var b = e.target.closest('[data-st]'); if (!b) return;
      var id = b.getAttribute('data-st');
      if (!id) state.statuses = {};
      else {
        if (state.statuses[id]) delete state.statuses[id];
        else state.statuses[id] = 1;
      }
      paintChips();
      schedule(true);
    };
    $('cmBeds').onclick = function (e) {
      var b = e.target.closest('[data-bed]'); if (!b) return;
      var id = b.getAttribute('data-bed');
      if (state.beds[id]) delete state.beds[id]; else state.beds[id] = 1;
      paintChips();
      schedule(true);
    };
    $('cmDeal').onclick = function (e) {
      var b = e.target.closest('[data-deal]'); if (!b) return;
      state.deal = b.getAttribute('data-deal');
      paintChips();
      schedule(true);
    };
    ['cmPriceMin', 'cmPriceMax'].forEach(function (id) {
      $(id).addEventListener('input', function () { onNum(this, 9); });
    });
    ['cmSizeMin', 'cmSizeMax'].forEach(function (id) {
      $(id).addEventListener('input', function () { onNum(this, 5); });
    });
    $('cmSearch').addEventListener('input', function () { syncInputs(); schedule(true); });
    $('cmMissBtn').onclick = function () { openMiss(); };
    $('cmSheet').onclick = onSheetClick;
    $('cmMiss').onclick = onSheetClick;
  }

  function paintChips() {
    var anySt = Object.keys(state.statuses).length > 0;
    [].forEach.call(document.querySelectorAll('#cmStatus [data-st]'), function (b) {
      var id = b.getAttribute('data-st');
      b.classList.toggle('on', id ? !!state.statuses[id] : !anySt);
    });
    [].forEach.call(document.querySelectorAll('#cmBeds [data-bed]'), function (b) {
      b.classList.toggle('on', !!state.beds[b.getAttribute('data-bed')]);
    });
    [].forEach.call(document.querySelectorAll('#cmDeal [data-deal]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-deal') === state.deal);
    });
    var minWord = state.deal === 'sale' ? 'ราคาขายต่ำสุด' : state.deal === 'rent' ? 'ค่าเช่าต่ำสุด' : 'ราคาต่ำสุด';
    var maxWord = state.deal === 'sale' ? 'ราคาขายสูงสุด' : state.deal === 'rent' ? 'ค่าเช่าสูงสุด' : 'ราคาสูงสุด';
    if ($('cmPriceMinLbl')) $('cmPriceMinLbl').textContent = minWord;
    if ($('cmPriceMaxLbl')) $('cmPriceMaxLbl').textContent = maxWord;
  }

  function clearFilters() {
    state.statuses = {}; state.beds = {}; state.deal = 'all';
    state.priceMin = state.priceMax = state.sizeMin = state.sizeMax = null; state.q = '';
    ['cmPriceMin', 'cmPriceMax', 'cmSizeMin', 'cmSizeMax', 'cmSearch'].forEach(function (id) { if ($(id)) $(id).value = ''; });
    paintChips();
    schedule(true);
  }

  var timer = 0;
  function schedule(refit) {
    if (refit) { fitted = false; hideSheets(); }
    clearTimeout(timer);
    timer = setTimeout(function () { draw(false); }, 60);
  }

  function place() {
    var el = $('viewCondoMap'); if (!el) return;
    var desk = window.matchMedia('(min-width: 1024px)').matches;
    if (desk) {
      var side = document.querySelector('.sidebar');
      var head = document.querySelector('.main-wrapper > header');
      var left = side ? side.getBoundingClientRect().right : 0;
      var top = head ? head.getBoundingClientRect().bottom : 57;
      el.style.left = Math.max(0, Math.round(left)) + 'px';
      el.style.right = '0px';
      el.style.top = Math.max(0, Math.round(top)) + 'px';
      el.style.bottom = '0px';
    } else {
      var header = document.querySelector('.mobile-header');
      var nav = document.querySelector('.bottom-nav-new');
      var top = header ? header.getBoundingClientRect().bottom : 0;
      var bottom = nav ? Math.max(0, window.innerHeight - nav.getBoundingClientRect().top) : 78;
      el.style.left = '0px';
      el.style.right = '0px';
      el.style.top = Math.max(0, Math.round(top)) + 'px';
      el.style.bottom = Math.round(bottom) + 'px';
    }
    if (map) setTimeout(function () { map.invalidateSize(); }, 40);
  }

  function hideSheets() {
    ['cmSheet', 'cmMiss'].forEach(function (id) { var el = $(id); if (el) el.hidden = true; });
    selectedKey = '';
    document.querySelectorAll('.cm-pin.sel').forEach(function (p) { p.classList.remove('sel'); });
  }

  function show() {
    ensureDom();
    open = true;
    document.body.classList.add('condo-map-open');
    var el = $('viewCondoMap');
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    ['viewDashboard', 'viewRooms', 'viewCustomers'].forEach(function (id) {
      var n = $(id); if (n) n.classList.add('hidden');
    });
    var fx = $('viewFx'); if (fx) fx.classList.add('hidden');
    document.querySelectorAll('.nav-link[data-nav], .bottom-nav-item[data-nav]').forEach(function (n) { n.classList.remove('active'); });
    place();
    try { if (window.lucide) lucide.createIcons(); } catch (e) {}
    boot().then(function () { draw(true); });
  }

  function hide() {
    open = false;
    document.body.classList.remove('condo-map-open');
    var el = $('viewCondoMap');
    if (el) { el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); }
    hideSheets();
  }

  function close() {
    hide();
    try { switchView('dashboard'); } catch (e) {}
  }

  function boot() {
    if (ready) return Promise.resolve();
    ready = true;
    return fetch('condo-coords.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('coords ' + r.status);
      return r.json();
    }).then(function (j) {
      db = j; idx = GEO.index(j);
    }).catch(function () {
      loadError = 'โหลดพิกัดไม่สำเร็จ';
      db = { projects: [] }; idx = GEO.index(db);
    }).then(function () { return lib(); });
  }

  function lib() {
    if (window.L && window.L.markerClusterGroup) return Promise.resolve();
    return Promise.reject(new Error('leaflet'));
  }

  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('condoMap', { zoomControl: true, attributionControl: true });
    map.setView([13.73, 100.57], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    map.on('click', hideSheets);
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 46,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: function (c) {
        var n = c.getAllChildMarkers().reduce(function (s, m) { return s + (m.options.roomCount || 0); }, 0);
        return L.divIcon({ className: 'cm-cluster-wrap', html: '<div class="cm-cluster">' + n + '</div>', iconSize: [40, 40] });
      }
    });
    map.addLayer(cluster);
  }

  function draw(refit) {
    if (!open) return;
    syncInputs();
    ensureMap();
    var g = groups();
    var rooms = 0;
    g.placed.forEach(function (p) { rooms += p.rooms.length; });
    g.missed.forEach(function (p) { rooms += p.rooms.length; });
    var stats = $('cmStats');
    if (stats) {
      var msg = g.placed.length + ' โครงการบนแผนที่ · ' + rooms + ' ห้อง';
      if (loadError) msg = loadError;
      else if (!window.L) msg = 'โหลดแผนที่ไม่สำเร็จ';
      stats.textContent = msg;
    }
    var mb = $('cmMissBtn');
    if (mb) {
      if (g.missed.length) {
        mb.hidden = false;
        mb.textContent = 'ปักหมุดไม่ได้ ' + g.missed.length + ' โครงการ · ดูรายการ';
      } else mb.hidden = true;
    }
    if (!map || !cluster) return;
    cluster.clearLayers();
    g.placed.forEach(function (p) {
      var color = pinColor(p.rooms);
      var icon = L.divIcon({
        className: 'cm-pin-wrap',
        html: '<div class="cm-pin' + (selectedKey === p.key ? ' sel' : '') + '" style="--c:' + color + '"><b>' + esc(p.name) + '</b><span>' + p.rooms.length + '</span></div>',
        iconSize: [180, 30],
        iconAnchor: [90, 30]
      });
      var marker = L.marker([p.dlat, p.dlng], { icon: icon, roomCount: p.rooms.length, keyboard: true, title: p.name });
      marker.on('click', function (ev) {
        L.DomEvent.stopPropagation(ev);
        selectedKey = p.key;
        openSheet(p);
        draw(false);
      });
      cluster.addLayer(marker);
    });
    if ((refit || !fitted) && g.placed.length) {
      fitted = true;
      var b = L.latLngBounds(g.placed.map(function (p) { return [p.dlat, p.dlng]; }));
      setTimeout(function () {
        map.invalidateSize();
        if (g.placed.length === 1) map.setView([g.placed[0].dlat, g.placed[0].dlng], 15);
        else map.fitBounds(b, { padding: [28, 28], maxZoom: 15 });
      }, 30);
    } else {
      setTimeout(function () { map.invalidateSize(); }, 30);
    }
  }

  function roomButton(u) {
    var color = COLORS[u.status] || COLORS.PENDING;
    var bits = [];
    if (u.type) bits.push(u.type);
    if (GEO.amount(u.size)) bits.push(GEO.amount(u.size) + ' ตร.ม.');
    if (u.floor) bits.push('ชั้น ' + u.floor);
    var rent = GEO.amount(u.rent), sale = GEO.amount(u.salePrice);
    var price = state.deal === 'sale' && sale > 0 ? baht(sale) : (rent > 0 ? baht(rent) : (sale > 0 ? baht(sale) : '—'));
    var suffix = state.deal === 'sale' && sale > 0 ? '' : (rent > 0 ? '/ด.' : '');
    return '<button type="button" class="cm-room" data-id="' + esc(u.id) + '"><i class="cm-rdot" style="background:' + color + '"></i><span><b>ห้อง ' + esc(u.room || '-') + ' · ' + esc(statusLabel(u.status)) + '</b><small>' + esc(bits.join(' · ') || '—') + '</small></span><em>' + esc(price + suffix) + '</em></button>';
  }

  function openSheet(p) {
    var el = $('cmSheet'); if (!el) return;
    var miss = $('cmMiss'); if (miss) miss.hidden = true;
    var rooms = sortRooms(p.rooms);
    var avail = rooms.filter(function (u) { return u.status === 'AVAILABLE'; }).length;
    el.innerHTML = '<div class="cm-grab"></div><div class="cm-sh"><div><h3>' + esc(p.name) + '</h3><p>' + rooms.length + ' ห้อง' + (avail ? ' · ว่าง ' + avail : '') + '</p></div><button type="button" class="cm-x" data-close="1" aria-label="ปิด">×</button></div>' + rooms.map(roomButton).join('');
    el.hidden = false;
  }

  function openMiss() {
    var g = groups();
    var el = $('cmMiss'); if (!el) return;
    var sheet = $('cmSheet'); if (sheet) sheet.hidden = true;
    if (!g.missed.length) { el.hidden = true; return; }
    el.innerHTML = '<div class="cm-grab"></div><div class="cm-sh"><div><h3>โครงการที่ปักหมุดไม่ได้</h3><p>ไม่มีพิกัดในตาราง หรือชื่อไม่ตรงกับโครงการที่รู้ตำแหน่ง</p></div><button type="button" class="cm-x" data-close="1" aria-label="ปิด">×</button></div>' +
      g.missed.map(function (p) {
        return '<button type="button" class="cm-room" data-miss="' + esc(p.key) + '"><span><b>' + esc(p.name) + '</b><small>' + p.rooms.length + ' ห้อง</small></span><em>ดูห้อง</em></button>';
      }).join('');
    el.hidden = false;
  }

  function onSheetClick(e) {
    if (e.target.closest('[data-close]')) { hideSheets(); draw(false); return; }
    var room = e.target.closest('[data-id]');
    if (room) {
      var id = room.getAttribute('data-id');
      if (typeof window.openDetailView === 'function') window.openDetailView(id);
      return;
    }
    var miss = e.target.closest('[data-miss]');
    if (miss) {
      var key = miss.getAttribute('data-miss');
      var g = groups();
      var p = null;
      for (var i = 0; i < g.missed.length; i++) if (g.missed[i].key === key) p = g.missed[i];
      if (p) openSheet(p);
    }
  }

  function openMap() {
    keep = true;
    try { switchView('dashboard'); } catch (e) {}
    keep = false;
    show();
  }

  var api = {
    open: openMap,
    close: close,
    onLeave: function () { if (!keep) hide(); },
    onUnits: function () { if (open) draw(false); }
  };
  window.CondoMap = api;

  if (typeof window.switchView === 'function') {
    var prev = window.switchView;
    window.switchView = function () {
      api.onLeave();
      return prev.apply(this, arguments);
    };
  }
  if (typeof window.render === 'function') {
    var prevR = window.render;
    window.render = function () {
      var r = prevR.apply(this, arguments);
      try { api.onUnits(); } catch (e) {}
      return r;
    };
  }
  window.addEventListener('resize', function () { if (open) place(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureDom);
  else ensureDom();
})();
