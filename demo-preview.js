/* v9.51 preview only. Loaded only when the page is served from raw.githack.com (see index.html head).
   Seeds local demo rooms and generated photos into this origin's own storage. Cloud sync is off
   (sync.js returns early when window.MAX_DEMO is set), so nothing here reaches Supabase. */
(function () {
  'use strict';
  if (!window.MAX_DEMO) return;
  var PHOTOS = { demo_r1: 6, demo_r2: 4, demo_r3: 0 };
  var COLORS = [['#c2552d', '#f4c7a1'], ['#3b6e8f', '#bfe0f0'], ['#5b7f3a', '#d9ecc0'], ['#7a4d8c', '#e6d1ef'], ['#8f6a2c', '#f3e2bb'], ['#2f4858', '#c9d6df']];
  function paint(i, label) {
    var c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    var g = c.getContext('2d'), col = COLORS[i % COLORS.length];
    var gr = g.createLinearGradient(0, 0, 1200, 900); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = gr; g.fillRect(0, 0, 1200, 900);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(120, 520, 960, 260); g.fillRect(180, 160, 360, 300); g.fillRect(660, 160, 360, 300);
    g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.fillText(String(i + 1), 600, 470);
    g.font = '48px sans-serif'; g.fillText(label, 600, 700);
    return new Promise(function (res) { c.toBlob(function (b) { var t = document.createElement('canvas'); t.width = 400; t.height = 300; t.getContext('2d').drawImage(c, 0, 0, 400, 300); t.toBlob(function (tb) { res([b, tb]); }, 'image/jpeg', 0.7); }, 'image/jpeg', 0.82); });
  }
  function wait(fn, ms) { return new Promise(function (res) { var t0 = Date.now(); (function go() { if (fn()) return res(true); if (Date.now() - t0 > ms) return res(false); setTimeout(go, 100); })(); }); }
  async function seed() {
    var ok = await wait(function () { return typeof db !== 'undefined' && db && typeof tx === 'function'; }, 8000); if (!ok) return;
    try { if (localStorage.getItem('max_demo_photos_v1')) return; } catch (e) {}
    var base = Date.now();
    for (var uid in PHOTOS) {
      for (var i = 0; i < PHOTOS[uid]; i++) {
        var pair = await paint(i, 'รูปตัวอย่าง ' + (i + 1));
        await new Promise(function (res) { var r = tx('readwrite').put({ id: 'p_demo_' + uid + '_' + i, unitId: uid, full: pair[0], thumb: pair[1], ts: base + i, order: base + i }); r.onsuccess = res; r.onerror = res; });
      }
    }
    try { localStorage.setItem('max_demo_photos_v1', '1'); } catch (e) {}
    try { await refreshCounts(); miniPhotoCache.clear(); render(); } catch (e) {}
  }
  function banner() {
    var b = document.createElement('div');
    b.textContent = 'ตัวอย่าง v9.51 · ข้อมูลจำลอง';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:max(6px,env(safe-area-inset-top));z-index:9998;background:#c2552d;color:#fff;font:600 11px/1.6 sans-serif;padding:2px 10px;white-space:nowrap;border-radius:999px;pointer-events:none;opacity:.92';
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { banner(); seed(); }); else { banner(); seed(); }
})();
