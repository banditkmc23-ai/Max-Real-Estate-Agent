import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

function loadView() {
  const sandbox = { Date, JSON, Object };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('view-state.js'), sandbox);
  return sandbox.MAX_VIEW;
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }
  };
}

test('a saved room is restored within 12 hours and dropped after that', () => {
  const V = loadView();
  const store = memoryStorage();
  const saved = V.save(store, { view: 'rooms', detailUnitId: 'u1', mainScroll: 240, detailScroll: 80 }, 1_000);
  assert.equal(saved.savedAt, 1_000);
  const fresh = V.load(store, 1_000 + 11 * 60 * 60 * 1000);
  assert.equal(fresh.detailUnitId, 'u1');
  assert.equal(fresh.mainScroll, 240);
  assert.equal(V.load(store, 1_000 + V.MAX_AGE + 1), null);
  assert.equal(store.getItem(V.KEY), null);
});

test('back from a restored room returns to the same list, and a plain list does not push', () => {
  const V = loadView();
  const room = { view: 'rooms', filters: ['AVAILABLE'], search: 'thonglor', detailUnitId: 'u9', detailScroll: 120, map: { open: true } };
  const plan = V.historyPlan(room);
  assert.equal(plan.steps.map(s => s.op).join(','), 'replace,push');
  assert.equal(plan.steps[0].view.detailUnitId, null);
  assert.equal(plan.steps[0].view.map, null);
  assert.equal(plan.steps[0].view.search, 'thonglor');
  assert.equal(plan.steps[0].view.filters.join(','), 'AVAILABLE');
  assert.equal(plan.steps[1].view.detailUnitId, 'u9');
  assert.equal(V.overlayOf(plan.steps[0].view), null);
  assert.equal(V.overlayOf(plan.steps[1].view), 'room:u9');
  const list = { view: 'dashboard', detailUnitId: null, map: null, fx: null };
  assert.equal(V.historyPlan(list).steps.map(s => s.op).join(','), 'replace');
});

test('the agent page saves on hide and restores after local render, without touching share pages or other storage', () => {
  const html = read('index.html');
  const sw = read('sw.js');
  assert.match(html, /const APP_VERSION = '9\.54'/);
  assert.match(sw, /const VERSION = 'v93'/);
  assert.match(sw, /view-state\.js/);
  assert.match(html, /view-state\.js/);
  assert.match(html, /pagehide/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /function restoreViewState\(/);
  assert.match(html, /function saveViewStateNow\(/);
  assert.match(html, /historyPlan\(/);
  assert.match(html, /popstate/);
  assert.equal(html.includes('localStorage.clear'), false);
  assert.equal(html.includes('indexedDB.deleteDatabase'), false);
  assert.equal(read('room.html').includes('view-state.js'), false);
  assert.equal(read('view-state.js').includes("'/r/"), false);
  const boot = html.slice(html.indexOf('openDB().then'), html.indexOf('loadHeroImage();\nloadAvatar();'));
  assert.match(boot, /restoreViewState\(\)/);
  const syncAt = html.indexOf('sync.js');
  const restoreAt = html.lastIndexOf('restoreViewState()');
  assert.ok(syncAt > 0 && restoreAt > syncAt, 'final restore runs after sync.js is parsed and before its delayed sync');
});

test('clearing or applying the advanced filter is written into view state, which is not synced', () => {
  const html = read('index.html');
  const clearFn = html.slice(html.indexOf('function clearAdvancedFilter()'), html.indexOf('function switchView('));
  assert.match(clearFn, /rememberView\(\)/);
  const applyFn = html.slice(html.indexOf('function applyAdvancedFilter()'), html.indexOf('function clearAdvancedFilter()'));
  assert.match(applyFn, /rememberView\(\)/);
  const clearAll = html.slice(html.indexOf('function clearAllFilters()'), html.indexOf('function toggleFav('));
  assert.match(clearAll, /rememberView\(\)/);

  const sync = read('sync.js');
  assert.equal(sync.includes('staylow_view_state_v1'), false);
  assert.equal(read('photo-safety.js').includes('staylow_view_state_v1'), false);

  // The list history entry under a room keeps advFilter. If clear does not
  // replace that entry, going back reapplies the old types (e.g. 2 Bed).
  const V = loadView();
  const stale = {
    view: 'rooms',
    advFilter: { priceMin: null, priceMax: null, sizeMin: null, sizeMax: null, types: ['2 Bed'], baths: [], stations: [] },
    detailUnitId: 'u2',
    filters: ['all']
  };
  const under = V.listEntry(stale);
  assert.deepEqual(under.advFilter.types, ['2 Bed']);
  assert.equal(under.detailUnitId, null);
  const cleared = {
    view: 'rooms',
    advFilter: { priceMin: null, priceMax: null, sizeMin: null, sizeMax: null, types: [], baths: [], stations: [] },
    detailUnitId: null,
    filters: ['all']
  };
  const store = memoryStorage();
  V.save(store, cleared, 2_000);
  const loaded = V.load(store, 2_000 + 60 * 1000);
  assert.deepEqual(loaded.advFilter.types, []);
});
