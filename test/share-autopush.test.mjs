import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SHAPE = require('../unit-shape.js');
const root = new URL('..', import.meta.url);
const featureSrc = fs.readFileSync(new URL('features.js', root), 'utf8');
const PUBP = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/';

function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = [];
  function setTimeout(fn, ms, ...args) {
    const id = nextId++;
    timers.push({ id, fn, args, at: now + (Number(ms) || 0), interval: false });
    return id;
  }
  function setInterval(fn, ms, ...args) {
    const id = nextId++;
    const every = Number(ms) || 0;
    timers.push({ id, fn, args, at: now + every, interval: true, every });
    return id;
  }
  function clear(id) {
    if (id == null) return;
    const i = timers.findIndex(t => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  }
  function tick(ms) {
    const dest = now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      let next = null;
      for (const t of timers) {
        if (t.at <= dest && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      }
      if (!next) break;
      now = next.at;
      if (next.interval) next.at = now + next.every;
      else timers.splice(timers.indexOf(next), 1);
      next.fn(...next.args);
    }
    now = dest;
  }
  return { setTimeout, setInterval, clearTimeout: clear, clearInterval: clear, tick };
}

function makeDocument() {
  const registry = new Map();
  function make(id) {
    const node = {
      id: id || '',
      className: '',
      textContent: '',
      value: '',
      style: {},
      dataset: {},
      scrollTop: 0,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      insertAdjacentHTML(_pos, html) { harvest(String(html)); },
      querySelector(sel) { return bySel(sel); },
      querySelectorAll() { return []; },
      setAttribute() {},
      getAttribute() { return null; },
      addEventListener() {},
      removeEventListener() {},
      appendChild() {},
      scrollTo() {}
    };
    let html = '';
    Object.defineProperty(node, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); harvest(html); }
    });
    if (id) registry.set(id, node);
    return node;
  }
  function harvest(html) {
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) if (!registry.has(m[1])) make(m[1]);
  }
  function bySel(sel) {
    const m = String(sel || '').match(/#([\w-]+)/);
    return m ? (registry.get(m[1]) || null) : null;
  }
  const body = make('body');
  const head = make('head');
  return {
    body,
    head,
    getElementById(id) { return registry.get(id) || null; },
    querySelector(sel) { return bySel(sel); },
    querySelectorAll() { return []; },
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext() { return { drawImage() {} }; },
          toBlob(cb) { cb(new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })); }
        };
      }
      return make();
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function boot() {
  const clock = makeClock();
  const document = makeDocument();
  const store = new Map();
  const listeners = new Map();
  const calls = [];
  const photos = new Map();
  const held = new Set();
  const units = [];
  const acked = new Map();
  const state = { persistCalls: 0, markDirtyCalls: 0, dirty: [] };
  const sandbox = {
    console,
    document,
    navigator: { onLine: true, userAgent: 'test', clipboard: { writeText: async () => {} } },
    location: { origin: 'https://staylow.test', pathname: '/index.html', href: 'https://staylow.test/index.html' },
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    crypto: globalThis.crypto,
    UNIT_SHAPE: SHAPE,
    units,
    customers: [],
    alert() {},
    confirm() { return false; },
    scrollTo() {},
    open() { return null; },
    btoa(s) { return Buffer.from(s, 'binary').toString('base64'); },
    atob(s) { return Buffer.from(s, 'base64').toString('binary'); },
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener() {},
    fetch(url, opt) { return fakeFetch(url, opt); }
  };
  function markDirty(key) {
    state.markDirtyCalls++;
    state.dirty.push(key);
  }
  function persist() {
    state.persistCalls++;
    for (const u of sandbox.units) {
      const h = SHAPE.canonicalJson('unit', u);
      if (acked.get(u.id) !== h) markDirty('unit|' + u.id);
    }
  }
  sandbox.persist = persist;
  sandbox.getPostConfig = () => ({ agentName: 'Max', phone: '0812345678', lineId: '@max' });
  sandbox.getUnitPhotos = async id => {
    if (held.has(id)) return [];
    return (photos.get(id) || []).map(p => ({ ...p }));
  };
  async function fakeFetch(url, opt = {}) {
    const u = String(url);
    const method = opt.method || 'GET';
    let body = null;
    if (typeof opt.body === 'string') { try { body = JSON.parse(opt.body); } catch (e) { body = null; } }
    calls.push({ url: u, method, body });
    const json = (status, data) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
      blob: async () => new Blob(['img']),
      headers: { get: () => 'image/jpeg' }
    });
    if (u.includes('/functions/v1/share-room') && method === 'GET') {
      return json(200, { data: { imgs: [PUBP + 'pub/a.jpg'], hr: 0, r: '101', a: { ph: '0812345678', n: 'Max' } } });
    }
    if (u.includes('/functions/v1/share-room') && method === 'POST') {
      const b = body || {};
      if (b.action === 'init') {
        const id = b.id || 'new';
        return json(200, {
          id,
          v: 'vt',
          uploads: [],
          og: b.og ? { path: id + '/og-auto.jpg', token: 'tok', name: 'og-auto.jpg' } : null
        });
      }
      if (b.action === 'commit') {
        return json(200, { id: b.id, imgs: (b.images || []).map(im => im.url), og: b.og || '' });
      }
      return json(400, { error: 'unknown action' });
    }
    if (method === 'PUT') return json(200, {});
    return json(200, {});
  }
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(featureSrc, sandbox, { filename: 'features.js' });
  sandbox.FX.sbc = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } };
  if (sandbox.persist === persist) throw new Error('persist wrapper was not installed');

  function shareSnap() { return sandbox.units.map(u => JSON.stringify(u.share)); }
  function ogUploads() { return calls.filter(c => c.method === 'PUT' && c.url.includes('/og-')); }
  function commits() { return calls.filter(c => c.method === 'POST' && c.body && c.body.action === 'commit'); }
  function inits() { return calls.filter(c => c.method === 'POST' && c.body && c.body.action === 'init'); }
  function shareGets() { return calls.filter(c => c.method === 'GET' && c.url.includes('/functions/v1/share-room')); }
  async function flush() {
    for (let i = 0; i < 6; i++) {
      clock.tick(0);
      await new Promise(r => setImmediate(r));
    }
  }
  async function advance(ms) {
    clock.tick(ms);
    await new Promise(r => setImmediate(r));
    await flush();
  }
  function emitOnline() {
    for (const fn of listeners.get('online') || []) fn();
  }
  function pull() {
    sandbox.units = SHAPE.normalizeUnits(JSON.parse(JSON.stringify(sandbox.units)));
  }
  return {
    sandbox, photos, held, acked, state, listeners, calls,
    shareSnap, ogUploads, commits, inits, shareGets, advance, emitOnline, pull, markDirty
  };
}

function loadUnits(h) {
  const { sandbox, photos, held, acked } = h;
  for (let i = 0; i < 390; i++) {
    const id = 'u' + i;
    const share = {
      id: 's' + i,
      secret: 'sec' + i,
      sig: 'stale-from-other-browser-' + i,
      textSig: 'stale-text-' + i,
      og: 'og-old-' + i + '.jpg',
      ogKey: 'not-the-cover',
      cover: PUBP + 's' + i + '/cover.jpg',
      at: 1700000000000
    };
    if (i >= 30) share.opts = { hideRoom: false, showPhone: true, photo: true };
    sandbox.units.push({
      id,
      project: i === 389 ? 'New Tower' : 'The Base Park East',
      room: String(100 + i),
      rent: 16000 + i,
      status: i % 5 === 0 ? 'OCCUPIED' : 'AVAILABLE',
      notes: 'ใกล้ BTS ' + i,
      type: '1 Bed',
      size: 32,
      floor: '8',
      owner: 'Owner ' + i,
      ownerPhone: '0622423154',
      fav: i % 11 === 0,
      share
    });
    photos.set(id, [
      { id: 'p' + i + 'a', url: PUBP + 's' + i + '/a.jpg', cover: true, order: 1 },
      { id: 'p' + i + 'b', url: PUBP + 's' + i + '/b.jpg', cover: false, order: 2 }
    ]);
    if (i >= 30 && i < 40) held.add(id);
    acked.set(id, SHAPE.canonicalJson('unit', sandbox.units[i]));
  }
}

test('loading or pulling 390 units, the timer, and online do not persist, markDirty, or upload og', async () => {
  const bg = featureSrc.slice(featureSrc.indexOf('async function bgShareUpdate'), featureSrc.indexOf('FX.bgShareUpdate'));
  assert.equal(bg.includes('persist'), false);
  assert.match(featureSrc, /bgSeen/);

  const h = boot();
  loadUnits(h);
  assert.equal(h.sandbox.units.length, 390);
  assert.ok(h.listeners.has('online'));
  const before = h.shareSnap();

  await h.advance(180000);
  h.emitOnline();
  await h.advance(3000);
  await h.advance(180000);

  assert.equal(h.state.persistCalls, 0);
  assert.equal(h.state.markDirtyCalls, 0);
  assert.deepEqual(h.state.dirty, []);
  assert.equal(h.ogUploads().length, 0);
  assert.equal(h.inits().length, 0);
  assert.equal(h.commits().length, 0);
  assert.equal(h.shareGets().length, 30);
  assert.deepEqual(h.shareSnap(), before);
  for (let i = 0; i < 30; i++) assert.equal(h.sandbox.units[i].share.opts, undefined);

  for (const id of [...h.held]) h.held.delete(id);
  await h.advance(180000);
  h.emitOnline();
  await h.advance(3000);

  h.pull();
  assert.equal(h.sandbox.units.length, 390);
  assert.equal(SHAPE.canonicalJson('unit', h.sandbox.units[7]), h.acked.get('u7'));
  await h.advance(180000);
  h.emitOnline();
  await h.advance(3000);
  await h.sandbox.FX.bgShareUpdate();

  assert.equal(h.state.persistCalls, 0);
  assert.equal(h.state.markDirtyCalls, 0);
  assert.deepEqual(h.state.dirty, []);
  assert.equal(h.ogUploads().length, 0);
  assert.equal(h.inits().length, 0);
  assert.equal(h.commits().length, 0);
  assert.equal(h.shareGets().length, 30);
  assert.deepEqual(h.shareSnap(), before);
  for (let i = 0; i < 30; i++) assert.equal(h.sandbox.units[i].share.opts, undefined);
});

test('an in-session text or photo edit republishes that one unit only', async () => {
  const h = boot();
  loadUnits(h);
  for (const id of [...h.held]) h.held.delete(id);
  await h.advance(180000);
  h.emitOnline();
  await h.advance(3000);
  assert.equal(h.commits().length, 0);
  assert.equal(h.ogUploads().length, 0);

  const text = h.sandbox.units[12];
  const textSigs = h.shareSnap();
  text.notes = 'ลูกค้าขอลดราคาในเซสชันนี้';
  text.rent = 22222;
  h.sandbox.persist();
  await h.advance(6000);
  await h.advance(180000);
  h.emitOnline();
  await h.advance(3000);

  assert.deepEqual(h.commits().map(c => c.body.id), ['s12']);
  assert.equal(h.inits().length, 1);
  assert.equal(h.ogUploads().length, 1);
  assert.equal(h.state.persistCalls, 2);
  assert.deepEqual([...new Set(h.state.dirty)], ['unit|u12']);
  const afterText = h.shareSnap();
  for (let i = 0; i < 390; i++) {
    if (i === 12) assert.notEqual(afterText[i], textSigs[i]);
    else assert.equal(afterText[i], textSigs[i]);
  }
  assert.ok(text.share.opts);
  assert.notEqual(text.share.sig, 'stale-from-other-browser-12');
  for (let i = 0; i < 30; i++) if (i !== 12) assert.equal(h.sandbox.units[i].share.opts, undefined);

  const photo = h.sandbox.units[41];
  const beforePhoto = h.shareSnap();
  h.photos.set(photo.id, [{ id: 'p41-new', url: PUBP + 's41/new.jpg', cover: true, order: 1 }]);
  h.sandbox.FX.scheduleShareUpdate(5000);
  await h.advance(5000);
  await h.advance(20000);

  assert.deepEqual(h.commits().map(c => c.body.id), ['s12', 's41']);
  assert.equal(h.ogUploads().length, 2);
  assert.deepEqual([...new Set(h.state.dirty)], ['unit|u12', 'unit|u41']);
  const afterPhoto = h.shareSnap();
  for (let i = 0; i < 390; i++) {
    if (i === 41) assert.notEqual(afterPhoto[i], beforePhoto[i]);
    else assert.equal(afterPhoto[i], beforePhoto[i]);
  }
  assert.equal(h.commits().filter(c => c.body.id === 's41').length, 1);
});

test('the manual share button still publishes that room and does not fan out', async () => {
  const renderStart = featureSrc.indexOf('async function renderShare');
  const renderShare = featureSrc.slice(renderStart, featureSrc.indexOf('const tog', renderStart));
  assert.equal(renderShare.includes('bgSeen'), false);
  assert.match(renderShare, /buildLink\(u, shareState\)/);
  assert.match(renderShare, /window\.persist\(\)/);
  assert.match(featureSrc, /onclick="FX\.openShare\('\$\{id\}'\)"/);
  assert.match(featureSrc, /แชร์ลิงก์ห้องให้ลูกค้า/);

  const h = boot();
  loadUnits(h);
  const before = h.shareSnap();
  const u = h.sandbox.units[2];
  h.sandbox.FX.openShare(u.id);
  await h.advance(0);

  const link = h.sandbox.document.getElementById('fxShareLink');
  assert.ok(link);
  assert.match(link.textContent, /\/r\/s2\//);
  assert.deepEqual(h.commits().map(c => c.body.id), ['s2']);
  assert.equal(h.inits().length, 1);
  assert.equal(h.ogUploads().length, 1);
  assert.deepEqual([...new Set(h.state.dirty)], ['unit|u2']);
  assert.notEqual(h.shareSnap()[2], before[2]);
  assert.ok(u.share.opts && u.share.opts.photo === true);

  await h.advance(6000);
  await h.advance(180000);
  h.emitOnline();
  await h.advance(3000);
  await h.sandbox.FX.bgShareUpdate();

  assert.deepEqual(h.commits().map(c => c.body.id), ['s2']);
  assert.equal(h.ogUploads().length, 1);
  assert.equal(h.inits().length, 1);
  assert.deepEqual([...new Set(h.state.dirty)], ['unit|u2']);
  const after = h.shareSnap();
  for (let i = 0; i < 390; i++) if (i !== 2) assert.equal(after[i], before[i]);
});
