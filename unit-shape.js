/* Shape of a room/customer as the app actually keeps it in memory.
   reloadFromStorage and the first load both use normalizeUnits / normalizeCustomers.
   canonicalJson is the sync comparison: stable key order, defaults and the
   loader-made createdAt removed, so a pull is not a mass edit. */
(function (root) {
  'use strict';
  var UNIT_DEFAULTS = {
    bath: '1', building: '', station: '', stationDist: '', ownerLine: '', salePrice: '',
    sourceUrl: '', tiktokUrl: '', internalNote: '', lastPosted: null, postCount: 0, expiredNotified: false
  };
  var CUST_DEFAULTS = {
    name: '', phone: '', line: '', email: '', interestProject: '', interestBuilding: '', interestType: '',
    budgetMin: '', budgetMax: '', status: 'NEW', source: '', nextFollow: '', note: '',
    linkedUnits: [], timeline: []
  };

  function sameDefault(def, val) {
    if (Array.isArray(def)) return Array.isArray(val) && val.length === 0 && def.length === 0;
    return val === def;
  }
  function defaultsFor(kind) {
    if (kind === 'unit') return UNIT_DEFAULTS;
    if (kind === 'cust') return CUST_DEFAULTS;
    return null;
  }
  function normalizeUnit(u, i) {
    u = u && typeof u === 'object' ? u : {};
    return Object.assign({
      bath: '1', building: '', station: '', stationDist: '', ownerLine: '', salePrice: '', sourceUrl: '', tiktokUrl: '', internalNote: '',
      lastPosted: null, postCount: 0, expiredNotified: false,
      createdAt: Date.now() - (9999 - i) * 1000
    }, u);
  }
  function normalizeUnits(list) {
    var arr = Array.isArray(list) ? list : [];
    var out = arr.map(function (u, i) { return normalizeUnit(u, i); });
    out.forEach(function (u, i) { if (!u.createdAt) u.createdAt = Date.now() - (out.length - i) * 1000; });
    return out;
  }
  function normalizeCustomer(c) {
    c = c && typeof c === 'object' ? c : {};
    return Object.assign({
      name: '', phone: '', line: '', email: '', interestProject: '', interestBuilding: '', interestType: '',
      budgetMin: '', budgetMax: '', status: 'NEW', source: '', nextFollow: '', note: '',
      linkedUnits: [], timeline: [], createdAt: Date.now()
    }, c);
  }
  function normalizeCustomers(list) {
    var arr = Array.isArray(list) ? list : [];
    return arr.map(normalizeCustomer);
  }
  function stripDefaults(kind, obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var defaults = defaultsFor(kind);
    var out = {};
    Object.keys(obj).forEach(function (k) {
      if (k === 'createdAt') return;
      if (defaults && Object.prototype.hasOwnProperty.call(defaults, k) && sameDefault(defaults[k], obj[k])) return;
      out[k] = obj[k];
    });
    return out;
  }
  function stableStringify(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(function (v) { var s = stableStringify(v); return s === undefined ? 'null' : s; }).join(',') + ']';
    var parts = [];
    Object.keys(value).sort().forEach(function (k) {
      if (value[k] === undefined) return;
      var s = stableStringify(value[k]);
      if (s === undefined) return;
      parts.push(JSON.stringify(k) + ':' + s);
    });
    return '{' + parts.join(',') + '}';
  }
  function canonicalJson(kind, obj) {
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return obj; } }
    return stableStringify(stripDefaults(kind, obj));
  }

  var api = {
    UNIT_DEFAULTS: UNIT_DEFAULTS,
    CUST_DEFAULTS: CUST_DEFAULTS,
    normalizeUnit: normalizeUnit,
    normalizeUnits: normalizeUnits,
    normalizeCustomer: normalizeCustomer,
    normalizeCustomers: normalizeCustomers,
    canonicalJson: canonicalJson
  };
  root.UNIT_SHAPE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
