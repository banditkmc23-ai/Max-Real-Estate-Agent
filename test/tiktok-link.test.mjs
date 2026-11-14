import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const LINK = require('../tiktok-link.js');
const SHAPE = require('../unit-shape.js');
const RS = require('../room-summary.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

function serverLink() {
  const ts = read('supabase/functions/share-room/index.ts');
  const m = ts.match(/function tiktokLink\(v: unknown\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'share-room tiktokLink');
  const src = m[0].replace('v: unknown', 'v').replace('let u: URL;', 'let u;');
  return vm.runInNewContext(src + '\ntiktokLink', { URL });
}
const tiktokLink = serverLink();

const OK = 'https://vt.tiktok.com/ZSabc123/';
const FULL = 'https://www.tiktok.com/@mori/video/1234567890';

test('client and share-room agree on https TikTok hosts and drop everything else', () => {
  for (const url of [OK, 'https://vt.tiktok.com/ZSabc123', FULL, 'https://tiktok.com/@mori/video/1', 'https://vm.tiktok.com/ZSabc/', 'https://VT.TIKTOK.COM/AbC']) {
    const client = LINK.publicUrl(url);
    assert.equal(client, tiktokLink(client));
    assert.match(client, /^https:\/\/(www\.|vt\.|vm\.)?tiktok\.com\//);
  }
  const dropped = [
    '', null, undefined, '   ',
    'http://vt.tiktok.com/ZSabc',
    'https://m.tiktok.com/ZSabc',
    'https://tiktok.com.evil.com/x',
    'https://evil.com/vt.tiktok.com',
    'https://vt.tiktok.com.evil.com/x',
    'https://user:pass@vt.tiktok.com/x',
    'https://vt.tiktok.com:444/x',
    'javascript:alert(1)',
    'https://vt.tiktok.com/a b',
    'not a url'
  ];
  for (const v of dropped) {
    assert.equal(tiktokLink(v), '');
    assert.equal(LINK.publicUrl(v), '');
  }
  assert.equal(LINK.publicUrl('vt.tiktok.com/ZSabc'), 'https://vt.tiktok.com/ZSabc');
  assert.equal(tiktokLink('vt.tiktok.com/ZSabc'), '');
  assert.equal(tiktokLink('https://vt.tiktok.com/ZSabc'), 'https://vt.tiktok.com/ZSabc');
});

test('an empty TikTok field is not a sync edit, and a real one is', () => {
  const bare = { id: 'u1', project: 'Mori Haus', room: '74', rent: 28000 };
  const empty = Object.assign({}, bare, { tiktokUrl: '' });
  assert.equal(SHAPE.canonicalJson('unit', bare), SHAPE.canonicalJson('unit', empty));
  assert.notEqual(SHAPE.canonicalJson('unit', bare), SHAPE.canonicalJson('unit', Object.assign({}, bare, { tiktokUrl: OK })));
  const norm = SHAPE.normalizeUnits([bare])[0];
  assert.equal(norm.tiktokUrl, '');
  assert.equal(SHAPE.canonicalJson('unit', norm), SHAPE.canonicalJson('unit', bare));
  const summary = RS.toUnit({ id: 'u1', project: 'Mori Haus', room: '74', rent: 28000, notes: '', created_at: 1700000000000 });
  const base = RS.baseOf(summary);
  const local = SHAPE.normalizeUnits([JSON.parse(JSON.stringify(summary))])[0];
  assert.equal(RS.changedKeys(base, local).includes('tiktokUrl'), false);
  local.tiktokUrl = OK;
  assert.ok(RS.changedKeys(base, local).includes('tiktokUrl'));
  local.tiktokUrl = '';
  assert.equal(RS.changedKeys(base, local).includes('tiktokUrl'), false);
});

test('the form, the share page, and the allowlist wire tt without opening the catalog', () => {
  const html = read('index.html');
  const form = html.slice(html.indexOf('ลิงก์ต้นทางโพสต์'), html.indexOf('โน้ตภายใน'));
  assert.match(form, /id="f_tiktokUrl"/);
  assert.match(form, /placeholder="https:\/\/vt\.tiktok\.com\/\.\.\."/);
  assert.match(form, /ลิงก์ TikTok/);
  assert.match(form, /id="tiktokOpenBtn"/);
  assert.equal(form.includes('ใหม่'), false);
  assert.match(html, /'sourceUrl','tiktokUrl'/);
  assert.match(html, /tiktok-link\.js\?v=1/);
  const room = read('room.html');
  assert.match(room, /TIKTOK_LINK\.publicUrl\(d\.tt\)/);
  assert.match(room, /rel="noopener"/);
  assert.match(room, /ดูวิดีโอ/);
  assert.match(room, /Watch on TikTok/);
  assert.match(room, /class="nm"><h1>/);
  assert.match(room, /\$\{ttBtn\}/);
  const features = read('features.js');
  assert.match(features, /TIKTOK_LINK\.publicUrl\(u\.tiktokUrl\)/);
  assert.match(features, /if \(tt\) o\.tt = tt/);
  const edge = read('supabase/functions/share-room/index.ts');
  assert.match(edge, /const tt = tiktokLink\(d\.tt\)/);
  assert.match(edge, /if \(tt\) c\.tt = tt/);
  assert.match(edge, /else delete d\.tt/);
  const catalog = edge.slice(edge.indexOf('body.action === "catalog"'), edge.indexOf('body.action === "cover-thumbs"'));
  assert.equal(catalog.includes('tiktok'), false);
  assert.equal(catalog.includes('.tt'), false);
  assert.match(read('sw.js'), /tiktok-link\.js/);
  assert.match(read('sw.js'), /const VERSION = 'v84'/);
  assert.match(html, /const APP_VERSION = '9\.45'/);
});
