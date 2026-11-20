import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

function regexStart(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if ('([{=,:;!&|?+-*%^~<>{}'.includes(c)) return true;
  return /(?:return|typeof|case|else|void|do|throw|in|of|instanceof|delete|await|yield)$/.test(src.slice(Math.max(0, j - 12), j + 1));
}

function endOfFunction(src, fnStart) {
  const braceAt = src.indexOf('{', fnStart);
  if (braceAt < 0) throw new Error('no body');
  const opens = ['fn'];
  const lex = ['code'];
  let i = braceAt + 1;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const s = lex[lex.length - 1];
    if (s === 'line') {
      if (c === '\n') lex.pop();
      i++;
      continue;
    }
    if (s === 'block') {
      if (c === '*' && n === '/') { i += 2; lex.pop(); continue; }
      i++;
      continue;
    }
    if (s === 'sq' || s === 'dq') {
      const q = s === 'sq' ? "'" : '"';
      if (c === '\\') { i += 2; continue; }
      if (c === q) lex.pop();
      i++;
      continue;
    }
    if (s === 'tmpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { lex.pop(); i++; continue; }
      if (c === '$' && n === '{') { lex.push('code'); opens.push('subst'); i += 2; continue; }
      i++;
      continue;
    }
    if (s === 'reclass') {
      if (c === '\\') { i += 2; continue; }
      if (c === ']') lex.pop();
      i++;
      continue;
    }
    if (s === 'regex') {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { lex.push('reclass'); i++; continue; }
      if (c === '\n') { lex.pop(); continue; }
      if (c === '/') { lex.pop(); i++; while (/[a-z]/i.test(src[i])) i++; continue; }
      i++;
      continue;
    }
    if (c === '/' && n === '/') { lex.push('line'); i += 2; continue; }
    if (c === '/' && n === '*') { lex.push('block'); i += 2; continue; }
    if (c === "'") { lex.push('sq'); i++; continue; }
    if (c === '"') { lex.push('dq'); i++; continue; }
    if (c === '`') { lex.push('tmpl'); i++; continue; }
    if (c === '{') { opens.push('block'); i++; continue; }
    if (c === '}') {
      const kind = opens.pop();
      if (kind === 'subst') lex.pop();
      if (!opens.length) return i + 1;
      i++;
      continue;
    }
    if (c === '/' && regexStart(src, i)) { lex.push('regex'); i++; continue; }
    i++;
  }
  throw new Error('unterminated function at ' + fnStart);
}

function grab(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('missing function ' + name);
  return src.slice(m.index, endOfFunction(src, m.index));
}

function el() {
  const classes = new Set();
  const node = {
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    checked: false,
    disabled: false,
    offsetHeight: 1,
    scrollTop: 0,
    classList: {
      add: (...xs) => xs.forEach(x => classes.add(x)),
      remove: (...xs) => xs.forEach(x => classes.delete(x)),
      toggle(name, on) {
        const next = on === undefined ? !classes.has(name) : !!on;
        if (next) classes.add(name); else classes.delete(name);
        return next;
      },
      contains: name => classes.has(name)
    }
  };
  let value = '';
  Object.defineProperty(node, 'value', {
    get() { return value; },
    set(v) { value = v == null ? '' : String(v); }
  });
  return node;
}

function sampleUnit(extra) {
  return Object.assign({
    id: 'u1',
    project: 'Life Asoke',
    building: 'Tower A',
    room: '1201',
    floor: '12',
    station: 'BTS Asok',
    stationDist: 400,
    rent: 18000,
    size: 35,
    type: '1 Bed',
    bath: '1',
    view: 'City',
    status: 'OCCUPIED',
    salePrice: 3500000,
    sourceUrl: 'https://example.test/post',
    tiktokUrl: 'https://vt.tiktok.com/ZSabc123',
    owner: 'May',
    ownerPhone: '0812345678',
    ownerLine: 'mayline',
    start: '2025-01-01',
    end: '2026-12-01',
    notes: 'ใกล้ BTS เฟอร์นิเจอร์ครบ',
    internalNote: 'do not publish',
    fav: true,
    createdAt: 1700000000000,
    lastPosted: 1700001000000,
    postCount: 4,
    expiredNotified: false,
    share: { id: 'sh1', secret: 'sec', imgs: ['a.jpg', 'b.jpg'] }
  }, extra || {});
}

function loadApp(unit) {
  const html = read('index.html');
  const photos = new Map();
  const deletes = [];
  const puts = [];
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, el());
      return nodes.get(id);
    },
    body: el(),
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const mem = new Map();
  const localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); }
  };
  const sandbox = {
    units: [unit],
    customers: [],
    detailUnitId: unit.id,
    currentFormUnitId: null,
    photoCount: { [unit.id]: 2 },
    db: { name: 'staylow_photos' },
    EXPIRY_DAYS: 30,
    KEY: 'staylow_units_v1',
    document,
    localStorage,
    console,
    Date, Math, Number, String, JSON, Object, Array, Promise, Map, Set,
    lucide: { createIcons() {} },
    miniPhotoCache: { delete() {} },
    cloudCover() { return null; },
    closeAllSheets() {},
    hideProjectSuggest() {},
    updateUrlBtn() {},
    closeDetailView() { throw new Error('detail closed'); },
    statusOf() { return { cls: 'st', dot: 'dot', label: 'มีผู้เช่า' }; },
    postedState() { return { cls: 'ps', label: 'ยังไม่โพสต์' }; },
    esc(s) { return String(s ?? ''); },
    isValidUrl(url) { return /^https?:\/\//i.test(url || ''); },
    normalizeUrl(url) { return url || ''; },
    baht(n) { return '฿' + n; },
    fmtDate(d) { return d || '-'; },
    toast() {},
    render() {},
    noteRoomPhotosChanged() {},
    refreshCounts() { return Promise.resolve(); },
    thumbUrlOf(p) { return 'thumb:' + p.id; },
    async processPhoto(file) {
      const n = puts.length + photos.size + 1;
      return [{ kind: 'full', n, name: file.name }, { kind: 'thumb', n, name: file.name }];
    },
    requestAnimationFrame(fn) { fn(); },
    confirm() { return false; }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.tx = function () {
    return {
      put(rec) {
        const prev = photos.has(rec.id) ? photos.get(rec.id) : null;
        puts.push({ id: rec.id, existed: !!prev });
        photos.set(rec.id, rec);
        return { result: rec };
      },
      delete(id) { deletes.push(id); photos.delete(id); return { result: undefined }; },
      getAll() { return { result: [...photos.values()] }; },
      index() {
        return {
          getAll(unitId) {
            return { result: [...photos.values()].filter(p => p.unitId === unitId) };
          }
        };
      }
    };
  };
  sandbox.req = r => Promise.resolve(r.result);
  sandbox.getUnitPhotos = unitId => sandbox.req(sandbox.tx('readonly').index('unit').getAll(unitId))
    .then(a => a.sort((x, y) => (x.order ?? x.ts ?? 0) - (y.order ?? y.ts ?? 0)));
  const fMatch = html.match(/const F = (\[[\s\S]*?\]);/);
  if (!fMatch) throw new Error('missing field list');
  const src = [
    grab(html, 'daysLeft'),
    grab(html, 'persist'),
    'const F = ' + fMatch[1],
    grab(html, 'toggleSalePrice'),
    grab(html, 'openSheet'),
    grab(html, 'saveUnit'),
    grab(html, 'importFormPhotos'),
    grab(html, 'renderFormPhotos'),
    grab(html, 'renderDetailView'),
    grab(html, 'editCurrentRoom')
  ].join('\n');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'index.html' });
  return { sandbox, photos, deletes, puts, nodes, mem, html };
}

test('the room detail page renders a แก้ไขห้อง entry that opens the existing edit sheet', () => {
  const html = read('index.html');
  const detailStart = html.indexOf('id="detailViewContent"');
  const detailEnd = html.indexOf('id="overlay"');
  const detail = html.slice(detailStart, detailEnd);
  assert.ok(detailStart > 0 && detailEnd > detailStart);
  const navAt = html.indexOf('class="bottom-nav-new');
  const nav = html.slice(navAt, html.indexOf('</nav>', navAt));
  assert.equal(nav.includes('แก้ไขห้อง'), false);
  assert.match(nav, /ภาพรวม/);
  assert.match(nav, /ห้องพัก/);
  assert.match(nav, /ลูกค้า/);
  assert.match(nav, /ตั้งค่า/);
  assert.equal(read('room.html').includes('แก้ไขห้อง'), false);
  assert.equal(read('room.html').includes('dvEditRoom'), false);

  const unit = sampleUnit();
  const app = loadApp(unit);
  app.sandbox.renderDetailView();
  const rendered = app.nodes.get('detailContent').innerHTML;
  assert.match(rendered, /id="dvEditRoom"/);
  assert.match(rendered, /แก้ไขห้อง/);
  assert.match(rendered, /editCurrentRoom\(\)/);
  assert.match(html, /\.dv-edit\{[^}]*#c2552d/);
  assert.match(html, /const APP_VERSION = '9\.49'/);
  assert.match(read('sw.js'), /const VERSION = 'v88'/);

  app.sandbox.editCurrentRoom();
  const sheet = app.nodes.get('sheet');
  assert.equal(sheet.classList.contains('open'), true);
  assert.match(app.nodes.get('sheetTitle').textContent, /แก้ไข/);
  assert.equal(app.nodes.get('f_id').value, 'u1');
  assert.equal(app.nodes.get('f_isTemp').value, '');
  assert.equal(app.nodes.get('f_status').value, 'OCCUPIED');
  assert.equal(app.nodes.get('f_end').value, '2026-12-01');
  assert.equal(app.nodes.get('f_project').value, 'Life Asoke');
  assert.match(html, /id="f_end"[^>]*type="date"/);
  assert.match(html, /วันหมดสัญญา/);
  assert.match(html, /<select id="f_status"[\s\S]*value="AVAILABLE"[\s\S]*value="OCCUPIED"/);
});

test('editing status and contract end persists through the normal save and leaves every other field untouched', () => {
  const unit = sampleUnit();
  const before = JSON.parse(JSON.stringify(unit));
  const app = loadApp(unit);
  app.sandbox.openSheet('edit', unit.id);
  app.nodes.get('f_status').value = 'AVAILABLE';
  app.nodes.get('f_end').value = '2027-06-30';
  app.sandbox.saveUnit();
  assert.equal(unit.status, 'AVAILABLE');
  assert.equal(unit.end, '2027-06-30');
  for (const key of Object.keys(before)) {
    if (key === 'status' || key === 'end') continue;
    assert.deepEqual(unit[key], before[key], key);
  }
  const saved = JSON.parse(app.mem.get('staylow_units_v1'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'AVAILABLE');
  assert.equal(saved[0].end, '2027-06-30');
  assert.equal(saved[0].project, 'Life Asoke');
  assert.equal(saved[0].share.secret, 'sec');
  assert.equal(saved[0].notes, before.notes);
  const html = read('index.html');
  const saveFn = grab(html, 'saveUnit');
  assert.match(saveFn, /persist\(\)/);
  assert.equal(saveFn.includes('supabase'), false);
  assert.equal(saveFn.includes('service_role'), false);
  const sync = read('sync.js');
  assert.match(sync, /key: 'staylow_units_v1'/);
  assert.match(sync, /Storage\.prototype\.setItem = function \(k, v\)/);
  assert.match(sync, /schedule\(1500\)/);
  assert.equal(app.nodes.get('sheet').classList.contains('open'), false);
});

test('adding photos appends to the existing album and does not delete, reorder, or overwrite', async () => {
  const unit = sampleUnit();
  const app = loadApp(unit);
  const existing = [
    { id: 'pA', unitId: 'u1', full: { n: 1 }, thumb: { n: 1 }, ts: 10, order: 10, cover: true },
    { id: 'pB', unitId: 'u1', full: { n: 2 }, thumb: { n: 2 }, ts: 20, order: 20, cover: false }
  ];
  existing.forEach(p => app.photos.set(p.id, p));
  const snapshot = existing.map(p => JSON.parse(JSON.stringify(p)));
  app.sandbox.openSheet('edit', unit.id);
  await app.sandbox.importFormPhotos([{ name: 'extra-1.jpg' }, { name: 'extra-2.jpg' }]);
  assert.equal(app.deletes.length, 0);
  assert.equal(app.puts.length, 2);
  assert.equal(app.puts.every(p => p.existed === false), true);
  for (const prev of snapshot) {
    assert.deepEqual(app.photos.get(prev.id), prev);
  }
  const list = await app.sandbox.getUnitPhotos('u1');
  assert.deepEqual(list.map(p => p.id).slice(0, 2), ['pA', 'pB']);
  assert.equal(list.length, 4);
  assert.ok(list[2].order >= 20 && list[3].order >= list[2].order);
  assert.equal(list[2].unitId, 'u1');
  assert.equal(list[3].unitId, 'u1');
  assert.notEqual(list[2].id, list[3].id);
  await app.sandbox.renderFormPhotos();
  const grid = app.nodes.get('fPhotoGrid').innerHTML;
  assert.equal(grid.includes('deleteFormPhoto'), false);
  assert.match(grid, /thumb:pA/);
  assert.match(grid, /thumb:pB/);
  assert.equal((grid.match(/mini-photo/g) || []).length, 4);
  const fn = grab(read('index.html'), 'importFormPhotos');
  assert.match(fn, /tx\('readwrite'\)\.put\(/);
  assert.equal(fn.includes('deleteFormPhoto'), false);
  assert.equal(/tx\([^)]*\)\.delete\(/.test(fn), false);
  assert.equal(fn.includes('.clear('), false);
  const sync = read('sync.js');
  assert.match(sync, /mode === 'readwrite'/);
  assert.match(sync, /schedule\(2500\)/);
});
