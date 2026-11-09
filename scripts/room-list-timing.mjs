/* Headless timing for an empty local store.
   before: summary endpoint missing, rooms arrive only with the full user_docs pull
   after:  the room-list summary returns first, full pull stays slow in the background
   Usage: node scripts/room-list-timing.mjs <before|after> <chromium|webkit> */
const pwMod = await import('playwright').catch(() => import('/tmp/pw/node_modules/playwright/index.js'));
const pw = pwMod.chromium ? pwMod : pwMod.default;
const { chromium, webkit } = pw;

const mode = process.argv[2] === 'before' ? 'before' : 'after';
const which = process.argv[3] === 'webkit' ? 'webkit' : 'chromium';
const PHOTOS = 3600;
const UNITS = 410;
const PAGE = 400;
const PULL_MS = 220;
const SUMMARY_MS = 45;
const PUB = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/abcd12/cover.jpg';
const projects = ['Life Asoke', 'The Base Sukhumvit', 'Ideo Q Sukhumvit', 'Rhythm Ekkamai', 'Noble Remix'];

const user = {
  id: '051c9fdb-a563-4b3c-8a33-2e3661d7b4cc',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2024-01-01T00:00:00.000Z'
};
const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
  token_type: 'bearer',
  user
};

function iso(i) {
  const n = Number(i);
  const ms = Date.UTC(2024, 0, 1) + (Number.isFinite(n) ? n : 0) * 1000;
  return new Date(ms).toISOString();
}
function unitData(i) {
  return {
    id: 'u' + i,
    project: projects[i % projects.length],
    building: 'A',
    room: String(100 + (i % 40)),
    floor: String((i % 20) + 1),
    rent: 15000 + (i % 30) * 500,
    status: i % 5 === 0 ? 'OCCUPIED' : 'AVAILABLE',
    type: '1 Bed',
    bath: '1',
    size: 32 + (i % 8),
    station: 'Asok',
    notes: 'Near BTS Asok ' + i,
    owner: 'Owner ' + (i % 12),
    createdAt: 1700000000000 + i,
    fav: i < 22,
    share: { id: 's' + i, secret: 'sec' + i },
    internalNote: 'private ' + i
  };
}
function summaryOf(i) {
  const u = unitData(i);
  return {
    id: u.id, rev: 1000 + i, project: u.project, building: u.building, room: u.room, floor: u.floor,
    rent: String(u.rent), sale_price: '', type: u.type, bath: u.bath, size: String(u.size), view: '',
    status: u.status, station: u.station, station_dist: '', fav: !!u.fav, created_at: u.createdAt,
    last_posted: null, post_count: 0, notes: u.notes, source_url: '', owner: u.owner,
    owner_phone: '', owner_line: '', start_date: '', end_date: '',
    cover_id: 'p' + i, cover_url: PUB, cover_tsz: 18000, cover_fsz: 90000, photo_n: 4
  };
}
const summaries = Array.from({ length: UNITS }, (_, i) => summaryOf(i))
  .sort((a, b) => (b.fav - a.fav) || (b.created_at - a.created_at) || (a.id < b.id ? -1 : 1));

function pullRows(since) {
  const out = [];
  for (let i = 0; i < PHOTOS + UNITS && out.length < PAGE; i++) {
    const at = iso(i);
    if (since && at <= since) continue;
    if (i < PHOTOS) out.push({ kind: 'photo', id: 'p' + i, rev: 1, deleted: false, server_at: at, data: { unitId: 'u' + (i % UNITS), order: i, tsz: 1000, fsz: 1000, url: '' } });
    else {
      const n = i - PHOTOS;
      out.push({ kind: 'unit', id: 'u' + n, rev: 1000 + n, deleted: false, server_at: at, data: unitData(n) });
    }
  }
  return out;
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const counts = { summary: 0, pull: 0, upgrade: 0, thumbs: 0 };

async function handle(route) {
  const req = route.request();
  let url;
  try { url = new URL(req.url()); } catch (e) { return route.fallback(); }
  try {
  return await handleInner(route, req, url);
  } catch (e) {
    console.error('route', req.url(), e);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: String(e) }) });
  }
}
async function handleInner(route, req, url) {
  const path = url.pathname;
  const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: extra, body: JSON.stringify(body) });
  if (path.includes('/storage/v1/object/public/room-photos/')) {
    counts.thumbs++;
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  }
  if (path.includes('/auth/v1/token')) return json(session);
  if (path.includes('/auth/v1/user')) return json(user);
  if (path.endsWith('/unit_list_summary')) {
    counts.summary++;
    if (mode === 'before') return json({ message: 'missing', code: 'PGRST205' }, 404);
    await new Promise(r => setTimeout(r, SUMMARY_MS));
    const range = req.headers()['range'] || '';
    const m = range.match(/(\d+)-(\d+)/);
    const from = m ? Number(m[1]) : Number(url.searchParams.get('offset') || 0);
    const to = m ? Number(m[2]) : from + 59;
    const slice = summaries.slice(from, to + 1);
    return json(slice, 200, { 'content-range': `${from}-${from + slice.length - 1}/${summaries.length}` });
  }
  if (path.endsWith('/user_docs')) {
    const select = url.searchParams.get('select') || '';
    const idFilter = url.searchParams.get('id') || '';
    if (select.split(',').indexOf('server_at') === -1 && url.searchParams.get('kind') === 'eq.unit') {
      if (mode === 'before') return json({ message: 'summary fallback off' }, 500);
    }
    if (idFilter.startsWith('in.')) {
      counts.upgrade++;
      const ids = idFilter.replace(/^in\.\(?/, '').replace(/\)?$/, '').split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      const rows = ids.map(id => {
        const n = Number(String(id).replace(/^u/, ''));
        const i = Number.isFinite(n) ? n : 0;
        return { kind: 'unit', id, rev: 1000 + i, deleted: false, server_at: iso(PHOTOS + i), data: unitData(i) };
      });
      return json(rows);
    }
    counts.pull++;
    await new Promise(r => setTimeout(r, PULL_MS));
    const gt = (url.searchParams.get('server_at') || '').replace(/^gt\./, '');
    return json(pullRows(gt));
  }
  if (path.includes('/rpc/sync_push')) return json([]);
  return json([]);
}

const engine = which === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true });
const context = await browser.newContext({
  viewport: which === 'webkit' ? { width: 390, height: 844 } : { width: 1280, height: 800 },
  isMobile: which === 'webkit',
  hasTouch: which === 'webkit',
  deviceScaleFactor: which === 'webkit' ? 2 : 1,
  serviceWorkers: 'block'
});
const errors = [];
const logs = [];
await context.addInitScript(s => { localStorage.setItem('max_auth', JSON.stringify(s)); }, session);
const page = await context.newPage();
page.on('pageerror', err => errors.push(String(err)));
page.on('console', msg => { if (msg.type() === 'error') logs.push(msg.text()); });
await page.route('**/*supabase.co/**', handle);
await page.route('**/*room-photos/**', handle);

const t0 = Date.now();
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
const loaded = Date.now() - t0;
await page.waitForFunction(() => document.querySelectorAll('#unitList .g-card').length > 0, null, { timeout: 30000 });
const first = Date.now() - t0;
const firstCards = await page.locator('#unitList .g-card').count();
await page.waitForFunction(() => Number((document.getElementById('totalUnitBadge') || {}).textContent) >= 400, null, { timeout: 30000 });
const complete = Date.now() - t0;
const nav = which === 'webkit' ? '.bottom-nav-item' : '.sidebar .nav-link';
console.log(JSON.stringify({ phase: 'loaded', mode, browser: which, domMs: loaded, firstCardMs: first, firstCards, fullListMs: complete, counts, errors, consoleErrors: logs.slice(0, 12) }));
const navInfo = await page.evaluate(() => ({
  roomsHidden: document.getElementById('viewRooms').className,
  buttons: [...document.querySelectorAll('[data-nav="rooms"]')].map(el => ({ cls: el.className, shown: el.offsetParent !== null, text: (el.innerText || '').trim().slice(0, 24) }))
}));
console.log(JSON.stringify({ phase: 'nav', navInfo }));
await page.locator(`${nav}[data-nav="rooms"]`).first().click();
await page.waitForFunction(() => !document.getElementById('viewRooms').classList.contains('hidden'), null, { timeout: 8000 });
const box = await page.locator('#unitList .g-card').first().boundingBox();
const sample = await page.locator('#unitList .g-title').first().innerText();
await page.locator(`${nav}[data-nav="customers"]`).first().click();
await page.waitForFunction(() => !document.getElementById('viewCustomers').classList.contains('hidden'));
await page.locator(`${nav}[data-nav="dashboard"]`).first().click();
await page.waitForFunction(() => !document.getElementById('viewDashboard').classList.contains('hidden'));
const version = await page.locator('#appVerLabel').innerText();
const shot = `/tmp/room-list-${mode}-${which}.png`;
await page.locator(`${nav}[data-nav="rooms"]`).first().click();
await page.waitForTimeout(200);
await page.screenshot({ path: shot, fullPage: false });
const result = {
  mode, browser: which, viewport: which === 'webkit' ? '390x844' : '1280x800',
  domMs: loaded, firstCardMs: first, firstCards, fullListMs: complete,
  cardBox: box, sample, version, counts, errors, consoleErrors: logs.slice(0, 8), shot
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (errors.length) process.exit(1);
