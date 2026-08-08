/* Where has this horse been sold before?
 *
 * A 2YO at Ocala in March 2026 was probably a yearling somewhere in 2025, and
 * what it cost then tells you the consignor's basis — a colt bought for $14K
 * and pinhooked is a different proposition from one that cost $300K.
 *
 * Two sources:
 *
 *   OBS      — free, already loaded. Matched on dam + foaling year, which is
 *              unique in practice: a mare has one foal a year. Verified across
 *              816 hips with zero collisions, and the sire agreed every time
 *              despite not being part of the key.
 *
 *   Keeneland — via the local server's /api/keeneland proxy. Their search
 *              returns JSON but sends no CORS header, so the browser can't
 *              call it directly. Needs `node serve.js`; degrades to OBS-only
 *              when the page is opened off disk.
 */
window.OBS = window.OBS || {};

OBS.saleHistory = (function () {
  'use strict';
  var U = OBS.util;

  var proxyState = 'unknown';   // 'unknown' | 'yes' | 'no'
  var damCache = {};            // normalised dam -> { rows } | { error }
  var inflight = {};

  function normDam(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* ------------------------------------------------------------------ OBS */

  /**
   * Prior OBS appearances of this exact individual, from whatever sales are
   * already loaded. Excludes the sale you're shopping.
   */
  function obsMatches(horse, loaded) {
    var key = normDam(horse.dam) + '|' + horse.foalYear;
    var out = [];

    Object.keys(loaded || {}).forEach(function (saleId) {
      if (String(saleId) === String(horse.saleId)) return;
      var entry = loaded[saleId];
      if (!entry) return;
      entry.horses.forEach(function (o) {
        if (normDam(o.dam) + '|' + o.foalYear !== key) return;
        // Sire is not part of the key, so a mismatch means a bad match.
        if (normDam(o.sire) !== normDam(horse.sire)) return;
        out.push({
          source: 'OBS',
          sale: entry.sale.label,
          saleShort: entry.sale.short || entry.sale.label,
          when: entry.sale.starts ? entry.sale.starts.slice(0, 10) : '',
          hip: o.hip,
          soldAs: entry.sale.category === 'yearling' ? 'Yearling'
                : entry.sale.category === '2yo' ? '2YO' : 'Mixed',
          price: o.sold ? o.price : null,
          rna: o.rna,
          bidTo: o.bidTo,
          out: o.status === 'out',
          buyer: o.buyer,
          consignor: o.consignorSort,
          link: o.pedigreeLink
        });
      });
    });
    return out;
  }

  /* ------------------------------------------------------------ Keeneland */

  function proxyAvailable() {
    if (proxyState !== 'unknown') return Promise.resolve(proxyState === 'yes');
    if (location.protocol === 'file:') { proxyState = 'no'; return Promise.resolve(false); }
    return fetch('/api/ping')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { proxyState = j && j.keeneland ? 'yes' : 'no'; return proxyState === 'yes'; })
      .catch(function () { proxyState = 'no'; return false; });
  }

  /** All Keeneland rows for a dam, cached. One request per mare, ever. */
  function keenelandByDam(dam) {
    var key = normDam(dam);
    if (!key) return Promise.resolve([]);
    if (damCache[key]) {
      return damCache[key].error ? Promise.reject(new Error(damCache[key].error))
                                 : Promise.resolve(damCache[key].rows);
    }
    if (inflight[key]) return inflight[key];

    inflight[key] = fetch('/api/keeneland?dam=' + encodeURIComponent(dam))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error(j.error);
        var rows = Array.isArray(j.rows) ? j.rows : [];
        damCache[key] = { rows: rows };
        return rows;
      })
      .catch(function (e) {
        damCache[key] = { error: e.message || 'lookup failed' };
        throw e;
      })
      .then(function (v) { delete inflight[key]; return v; },
            function (e) { delete inflight[key]; throw e; });

    return inflight[key];
  }

  function money(v) {
    var n = parseFloat(v);
    return isNaN(n) || n <= 0 ? null : n;
  }

  /** Keeneland rows narrowed to this individual, by foaling year and sire. */
  function keenelandMatches(horse) {
    return keenelandByDam(horse.dam).then(function (rows) {
      return rows.filter(function (r) {
        // Searching by dam returns every foal she's sent through Keeneland,
        // so narrow to this individual by foaling year, then confirm on sire.
        if (String(r.yob || '').trim() !== String(horse.foalYear).trim()) return false;
        return !r.sire || normDam(r.sire) === normDam(horse.sire);
      }).map(function (r) {
        var price = money(r.sale_price);
        var isRna = String(r.rna_indicator || '').toUpperCase() === 'Y';
        return {
          source: 'Keeneland',
          sale: r.sale || 'Keeneland',           // e.g. "SEP 2025"
          saleShort: r.sale || '',
          when: r.lastshowdate ? String(r.lastshowdate).slice(0, 10) : '',
          hip: String(r.hip || '').replace(/^0+/, ''),
          name: r.name || '',
          soldAs: r.sold_as || '',
          price: isRna ? null : price,
          rna: isRna,
          bidTo: isRna ? price : null,
          out: String(r.out_indicator || '').toUpperCase() === 'Y',
          buyer: r.buyer || '',
          consignor: r.consignor_central || r.consignor || '',
          link: r.catalog_page_link || ''
        };
      });
    });
  }

  /* --------------------------------------------------------------- public */

  /**
   * Everything known about where this horse has been before.
   * OBS matches resolve immediately; Keeneland resolves when the proxy answers.
   */
  function forHorse(horse, loaded) {
    var obs = obsMatches(horse, loaded);
    return proxyAvailable().then(function (ok) {
      if (!ok) return { entries: obs, keeneland: 'unavailable' };
      return keenelandMatches(horse).then(function (kee) {
        return { entries: obs.concat(kee), keeneland: 'ok' };
      }).catch(function (e) {
        return { entries: obs, keeneland: 'error', error: e.message };
      });
    });
  }

  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      return String(a.when).localeCompare(String(b.when));
    });
  }

  return {
    normDam: normDam,
    obsMatches: obsMatches,
    keenelandByDam: keenelandByDam,
    keenelandMatches: keenelandMatches,
    proxyAvailable: proxyAvailable,
    forHorse: forHorse,
    sortEntries: sortEntries
  };
})();
