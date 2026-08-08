/* OBS market index — how a sire's stock has SOLD at Ocala.
 *
 * This is reference only. It does NOT feed the Pedigree score, because what
 * the ring pays measures the market's opinion, not the sire's ability to get
 * runners — and a model built on it would just rediscover the market's own
 * biases and call them insight.
 *
 * It stays because it's genuinely useful at the sale: knowing a sire's stock
 * typically brings $40K medians tells you where the bidding will go. That's a
 * budgeting fact, not a quality judgement.
 *
 * The Pedigree score comes from BloodHorse racing data — see js/bloodhorse.js.
 */
window.OBS = window.OBS || {};

OBS.sires = (function () {
  'use strict';
  var U = OBS.util;

  var SHRINK_K = 4;        // hips through the ring before a sire is "self-reporting"
  var W_PRICE = 0.75;      // composite weights
  var W_SELL = 0.25;

  /**
   * @param {Array} horses  pooled horses from every loaded reference sale
   * @param {String} field  'sireRaw' or 'damSireRaw'
   */
  function buildIndex(horses, field) {
    var groups = {};

    horses.forEach(function (h) {
      var key = h[field];
      if (!key) return;
      // Only hips that actually went through the ring inform the market read.
      if (h.status === 'out') return;
      if (!h.sold && !h.rna) return;
      var g = groups[key] || (groups[key] = {
        name: field === 'sireRaw' ? h.sire : h.damSire,
        key: key, through: 0, sold: 0, prices: [], sales: {}
      });
      g.through++;
      g.sales[h.saleId] = true;
      if (h.sold && h.price > 0) { g.sold++; g.prices.push(h.price); }
    });

    var list = Object.keys(groups).map(function (k) { return groups[k]; });
    if (!list.length) return { byKey: {}, list: [], population: null };

    list.forEach(function (g) {
      g.medianPrice = U.median(g.prices);
      g.topPrice = g.prices.length ? Math.max.apply(null, g.prices) : null;
      g.sellThrough = g.through ? g.sold / g.through : 0;
      g.logPrice = g.medianPrice ? Math.log(g.medianPrice) : null;
      g.saleCount = Object.keys(g.sales).length;
    });

    // Population reference, computed only over sires that actually sold one.
    var withPrice = list.filter(function (g) { return g.logPrice !== null; });
    var muLog = U.mean(withPrice.map(function (g) { return g.logPrice; })) || 0;
    var sdLog = stdev(withPrice.map(function (g) { return g.logPrice; }), muLog) || 1;
    var allSell = list.map(function (g) { return g.sellThrough; });
    var muSell = U.mean(allSell) || 0;
    var sdSell = stdev(allSell, muSell) || 1;

    list.forEach(function (g) {
      var zPrice = g.logPrice === null ? 0 : (g.logPrice - muLog) / sdLog;
      var zSell = (g.sellThrough - muSell) / sdSell;
      var raw = W_PRICE * zPrice + W_SELL * zSell;
      // Shrink toward 0 (= population average) by sample size.
      var w = g.through / (g.through + SHRINK_K);
      g.z = raw * w;
    });

    // Map the shrunk composite onto 0-100 by rank, so the scale is always full.
    var sortedZ = list.map(function (g) { return g.z; }).sort(function (a, b) { return a - b; });
    list.forEach(function (g) {
      g.computed = Math.round(U.percentileRank(sortedZ, g.z) * 100);
    });

    var byKey = {};
    list.forEach(function (g) { byKey[g.key] = g; });
    list.sort(function (a, b) { return b.computed - a.computed || b.through - a.through; });

    return {
      byKey: byKey,
      list: list,
      population: {
        medianPrice: U.median(withPrice.map(function (g) { return g.medianPrice; })),
        sellThrough: muSell, sires: list.length
      }
    };
  }

  function stdev(arr, mu) {
    if (arr.length < 2) return null;
    var v = arr.reduce(function (a, x) { return a + (x - mu) * (x - mu); }, 0) / (arr.length - 1);
    return Math.sqrt(v);
  }

  /**
   * What the sire book knows about a sire — REFERENCE ONLY.
   * Nothing here feeds a score; Pedigree is your own 0-10. This exists so the
   * app can show you the numbers at the moment you're making that call.
   *
   * Priority for the headline figure: your own sire rating, else BloodHorse.
   */
  function lookup(ctx, name) {
    var key = (name || '').toUpperCase();
    if (!key) return null;
    var override = OBS.store.getSireOverride(key);
    var bh = OBS.bloodhorse.lookup(ctx.bhIndex, name);
    var market = ctx.sireIndex && ctx.sireIndex.byKey[key] || null;
    if (override === null && !bh && !market) return null;
    return {
      key: key,
      value: override !== null ? override : (bh ? bh.rating : null),
      source: override !== null ? 'yours' : (bh ? 'bloodhorse' : null),
      bh: bh, market: market, override: override
    };
  }

  /** One-line summary of sire + broodmare sire, for the detail panel. */
  function reference(ctx, h) {
    var bits = [];
    var s = lookup(ctx, h.sireRaw);
    if (s && s.value !== null) {
      bits.push(h.sire + ' ' + s.value + (s.source === 'yours' ? ' (yours)' : ''));
    }
    var d = lookup(ctx, h.damSireRaw);
    if (d && d.value !== null) {
      bits.push('BM ' + h.damSire + ' ' + d.value);
    }
    return bits.length ? bits.join(' · ') : '';
  }

  return { buildIndex: buildIndex, lookup: lookup, reference: reference };
})();
