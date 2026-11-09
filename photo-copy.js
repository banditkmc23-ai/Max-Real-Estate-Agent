/* MAX Agent — room photo copy selection.
   One press sends every photo. Share the files when the browser can, otherwise
   download each file. Never attach room notes, never copy one image at a time,
   and never build a ZIP. */
(function (root) {
  'use strict';

  var SHARE_TOAST = 'แชร์รูปแล้ว';
  var CANCEL_TOAST = 'ยกเลิก';
  var DOWNLOAD_TOAST = 'ดาวน์โหลดรูปแล้ว ถ้า Chrome ถาม ให้อนุญาตดาวน์โหลดหลายไฟล์';

  function orderPhotos(photos) {
    var list = (photos || []).map(function (p, i) { return { p: p, i: i }; });
    list.sort(function (a, b) {
      var ac = a.p && a.p.cover ? 1 : 0;
      var bc = b.p && b.p.cover ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return a.i - b.i;
    });
    return list.map(function (x) { return x.p; });
  }

  /* The room button uses storage order, which already puts the cover first when
     the user set one. */
  function sortByOrder(photos) {
    var list = (photos || []).map(function (p, i) { return { p: p, i: i }; });
    list.sort(function (a, b) {
      var ao = a.p && a.p.order != null ? Number(a.p.order) : (a.p && a.p.ts != null ? Number(a.p.ts) : a.i);
      var bo = b.p && b.p.order != null ? Number(b.p.order) : (b.p && b.p.ts != null ? Number(b.p.ts) : b.i);
      if (ao !== bo) return ao - bo;
      return a.i - b.i;
    });
    return list.map(function (x) { return x.p; });
  }

  function descriptionText(unit) {
    if (!unit || unit.notes == null) return '';
    return String(unit.notes).trim();
  }

  function cleanNamePart(value) {
    return String(value == null ? '' : value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^\.+/, '').replace(/^_|_$/g, '');
  }

  function photoFileName(project, room, index) {
    var n = index | 0;
    if (n < 0) n = 0;
    var parts = [cleanNamePart(project), cleanNamePart(room)].filter(Boolean);
    return (parts.join('_') || 'photo') + '_' + (n + 1) + '.jpg';
  }

  function shareStamp(photos) {
    return (photos || []).map(function (p) {
      if (!p) return '';
      var full = p.full && p.full.size ? p.full.size : 0;
      return [p.id || '', p.order == null ? '' : p.order, p.url || '', full].join(':');
    }).join('|');
  }

  /* Share every file with no text. If that is unavailable or the share threw,
     download every file. Abort is a cancel, not a download. */
  function selectPhotoCopy(ctx) {
    ctx = ctx || {};
    var count = ctx.count | 0;
    if (count < 1) return { action: 'none', reason: 'no-photos' };
    var phase = ctx.sharePhase || 'untried';
    if (phase === 'abort') return { action: 'cancel', toast: CANCEL_TOAST, includeText: false, text: '' };
    if (phase === 'ok') return { action: 'done', via: 'share' };
    if (ctx.canShareFiles && (phase === 'untried' || phase === 'text-failed')) {
      return { action: 'share', includeText: false, text: '' };
    }
    return { action: 'download', includeText: false, text: '', toast: DOWNLOAD_TOAST, count: count };
  }

  var api = {
    SHARE_TOAST: SHARE_TOAST,
    CANCEL_TOAST: CANCEL_TOAST,
    DOWNLOAD_TOAST: DOWNLOAD_TOAST,
    orderPhotos: orderPhotos,
    sortByOrder: sortByOrder,
    descriptionText: descriptionText,
    photoFileName: photoFileName,
    shareStamp: shareStamp,
    selectPhotoCopy: selectPhotoCopy
  };
  root.MAX_PHOTO_COPY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
