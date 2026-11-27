import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('store.js loads before the app script and sync.js, and is in the offline shell', () => {
  const html = read('index.html');
  const iStore = html.indexOf('<script src="store.js'), iMain = html.indexOf('// ============= DATA LAYER'), iSync = html.indexOf('<script src="sync.js?v=56"');
  assert.ok(iStore > 0 && iStore < iMain && iMain < iSync);
  assert.match(read('sw.js'), /'store\.js'/);
});

test('only the three big keys move, and an old copy is removed only after a verified read-back', () => {
  const s = read('store.js');
  assert.match(s, /MOVED = \['max_sync_v1', 'staylow_hero_img', 'staylow_avatar'\]/);
  assert.doesNotMatch(s, /localStorage\.clear|\.clear\(\)\s*;?\s*\/\/ wipe|deleteDatabase/);
  const m = s.slice(s.indexOf('async function migrateKey'), s.indexOf('var report'));
  assert.ok(m.indexOf('idbGet(k)') < m.indexOf('lsRemove(k)'), 'read back before removing');
  assert.match(m, /if \(back !== pre\) throw/);
});

test('sync state is never saved before it is loaded, and the pending queue is mirrored', () => {
  const s = read('sync.js');
  assert.match(s, /if \(!stLoaded\) return; \/\/ never write a placeholder/);
  assert.match(s, /rawSet\.call\(LS, QK, JSON\.stringify\(\{ uid: st\.uid, dirty: st\.dirty/);
  assert.match(s, /sb\.auth\.onAuthStateChange\(\(ev, session\) => \{ stReady\.then/);
  assert.match(s, /await stReady;/);
});

test('a quota error while writing pulled rows does not stop the push', () => {
  const s = read('sync.js');
  assert.match(s, /e\.maxQuota = true/);
  const main = s.slice(s.indexOf('async function sync('), s.indexOf('function schedule('));
  assert.match(main, /catch \(e\) \{ if \(!e \|\| !e\.maxQuota\) throw e; localFull = e;[^\n]*pushing anyway/);
  assert.ok(main.indexOf('pushing anyway') < main.indexOf('await push()'));
});

test('app writers report a full device instead of failing silently', () => {
  const html = read('index.html');
  assert.match(html, /function persist\(\) \{ try \{ localStorage\.setItem\(KEY, JSON\.stringify\(units\)\); \} catch \(e\) \{ try \{ window\.MAX_STORE && MAX_STORE\.onWriteFail\(e, persist\)/);
  assert.match(html, /function persistCust\(\)[^\n]*MAX_STORE\.onWriteFail\(e, persistCust\)/);
});
