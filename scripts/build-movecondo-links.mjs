// Build movecondo-links.json: hashed MAX room id -> MoveCondo slug, for rooms MoveCondo lists now.
// Usage: node scripts/build-movecondo-links.mjs --movecondo ../movecondo --map src2mc.json [--map more.json] [--out movecondo-links.json]
// Each --map file is a JSON object { "<MAX room id>": "MC-123" } kept by the nightly MoveCondo sync (not public).
// Only the SHA-256 key is published, so raw MAX room ids never appear in the file.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const args = process.argv.slice(2);
const maps = []; let mc = '', out = 'movecondo-links.json';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--map') maps.push(args[++i]);
  else if (args[i] === '--movecondo') mc = args[++i];
  else if (args[i] === '--out') out = args[++i];
}
if (!mc || !maps.length) { console.error('need --movecondo <repo> and at least one --map <file>'); process.exit(1); }
const keyOf = id => crypto.createHash('sha256').update('max-mc:' + id).digest('hex').slice(0, 16);
const listings = JSON.parse(fs.readFileSync(path.join(mc, 'data/listings.json'), 'utf8'));
let rented = { rooms: [] };
try { rented = JSON.parse(fs.readFileSync(path.join(mc, 'data/rented-rooms.json'), 'utf8')); } catch (e) {}
const gone = new Set((rented.rooms || []).filter(r => !r.restored).map(r => String(r.id).toUpperCase()));
const listed = new Set(listings.rooms.map(r => r.id).filter(id => !gone.has(id)));
const src = {};
for (const f of maps) Object.assign(src, JSON.parse(fs.readFileSync(f, 'utf8')));
const rooms = {}; const seen = new Set();
for (const [maxId, mcId] of Object.entries(src).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
  if (!/^MC-\d+$/.test(String(mcId)) || !listed.has(mcId)) continue;
  if (!/^(u\d|temp_\d)/.test(maxId)) continue;
  rooms[keyOf(maxId)] = String(mcId).toLowerCase(); seen.add(mcId);
}
const sorted = Object.fromEntries(Object.entries(rooms).sort((a, b) => a[0] < b[0] ? -1 : 1));
fs.writeFileSync(out, JSON.stringify({ v: 1, generated: listings.generated || new Date().toISOString(), count: Object.keys(sorted).length, rooms: sorted }, null, 0) + '\n');
console.log(`wrote ${out}: ${Object.keys(sorted).length} rooms; MoveCondo listed ${listed.size}; listed without a MAX id: ${[...listed].filter(x => !seen.has(x)).join(', ') || 'none'}`);
