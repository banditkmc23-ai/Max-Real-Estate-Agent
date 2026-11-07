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

test('share of every file is the primary action, with text only when canShare accepts it', () => {
  const filesOnly = C.selectPhotoCopy({ count: 8, canShareFiles: true, canShareWithText: false, description: 'รายละเอียด', sharePhase: 'untried', roomId: 'u1' });
  assert.deepEqual(filesOnly, { action: 'share', includeText: false, text: '' });
  const withText = C.selectPhotoCopy({ count: 8, canShareFiles: true, canShareWithText: true, description: 'รายละเอียด', sharePhase: 'untried', roomId: 'u1' });
  assert.equal(withText.action, 'share');
  assert.equal(withText.includeText, true);
  assert.equal(withText.text, 'รายละเอียด');
  const noNotes = C.selectPhotoCopy({ count: 3, canShareFiles: true, canShareWithText: true, description: '', sharePhase: 'untried', roomId: 'u1' });
  assert.equal(noNotes.includeText, false);
});

test('a text share failure retries files only, and AbortError stays silent', () => {
  const retry = C.selectPhotoCopy({ count: 4, canShareFiles: true, canShareWithText: true, description: 'โน้ต', sharePhase: 'text-failed', canTryMulti: true, roomId: 'u1' });
  assert.deepEqual(retry, { action: 'share', includeText: false, text: '' });
  const abort = C.selectPhotoCopy({ count: 4, canShareFiles: true, sharePhase: 'abort', canTryMulti: true, canWriteSinglePng: true, roomId: 'u1' });
  assert.deepEqual(abort, { action: 'silent' });
  assert.equal(abort.action === 'copy-one', false);
});

test('clipboard fallbacks run only after share is unavailable or has failed, and never download', () => {
  const base = { count: 8, roomId: 'room-a', description: 'โน้ต', canShareWithText: false };
  const multi = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, canTryMulti: true, sharePhase: 'untried' }));
  assert.equal(multi.action, 'write-multi');
  const afterShare = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: true, canTryMulti: true, sharePhase: 'failed' }));
  assert.equal(afterShare.action, 'write-multi');
  const html = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, multiTried: true, multiOk: false, canTryHtml: true, canWriteSinglePng: false }));
  assert.equal(html.action, 'write-html');
  const pngInstead = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, multiTried: true, multiOk: false, canTryHtml: true, canWriteSinglePng: true, cursor: null }));
  assert.equal(pngInstead.action, 'copy-one');
  assert.equal(pngInstead.index, 0);
  const doneMulti = C.selectPhotoCopy(Object.assign({}, base, { canShareFiles: false, multiTried: true, multiOk: true }));
  assert.equal(doneMulti.via, 'multi');
  assert.equal(doneMulti.toast, C.allToast(8));
  const actions = ['share', 'silent', 'done', 'write-multi', 'write-html', 'copy-one', 'unsupported', 'none'];
  for (const result of [multi, afterShare, html, doneMulti]) assert.equal(actions.includes(result.action), true);
  assert.equal(JSON.stringify([multi, afterShare, html, doneMulti]).includes('download'), false);
});

test('one photo per click cycles and resets when the room changes', () => {
  const toast = C.oneToast(1, 8);
  assert.equal(toast, 'คัดลอกรูปที่ 1/8 แล้ว วางได้เลย กดอีกครั้งเพื่อรูปถัดไป');
  const first = C.selectPhotoCopy({ count: 8, roomId: 'a', canShareFiles: false, multiTried: true, htmlTried: true, canWriteSinglePng: true, cursor: null });
  assert.equal(first.action, 'copy-one');
  assert.equal(first.index, 0);
  assert.equal(first.toast, toast);
  assert.deepEqual(first.nextCursor, { roomId: 'a', index: 1 });
  const second = C.selectPhotoCopy({ count: 8, roomId: 'a', canShareFiles: false, multiTried: true, htmlTried: true, canWriteSinglePng: true, cursor: first.nextCursor });
  assert.equal(second.index, 1);
  assert.equal(second.number, 2);
  assert.equal(second.toast, 'คัดลอกรูปที่ 2/8 แล้ว วางได้เลย กดอีกครั้งเพื่อรูปถัดไป');
  let cursor = { roomId: 'a', index: 0 };
  const seen = [];
  for (let n = 0; n < 10; n++) {
    const step = C.selectPhotoCopy({ count: 8, roomId: 'a', canShareFiles: false, multiTried: true, htmlTried: true, canWriteSinglePng: true, cursor: cursor });
    seen.push(step.number);
    cursor = step.nextCursor;
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 1, 2]);
  const other = C.selectPhotoCopy({ count: 8, roomId: 'b', canShareFiles: false, multiTried: true, htmlTried: true, canWriteSinglePng: true, cursor: { roomId: 'a', index: 5 } });
  assert.equal(other.index, 0);
  assert.equal(other.nextCursor.roomId, 'b');
  const wrapped = C.selectPhotoCopy({ count: 3, roomId: 'a', canShareFiles: false, multiTried: true, htmlTried: true, canWriteSinglePng: true, cursor: { roomId: 'a', index: 9 } });
  assert.equal(wrapped.index, 0);
});

test('nothing supported explains in Thai and does not offer a download', () => {
  const none = C.selectPhotoCopy({ count: 2, roomId: 'a', canShareFiles: false, multiTried: true, htmlTried: true, canWriteSinglePng: false });
  assert.equal(none.action, 'unsupported');
  assert.equal(none.toast, C.UNSUPPORTED_TOAST);
  assert.equal(none.toast, 'เบราว์เซอร์นี้แชร์หรือคัดลอกรูปไม่ได้');
  assert.equal(C.selectPhotoCopy({ count: 0, canShareFiles: true }).action, 'none');
});

test('the room button keeps the v9.0 share path and does not download', () => {
  const html = read('index.html');
  const fn = html.slice(html.indexOf('async function copyAndSharePhotos'), html.indexOf('function copy('));
  assert.match(fn, /MAX_PHOTO_COPY/);
  assert.match(fn, /selectPhotoCopy/);
  assert.match(fn, /navigator\.share/);
  assert.match(fn, /AbortError/);
  assert.match(fn, /writeMultiPng/);
  assert.match(fn, /writeHtmlPhotos/);
  assert.match(fn, /copyOnePng/);
  assert.match(fn, /แชร์รูปแล้ว/);
  assert.equal(fn.includes('.download'), false);
  assert.equal(fn.includes('ดาวน์โหลด'), false);
  const quick = html.slice(html.indexOf('function quickCopy'), html.indexOf('let photoCopyCursor'));
  assert.match(quick, /คัดลอกรายละเอียดแล้ว/);
  assert.match(quick, /copy\(text\)/);
  assert.match(html, /photo-copy\.js\?v=1/);
  assert.match(read('sw.js'), /photo-copy\.js/);
  const features = read('features.js');
  assert.match(features, /v9\.28: cloudLink's sig does not match/);
  assert.match(features, /async function bgShareUpdate/);
});
