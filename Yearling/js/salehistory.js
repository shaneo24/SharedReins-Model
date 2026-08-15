/* Where has this horse been sold before?
 *
 * A yearling at Saratoga in August 2026 was foaled in 2025, so it may already
 * have gone through the ring twice: as a weanling the previous November, and
 * as a short yearling at a winter mixed sale. What it made then tells you the
 * consignor's basis — a colt bought for $40K and pinhooked is a different
 * proposition from one that cost $400K.
 *
 * Two sources:
 *
 *   Fasig-Tipton — free, already loaded. Matched on dam + foaling year, which
 *              is unique in practice: a mare has one foal a year. The sire is
 *              checked afterwards as a guard rather than being part of the key.
 *
 *   Keeneland — via the local server's /api/keeneland proxy. Their search
 *              returns JSON but sends no CORS header, so the browser can't
 *              call it directly. Needs `node serve.js`; degrades to
 *              Fasig-Tipton-only when the page is opened off disk.
 *
 * Keeneland matters more here than it does for a 2YO sale: Keeneland November
 * is where most of this crop's weanlings changed hands.
 */
window.FT = window.FT || {};

FT.saleHistory = (function () {
  'use strict';

  /* Where Keeneland rows come from, in preference order:
       'local'  — serve.js proxying live, the freshest answer
       'cache'  — the shared Supabase cache, filled by shared/fetch-keeneland.js
       'no'     — neither, so the Keeneland leg is simply missing
     Static hosting has no proxy, which is exactly why the cache exists. */
  var sourceState = 'unknown';  // 'unknown' | 'local' | 'cache' | 'no'
  var damCache = {};            // normalised dam -> { rows } | { error } | { uncached: true }
  var inflight = {};

  function normDam(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* ---------------------------------------------------------- Fasig-Tipton */

  /**
   * Prior Fasig-Tipton appearances of this exact individual, from whatever
   * sales are already loaded. Excludes the sale you're shopping.
   */
  /**
   * What the horse was when it went through that ring, worked out from its
   * foaling year against the sale's.
   *
   * A static label per sale isn't enough for a genuinely mixed sale: Saratoga
   * Fall is catalogued as a yearling sale but is mostly weanlings, so taking
   * the label at face value would report a weanling purchase as a yearling
   * one — and the whole point of this panel is the consignor's basis.
   */
  function soldAsFor(horse, sale, meta) {
    if (meta && meta.soldAs) return meta.soldAs;      // sale with one clear crop
    var saleYear = parseInt(String(sale.start || '').slice(0, 4), 10) || sale.year;
    var foalYear = parseInt(horse.foalYear, 10);
    if (saleYear && foalYear) {
      if (foalYear === saleYear) return 'Weanling';
      if (foalYear === saleYear - 1) return 'Yearling';
    }
    return sale.category === 'yearling' ? 'Yearling' : 'Mixed';
  }

  function ftMatches(horse, loaded) {
    var key = normDam(horse.dam) + '|' + horse.foalYear;
    var out = [];

    Object.keys(loaded || {}).forEach(function (code) {
      if (String(code) === String(horse.saleId)) return;
      var entry = loaded[code];
      if (!entry) return;
      var meta = FT.data.saleByCode(code);
      entry.horses.forEach(function (o) {
        if (normDam(o.dam) + '|' + o.foalYear !== key) return;
        // Sire is not part of the key, so a mismatch means a bad match.
        if (normDam(o.sire) !== normDam(horse.sire)) return;
        out.push({
          source: 'Fasig',
          sale: entry.sale.label,
          saleShort: entry.sale.code,
          when: entry.sale.start || '',
          hip: o.hip,
          soldAs: soldAsFor(o, entry.sale, meta),
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

  /* ------------------------------------------------------------------ OBS */
  /* Ocala's Winter Mixed takes short yearlings in late January, so a yearling
     catalogued in August may already have been through that ring. Matched the
     same way as everything else — dam plus foaling year, with the sire as a
     guard. Their API is CORS-open, so this is a plain fetch with no proxy.

     Cached per sale for the session: one request covers every hip. */
  var obsCache = {};
  var obsInflight = {};

  function obsSales(saleId) {
    if (obsCache[saleId]) return Promise.resolve(obsCache[saleId]);
    if (obsInflight[saleId]) return obsInflight[saleId];

    var metas = FT.data.obsHistoryFor(saleId);
    if (!metas.length) { obsCache[saleId] = []; return Promise.resolve([]); }

    obsInflight[saleId] = Promise.all(metas.map(function (m) {
      // One unreachable OBS sale must not cost the others, or the Fasig and
      // Keeneland legs that have already resolved.
      return FT.data.fetchObsSale(m).catch(function () { return null; });
    })).then(function (sales) {
      var ok = sales.filter(Boolean);
      obsCache[saleId] = ok;
      delete obsInflight[saleId];
      return ok;
    });
    return obsInflight[saleId];
  }

  function obsMatches(horse) {
    return obsSales(horse.saleId).then(function (sales) {
      var out = [];
      sales.forEach(function (s) {
        s.horses.forEach(function (o) {
          if (normDam(o.damRaw) !== normDam(horse.dam)) return;
          if (String(o.foalYear).trim() !== String(horse.foalYear).trim()) return;
          if (o.sireRaw && normDam(o.sireRaw) !== normDam(horse.sire)) return;
          out.push({
            source: 'OBS',
            sale: s.meta.label,
            saleShort: String(s.meta.id),
            when: s.meta.start,
            hip: o.hip,
            soldAs: s.meta.soldAs,
            price: o.price,
            rna: o.rna,
            bidTo: o.bidTo,
            out: o.out,
            buyer: o.buyer,
            consignor: o.consignor,
            link: ''
          });
        });
      });
      return out;
    });
  }

  /* ------------------------------------------------------------ Keeneland */

  /**
   * Which Keeneland source is available, resolved once per session.
   *
   * The local proxy wins when it's there: it asks Keeneland live, so it can't
   * be out of date. Otherwise the shared cache, which is the normal path for a
   * hosted copy and needs somebody to have run the fetch script.
   */
  function keenelandSource() {
    if (sourceState !== 'unknown') return Promise.resolve(sourceState);

    var viaCache = (window.FT.sync && FT.sync.ready()) ? 'cache' : 'no';

    // No proxy can exist off disk, so don't waste a request finding out.
    if (location.protocol === 'file:') {
      sourceState = viaCache;
      return Promise.resolve(sourceState);
    }
    return fetch('/api/ping')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { sourceState = (j && j.keeneland) ? 'local' : viaCache; return sourceState; })
      .catch(function () { sourceState = viaCache; return sourceState; });
  }

  /** Back-compat for anything still asking the old yes/no question. */
  function proxyAvailable() {
    return keenelandSource().then(function (s) { return s !== 'no'; });
  }

  /**
   * All Keeneland rows for a dam, cached for the session. One request per
   * mare, ever — a mare with three foals in the sale is still one lookup.
   *
   * Resolves to an array. A mare the shared cache has never been asked about
   * rejects with `.uncached`, because an empty array there would read as
   * "Keeneland has nothing on her", which is a different and much stronger
   * claim than "nobody has looked yet".
   */
  function keenelandByDam(dam) {
    var key = normDam(dam);
    if (!key) return Promise.resolve([]);
    if (damCache[key]) {
      var hit = damCache[key];
      if (hit.rows) return Promise.resolve(hit.rows);
      var err = new Error(hit.error || 'not looked up yet');
      if (hit.uncached) err.uncached = true;
      return Promise.reject(err);
    }
    if (inflight[key]) return inflight[key];

    inflight[key] = keenelandSource().then(function (src) {
      if (src === 'local') {
        return fetch('/api/keeneland?dam=' + encodeURIComponent(dam))
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.error) throw new Error(j.error);
            return Array.isArray(j.rows) ? j.rows : [];
          });
      }
      if (src === 'cache') {
        return FT.sync.keeneland([dam]).then(function (map) {
          var entry = map[key];
          if (!entry) {
            var miss = new Error('not in the shared cache');
            miss.uncached = true;
            throw miss;
          }
          return Array.isArray(entry.rows) ? entry.rows : [];
        });
      }
      throw new Error('no Keeneland source');
    })
      .then(function (rows) { damCache[key] = { rows: rows }; return rows; })
      .catch(function (e) {
        damCache[key] = e.uncached ? { uncached: true, error: e.message }
                                   : { error: e.message || 'lookup failed' };
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
        if (r.sire && normDam(r.sire) !== normDam(horse.sire)) return false;

        /* Drop sales that haven't happened yet. Keeneland flags an open
           catalogue with currentsale = -1 and a completed one with 0, and a
           yearling at Saratoga in August is very often also catalogued for
           Keeneland September — it came back with sale_price -1 and a date a
           month in the future. Listing that under prior sales would invent a
           pinhook basis out of an entry nobody has bid on.

           The flag is the signal, not the price: four of the completed sales
           in the sample also carry a negative price, being withdrawals. */
        return String(r.currentsale || '0').trim() === '0';
      }).map(function (r) {
        var price = money(r.sale_price);
        var isRna = String(r.rna_indicator || '').toUpperCase() === 'Y';
        return {
          source: 'Keeneland',
          sale: r.sale || 'Keeneland',           // e.g. "NOV 2025"
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
   * Fasig-Tipton matches resolve immediately; Keeneland resolves when the
   * proxy answers.
   */
  function forHorse(horse, loaded) {
    var ft = ftMatches(horse, loaded);

    // OBS resolves independently of Keeneland, and neither is allowed to sink
    // the other: a horse's Fasig-Tipton history is already in hand and should
    // still be shown if either lookup fails.
    var obs = obsMatches(horse).catch(function () { return []; });

    var kee = keenelandSource().then(function (src) {
      if (src === 'no') return { rows: [], state: 'unavailable' };
      return keenelandMatches(horse).then(function (rows) {
        return { rows: rows, state: 'ok', via: src };
      }).catch(function (e) {
        // A mare nobody has fetched yet is not a failure — it is a gap with a
        // specific fix, and the panel says which.
        if (e.uncached) return { rows: [], state: 'uncached' };
        return { rows: [], state: 'error', error: e.message };
      });
    });

    return Promise.all([obs, kee]).then(function (r) {
      return {
        entries: ft.concat(r[0], r[1].rows),
        keeneland: r[1].state,
        via: r[1].via,
        error: r[1].error
      };
    });
  }

  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      return String(a.when).localeCompare(String(b.when));
    });
  }

  return {
    normDam: normDam,
    ftMatches: ftMatches,
    obsMatches: obsMatches,
    keenelandByDam: keenelandByDam,
    keenelandMatches: keenelandMatches,
    keenelandSource: keenelandSource,
    proxyAvailable: proxyAvailable,
    forHorse: forHorse,
    sortEntries: sortEntries
  };
})();
