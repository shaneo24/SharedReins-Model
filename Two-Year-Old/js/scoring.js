/* The model.
 *
 * Every component returns 0-100 and carries its own weight. The total is the
 * weighted mean of the components that apply to a given horse, so a horse
 * missing a component (no breeze yet, not inspected) is scored on what is
 * actually known rather than being quietly penalised.
 *
 * Nothing here is hidden — `score()` returns the full component breakdown so
 * the UI can show exactly why a horse ranks where it does.
 */
window.OBS = window.OBS || {};

OBS.scoring = (function () {
  'use strict';
  var U = OBS.util;

  var DEFAULTS = {
    /* Every component is your own judgement. The app computes nothing on your
       behalf — it puts the evidence in front of you (the clock, the videos,
       the catalog page, the sire book) and weights what you make of it.
       A freshly loaded sale therefore has NO scores until you start rating.

       Breeze *time* and foal date are filters, not components: the clock tells
       you which horses to look at, not how good they are. */
    weights: {
      breezeVisual: 39,
      conformation: 33,
      pedigree: 28
    },
    options: {
      // What to do with a horse you haven't rated yet — applies to both
      // Breeze visual and Conformation.
      // 'exclude' re-weights the other components; 'neutral' scores it 50.
      unratedManual: 'exclude',
      neutralManual: 50
    }
  };

  function cloneDefaults() {
    return {
      weights: Object.assign({}, DEFAULTS.weights),
      options: Object.assign({}, DEFAULTS.options)
    };
  }

  /* ------------------------------------------------------------- the cohort */

  /**
   * Precompute the distributions a horse is scored against. Breeze is ranked
   * only against horses that worked the same distance at the same sale —
   * a :10 1/5 eighth and a :21 quarter are not on the same clock.
   */
  function buildContext(horses, sireIndex, damSireIndex, settings, bhIndex) {
    var byDist = {};

    horses.forEach(function (h) {
      if (h.breezeSec !== null && h.furlongs !== null) {
        (byDist[h.furlongs] = byDist[h.furlongs] || []).push(h.breezeSec);
      }
    });

    Object.keys(byDist).forEach(function (k) {
      byDist[k].sort(function (a, b) { return a - b; });
    });

    return {
      breezeByDist: byDist,
      sireIndex: sireIndex || { byKey: {}, list: [] },
      damSireIndex: damSireIndex || { byKey: {}, list: [] },
      bhIndex: bhIndex || { byName: {}, lists: [], count: 0 },
      settings: settings || cloneDefaults()
    };
  }

  /* ----------------------------------------------------------- components */

  /**
   * How the horse looked doing the work, in your eyes — not what the clock
   * said. The clock is still shown alongside for context, and still filters,
   * but it doesn't score.
   */
  function breezeVisualComponent(h, ctx) {
    var o = ctx.settings.options;
    var g = OBS.store.breezeVisual(h.key);

    if (g === null) {
      var why = h.status === 'out' ? 'Out of the sale'
        : h.breezeSec === null ? 'No published work'
        : h.hasVideo ? 'Not watched yet'
        : 'No breeze video';
      if (o.unratedManual === 'neutral') {
        return { value: o.neutralManual, detail: why + ' — scored neutral' };
      }
      return { value: null, detail: why };
    }

    var clock = h.breezeSec !== null
      ? ' · clock ' + U.formatBreeze(h.breezeSec) + ' at ' + h.distLabel
      : '';
    return { value: (g / 10) * 100, detail: 'Your rating: ' + g + '/10' + clock };
  }

  function conformationComponent(h, ctx) {
    var o = ctx.settings.options;
    var g = OBS.store.conformation(h.key);
    if (g === null) {
      if (o.unratedManual === 'neutral') {
        return { value: o.neutralManual, detail: 'Not inspected — scored neutral' };
      }
      return { value: null, detail: 'Not inspected' };
    }
    return { value: (g / 10) * 100, detail: 'Your grade: ' + g + '/10' };
  }

  /**
   * Your read of the page — not a computed number. The sire book exists to
   * inform this rating (open a horse and the sire's ranking sits next to the
   * slider), but nothing here is scored for you.
   */
  function pedigreeComponent(h, ctx) {
    var o = ctx.settings.options;
    var g = OBS.store.pedigree(h.key);

    if (g === null) {
      if (o.unratedManual === 'neutral') {
        return { value: o.neutralManual, detail: 'Not rated — scored neutral' };
      }
      return { value: null, detail: 'Not rated' };
    }

    // Show what the sire book says alongside, purely as context for the number.
    var ref = OBS.sires.reference(ctx, h);
    return {
      value: (g / 10) * 100,
      detail: 'Your rating: ' + g + '/10' + (ref ? ' · sire book: ' + ref : '')
    };
  }

  var COMPONENTS = [
    { id: 'breezeVisual', label: 'Breeze visual', fn: breezeVisualComponent },
    { id: 'conformation', label: 'Conformation', fn: conformationComponent },
    { id: 'pedigree', label: 'Pedigree', fn: pedigreeComponent }
  ];

  /* --------------------------------------------------------------- scoring */

  /**
   * Returns { total, components, coverage } where coverage is the share of
   * total weight that could actually be evaluated for this horse.
   */
  function score(h, ctx) {
    var weights = ctx.settings.weights;
    var parts = [], sumW = 0, sumWV = 0, totalW = 0;

    COMPONENTS.forEach(function (c) {
      var w = Math.max(0, Number(weights[c.id]) || 0);
      totalW += w;
      var r = c.fn(h, ctx);
      var applied = w > 0 && r.value !== null;
      if (applied) { sumW += w; sumWV += w * r.value; }
      parts.push({
        id: c.id, label: c.label, weight: w,
        value: r.value, detail: r.detail, applied: applied,
        extra: r
      });
    });

    var total = sumW > 0 ? sumWV / sumW : null;
    return {
      total: total,
      components: parts,
      coverage: totalW > 0 ? sumW / totalW : 0
    };
  }

  /** Score a list and attach `_score` to each horse. Returns the same array. */
  function scoreAll(horses, ctx) {
    horses.forEach(function (h) { h._score = score(h, ctx); });
    return horses;
  }

  return {
    DEFAULTS: DEFAULTS,
    cloneDefaults: cloneDefaults,
    COMPONENTS: COMPONENTS,
    buildContext: buildContext,
    score: score,
    scoreAll: scoreAll
  };
})();
