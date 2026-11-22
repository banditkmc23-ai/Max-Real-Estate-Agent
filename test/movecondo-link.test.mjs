import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MC = require('../movecondo-link.js');
const root = new URL('..', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const nodeKey = id => crypto.createHash('sha256').update('max-mc:' + id).digest('hex').slice(0, 16);

test('browser key matches the build script key, and the map holds no raw MAX ids', async () => {
  assert.equal(await MC.keyOf('u1792402363563'), nodeKey('u1792402363563'));
  const raw = read('movecondo-links.json');
  const j = JSON.parse(raw);
  assert.equal(j.v, 1);
  assert.ok(Object.keys(j.rooms).length > 200);
  for (const [k, v] of Object.entries(j.rooms)) { assert.match(k, /^[0-9a-f]{16}$/); assert.match(v, /^mc-\d+$/); }
  assert.doesNotMatch(raw, /temp_|u17\d{8}/);
});

test('find returns the MoveCondo page, and null for unmapped, rented, or bad slugs', async () => {
  MC._use({ [nodeKey('a')]: 'mc-308', [nodeKey('b')]: 'mc-011', [nodeKey('c')]: '../x' }, ['mc-011']);
  assert.deepEqual(await MC.find({ id: 'a' }), { id: 'MC-308', slug: 'mc-308', url: 'https://banditkmc23-ai.github.io/movecondo/rooms/mc-308/' });
  assert.equal(await MC.find({ id: 'b' }), null);
  assert.equal(await MC.find({ id: 'c' }), null);
  assert.equal(await MC.find({ id: 'zz' }), null);
  assert.equal(await MC.find(null), null);
  MC._reset();
});

test('share sheet uses the MoveCondo link first and keeps the MAX link as the fallback', () => {
  const f = read('features.js');
  const rs = f.slice(f.indexOf('async function renderShare'), f.indexOf('const tog ='));
  assert.ok(rs.indexOf('renderMoveCondo(u, el)') < rs.indexOf('buildLink(u, shareState)'));
  assert.match(f, /ห้องนี้ยังไม่มีหน้าใน MoveCondo จึงใช้ลิงก์ MAX แทน/);
  assert.match(f, /ใช้ลิงก์ MAX แทน/);
  const html = read('index.html');
  assert.ok(html.indexOf('movecondo-link.js') < html.indexOf('features.js?v='));
  assert.match(read('sw.js'), /'movecondo-link\.js'/);
});
