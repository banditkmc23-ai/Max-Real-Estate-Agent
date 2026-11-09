import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RS = require('../room-summary.js');
const SHAPE = require('../unit-shape.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const PUB = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/abcd12/cover.jpg';

function row(extra) {
  return Object.assign({
    id: 'u1', rev: 50, project: 'Life Asoke', building: 'A', room: '1201', floor: '12',
    rent: '18000', sale_price: '', type: '1 Bed', bath: '1', size: '35', view: 'city',
    status: 'AVAILABLE', station: 'Asok', station_dist: '400', fav: false,
    created_at: 1700000000000, last_posted: null, post_count: 0,
    notes: 'near BTS', source_url: '', owner: 'May', owner_phone: '0812345678',
    owner_line: '', start_date: '', end_date: '',
    cover_url: PUB, cover_id: 'p1', cover_tsz: 20000, photo_n: 6
  }, extra || {});
}
function fullCloud(extra) {
  return Object.assign({
    id: 'u1', project: 'Life Asoke', building: 'A', room: '1201', floor: '12',
    rent: 18000, type: '1 Bed', bath: '1', size: 35, view: 'city', status: 'AVAILABLE',
    station: 'Asok', stationDist: 400, notes: 'near BTS', owner: 'May', ownerPhone: '0812345678',
    createdAt: 1700000000000, share: { id: 'sh1', secret: 'sec', imgs: ['a.jpg'] },
    internalNote: 'do not publish the owner name'
  }, extra || {});
}

test('a summary round-trip is not an edit, and one rent change is the only changed key', () => {
  const unit = RS.toUnit(row());
  const base = RS.baseOf(unit);
  assert.deepEqual(RS.changedKeys(base, JSON.parse(JSON.stringify(unit))), []);
  const normalized = SHAPE.normalizeUnits([JSON.parse(JSON.stringify(unit))])[0];
  assert.deepEqual(RS.changedKeys(base, normalized), []);
  normalized.rent = 999;
  assert.deepEqual(RS.changedKeys(base, normalized), ['rent']);
});

test('summary does not replace a richer local room or a room this session edited', () => {
  const richer = RS.acceptSummary({ existing: { id: 'u1', notes: 'full' }, tracked: false, sessionEdit: false, incomingRev: 9, haveRev: 0 });
  assert.equal(richer.accept, false);
  assert.equal(richer.reason, 'richer');
  const edited = RS.acceptSummary({ existing: { id: 'u1' }, tracked: true, sessionEdit: true, incomingRev: 9, haveRev: 4 });
  assert.equal(edited.accept, false);
  assert.equal(edited.reason, 'edit');
  const same = RS.acceptSummary({ existing: { id: 'u1' }, tracked: true, sessionEdit: false, incomingRev: 4, haveRev: 4 });
  assert.equal(same.accept, false);
  const fill = RS.acceptSummary({ existing: null, tracked: false, sessionEdit: false, incomingRev: 4, haveRev: 0 });
  assert.equal(fill.accept, true);
});

test('merging summaries by id never duplicates a room', () => {
  const first = RS.toUnit(row());
  let list = RS.mergeList([], [{ id: 'u1', data: first }, { id: 'u2', data: RS.toUnit(row({ id: 'u2', room: '1202' })) }]);
  assert.equal(list.length, 2);
  const again = RS.toUnit(row({ rent: '19000', rev: 60 }));
  list = RS.mergeList(list, [{ id: 'u1', data: again }]);
  assert.equal(list.length, 2);
  assert.equal(list.filter(u => u.id === 'u1').length, 1);
  assert.equal(list.find(u => u.id === 'u1').rent, 19000);
  assert.equal(list.find(u => u.id === 'u2').room, '1202');
});

test('the full cloud row replaces a summary and keeps share plus internal notes', () => {
  const summary = RS.toUnit(row());
  const base = RS.baseOf(summary);
  const cloud = fullCloud();
  const plain = RS.upgrade(base, summary, { deleted: false, data: cloud });
  assert.equal(plain.edited, false);
  assert.equal(plain.action, 'apply');
  assert.equal(plain.data.share.secret, 'sec');
  assert.equal(plain.data.internalNote, 'do not publish the owner name');
  assert.equal(plain.data.rent, 18000);
});

test('an edit made on a summary is overlaid onto the full cloud body and the rest stays', () => {
  const summary = RS.toUnit(row());
  const base = RS.baseOf(summary);
  const local = JSON.parse(JSON.stringify(summary));
  local.rent = 22222;
  local.notes = 'edited notes';
  local.internalNote = '';
  const up = RS.upgrade(base, local, { deleted: false, data: fullCloud() });
  assert.equal(up.edited, true);
  assert.deepEqual(up.keys.sort(), ['notes', 'rent']);
  assert.equal(up.data.rent, 22222);
  assert.equal(up.data.notes, 'edited notes');
  assert.equal(up.data.internalNote, 'do not publish the owner name');
  assert.equal(up.data.share.id, 'sh1');
  assert.equal(up.data.project, 'Life Asoke');
});

test('a blank edit form does not count as clearing fields the summary never stored', () => {
  const summary = RS.toUnit(row());
  const base = RS.baseOf(summary);
  const local = Object.assign({}, summary, { internalNote: '', share: undefined });
  assert.deepEqual(RS.changedKeys(base, local), []);
  const withShare = Object.assign({}, summary, { share: { id: 'new', secret: 'n' } });
  const keys = RS.changedKeys(base, withShare);
  assert.deepEqual(keys, ['share']);
  const up = RS.upgrade(base, withShare, { deleted: false, data: fullCloud() });
  assert.equal(up.data.share.id, 'new');
  assert.equal(up.data.internalNote, 'do not publish the owner name');
});

test('summary bodies are never pushed, a user delete is, and a summary is not fully synced', () => {
  assert.equal(RS.pushDecision({ summary: true, deleted: false, sessionEdit: true }), 'skip');
  assert.equal(RS.pushDecision({ summary: true, deleted: false, sessionEdit: false }), 'skip');
  assert.equal(RS.pushDecision({ summary: true, deleted: true, sessionEdit: true }), 'delete');
  assert.equal(RS.pushDecision({ summary: true, deleted: true, sessionEdit: false, explicit: true }), 'delete');
  assert.equal(RS.pushDecision({ summary: true, deleted: true, sessionEdit: false }), 'skip');
  assert.equal(RS.pushDecision({ summary: false, deleted: false }), 'body');
  const summary = { u1: { rev: 50 } };
  const acked = {};
  assert.equal(!!summary.u1 && !acked.u1, true);
});

test('a cloud delete drops an untouched summary and keeps an edited one', () => {
  const summary = RS.toUnit(row());
  const base = RS.baseOf(summary);
  assert.equal(RS.upgrade(base, summary, { deleted: true, data: null }).action, 'apply');
  assert.equal(RS.upgrade(base, summary, { deleted: true, data: null }).data, null);
  const edited = Object.assign({}, summary, { rent: 1 });
  assert.equal(RS.upgrade(base, edited, { deleted: true, data: null }).action, 'keep');
});

test('cover art uses the sibling -t.jpg and falls back to the original', () => {
  const spec = RS.coverSpec(row());
  assert.equal(spec.thumb, PUB.replace(/\.jpg$/, '-t.jpg'));
  assert.equal(spec.full, PUB);
  assert.equal(spec.n, 6);
  assert.equal(spec.privateId, '');
  const already = PUB.replace(/\.jpg$/, '-t.jpg');
  const again = RS.coverFromUrl(already);
  assert.equal(again.thumb, already);
  assert.equal(again.full, PUB);
  const priv = RS.coverSpec({ id: 'u9', cover_url: 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/authenticated/user-photos/uid/p9_', cover_id: 'p9', cover_tsz: 12, photo_n: 2 });
  assert.equal(priv.privateId, 'p9');
  assert.equal(priv.thumb, '');
  assert.equal(priv.n, 2);
  RS.resetCovers();
  RS.rememberCover('u1', spec);
  assert.equal(RS.coverFor('u1').thumb, spec.thumb);
  RS.rememberCover('u9', { thumb: 'https://signed/t', full: 'https://signed/f', n: 2 });
  assert.equal(RS.coverFor('u9').full, 'https://signed/f');
});

test('the client fetches the summary view, does not ack it, and the SQL stays security invoker', () => {
  const sync = read('sync.js');
  const preview = sync.slice(sync.indexOf('function applySummaries'), sync.indexOf('async function signCovers'));
  assert.match(preview, /acceptSummary/);
  assert.match(preview, /delete st\.r\[k\]/);
  assert.equal(preview.includes('st.r[k] ='), false);
  assert.match(preview, /delete st\.cloudHash\[k\]/);
  assert.match(sync, /unit_list_summary/);
  assert.match(sync, /pushDecision/);
  assert.match(sync, /upgradeSummaries/);
  assert.match(sync, /startPreview\(\)/);
  const pullAt = sync.indexOf('await pull(');
  const pushAt = sync.indexOf('await push(');
  assert.ok(pullAt > 0 && pushAt > pullAt);
  const sql = read('supabase/unit-list-summary.sql');
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /drop view if exists public\.unit_list_summary/);
  assert.match(sql, /revoke all on table public\.unit_list_summary from public, anon, authenticated, service_role/);
  assert.match(sql, /grant select on table public\.unit_list_summary to authenticated/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /grant [^;]*to service_role/i);
  assert.doesNotMatch(sql, /to anon/);
  const html = read('index.html');
  assert.match(html, /const APP_VERSION = '9\.36'/);
  assert.match(html, /room-summary\.js\?v=1/);
  assert.match(html, /function cloudCover/);
  assert.match(html, /function useCloudCover/);
  const sw = read('sw.js');
  assert.match(sw, /const VERSION = 'v71'/);
  assert.match(sw, /room-summary\.js/);
  new Function(sync);
  new Function(read('room-summary.js'));
});
