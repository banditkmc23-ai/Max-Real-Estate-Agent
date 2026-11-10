/* Public TikTok link for a room.
   Returns an https URL on a TikTok host, or ''.
   A missing scheme is treated as https. http and every other host are dropped.
   room.html and the share payload both use this so a bad value never becomes a link. */
(function (root) {
  'use strict';
  var HOSTS = { 'tiktok.com': 1, 'www.tiktok.com': 1, 'vt.tiktok.com': 1, 'vm.tiktok.com': 1 };
  function publicUrl(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 500) return '';
    if (/[\u0000-\u0020\\]/.test(s)) return '';
    var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
    if (scheme) {
      if (scheme[1].toLowerCase() !== 'https') return '';
    } else {
      if (s.slice(0, 2) === '//') return '';
      s = 'https://' + s;
      if (s.length > 500) return '';
    }
    var u;
    try { u = new URL(s); } catch (e) { return ''; }
    if (u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    if (u.port) return '';
    var host = String(u.hostname || '').toLowerCase().replace(/\.$/, '');
    if (!HOSTS[host]) return '';
    return u.href;
  }
  var api = { publicUrl: publicUrl };
  root.TIKTOK_LINK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
