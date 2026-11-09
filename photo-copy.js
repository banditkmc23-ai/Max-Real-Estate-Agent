/* MAX Agent — room photo copy selection.
   Primary path is v9.0 (7727bba): navigator.share({ files }) for every photo and
   nothing else. v9.30 never attaches room notes. v9.31 keeps that, and when the
   whole set cannot be shared the iPhone path is one ZIP plus a Thai explanation.
   Desktop Chrome does not download: it writes image/png to the clipboard so a
   post can be pasted. Chrome keeps a single image, so a set is one photo at a
   time with a Thai explanation. Room notes stay on the separate text button. */
(function (root) {
  'use strict';

  var UNSUPPORTED_TOAST = 'เบราว์เซอร์นี้แชร์หรือคัดลอกรูปไม่ได้';
  var ZIP_TOAST = 'แชร์รูปทั้งหมดทีเดียวไม่ได้ จึงดาวน์โหลดเป็น ZIP แล้ว';
  var CLIPBOARD_FAIL_TOAST = 'คัดลอกรูปไม่ได้ จึงดาวน์โหลดเป็น ZIP แล้ว';
  var SHARE_JPEG = 'image/jpeg';
  var SHARE_PNG = 'image/png';

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

  /* Chrome's clipboard holds one image/png. Facebook pastes that image.
     A second press copies the next photo. No room text is included. */
  function chromeOneToast(number, total) {
    if ((total | 0) <= 1) return 'คัดลอกรูปแล้ว วางใน Facebook ได้เลย';
    return 'Chrome วางได้ทีละรูป คัดลอกรูปที่ ' + number + '/' + total + ' แล้ว วางใน Facebook ได้เลย กดอีกครั้งเพื่อรูปถัดไป';
  }

  function allToast(total) {
    return 'คัดลอกรูปทั้ง ' + total + ' รูปแล้ว วางได้เลย';
  }

  /* Chrome's file share sheet accepts image/jpeg and image/png when the name
     extension matches. image/jpg is the same as jpeg. Anything else (webp, heic,
     empty) must be re-encoded before canShare. */
  function shareMime(type) {
    var t = String(type || '').toLowerCase().split(';')[0].trim();
    if (t === 'image/jpg' || t === 'image/jpeg' || t === 'image/pjpeg') return SHARE_JPEG;
    if (t === 'image/png' || t === 'image/x-png') return SHARE_PNG;
    return '';
  }

  function shareFileName(stem, mime) {
    var base = String(stem || 'photo').replace(/\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i, '');
    var type = shareMime(mime) || SHARE_JPEG;
    return base + (type === SHARE_PNG ? '.png' : '.jpg');
  }

  function filesAreShareable(files) {
    if (!files || !files.length) return false;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var mime = shareMime(file && file.type);
      if (!mime || !(file.size > 0)) return false;
      var name = String(file.name || '').toLowerCase();
      if (mime === SHARE_PNG && name.slice(-4) !== '.png') return false;
      if (mime === SHARE_JPEG && name.slice(-4) !== '.jpg' && name.slice(-5) !== '.jpeg') return false;
    }
    return true;
  }

  function shareStamp(photos) {
    return (photos || []).map(function (p) {
      if (!p) return '';
      var full = p.full && p.full.size ? p.full.size : 0;
      return [p.id || '', p.cover ? 1 : 0, p.order == null ? '' : p.order, p.url || '', full].join(':');
    }).join('|');
  }

  function zipEntryName(name, index) {
    var base = String(name || '').split(/[/\\]/).pop().replace(/[\u0000-\u001f]/g, '').trim();
    if (!base || base === '.' || base === '..') base = 'photo_' + (index + 1) + '.jpg';
    return base;
  }

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var d = date || new Date();
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
      date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function u16(view, offset, value) { view.setUint16(offset, value & 0xffff, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  /* Stored ZIP (method 0). JPEG payloads barely shrink, and every Mac can open it.
     Names are UTF-8 (general-purpose bit 11). No text entry is added. */
  function buildStoredZip(entries, date) {
    var list = entries || [];
    var named = [];
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var name = zipEntryName(list[i] && list[i].name, i);
      if (seen[name]) {
        var dot = name.lastIndexOf('.');
        var stem = dot > 0 ? name.slice(0, dot) : name;
        var ext = dot > 0 ? name.slice(dot) : '';
        var n = 2;
        while (seen[stem + '_' + n + ext]) n++;
        name = stem + '_' + n + ext;
      }
      seen[name] = 1;
      var raw = list[i] && list[i].data;
      var data = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
      named.push({ name: name, data: data });
    }
    var enc = new TextEncoder();
    var dt = dosDateTime(date);
    var parts = [];
    var centrals = [];
    var offset = 0;
    for (var j = 0; j < named.length; j++) {
      var nameBytes = enc.encode(named[j].name);
      var data = named[j].data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length);
      var view = new DataView(local.buffer);
      u32(view, 0, 0x04034b50);
      u16(view, 4, 20);
      u16(view, 6, 0x0800);
      u16(view, 8, 0);
      u16(view, 10, dt.time);
      u16(view, 12, dt.date);
      u32(view, 14, crc);
      u32(view, 18, data.length);
      u32(view, 22, data.length);
      u16(view, 26, nameBytes.length);
      u16(view, 28, 0);
      local.set(nameBytes, 30);
      parts.push(local, data);
      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20);
      u16(cv, 6, 20);
      u16(cv, 8, 0x0800);
      u16(cv, 10, 0);
      u16(cv, 12, dt.time);
      u16(cv, 14, dt.date);
      u32(cv, 16, crc);
      u32(cv, 20, data.length);
      u32(cv, 24, data.length);
      u16(cv, 28, nameBytes.length);
      u16(cv, 30, 0);
      u16(cv, 32, 0);
      u16(cv, 34, 0);
      u16(cv, 36, 0);
      u32(cv, 38, 0);
      u32(cv, 42, offset);
      central.set(nameBytes, 46);
      centrals.push(central);
      offset += local.length + data.length;
    }
    var centralSize = 0;
    for (var c = 0; c < centrals.length; c++) centralSize += centrals[c].length;
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    u32(ev, 0, 0x06054b50);
    u16(ev, 4, 0);
    u16(ev, 6, 0);
    u16(ev, 8, named.length);
    u16(ev, 10, named.length);
    u32(ev, 12, centralSize);
    u32(ev, 16, offset);
    u16(ev, 20, 0);
    var chunks = parts.concat(centrals, [eocd]);
    var total = 0;
    for (var t = 0; t < chunks.length; t++) total += chunks[t].length;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var p = 0; p < chunks.length; p++) { out.set(chunks[p], pos); pos += chunks[p].length; }
    return out;
  }

  /* ctx.sharePhase: 'untried' | 'text-failed' | 'failed' | 'ok' | 'abort'
     Share of every file stays photos-only. A set that cannot be shared becomes
     one ZIP. copy-one is only the whole set when the room has a single photo. */
  function selectPhotoCopy(ctx) {
    ctx = ctx || {};
    var count = ctx.count | 0;
    if (count < 1) return { action: 'none', reason: 'no-photos' };
    var phase = ctx.sharePhase || 'untried';
    if (phase === 'abort') return { action: 'silent' };
    if (phase === 'ok') return { action: 'done', via: 'share' };

    /* Desktop Chrome: paste into a post, not the share sheet and not a download.
       Try every PNG at once; Chrome rejects that, then one image/png is the paste. */
    if (ctx.desktopClipboard) {
      if (ctx.clipboardFailed) return { action: 'zip', includeText: false, text: '', toast: CLIPBOARD_FAIL_TOAST };
      if (ctx.canWriteSinglePng && count > 1 && !ctx.multiTried && ctx.canTryMulti) {
        return { action: 'write-multi', includeText: false, text: '' };
      }
      if (ctx.multiOk) return { action: 'done', via: 'multi', toast: allToast(count), includeText: false, text: '' };
      if (ctx.canWriteSinglePng) {
        var index = 0;
        var cursor = ctx.cursor;
        if (count > 1 && cursor && cursor.roomId === ctx.roomId) {
          index = cursor.index | 0;
          if (index < 0 || index >= count) index = 0;
        }
        var number = index + 1;
        return {
          action: 'copy-one',
          index: index,
          number: number,
          total: count,
          nextCursor: { roomId: ctx.roomId, index: count > 1 ? (index + 1) % count : 0 },
          toast: chromeOneToast(number, count),
          includeText: false,
          text: ''
        };
      }
      if (ctx.canZip === false) return { action: 'unsupported', toast: UNSUPPORTED_TOAST };
      return { action: 'zip', includeText: false, text: '', toast: CLIPBOARD_FAIL_TOAST };
    }

    if (ctx.canShareFiles && (phase === 'untried' || phase === 'text-failed')) {
      return { action: 'share', includeText: false, text: '' };
    }

    if (count > 1) {
      if (ctx.canZip === false) return { action: 'unsupported', toast: UNSUPPORTED_TOAST };
      return { action: 'zip', includeText: false, text: '', toast: ZIP_TOAST };
    }

    if (ctx.canWriteSinglePng) {
      return {
        action: 'copy-one',
        index: 0,
        number: 1,
        total: 1,
        nextCursor: { roomId: ctx.roomId, index: 0 },
        toast: allToast(1)
      };
    }
    if (ctx.canZip === false) return { action: 'unsupported', toast: UNSUPPORTED_TOAST };
    return { action: 'zip', includeText: false, text: '', toast: ZIP_TOAST };
  }

  var api = {
    UNSUPPORTED_TOAST: UNSUPPORTED_TOAST,
    ZIP_TOAST: ZIP_TOAST,
    CLIPBOARD_FAIL_TOAST: CLIPBOARD_FAIL_TOAST,
    SHARE_JPEG: SHARE_JPEG,
    SHARE_PNG: SHARE_PNG,
    orderPhotos: orderPhotos,
    descriptionText: descriptionText,
    oneToast: oneToast,
    chromeOneToast: chromeOneToast,
    allToast: allToast,
    shareMime: shareMime,
    shareFileName: shareFileName,
    filesAreShareable: filesAreShareable,
    shareStamp: shareStamp,
    zipEntryName: zipEntryName,
    crc32: crc32,
    buildStoredZip: buildStoredZip,
    selectPhotoCopy: selectPhotoCopy
  };
  root.MAX_PHOTO_COPY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
