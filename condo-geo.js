/* Project name -> pin lookup. Read-only. No unit writes.
   Keys are folded English names. A project string matches when any of its
   English forms (full name, text outside parentheses, text inside parentheses)
   hits a key, a spaceless key, or a near-identical key with the same numbers. */
(function (root, factory) {
  var api = factory();
  root.CONDO_GEO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STOP = { the: 1, by: 1, at: 1, and: 1, condo: 1, condominium: 1, residence: 1, residences: 1, bangkok: 1 };

  function fold(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function latinish(t) {
    return (String(t).match(/[a-z]/gi) || []).length >= 3;
  }

  function englishName(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var groups = [];
    var re = /\(([^)]*)\)/g, m;
    while ((m = re.exec(s))) groups.push(m[1].trim());
    var outside = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (latinish(outside)) return outside.replace(/[^\x00-\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < groups.length; i++) if (latinish(groups[i])) return groups[i];
    var stripped = outside.replace(/[^\x00-\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped || s;
  }

  function forms(raw) {
    var s = String(raw || '').trim();
    var out = [];
    function add(v) { v = String(v || '').trim(); if (v && out.indexOf(v) < 0) out.push(v); }
    add(s);
    add(s.replace(/\([^)]*\)/g, ' '));
    var re = /\(([^)]*)\)/g, m;
    while ((m = re.exec(s))) add(m[1]);
    add(englishName(s));
    return out;
  }

  function rawKey(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function numsOf(s) {
    return (fold(s).match(/\d+/g) || []).filter(function (n) { return n.length >= 2; });
  }

  function sameNums(a, b) {
    var x = numsOf(a), y = numsOf(b);
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    var prev = new Array(b.length + 1);
    var cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
      }
      var swap = prev; prev = cur; cur = swap;
    }
    return prev[b.length];
  }

  function index(db) {
    var by = Object.create(null);
    var tight = Object.create(null);
    var list = (db && db.projects) || [];
    list.forEach(function (p) {
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
      (p.keys || []).forEach(function (k) {
        var rk = rawKey(k);
        if (rk) by[rk] = p;
        var f = fold(k);
        if (!f) return;
        by[f] = p;
        tight[f.replace(/ /g, '')] = p;
      });
    });
    return { by: by, tight: tight, list: list };
  }

  function resolve(dbOrIdx, raw) {
    var idx = dbOrIdx && dbOrIdx.by ? dbOrIdx : index(dbOrIdx);
    var tried = forms(raw);
    var i, f, t, hit;
    for (i = 0; i < tried.length; i++) {
      var rk = rawKey(tried[i]);
      if (rk && idx.by[rk]) return idx.by[rk];
      f = fold(tried[i]);
      if (f && idx.by[f]) return idx.by[f];
      t = f.replace(/ /g, '');
      if (t && idx.tight[t]) return idx.tight[t];
    }
    var best = null, bestD = 3;
    for (i = 0; i < tried.length; i++) {
      f = fold(tried[i]);
      if (f.length < 10) continue;
      var keys = Object.keys(idx.by);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (key.indexOf(' ') < 0 && key.length < 8) continue;
        if (Math.abs(key.length - f.length) > 2) continue;
        if (!sameNums(f, key)) continue;
        var fw = f.split(' ')[0], kw = key.split(' ')[0];
        if (fw !== kw) continue;
        var d = levenshtein(f, key);
        var limit = f.length >= 16 ? 2 : 1;
        if (d > 0 && d <= limit && d < bestD) { bestD = d; best = idx.by[key]; }
      }
    }
    return best;
  }

  function bedBuckets(type) {
    var t = String(type || '').toLowerCase();
    var b = [];
    if (/studio|สตูดิโอ/.test(t)) b.push('studio');
    if (/duplex|ดูเพล็กซ์|ดูเพลกซ์/.test(t)) b.push('duplex');
    var re = /(\d+)\s*(?:\+\s*\d+)?\s*bed/gi, m, any = false;
    while ((m = re.exec(t))) { any = true; if (b.indexOf(m[1]) < 0) b.push(m[1]); }
    if (!any && !b.length) {
      var m2 = t.match(/(\d+)/);
      if (m2 && b.indexOf(m2[1]) < 0) b.push(m2[1]);
    }
    return b;
  }

  function amount(v) {
    var n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  return {
    fold: fold,
    rawKey: rawKey,
    englishName: englishName,
    forms: forms,
    numsOf: numsOf,
    index: index,
    resolve: resolve,
    bedBuckets: bedBuckets,
    amount: amount,
    STOP: STOP
  };
});
