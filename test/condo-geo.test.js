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
assert.strictEqual(geo.resolve(idx, 'C Ekkamai'), null);
assert.strictEqual(geo.resolve(idx, 'The Tree Onnut Station'), null);
assert.notStrictEqual(at('Life Sukhumvit 48').lat, null);

const asoke = at('Rhythm Asoke');
const asoke2 = at('Rhythm Asoke 2 (ริทึ่ม อโศก 2)');
assert.notStrictEqual(asoke, asoke2);

at('IDEO Morhp 38');
at('บ้านเดี่ยว ทองหล่อ');

assert.deepStrictEqual(geo.bedBuckets('1 Bed Duplex'), ['duplex', '1']);
assert.deepStrictEqual(geo.bedBuckets('Studio'), ['studio']);
assert.deepStrictEqual(geo.bedBuckets('2 Bed'), ['2']);
assert.ok(geo.bedBuckets('1+1 Bed').indexOf('1') >= 0);

for (const p of db.projects) {
  assert.ok(p.lat >= 13.49 && p.lat <= 14 && p.lng >= 100.39 && p.lng <= 100.92, p.name + ' outside Bangkok');
  assert.strictEqual(geo.resolve(idx, p.name), p);
}

console.log('condo-geo ok', db.projects.length, 'pins');
