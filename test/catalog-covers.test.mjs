import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const C = require('../catalog-covers.js');
const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const PUB = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/';

test('thumb URL is a sibling -t.jpg and never the original', () => {
  const full = PUB + 'hUJgyj/mvmamg51-1.jpg';
  const spec = C.parseCover(full);
  assert.equal(spec.id, 'hUJgyj');
  assert.equal(spec.file, 'mvmamg51-1.jpg');
  assert.equal(spec.full, full);
  assert.equal(spec.thumb, PUB + 'hUJgyj/mvmamg51-1-t.jpg');
  assert.equal(spec.thumb === spec.full, false);
  assert.equal(C.thumbUrl(full), spec.thumb);
  assert.equal(C.safeThumbPath('hUJgyj/mvmamg51-1-t.jpg'), true);
  assert.equal(C.safeThumbPath('hUJgyj/mvmamg51-1.jpg'), false);
  assert.equal(C.safeThumbPath('hUJgyj/../mvmamg51-1-t.jpg'), false);
  assert.equal(C.safeThumbPath('hUJgyj/mvmamg51-1-t.png'), false);
});

test('png and webp covers still get a jpeg thumb name', () => {
  assert.equal(C.thumbUrl(PUB + 'abcd12/cover.PNG'), PUB + 'abcd12/cover-t.jpg');
  assert.equal(C.parseCover(PUB + 'abcd12/cover.webp').file, 'cover.webp');
  assert.equal(C.parseCover(PUB + 'abcd12/cover-t.jpg').already, true);
  assert.equal(C.thumbUrl(PUB + 'abcd12/cover-t.jpg'), PUB + 'abcd12/cover-t.jpg');
});

test('non public and foreign URLs are ignored', () => {
  assert.equal(C.parseCover(''), null);
  assert.equal(C.parseCover('https://example.com/room-photos/abcd12/a.jpg'), null);
  assert.equal(C.parseCover(PUB + 'ab/a.jpg'), null);
  assert.equal(C.thumbUrl('data:image/jpeg;base64,aaaa'), '');
});

test('photo count is used only when the catalog already has a number', () => {
  assert.equal(C.photoCount({ n: 0 }), 0);
  assert.equal(C.photoCount({ n: 12.2 }), 12);
  assert.equal(C.needsCountFetch({ n: 0 }), false);
  assert.equal(C.needsCountFetch({ n: 4 }), false);
  assert.equal(C.photoCount({}), null);
  assert.equal(C.needsCountFetch({ cover: PUB + 'abcd12/a.jpg' }), true);
  assert.equal(C.photoCount({ n: -1 }), null);
  assert.equal(C.photoCount({ n: 81 }), null);
});

test('cards request a thumb only when it is near the viewport', () => {
  const seen = [];
  class IO {
    constructor(cb) { this.cb = cb; IO.last = this; this.els = []; }
    observe(el) { this.els.push(el); }
    unobserve(el) { this.els = this.els.filter(x => x !== el); }
    disconnect() {}
  }
  function img(left, top) {
    const attrs = { alt: '', decoding: 'async', 'data-src': PUB + 'abcd12/a-t.jpg', 'data-full': PUB + 'abcd12/a.jpg' };
    return {
      className: 'xpi',
      dataset: {},
      attrs,
      src: '',
      loading: '',
      isConnected: true,
      getAttribute(k) { return attrs[k] || null; },
      setAttribute(k, v) { attrs[k] = v; },
      removeAttribute(k) { delete attrs[k]; },
      getBoundingClientRect() { return { left, top, right: left + 160, bottom: top + 130, width: 160, height: 130 }; },
      classList: { add() {}, remove() {} }
    };
  }
  const near = img(16, 200);
  const far = img(900, 200);
  const below = img(16, 2000);
  const sandbox = {
    window: null,
    document: {
      documentElement: { lang: 'th' },
      head: { appendChild() {} },
      createElement() { return { textContent: '' }; },
      addEventListener() {},
      querySelectorAll(sel) {
        assert.match(sel, /xpi/);
        return [near, far, below];
      }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    IntersectionObserver: IO,
    MAX_COVERS: C
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('geo.js'), sandbox, { filename: 'geo.js' });
  sandbox.MAXGEO.bindCovers(sandbox.document);
  assert.equal(near.dataset.armed, '1');
  assert.equal(near.dataset.using, 'full');
  assert.equal(near.src, near.attrs['data-full']);
  assert.equal(near.attrs.fetchpriority, 'high');
  assert.equal(far.dataset.armed, undefined);
  assert.equal(below.dataset.armed, undefined);
  assert.equal(far.src, '');
  assert.ok(IO.last.els.includes(far));
  assert.ok(IO.last.els.includes(below));
  IO.last.cb([{ isIntersecting: true, target: far }, { isIntersecting: false, target: below }]);
  assert.equal(far.dataset.armed, '1');
  assert.equal(far.src, far.attrs['data-src']);
  assert.equal(below.src, '');
  far.onerror();
  assert.equal(far.dataset.fell, '1');
  assert.equal(far.src, far.attrs['data-full']);
  seen.push('ok');
  const html = sandbox.MAXGEO.card({ p: 'The Base (เดอะเบส)', cover: PUB + 'abcd12/a.jpg', rent: 15000, n: 3, t: '1 Bed', sz: 30 }, 'r/abcd12/', 'rent');
  assert.match(html, /data-src="[^"]+a-t\.jpg"/);
  assert.match(html, /data-full="[^"]+a\.jpg"/);
  assert.doesNotMatch(html, /background-image/);
  assert.match(html, /The Base/);
  assert.doesNotMatch(html, /เดอะเบส/);
  assert.match(html, /3 รูป/);
});

test('public catalog page does not request a photo count for every room', () => {
  const agent = read('agent.html');
  assert.match(agent, /rel="preconnect" href="https:\/\/ekpavjlebbclapjdupwf\.supabase\.co"/);
  assert.match(agent, /catalog-covers\.js/);
  assert.match(agent, /G\.bindCovers\(body\)/);
  assert.match(agent, /COUNT_AT_ONCE=2/);
  assert.match(agent, /armCountFallback\(\)/);
  assert.doesNotMatch(agent, /loadCounts\(/);
  assert.doesNotMatch(agent, /Promise\.all\(\[1,2,3,4,5,6\]/);
  assert.match(agent, /url\(catalog-hero\.webp\)/);
  assert.doesNotMatch(agent, /function loop\(el\)\{[^}]*scroll/);
  const geo = read('geo.js');
  assert.match(geo, /manual swipe row only: no auto-scroll/);
  assert.match(geo, /function loop\(el\)\{\}/);
  assert.match(geo, /IntersectionObserver/);
  assert.match(geo, /#c2552d/);
  const edge = read('supabase/functions/share-room/index.ts');
  const post = edge.slice(edge.indexOf('if (req.method !== "POST")'));
  assert.ok(post.indexOf('isOwner') >= 0 && post.indexOf('isOwner') < post.indexOf('action === "cover-thumbs"'));
  const fn = edge.slice(edge.indexOf('async function coverThumbUploads'), edge.indexOf('async function writeOgPage'));
  assert.match(fn, /-t\.jpg/);
  assert.equal(fn.includes('.remove('), false);
  assert.equal(fn.includes('.update('), false);
  assert.equal(fn.includes('upsert: true'), false);
  assert.match(edge, /withCounts/);
  assert.match(edge, /Cache-Control": "public, max-age=120"/);
  assert.match(edge, /imgs: urls/);
  const features = read('features.js');
  assert.match(features, /cache-control': THUMB_CACHE/);
  assert.match(features, /public, max-age=31536000, immutable/);
  assert.match(features, /safeThumbPath/);
  assert.match(features, /FX\.backfillCoverThumbs/);
  assert.match(features, /สร้างรูปย่อหน้าปก/);
  assert.doesNotMatch(features.slice(features.indexOf('async function putThumb'), features.indexOf('async function uploadSignedThumb')), /x-upsert/);
  const room = read('room.html');
  assert.match(room, /catalog-covers\.js/);
  assert.match(room, /bindCovers/);
  const detail = room.slice(room.indexOf('const imgs = d.imgs'), room.indexOf('nearby(qid'));
  assert.match(detail, /src="\$\{esc\(u\)\}"/);
  assert.doesNotMatch(detail, /-t\.jpg/);
});
