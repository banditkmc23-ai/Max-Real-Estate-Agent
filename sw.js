// MAX Agent service worker: network-first (bypassing HTTP cache) for same-origin files, cache-first for pinned CDN assets.
const VERSION = 'v52';
const SHELL = `max-shell-${VERSION}`;
const STATIC = `max-static-${VERSION}`;
const SHELL_URLS = ['./', 'index.html', 'tailwind.min.css', 'manifest.json', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'room.html', 'features.js', 'sync.js', 'vendor/supabase.js', 'agent.html', 'geo.js','catalog-hero.webp', 'vendor/qrcode.js', 'vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js'];
const CDN_URLS = [
  'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_URLS.map(u => new Request(u, { cache: 'reload' })));
    const st = await caches.open(STATIC);
    await Promise.all(CDN_URLS.map(u => st.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== STATIC) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' || url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await caches.match('index.html') : null) || Response.error();
      }
    })());
    return;
  }
  const isStatic = ['unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
  if (!isStatic) return;
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') (await caches.open(STATIC)).put(req, res.clone());
    return res;
  })());
});
