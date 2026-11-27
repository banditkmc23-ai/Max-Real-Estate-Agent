/* Safari localStorage quota (v9.56). Runs in Playwright WebKit, whose localStorage has the same
   ~5 MB quota as iOS Safari and counts Thai text at 2 bytes per character.
   Seeds a realistic MAX dataset just under the quota (552 rooms with Thai notes, 1 MB cover
   photo, sync state with 9 pending items), then lets a full pull bring 115 longer rooms.
   Every Supabase request is answered by a local mock; nothing reaches the live project.
   Modes: pass = v9.56 moves the big keys and syncs; fail = v9.55 reproduces the error;
   stillfull = other data keeps localStorage full even after the move: pending items still go up,
   and a pending item that only the queue mirror (max_sync_q_v1) holds is not lost.
   Usage: node test/quota.e2e.mjs <label> <port> [expect=pass|fail|stillfull]  (serve the repo root on the port first) */
const pwMod = await import('playwright').catch(() => import('/workspace/movecondo-data/qa248/node_modules/playwright/index.js'));
const { webkit } = pwMod.webkit ? pwMod : pwMod.default;
const label = process.argv[2] || 'run', port = process.argv[3] || '8792', expect = process.argv[4] || 'pass';
const OUT = '/workspace/v956';
const UID = '00000000-0000-4000-8000-000000000001';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'demo@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00.000Z' };
const session = { access_token: 'mock', refresh_token: 'mock', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user };
const N = 552, PENDING = 9, CHANGED = 115;
const OLD_REV = 1700000000000, PEND_REV = 1763440000000, NEW_REV = 1764200000000; // pending revs = 18 Nov 2026
const THAI = 'ห้องสวย เฟอร์นิเจอร์ครบ ใกล้ BTS เดินทางสะดวก พร้อมเข้าอยู่ ';
const unit = (i, extra = {}) => ({ id: 'u' + i, project: 'Condo ' + (i % 60), room: String(100 + i), floor: String(i % 40), rent: 15000 + i, status: 'AVAILABLE', type: '1 Bed', bath: '1', size: 30, station: 'BTS Phra Khanong', notes: (THAI.repeat(18) + 'Fully furnished, near BTS. ').slice(0, 1150), createdAt: 1700000000000 + i, ...extra });
const cloudUnit = i => i < PENDING ? unit(i) : (i < PENDING + CHANGED ? unit(i, { notes: unit(i).notes + ' อัปเดตจากเครื่องอื่น '.repeat(12) }) : unit(i));
const cloudRev = i => (i >= PENDING && i < PENDING + CHANGED) ? NEW_REV + i : OLD_REV;
const allRows = Array.from({ length: N }, (_, i) => ({ kind: 'unit', id: 'u' + i, rev: cloudRev(i), deleted: false, server_at: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString(), data: cloudUnit(i) }));
import { createRequire } from 'node:module';
const SHAPE = createRequire(import.meta.url)('../unit-shape.js');
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '.' + s.length; };
const localUnit = (i, full) => i < PENDING ? { ...unit(i), notes: unit(i).notes + ' [pending-' + i + ']' } : (full && i === 200 ? { ...unit(i), notes: unit(i).notes + ' [pending-mirror]' } : unit(i));
// The same content hash sync.js keeps in st.h, so the seeded state looks like a device that synced before.
const hashes = full => Object.fromEntries(Array.from({ length: N }, (_, i) => ['unit|u' + i, fnv(SHAPE.canonicalJson('unit', JSON.parse(JSON.stringify(localUnit(i, full)))))]));
let pushes = [];
async function handle(route) {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
  const json = (b, s = 200, h = {}) => route.fulfill({ status: s, contentType: 'application/json', headers: h, body: JSON.stringify(b) });
  if (p.includes('/auth/v1/token')) return json(session);
  if (p.includes('/auth/v1/user')) return json(user);
  if (p.endsWith('/unit_list_summary')) return json([], 200, { 'content-range': '*/0' });
  if (p.endsWith('/rpc/sync_push')) { try { pushes.push(...JSON.parse(req.postData() || '{}').p_rows); } catch (e) {} return json([]); }
  if (p.includes('/rpc/')) return json([]);
  if (p.endsWith('/user_docs') && req.method() === 'GET') {
    if (url.searchParams.get('kind')) return json([]);
    const gt = (url.searchParams.get('server_at') || '').replace(/^gt\./, '');
    const lim = Number(url.searchParams.get('limit') || 1000);
    return json(allRows.filter(r => !gt || r.server_at > gt).slice(0, lim));
  }
  if (p.includes('/storage/')) return route.fulfill({ status: 404, body: '' });
  return json([]);
}
function seed(a) {
  // stillfull: right after v9.56 moved its keys, other data fills the space again (rooms keep growing).
  if (a.full && !localStorage.getItem('qa_refilled')) {
    const iv = setInterval(() => { if (!window.MAX_STORE) return; clearInterval(iv); MAX_STORE.ready.then(() => {
      localStorage.setItem('qa_refilled', '1');
      let f = 0, h2 = 6000000; while (h2 - f > 2000) { const m = (f + h2) >> 1; try { localStorage.setItem('qa_filler', 'F'.repeat(m)); f = m; } catch (e) { h2 = m; } }
      localStorage.setItem('qa_filler', 'F'.repeat(Math.max(0, f - 3000)));
    }); }, 1);
  }
  if (localStorage.getItem('qa_seeded')) return;
  localStorage.setItem('qa_seeded', '1');
  localStorage.setItem('max_auth', JSON.stringify(a.session));
  const local = a.units.map((u, i) => i < a.PENDING ? { ...u, notes: u.notes + ' [pending-' + i + ']' } : (a.full && i === 200 ? { ...u, notes: u.notes + ' [pending-mirror]' } : u));
  localStorage.setItem('staylow_units_v1', JSON.stringify(local));
  localStorage.setItem('staylow_avatar', 'data:image/jpeg;base64,' + 'A'.repeat(57000));
  localStorage.setItem('max_catalog', JSON.stringify(JSON.stringify({ title: 'MAX', rooms: 'x'.repeat(90000) })));
  const st = { uid: a.UID, cursor: '2026-11-18T06:00:00Z', h: {}, dirty: {}, r: {}, up: {}, retry: {}, explicitDel: {}, restoreMeta: {}, cloudHash: {}, photoTry: {}, photoFail: {}, summary: {}, init: true, last: Date.parse('2026-11-18T03:23:04Z'), pulled: Date.parse('2026-11-18T06:00:22Z'), pubUrl: {} };
  a.units.forEach((u, i) => { st.r['unit|' + u.id] = a.OLD_REV; st.h['unit|' + u.id] = a.hashes['unit|' + u.id]; });
  for (let i = 0; i < a.PENDING; i++) st.dirty['unit|u' + i] = { rev: a.PEND_REV + i };
  for (let i = 0; i < 4200; i++) { const id = 'p17' + String(31000000000 + i * 977).padStart(13, '0'); st.r['photo|' + id] = a.OLD_REV + i; st.up[id] = '183421/12873'; st.pubUrl[id] = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/mc-' + (i % 300) + '/' + id + '.jpg'; }
  localStorage.setItem('max_sync_v1', JSON.stringify(st));
  if (a.full) localStorage.setItem('max_sync_q_v1', JSON.stringify({ uid: a.UID, dirty: { 'unit|u200': { rev: a.PEND_REV + 200 } }, explicitDel: {}, restoreMeta: {} }));
  // Cover photo takes whatever is left, minus a small margin: the device is "just under" the quota.
  let lo = 0, hi = 3000000;
  while (hi - lo > 2000) { const mid = (lo + hi) >> 1; try { localStorage.setItem('staylow_hero_img', 'data:image/jpeg;base64,' + 'B'.repeat(mid)); lo = mid; } catch (e) { hi = mid; } }
  localStorage.setItem('staylow_hero_img', 'data:image/jpeg;base64,' + 'B'.repeat(Math.max(0, lo - 40000)));
  if (a.full) { localStorage.setItem('staylow_hero_img', 'data:image/jpeg;base64,' + 'B'.repeat(300000)); let f = 0, h2 = 4000000; while (h2 - f > 2000) { const m = (f + h2) >> 1; try { localStorage.setItem('qa_filler', 'F'.repeat(m)); f = m; } catch (e) { h2 = m; } } localStorage.setItem('qa_filler', 'F'.repeat(Math.max(0, f - 20000))); }
}
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
await ctx.route(/supabase\.co/, handle);
await ctx.addInitScript(seed, { session, UID, PENDING, OLD_REV, PEND_REV, units: Array.from({ length: N }, (_, i) => unit(i)), full: expect === 'stillfull', hashes: hashes(expect === 'stillfull') });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const logs = []; page.on('console', m => { const t = m.text(); if (/quota|store:|sync:/i.test(t)) logs.push(t.slice(0, 160)); });
const res = { label };
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
res.seed = await page.evaluate(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), v = Storage.prototype.getItem.call(localStorage, k) || ''; n += (k.length + v.length) * (/[^\u0000-\u00ff]/.test(v) ? 2 : 1); } return { approxBytes: n }; });
const syncState = () => page.evaluate(() => { const p = document.getElementById('syncPanel'); return { text: window.SYNC && SYNC.open ? null : null }; });
await page.waitForFunction(() => typeof units !== 'undefined' && units.length >= 500, null, { timeout: 30000 });
// let the first full pull + push finish
await page.waitForTimeout(12000);
const read = () => page.evaluate(async () => {
  try { SYNC.open(); } catch (e) {}
  await new Promise(r => setTimeout(r, 300));
  const panel = document.getElementById('syncPanel');
  const text = panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 300) : '';
  const own = k => Object.prototype.hasOwnProperty.call(localStorage, k) ? 'localStorage' : 'gone';
  const u10 = (units.find(x => x.id === 'u10') || {}).notes || '';
  const idb = await new Promise(res => { try { const r = indexedDB.open('max_store'); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) return res(null); const out = {}; const t = d.transaction('kv'); const s = t.objectStore('kv'); ['max_sync_v1', 'staylow_hero_img', 'staylow_avatar'].forEach(k => { const q = s.get(k); q.onsuccess = () => { out[k] = typeof q.result === 'string' ? q.result.length : null; }; }); t.oncomplete = () => res(out); }; r.onerror = () => res(null); } catch (e) { res(null); } });
  return { text, heroKey: own('staylow_hero_img'), syncKey: own('max_sync_v1'), idb, hero: (document.getElementById('heroCover') || {}).dataset ? (document.getElementById('heroCover').dataset.hero || '').length : 0, otherDeviceApplied: /อัปเดตจากเครื่องอื่น/.test(u10), store: window.MAX_STORE ? MAX_STORE.report() : null, version: APP_VERSION };
});
res.first = await read();
await page.screenshot({ path: `${OUT}/${label}-sync-sheet.png` });
const pendPushed = new Set(pushes.filter(r => r.kind === 'unit' && /\[pending-\d\]/.test((r.data || {}).notes || '')).map(r => r.id));
res.pendingPushed = pendPushed.size;
res.mirrorPushed = pushes.some(r => r.id === 'u200' && /\[pending-mirror\]/.test((r.data || {}).notes || ''));
// reload: state must come back from IndexedDB, nothing pending, no fresh full re-push
pushes = [];
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof units !== 'undefined' && units.length >= 500, null, { timeout: 30000 });
await page.waitForTimeout(6000);
res.afterReload = await read();
res.afterReloadPushes = pushes.length;
res.errors = errors.slice(0, 5); res.logs = logs.slice(0, 8);
console.log(JSON.stringify(res, null, 1));
await browser.close();
const quotaShown = /quota has been exceeded/i.test(res.first.text);
const ok = expect === 'fail'
  ? (quotaShown && res.pendingPushed < PENDING)
  : expect === 'stillfull'
  ? (!quotaShown && /พื้นที่เก็บข้อมูลในเครื่องเต็ม/.test(res.first.text) && res.pendingPushed === PENDING && res.mirrorPushed && res.first.syncKey === 'gone' && !errors.length)
  : (!quotaShown && res.pendingPushed === PENDING && res.first.otherDeviceApplied && res.first.syncKey === 'gone' && res.first.heroKey === 'gone' && res.first.hero > 1000 && !/รอส่ง/.test(res.afterReload.text) && res.afterReloadPushes === 0 && res.afterReload.hero > 1000 && !errors.length);
console.log(ok ? `PASS (${expect})` : `FAIL (expected ${expect})`);
process.exit(ok ? 0 : 1);
