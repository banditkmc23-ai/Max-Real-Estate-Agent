import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const PUB = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/';
const PUBLIC_KEYS = ['id', 'p', 'b', 't', 'sz', 'bt', 'f', 'vw', 'rent', 'sale', 'cover'];
const N = 500;

function sid(n) {
  const s = 'R' + String(n).padStart(5, '0');
  if (!/^[A-Za-z0-9]{6}$/.test(s)) throw new Error('bad fixture id ' + s);
  return s;
}

function serverFns() {
  const ts = read('supabase/functions/share-room/index.ts');
  const start = ts.indexOf('const IN_CHUNK');
  const end = ts.indexOf('// Photo counts for cards.');
  assert.ok(start > 0 && end > start);
  const src = [
    'const str = (v, n) => String(v ?? "").slice(0, n);',
    'const num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x < 1e10 ? x : 0; };',
    'const PUB = ' + JSON.stringify(PUB) + ';',
    ts.slice(start, end),
    '({ IN_CHUNK, mapIdChunks, catalogRooms, dropMissing })'
  ].join('\n');
  return vm.runInNewContext(src, {});
}

function room(i, extra) {
  return Object.assign({
    id: sid(i),
    p: i === 460 ? 'Chalermnit Art De Maison' : i === 461 ? 'Rhythm Ekkamai' : i === 462 ? 'Noble Remix' : 'Tower ' + i,
    b: 'Tower B',
    t: '1 Bed',
    sz: 30 + (i % 9),
    bt: '1',
    f: String(1 + (i % 30)),
    vw: 'city',
    rent: 20000 + i,
    sale: i % 19 === 0 ? 4000000 : 0,
    cover: PUB + sid(i) + '/a.jpg',
    r: 'RM-SECRET-' + i,
    owner: 'OWNER-SECRET',
    phone: '062-SECRET',
    line: 'LINE-SECRET',
    notes: 'NOTE-SECRET',
    commission: 'COMM-SECRET',
    sourceUrl: 'https://secret.example/src/' + i
  }, extra);
}

test('catalog build keeps every shared room past 200 and strips private fields', async () => {
  const edge = read('supabase/functions/share-room/index.ts');
  const catalog = edge.slice(edge.indexOf('body.action === "catalog"'), edge.indexOf('body.action === "cover-thumbs"'));
  assert.equal(catalog.includes('slice(0, 200)'), false);
  assert.equal(catalog.includes('.limit('), false);
  assert.equal(catalog.includes('.range('), false);
  assert.match(catalog, /catalogRooms\(body\.rooms\)/);
  assert.match(catalog, /mapIdChunks/);
  assert.match(catalog, /dropMissing/);

  const S = serverFns();
  assert.equal(S.IN_CHUNK, 500);
  const input = [];
  for (let i = 0; i < N; i++) input.push(room(i));
  input.push(room(900, { id: 'short', p: 'Bad id' }));
  input.push(null);
  input.push(room(901, { cover: 'https://evil.example/secret.jpg' }));
  const built = S.catalogRooms(input);
  assert.equal(built.length, N + 1);
  assert.equal(built[0].id, sid(0));
  assert.equal(built[N - 1].id, sid(N - 1));
  assert.equal(built[N].id, sid(901));
  assert.equal(built[N].cover, '');
  const blob = JSON.stringify(built);
  for (const secret of ['RM-SECRET', 'OWNER-SECRET', '062-SECRET', 'LINE-SECRET', 'NOTE-SECRET', 'COMM-SECRET', 'secret.example']) {
    assert.equal(blob.includes(secret), false, secret);
  }
  for (const row of built) assert.deepEqual(Object.keys(row).sort(), PUBLIC_KEYS.slice().sort());
  assert.equal(built.some(r => r.p === 'Chalermnit Art De Maison'), true);
  assert.equal(built.some(r => r.p === 'Rhythm Ekkamai'), true);
  assert.equal(built.some(r => r.p === 'Noble Remix'), true);

  const live = new Set();
  for (let i = 0; i < N; i++) live.add(sid(i));
  const kept = S.dropMissing(built, live);
  assert.equal(kept.length, N);
  assert.equal(kept.some(r => r.id === sid(901)), false);
  assert.equal(kept[0].id, sid(0));
  assert.equal(kept[N - 1].id, sid(N - 1));

  const seen = [];
  const ids = [];
  for (let i = 0; i < 1200; i++) ids.push(sid(i));
  const chunks = await S.mapIdChunks(ids, async (part) => {
    assert.ok(part.length <= S.IN_CHUNK);
    assert.ok(part.length <= 1000);
    seen.push(part.length);
    return part;
  });
  assert.deepEqual(seen, [500, 500, 200]);
  assert.equal(chunks.flat().length, 1200);
  assert.equal(chunks.flat()[1199], sid(1199));
});

function bootPublisher() {
  const featureSrc = read('features.js');
  const document = {
    body: { style: {}, insertAdjacentHTML() {} },
    head: { insertAdjacentHTML() {} },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {} }, getContext() { return { drawImage() {} }; } }; },
    addEventListener() {}
  };
  const store = new Map();
  const units = [];
  const calls = [];
  const sandbox = {
    console,
    document,
    navigator: { onLine: true, userAgent: 'test', clipboard: { writeText: async () => {} } },
    location: { origin: 'https://banditkmc23-ai.github.io', pathname: '/Max-Real-Estate-Agent/index.html', href: 'https://banditkmc23-ai.github.io/Max-Real-Estate-Agent/index.html' },
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    crypto: globalThis.crypto,
    units,
    customers: [],
    alert() {},
    confirm() { return false; },
    scrollTo() {},
    open() { return null; },
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    btoa(s) { return Buffer.from(s, 'binary').toString('base64'); },
    atob(s) { return Buffer.from(s, 'base64').toString('binary'); },
    TextEncoder,
    fetch(url, opt = {}) {
      const method = opt.method || 'GET';
      let body = null;
      if (typeof opt.body === 'string') body = JSON.parse(opt.body);
      calls.push({ url: String(url), method, body });
      if (String(url).includes('/functions/v1/share-room') && method === 'POST' && body && body.action === 'catalog') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'BPCS2D', count: body.rooms.length }) });
      }
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'unexpected' }) });
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.persist = () => {};
  sandbox.getPostConfig = () => ({ agentName: 'Max', phone: '0622423154', lineId: '@max' });
  vm.createContext(sandbox);
  vm.runInContext(featureSrc, sandbox, { filename: 'features.js' });
  sandbox.FX.sbc = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } };
  sandbox.FX.buildRoomLink = async () => { throw new Error('no share link'); };
  return { sandbox, units, calls };
}

test('the owner publish sends every available shared room, not the first 200', async () => {
  const features = read('features.js');
  const pub = features.slice(features.indexOf('async function publish'), features.indexOf('FX.publishCatalog'));
  assert.equal(/slice\(\s*0\s*,\s*200\s*\)/.test(pub), false);
  assert.equal(pub.includes('.limit('), false);
  assert.equal(pub.includes('.range('), false);
  assert.match(pub, /u\.status === 'AVAILABLE'/);

  const h = bootPublisher();
  for (let i = 0; i < N; i++) {
    h.units.push({
      id: 'u' + i,
      project: i === 460 ? 'Chalermnit Art De Maison' : i === 461 ? 'Rhythm Ekkamai' : i === 462 ? 'Noble Remix' : 'Tower ' + i,
      building: 'Tower B',
      room: 'RM-SECRET-' + i,
      rent: 20000 + i,
      salePrice: 0,
      status: 'AVAILABLE',
      type: '1 Bed',
      size: 32,
      bath: '1',
      floor: '8',
      view: 'city',
      owner: 'OWNER-SECRET',
      ownerPhone: '062-SECRET',
      lineId: 'LINE-SECRET',
      notes: 'NOTE-SECRET',
      commission: 'COMM-SECRET',
      sourceUrl: 'https://secret.example/src/' + i,
      share: { id: sid(i), cover: PUB + sid(i) + '/a.jpg', secret: 's'.repeat(24) }
    });
  }
  h.units.push({ id: 'occ', project: 'Occupied Only', room: 'RM-SECRET-OCC', status: 'OCCUPIED', rent: 99999, share: { id: sid(800), cover: PUB + sid(800) + '/a.jpg' } });
  h.units.push({ id: 'noshare', project: 'Unshared Only', room: 'RM-SECRET-NONE', status: 'AVAILABLE', rent: 88888 });
  const saved = await h.sandbox.FX.publishCatalog();
  assert.equal(saved.id, 'BPCS2D');
  assert.equal(saved.count, N);
  const post = h.calls.filter(c => c.body && c.body.action === 'catalog');
  assert.equal(post.length, 1);
  const rooms = post[0].body.rooms;
  assert.equal(rooms.length, N);
  assert.equal(rooms[0].id, sid(0));
  assert.equal(rooms[N - 1].id, sid(N - 1));
  assert.equal(rooms.some(r => r.p === 'Chalermnit Art De Maison'), true);
  assert.equal(rooms.some(r => r.p === 'Rhythm Ekkamai'), true);
  assert.equal(rooms.some(r => r.p === 'Noble Remix'), true);
  assert.equal(rooms.some(r => r.p === 'Occupied Only'), false);
  assert.equal(rooms.some(r => r.p === 'Unshared Only'), false);
  const blob = JSON.stringify(rooms);
  for (const secret of ['RM-SECRET', 'OWNER-SECRET', '062-SECRET', 'LINE-SECRET', 'NOTE-SECRET', 'COMM-SECRET', 'secret.example']) {
    assert.equal(blob.includes(secret), false, secret);
  }
  for (const row of rooms) assert.deepEqual(Object.keys(row).sort(), PUBLIC_KEYS.slice().sort());
  const S = serverFns();
  const kept = S.dropMissing(S.catalogRooms(rooms), rooms.map(r => r.id));
  assert.equal(kept.length, N);
});

function scan(html, sel) {
  const out = [];
  const tagRe = /<([a-zA-Z0-9]+)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const attrs = {};
    const attrRe = /([:@\w-]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2] == null ? '' : a[2];
    const dataset = {};
    for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[k.slice(5)] = v;
    const cls = (attrs.class || '').split(/\s+/);
    const node = {
      tag: m[1].toLowerCase(),
      attrs,
      dataset,
      className: attrs.class || '',
      style: {},
      onclick: null,
      isConnected: true,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      setAttribute(k, v) { attrs[k] = v; },
      querySelector(s) { return s === '.xp' ? { insertAdjacentHTML() {} } : null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    };
    const hit = sel === '.hd' ? cls.includes('hd')
      : sel === '.mq' ? cls.includes('mq')
      : sel === 'a.xc' ? node.tag === 'a' && cls.includes('xc')
      : sel === '[data-z]' ? Object.prototype.hasOwnProperty.call(attrs, 'data-z')
      : sel === '[data-z2]' ? Object.prototype.hasOwnProperty.call(attrs, 'data-z2')
      : sel === '[data-m]' ? Object.prototype.hasOwnProperty.call(attrs, 'data-m')
      : false;
    if (hit) out.push(node);
  }
  return out;
}

function pageDom() {
  const registry = new Map();
  function make(id) {
    const node = {
      id: id || '',
      style: { display: '' },
      textContent: '',
      value: '',
      className: '',
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {},
      getAttribute() { return null; },
      addEventListener() {},
      appendChild() {},
      insertAdjacentHTML() {}
    };
    let html = '';
    const cache = new Map();
    Object.defineProperty(node, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); cache.clear(); harvest(html); }
    });
    node.querySelector = sel => node.querySelectorAll(sel)[0] || null;
    node.querySelectorAll = sel => {
      const key = sel + '\0' + html;
      if (cache.has(key)) return cache.get(key);
      const found = scan(html, sel);
      cache.set(key, found);
      return found;
    };
    if (id) registry.set(id, node);
    return node;
  }
  function harvest(html) {
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) if (!registry.has(m[1])) make(m[1]);
  }
  const document = {
    documentElement: { lang: 'th' },
    title: '',
    body: make('body'),
    head: make('head'),
    getElementById(id) { return registry.get(id) || null; },
    querySelector(sel) { return document.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      for (const el of registry.values()) if (el.querySelectorAll) out.push(...el.querySelectorAll(sel));
      return out;
    },
    createElement() { return make(); },
    addEventListener() {}
  };
  for (const id of ['app', 'fab', 'map', 'sheet', 'mtop']) make(id);
  return { document, registry };
}

test('the public catalog page renders all 500 rooms in the list and in a zone', async () => {
  const agent = read('agent.html');
  const renderSrc = agent.slice(agent.indexOf('function render()'), agent.indexOf('function bindHead'));
  assert.equal(/slice\(\s*0\s*,\s*\d+\s*\)/.test(renderSrc), false);
  assert.equal(renderSrc.includes('.limit('), false);
  const script = agent.slice(agent.lastIndexOf('<script>') + '<script>'.length, agent.lastIndexOf('</script>'));
  const rooms = [];
  for (let i = 0; i < N; i++) {
    const row = room(i);
    rooms.push({ id: row.id, p: row.p, b: row.b, t: row.t, sz: row.sz, bt: row.bt, f: row.f, vw: row.vw, rent: row.rent, sale: row.sale, cover: row.cover, n: 1, r: row.r, notes: row.notes });
  }
  const { document } = pageDom();
  const store = new Map();
  const sandbox = {
    console,
    document,
    location: { search: '?id=BPCS2D', hash: '', pathname: '/Max-Real-Estate-Agent/agent.html' },
    localStorage: { getItem(k) { return store.has(k) ? store.get(k) : null; }, setItem(k, v) { store.set(k, String(v)); } },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    navigator: { userAgent: 'test' },
    scrollTo() {},
    fetch(url) {
      const u = String(url);
      if (u.includes('/functions/v1/share-room?cat=')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { v: 1, agent: { n: 'Max', l: '@max', ph: '0622423154' }, rooms }, updated_at: '2026-11-19T12:23:00.000Z' }) });
      }
      if (u.includes('/rest/v1/projects')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    },
    URLSearchParams,
    IntersectionObserver: undefined
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('catalog-covers.js'), sandbox, { filename: 'catalog-covers.js' });
  vm.runInContext(read('geo.js'), sandbox, { filename: 'geo.js' });
  vm.runInContext(script, sandbox, { filename: 'agent.html' });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  const body = () => document.getElementById('body').innerHTML;
  const cards = html => (html.match(/class="xc"/g) || []).length;
  assert.match(document.getElementById('app').innerHTML, /ห้องว่าง 500 ห้อง/);
  assert.equal(cards(body()), N);
  assert.match(body(), /Chalermnit Art De Maison/);
  assert.match(body(), /Rhythm Ekkamai/);
  assert.match(body(), /Noble Remix/);
  assert.equal(body().includes('RM-SECRET'), false);
  assert.equal(body().includes('NOTE-SECRET'), false);
  const seeAll = document.getElementById('body').querySelectorAll('[data-z2]');
  assert.ok(seeAll.length >= 1);
  seeAll[0].onclick();
  assert.match(body(), /class="grid"/);
  assert.equal(cards(body()), N);
  assert.equal(body().includes('RM-SECRET'), false);
  const all = document.querySelectorAll('[data-z]').find(b => b.dataset.z === '');
  assert.ok(all);
  all.onclick();
  assert.match(body(), /class="mq"/);
  assert.equal(cards(body()), N);
  const q = document.getElementById('q');
  q.value = 'Chalermnit';
  q.oninput();
  assert.equal(cards(body()), 1);
  assert.match(body(), /Chalermnit Art De Maison/);
  q.value = 'Rhythm Ekkamai';
  q.oninput();
  assert.equal(cards(body()), 1);
  q.value = 'Noble Remix';
  q.oninput();
  assert.equal(cards(body()), 1);
  q.value = '';
  q.oninput();
  assert.equal(cards(body()), N);
  assert.equal(document.getElementById('fab').style.display, '');
});
