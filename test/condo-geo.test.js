const assert = require('assert');
const geo = require('../condo-geo.js');
const db = require('../condo-coords.json');
const idx = geo.index(db);

function at(name) {
  const hit = geo.resolve(idx, name);
  assert.ok(hit, name + ' should be placed');
  return hit;
}

const west = at('The Base Park West');
assert.ok(Math.abs(west.lat - 13.713) < 0.01 && Math.abs(west.lng - 100.600) < 0.01);

const kawa = at('Kawa Haus (คาวะ เฮาส์)');
assert.strictEqual(kawa.name, 'Kawa Haus');
assert.strictEqual(at('Kawa Haus'), kawa);

const around = at('Noble Around 33 (โนเบิล อราวน์ 33)');
assert.ok(around.lat < 13.76, 'Noble Around 33 is not Ari');
assert.notStrictEqual(around, geo.resolve(idx, 'Noble Around Ari'));

assert.strictEqual(geo.resolve(idx, 'Life Sukhumvit 62'), null);
assert.notStrictEqual(geo.resolve(idx, 'Life Sukhumvit 62'), at('Life Sukhumvit 48'));
assert.strictEqual(geo.resolve(idx, 'C Ekkamai'), null);
assert.strictEqual(geo.resolve(idx, 'C Ekkamai Condominium (ซี เอกมัย)'), null);
assert.strictEqual(geo.resolve(idx, 'The Tree Onnut Station'), null);
assert.strictEqual(geo.resolve(idx, 'Park Origin Thonglor (พาร์ค ออริจิ้น ทองหล่อ)'), null);
assert.strictEqual(geo.resolve(idx, 'Nia By Sansiri'), null);
assert.notStrictEqual(at('Life Sukhumvit 48').lat, null);

const emporio = at('The Emporio Place Sukhumvit 24 (ดิ เอ็มโพริโอ เพลส สุขุมวิท 24)');
const park24 = at('Park Origin 24 Phrom Phong (พาร์ค ออริจิ้น 24 พร้อมพงษ์)');
assert.notStrictEqual(park24, emporio);
assert.strictEqual(park24, at('Park Origin 24 Phrom Phong'));
assert.strictEqual(park24, at('Park Origin Phrom Phong / Park 24 (พาร์ค ออริจิ้น พร้อมพงษ์)'));
assert.ok(Math.abs(park24.lat - 13.72512) < 0.002 && Math.abs(park24.lng - 100.56565) < 0.002);

assert.strictEqual(at('Blocs 77'), at('Blocs77'));
assert.strictEqual(at('Blocs 77'), at('Blocs77 (บล็อคส์ 77)'));
assert.strictEqual(at('Ideo S93'), at('IDEO Sukhumvit 93'));
assert.strictEqual(at('Ideo S93 (ไอดีโอ เอส93)'), at('IDEO Sukhumvit 93'));

const teak = at('The Teak Sukhumvit 39');
assert.ok(Math.abs(teak.lat - 13.7406687) < 0.002 && Math.abs(teak.lng - 100.5735142) < 0.002);
const clover = at('The Clover Thonglor 18');
assert.ok(Math.abs(clover.lat - 13.73446) < 0.002 && Math.abs(clover.lng - 100.58488) < 0.002);
const mobi81 = at('IDEO Mobi Sukhumvit 81');
assert.notStrictEqual(mobi81, at('Ideo Mobi Asoke (ไอดีโอ โมบิ อโศก)'));
assert.ok(Math.abs(mobi81.lat - 13.70474) < 0.002 && Math.abs(mobi81.lng - 100.60225) < 0.002);
const siamese = at('Siamese Sukhumvit 48 (ไซมิส สุขุมวิท 48)');
assert.ok(Math.abs(siamese.lat - 13.70893) < 0.002 && Math.abs(siamese.lng - 100.59852) < 0.002);

assert.strictEqual(geo.fold('Petchaburi'), geo.fold('Phetchaburi'));
assert.strictEqual(geo.fold('Ekamai'), geo.fold('Ekkamai'));
assert.strictEqual(geo.fold('Thong Lo'), geo.fold('Thonglor'));
assert.strictEqual(geo.fold('Phrom Phong'), geo.fold('Phromphong'));
assert.strictEqual(geo.fold('On Nut'), geo.fold('Onnut'));

const asoke = at('Rhythm Asoke');
const asoke2 = at('Rhythm Asoke 2 (ริทึ่ม อโศก 2)');
assert.notStrictEqual(asoke, asoke2);

at('IDEO Morhp 38');
at('บ้านเดี่ยว ทองหล่อ');

assert.deepStrictEqual(geo.bedBuckets('1 Bed Duplex'), ['duplex', '1']);
assert.deepStrictEqual(geo.bedBuckets('Studio'), ['studio']);
assert.deepStrictEqual(geo.bedBuckets('2 Bed'), ['2']);
assert.ok(geo.bedBuckets('1+1 Bed').indexOf('1') >= 0);

const seenCoord = new Map();
for (const p of db.projects) {
  assert.ok(p.lat >= 13.49 && p.lat <= 14 && p.lng >= 100.39 && p.lng <= 100.92, p.name + ' outside Bangkok');
  assert.strictEqual(geo.resolve(idx, p.name), p);
  const coord = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
  assert.ok(!seenCoord.has(coord), p.name + ' shares a pin with ' + seenCoord.get(coord));
  seenCoord.set(coord, p.name);
}
for (const key of Object.keys(idx.tight)) {
  assert.ok(/[a-z]/.test(key), 'number-only lookup key ' + key);
}

console.log('condo-geo ok', db.projects.length, 'pins');
