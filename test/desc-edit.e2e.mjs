/* iPhone-emulated check for the room description inline editor.
   Every Supabase request is answered by a local mock; nothing reaches the live project.
   Usage: node test/desc-edit.e2e.mjs <label> [port]   (serve the repo root on the port first) */
const pwMod = await import('playwright').catch(() => import('/workspace/movecondo-data/qa248/node_modules/playwright/index.js'));
const { chromium } = pwMod.chromium ? pwMod : pwMod.default;
const label = process.argv[2] || 'run';
const port = process.argv[3] || '8791';
const OUT = '/workspace/v955';
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'demo@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00.000Z' };
const session = { access_token: 'mock', refresh_token: 'mock', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user };
const NOTES = ('Wyne By Sansiri ให้เช่า 1 ห้องนอน ใกล้ BTS พระโขนง เฟอร์นิเจอร์ครบ พร้อมเข้าอยู่ ').repeat(7).slice(0, 494);
const unit = (id, extra = {}) => ({ id, project: 'Wyne By Sansiri', room: '286', floor: '12', rent: 15000, status: 'AVAILABLE', type: '1 Bed', bath: '1', size: 30, station: 'BTS Phra Khanong', notes: NOTES, createdAt: 1700000000000, ...extra });
let bump = 0, pushes = [];
const row = (u, rev, at) => ({ kind: 'unit', id: u.id, rev, deleted: false, server_at: at, data: u });
function pullRows(since) {
  const rows = [row(unit('u286'), 1, '2026-11-01T00:00:00.000Z'), row(unit('u287', { room: '287', notes: 'other' }), 1, '2026-11-01T00:00:01.000Z')];
  // after the edit starts, "another device" changes room 287: a normal background pull with changes
  if (bump) rows.push(row(unit('u287', { room: '287', notes: 'other v' + bump }), 1 + bump, new Date(Date.UTC(2026, 10, 2) + bump * 1000).toISOString()));
  return rows.filter(r => !since || r.server_at > since);
}
async function handle(route) {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
  const json = (b, s = 200, h = {}) => route.fulfill({ status: s, contentType: 'application/json', headers: h, body: JSON.stringify(b) });
  if (p.includes('/auth/v1/token')) return json(session);
  if (p.includes('/auth/v1/user')) return json(user);
  if (p.endsWith('/unit_list_summary')) return json([], 200, { 'content-range': '*/0' });
  if (p.includes('/rpc/') || req.method() !== 'GET') { pushes.push(req.postData() || ''); }
  if (p.includes('/rpc/')) return json([]);
  if (p.endsWith('/user_docs')) { const gt = (url.searchParams.get('server_at') || '').replace(/^gt\./, ''); return json(req.method() === 'GET' ? pullRows(gt) : []); }
  if (p.includes('/storage/')) return route.fulfill({ status: 404, body: '' });
  return json([]);
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/supabase\.co/, handle);
await ctx.addInitScript(s => { if (!localStorage.getItem('max_auth')) localStorage.setItem('max_auth', JSON.stringify(s)); }, session);
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.units || []).length >= 2 || (typeof units !== 'undefined' && units.length >= 2), null, { timeout: 30000 });
await page.waitForTimeout(2500);
const res = {};
const state = () => page.evaluate(() => { const ta = document.querySelector('#detailViewContent textarea.inline-textarea'); const u = JSON.parse(localStorage.getItem('staylow_units_v1') || '[]').find(x => x.id === 'u286') || {}; return { editing: !!ta, focused: !!ta && document.activeElement === ta, value: ta ? ta.value.slice(-12) : null, stored: (u.notes || '').slice(-12), fontSize: ta ? getComputedStyle(ta).fontSize : null }; });
await page.evaluate(() => openDetailView('u286'));
await page.waitForTimeout(600);
await page.locator('#detailViewContent .notes-box').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/${label}-1-detail.png` });
await page.locator('#detailViewContent .notes-box').tap();
await page.waitForTimeout(300);
res.afterTap = await state();
// move caret to the end and type
await page.evaluate(() => { const ta = document.querySelector('#detailViewContent textarea.inline-textarea'); if (ta) ta.setSelectionRange(ta.value.length, ta.value.length); });
await page.keyboard.type(' [แก้1]');
res.afterType = await state();
await page.screenshot({ path: `${OUT}/${label}-2-editing.png` });
// keyboard opening: viewport shrinks
await page.setViewportSize({ width: 390, height: 500 }); await page.waitForTimeout(400);
res.afterKeyboardResize = await state();
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
// a background sync tick that pulls a change from another device
bump++; await page.evaluate(() => window.SYNC && SYNC.now()); await page.waitForTimeout(4500);
res.afterSyncTick = await state();
// a touch on the page after >30s idle also schedules a pull in sync.js
bump++; await page.evaluate(() => { document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); window.SYNC && SYNC.now(); }); await page.waitForTimeout(4500);
res.afterTouchSync = await state();
await page.screenshot({ path: `${OUT}/${label}-3-after-sync.png` });
await page.keyboard.type(' [แก้2]');
// app switch: visibility hidden
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
await page.waitForTimeout(300);
res.afterHidden = await state();
await page.evaluate(() => { delete document.visibilityState; delete document.hidden; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(1500);
res.afterVisibleAgain = await state();
await page.setViewportSize({ width: 390, height: 844 });
await page.keyboard.type(' [แก้3]');
// tap outside (the header of the page) -> blur -> save and leave edit mode
await page.locator('#detailViewContent p', { hasText: 'รายละเอียดห้อง' }).first().tap().catch(e => console.log('tapOutside', String(e).slice(0, 80)));
await page.waitForTimeout(600);
res.afterTapOutside = await state();
await page.waitForTimeout(100); await page.screenshot({ path: `${OUT}/${label}-4-saved.png` });
// edit again then go back without tapping outside
await page.locator('#detailViewContent .notes-box').tap({ timeout: 5000 }).catch(e => console.log('retap', String(e).slice(0, 80))); await page.waitForTimeout(300);
await page.evaluate(() => { const ta = document.querySelector('#detailViewContent textarea.inline-textarea'); if (ta) ta.setSelectionRange(ta.value.length, ta.value.length); });
await page.keyboard.type(' [แก้4]');
await page.evaluate(() => history.back()); await page.waitForTimeout(800);
res.afterBack = await state();
// short fields still save on Enter (rent)
await page.evaluate(() => { if (!detailUnitId) openDetailView('u286'); }); await page.waitForTimeout(500);
await page.locator('#detailViewContent .text-2xl.inline-edit').tap({ timeout: 5000 }).catch(e => console.log('rent', String(e).slice(0, 80)));
await page.keyboard.type('16500'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
res.rentAfterEnter = await page.evaluate(() => (JSON.parse(localStorage.getItem('staylow_units_v1')).find(x => x.id === 'u286') || {}).rent);
// the held pull from "another device" lands once editing has ended
await page.waitForTimeout(5000);
res.otherDeviceChangeApplied = await page.evaluate(() => (units.find(x => x.id === 'u287') || {}).notes);
res.version = await page.evaluate(() => APP_VERSION);
res.pushedNotesTail = pushes.map(b => { const m = b.match(/\[แก้\d\]/g); return m ? m.slice(-1)[0] : null; }).filter(Boolean).slice(-1)[0] || null;
res.errors = errors.slice(0, 5);
console.log(JSON.stringify(res, null, 1));
await browser.close();
