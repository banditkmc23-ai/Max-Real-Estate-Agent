/* Condo pin map. Reads the in-memory room list only — no persist, no sync, no room writes. */
(function () {
  'use strict';
  var GEO = window.CONDO_GEO;
  if (!GEO) return;

  var STATUS = [
    { id: 'AVAILABLE', label: 'ว่าง', color: '#c2552d' },
    { id: 'OCCUPIED', label: 'มีผู้เช่า', color: '#e11d48' },
    { id: 'PENDING', label: 'รอตรวจสอบ', color: '#78716c' },
    { id: 'RESERVED', label: 'จอง', color: '#0284c7' }
  ];
  var BEDS = [
    { id: 'studio', label: 'สตูดิโอ' },
    { id: '1', label: '1 ห้องนอน' },
    { id: '2', label: '2 ห้องนอน' },
    { id: '3', label: '3 ห้องนอน' },
    { id: 'duplex', label: 'ดูเพล็กซ์' }
  ];
  var STATUS_COLOR = { AVAILABLE: '#c2552d', RESERVED: '#0284c7', PENDING: '#78716c', OCCUPIED: '#e11d48' };

  var state = {
    statuses: {}, beds: {}, deal: 'all',
    priceMin: null, priceMax: null, sizeMin: null, sizeMax: null, q: '', fav: false
  };
  var db = null, idx = null, loadError = '';
  var map = null, cluster = null, markers = {}, ready = false, open = false, keep = false;
  var fitted = false, selectedKey = '', mode = 'map', scrollLock = 0, lastGroups = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function unitList() {
    try { return Array.isArray(units) ? units : []; } catch (e) { return []; }
  }
  function statusMeta(id) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].id === id) return STATUS[i];
    return { id: id, label: id || '', color: '#78716c' };
  }
  function money(n) {
    n = Math.round(Number(n) || 0);
    return '฿' + n.toLocaleString('en-US');
  }
  function displayName(raw, hit) {
    if (hit && hit.name) return hit.name;
    return GEO.englishName(raw) || String(raw || '').trim() || 'ไม่ระบุโครงการ';
  }
  function priceOf(u) {
    var rent = GEO.amount(u.rent), sale = GEO.amount(u.salePrice);
    if (state.deal === 'sale') return sale;
    if (state.deal === 'rent') return rent;
    return rent > 0 ? rent : sale;
  }
  function minPrice(rooms) {
    var best = Infinity;
    rooms.forEach(function (u) { var n = priceOf(u); if (n > 0 && n < best) best = n; });
    return best;
  }
  function clipName(name, n) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    var chars = Array.from(name);
    if (chars.length <= n) return name;
    return chars.slice(0, n - 1).join('').replace(/\s+$/, '') + '…';
  }
  function pinPrice(rooms) {
    var n = minPrice(rooms);
    return n === Infinity ? '' : money(n);
  }
  function availColor(rooms) {
    var order = ['AVAILABLE', 'RESERVED', 'PENDING', 'OCCUPIED'];
    for (var i = 0; i < order.length; i++) {
      for (var j = 0; j < rooms.length; j++) if (rooms[j].status === order[i]) return STATUS_COLOR[order[i]];
    }
    return '#78716c';
  }
  function filtersOn(s) {
    s = s || state;
    return !!(s.fav || Object.keys(s.statuses).length || Object.keys(s.beds).length || s.deal !== 'all' || s.priceMin != null || s.priceMax != null || s.sizeMin != null || s.sizeMax != null || s.q);
  }
  function stationLine(u) {
    if (!u) return '';
    try {
      if (typeof stationLabel === 'function') {
        var s = stationLabel(u);
        if (s) return String(s).replace(/^🚇\s*/, '');
      }
    } catch (e) {}
    if (!u.station) return '';
    var d = GEO.amount(u.stationDist);
    return u.station + (d ? ' ' + Math.round(d).toLocaleString('th-TH') + ' ม.' : '');
  }
  function specLine(u) {
    var bits = [];
    if (GEO.amount(u.size)) bits.push(GEO.amount(u.size) + ' ตร.ม.');
    if (u.type) bits.push(u.type);
    return bits.join(' · ');
  }
  function priceHTML(u) {
    var rent = GEO.amount(u.rent), sale = GEO.amount(u.salePrice);
    if (state.deal === 'sale' || (!(rent > 0) && sale > 0)) return '<b>' + money(sale) + '</b>';
    return '<b>' + money(rent) + '</b><small>/เดือน</small>';
  }

  function passWith(s, u) {
    var prev = state;
    state = s;
    var ok = pass(u);
    state = prev;
    return ok;
  }
  function pass(u) {
    if (state.fav && !u.fav) return false;
    if (Object.keys(state.statuses).length && !state.statuses[u.status]) return false;
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
        if (!missed[mk]) missed[mk] = { key: mk, name: raw ? displayName(raw, null) : 'ไม่ระบุโครงการ', rooms: [] };
        missed[mk].rooms.push(u);
        return;
      }
      var k = (hit.keys && hit.keys[0]) || hit.name || raw;
      if (!placed[k]) placed[k] = { key: k, name: hit.name || displayName(raw, hit), lat: hit.lat, lng: hit.lng, rooms: [] };
      placed[k].rooms.push(u);
    });
    var list = Object.keys(placed).map(function (k) { return placed[k]; });
    list.sort(function (a, b) {
      var d = minPrice(a.rooms) - minPrice(b.rooms);
      return d || a.name.localeCompare(b.name);
    });
    var seen = Object.create(null);
    list.forEach(function (g) {
      var kk = g.lat.toFixed(5) + ',' + g.lng.toFixed(5);
      var i = seen[kk] || 0;
      seen[kk] = i + 1;
      g.dlat = g.lat;
      g.dlng = g.lng;
      if (i) {
        var ang = i * 2.39996;
        var r = 0.00028 * (1 + Math.floor((i - 1) / 8));
        g.dlat = g.lat + Math.cos(ang) * r;
        g.dlng = g.lng + Math.sin(ang) * r;
      }
      g.rooms = g.rooms.slice().sort(function (a, b) {
        var d = (priceOf(a) || 1e12) - (priceOf(b) || 1e12);
        return d || String(a.room || '').localeCompare(String(b.room || ''), undefined, { numeric: true });
      });
    });
    var miss = Object.keys(missed).map(function (k) { return missed[k]; });
    miss.sort(function (a, b) { return b.rooms.length - a.rooms.length || a.name.localeCompare(b.name); });
    miss.forEach(function (g) {
      g.rooms = g.rooms.slice().sort(function (a, b) { return (priceOf(a) || 1e12) - (priceOf(b) || 1e12); });
    });
    return { placed: list, missed: miss };
  }

  function cardHTML(u, key, placed) {
    var meta = statusMeta(u.status);
    var st = stationLine(u);
    var spec = specLine(u);
    return '<button type="button" class="cm-card' + (key === selectedKey ? ' on' : '') + '" data-id="' + esc(u.id) + '" data-key="' + esc(key) + '" data-placed="' + (placed ? '1' : '0') + '">' +
      '<span class="cm-ph"><img alt="" data-unit="' + esc(u.id) + '"></span>' +
      '<span class="cm-meta"><span class="cm-name">' + esc(displayName(u.project)) + '</span>' +
      '<span class="cm-badge" style="color:' + meta.color + ';background:' + meta.color + '1a">' + esc(meta.label) + '</span>' +
      (spec ? '<span class="cm-spec">' + esc(spec) + '</span>' : '') +
      (st ? '<span class="cm-stn">' + esc(st) + '</span>' : '') +
      (placed ? '' : '<span class="cm-stn">ไม่มีพิกัด</span>') +
      '<span class="cm-rent">' + priceHTML(u) + '</span></span></button>';
  }

  function ensureDom() {
    if ($('viewCondoMap')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#viewCondoMap{display:none}',
      'body.condo-map-open{overflow:hidden}',
      'body.condo-map-open #viewCondoMap{display:flex;flex-direction:column;position:fixed;z-index:44;background:#fff;overflow:hidden}',
      '.cm-head{flex:none;display:flex;align-items:center;gap:8px;padding:max(8px,env(safe-area-inset-top)) 12px 8px;background:#fff;border-bottom:1px solid #f1eeea;z-index:2}',
      '.cm-back,.cm-locate{width:36px;height:36px;border-radius:999px;background:#fff;border:1px solid #ece7e2;display:flex;align-items:center;justify-content:center;flex:none;color:#1c1917;box-shadow:0 1px 4px rgba(28,25,23,.06)}',
      '.cm-title{font-size:16px;font-weight:700;color:#1c1917;line-height:1.2;min-width:0}',
      '.cm-title span{color:#a8a29e;font-weight:500;font-size:14px;margin-left:4px}',
      '.cm-favchip{flex:none;width:100%;text-align:center;padding:7px 12px;background:#fbeee8;color:#c2552d;font-size:12px;font-weight:700;border-bottom:1px solid #f3d7cb}',
      '.cm-favchip[hidden]{display:none}',
      '.cm-stage{flex:1;position:relative;min-height:0;background:#e7e2dc}',
      '#condoMap{position:absolute;inset:0;z-index:1;background:#e7e2dc;touch-action:none}',
      '#condoMap.leaflet-container{width:100%;height:100%;font-family:inherit;touch-action:none;background:#e7e2dc}',
      '#condoMap .leaflet-bottom{bottom:148px!important}',
      '.cm-locate{position:absolute;top:12px;right:12px;z-index:6}',
      '.cm-rail-wrap{position:absolute;left:0;right:0;bottom:0;z-index:6;pointer-events:none}',
      '.cm-rail{position:relative;display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-left:12px;padding:8px 12px 10px;-webkit-overflow-scrolling:touch;scrollbar-width:none;touch-action:pan-x;pointer-events:auto}',
      '.cm-rail::-webkit-scrollbar{display:none}',
      '.cm-card{flex:0 0 82%;scroll-snap-align:start;scroll-snap-stop:always;display:flex;gap:10px;background:#fff;border-radius:16px;padding:8px;text-align:left;box-shadow:0 8px 24px rgba(28,25,23,.18);border:2px solid transparent;min-height:108px;min-width:0}',
      '.cm-card.on{border-color:#c2552d}',
      '.cm-ph{width:96px;height:96px;border-radius:12px;overflow:hidden;background:#f1eeea center/cover;flex:none;position:relative}',
      '.cm-ph img{width:100%;height:100%;object-fit:cover;display:block}',
      '.cm-ph img:not([src]),.cm-ph img[src=""]{opacity:0}',
      '.cm-ph:before{content:"";position:absolute;inset:0;background:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23c4b8b0\' stroke-width=\'1.6\'><path d=\'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6\'/></svg>") center/28px no-repeat}',
      '.cm-meta{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:2px 2px 0 0}',
      '.cm-name{font-size:14px;font-weight:700;color:#1c1917;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cm-badge{font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;line-height:1.5}',
      '.cm-spec,.cm-stn{font-size:12px;color:#78716c;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cm-rent{margin-top:auto;color:#c2552d;font-size:16px;font-weight:800;line-height:1.1}',
      '.cm-rent small{font-size:11px;font-weight:600;color:#a8a29e;margin-left:2px}',
      '.cm-bar{flex:none;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #f1eeea;z-index:7}',
      '.cm-bar button{height:44px;border-radius:12px;border:1px solid #ece7e2;background:#fff;font:inherit;font-size:15px;font-weight:700;color:#1c1917;display:flex;align-items:center;justify-content:center;gap:6px}',
      '.cm-bar button.on{background:#c2552d;border-color:#c2552d;color:#fff}',
      '.cm-bar .dot{width:8px;height:8px;border-radius:99px;background:#c2552d}',
      '.cm-bar button.on .dot{background:#fff}',
      '.cm-list{display:none;position:absolute;inset:0;overflow:auto;background:#f4f2ef;z-index:6;-webkit-overflow-scrolling:touch;padding:12px 12px 16px}',
      '#viewCondoMap.list-mode .cm-list{display:block}',
      '#viewCondoMap.list-mode .cm-rail-wrap,#viewCondoMap.list-mode .cm-locate,#viewCondoMap.list-mode #condoMap{visibility:hidden}',
      '.cm-list .cm-card{flex:none;width:100%;scroll-snap-align:none;margin-bottom:10px;box-shadow:0 2px 10px rgba(28,25,23,.06)}',
      '.cm-sec{font-size:13px;font-weight:700;color:#9a3412;margin:6px 2px 8px}',
      '.cm-pin-wrap{background:none!important;border:0!important}',
      '.leaflet-marker-icon.cm-pin-wrap{overflow:visible!important}',
      '.cm-bubble{position:relative;display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;padding:4px 8px 11px 6px;background:#fff;color:#1c1917;border-radius:10px;box-shadow:0 2px 8px rgba(28,25,23,.28);white-space:nowrap}',
      '.cm-bubble:after{content:"";position:absolute;left:50%;bottom:0;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}',
      '.cm-pin-txt{display:flex;flex-direction:column;min-width:0;line-height:1.05}',
      '.cm-pin-name{font:700 12px/1.15 Poppins,"Noto Sans Thai",sans-serif;max-width:18ch;overflow:hidden;text-overflow:ellipsis}',
      '.cm-pin-price{font:600 10px/1.2 Poppins,sans-serif;color:#a8a29e;margin-top:1px}',
      '.cm-bubble.compact{padding:3px 7px 9px 5px}',
      '.cm-bubble.compact .cm-pin-price{display:none}',
      '.cm-bubble.compact .cm-pin-name{font-size:11px;max-width:11ch}',
      '.cm-av{width:7px;height:7px;border-radius:99px;background:var(--c,#c2552d);flex:none}',
      '.cm-bubble.sel{background:#c2552d;color:#fff}',
      '.cm-bubble.sel:after{border-top-color:#c2552d}',
      '.cm-bubble.sel .cm-av{background:#fff}',
      '.cm-bubble.sel .cm-pin-price{color:rgba(255,255,255,.82)}',
      '.cm-cluster{width:36px;height:36px;border-radius:50%;background:#fff;color:#1c1917;border:2px solid #c2552d;display:flex;align-items:center;justify-content:center;font:700 12px Poppins,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)}',
      '.cm-dim{position:absolute;inset:0;background:rgba(28,25,23,.4);z-index:20}',
      '.cm-dim[hidden],.cm-fsheet[hidden]{display:none}',
      '.cm-fsheet{position:absolute;left:0;right:0;bottom:0;z-index:21;background:#fff;border-radius:18px 18px 0 0;max-height:86%;display:flex;flex-direction:column;box-shadow:0 -8px 24px rgba(28,25,23,.18)}',
      '.cm-fsheet h3{font-size:16px;font-weight:700}',
      '.cm-fbody{overflow:auto;padding:0 14px 12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}',
      '.cm-frow{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}',
      '.cm-frow::-webkit-scrollbar{display:none}',
      '.cm-chip,.cm-seg button{flex:none;border:1px solid #ece6e1;background:#fff;color:#44403c;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600}',
      '.cm-chip.on,.cm-seg button.on{background:#c2552d;border-color:#c2552d;color:#fff}',
      '.cm-seg{display:flex;background:#f6f1ed;border-radius:999px;padding:3px;gap:2px;width:max-content}',
      '.cm-seg button{background:transparent;border-color:transparent}',
      '.cm-nums{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.cm-nums label{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:#78716c;min-width:0}',
      '.cm-nums input,#cmSearch{width:100%;height:42px;border:1px solid #ece6e1;border-radius:12px;padding:0 12px;background:#fff;color:#1c1917;font-family:inherit;font-size:16px}',
      '.cm-nums input:focus,#cmSearch:focus{outline:none;border-color:#c2552d}',
      '.cm-ffoot{display:flex;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #f1eeea}',
      '.cm-ffoot button{height:46px;border-radius:12px;font:inherit;font-weight:700;font-size:15px}',
      '.cm-ffoot .ghost{width:88px;background:#f6f1ed;color:#57534e}',
      '.cm-ffoot .go{flex:1;background:#c2552d;color:#fff}',
      '.leaflet-control-attribution{font-size:10px!important}',
      '@media (min-width:700px){.cm-card{flex-basis:340px}.cm-fsheet{left:50%;right:auto;width:420px;transform:translateX(-50%);border-radius:18px;bottom:12px}}',
      '@media (max-width:1024px){#viewCondoMap input{font-size:16px!important}}'
    ].join('');
    document.head.appendChild(css);
    var main = document.querySelector('main');
    if (!main) return;
    main.insertAdjacentHTML('beforeend', [
      '<div id="viewCondoMap" class="hidden" aria-hidden="true">',
      '<div class="cm-head"><button type="button" class="cm-back" id="cmBack" aria-label="กลับ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>',
      '<h2 class="cm-title">แผนที่ปักหมุดคอนโด <span id="cmCount">(0 ห้อง)</span></h2></div>',
      '<button type="button" id="cmFavChip" class="cm-favchip" hidden>⭐ เฉพาะห้องน่าสนใจ · แตะเพื่อล้าง</button>',
      '<div class="cm-stage">',
      '<div id="condoMap"></div>',
      '<button type="button" class="cm-locate" id="cmLocate" aria-label="จัดหมุดให้อยู่ในจอ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>',
      '<div class="cm-rail-wrap"><div class="cm-rail" id="cmRail"></div></div>',
      '<div class="cm-list" id="cmList"></div>',
      '<div class="cm-dim" id="cmDim" hidden></div>',
      '<div class="cm-fsheet" id="cmFilter" hidden>',
      '<div style="width:36px;height:4px;border-radius:4px;background:#e7e5e4;margin:8px auto 4px"></div>',
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 14px 8px"><h3>ตัวกรอง</h3><button type="button" id="cmFx" aria-label="ปิด" style="width:30px;height:30px;border-radius:99px;background:#f5f5f4">×</button></div>',
      '<div class="cm-fbody">',
      '<div class="cm-frow" id="cmStatus"></div>',
      '<div class="cm-frow"><button type="button" class="cm-chip" id="cmFavOnly">⭐ น่าสนใจ</button></div>',
      '<div class="cm-frow"><div class="cm-seg" id="cmDeal" role="group" aria-label="เช่าหรือขาย">',
      '<button type="button" data-deal="all" class="on">ทั้งหมด</button><button type="button" data-deal="rent">เช่า</button><button type="button" data-deal="sale">ขาย</button></div></div>',
      '<div class="cm-nums">',
      '<label><span id="cmPriceMinLbl">ราคาต่ำสุด</span><input id="cmPriceMin" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="0"></label>',
      '<label><span id="cmPriceMaxLbl">ราคาสูงสุด</span><input id="cmPriceMax" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="ไม่จำกัด"></label>',
      '<label>ขนาดต่ำสุด (ตร.ม.)<input id="cmSizeMin" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="0"></label>',
      '<label>ขนาดสูงสุด (ตร.ม.)<input id="cmSizeMax" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="ไม่จำกัด"></label>',
      '</div>',
      '<div class="cm-frow" id="cmBeds"></div>',
      '<input id="cmSearch" type="search" inputmode="search" autocomplete="off" placeholder="ค้นหาโครงการ หรือทำเล เช่น Thonglor, อโศก">',
      '</div>',
      '<div class="cm-ffoot"><button type="button" class="ghost" id="cmClear">ล้าง</button><button type="button" class="go" id="cmApply">แสดง</button></div>',
      '</div></div>',
      '<div class="cm-bar">',
      '<button type="button" id="cmFilterBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>ตัวกรอง<span class="dot" id="cmFilterDot" hidden></span></button>',
      '<button type="button" id="cmListBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>รายการ</button>',
      '</div></div>'
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
    $('cmLocate').onclick = function () { recenter(); };
    $('cmFilterBtn').onclick = function () { openFilter(); };
    $('cmListBtn').onclick = function () { setMode(mode === 'list' ? 'map' : 'list'); };
    $('cmDim').onclick = function () { closeFilter(true); };
    $('cmFx').onclick = function () { closeFilter(true); };
    $('cmClear').onclick = function () { clearDraft(); refreshApplyCount(); };
    $('cmApply').onclick = function () { applyDraft(); };
    $('cmStatus').onclick = function (e) {
      var b = e.target.closest('[data-st]'); if (!b) return;
      var id = b.getAttribute('data-st');
      if (!id) {
        [].forEach.call($('cmStatus').querySelectorAll('[data-st]'), function (x) { x.classList.toggle('on', !x.getAttribute('data-st')); });
      } else {
        b.classList.toggle('on');
        var any = $('cmStatus').querySelector('[data-st].on:not([data-st=""])');
        var all = $('cmStatus').querySelector('[data-st=""]');
        if (all) all.classList.toggle('on', !any);
      }
      refreshApplyCount();
    };
    $('cmBeds').onclick = function (e) {
      var b = e.target.closest('[data-bed]'); if (!b) return;
      b.classList.toggle('on');
      refreshApplyCount();
    };
    $('cmDeal').onclick = function (e) {
      var b = e.target.closest('[data-deal]'); if (!b) return;
      [].forEach.call($('cmDeal').querySelectorAll('[data-deal]'), function (x) { x.classList.toggle('on', x === b); });
      var deal = b.getAttribute('data-deal');
      var minWord = deal === 'sale' ? 'ราคาขายต่ำสุด' : deal === 'rent' ? 'ค่าเช่าต่ำสุด' : 'ราคาต่ำสุด';
      var maxWord = deal === 'sale' ? 'ราคาขายสูงสุด' : deal === 'rent' ? 'ค่าเช่าสูงสุด' : 'ราคาสูงสุด';
      if ($('cmPriceMinLbl')) $('cmPriceMinLbl').textContent = minWord;
      if ($('cmPriceMaxLbl')) $('cmPriceMaxLbl').textContent = maxWord;
      refreshApplyCount();
    };
    ['cmPriceMin', 'cmPriceMax'].forEach(function (id) {
      $(id).addEventListener('input', function () { onNum(this, 9); refreshApplyCount(); });
    });
    ['cmSizeMin', 'cmSizeMax'].forEach(function (id) {
      $(id).addEventListener('input', function () { onNum(this, 5); refreshApplyCount(); });
    });
    $('cmSearch').addEventListener('input', refreshApplyCount);
    $('cmFavOnly').onclick = function () { this.classList.toggle('on'); refreshApplyCount(); };
    $('cmFavChip').onclick = function () { state.fav = false; fitted = false; selectedKey = ''; draw(true); };
    $('cmRail').addEventListener('click', onCardClick);
    $('cmList').addEventListener('click', onCardClick);
    $('cmRail').addEventListener('scroll', onRailScroll, { passive: true });
  }

  function onNum(el, cap) {
    var start = el.selectionStart || 0;
    var before = el.value.slice(0, start).replace(/\D/g, '').length;
    var digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (digits.length > cap) digits = digits.slice(0, cap);
    el.value = digits;
    try { el.setSelectionRange(Math.min(before, digits.length), Math.min(before, digits.length)); } catch (e) {}
  }
  function readNum(id) {
    var el = $(id);
    if (!el) return null;
    var digits = String(el.value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!digits) return null;
    var n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  function draftFromDom() {
    var statuses = {}, beds = {};
    [].forEach.call(document.querySelectorAll('#cmStatus [data-st].on'), function (b) {
      var id = b.getAttribute('data-st'); if (id) statuses[id] = 1;
    });
    [].forEach.call(document.querySelectorAll('#cmBeds [data-bed].on'), function (b) { beds[b.getAttribute('data-bed')] = 1; });
    var dealBtn = document.querySelector('#cmDeal [data-deal].on');
    var p0 = readNum('cmPriceMin'), p1 = readNum('cmPriceMax');
    var s0 = readNum('cmSizeMin'), s1 = readNum('cmSizeMax');
    if (p0 != null && p1 != null && p0 > p1) { var t = p0; p0 = p1; p1 = t; }
    if (s0 != null && s1 != null && s0 > s1) { var u = s0; s0 = s1; s1 = u; }
    return {
      statuses: statuses, beds: beds,
      deal: dealBtn ? dealBtn.getAttribute('data-deal') : 'all',
      priceMin: p0, priceMax: p1, sizeMin: s0, sizeMax: s1,
      q: ($('cmSearch') && $('cmSearch').value || '').trim(),
      fav: !!($('cmFavOnly') && $('cmFavOnly').classList.contains('on'))
    };
  }
  function paintDraft() {
    var any = Object.keys(state.statuses).length > 0;
    [].forEach.call(document.querySelectorAll('#cmStatus [data-st]'), function (b) {
      var id = b.getAttribute('data-st');
      b.classList.toggle('on', id ? !!state.statuses[id] : !any);
    });
    [].forEach.call(document.querySelectorAll('#cmBeds [data-bed]'), function (b) {
      b.classList.toggle('on', !!state.beds[b.getAttribute('data-bed')]);
    });
    [].forEach.call(document.querySelectorAll('#cmDeal [data-deal]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-deal') === state.deal);
    });
    if ($('cmFavOnly')) $('cmFavOnly').classList.toggle('on', !!state.fav);
    function put(id, n) { var el = $(id); if (el) el.value = n == null ? '' : String(n); }
    put('cmPriceMin', state.priceMin); put('cmPriceMax', state.priceMax);
    put('cmSizeMin', state.sizeMin); put('cmSizeMax', state.sizeMax);
    if ($('cmSearch')) $('cmSearch').value = state.q || '';
    var minWord = state.deal === 'sale' ? 'ราคาขายต่ำสุด' : state.deal === 'rent' ? 'ค่าเช่าต่ำสุด' : 'ราคาต่ำสุด';
    var maxWord = state.deal === 'sale' ? 'ราคาขายสูงสุด' : state.deal === 'rent' ? 'ค่าเช่าสูงสุด' : 'ราคาสูงสุด';
    if ($('cmPriceMinLbl')) $('cmPriceMinLbl').textContent = minWord;
    if ($('cmPriceMaxLbl')) $('cmPriceMaxLbl').textContent = maxWord;
  }
  function clearDraft() {
    [].forEach.call(document.querySelectorAll('#cmStatus [data-st]'), function (b) { b.classList.toggle('on', !b.getAttribute('data-st')); });
    [].forEach.call(document.querySelectorAll('#cmBeds [data-bed]'), function (b) { b.classList.remove('on'); });
    [].forEach.call(document.querySelectorAll('#cmDeal [data-deal]'), function (b) { b.classList.toggle('on', b.getAttribute('data-deal') === 'all'); });
    ['cmPriceMin', 'cmPriceMax', 'cmSizeMin', 'cmSizeMax', 'cmSearch'].forEach(function (id) { if ($(id)) $(id).value = ''; });
    if ($('cmFavOnly')) $('cmFavOnly').classList.remove('on');
    if ($('cmPriceMinLbl')) $('cmPriceMinLbl').textContent = 'ราคาต่ำสุด';
    if ($('cmPriceMaxLbl')) $('cmPriceMaxLbl').textContent = 'ราคาสูงสุด';
  }
  function refreshApplyCount() {
    var draft = draftFromDom();
    var n = 0;
    unitList().forEach(function (u) { if (passWith(draft, u)) n++; });
    var btn = $('cmApply');
    if (btn) btn.textContent = 'แสดง (' + n + ')';
  }
  function applyDraft() {
    state = draftFromDom();
    closeFilter(false);
    fitted = false;
    selectedKey = '';
    draw(true);
  }
  function openFilter() {
    paintDraft();
    refreshApplyCount();
    $('cmDim').hidden = false;
    $('cmFilter').hidden = false;
  }
  function closeFilter(revert) {
    if (revert) paintDraft();
    $('cmDim').hidden = true;
    $('cmFilter').hidden = true;
  }
  function setMode(next) {
    mode = next === 'list' ? 'list' : 'map';
    var root = $('viewCondoMap');
    if (root) root.classList.toggle('list-mode', mode === 'list');
    var btn = $('cmListBtn');
    if (btn) btn.classList.toggle('on', mode === 'list');
    if (mode === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 40);
  }

  function onCardClick(e) {
    var card = e.target.closest('.cm-card');
    if (!card) return;
    var id = card.getAttribute('data-id');
    if (id && typeof openDetailView === 'function') openDetailView(id);
  }
  function onRailScroll() {
    if (Date.now() < scrollLock) return;
    clearTimeout(onRailScroll._t);
    onRailScroll._t = setTimeout(snapCard, 90);
  }
  function snapCard() {
    var rail = $('cmRail');
    if (!rail || mode !== 'map') return;
    var edge = rail.getBoundingClientRect().left + 16;
    var best = null, bestD = 1e9;
    [].forEach.call(rail.querySelectorAll('.cm-card'), function (c) {
      var d = Math.abs(c.getBoundingClientRect().left - edge);
      if (d < bestD) { bestD = d; best = c; }
    });
    if (!best) return;
    var key = best.getAttribute('data-key');
    if (!key || key === selectedKey || best.getAttribute('data-placed') !== '1') return;
    selectedKey = key;
    paintSel();
    panTo(key);
  }
  function focusCard(key, smooth) {
    var rail = $('cmRail');
    if (!rail) return;
    var card = null;
    [].forEach.call(rail.querySelectorAll('.cm-card'), function (c) {
      if (!card && c.getAttribute('data-key') === key) card = c;
    });
    if (!card) return;
    scrollLock = Date.now() + (smooth ? 650 : 120);
    rail.scrollTo({ left: Math.max(0, card.offsetLeft - 12), behavior: smooth ? 'smooth' : 'auto' });
  }
  function paintSel() {
    Object.keys(markers).forEach(function (k) {
      var m = markers[k];
      if (m.setZIndexOffset) m.setZIndexOffset(k === selectedKey ? 900 : 0);
      var el = m.getElement();
      if (!el) return;
      var bubble = el.querySelector('.cm-bubble');
      if (bubble) bubble.classList.toggle('sel', k === selectedKey);
    });
    [].forEach.call(document.querySelectorAll('#cmRail .cm-card'), function (c) {
      c.classList.toggle('on', c.getAttribute('data-key') === selectedKey);
    });
  }
  function panTo(key) {
    var m = markers[key];
    if (!m || !map) return;
    var ll = m.getLatLng();
    if (map.getZoom() < 14) map.setView(ll, 14, { animate: true });
    else map.panTo(ll, { animate: true });
  }
  function drawPins() {
    if (!map || !lastGroups || !cluster) return;
    var named = map.getZoom() >= 14;
    cluster.clearLayers();
    Object.keys(markers).forEach(function (k) { if (map.hasLayer(markers[k])) map.removeLayer(markers[k]); });
    markers = {};
    lastGroups.placed.forEach(function (p) {
      var full = named;
      var name = clipName(p.name, full ? 18 : 11);
      var price = pinPrice(p.rooms);
      var w = Math.min(168, Math.max(full ? 88 : 62, Math.round(28 + name.length * (full ? 7 : 6.2))));
      var h = full && price ? 46 : 32;
      var icon = L.divIcon({
        className: 'cm-pin-wrap',
        html: '<div class="cm-bubble' + (full ? '' : ' compact') + (p.key === selectedKey ? ' sel' : '') + '" style="--c:' + availColor(p.rooms) + '"><i class="cm-av"></i><span class="cm-pin-txt"><span class="cm-pin-name">' + esc(name) + '</span>' + (full && price ? '<span class="cm-pin-price">' + esc(price) + '</span>' : '') + '</span></div>',
        iconSize: [w, h],
        iconAnchor: [Math.round(w / 2), h]
      });
      var marker = L.marker([p.dlat, p.dlng], { icon: icon, title: p.name, zIndexOffset: p.key === selectedKey ? 900 : 0 });
      marker.on('click', function (ev) {
        L.DomEvent.stopPropagation(ev);
        selectedKey = p.key;
        drawPins();
        focusCard(p.key, true);
        panTo(p.key);
      });
      markers[p.key] = marker;
      if (named) marker.addTo(map);
      else cluster.addLayer(marker);
    });
  }
  function recenter() {
    if (!map || !lastGroups || !lastGroups.placed.length) {
      if (map) map.setView([13.73, 100.57], 12);
      return;
    }
    var b = L.latLngBounds(lastGroups.placed.map(function (p) { return [p.dlat, p.dlng]; }));
    map.fitBounds(b, { paddingTopLeft: [28, 24], paddingBottomRight: [28, 160], maxZoom: 15 });
    fitted = true;
  }

  function place() {
    var el = $('viewCondoMap'); if (!el) return;
    var desk = window.matchMedia('(min-width: 1024px)').matches;
    if (desk) {
      var side = document.querySelector('.sidebar');
      var left = side ? side.getBoundingClientRect().right : 0;
      el.style.left = Math.max(0, Math.round(left)) + 'px';
    } else el.style.left = '0px';
    el.style.top = '0px';
    el.style.right = '0px';
    el.style.bottom = '0px';
    if (map) setTimeout(function () { map.invalidateSize(); }, 40);
  }

  function show() {
    ensureDom();
    setMode(mode);
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
    boot().then(function () { draw(true); });
  }
  function hide() {
    open = false;
    document.body.classList.remove('condo-map-open');
    var el = $('viewCondoMap');
    if (el) { el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); }
    closeFilter(true);
  }
  function close() {
    hide();
    try { switchView('dashboard'); } catch (e) {}
  }

  function boot() {
    if (ready) return Promise.resolve();
    ready = true;
    return fetch('condo-coords.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('coords');
      return r.json();
    }).then(function (j) {
      db = j; idx = GEO.index(j);
    }).catch(function () {
      loadError = 'โหลดพิกัดไม่สำเร็จ';
      db = { projects: [] }; idx = GEO.index(db);
    });
  }
  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('condoMap', { zoomControl: true, attributionControl: true });
    map.setView([13.73, 100.57], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      disableClusteringAtZoom: 14,
      spiderfyOnMaxZoom: false,
      iconCreateFunction: function (c) {
        return L.divIcon({
          className: 'cm-pin-wrap',
          html: '<div class="cm-cluster">' + c.getChildCount() + '</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });
      }
    });
    map.addLayer(cluster);
    map.on('zoomend', function () { if (open && lastGroups) drawPins(); });
  }

  function cloudThumb(id) {
    try {
      var RS = window.ROOM_SUMMARY;
      var c = RS && RS.coverFor ? RS.coverFor(id) : null;
      return c && c.thumb ? c : null;
    } catch (e) { return null; }
  }
  function armPhotos(root) {
    if (!root) return;
    var imgs = [].slice.call(root.querySelectorAll('img[data-unit]'));
    function load(img) {
      if (img.dataset.loading) return;
      img.dataset.loading = '1';
      var id = img.getAttribute('data-unit');
      var c = cloudThumb(id);
      if (c && c.thumb) {
        img.onerror = function () { img.onerror = null; if (c.full && c.full !== c.thumb) img.src = c.full; };
        img.src = c.thumb;
      }
      if (typeof getUnitPhotos !== 'function') return;
      getUnitPhotos(id).then(function (ps) {
        if (!ps || !ps.length || typeof coverSrc !== 'function') return;
        var url = coverSrc(ps[0]);
        if (url && img.isConnected) img.src = url;
      }).catch(function () {});
    }
    if (typeof IntersectionObserver !== 'function') { imgs.forEach(load); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        load(en.target);
      });
    }, { root: null, rootMargin: '80px' });
    imgs.forEach(function (img) { io.observe(img); });
  }

  function draw(refit) {
    if (!open) return;
    ensureMap();
    var g = groups();
    lastGroups = g;
    var total = 0;
    g.placed.forEach(function (p) { total += p.rooms.length; });
    g.missed.forEach(function (p) { total += p.rooms.length; });
    var count = $('cmCount');
    if (count) count.textContent = loadError ? '(' + loadError + ')' : '(' + total + ' ห้อง)';
    var dot = $('cmFilterDot');
    if (dot) dot.hidden = !filtersOn();
    var favChip = $('cmFavChip');
    if (favChip) favChip.hidden = !state.fav;
    var known = {};
    g.placed.forEach(function (p) { known[p.key] = 1; });
    if (!known[selectedKey]) selectedKey = g.placed.length ? g.placed[0].key : '';

    var rail = $('cmRail');
    if (rail) {
      rail.innerHTML = g.placed.length ? g.placed.map(function (p) {
        return p.rooms.map(function (u) { return cardHTML(u, p.key, true); }).join('');
      }).join('') : '<p class="cm-spec" style="padding:16px;color:#78716c">ไม่มีห้องบนแผนที่</p>';
      armPhotos(rail);
    }
    var list = $('cmList');
    if (list) {
      var html = '';
      if (g.missed.length) {
        var n = 0;
        g.missed.forEach(function (p) { n += p.rooms.length; });
        html += '<p class="cm-sec">ปักหมุดไม่ได้ · ' + g.missed.length + ' โครงการ · ' + n + ' ห้อง</p>';
        html += g.missed.map(function (p) {
          return p.rooms.map(function (u) { return cardHTML(u, p.key, false); }).join('');
        }).join('');
      }
      html += g.placed.map(function (p) {
        return p.rooms.map(function (u) { return cardHTML(u, p.key, true); }).join('');
      }).join('');
      list.innerHTML = html || '<p class="cm-sec">ไม่พบห้องตามตัวกรอง</p>';
      armPhotos(list);
    }

    if (map) {
      drawPins();
      if ((refit || !fitted) && g.placed.length) recenter();
      else setTimeout(function () { map.invalidateSize(); paintSel(); }, 30);
    }
    if (selectedKey) focusCard(selectedKey, false);
  }

  function clearFilters() {
    state.statuses = {};
    state.beds = {};
    state.deal = 'all';
    state.priceMin = state.priceMax = state.sizeMin = state.sizeMax = null;
    state.q = '';
    state.fav = false;
  }
  function enter() {
    keep = true;
    try { switchView('dashboard'); } catch (e) {}
    keep = false;
    show();
  }
  var api = {
    open: function () {
      clearFilters();
      fitted = false;
      selectedKey = '';
      mode = 'map';
      enter();
    },
    openFromList: function () {
      clearFilters();
      try {
        if (typeof activeFilters !== 'undefined' && activeFilters) {
          if (activeFilters.has('FAV')) state.fav = true;
          ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'PENDING'].forEach(function (s) { if (activeFilters.has(s)) state.statuses[s] = 1; });
          if (activeFilters.has('FOR_SALE')) state.deal = 'sale';
        }
      } catch (e) {}
      fitted = false;
      selectedKey = '';
      mode = 'map';
      enter();
    },
    openFav: function () {
      clearFilters();
      state.fav = true;
      fitted = false;
      selectedKey = '';
      mode = 'map';
      enter();
    },
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
