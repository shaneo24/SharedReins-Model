/* Filtering. Everything is optional; an empty/blank control means "no opinion". */
window.FT = window.FT || {};

FT.filters = (function () {
  'use strict';
  var U = FT.util;

  function blank() {
    return {
      q: '',
      includeOuts: false,
      sires: [],              // uppercase sire names
      damSires: [],
      consignors: [],
      sexes: [],
      colors: [],
      areas: [],
      sessions: [],
      foalFrom: null,         // Date
      foalTo: null,           // Date
      confMin: null,          // 0-10
      confState: 'any',       // 'any' | 'graded' | 'ungraded'
      pedMin: null,           // 0-10
      pedState: 'any',        // 'any' | 'rated' | 'unrated'
      flaggedOnly: false,
      needsWalkVideo: false,
      needsPhoto: false,
      needsXray: false,       // repository films lodged
      hasUpdate: false,       // catalog page has been updated since printing
      scoreMin: null,
      result: 'any',          // 'any' | 'sold' | 'rna'
      priceMin: null,
      priceMax: null
    };
  }

  /* ------------------------------------------------------- saving a filter */

  /**
   * Flatten the live filter object into something JSON can hold: the two foal
   * dates are `Date` instances, which `JSON.stringify` would turn into ISO
   * timestamps and `JSON.parse` would hand back as strings. Everything else is
   * already a primitive or an array of them.
   */
  function serialize(f) {
    var o = {};
    Object.keys(blank()).forEach(function (k) {
      if (k === 'foalFrom' || k === 'foalTo') o[k] = f[k] ? U.toInputDate(f[k]) : null;
      else if (Array.isArray(f[k])) o[k] = f[k].slice();
      else o[k] = f[k];
    });
    return o;
  }

  /**
   * The reverse. Deliberately starts from `blank()` and only copies keys the
   * current model knows about, so a filter saved before a new control existed
   * still loads — it just leaves the new one at its default — and a key that
   * has since been removed can't leak back in.
   */
  function deserialize(o) {
    var f = blank();
    if (!o) return f;
    Object.keys(f).forEach(function (k) {
      if (!(k in o)) return;
      if (k === 'foalFrom' || k === 'foalTo') f[k] = o[k] ? U.parseDate(o[k]) : null;
      else if (Array.isArray(f[k])) f[k] = Array.isArray(o[k]) ? o[k].slice() : [];
      else f[k] = o[k];
    });
    return f;
  }

  /**
   * How much of a saved filter's picker selections actually exist in the sale
   * you've got open. A filter built on last year's Saratoga catalogue will
   * happily select sires and sessions that aren't in this one, and the result
   * is an empty table with no explanation — so the app says so instead.
   */
  function coverage(f, facets) {
    if (!facets) return [];
    var out = [];
    [['sires', 'sire'], ['damSires', 'broodmare sire'], ['consignors', 'consignor'],
     ['sessions', 'session'], ['areas', 'foaling state'], ['colors', 'colour']]
      .forEach(function (pair) {
        var sel = f[pair[0]];
        if (!sel || !sel.length) return;
        var have = {};
        (facets[pair[0]] || []).forEach(function (i) { have[i.key] = true; });
        var found = sel.filter(function (k) { return have[k]; }).length;
        out.push({ id: pair[0], label: pair[1], selected: sel.length, found: found });
      });
    return out;
  }

  /** Distinct values + counts, for populating the pickers. */
  function facets(horses) {
    function tally(fn) {
      var m = {};
      horses.forEach(function (h) {
        var v = fn(h);
        if (v === null || v === undefined || v === '') return;
        m[v] = (m[v] || 0) + 1;
      });
      return m;
    }
    function sortedByCount(m, labelOf) {
      return Object.keys(m).map(function (k) {
        return { key: k, label: labelOf ? labelOf(k) : k, count: m[k] };
      }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    }

    return {
      sires: sortedByCount(tally(function (h) { return h.sireRaw; }), U.titleCase),
      damSires: sortedByCount(tally(function (h) { return h.damSireRaw; }), U.titleCase),
      consignors: sortedByCount(tally(function (h) { return h.consignorSort; })),
      sexes: sortedByCount(tally(function (h) { return h.sex; }), function (k) { return U.SEX[k] || k; }),
      colors: sortedByCount(tally(function (h) { return h.color; }), function (k) { return U.COLOR[k] || k; }),
      areas: sortedByCount(tally(function (h) { return h.foalArea; })),
      // Fasig-Tipton names its sessions by date, so these sort chronologically
      // rather than by count — "Aug 10" before "Aug 11" reads as the sale runs.
      sessions: Object.keys(tally(function (h) { return h.session; })).sort()
        .map(function (k) {
          return { key: k, label: U.sessionLabel(k),
                   count: horses.filter(function (h) { return h.session === k; }).length };
        })
    };
  }

  function inList(list, value) {
    return !list || !list.length || list.indexOf(value) !== -1;
  }

  function apply(horses, f) {
    var q = (f.q || '').trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];

    return horses.filter(function (h) {
      if (!f.includeOuts && h.status === 'out') return false;

      if (terms.length) {
        var hay = (h.hip + ' ' + h.name + ' ' + h.sire + ' ' + h.dam + ' ' + h.damSire + ' ' +
          h.consignor + ' ' + h.barn).toLowerCase();
        for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return false;
      }

      if (!inList(f.sires, h.sireRaw)) return false;
      if (!inList(f.damSires, h.damSireRaw)) return false;
      if (!inList(f.consignors, h.consignorSort)) return false;
      if (!inList(f.sexes, h.sex)) return false;
      if (!inList(f.colors, h.color)) return false;
      if (!inList(f.areas, h.foalArea)) return false;
      if (!inList(f.sessions, h.session)) return false;

      if (f.foalFrom || f.foalTo) {
        if (!h.foalDate) return false;
        if (f.foalFrom && h.foalDate < f.foalFrom) return false;
        if (f.foalTo && h.foalDate > f.foalTo) return false;
      }

      var conf = FT.store.conformation(h.key);
      if (f.confState === 'graded' && conf === null) return false;
      if (f.confState === 'ungraded' && conf !== null) return false;
      if (f.confMin !== null && (conf === null || conf < f.confMin)) return false;

      var ped = FT.store.pedigree(h.key);
      if (f.pedState === 'rated' && ped === null) return false;
      if (f.pedState === 'unrated' && ped !== null) return false;
      if (f.pedMin !== null && (ped === null || ped < f.pedMin)) return false;

      if (f.flaggedOnly && !FT.store.isFlagged(h.key)) return false;

      if (f.needsWalkVideo && !h.hasWalkVideo) return false;
      if (f.needsPhoto && !h.hasPhoto) return false;
      if (f.needsXray && !h.hasXray) return false;
      if (f.hasUpdate && !h.hasUpdate) return false;

      if (f.result === 'sold' && !h.sold) return false;
      if (f.result === 'rna' && !h.rna) return false;
      if (f.priceMin !== null || f.priceMax !== null) {
        var p = h.sold ? h.price : (h.rna ? h.bidTo : null);
        if (p === null) return false;
        if (f.priceMin !== null && p < f.priceMin) return false;
        if (f.priceMax !== null && p > f.priceMax) return false;
      }

      if (f.scoreMin !== null) {
        var s = h._score && h._score.total;
        if (s === null || s === undefined || s < f.scoreMin) return false;
      }

      return true;
    });
  }

  /** Which filters are actually doing something — for the "active" chips. */
  function activeSummary(f) {
    var out = [];
    if (f.q) out.push({ id: 'q', text: '“' + f.q + '”' });
    if (f.includeOuts) out.push({ id: 'includeOuts', text: 'including outs' });
    if (f.sires.length) out.push({ id: 'sires', text: f.sires.length + ' sire' + (f.sires.length > 1 ? 's' : '') });
    if (f.damSires.length) out.push({ id: 'damSires', text: f.damSires.length + ' BM sire' + (f.damSires.length > 1 ? 's' : '') });
    if (f.consignors.length) out.push({ id: 'consignors', text: f.consignors.length + ' consignor' + (f.consignors.length > 1 ? 's' : '') });
    if (f.sexes.length) out.push({ id: 'sexes', text: f.sexes.map(function (s) { return U.SEX[s] || s; }).join('/') });
    if (f.colors.length) out.push({ id: 'colors', text: f.colors.length + ' colour' + (f.colors.length > 1 ? 's' : '') });
    if (f.areas.length) out.push({ id: 'areas', text: f.areas.join('/') });
    if (f.sessions.length) out.push({ id: 'sessions', text: f.sessions.map(U.sessionLabel).join(', ') });
    if (f.foalFrom) out.push({ id: 'foalFrom', text: 'foaled ≥ ' + U.formatDate(f.foalFrom) });
    if (f.foalTo) out.push({ id: 'foalTo', text: 'foaled ≤ ' + U.formatDate(f.foalTo) });
    if (f.confMin !== null) out.push({ id: 'confMin', text: 'conf ≥ ' + f.confMin });
    if (f.confState !== 'any') out.push({ id: 'confState', text: f.confState });
    if (f.pedMin !== null) out.push({ id: 'pedMin', text: 'ped ≥ ' + f.pedMin });
    if (f.pedState !== 'any') out.push({ id: 'pedState', text: f.pedState === 'rated' ? 'ped rated' : 'ped unrated' });
    if (f.flaggedOnly) out.push({ id: 'flaggedOnly', text: 'shortlist only' });
    if (f.needsWalkVideo) out.push({ id: 'needsWalkVideo', text: 'has walk video' });
    if (f.needsPhoto) out.push({ id: 'needsPhoto', text: 'has photo' });
    if (f.needsXray) out.push({ id: 'needsXray', text: 'x-rays lodged' });
    if (f.hasUpdate) out.push({ id: 'hasUpdate', text: 'page updated' });
    if (f.scoreMin !== null) out.push({ id: 'scoreMin', text: 'score ≥ ' + f.scoreMin });
    if (f.result !== 'any') out.push({ id: 'result', text: f.result.toUpperCase() });
    if (f.priceMin !== null) out.push({ id: 'priceMin', text: '≥ ' + U.moneyShort(f.priceMin) });
    if (f.priceMax !== null) out.push({ id: 'priceMax', text: '≤ ' + U.moneyShort(f.priceMax) });
    return out;
  }

  return {
    blank: blank, facets: facets, apply: apply, activeSummary: activeSummary,
    serialize: serialize, deserialize: deserialize, coverage: coverage
  };
})();
