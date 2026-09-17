/* Loading and normalising the catalogue feeds — Fasig-Tipton and Keeneland.
 *
 * Both are reduced to the same horse record (see normalizeHip), so nothing
 * downstream needs to know which auction house a hip came from. Keeneland's
 * feed is described with its adapter further down.
 *
 * Fasig-Tipton's catalogue pages are a React app over a Django REST API:
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
     index by default — see js/sires.js. Newest first.

     `source: 'keeneland'` marks a Keeneland catalogue, loaded through its own
     adapter. Its code is deliberately not in Fasig-Tipton's <region><yy><letter>
     shape, so nothing can mistake it for one of theirs. */
  var SALES = [
    { code: 'KEE-S26', source: 'keeneland', keeId: 132, pedigreeSlug: 'k226',
      year: 2026, start: '2026-09-14',
      label: '2026 Keeneland September Yearling Sale', type: 'yearling' },
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
    var mixed = HISTORY_SALES.filter(function (s) {
      return (s.start.slice(5, 7) >= '10' && s.year === target.year - 1) ||
             (s.start.slice(5, 7) < '10' && s.year === target.year);
    }).map(function (s) { return s.code; });
    return mixed.concat(priorSalesFor(code).filter(function (c) {
      return mixed.indexOf(c) === -1;
    }));
  }

  /**
   * Yearling sales earlier in the same season.
   *
   * The same crop moves between yearling sales: a colt that RNA'd at Saratoga
   * in August is routinely re-entered at Keeneland in September, and what he
   * was bid to in August is the most relevant number there is. Only sales that
   * *started before* this one count — a later catalogue is a future entry, not
   * history.
   */
  function priorSalesFor(code) {
    var target = saleByCode(code);
    if (!target || !target.start) return [];
    return SALES.filter(function (s) {
      return s.code !== target.code && s.year === target.year &&
             s.start && s.start < target.start && !s.source;
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

  /* ------------------------------------------------------------------ OBS */
  /*
   * Ocala Breeders' Sales — a third auction house, and a third place a
   * yearling may already have been sold.
   *
   * Their Winter Mixed sale in late January takes short yearlings, so a colt
   * catalogued at Saratoga in August can have been through the OBS ring seven
   * months earlier. Hip 322 of the 2026 New York Bred sale RNA'd there at
   * $130,000 and this model showed no prior sale at all, because it only ever
   * looked at Fasig-Tipton and Keeneland.
   *
   * Fetched straight from the browser: the OBS API echoes back whatever Origin
   * it is given, so unlike Keeneland it needs no proxy and no cache.
   */
  var OBS_API = 'https://obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/';

  var OBS_HISTORY = [
    { id: 147, year: 2026, start: '2026-01-27',
      label: '2026 OBS Winter Mixed', soldAs: 'Short yearling' },
    { id: 140, year: 2025, start: '2025-01-28',
      label: '2025 OBS Winter Mixed', soldAs: 'Short yearling' }
  ];

  /** The OBS mixed sales a yearling from this sale could have passed through. */
  function obsHistoryFor(code) {
    var target = saleByCode(code);
    if (!target) return [];
    // Winter Mixed runs in January of the same year as a summer yearling sale,
    // where that crop shows up as short yearlings.
    return OBS_HISTORY.filter(function (s) { return s.year === target.year; });
  }

  function obsSaleUrl(id) { return OBS_API + id + '?is_digital=false'; }

  /**
   * One OBS sale, reduced to what sale history needs.
   *
   * Deliberately not the full normalisation the 2YO model does — nothing here
   * is scored or filtered, it is only matched against and printed. The outcome
   * fields are read exactly as that model reads them: `in_out_status` 'O' is a
   * withdrawal, `rna_summary_indicator` 'Y' is an RNA whose figure lives in
   * `sale_price_rna` (and whose `hammer_price` is negative), and anything else
   * with a positive hammer price is a sale.
   */
  function fetchObsSale(meta) {
    return getJson(obsSaleUrl(meta.id), 'OBS').then(function (data) {
      var rows = (data && data.sale_hip) || [];
      return {
        meta: meta,
        horses: rows.map(function (r) {
          var isOut = r.in_out_status === 'O';
          var rna = r.rna_summary_indicator === 'Y';
          var hammer = num(r.hammer_price);
          var rnaAmt = num(r.sale_price_rna);
          var sold = !isOut && !rna && hammer !== null && hammer > 0;
          return {
            hip: String(r.hip_number || ''),
            sireRaw: String(r.sire_name || '').trim().toUpperCase(),
            damRaw: String(r.dam_name || '').trim().toUpperCase(),
            foalYear: String(r.foaling_year || ''),
            consignor: U.titleCase(r.consignor_sort || r.consignor_name || ''),
            out: isOut,
            rna: rna,
            price: sold ? hammer : null,
            bidTo: rna ? (rnaAmt || (hammer !== null ? Math.abs(hammer) : null)) : null,
            buyer: r.buyer_name && r.buyer_name !== 'RNA' && r.buyer_name !== 'OUT'
              ? U.titleCase(r.buyer_name) : ''
          };
        })
      };
    });
  }

  function saleUrl(code) {
    var meta = saleByCode(code);
    if (meta && meta.source === 'keeneland') return keeCatalogUrl(meta.keeId);
    return API + 'sales/?sale_identifier=' + encodeURIComponent(code);
  }
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

  /**
   * A walk-video link -> { provider, id }, or null.
   *
   * Most consignors post to Vimeo, but some use YouTube, and both houses carry
   * those links in the same field: Fasig-Tipton's `youtube_url` (despite the
   * name, usually Vimeo) holds "https://youtu.be/<id>", sometimes with a
   * leading space or a "?si=" tracking tail; Keeneland's `field_other_videos`
   * holds "https://www.youtube.com/embed/<id>". Reading only Vimeo left 85
   * hips at Saratoga and New York Bred, and 297 at Keeneland September,
   * looking as if they had no video at all.
   */
  function videoRef(url) {
    var s = String(url || '').trim();
    var v = vimeoId(s);
    if (v) return { provider: 'vimeo', id: v };
    var y = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|live\/|watch\?(?:[^#]*&)?v=))([A-Za-z0-9_-]{11})/i);
    if (y) return { provider: 'youtube', id: y[1] };
    return null;
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

    var walk = videoRef(raw.youtube_url);
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
      book: '',              // Fasig-Tipton doesn't divide its sales into books
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
      walkVideoId: walk ? walk.id : '',
      walkVideoProvider: walk ? walk.provider : '',
      walkVideoLink: String(raw.youtube_url || '').trim(),
      hasWalkVideo: !!walk,
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

  /* -------------------------------------------------------------- Keeneland */
  /*
   * Keeneland's online catalogue is a Next.js page that loads the whole sale
   * from one static file:
   *
   *   catalog-backend.keeneland.com/sites/default/files/json_hde/sale_data_<id>.json
   *
   * It answers `Access-Control-Allow-Origin: *` — unlike their horse search,
   * which needs a proxy — so the browser fetches it directly, from GitHub Pages
   * and from file:// alike. The September sale is ~4,600 hips and 14MB of JSON,
   * but Cloudflare serves it gzipped at about 1.5MB. It is rewritten after each
   * session, so results arrive as the sale runs.
   *
   * The outcome fields are read exactly as Keeneland's own table reads them
   * (checked against their page bundle, not guessed):
   *
   *   field_out 'Y'                          -> OUT
   *   field_rna_indicator 'Y', or price < 0  -> RNA. The price is the sentinel
   *                                             -2.00; the bid-to figure only
   *                                             exists in the buyer text,
   *                                             "R.N.A. (385,000)".
   *   price > 0 and indicator 'P'            -> sold post-sale: RNA'd in the
   *                                             ring, deal done afterwards.
   *                                             Keeneland reports these apart
   *                                             from "in the ring" sales.
   *   indicator 'C'                          -> private sale
   *   price > 0 otherwise                    -> sold in the ring
   */
  var KEE_CATALOG = 'https://catalog-backend.keeneland.com/sites/default/files/json_hde/sale_data_';

  function keeCatalogUrl(id) { return KEE_CATALOG + id + '.json'; }

  /* Keeneland spells colours out; Fasig-Tipton uses codes. Mapping onto the
     codes means a saved colour filter works on either house's catalogue. */
  var KEE_COLOR = {
    'Bay': 'B', 'Brown': 'BR', 'Dark Bay/Brown': 'DKB', 'Chestnut': 'CH',
    'Gray/Roan': 'GRR', 'Gray': 'GR', 'Roan': 'RO', 'Black': 'BL',
    'White': 'WH', 'Palomino': 'PAL'
  };

  function keeRnaFigure(buyer) {
    var m = String(buyer || '').match(/R\.?\s*N\.?\s*A\.?\s*\(\s*\$?([\d,]+)/i);
    return m ? (parseInt(m[1].replace(/,/g, ''), 10) || null) : null;
  }

  /* Page updates arrive as HTML — "<b>2nd dam</b><div><b>ELYSIAN FIELD</b> (2020
     f. by…)</div>". The update box renders text, so the markup is flattened
     with each section heading and paragraph on its own line. Bold also marks
     black-type horses mid-sentence, so only the "1st dam" / "2nd dam" headings
     get a break of their own. */
  function keeUpdateText(html) {
    return String(html || '')
      .replace(/<b>\s*(\d+(?:st|nd|rd|th) dam)\s*<\/b>/gi, '$1\n')
      .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n')
      .trim();
  }

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  /** One Keeneland catalogue record -> the same shape normalizeHip returns. */
  function normalizeKeeneland(raw, sale) {
    var hip = String(parseInt(raw.field_hip_number, 10) || String(raw.field_hip_number || '').trim());
    var isOut = raw.field_out === 'Y';
    var flag = String(raw.field_rna_indicator || '');
    var amount = num(raw.field_price);
    var rna = !isOut && (flag === 'Y' || (amount !== null && amount < 0));
    var sold = !isOut && !rna && amount !== null && amount > 0;
    var buyer = String(raw.field_buyer_name || '').trim();

    var foalDate = U.parseDate(raw.field_foaling_date);
    var foalYear = foalDate ? String(foalDate.getFullYear()) : '';

    // Names arrive already properly cased — "Sea The Stars (IRE)" — and
    // titleCase would lower the country suffix, so they are only trimmed.
    var sire = String(raw.field_sire || '').trim();
    var dam = String(raw.field_dam || '').trim();
    var damSire = String(raw.field_broodmare_sire || '').trim();

    // The property line carries "…, Agent for X"; the agency alone is what you
    // filter by. 1,358 distinct property lines collapse to 125 agencies.
    var consignor = String(raw.field_consignor || '').trim();
    var consignorSort = consignor.replace(/,\s*Agent\b.*$/i, '').trim() ||
                        String(raw.field_consignor_name || '').trim();

    // Zero-padded so the session picker's plain string sort is chronological
    // (Session 10 after Session 9, not after Session 1), and carrying the book
    // because that is how Keeneland itself names a session.
    var session = raw.field_session
      ? 'Session ' + pad2(raw.field_session) + (raw.field_book ? ' · Book ' + raw.field_book : '')
      : '';

    var colourText = String(raw.field_color || '').trim();
    var colour = KEE_COLOR[colourText] || colourText;

    var photos = [raw.field_main_image].concat(raw.field_image || []).filter(Boolean);
    var videos = (raw.field_other_videos || []).map(function (v) {
      return { url: String(v || '').trim(), ref: videoRef(v) };
    }).filter(function (v) { return !!v.ref; });
    var update = keeUpdateText(raw.field_updates2);

    return {
      key: sale.code + ':' + hip,
      saleId: sale.code,
      saleCode: sale.code,
      saleLabel: sale.label,
      saleYear: sale.year,
      salePk: sale.pk,
      source: 'keeneland',

      hip: hip,
      hipNum: parseInt(hip, 10) || 0,
      name: '',                         // the title is only ever "Hip 0756"
      sex: raw.field_sex || '',
      sexLabel: U.SEX[raw.field_sex] || raw.field_sex || '—',
      color: colour,
      colorLabel: U.COLOR[colour] || colourText || '—',

      sire: sire,
      sireRaw: sire.toUpperCase(),
      dam: dam,
      damRaw: dam.toUpperCase(),
      damSire: damSire,
      damSireRaw: damSire.toUpperCase(),

      consignor: consignor,
      consignorSort: consignorSort,
      barn: String(raw.field_barn_text || (raw.field_barns || []).join(', ')).trim(),
      session: session,
      sessionLabel: U.sessionLabel(session),
      book: raw.field_book || '',
      foalArea: String(raw.field_foaling_area || '').trim(),
      foalDate: foalDate,
      foalDay: U.dayOfYear(foalDate),
      foalYear: foalYear,

      status: isOut ? 'out' : 'in',
      outDate: null,
      sold: sold,
      rna: rna,
      price: sold ? amount : null,
      bidTo: rna ? keeRnaFigure(buyer) : null,
      buyer: sold ? buyer : '',
      postSale: sold && flag === 'P',
      privateSale: flag === 'C',

      hasPhoto: photos.length > 0,
      photoLink: photos[0] || '',
      photoLinks: photos,
      walkVideoId: videos.length ? videos[0].ref.id : '',
      walkVideoProvider: videos.length ? videos[0].ref.provider : '',
      walkVideoLink: videos.length ? videos[0].url : '',
      hasWalkVideo: videos.length > 0,
      pedigreeLink: raw.field_pedigree || '',

      /* Keeneland runs a repository too, but this feed says nothing about it.
         `repoKnown: false` lets the detail panel say "not published" rather
         than "nothing lodged", which would be a claim we can't back. */
      hasXray: false,
      repoDocs: [],
      repoUpdated: '',
      repoKnown: false,

      // Every hip whose family has done anything since printing carries text
      // here — three in four of them. Keeneland flags the notable ones (a new
      // graded winner under the dam) in red, and so does this app.
      update: update,
      hasUpdate: !!update,
      updateDate: '',
      updateMajor: raw.field_update_link_red === 'Y',

      supplement: raw.field_supplement_indicator === 'Y',
      tjcRef: '',
      soldAsCode: ''
    };
  }

  /** The feed is an object keyed by node id; its values are the hips. */
  function keenelandHorses(data, sale) {
    var rows = Array.isArray(data) ? data
      : Object.keys(data || {}).map(function (k) { return data[k]; });
    return rows.filter(function (r) {
      return r && r.field_hip_number && r.field_hidden_indicator !== 'Y';
    }).map(function (r) {
      return normalizeKeeneland(r, sale);
    }).sort(function (a, b) { return a.hipNum - b.hipNum; });
  }

  function keenelandSaleRecord(meta) {
    return {
      code: meta.code, pk: meta.keeId, label: meta.label, short: meta.code,
      year: meta.year, start: meta.start, category: meta.type,
      maxHip: null, showResults: true, raw: null, source: 'keeneland'
    };
  }

  function fetchKeenelandSale(meta) {
    var sale = keenelandSaleRecord(meta);
    // `no-cache` revalidates against the ETag instead of trusting a copy up to
    // five minutes old — this file changes as each session's results land.
    return getJson(keeCatalogUrl(meta.keeId), 'Keeneland', { cache: 'no-cache' })
      .then(function (data) {
        var horses = keenelandHorses(data, sale);
        if (!horses.length) throw new Error('Keeneland returned an empty catalogue for ' + meta.label + '.');
        sale.maxHip = horses[horses.length - 1].hipNum;
        return { sale: sale, horses: horses, fetchedAt: Date.now() };
      });
  }

  /* ---------------------------------------------------------------- loading */

  function getJson(url, who, opts) {
    var init = Object.assign({ credentials: 'omit' }, opts || {});
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error((who || 'Fasig-Tipton') + ' returned HTTP ' + r.status);
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
    var meta = saleByCode(code);
    if (meta && meta.source === 'keeneland') return fetchKeenelandSale(meta);
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

    // A saved Keeneland sale_data_<id>.json: an object of hips keyed by node id.
    var keeRows = json && !Array.isArray(json) && typeof json === 'object'
      ? Object.keys(json).map(function (k) { return json[k]; }) : null;
    if (keeRows && keeRows.length && keeRows[0] && keeRows[0].field_hip_number !== undefined) {
      // The file doesn't say which sale it is, only the sale id inside each
      // pedigree link ("…/k226/…") — so match on the one Keeneland catalogue
      // we know, and refuse anything else rather than mislabel it.
      var kee = SALES.filter(function (s) { return s.source === 'keeneland'; });
      var slug = String(keeRows[0].field_pedigree || '').match(/\/sales\/(k\d+)\//i);
      var pick = kee.filter(function (s) {
        return slug && s.pedigreeSlug && s.pedigreeSlug === slug[1].toLowerCase();
      })[0] || (kee.length === 1 ? kee[0] : null);
      if (!pick) {
        throw new Error('This looks like a Keeneland catalogue, but not one this app knows. ' +
                        'Add it to SALES in js/data.js.');
      }
      var ksale = keenelandSaleRecord(pick);
      var khorses = keenelandHorses(json, ksale);
      ksale.maxHip = khorses.length ? khorses[khorses.length - 1].hipNum : null;
      return { sale: ksale, horses: khorses, fetchedAt: Date.now() };
    }

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
    priorSalesFor: priorSalesFor,
    defaultRefSales: defaultRefSales,
    keeCatalogUrl: keeCatalogUrl,
    normalizeKeeneland: normalizeKeeneland,
    OBS_HISTORY: OBS_HISTORY,
    obsHistoryFor: obsHistoryFor,
    fetchObsSale: fetchObsSale,
    saleUrl: saleUrl,
    horsesUrl: horsesUrl,
    updatesUrl: updatesUrl,
    catalogPageUrl: catalogPageUrl,
    vimeoId: vimeoId,
    videoRef: videoRef,
    resolveSale: resolveSale,
    fetchSale: fetchSale,
    parseFile: parseFile
  };
})();
