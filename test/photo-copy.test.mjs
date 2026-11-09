import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const C = require('../photo-copy.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

function photo(id, extra) {
  return Object.assign({ id: id, cover: false }, extra);
}

test('cover moves first and the other photos keep their order', () => {
  const input = [photo('a'), photo('b', { cover: true }), photo('c'), photo('d', { cover: true })];
  const ordered = C.orderPhotos(input);
  assert.deepEqual(ordered.map(p => p.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(input.map(p => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(C.orderPhotos([photo('a'), photo('b')]).map(p => p.id), ['a', 'b']);
  assert.deepEqual(C.orderPhotos([]), []);
  assert.deepEqual(C.orderPhotos(null), []);
});

test('description text is the trimmed room notes', () => {
  assert.equal(C.descriptionText({ notes: '  ใกล้ BTS  ' }), 'ใกล้ BTS');
  assert.equal(C.descriptionText({ notes: '   ' }), '');
  assert.equal(C.descriptionText({}), '');
  assert.equal(C.descriptionText(null), '');
});

test('share of every file is photos only, even when notes exist and canShare would accept text', () => {
  const described = { count: 8, canShareFiles: true, canShareWithText: true, description: 'รายละเอียดห้อง ใกล้ BTS', sharePhase: 'untried', roomId: 'u1' };
  const withNotes = C.selectPhotoCopy(described);
  assert.deepEqual(withNotes, { action: 'share', includeText: false, text: '' });
  assert.equal(JSON.stringify(withNotes).includes('รายละเอียด'), false);
  assert.equal(JSON.stringify(withNotes).includes('BTS'), false);
  const filesOnly = C.selectPhotoCopy({ count: 8, canShareFiles: true, canShareWithText: false, description: 'รายละเอียด', sharePhase: 'untried', roomId: 'u1' });
  assert.deepEqual(filesOnly, { action: 'share', includeText: false, text: '' });
  const noNotes = C.selectPhotoCopy({ count: 3, canShareFiles: true, canShareWithText: true, description: '', sharePhase: 'untried', roomId: 'u1' });
  assert.deepEqual(noNotes, { action: 'share', includeText: false, text: '' });
});

test('a failed or missing share downloads every file, and cancel does not', () => {
  const base = { count: 8, description: 'โน้ต รายละเอียดห้อง' };
  const missing = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, sharePhase: 'untried' }));
  assert.equal(missing.action, 'download');
  assert.equal(missing.count, 8);
  assert.equal(missing.includeText, false);
  assert.equal(missing.text, '');
  assert.match(missing.toast, /ดาวน์โหลดรูปแล้ว/);
  assert.equal(JSON.stringify(missing).includes('โน้ต'), false);
  const failed = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: true, sharePhase: 'failed' }));
  assert.equal(failed.action, 'download');
  assert.equal(failed.action === 'copy-one', false);
  const cancel = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: true, sharePhase: 'abort' }));
  assert.equal(cancel.action, 'cancel');
  assert.equal(cancel.toast, 'ยกเลิก');
  assert.equal(C.selectPhotoCopy({ count: 0, canShareFiles: true }).action, 'none');
});

test('photo file names are sanitized jpeg names in storage order', () => {
  assert.equal(C.photoFileName('Ideo Q', '12A', 0), 'Ideo_Q_12A_1.jpg');
  assert.equal(C.photoFileName('a/b', 'c\\d', 2), 'ab_cd_3.jpg');
  assert.equal(C.photoFileName('', '', 0), 'photo_1.jpg');
  const input = [photo('a', { order: 3 }), photo('b', { order: 1 }), photo('c', { order: 2 })];
  assert.deepEqual(C.sortByOrder(input).map(p => p.id), ['b', 'c', 'a']);
  assert.deepEqual(input.map(p => p.id), ['a', 'b', 'c']);
});

test('one press shares every prepared file or downloads each file', () => {
  const html = read('index.html');
  const fn = html.slice(html.indexOf('async function copyAndSharePhotos'), html.indexOf('function copy('));
  const ready = fn.slice(0, fn.indexOf('await '));
  assert.match(ready, /preparedShareFiles\(unitId\)/);
  assert.equal(ready.includes('getUnitPhotos'), false);
  assert.match(fn, /navigator\.share\(\{ files: files \}\)/);
  assert.match(fn, /navigator\.canShare && navigator\.canShare\(\{ files: files \}\)/);
  assert.match(fn, /แชร์รูปแล้ว/);
  assert.match(fn, /toast\('ยกเลิก'\)/);
  assert.match(fn, /downloadAllPhotos\(files\)/);
  assert.match(fn, /ดาวน์โหลดรูปแล้ว/);
  assert.match(fn, /อนุญาตดาวน์โหลดหลายไฟล์/);
  assert.equal(fn.includes('plan.text'), false);
  assert.equal(fn.includes('text:'), false);
  assert.equal(fn.includes('clipboard.write'), false);
  assert.equal(fn.includes('photoCopyCursor'), false);
  assert.equal(fn.includes('ZIP'), false);
  assert.equal(fn.includes('setTimeout'), false);
  const download = html.slice(html.indexOf('function downloadAllPhotos'), html.indexOf('function dropRoomShare'));
  assert.match(download, /a\.download = files\[i\]\.name/);
  assert.match(download, /a\.click\(\)/);
  assert.match(download, /URL\.revokeObjectURL/);
  assert.match(download, /pagehide/);
  assert.equal(download.includes('setTimeout'), false);
  assert.match(html, /const allLocal = photos\.length && photos\.every/);
  assert.match(html, /type: 'image\/jpeg'/);
  assert.match(html, /mode: 'cors', credentials: 'omit'/);
  const open = html.slice(html.indexOf('function openDetailView'), html.indexOf('function closeDetailView'));
  assert.match(open, /prepareRoomShareFiles\(unitId\)/);
  assert.match(html, /onpointerdown="prepareRoomShareFiles/);
  const quick = html.slice(html.indexOf('function quickCopy'), html.indexOf('const roomShareReady'));
  assert.match(quick, /คัดลอกรายละเอียดแล้ว/);
  assert.match(quick, /copy\(text\)/);
  assert.match(html, />คัดข้อความ</);
  assert.match(html, /คัดลอกรูปภาพ \(\$\{pic\}\)/);
  assert.match(html, /class="dv-btn bg-brick-50 text-brick-700"/);
  assert.match(html, /#c2552d/);
  assert.match(html, /photo-copy\.js\?v=5/);
  assert.match(html, /const APP_VERSION = '9\.37'/);
  assert.match(read('sw.js'), /photo-copy\.js/);
  assert.match(read('sw.js'), /const VERSION = 'v72'/);
  const features = read('features.js');
  assert.match(features, /v9\.28: cloudLink's sig does not match/);
  assert.match(features, /async function bgShareUpdate/);
});

test('the main script parses, so photo prefetch cannot blank the home screen', () => {
  const html = read('index.html');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const main = blocks.find(src => src.includes('function render('));
  assert.ok(main, 'main app script');
  new Function(main);
  new Function(read('photo-copy.js'));
  const prep = main.slice(main.indexOf('function prepareRoomShareFiles'), main.indexOf('async function copyAndSharePhotos'));
  assert.equal((prep.match(/const hit =/g) || []).length, 1);
  assert.equal(main.includes('photoCopyCursor'), false);
  assert.equal(main.includes('clipboard.write(['), false);
});
