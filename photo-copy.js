/* MAX Agent — room photo copy selection.
   Primary path is v9.0 (7727bba, 2026-09-28): navigator.share({ files }) for every
   photo, description text only when canShare accepts files+text. The JPG download
   that used to run when share was missing or threw is not an action.
   Clipboard writes run only after share is unavailable or has failed. */
(function (root) {
  'use strict';

  var UNSUPPORTED_TOAST = 'เบราว์เซอร์นี้แชร์หรือคัดลอกรูปไม่ได้';

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

  function descriptionText(unit) {
    if (!unit || unit.notes == null) return '';
    return String(unit.notes).trim();
  }

  function oneToast(number, total) {
    return 'คัดลอกรูปที่ ' + number + '/' + total + ' แล้ว วางได้เลย กดอีกครั้งเพื่อรูปถัดไป';
  }

  function allToast(total) {
    return 'คัดลอกรูปทั้ง ' + total + ' รูปแล้ว วางได้เลย';
  }

  /* ctx.sharePhase: 'untried' | 'text-failed' | 'failed' | 'ok' | 'abort'
     Clipboard flags are tried in order and set true only after a resolved write. */
  function selectPhotoCopy(ctx) {
    ctx = ctx || {};
    var count = ctx.count | 0;
    if (count < 1) return { action: 'none', reason: 'no-photos' };
    var phase = ctx.sharePhase || 'untried';
    if (phase === 'abort') return { action: 'silent' };
    if (phase === 'ok') return { action: 'done', via: 'share' };

    var description = ctx.description ? String(ctx.description) : '';
    if (ctx.canShareFiles && phase === 'untried') {
      if (description && ctx.canShareWithText) return { action: 'share', includeText: true, text: description };
      return { action: 'share', includeText: false, text: '' };
    }
    if (ctx.canShareFiles && phase === 'text-failed') return { action: 'share', includeText: false, text: '' };

    if (!ctx.multiTried && ctx.canTryMulti) return { action: 'write-multi' };
    if (ctx.multiOk) return { action: 'done', via: 'multi', toast: allToast(count) };
    /* text/html is not used once image/png can be written. Headless Chrome 156
       accepts a multi-img HTML item, but clipboard.read then has no image type
       and a paste inserted nothing. One PNG at a time is the verified fallback. */
    if (!ctx.canWriteSinglePng && !ctx.htmlTried && ctx.canTryHtml) return { action: 'write-html' };
    if (ctx.htmlOk) return { action: 'done', via: 'html', toast: allToast(count) };

    if (ctx.canWriteSinglePng) {
      var index = 0;
      var cursor = ctx.cursor;
      if (cursor && cursor.roomId === ctx.roomId) {
        index = cursor.index | 0;
        if (index < 0 || index >= count) index = 0;
      }
      var number = index + 1;
      return {
        action: 'copy-one',
        index: index,
        number: number,
        total: count,
        nextCursor: { roomId: ctx.roomId, index: (index + 1) % count },
        toast: oneToast(number, count)
      };
    }
    return { action: 'unsupported', toast: UNSUPPORTED_TOAST };
  }

  var api = {
    UNSUPPORTED_TOAST: UNSUPPORTED_TOAST,
    orderPhotos: orderPhotos,
    descriptionText: descriptionText,
    oneToast: oneToast,
    allToast: allToast,
    selectPhotoCopy: selectPhotoCopy
  };
  root.MAX_PHOTO_COPY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
