// MAX Agent service worker: network-first (bypassing HTTP cache) for same-origin files, cache-first for pinned CDN assets.
const VERSION = 'v79';
const SHELL = `max-shell-${VERSION}`;
const STATIC = `max-static-${VERSION}`;
const SHELL_URLS = ['./', 'index.html', 'tailwind.min.css', 'manifest.json', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'room.html', 'photo-copy.js', 'photo-safety.js', 'photo-restore.js', 'unit-shape.js', 'tiktok-link.js', 'features.js', 'sync.js', 'vendor/supabase.js', 'agent.html', 'geo.js', 'catalog-covers.js', 'room-summary.js', 'catalog-hero.webp', 'vendor/qrcode.js', 'vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js', 'condo-geo.js', 'condo-map.js', 'condo-coords.json', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.markercluster.js', 'vendor/leaflet/MarkerCluster.css', 'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png'];
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
        if (res.ok && !url.pathname.includes('/restore/')) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await caches.match('index.html') : null) || Response.error();
      }
    })());
    return;
  }
  const tileHost = url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org');
  if (tileHost) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || Response.error();
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
