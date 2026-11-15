/* Remember the open screen so an iOS Home Screen app can be killed and resumed.
   Stored separately from synced data. Expires after 12 hours. */
(function (root) {
  'use strict';
  var KEY = 'staylow_view_state_v1';
  var MAX_AGE = 12 * 60 * 60 * 1000;

  function now() { return Date.now(); }

  function read(raw, at) {
    if (!raw) return null;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || typeof o.savedAt !== 'number') return null;
    if (((at == null) ? now() : at) - o.savedAt > MAX_AGE) return { expired: true };
    return o;
  }

  function load(storage, at) {
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { return null; }
    var o = read(raw, at);
    if (o && o.expired) {
      try { storage.removeItem(KEY); } catch (e) {}
      return null;
    }
    return o;
  }

  function save(storage, state, at) {
    var o = {};
    Object.keys(state || {}).forEach(function (k) { o[k] = state[k]; });
    o.savedAt = at == null ? now() : at;
    storage.setItem(KEY, JSON.stringify(o));
    return o;
  }

  function listEntry(state) {
    var s = JSON.parse(JSON.stringify(state || {}));
    s.detailUnitId = null;
    s.detailCustId = null;
    s.detailScroll = 0;
    s.custScroll = 0;
    s.map = null;
    s.fx = null;
    return s;
  }

  function overlayOf(state) {
    if (!state) return null;
    if (state.detailUnitId) return 'room:' + state.detailUnitId;
    if (state.detailCustId) return 'cust:' + state.detailCustId;
    if (state.map && state.map.open) return 'map';
    if (state.fx) return 'fx:' + state.fx;
    return null;
  }

  /* Back from a restored room/customer/map returns to the list underneath. */
  function historyPlan(state) {
    if (!state) return { steps: [] };
    var list = listEntry(state);
    if (overlayOf(state)) return { steps: [{ op: 'replace', view: list }, { op: 'push', view: state }] };
    return { steps: [{ op: 'replace', view: list }] };
  }

  root.MAX_VIEW = {
    KEY: KEY,
    MAX_AGE: MAX_AGE,
    read: read,
    load: load,
    save: save,
    listEntry: listEntry,
    overlayOf: overlayOf,
    historyPlan: historyPlan
  };
})(typeof window !== 'undefined' ? window : globalThis);
