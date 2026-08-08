/* BloodHorse sire lists — the racing-performance basis for the Pedigree score.
 *
 * Deliberately built from how a sire's progeny RUN, never from what their
 * yearlings or 2YOs fetch at auction. Sale prices tell you what the market
 * already believes; they can't tell you whether it's right.
 *
 * Three signals, all rates rather than totals so a sire with 40 runners isn't
 * beaten by one with 400:
 *   - % black-type winners from runners   (quality)
 *   - average earnings per runner, logged (overall)
 *   - graded stakes winners per runner    (elite quality)
 *
 * Small books are shrunk toward the list average, then each sire is ranked
 * within its own list — a freshman sire is compared to other freshmen, not to
 * Into Mischief.
 *
 * Stud fee is imported and displayed but never scored: it's a price, and
 * prices are what we're trying to stay independent of.
 */
window.OBS = window.OBS || {};

OBS.bloodhorse = (function () {
  'use strict';
  var U = OBS.util;

  var SHRINK_K = 20;   // runners before a sire's rates are taken at face value
  var W_BTW = 0.40, W_AER = 0.35, W_GSW = 0.25;

  /* Which list wins when a sire appears in several. Most specific first:
     how this year's 2YOs are running beats a general all-ages list. */
  var LIST_PRIORITY = ['2yo', '2yoc', 'c1', 'c2', 'c2c', 'c3', 'c3c',
                       'c4', 'c4c', 'c5', 'c5c', 'c6', 'c6c', 'g', 'gl'];

  var LIST_LABELS = {
    g: 'Leading Sires', gl: 'Leading Sires (lifetime)',
    c1: 'First-Crop', c2: 'Second-Crop', c2c: 'Second-Crop (cum.)',
    c3: 'Third-Crop', c3c: 'Third-Crop (cum.)', c4: 'Fourth-Crop',
    c4c: 'Fourth-Crop (cum.)', c5: 'Fifth-Crop', c5c: 'Fifth-Crop (cum.)',
    c6: 'Sixth-Crop', c6c: 'Sixth-Crop (cum.)',
    '2yo': 'Sires of 2YOs', '2yoc': 'Sires of 2YOs (cum.)',
    '3yo': 'Sires of 3YOs', '3yoc': 'Sires of 3YOs (cum.)'
  };

  /**
   * Match BloodHorse names to the OBS feed: upper-case, drop country suffixes
   * like (ARG)/(IRE), drop punctuation. "Candy Ride (ARG)" -> "CANDY RIDE".
   */
  function normalizeName(name) {
    return String(name || '')
      .toUpperCase()
      .replace(/\([A-Z]{2,3}\)/g, ' ')
      .replace(/[^A-Z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stdev(arr, mu) {
    if (arr.length < 2) return null;
    var v = arr.reduce(function (a, x) { return a + (x - mu) * (x - mu); }, 0) / (arr.length - 1);
    return Math.sqrt(v);
  }

  /** Score every sire in one imported list, 0-100, ranked within that list. */
  function rateList(list) {
    var rows = (list.rows || []).filter(function (r) { return r.sire; });
    if (!rows.length) return [];

    var usable = rows.filter(function (r) { return r.rnrs > 0; });
    if (usable.length < 2) {
      rows.forEach(function (r) { r._rating = 50; });
      return rows;
    }

    var btw = usable.map(function (r) { return r.btwPct === null ? 0 : r.btwPct; });
    var aer = usable.map(function (r) { return Math.log(Math.max(1, r.aer || 1)); });
    var gsw = usable.map(function (r) { return (r.gsw || 0) / r.rnrs * 100; });

    var mB = U.mean(btw), sB = stdev(btw, mB) || 1;
    var mA = U.mean(aer), sA = stdev(aer, mA) || 1;
    var mG = U.mean(gsw), sG = stdev(gsw, mG) || 1;

    rows.forEach(function (r) {
      if (!(r.rnrs > 0)) { r._z = null; return; }
      var zB = ((r.btwPct === null ? 0 : r.btwPct) - mB) / sB;
      var zA = (Math.log(Math.max(1, r.aer || 1)) - mA) / sA;
      var zG = (((r.gsw || 0) / r.rnrs * 100) - mG) / sG;
      var raw = W_BTW * zB + W_AER * zA + W_GSW * zG;
      r._z = raw * (r.rnrs / (r.rnrs + SHRINK_K));   // shrink small books
    });

    var zs = rows.filter(function (r) { return r._z !== null; })
                 .map(function (r) { return r._z; })
                 .sort(function (a, b) { return a - b; });

    rows.forEach(function (r) {
      r._rating = r._z === null ? null : Math.round(U.percentileRank(zs, r._z) * 100);
    });
    return rows;
  }

  /* ---------------------------------------------------------------- cohorts */

  /* Lists fall into cohorts of like-for-like sires. A sire is ranked only
   * against others in his own cohort, and the cohorts are never mixed:
   * a freshman with 20 runners has nothing to say about an established sire
   * with 300, in either direction.
   *
   * When a sire qualifies for more than one, the narrowest cohort wins — it's
   * the fairest comparison available for him.
   */
  var COHORTS = [
    { id: 'firstCrop', label: 'First crop',  priority: 0, types: ['c1'] },
    { id: 'laterCrop', label: 'Later crop',  priority: 1,
      types: ['c2', 'c2c', 'c3', 'c3c', 'c4', 'c4c', 'c5', 'c5c', 'c6', 'c6c'] },
    { id: 'general',   label: 'All runners', priority: 2, types: ['g', 'gl'] }
  ];

  /* "Sires of Two-Year-Olds" / "of Three-Year-Olds" are excluded by design.
     They measure one age group's results inside a single season — a small,
     noisy slice that says more about which juveniles happened to run early
     than about the sire. Importing one is refused rather than silently
     ignored, so the exclusion is never a mystery. */
  var IGNORED_TYPES = ['2yo', '2yoc', '3yo', '3yoc'];

  function cohortOf(listType) {
    for (var i = 0; i < COHORTS.length; i++) {
      if (COHORTS[i].types.indexOf(listType) !== -1) return COHORTS[i];
    }
    return COHORTS[2]; // anything unrecognised behaves like a general list
  }

  function isIgnored(listType) { return IGNORED_TYPES.indexOf(listType) !== -1; }

  /* ---------------------------------------------------------------- pooling */

  /**
   * Pool one cohort's lists across racing years into a single row per sire.
   *
   * Counts are summed, then the rates are recomputed from the pooled totals.
   * That measures RUNNER-SEASONS, not unique horses — a horse that raced in
   * both 2025 and 2026 counts twice. That's consistent as long as numerator
   * and denominator are summed together, and it's the point: two years of
   * Leading Sires gives roughly double the sample to shrink against, so the
   * ranking stops swinging on one good season.
   */
  function poolCohort(lists) {
    var bySire = {};

    lists.forEach(function (list) {
      var year = Number(list.year) || 0;
      (list.rows || []).forEach(function (r) {
        var key = normalizeName(r.sire);
        if (!key || !(r.rnrs > 0)) return;

        var s = bySire[key] || (bySire[key] = {
          sire: r.sire, key: key, years: [],
          rnrs: 0, wnrs: 0, btw: 0, bth: 0, gsw: 0, g1w: 0,
          _earn: 0, _awdNum: 0, _awdDen: 0,
          studFee: null, _feeYear: -1, foals: null, _foalYear: -1
        });

        s.rnrs += r.rnrs;
        s.wnrs += (r.wnrs || 0);
        s.btw += (r.btw || 0);
        s.bth += (r.bth || 0);
        s.gsw += (r.gsw || 0);
        s.g1w += (r.g1w || 0);

        // earnings may be absent; aer * rnrs reconstructs it exactly.
        var earn = r.earnings !== null && r.earnings !== undefined
          ? r.earnings : (r.aer || 0) * r.rnrs;
        s._earn += earn;

        if (r.awd) { s._awdNum += r.awd * r.rnrs; s._awdDen += r.rnrs; }

        // Point-in-time facts take the most recent year rather than summing.
        if (year > s._feeYear && r.studFee !== null) { s.studFee = r.studFee; s._feeYear = year; }
        if (year > s._foalYear && r.foals !== null) { s.foals = r.foals; s._foalYear = year; }

        if (s.years.indexOf(year) === -1) s.years.push(year);
      });
    });

    return Object.keys(bySire).map(function (k) {
      var s = bySire[k];
      s.years.sort(function (a, b) { return b - a; });
      s.btwPct = s.rnrs ? (s.btw / s.rnrs) * 100 : null;
      s.bthPct = s.rnrs ? (s.bth / s.rnrs) * 100 : null;
      s.aer = s.rnrs ? s._earn / s.rnrs : null;
      s.awd = s._awdDen ? s._awdNum / s._awdDen : null;
      s.earnings = s._earn;
      return s;
    });
  }

  /* -------------------------------------------------------------- the index */

  /**
   * Build a lookup across every imported list.
   * Lists are grouped into cohorts, each cohort pooled across years, rated
   * within itself, and then the narrowest cohort a sire belongs to wins.
   */
  function buildIndex(lists) {
    var byCohort = {};
    var meta = [];

    Object.keys(lists || {}).forEach(function (id) {
      var list = lists[id];
      var label = list.listLabel || LIST_LABELS[list.listType] || list.listType;
      var ignored = isIgnored(list.listType);
      var cohort = ignored ? null : cohortOf(list.listType);

      meta.push({
        id: id, year: list.year, listType: list.listType, listLabel: label,
        cohort: cohort ? cohort.id : null, cohortLabel: cohort ? cohort.label : 'not used',
        ignored: ignored, region: list.region, importedAt: list.importedAt,
        count: (list.rows || []).length
      });

      if (ignored) return;
      (byCohort[cohort.id] = byCohort[cohort.id] || { cohort: cohort, lists: [] })
        .lists.push(list);
    });

    var byName = {};
    var cohortMeta = [];

    Object.keys(byCohort).forEach(function (cid) {
      var group = byCohort[cid];
      var pooled = poolCohort(group.lists);
      var rated = rateList({ rows: pooled });

      var years = [];
      group.lists.forEach(function (l) {
        var y = Number(l.year) || 0;
        if (years.indexOf(y) === -1) years.push(y);
      });
      years.sort(function (a, b) { return b - a; });

      cohortMeta.push({
        id: cid, label: group.cohort.label, sires: rated.length,
        years: years, lists: group.lists.length
      });

      rated.forEach(function (r) {
        if (r._rating === null) return;
        var key = r.key;
        var cand = {
          key: key, sire: r.sire, rating: r._rating, row: r,
          cohort: group.cohort, years: r.years, latest: r.years[0] || 0
        };
        var cur = byName[key];
        /* Most recent data wins, then the narrower cohort. Recency first
           matters: a sire who was a freshman in 2025 and has a second crop
           running in 2026 should be judged on the second crop, not left in
           the first-crop cohort forever. Cohorts are never blended. */
        if (!cur || cand.latest > cur.latest ||
            (cand.latest === cur.latest && cand.cohort.priority < cur.cohort.priority)) {
          byName[key] = cand;
        }
      });
    });

    meta.sort(function (a, b) {
      return (Number(b.year) - Number(a.year)) || a.listLabel.localeCompare(b.listLabel);
    });
    cohortMeta.sort(function (a, b) { return a.id.localeCompare(b.id); });

    return {
      byName: byName, lists: meta, cohorts: cohortMeta,
      count: Object.keys(byName).length
    };
  }

  function lookup(index, rawName) {
    return index.byName[normalizeName(rawName)] || null;
  }

  /* ------------------------------------------------------------------ import */

  function parseFile(text) {
    var json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error('Could not parse that file as JSON.'); }
    if (!json || json._format !== 'bloodhorse-sire-list' || !Array.isArray(json.rows)) {
      throw new Error('Not a BloodHorse sire list. Run bloodhorse-extract.js on the ' +
                      'BloodHorse sire-lists page and import the file it saves.');
    }
    if (!json.rows.length) throw new Error('That list is empty.');
    if (isIgnored(json.listType)) {
      throw new Error('"' + (json.listLabel || json.listType) + '" is not used by this model. ' +
        'Sires-of-2YOs and 3YOs lists measure one age group inside a single season — too small ' +
        'and too noisy to rank on. Import Leading Sires and First-Crop Sires instead.');
    }
    return {
      id: (json.year || '?') + ':' + (json.listType || 'g'),
      year: json.year, listType: json.listType,
      listLabel: json.listLabel || LIST_LABELS[json.listType] || json.listType,
      region: json.region || '', url: json.url || '',
      importedAt: new Date().toISOString(),
      rows: json.rows
    };
  }

  return {
    normalizeName: normalizeName,
    buildIndex: buildIndex,
    poolCohort: poolCohort,
    cohortOf: cohortOf,
    isIgnored: isIgnored,
    lookup: lookup,
    parseFile: parseFile,
    COHORTS: COHORTS,
    IGNORED_TYPES: IGNORED_TYPES,
    LIST_LABELS: LIST_LABELS,
    LIST_PRIORITY: LIST_PRIORITY
  };
})();
