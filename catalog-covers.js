/* Public catalog covers.
   A card thumb is a new Storage object named <file>-t.jpg next to the original.
   This file only builds URLs. It never uploads, deletes, or rewrites a photo. */
(function (root) {
  'use strict';
  var HOST = 'https://ekpavjlebbclapjdupwf.supabase.co/storage/v1/object/public/room-photos/';
  var FILE = /^([A-Za-z0-9]{4,12})\/([A-Za-z0-9_-]{1,80})\.(jpe?g|png|webp)$/i;

  function parseCover(cover) {
    var base = String(cover || '').split('?')[0];
    if (base.indexOf(HOST) !== 0) return null;
    var m = FILE.exec(base.slice(HOST.length));
    if (!m) return null;
    var id = m[1], stem = m[2], ext = m[3];
    var file = stem + '.' + ext;
    var already = /-t$/i.test(stem) && /^jpe?g$/i.test(ext);
    var thumb = already ? base : (HOST + id + '/' + stem + '-t.jpg');
    if (thumb === base && !already) return null;
    return { id: id, file: file, full: base, thumb: thumb, already: already };
  }

  function thumbUrl(cover) {
    var p = parseCover(cover);
    return p ? p.thumb : '';
  }

  /* Signed thumb uploads may only target a sibling -t.jpg, never the original name. */
  function safeThumbPath(path) {
    var p = String(path || '');
    if (!/^[A-Za-z0-9]{4,12}\/[A-Za-z0-9_-]{1,80}-t\.jpg$/.test(p)) return false;
    if (p.indexOf('..') !== -1) return false;
    return true;
  }

  function photoCount(room) {
    if (!room || typeof room.n !== 'number' || !isFinite(room.n)) return null;
    if (room.n < 0 || room.n > 80) return null;
    return Math.round(room.n);
  }

  function needsCountFetch(room) {
    return photoCount(room) == null;
  }

  var api = {
    HOST: HOST,
    parseCover: parseCover,
    thumbUrl: thumbUrl,
    safeThumbPath: safeThumbPath,
    photoCount: photoCount,
    needsCountFetch: needsCountFetch
  };
  root.MAX_COVERS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
