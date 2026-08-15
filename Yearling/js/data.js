/* Loading and normalising the Fasig-Tipton catalog feed.
 *
 * Their catalogue pages are a React app over a Django REST API:
 *
 *   /django/api/sales/?sale_identifier=N26A   -> the sale record (gives its pk)
 *   /django/api/horses/?sale=<pk>             -> every hip in one request
 *   /django/api/updates/?horse__sale_id=<pk>  -> catalog-page updates by hip
 *
 * All three answer `Access-Control-Allow-Origin: *`, so the app can pull them
 * from a local server *and* from index.html opened straight off disk. (Checked
 * on the response headers, not assumed.)
 */
window.FT = window.FT || {};

FT.data = (function () {
  'use strict';
  var U = FT.util;

  var API = 'https://www.fasigtipton.com/django/api/';

  /* Sale identifiers are <region><yy><letter>: N = New York (Saratoga),
     K = Kentucky, M = Midlantic, C = California. `pk` is the numeric id the
     horses endpoint wants; it is looked up live from the identifier and only
     kept here as a fallback, since it is the one thing that could drift.

     `defaultRef` marks the prior-year yearling sales pooled into the market
     index by default — see js/sires.js. Newest first. */
  var SALES = [
    { code: 'N26A', pk: 309, year: 2026, start: '2026-08-10',
      label: '2026 The Saratoga Sale (selected yearlings)', type: 'yearling' },
    { code: 'N26B', pk: 314, year: 2026, start: '2026-08-16',
      label: '2026 New York Bred Yearlings', type: 'yearling' },
    { code: 'N25A', pk: 279, year: 2025, start: '2025-08-04',
      label: '2025 The Saratoga Sale', type: 'yearling', defaultRef: true },
    { code: 'N25B', pk: 280, year: 2025, start: '2025-08-10',
      label: '2025 New York Bred Yearlings', type: 'yearling', defaultRef: true },
    { code: 'K25C', pk: 287, year: 2025, start: '2025-10-20',
      label: '2025 Kentucky October Yearlings', type: 'yearling', defaultRef: true },
    { code: 'M25B', pk: 285, year: 2025, start: '2025-09-30',
      label: '2025 Midlantic Fall Yearlings', type: 'yearling' },
    { code: 'N25C', pk: 286, year: 2025, start: '2025-10-14',
      label: '2025 The Saratoga Fall Sale', type: 'yearling' }
  ];

  /* Not offered in the sale picker — these are where a yearling may already
     have been through the ring, loaded quietly in the background to build sale
     history. A yearling selling in August of year Y was foaled in Y-1, so it
     could have sold as a weanling that November or as a short yearling the
     following February. */
  /* The mixed sales a yearling may already have been through. Loaded quietly
     in the background so "sale history" can find a prior price.
   *
   * Saratoga Fall is here as well as in SALES, and that is deliberate. It is
   * catalogued as a fall *yearling* sale but it is really a mixed one: 230 of
   * the 281 hips in the 2025 edition were that year's foals, sold as weanlings,
   * with the rest broodmares. Leaving it out meant a New York-bred yearling
   * that changed hands there in October showed no prior sale at all. */
  var HISTORY_SALES = [
    { code: 'K25D', pk: 288, year: 2025, start: '2025-11-03',
      label: '2025 The November Sale', type: 'mixed', soldAs: 'Weanling' },
    { code: 'K26A', pk: 293, year: 2026, start: '2026-02-09',
      label: '2026 Kentucky Winter Mixed', type: 'mixed', soldAs: 'Short yearling' },
    { code: 'N25C', pk: 286, year: 2025, start: '2025-10-14',
      label: '2025 The Saratoga Fall Sale', type: 'mixed', soldAs: 'Weanling' },
    { code: 'K24D', pk: 264, year: 2024, start: '2024-11-04',
      label: '2024 The November Sale', type: 'mixed', soldAs: 'Weanling' },
    { code: 'K25A', pk: 268, year: 2025, start: '2025-02-03',
      label: '2025 Kentucky Winter Mixed', type: 'mixed', soldAs: 'Short yearling' },
    { code: 'N24C', pk: 262, year: 2024, start: '2024-10-15',
      label: '2024 The Saratoga Fall Sale', type: 'mixed', soldAs: 'Weanling' }
  ];

  function saleByCode(code) {
    return SALES.concat(HISTORY_SALES).filter(function (s) {
      return s.code === String(code);
    })[0] || null;
  }

  /**
   * Which mixed sales this crop could already have passed through.
   * A yearling sold in year Y was foaled in Y-1: the November sale of Y-1
   * (as a weanling) and the Winter Mixed of Y (as a short yearling).
   */
  function historySalesFor(code) {
    var target = saleByCode(code);
    if (!target) return [];
    return HISTORY_SALES.filter(function (s) {
      return (s.start.slice(5, 7) >= '10' && s.year === target.year - 1) ||
             (s.start.slice(5, 7) < '10' && s.year === target.year);
    }).map(function (s) { return s.code; });
  }

  /** Prior-year yearling sales, for the market index. */
  function defaultRefSales(code) {
    var target = saleByCode(code);
    if (!target) return [];
    return SALES.filter(function (s) {
      return s.defaultRef && s.year < target.year;
    }).map(function (s) { return s.code; });
  }

  function saleUrl(code) { return API + 'sales/?sale_identifier=' + encodeURIComponent(code); }
  function horsesUrl(pk) { return API + 'horses/?sale=' + pk; }
  function updatesUrl(pk) { return API + 'updates/?horse__sale_id=' + pk; }

  /**
   * The catalog page for one hip, as a PDF.
   * Fasig-Tipton files them under the sale's *start* date, even for the second
   * session — a two-day sale is one folder, numbered straight through by hip.
   */
  function catalogPageUrl(sale, hip) {
    if (!sale.start || !hip) return '';
    var d = U.parseDate(sale.start);
    if (!d) return '';
    return 'https://www.fasigtipton.com/catalogs/' + d.getFullYear() + '/' + U.mmdd(d) +
           '/' + hip + '.pdf';
  }

  /* ------------------------------------------------------------ normalising */

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  /** vimeo.com/1214817941 -> "1214817941". Anything unrecognised -> ''. */
  function vimeoId(url) {
    var m = String(url || '').match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : '';
  }

  /* An unnamed yearling carries a placeholder of "<foaling year>-<DAM>", e.g.
     "2025-KEESHA". That is not a name, and showing it as one just clutters
     every row, so it's dropped. */
  function realName(raw) {
    var s = String(raw || '').trim();
    if (!s || /^\d{4}\s*-/.test(s)) return '';
    return U.titleCase(s);
  }

  /**
   * One raw horse record -> the shape the rest of the app uses.
   * `sale` is the parent sale object (for code/start/label context).
   */
  function normalizeHip(raw, sale) {
    /* Fasig-Tipton has no RNA flag and no out flag in the price fields: the
       outcome is carried in `purchaser`. "OUT" means withdrawn, "NOT SOLD"
       means it failed to meet its reserve and `price` is the figure it was bid
       up to. Anything else is the buyer. */
    var purchaser = String(raw.purchaser || '').trim();
    var pUpper = purchaser.toUpperCase();
    var isOut = raw.out === true || pUpper === 'OUT';
    var rna = pUpper === 'NOT SOLD';
    var amount = num(raw.price);

    var sold = !isOut && !rna && amount !== null && amount > 0;
    var price = sold ? amount : null;
    var bidTo = rna ? amount : null;

    var foalDate = U.parseDate(raw.year_of_birth);
    var foalYear = foalDate ? String(foalDate.getFullYear())
      : (String(raw.year_of_birth || '').match(/(\d{4})/) || [])[1] || '';

    var photos = (raw.generalhorsephoto_set || [])
      .concat(raw.enhancedhorsephoto_set || [])
      .map(function (p) { return p.photo; })
      .filter(Boolean);

    var repo = raw.repository || null;
    var repoDocs = (repo && repo.repositoryDocs || []).map(function (d) {
      return d.documentName;
    }).filter(Boolean);

    var consignor = raw.consignor_name || raw.consignor || raw.property_line || '';

    return {
      key: sale.code + ':' + raw.hip,
      saleId: sale.code,
      saleCode: sale.code,
      saleLabel: sale.label,
      saleYear: sale.year,
      salePk: sale.pk,

      hip: String(raw.hip),
      hipNum: parseInt(raw.hip, 10) || 0,
      name: realName(raw.name),
      sex: raw.sex || '',
      sexLabel: U.SEX[raw.sex] || raw.sex || '—',
      color: raw.color || '',
      colorLabel: U.COLOR[raw.color] || raw.color || '—',

      sire: U.titleCase(raw.sire),
      sireRaw: (raw.sire || '').trim().toUpperCase(),
      dam: U.titleCase(raw.dam),
      damRaw: (raw.dam || '').trim().toUpperCase(),
      damSire: U.titleCase(raw.sire_of_dam),
      damSireRaw: (raw.sire_of_dam || '').trim().toUpperCase(),

      // `property_line` carries the "AGENT" / "AGENT FOR X" qualifier; the
      // plain consignor name is what you group and filter by.
      consignor: U.titleCase(raw.property_line || consignor),
      consignorSort: U.titleCase(consignor),
      barn: raw.barn || '',
      session: raw.session || '',
      sessionLabel: U.sessionLabel(raw.session),
      foalArea: raw.foaled || '',
      foalDate: foalDate,
      foalDay: U.dayOfYear(foalDate),
      foalYear: foalYear,

      status: isOut ? 'out' : 'in',
      outDate: U.parseDate(raw.out_date),
      sold: sold,
      rna: rna,
      price: price,
      bidTo: bidTo,
      buyer: sold ? U.titleCase(purchaser) : '',
      privateSale: raw.private_sale === true,

      hasPhoto: photos.length > 0,
      photoLink: photos[0] || '',
      photoLinks: photos,
      walkVideoId: vimeoId(raw.youtube_url),
      walkVideoLink: raw.youtube_url || '',
      hasWalkVideo: !!vimeoId(raw.youtube_url),
      pedigreeLink: catalogPageUrl(sale, raw.hip),

      /* The repository is the x-ray/vet-report set a consignor lodges before a
         sale. "hasXray: false" this close to the sale is itself information. */
      hasXray: !!(repo && repo.hasXray),
      repoDocs: repoDocs,
      repoUpdated: repo && repo.lastUpdated ? String(repo.lastUpdated).slice(0, 10) : '',

      update: '',            // filled in from the updates endpoint
      hasUpdate: false,
      updateDate: '',

      tjcRef: raw.tjc_ref_num || '',
      soldAsCode: raw.sold_as_code || ''
    };
  }

  /** Attach catalog-page updates to the hips they belong to. */
  function applyUpdates(horses, updates) {
    var byHip = {};
    (updates || []).forEach(function (u) {
      var hip = u.horse && u.horse.hip;
      if (hip === null || hip === undefined) return;
      var k = String(hip);
      // A hip can carry more than one update; keep them all, newest last.
      byHip[k] = byHip[k] ? { text: byHip[k].text + '\n\n' + u.update_text, when: u.last_updated }
                          : { text: u.update_text || '', when: u.last_updated };
    });
    horses.forEach(function (h) {
      var u = byHip[h.hip];
      if (!u || !u.text) return;
      h.update = u.text;
      h.hasUpdate = true;
      h.updateDate = String(u.when || '').slice(0, 10);
    });
    return horses;
  }

  /* ---------------------------------------------------------------- loading */

  function getJson(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('Fasig-Tipton returned HTTP ' + r.status);
      return r.json();
    });
  }

  /**
   * The horses endpoint is keyed on the numeric pk, not the sale code, so the
   * code has to be resolved first. The pk in SALES is only a fallback for when
   * that lookup fails — the live answer always wins.
   */
  function resolveSale(code) {
    var known = saleByCode(code);
    return getJson(saleUrl(code)).then(function (rows) {
      if (!rows || !rows.length) throw new Error('No Fasig-Tipton sale with identifier ' + code + '.');
      var s = rows[0];
      return {
        code: code,
        pk: s.id,
        label: (known && known.label) || ('Sale ' + code),
        short: code,
        year: known ? known.year : parseInt(String(s.sale_start_day || '').slice(0, 4), 10) || null,
        start: s.sale_start_day || (known && known.start) || '',
        category: known ? known.type : '',
        maxHip: s.max_hip,
        showResults: s.show_results === true,
        raw: s
      };
    }).catch(function (err) {
      if (!known) throw err;
      // Falling back keeps the app usable if the sales endpoint hiccups.
      return {
        code: code, pk: known.pk, label: known.label, short: code, year: known.year,
        start: known.start, category: known.type, maxHip: null, showResults: false,
        raw: null, degraded: err.message
      };
    });
  }

  /** Live fetch of one sale: sale record, then hips, then catalog updates. */
  function fetchSale(code) {
    return resolveSale(code).then(function (sale) {
      return getJson(horsesUrl(sale.pk)).then(function (rows) {
        if (!Array.isArray(rows)) throw new Error('Unexpected payload for sale ' + code + '.');
        var horses = rows.map(function (h) { return normalizeHip(h, sale); });
        horses.sort(function (a, b) { return a.hipNum - b.hipNum; });
        // Updates are a bonus — a sale still loads if this 404s.
        return getJson(updatesUrl(sale.pk))
          .catch(function () { return []; })
          .then(function (updates) {
            applyUpdates(horses, updates);
            return { sale: sale, horses: horses, fetchedAt: Date.now() };
          });
      });
    });
  }

  /* ----------------------------------------------------------------- import */

  /**
   * Accepts a saved `horses/?sale=<pk>` payload — the bare array Fasig-Tipton
   * serves, with no massaging. The sale it belongs to can't be read off the
   * array, so it is matched by the `sale` pk each record carries.
   */
  function parseFile(text) {
    var json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error('Could not parse that file as JSON.'); }

    var rows = Array.isArray(json) ? json : (json && json.horses);
    if (!Array.isArray(rows) || !rows.length || rows[0].hip === undefined) {
      throw new Error('That does not look like a Fasig-Tipton horses payload ' +
                      '(expected the array from /django/api/horses/?sale=…).');
    }

    var pk = rows[0].sale;
    var known = SALES.concat(HISTORY_SALES).filter(function (s) { return s.pk === pk; })[0];
    if (!known) {
      throw new Error('These hips belong to Fasig-Tipton sale #' + pk + ', which this app ' +
                      'does not know about. Add it to SALES in js/data.js.');
    }
    var sale = {
      code: known.code, pk: pk, label: known.label, short: known.code, year: known.year,
      start: known.start, category: known.type, maxHip: null, showResults: false, raw: null
    };
    var horses = rows.map(function (h) { return normalizeHip(h, sale); });
    horses.sort(function (a, b) { return a.hipNum - b.hipNum; });
    return { sale: sale, horses: horses, fetchedAt: Date.now() };
  }

  return {
    API: API,
    SALES: SALES,
    HISTORY_SALES: HISTORY_SALES,
    saleByCode: saleByCode,
    historySalesFor: historySalesFor,
    defaultRefSales: defaultRefSales,
    saleUrl: saleUrl,
    horsesUrl: horsesUrl,
    updatesUrl: updatesUrl,
    catalogPageUrl: catalogPageUrl,
    vimeoId: vimeoId,
    resolveSale: resolveSale,
    fetchSale: fetchSale,
    parseFile: parseFile
  };
})();
