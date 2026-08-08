/* Shared helpers. Classic script (no modules) so the app runs from file:// too. */
window.OBS = window.OBS || {};

OBS.util = (function () {
  'use strict';

  /* ---------------------------------------------------------------- breeze */

  /**
   * OBS publishes under-tack times in fifths of a second: "10.3" means
   * 10 and 3/5 = 10.60s. The digit after the decimal is never > 4.
   * Returns seconds as a real number, or null if unparseable.
   */
  function parseBreeze(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim().replace(/^:/, '');
    if (!s) return null;

    // "10 3/5" long form
    var frac = s.match(/^(\d+)\s+(\d)\/5$/);
    if (frac) return parseInt(frac[1], 10) + parseInt(frac[2], 10) / 5;

    var m = s.match(/^(\d+)(?:\.(\d))?$/);
    if (!m) return null;
    var whole = parseInt(m[1], 10);
    var fifths = m[2] === undefined ? 0 : parseInt(m[2], 10);
    if (fifths > 4) return null; // not fifths notation -> reject rather than guess
    return whole + fifths / 5;
  }

  /** Seconds back to OBS fifths notation, e.g. 10.6 -> ":10 3/5" */
  function formatBreeze(seconds, opts) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '—';
    var total = Math.round(seconds * 5);
    var whole = Math.floor(total / 5);
    var fifths = total % 5;
    var body = fifths ? whole + ' ' + fifths + '/5' : String(whole);
    return (opts && opts.noColon ? '' : ':') + body;
  }

  /** " 1/8" -> 1, " 1/4" -> 2 (furlongs). Anything else -> null. */
  function parseFurlongs(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (s === '1/8') return 1;
    if (s === '1/4') return 2;
    if (s === '3/8') return 3;
    return null;
  }

  function furlongLabel(f) {
    return { 1: '1/8', 2: '1/4', 3: '3/8' }[f] || '—';
  }

  /* ----------------------------------------------------------------- dates */

  /** "04/28/2024" -> Date (local midnight), else null. */
  function parseDate(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      if (m[1] === '0000') return null;
      return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    return null;
  }

  function formatDate(d) {
    if (!d) return '—';
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2);
  }

  /** Day-of-year, used to compare foal dates across horses of the same crop. */
  function dayOfYear(d) {
    if (!d) return null;
    var start = new Date(d.getFullYear(), 0, 1);
    return Math.round((d - start) / 86400000) + 1;
  }

  function toInputDate(d) {
    if (!d) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ----------------------------------------------------------------- stats */

  function median(arr) {
    if (!arr.length) return null;
    var v = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  /**
   * Percentile rank of `value` within a *sorted ascending* array, 0..1.
   * Ties get the midpoint of their run so equal breeze times score equally.
   */
  function percentileRank(sorted, value) {
    if (!sorted.length) return 0.5;
    var lo = 0, hi = sorted.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (sorted[m] < value) lo = m + 1; else hi = m; }
    var below = lo;
    hi = sorted.length; var lo2 = below;
    while (lo2 < hi) { var m2 = (lo2 + hi) >> 1; if (sorted[m2] <= value) lo2 = m2 + 1; else hi = m2; }
    var atOrBelow = lo2;
    return (below + atOrBelow) / 2 / sorted.length;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------------------------------------------------------------- format */

  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function moneyShort(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n);
  }

  /** Title Case for the SHOUTY names in the feed. */
  function titleCase(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/\b([a-z])/g, function (_, c) { return c.toUpperCase(); })
      .replace(/\b(Of|The|And|A|In|On|To|By|For|De|Du|La|Le)\b/g, function (w, _, i) {
        return i === 0 ? w : w.toLowerCase();
      })
      .replace(/'([A-Z])/g, function (_, c) { return "'" + c.toLowerCase(); });
  }

  var SEX = { C: 'Colt', F: 'Filly', G: 'Gelding', R: 'Ridgling', U: '—' };
  var COLOR = {
    B: 'Bay', 'DB/BR': 'Dk B/Br', CH: 'Chestnut', 'GR/RO': 'Gray/Roan',
    BL: 'Black', WH: 'White', PA: 'Palomino', U: '—'
  };

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 150);
    };
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return {
    parseBreeze: parseBreeze, formatBreeze: formatBreeze,
    parseFurlongs: parseFurlongs, furlongLabel: furlongLabel,
    parseDate: parseDate, formatDate: formatDate, dayOfYear: dayOfYear, toInputDate: toInputDate,
    median: median, mean: mean, percentileRank: percentileRank, clamp: clamp,
    money: money, moneyShort: moneyShort, titleCase: titleCase,
    SEX: SEX, COLOR: COLOR,
    escapeHtml: escapeHtml, debounce: debounce, toCsv: toCsv, download: download
  };
})();
