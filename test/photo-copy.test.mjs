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

test('a text share failure retries files only, and AbortError stays silent', () => {
  const retry = C.selectPhotoCopy({ count: 4, canShareFiles: true, canShareWithText: true, description: 'โน้ต', sharePhase: 'text-failed', canTryMulti: true, roomId: 'u1' });
  assert.deepEqual(retry, { action: 'share', includeText: false, text: '' });
  assert.equal(JSON.stringify(retry).includes('โน้ต'), false);
  const abort = C.selectPhotoCopy({ count: 4, canShareFiles: true, sharePhase: 'abort', canTryMulti: true, canWriteSinglePng: true, roomId: 'u1' });
  assert.deepEqual(abort, { action: 'silent' });
  assert.equal(abort.action === 'copy-one', false);
});

test('a set that cannot be shared becomes one ZIP, never a silent one-photo copy', () => {
  const base = { count: 8, roomId: 'room-a', description: 'โน้ต รายละเอียดห้อง', canShareWithText: true, canTryMulti: true, canTryHtml: true, canWriteSinglePng: true };
  const unavailable = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, sharePhase: 'untried' }));
  assert.equal(unavailable.action, 'zip');
  assert.equal(unavailable.includeText, false);
  assert.equal(unavailable.text, '');
  assert.equal(unavailable.toast, C.ZIP_TOAST);
  assert.equal(unavailable.toast, 'แชร์รูปทั้งหมดทีเดียวไม่ได้ จึงดาวน์โหลดเป็น ZIP แล้ว');
  assert.equal(JSON.stringify(unavailable).includes('โน้ต'), false);
  assert.equal(JSON.stringify(unavailable).includes('รายละเอียด'), false);
  const failed = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: true, sharePhase: 'failed' }));
  assert.equal(failed.action, 'zip');
  assert.equal(failed.action === 'copy-one', false);
  assert.equal(JSON.stringify(failed).includes('โน้ต'), false);
  const blocked = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, canZip: false }));
  assert.equal(blocked.action, 'unsupported');
  assert.equal(blocked.toast, C.UNSUPPORTED_TOAST);
  assert.equal(C.selectPhotoCopy({ count: 0, canShareFiles: true }).action, 'none');
});

test('one photo can still be copied when share is missing, and a set never cycles', () => {
  const one = C.selectPhotoCopy({ count: 1, roomId: 'a', canShareFiles: false, canWriteSinglePng: true });
  assert.equal(one.action, 'copy-one');
  assert.equal(one.index, 0);
  assert.equal(one.total, 1);
  assert.equal(one.toast, C.allToast(1));
  const shared = C.selectPhotoCopy({ count: 1, roomId: 'a', canShareFiles: true, description: 'โน้ต', sharePhase: 'untried' });
  assert.deepEqual(shared, { action: 'share', includeText: false, text: '' });
  const zipInstead = C.selectPhotoCopy({ count: 1, roomId: 'a', canShareFiles: false, canWriteSinglePng: false });
  assert.equal(zipInstead.action, 'zip');
  for (const count of [2, 8]) {
    const step = C.selectPhotoCopy({ count, roomId: 'a', canShareFiles: false, canWriteSinglePng: true, cursor: { roomId: 'a', index: 3 } });
    assert.equal(step.action, 'zip');
    assert.equal(step.action === 'copy-one', false);
  }
});

test('Chrome share files are jpeg or png with a matching extension', () => {
  assert.equal(C.shareMime('image/jpg'), 'image/jpeg');
  assert.equal(C.shareMime('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(C.shareMime('image/png'), 'image/png');
  assert.equal(C.shareMime('image/x-png'), 'image/png');
  assert.equal(C.shareMime('image/webp'), '');
  assert.equal(C.shareMime('image/heic'), '');
  assert.equal(C.shareMime(''), '');
  assert.equal(C.shareFileName('Ideo_12_1', 'image/jpeg'), 'Ideo_12_1.jpg');
  assert.equal(C.shareFileName('Ideo_12_1.jpg', 'image/png'), 'Ideo_12_1.png');
  assert.equal(C.shareFileName('Ideo_12_1.webp', 'image/webp'), 'Ideo_12_1.jpg');
  const jpeg = { type: 'image/jpeg', name: 'a.jpg', size: 4 };
  const png = { type: 'image/png', name: 'b.png', size: 4 };
  assert.equal(C.filesAreShareable([jpeg, png]), true);
  assert.equal(C.filesAreShareable([jpeg, { type: 'image/webp', name: 'c.webp', size: 4 }]), false);
  assert.equal(C.filesAreShareable([{ type: 'image/png', name: 'c.jpg', size: 4 }]), false);
  assert.equal(C.filesAreShareable([{ type: 'image/jpeg', name: 'c.jpg', size: 0 }]), false);
  const photos = [{ id: 'a', cover: false, order: 1, url: 'u', full: { size: 10 } }];
  assert.notEqual(C.shareStamp(photos), C.shareStamp([{ id: 'a', cover: true, order: 1, url: 'u', full: { size: 10 } }]));
  assert.notEqual(C.shareStamp(photos), C.shareStamp([{ id: 'b', cover: false, order: 1, url: 'u', full: { size: 10 } }]));
});

test('the ZIP holds every photo and no room text', () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const notes = 'รายละเอียดห้อง ใกล้ BTS';
  const a = new TextEncoder().encode('jpeg-a');
  const b = new TextEncoder().encode('png-b');
  const zip = C.buildStoredZip([
    { name: 'โครงการ_12_1.jpg', data: a },
    { name: 'โครงการ_12_2.png', data: b },
    { name: 'โครงการ_12_2.png', data: b }
  ], new Date(2026, 0, 2, 3, 4, 6));
  const files = readStoredZip(zip);
  assert.deepEqual(files.map(f => f.name), ['โครงการ_12_1.jpg', 'โครงการ_12_2.png', 'โครงการ_12_2_2.png']);
  assert.equal(files.length, 3);
  for (const file of files) {
    assert.equal(file.method, 0);
    assert.equal(file.flags & 0x0800, 0x0800);
    assert.equal(file.crc, C.crc32(file.data));
  }
  assert.deepEqual(files[0].data, a);
  assert.deepEqual(files[1].data, b);
  const blob = Buffer.from(zip).toString('utf8');
  assert.equal(blob.includes(notes), false);
  assert.equal(files.some(f => /\.txt$/i.test(f.name)), false);
});

test('the room button shares prepared files in the click and zips the rest', () => {
  const html = read('index.html');
  const tap = html.slice(html.indexOf('async function copyAndSharePhotos'), html.indexOf('function copy('));
  const head = tap.slice(0, tap.indexOf('await '));
  assert.match(head, /roomShareReady\.get\(id\)/);
  assert.match(head, /return sharePreparedPhotos\(id, u, ready\.pairs, ready\.zipBlob\)/);
  assert.equal(head.includes('getUnitPhotos'), false);
  const share = html.slice(html.indexOf('async function sharePreparedPhotos'), html.indexOf('async function copyAndSharePhotos'));
  assert.equal(share.indexOf('await '), share.indexOf('await navigator.share({ files: files })'));
  assert.match(share, /navigator\.share\(\{ files: files \}\)/);
  assert.match(share, /selectPhotoCopy/);
  assert.match(share, /canSharePayload\(\{ files: files \}\)/);
  assert.match(share, /แชร์รูปแล้ว/);
  assert.match(share, /AbortError/);
  assert.match(share, /downloadPhotoZip/);
  assert.match(share, /copyOnePng\(files\[0\]\)/);
  assert.equal(share.includes('plan.text'), false);
  assert.equal(share.includes('text: plan'), false);
  assert.equal(share.includes('title:'), false);
  assert.equal(share.includes('files.forEach'), false);
  const abort = share.slice(share.indexOf('AbortError'), share.indexOf("sharePhase = 'failed'"));
  assert.match(abort, /return/);
  assert.equal(abort.includes('downloadPhotoZip'), false);
  const zipFn = html.slice(html.indexOf('function zipDownloadName'), html.indexOf('async function sharePreparedPhotos'));
  assert.match(zipFn, /buildStoredZip/);
  assert.match(zipFn, /\.download = /);
  assert.match(zipFn, /_photos\.zip/);
  assert.equal(zipFn.includes('notes'), false);
  assert.equal(zipFn.includes('description'), false);
  assert.equal(zipFn.includes('text/plain'), false);
  const save = html.slice(html.indexOf('function saveZipBlob'), html.indexOf('async function zipBlobFromFiles'));
  assert.equal(save.includes('await'), false);
  assert.match(share, /if \(zipBlob\) saveZipBlob\(/);
  const open = html.slice(html.indexOf('function openDetailView'), html.indexOf('function closeDetailView'));
  assert.match(open, /prepareRoomShareFiles\(unitId\)/);
  assert.match(html, /onpointerdown="prepareRoomShareFiles/);
  assert.match(html, /function shareFileFromBlob/);
  assert.match(html, /PC\.shareMime/);
  assert.match(html, /blobToJpeg/);
  assert.match(html, /const allLocal = photos\.length && photos\.every/);
  const quick = html.slice(html.indexOf('function quickCopy'), html.indexOf('const roomShareReady'));
  assert.match(quick, /คัดลอกรายละเอียดแล้ว/);
  assert.match(quick, /copy\(text\)/);
  assert.match(html, />คัดข้อความ</);
  assert.match(html, /คัดลอกรูปภาพ \(\$\{pic\}\)/);
  assert.match(html, /class="dv-btn bg-brick-50 text-brick-700"/);
  assert.match(html, /#c2552d/);
  assert.match(html, /photo-copy\.js\?v=3/);
  assert.match(html, /const APP_VERSION = '9\.31'/);
  assert.match(read('sw.js'), /photo-copy\.js/);
  assert.match(read('sw.js'), /const VERSION = 'v66'/);
  const features = read('features.js');
  assert.match(features, /v9\.28: cloudLink's sig does not match/);
  assert.match(features, /async function bgShareUpdate/);
});

function readStoredZip(bytes) {
  const files = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extra = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLen + extra;
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const data = bytes.subarray(start, start + size);
    files.push({ name, flags, method, crc, data });
    offset = start + size;
  }
  return files;
}
