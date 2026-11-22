/* MAX Agent: find a room's public MoveCondo page for the client share sheet.
   Read-only: fetches movecondo-links.json (same origin, hashed MAX room ids -> mc-xxx)
   and MoveCondo's rented list. Never writes to Supabase or localStorage. */
(function (root) {
'use strict';
const MC_BASE = 'https://banditkmc23-ai.github.io/movecondo/';
const MAP_URL = 'movecondo-links.json';
const RENTED_URL = MC_BASE + 'data/rented-rooms.json';
const TTL = 10 * 60 * 1000;
let cache = null, at = 0, pending = null;
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
async function keyOf(id) {
  const d = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode('max-mc:' + id));
  return hex(d).slice(0, 16);
}
async function getJSON(url, ms) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    const r = await fetch(url, { cache: 'no-cache', ...(ac ? { signal: ac.signal } : {}) });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return await r.json();
  } finally { if (t) clearTimeout(t); }
}
async function load() {
  if (cache && Date.now() - at < TTL) return cache;
  if (pending) return pending;
  pending = (async () => {
    const [m, rented] = await Promise.all([getJSON(MAP_URL, 5000), getJSON(RENTED_URL, 5000).catch(() => null)]);
    const gone = new Set(((rented && rented.rooms) || []).filter(r => r && !r.restored).map(r => String(r.slug || r.id || '').toLowerCase()));
    cache = { map: (m && m.rooms) || {}, gone }; at = Date.now();
    return cache;
  })().finally(() => { pending = null; });
  return pending;
}
const urlOf = slug => MC_BASE + 'rooms/' + slug + '/';
// Returns { id: 'MC-123', slug: 'mc-123', url } or null (no MoveCondo page, rented, offline, or lookup failed).
async function find(u) {
  if (!u || !u.id || !(root.crypto && root.crypto.subtle)) return null;
  try {
    const c = await load();
    const slug = c.map[await keyOf(u.id)];
    if (!slug || !/^mc-\d+$/.test(slug) || c.gone.has(slug)) return null;
    return { id: slug.toUpperCase(), slug, url: urlOf(slug) };
  } catch (e) { console.warn('movecondo link lookup failed', e); return null; }
}
const api = { find, keyOf, urlOf, BASE: MC_BASE, _reset() { cache = null; at = 0; }, _use(map, gone) { cache = { map: map || {}, gone: new Set(gone || []) }; at = Date.now(); } };
root.MC_LINK = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
