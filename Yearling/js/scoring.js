/* The model.
 *
 * Every component returns 0-100 and carries its own weight. The total is the
 * weighted mean of the components that apply to a given horse, so a horse
 * missing a component (not inspected, page not read) is scored on what is
 * actually known rather than being quietly penalised.
 *
 * Nothing here is hidden — `score()` returns the full component breakdown so
 * the UI can show exactly why a horse ranks where it does.
 */
window.FT = window.FT || {};

FT.scoring = (function () {
  'use strict';

  var DEFAULTS = {
    /* A yearling sale has no under-tack show, so there is no clock and no work
       to watch: the horse is the physical and the page, and nothing else.
       Both components are your own judgement — the app computes nothing on
       your behalf. It puts the evidence in front of you (the conformation
       photo, the walk video, the catalog page and its updates, the sire book)
       and weights what you make of it. A freshly loaded sale therefore has NO
       scores until you start rating.

       These are the OBS model's conformation:pedigree ratio (33:28) rescaled
       to fill the whole 100 now that Breeze visual is gone. Same relative
       preference, no new opinion introduced. */
    weights: {
      conformation: 54,
      pedigree: 46
    },
    options: {
      // What to do with a horse you haven't rated yet.
      // 'exclude' re-weights the other component; 'neutral' scores it 50.
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
   * The reference data a horse is scored against.
   *
   * The 2YO model precomputed a breeze-time distribution here, because the
   * clock only means anything relative to the other horses that worked that
   * distance. Nothing in this model is relative to the rest of the sale: both
   * components are absolute 0-10 judgements, so all the context carries is the
   * sire lookups the detail panel shows beside the Pedigree slider.
   */
  function buildContext(horses, sireIndex, damSireIndex, settings, bhIndex) {
    return {
      sireIndex: sireIndex || { byKey: {}, list: [] },
      damSireIndex: damSireIndex || { byKey: {}, list: [] },
      bhIndex: bhIndex || { byName: {}, lists: [], count: 0 },
      settings: settings || cloneDefaults()
    };
  }

  /* ----------------------------------------------------------- components */

  function conformationComponent(h, ctx) {
    var o = ctx.settings.options;
    var g = FT.store.conformation(h.key);
    if (g === null) {
      var why = h.status === 'out' ? 'Out of the sale'
        : h.hasPhoto || h.hasWalkVideo ? 'Not inspected'
        : 'Not inspected — no photo or walk video either';
      if (o.unratedManual === 'neutral') {
        return { value: o.neutralManual, detail: why + ' — scored neutral' };
      }
      return { value: null, detail: why };
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
    var g = FT.store.pedigree(h.key);

    if (g === null) {
      if (o.unratedManual === 'neutral') {
        return { value: o.neutralManual, detail: 'Not rated — scored neutral' };
      }
      return { value: null, detail: 'Not rated' };
    }

    // Show what the sire book says alongside, purely as context for the number.
    var ref = FT.sires.reference(ctx, h);
    return {
      value: (g / 10) * 100,
      detail: 'Your rating: ' + g + '/10' + (ref ? ' · sire book: ' + ref : '') +
              (h.hasUpdate ? ' · catalog update posted' : '')
    };
  }

  var COMPONENTS = [
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
