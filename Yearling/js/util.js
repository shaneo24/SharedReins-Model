/* Shared helpers. Classic script (no modules) so the app runs from file:// too. */
window.FT = window.FT || {};

FT.util = (function () {
  'use strict';

  /* ----------------------------------------------------------------- dates */

  /** "04/28/2025" or "2025-04-28" -> Date (local midnight), else null. */
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

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "2026-08-10" -> "Aug 10". Fasig-Tipton names its sessions by date. */
  function sessionLabel(raw) {
    var d = parseDate(raw);
    if (!d) return String(raw || '');
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
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

  /** Date -> "0810", the folder Fasig-Tipton files a sale's catalog pages under. */
  function mmdd(d) {
    if (!d) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getMonth() + 1) + p(d.getDate());
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
   * Ties get the midpoint of their run so equal values score equally.
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

  /* Fasig-Tipton is not consistent about colour codes between sales — the 2026
     Saratoga feed says "DK B/" and "GR/RO" where the 2025 one says "DKB" and
     "GRR". Both spellings map to the same label rather than showing up as two
     separate entries in the colour picker. */
  var COLOR = {
    B: 'Bay', BR: 'Brown',
    DKB: 'Dk B/Br', 'DK B/': 'Dk B/Br', 'DB/BR': 'Dk B/Br', 'DKB/BR': 'Dk B/Br',
    CH: 'Chestnut',
    GRR: 'Gray/Roan', 'GR/RO': 'Gray/Roan', GR: 'Gray', RO: 'Roan',
    BL: 'Black', WH: 'White', PAL: 'Palomino', PA: 'Palomino', U: '—'
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
    parseDate: parseDate, formatDate: formatDate, sessionLabel: sessionLabel,
    dayOfYear: dayOfYear, toInputDate: toInputDate, mmdd: mmdd,
    median: median, mean: mean, percentileRank: percentileRank, clamp: clamp,
    money: money, moneyShort: moneyShort, titleCase: titleCase,
    SEX: SEX, COLOR: COLOR,
    escapeHtml: escapeHtml, debounce: debounce, toCsv: toCsv, download: download
  };
})();
