/* Loading and normalising the OBS catalog feed. */
window.OBS = window.OBS || {};

OBS.data = (function () {
  'use strict';
  var U = OBS.util;

  var API_BASE = 'https://obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/';

  /* Known sale ids, verified against the OBS API. `id` is what the API and
     the /catalog/#/<id>/ URL both use. Newest first. */
  var SALES = [
    { id: 151, code: 'O826', year: 2026, meet: 'June',   label: '2026 June 2YO in Training / Racing Age', type: '2yo' },
    { id: 150, code: 'O726', year: 2026, meet: 'Spring', label: '2026 Spring (April) 2YO in Training',    type: '2yo' },
    { id: 149, code: 'O626', year: 2026, meet: 'March',  label: '2026 March 2YOs in Training',            type: '2yo' },
    { id: 145, code: 'O825', year: 2025, meet: 'June',   label: '2025 June 2YO in Training / Racing Age', type: '2yo' },
    { id: 144, code: 'O725', year: 2025, meet: 'Spring', label: '2025 Spring (April) 2YO in Training',    type: '2yo' },
    { id: 142, code: 'O625', year: 2025, meet: 'March',  label: '2025 March 2YO in Training',             type: '2yo' },
    { id: 137, code: 'O824', year: 2024, meet: 'June',   label: '2024 June 2YO in Training / Racing Age', type: '2yo' },
    { id: 136, code: 'O724', year: 2024, meet: 'Spring', label: '2024 Spring 2YO in Training',            type: '2yo' },
    { id: 135, code: 'O624', year: 2024, meet: 'March',  label: '2024 March 2YO in Training',             type: '2yo' }
  ];

  /* Not offered in the sale picker — these are where a 2YO was sold as a
     yearling, loaded quietly in the background to build sale history. */
  var HISTORY_SALES = [
    { id: 146, year: 2025, label: '2025 October Yearling Sale',  type: 'yearling' },
    { id: 140, year: 2025, label: '2025 Winter Mixed Live Sale', type: 'mixed' },
    { id: 138, year: 2024, label: '2024 October Yearling Sale',  type: 'yearling' },
    { id: 147, year: 2026, label: '2026 Winter Mixed Live Sale', type: 'mixed' }
  ];

  /**
   * OBS sales worth loading to find where a 2YO was sold as a yearling.
   * A 2YO selling in year Y was foaled in Y-2, so its yearling season was
   * Y-1: the October Yearling sale of Y-1 and the Winter Mixed of Y-1
   * (January, when a Y-2 foal has just turned one).
   */
  function historySalesFor(saleId) {
    var target = SALES.filter(function (s) { return String(s.id) === String(saleId); })[0];
    if (!target) return [];
    return HISTORY_SALES
      .filter(function (s) { return s.year === target.year - 1; })
      .map(function (s) { return String(s.id); });
  }

  function saleUrl(id) { return API_BASE + id + '?is_digital=false'; }

  /* ------------------------------------------------------------ normalising */

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  /**
   * One raw `sale_hip` record -> the shape the rest of the app uses.
   * `sale` is the parent sale object (for id/code/meet context).
   */
  function normalizeHip(raw, sale) {
    var dp = raw.display_props || {};
    var isOut = raw.in_out_status === 'O' || dp.is_hip_out === true;
    var rna = raw.rna_summary_indicator === 'Y';
    var hammer = num(raw.hammer_price);
    var rnaAmt = num(raw.sale_price_rna);

    // A sold horse has a positive hammer price and is not flagged RNA.
    var sold = !isOut && !rna && hammer !== null && hammer > 0;
    var price = sold ? hammer : null;
    // "Bid to" figure for RNAs — useful as a soft market signal.
    var bidTo = rna ? (rnaAmt || (hammer !== null ? Math.abs(hammer) : null)) : null;

    var furlongs = U.parseFurlongs(raw.ut_distance);
    var breezeSec = U.parseBreeze(raw.ut_time);
    // A time without a valid distance can't be compared to anything.
    if (furlongs === null) breezeSec = null;

    var foalDate = U.parseDate(raw.foaling_date);

    return {
      key: sale.id + ':' + raw.hip_number,
      saleId: String(sale.id),
      saleCode: sale.code,
      saleLabel: sale.label,
      saleYear: sale.year,
      saleMeet: sale.meet,

      hip: raw.hip_number,
      hipNum: parseInt(raw.hip_number, 10) || 0,
      name: raw.horse_name || '',
      sex: raw.sex || '',
      sexLabel: U.SEX[raw.sex] || raw.sex || '—',
      color: raw.color || '',
      colorLabel: U.COLOR[raw.color] || raw.color || '—',

      sire: U.titleCase(raw.sire_name),
      sireRaw: (raw.sire_name || '').trim().toUpperCase(),
      dam: U.titleCase(raw.dam_name),
      damRaw: (raw.dam_name || '').trim().toUpperCase(),
      damSire: U.titleCase(raw.dam_sire),
      damSireRaw: (raw.dam_sire || '').trim().toUpperCase(),

      consignor: U.titleCase(raw.consignor_name || raw.property_line_1),
      consignorSort: U.titleCase(raw.consignor_sort),
      barn: raw.barn_number || '',
      session: raw.session_number || '',
      foalArea: raw.foaling_area || '',
      foalDate: foalDate,
      foalDay: U.dayOfYear(foalDate),
      foalYear: raw.foaling_year || '',

      breezeRaw: raw.ut_time || '',
      breezeSec: breezeSec,
      furlongs: furlongs,
      distLabel: U.furlongLabel(furlongs),
      breezeDate: U.parseDate(raw.ut_actual_date || raw.ut_expected_date),
      breezeSet: raw.ut_set || '',

      status: isOut ? 'out' : 'in',
      sold: sold,
      rna: rna,
      price: price,
      bidTo: bidTo,
      buyer: raw.buyer_name && raw.buyer_name !== 'RNA' ? U.titleCase(raw.buyer_name) : '',

      hasPhoto: raw.has_photo === '1',
      hasVideo: raw.has_video === '1',
      hasWalkVideo: raw.has_walk_video === '1',
      photoLink: raw.photo_link || '',
      videoLink: raw.video_link || '',
      walkVideoLink: raw.walk_video_link || '',
      pedigreeLink: raw.pedigree_pdf_link || '',
      updatesLink: raw.updates_link || '',
      announcement: raw.announcement || '',
      isBt: raw.is_bt === '1'
    };
  }

  /** Raw API payload -> { sale, horses }. Accepts the object OBS returns. */
  function normalizeSale(payload) {
    if (!payload || !payload.sale_hip) {
      throw new Error('That does not look like an OBS sale payload (no sale_hip array).');
    }
    var known = SALES.filter(function (s) { return String(s.id) === String(payload.sale_id); })[0];
    var sale = {
      id: String(payload.sale_id),
      code: payload.sale_code || (known && known.code) || '',
      label: payload.sale_name || (known && known.label) || ('Sale ' + payload.sale_id),
      short: payload.sale_short_name || '',
      year: known ? known.year : parseInt(String(payload.sale_starts || '').slice(0, 4), 10) || null,
      meet: known ? known.meet : '',
      starts: payload.sale_starts || '',
      category: payload.sale_category || ''
    };
    var horses = payload.sale_hip.map(function (h) { return normalizeHip(h, sale); });
    horses.sort(function (a, b) { return a.hipNum - b.hipNum; });
    return { sale: sale, horses: horses, fetchedAt: Date.now() };
  }

  /* ---------------------------------------------------------------- loading */

  /**
   * Live fetch. OBS's WordPress REST API echoes back whatever Origin it is
   * sent — including the "null" origin a file:// page carries — so this works
   * both from a local server and from the page opened directly off disk.
   * The caller still falls back to file import if a browser refuses.
   */
  function fetchSale(id) {
    return fetch(saleUrl(id), { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('OBS returned HTTP ' + r.status + ' for sale ' + id);
      return r.json();
    }).then(normalizeSale);
  }

  function parseFile(text) {
    var json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error('Could not parse that file as JSON.'); }
    // Tolerate a bare array of hips if someone exports just the table.
    if (Array.isArray(json)) {
      if (!json.length || !json[0].hip_number) throw new Error('Unrecognised JSON array.');
      json = { sale_id: json[0].sale_id, sale_hip: json };
    }
    return normalizeSale(json);
  }

  return {
    SALES: SALES,
    HISTORY_SALES: HISTORY_SALES,
    historySalesFor: historySalesFor,
    saleUrl: saleUrl,
    fetchSale: fetchSale,
    parseFile: parseFile,
    normalizeSale: normalizeSale
  };
})();
