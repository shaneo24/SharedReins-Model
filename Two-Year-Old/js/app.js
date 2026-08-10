/* State, event wiring, and the load pipeline. */
(function () {
  'use strict';
  var U = OBS.util;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    loaded: {},            // saleId -> { sale, horses }
    saleId: null,
    horses: [],
    view: [],
    ctx: null,
    sireIndex: { byKey: {}, list: [] },       // OBS market — reference only
    damSireIndex: { byKey: {}, list: [] },
    bhIndex: { byName: {}, lists: [], count: 0 },  // BloodHorse — feeds the score
    refSaleIds: [],        // sales pooled into the pedigree index
    facets: null,
    settings: OBS.store.getSettings(OBS.scoring.cloneDefaults()),
    filters: OBS.filters.blank(),
    sortBy: 'score',
    tab: 'catalog',        // 'catalog' | 'list'
    listId: OBS.store.activeListId(),
    presetId: '',          // saved filter currently loaded, for the picker
    openKey: null,
    stale: false,
    pickerState: {},       // pickerId -> { open, query }
    mediaTab: {},          // horse key -> which media tab is open
    histCache: {}          // horse key -> resolved sale history
  };

  // getSettings shallow-merges, so make sure the nested objects are whole.
  state.settings.weights = Object.assign({}, OBS.scoring.DEFAULTS.weights, state.settings.weights);
  state.settings.options = Object.assign({}, OBS.scoring.DEFAULTS.options, state.settings.options);

  // The unrated-handling option used to be conformation-only; it now covers
  // breeze visual too. Carry a saved preference across rather than resetting
  // it. Deleting the old key means this runs once.
  if (state.settings.options.unratedConformation) {
    state.settings.options.unratedManual = state.settings.options.unratedConformation;
    delete state.settings.options.unratedConformation;
    delete state.settings.options.neutralConformation;
  }

  /* --------------------------------------------------------------- status */

  function status(text, kind) {
    var el = $('loadStatus');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'loadbar' + (kind ? ' is-' + kind : '');
  }

  /* ---------------------------------------------------------------- loading */

  function defaultRefSales(targetId) {
    var target = OBS.data.SALES.filter(function (s) { return String(s.id) === String(targetId); })[0];
    if (!target) return [];
    // The previous year's three 2YO sales: enough hips for a stable sire read,
    // recent enough that the market is the same market.
    return OBS.data.SALES
      .filter(function (s) { return s.year === target.year - 1; })
      .map(function (s) { return String(s.id); });
  }

  function loadSale(id, opts) {
    opts = opts || {};
    id = String(id);
    if (state.loaded[id]) return Promise.resolve(state.loaded[id]);
    status('Pulling ' + (opts.label || ('sale ' + id)) + ' from the OBS catalog…');
    return OBS.data.fetchSale(id).then(function (res) {
      state.loaded[id] = res;
      return res;
    });
  }

  function setCurrentSale(id) {
    id = String(id);
    var entry = state.loaded[id];
    if (!entry) return;
    state.saleId = id;
    state.horses = entry.horses;
    state.facets = OBS.filters.facets(entry.horses);
    state.openKey = null;
    $('resultsFilters').open = entry.horses.some(function (h) { return h.sold || h.rna; });
    rebuildPedigree();
    recompute();
    renderPickers();
  }

  function handleLoadClick() {
    var id = $('saleSelect').value;
    var label = $('saleSelect').selectedOptions[0].textContent;
    $('btnLoad').disabled = true;

    loadSale(id, { label: label })
      .then(function (res) {
        status('Loaded ' + res.sale.label + ' — ' + res.horses.length + ' hips.', 'done');
        setCurrentSale(id);
        return loadReferenceSales(defaultRefSales(id)).then(function () {
          return loadHistorySales(id);
        });
      })
      .catch(function (err) {
        var offline = location.protocol === 'file:';
        status(
          'Could not pull live data: ' + err.message +
          (offline
            ? '  Your browser may be blocking the request from a file:// page — run "node serve.js" and use http://localhost:8099, or use Import JSON.'
            : '  Check your connection, or use Import JSON.'),
          'error'
        );
        $('empty').hidden = false;
      })
      .then(function () { $('btnLoad').disabled = false; });
  }

  /** Pool prior sales into the pedigree index, one at a time, in the background. */
  function loadReferenceSales(ids) {
    var todo = ids.filter(function (i) { return !state.loaded[i]; });
    state.refSaleIds = ids.slice();
    if (!todo.length) { rebuildPedigree(); recompute(); return Promise.resolve(); }

    var i = 0;
    function next() {
      if (i >= todo.length) {
        status('Pedigree index built from ' + state.refSaleIds.length + ' reference sale' +
               (state.refSaleIds.length === 1 ? '' : 's') + ' + the current one.', 'done');
        rebuildPedigree();
        recompute();
        renderRefSales();
        return;
      }
      var id = todo[i++];
      var meta = OBS.data.SALES.filter(function (s) { return String(s.id) === id; })[0];
      status('Building the sire book — reading ' + (meta ? meta.label : 'sale ' + id) + '…');
      renderRefSales();
      return OBS.data.fetchSale(id)
        .then(function (res) { state.loaded[id] = res; })
        .catch(function () { state.refSaleIds = state.refSaleIds.filter(function (x) { return x !== id; }); })
        .then(next);
    }
    return Promise.resolve(next());
  }

  /**
   * The OBS yearling and mixed sales this crop passed through, pulled quietly
   * so "sale history" can find a horse's yearling price without a round trip.
   * These never enter the pedigree index or the sale picker.
   */
  function loadHistorySales(saleId) {
    var ids = OBS.data.historySalesFor(saleId).filter(function (i) { return !state.loaded[i]; });
    if (!ids.length) return Promise.resolve();

    var i = 0;
    function next() {
      if (i >= ids.length) { status('Sale history ready.', 'done'); return; }
      var id = ids[i++];
      var meta = OBS.data.HISTORY_SALES.filter(function (s) { return String(s.id) === id; })[0];
      status('Loading sale history — ' + (meta ? meta.label : 'sale ' + id) + '…');
      return OBS.data.fetchSale(id)
        .then(function (res) { state.loaded[id] = res; })
        .catch(function () { /* history is a bonus; never block on it */ })
        .then(next);
    }
    return Promise.resolve(next());
  }

  function rebuildPedigree() {
    var pool = [];
    var ids = state.refSaleIds.slice();
    if (state.saleId && ids.indexOf(state.saleId) === -1) ids.push(state.saleId);
    ids.forEach(function (id) {
      if (state.loaded[id]) pool = pool.concat(state.loaded[id].horses);
    });
    state.sireIndex = OBS.sires.buildIndex(pool, 'sireRaw');
    state.damSireIndex = OBS.sires.buildIndex(pool, 'damSireRaw');
    state.bhIndex = OBS.bloodhorse.buildIndex(OBS.store.sireLists());
  }

  /* -------------------------------------------------------------- pipeline */

  function recompute() {
    if (!state.horses.length) return;

    state.ctx = OBS.scoring.buildContext(
      state.horses, state.sireIndex, state.damSireIndex, state.settings, state.bhIndex
    );
    // The context is rebuilt on every filter change; the history cache must
    // outlive it or every keystroke would re-query Keeneland.
    state.ctx._hist = state.histCache;
    OBS.scoring.scoreAll(state.horses, state.ctx);

    var rows = OBS.filters.apply(state.horses, state.filters, state.ctx);
    // A list tab is its own workspace: only horses on that list, with the
    // sidebar filters still applying on top so you can narrow it further.
    if (state.tab === 'list') {
      rows = rows.filter(function (h) { return OBS.store.isOnList(h.key, state.listId); });
    }
    sortRows(rows);
    state.view = rows;
    state.stale = false;
    render();
  }

  function breezeRank(h) {
    if (!state.ctx || h.breezeSec === null) return Infinity;
    var arr = state.ctx.breezeByDist[h.furlongs];
    if (!arr || arr.length < 2) return Infinity;
    return U.percentileRank(arr, h.breezeSec);
  }

  function sortRows(rows) {
    var by = state.sortBy;
    var comparators = {
      score: function (a, b) {
        var av = a._score.total, bv = b._score.total;
        if (av === null && bv === null) return a.hipNum - b.hipNum;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av || a.hipNum - b.hipNum;
      },
      hip: function (a, b) { return a.hipNum - b.hipNum; },
      breeze: function (a, b) { return breezeRank(a) - breezeRank(b) || a.hipNum - b.hipNum; },
      foal: function (a, b) {
        var av = a.foalDay === null ? Infinity : a.foalDay;
        var bv = b.foalDay === null ? Infinity : b.foalDay;
        return av - bv || a.hipNum - b.hipNum;
      },
      sire: function (a, b) { return a.sire.localeCompare(b.sire) || a.hipNum - b.hipNum; },
      consignor: function (a, b) { return (a.consignorSort || '').localeCompare(b.consignorSort || '') || a.hipNum - b.hipNum; },
      price: function (a, b) {
        var av = a.sold ? a.price : (a.rna ? a.bidTo : null);
        var bv = b.sold ? b.price : (b.rna ? b.bidTo : null);
        if (av === null && bv === null) return a.hipNum - b.hipNum;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      }
    };
    var cmp = comparators[by] || comparators.score;

    // A horse that didn't vet stays on the list but sinks to the bottom,
    // whatever you've sorted by — it's a record, not a candidate.
    if (state.tab === 'list') {
      rows.sort(function (a, b) {
        var af = OBS.store.vetStatus(a.key) === 'failed' ? 1 : 0;
        var bf = OBS.store.vetStatus(b.key) === 'failed' ? 1 : 0;
        return af - bf || cmp(a, b);
      });
      return;
    }
    rows.sort(cmp);
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    var sale = state.loaded[state.saleId] && state.loaded[state.saleId].sale;
    var loaded = !!state.horses.length;
    var onList = state.tab === 'list';
    var onThisList = loaded && onList
      ? OBS.store.shortlistCount(state.saleId, state.listId) : 0;

    // Three mutually exclusive panes: no sale, empty list, or the table.
    var showEmptyList = loaded && onList && onThisList === 0;
    $('empty').hidden = loaded;
    $('emptyShortlist').hidden = !showEmptyList;
    $('tableWrap').hidden = !loaded || showEmptyList;
    $('grid').classList.toggle('show-vet', onList);

    OBS.ui.renderRows($('rows'), state.view, state.ctx);

    $('countCatalog').textContent = loaded ? state.horses.length.toLocaleString() : '—';
    renderTabs();
    updateCountLine();

    OBS.ui.renderChips($('activeChips'), OBS.filters.activeSummary(state.filters));
    $('btnRerank').hidden = !state.stale;

    if (state.openKey) openDetail(state.openKey, true);
  }

  function renderWeights() {
    var total = OBS.ui.renderWeights($('weights'), state.settings);
    $('weightNote').textContent = total > 0
      ? 'Raw weights total ' + total + '; the model uses their relative share.'
      : 'Every weight is zero — give at least one factor some weight.';
  }

  function renderRefSales() {
    var el = $('refSales');
    if (!el) return;
    el.innerHTML = OBS.data.SALES.map(function (s) {
      var id = String(s.id);
      var on = state.refSaleIds.indexOf(id) !== -1;
      var loading = on && !state.loaded[id];
      var isCurrent = id === state.saleId;
      return '<span class="ref-sale' + (on || isCurrent ? ' is-on' : '') + (loading ? ' is-loading' : '') + '" ' +
             'data-ref="' + id + '"' + (isCurrent ? ' title="the sale you are shopping — always included"' : '') + '>' +
             U.escapeHtml(s.label) + (isCurrent ? ' ·current' : (loading ? ' ·loading' : '')) + '</span>';
    }).join('');
  }

  function openDetail(key, keepOpen) {
    var existing = document.querySelector('tr.detail');
    var wasSame = existing && existing.dataset.detailFor === key;
    if (existing) existing.remove();
    document.querySelectorAll('tr.hrow.is-open').forEach(function (r) { r.classList.remove('is-open'); });

    if (wasSame && !keepOpen) { state.openKey = null; return; }

    var row = document.querySelector('tr.hrow[data-key="' + CSS.escape(key) + '"]');
    if (!row) { state.openKey = null; return; }
    var horse = state.horses.filter(function (h) { return h.key === key; })[0];
    if (!horse) return;
    row.classList.add('is-open');
    // Default to the photo: it's small, and it's what you look at first.
    if (state.mediaTab[key] === undefined) {
      var tabs = OBS.ui.mediaTabs(horse);
      state.mediaTab[key] = tabs.length && !tabs[0].heavy ? tabs[0].id : '';
    }
    row.insertAdjacentHTML('afterend', OBS.ui.detailHtml(horse, state.ctx, state.mediaTab[key]));
    state.openKey = key;
    loadSaleHistory(horse);
  }

  /**
   * Sale history is fetched when you open a horse, not up front — one
   * Keeneland request per mare instead of 800 on load. Results are cached for
   * the session, so reopening a horse is instant.
   */
  function loadSaleHistory(horse) {
    var cache = state.histCache;
    if (cache[horse.key]) return;

    OBS.saleHistory.forHorse(horse, state.loaded).then(function (res) {
      cache[horse.key] = res;
      var block = document.querySelector('[data-hist-for="' + CSS.escape(horse.key) + '"]');
      if (block) block.innerHTML = OBS.ui.saleHistoryHtml(horse, res);
    }).catch(function (e) {
      cache[horse.key] = { entries: [], keeneland: 'error', error: e.message };
      var block = document.querySelector('[data-hist-for="' + CSS.escape(horse.key) + '"]');
      if (block) block.innerHTML = OBS.ui.saleHistoryHtml(horse, cache[horse.key]);
    });
  }

  /** Repaint the detail panel's list chips and the row star for one horse. */
  function syncListChips(key) {
    var box = document.querySelector('[data-list-chips="' + CSS.escape(key) + '"]');
    if (box) box.outerHTML = OBS.ui.listChips(key);
    var flag = document.querySelector('[data-flag="' + CSS.escape(key) + '"]');
    if (flag) {
      var on = OBS.store.isFlagged(key);
      flag.classList.toggle('is-on', on);
      flag.textContent = on ? '★' : '☆';
    }
    renderTabs();
  }

  /**
   * Repaint a horse's vet state everywhere it shows. Scratching is a decisive
   * call, not an incremental edit, so on the short list it re-sorts straight
   * away and the horse drops to the bottom then and there.
   */
  function applyVetStatus(key) {
    var status = OBS.store.vetStatus(key);
    document.querySelectorAll('[data-vet="' + CSS.escape(key) + '"]').forEach(function (sel) {
      sel.value = status;
      sel.className = sel.className.replace(/\bvet-(none|requested|passed|failed)\b/g, '').trim() +
        ' vet-' + status;
    });
    var row = document.querySelector('tr.hrow[data-key="' + CSS.escape(key) + '"]');
    if (row) row.classList.toggle('is-scratched', status === 'failed');
    if (state.tab === 'list') recompute();
  }

  /** Swap the media pane without rebuilding the rest of the detail row. */
  function setMediaTab(key, tab) {
    var horse = state.horses.filter(function (h) { return h.key === key; })[0];
    if (!horse) return;
    state.mediaTab[key] = state.mediaTab[key] === tab ? '' : tab;
    var block = document.querySelector('tr.detail[data-detail-for="' + CSS.escape(key) + '"] .detail-media');
    if (!block) return;
    block.outerHTML = OBS.ui.mediaHtml(horse, state.mediaTab[key]);
  }

  /** Rescore one horse and repaint its row + detail, without re-sorting. */
  function refreshHorse(key) {
    var horse = state.horses.filter(function (h) { return h.key === key; })[0];
    if (!horse || !state.ctx) return;
    horse._score = OBS.scoring.score(horse, state.ctx);

    var vals = { bv: OBS.store.breezeVisual(key), conf: OBS.store.conformation(key),
                 ped: OBS.store.pedigree(key) };
    var row = document.querySelector('tr.hrow[data-key="' + CSS.escape(key) + '"]');
    if (row) {
      var total = horse._score.total;
      var cell = row.querySelector('.score-cell');
      cell.className = 'score-cell ' + (total === null ? 't3' : total >= 68 ? 't1' : total >= 45 ? 't2' : 't3');
      cell.querySelector('.score-num').textContent = total === null ? '—' : total.toFixed(0);
      cell.querySelector('.score-bar i').style.width = (total === null ? 0 : U.clamp(total, 0, 100)) + '%';
      Object.keys(vals).forEach(function (kind) {
        var input = row.querySelector('[data-' + kind + ']');
        if (!input) return;
        if (document.activeElement !== input) input.value = vals[kind] === null ? '' : vals[kind];
        input.classList.toggle('is-set', vals[kind] !== null);
      });
      var flag = row.querySelector('.flag-btn');
      if (flag) {
        var on = OBS.store.isFlagged(key);
        flag.classList.toggle('is-on', on);
        flag.textContent = on ? '★' : '☆';
      }
    }

    // Vet status is shared, so it can change without you having touched it.
    // The colour comes from a vet-<state> class, which has to be swapped by
    // name rather than by pattern — `vet-select` matches the same shape, and
    // stripping that would take the control's own styling with it.
    var vet = OBS.store.vetStatus(key);
    document.querySelectorAll('[data-vet="' + CSS.escape(key) + '"]').forEach(function (sel) {
      if (document.activeElement === sel) return;
      sel.value = vet;
      OBS.store.VET_STATES.forEach(function (s) { sel.classList.remove('vet-' + s); });
      sel.classList.add('vet-' + vet);
    });

    // Refresh only the score breakdown. Rebuilding the whole detail row would
    // tear down the media pane — reloading a 35MB video, or losing your place
    // in it — and blow away focus in the notes box.
    var block = document.querySelector('[data-comp-block="' + CSS.escape(key) + '"]');
    if (block) block.innerHTML = OBS.ui.componentsHtml(horse);

    Object.keys(vals).forEach(function (kind) {
      var v = vals[kind];
      var range = document.querySelector('[data-' + kind + '-range="' + CSS.escape(key) + '"]');
      if (range && document.activeElement !== range) range.value = v === null ? 5 : v;
      var out = document.querySelector('[data-' + kind + '-out="' + CSS.escape(key) + '"]');
      if (out) out.textContent = v === null ? '—' : v.toFixed(1);
    });

    state.stale = true;
    $('btnRerank').hidden = false;
    renderTabs();
    updateCountLine();
  }

  function renderTabs() {
    var onList = state.tab === 'list';
    var lists = OBS.store.allLists();

    document.querySelector('#tabs [data-tab="catalog"]').classList.toggle('is-on', !onList);
    OBS.ui.renderListTabs($('listTabs'), lists, state.saleId, state.listId, onList);
    OBS.ui.renderStarTarget($('starTarget'), lists, OBS.store.activeListId());

    // On a list tab the tab itself says where the star goes, so the picker is
    // noise; on the catalog it's the only thing that does.
    $('starTargetWrap').hidden = onList;
    $('listTools').hidden = !onList;
    $('btnDeleteList').hidden = lists.length <= 1;
  }

  function renderPresets() {
    OBS.ui.renderPresets($('presetSelect'), OBS.store.allPresets(), state.presetId);
  }

  /**
   * A filter saved against another catalogue can name sires this sale doesn't
   * have, which otherwise just produces an empty table with no explanation.
   */
  function showPresetCoverage(p) {
    var note = $('presetNote');
    var cov = OBS.filters.coverage(state.filters, state.facets);
    var missing = cov.filter(function (c) { return c.found < c.selected; });
    if (!missing.length) {
      note.textContent = 'Loaded "' + p.name + '".';
      return;
    }
    note.textContent = 'Loaded "' + p.name + '" — ' + missing.map(function (c) {
      return (c.selected - c.found) + ' of ' + c.selected + ' ' + c.label +
             (c.selected === 1 ? '' : 's') + ' not in this sale';
    }).join('; ') + '.';
  }

  /** The line above the table: how many hips, and how much of your own work is in. */
  function updateCountLine() {
    var sale = state.loaded[state.saleId] && state.loaded[state.saleId].sale;
    if (!sale) { $('resultCount').textContent = 'No sale loaded'; return; }

    var bits = [];
    var watched = OBS.store.watchedCount(state.saleId);
    var graded = OBS.store.gradedCount(state.saleId);
    var pedRated = OBS.store.pedRatedCount(state.saleId);
    if (watched) bits.push(watched + ' watched');
    if (graded) bits.push(graded + ' graded');
    if (pedRated) bits.push(pedRated + ' ped');

    var n = state.view.length.toLocaleString();
    var head;
    if (state.tab === 'list') {
      var l = OBS.store.getList(state.listId);
      head = n + ' hip' + (state.view.length === 1 ? '' : 's') +
             ' on ' + (l ? l.name : 'this list');
    } else {
      head = n + ' of ' + state.horses.length.toLocaleString() + ' hips';
    }
    $('resultCount').textContent =
      head + ' · ' + sale.label + (bits.length ? ' · ' + bits.join(' · ') : '');
  }

  /* --------------------------------------------------------------- pickers */

  var PICKERS = [
    { el: 'pickSires', id: 'sires', title: 'Sire', facet: 'sires' },
    { el: 'pickDamSires', id: 'damSires', title: 'Broodmare sire', facet: 'damSires' },
    { el: 'pickSexes', id: 'sexes', title: 'Sex', facet: 'sexes' },
    { el: 'pickConsignors', id: 'consignors', title: 'Consignor', facet: 'consignors' },
    { el: 'pickAreas', id: 'areas', title: 'Foaled in', facet: 'areas' },
    { el: 'pickColors', id: 'colors', title: 'Colour', facet: 'colors' },
    { el: 'pickSessions', id: 'sessions', title: 'Session', facet: 'sessions' }
  ];

  function renderPickers() {
    if (!state.facets) return;
    PICKERS.forEach(function (p) {
      var el = $(p.el);
      var ps = state.pickerState[p.id] || (state.pickerState[p.id] = { open: false, query: '' });
      el.classList.toggle('is-open', ps.open);
      el.dataset.query = ps.query;
      OBS.ui.renderPicker(el, {
        id: p.id,
        title: p.title,
        items: state.facets[p.facet],
        selected: state.filters[p.id]
      });
    });
  }

  /* ---------------------------------------------------------------- events */

  function wire() {
    /* -- sale selection ---------------------------------------------------- */
    var sel = $('saleSelect');
    sel.innerHTML = OBS.data.SALES.map(function (s) {
      return '<option value="' + s.id + '">' + U.escapeHtml(s.label) + '</option>';
    }).join('');
    sel.value = '149';
    $('apiHint').textContent = OBS.data.saleUrl(149);
    sel.addEventListener('change', function () {
      $('apiHint').textContent = OBS.data.saleUrl(sel.value);
      if (state.loaded[sel.value]) { setCurrentSale(sel.value); loadReferenceSales(defaultRefSales(sel.value)); }
    });
    $('btnLoad').addEventListener('click', handleLoadClick);

    /* -- weights ----------------------------------------------------------- */
    $('weights').addEventListener('input', function (e) {
      var id = e.target.dataset.weight;
      if (!id) return;
      state.settings.weights[id] = Number(e.target.value);
      saveSettings();
      renderWeights();
      recompute();
    });
    $('btnResetWeights').addEventListener('click', function () {
      state.settings = OBS.scoring.cloneDefaults();
      saveSettings();
      syncOptionInputs();
      renderWeights();
      recompute();
    });

    /* -- scoring options --------------------------------------------------- */
    $('optUnrated').addEventListener('change', function () {
      state.settings.options.unratedManual = this.value;
      saveSettings(); recompute();
    });

    /* -- filters ----------------------------------------------------------- */
    var reFilter = U.debounce(recompute, 180);

    $('fq').addEventListener('input', function () { state.filters.q = this.value; reFilter(); });
    $('fDistance').addEventListener('change', function () { state.filters.distance = this.value; recompute(); });
    $('fRequireBreeze').addEventListener('change', function () { state.filters.requireBreeze = this.checked; recompute(); });

    $('fBreezeMin').addEventListener('input', function () {
      state.filters.breezeMin = U.parseBreeze(this.value); reFilter();
    });
    $('fBreezeMax').addEventListener('input', function () {
      state.filters.breezeMax = U.parseBreeze(this.value); reFilter();
    });
    $('fBreezePct').addEventListener('input', function () {
      var v = Number(this.value);
      state.filters.breezePctMax = v >= 100 ? null : v;
      $('fBreezePctVal').textContent = v >= 100 ? 'any' : v + '%';
      reFilter();
    });

    $('fConfMin').addEventListener('input', function () {
      var v = Number(this.value);
      state.filters.confMin = v <= 0 ? null : v;
      $('fConfMinVal').textContent = v <= 0 ? 'any' : v.toFixed(1);
      reFilter();
    });
    $('fConfState').addEventListener('change', function () { state.filters.confState = this.value; recompute(); });

    $('fBvMin').addEventListener('input', function () {
      var v = Number(this.value);
      state.filters.bvMin = v <= 0 ? null : v;
      $('fBvMinVal').textContent = v <= 0 ? 'any' : v.toFixed(1);
      reFilter();
    });
    $('fBvState').addEventListener('change', function () { state.filters.bvState = this.value; recompute(); });

    $('fPedMin').addEventListener('input', function () {
      var v = Number(this.value);
      state.filters.pedMin = v <= 0 ? null : v;
      $('fPedMinVal').textContent = v <= 0 ? 'any' : v.toFixed(1);
      reFilter();
    });
    $('fPedState').addEventListener('change', function () { state.filters.pedState = this.value; recompute(); });

    $('fFoalFrom').addEventListener('change', function () { state.filters.foalFrom = U.parseDate(this.value); recompute(); });
    $('fFoalTo').addEventListener('change', function () { state.filters.foalTo = U.parseDate(this.value); recompute(); });

    document.querySelectorAll('[data-foal]').forEach(function (b) {
      b.addEventListener('click', function () {
        var year = inferFoalYear();
        var mode = this.dataset.foal;
        if (mode === 'clear') { state.filters.foalFrom = state.filters.foalTo = null; }
        else if (mode === 'jan-feb') {
          state.filters.foalFrom = new Date(year, 0, 1);
          state.filters.foalTo = new Date(year, 1, 29);
        } else if (mode === 'q1') {
          state.filters.foalFrom = null;
          state.filters.foalTo = new Date(year, 2, 31);
        }
        $('fFoalFrom').value = U.toInputDate(state.filters.foalFrom);
        $('fFoalTo').value = U.toInputDate(state.filters.foalTo);
        recompute();
      });
    });

    ['fVideo:needsVideo', 'fWalk:needsWalkVideo', 'fPhoto:needsPhoto', 'fOuts:includeOuts']
      .forEach(function (pair) {
        var p = pair.split(':');
        $(p[0]).addEventListener('change', function () { state.filters[p[1]] = this.checked; recompute(); });
      });

    $('fResult').addEventListener('change', function () { state.filters.result = this.value; recompute(); });
    $('fPriceMin').addEventListener('input', function () {
      state.filters.priceMin = this.value === '' ? null : Number(this.value); reFilter();
    });
    $('fPriceMax').addEventListener('input', function () {
      state.filters.priceMax = this.value === '' ? null : Number(this.value); reFilter();
    });
    $('fScoreMin').addEventListener('input', function () {
      var v = Number(this.value);
      state.filters.scoreMin = v <= 0 ? null : v;
      $('fScoreMinVal').textContent = v <= 0 ? 'any' : v;
      reFilter();
    });

    $('btnClearFilters').addEventListener('click', function () {
      state.filters = OBS.filters.blank();
      state.presetId = '';
      renderPresets();
      $('presetNote').textContent = '';
      syncFilterInputs();
      renderPickers();
      recompute();
    });

    $('activeChips').addEventListener('click', function (e) {
      var id = e.target.dataset && e.target.dataset.clearFilter;
      if (!id) return;
      var fresh = OBS.filters.blank();
      state.filters[id] = fresh[id];
      syncFilterInputs();
      renderPickers();
      recompute();
    });

    /* -- pickers (delegated) ----------------------------------------------- */
    document.querySelectorAll('.picker').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var id = el.dataset.picker;
        var ps = state.pickerState[id];
        if (e.target.closest('.picker-head')) {
          ps.open = !ps.open;
          renderPickers();
          return;
        }
        if (e.target.dataset && e.target.dataset.pickAction === 'none') {
          state.filters[id] = [];
          renderPickers();
          recompute();
        }
      });
      el.addEventListener('change', function (e) {
        var id = el.dataset.picker;
        if (e.target.type !== 'checkbox') return;
        var list = state.filters[id];
        var v = e.target.value;
        var i = list.indexOf(v);
        if (e.target.checked && i === -1) list.push(v);
        if (!e.target.checked && i !== -1) list.splice(i, 1);
        /* Deliberately NOT renderPickers() — rebuilding the picker here would
           destroy its scroller, so ticking the tenth sire in a long list threw
           you back to the top before you could tick the eleventh. Only the
           header badge needs to move; the table catches up on its own. */
        OBS.ui.syncPickerCount(el, list.length);
        recompute();
      });
      el.addEventListener('input', U.debounce(function (e) {
        if (!e.target.classList.contains('picker-search')) return;
        var id = el.dataset.picker;
        state.pickerState[id].query = e.target.value;
        renderPickers();
        var again = el.querySelector('.picker-search');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 160));
    });

    /* -- table ------------------------------------------------------------- */
    $('rows').addEventListener('click', function (e) {
      /* The row star acts on whichever list is currently the star target —
         on a list tab that's the tab you're looking at, otherwise the one
         chosen in the toolbar. */
      var flag = e.target.closest('[data-flag]');
      if (flag) {
        e.stopPropagation();
        var target = state.tab === 'list' ? state.listId : OBS.store.activeListId();
        OBS.store.toggleOnList(flag.dataset.flag, target);
        // On a list tab, un-starring means "get this off my list" — so act on
        // it now rather than waiting for a re-rank.
        if (state.tab === 'list') recompute();
        else { refreshHorse(flag.dataset.flag); syncListChips(flag.dataset.flag); }
        return;
      }
      var chip = e.target.closest('[data-toggle-list]');
      if (chip) {
        e.stopPropagation();
        OBS.store.toggleOnList(chip.dataset.key, chip.dataset.toggleList);
        if (state.tab === 'list' && chip.dataset.toggleList === state.listId) recompute();
        else { refreshHorse(chip.dataset.key); syncListChips(chip.dataset.key); }
        return;
      }
      var tab = e.target.closest('[data-media-tab]');
      if (tab) {
        e.stopPropagation();
        setMediaTab(tab.dataset.mediaKey, tab.dataset.mediaTab);
        return;
      }
      // Clicking a control in the row means using that control — never
      // expanding the horse. Only chrome outside them toggles the detail.
      if (e.target.closest('select, input, textarea, a, label')) return;
      var row = e.target.closest('tr.hrow');
      if (row) openDetail(row.dataset.key);
    });

    $('rows').addEventListener('change', function (e) {
      var d = e.target.dataset || {};
      if (d.vet) {
        OBS.store.setVetStatus(d.vet, e.target.value);
        applyVetStatus(d.vet);
        return;
      }
      if (d.bv) {
        OBS.store.setBreezeVisual(d.bv, e.target.value === '' ? null : Number(e.target.value));
        refreshHorse(d.bv);
        return;
      }
      if (d.ped) {
        OBS.store.setPedigree(d.ped, e.target.value === '' ? null : Number(e.target.value));
        refreshHorse(d.ped);
        return;
      }
      if (!d.conf) return;
      OBS.store.setConformation(d.conf, e.target.value === '' ? null : Number(e.target.value));
      refreshHorse(d.conf);
    });

    $('tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]');
      if (!t) return;
      var toList = t.dataset.tab === 'list';
      if (toList && t.dataset.list === state.listId && state.tab === 'list') return;
      if (!toList && state.tab === 'catalog') return;
      state.tab = t.dataset.tab;
      if (toList) {
        state.listId = t.dataset.list;
        // Opening a list also makes it the star target — starring from the
        // catalog afterwards puts horses where you were just working.
        OBS.store.setActiveList(state.listId);
      }
      state.openKey = null;
      recompute();
    });

    $('btnNewList').addEventListener('click', function () {
      var name = prompt('Name the new short list:', '');
      if (name === null) return;
      var res = OBS.store.createList(name);
      OBS.store.setActiveList(res.list.id);
      state.tab = 'list';
      state.listId = res.list.id;
      state.openKey = null;
      recompute();
      if (res.existed) status('"' + res.list.name + '" already exists — opened it instead.', 'done');
    });

    $('btnRenameList').addEventListener('click', function () {
      var l = OBS.store.getList(state.listId);
      if (!l) return;
      var name = prompt('Rename "' + l.name + '" to:', l.name);
      if (name === null) return;
      if (!OBS.store.renameList(state.listId, name)) {
        status('That name is already taken (or empty).', 'error');
        return;
      }
      renderTabs();
      updateCountLine();   // the count line names the list too
    });

    $('btnDeleteList').addEventListener('click', function () {
      var l = OBS.store.getList(state.listId);
      if (!l) return;
      var n = OBS.store.shortlistCount(state.saleId, l.id);
      if (!confirm('Delete "' + l.name + '"?' +
          (n ? '\n\n' + n + ' horse' + (n === 1 ? '' : 's') + ' from this sale will come off it. ' +
               'Your grades and notes are kept.' : ''))) return;
      if (!OBS.store.deleteList(state.listId)) return;
      state.listId = OBS.store.activeListId();
      state.tab = 'catalog';
      state.openKey = null;
      recompute();
    });

    $('starTarget').addEventListener('change', function () {
      OBS.store.setActiveList(this.value);
      renderTabs();
    });

    /* -- saved filters ----------------------------------------------------- */
    $('presetSelect').addEventListener('change', function () {
      var id = this.value;
      state.presetId = id;
      if (!id) { $('presetNote').textContent = ''; return; }
      var p = OBS.store.getPreset(id);
      if (!p) return;
      state.filters = OBS.filters.deserialize(p.filters);
      syncFilterInputs();
      renderPickers();
      recompute();
      showPresetCoverage(p);
    });

    $('btnPresetSave').addEventListener('click', function () {
      var current = state.presetId ? OBS.store.getPreset(state.presetId) : null;
      var name = prompt('Save these filters as:', current ? current.name : '');
      if (name === null) return;
      try {
        var rec = OBS.store.savePreset(name, OBS.filters.serialize(state.filters));
        state.presetId = rec.id;
        renderPresets();
        $('presetNote').textContent = 'Saved "' + rec.name + '".';
      } catch (err) { status(err.message, 'error'); }
    });

    $('btnPresetDelete').addEventListener('click', function () {
      var p = state.presetId && OBS.store.getPreset(state.presetId);
      if (!p) { status('Pick a saved filter first.', 'error'); return; }
      if (!confirm('Delete the saved filter "' + p.name + '"?')) return;
      OBS.store.deletePreset(p.id);
      state.presetId = '';
      renderPresets();
      $('presetNote').textContent = 'Deleted "' + p.name + '".';
    });

    $('btnPresetExport').addEventListener('click', function () {
      var all = OBS.store.allPresets();
      if (!all.length) { status('No saved filters to export.', 'error'); return; }
      U.download('obs-filters-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify({ _format: 'obs-model-filters', _version: 1,
                         exportedAt: new Date().toISOString(), filterPresets: all }, null, 2),
        'application/json');
    });
    $('btnPresetImport').addEventListener('click', function () { pickFile('filters'); });

    // Detail-panel controls live in the same tbody.
    $('rows').addEventListener('input', function (e) {
      var d = e.target.dataset || {};
      var kind = d.bvRange ? 'bv' : d.confRange ? 'conf' : d.pedRange ? 'ped' : null;
      if (kind) {
        var k = d.bvRange || d.confRange || d.pedRange;
        var v = Number(e.target.value);
        RATINGS[kind].set(k, v);
        var out = document.querySelector('[data-' + kind + '-out="' + CSS.escape(k) + '"]');
        if (out) out.textContent = v.toFixed(1);
        var input = document.querySelector('[data-' + kind + '="' + CSS.escape(k) + '"]');
        if (input) { input.value = e.target.value; input.classList.add('is-set'); }
        scheduleScoreRefresh(k);
      } else if (d.note) {
        scheduleNoteSave(d.note, e.target.value);
      }
    });

    $('rows').addEventListener('click', function (e) {
      var d = e.target.dataset || {};
      var kind = d.bvClear ? 'bv' : d.confClear ? 'conf' : d.pedClear ? 'ped' : null;
      if (!kind) return;
      e.stopPropagation();
      var key = d.bvClear || d.confClear || d.pedClear;
      RATINGS[kind].set(key, null);
      refreshHorse(key);
    });

    $('sortBy').addEventListener('change', function () {
      state.sortBy = this.value;
      recompute();
    });
    $('btnRerank').addEventListener('click', function () { recompute(); });

    /* -- sire book --------------------------------------------------------- */
    $('btnSireBook').addEventListener('click', openSireBook);
    $('btnCloseSire').addEventListener('click', function () { $('sireModal').hidden = true; });
    $('sireModal').addEventListener('click', function (e) {
      if (e.target === this) this.hidden = true;
    });
    $('sireSearch').addEventListener('input', U.debounce(drawSireRows, 150));
    $('sireNeedsOnly').addEventListener('change', drawSireRows);
    $('sireRows').addEventListener('change', function (e) {
      var key = e.target.dataset && e.target.dataset.sire;
      if (!key) return;
      OBS.store.setSireOverride(key, e.target.value === '' ? null : Number(e.target.value));
      // Reference only now — but the badge beside each sire and the detail
      // panel both show it, so the table still needs repainting.
      recompute();
      drawSireRows();
    });
    $('btnImportSires').addEventListener('click', function () { pickFile('sires'); });
    $('btnHowSires').addEventListener('click', function () {
      var el = $('bhHelp');
      el.hidden = !el.hidden;
      if (!el.hidden) {
        el.innerHTML =
          '<b>BloodHorse blocks automated access</b> (no CORS headers, plus bot protection), so ' +
          'the model can\'t fetch these itself. You pull them from your own browser instead:' +
          '<ol style="margin:6px 0 0 16px;padding:0">' +
          '<li>Open <a href="https://www.bloodhorse.com/horse-racing/thoroughbred-breeding/sire-lists" ' +
              'target="_blank" rel="noopener">BloodHorse sire lists</a> and choose the Racing Year and List Type.</li>' +
          '<li>Press F12 → Console.</li>' +
          '<li>Paste in the contents of <code>bloodhorse-extract.js</code> (in this project folder) and hit Enter. ' +
              'A .json file downloads.</li>' +
          '<li>Come back here and hit <b>Import sire list</b>.</li>' +
          '</ol>' +
          '<p style="margin:6px 0 0">Worth importing: <b>Sires of Two-Year-Olds</b> and ' +
          '<b>First-Crop Sires</b> for the freshmen, plus <b>Leading Sires</b> as a catch-all.</p>';
      }
    });
    $('bhLists').addEventListener('click', function (e) {
      var rm = e.target.closest('[data-bh-remove]');
      if (!rm) return;
      OBS.store.removeSireList(rm.dataset.bhRemove);
      rebuildPedigree(); recompute(); renderBhLists(); drawSireRows();
      $('sireNote').textContent = 'Sire list removed.';
    });

    $('refSales').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-ref]');
      if (!chip) return;
      var id = chip.dataset.ref;
      if (id === state.saleId) return;
      var i = state.refSaleIds.indexOf(id);
      if (i === -1) loadReferenceSales(state.refSaleIds.concat([id])).then(drawSireRows);
      else {
        state.refSaleIds.splice(i, 1);
        rebuildPedigree(); recompute(); renderRefSales(); drawSireRows();
      }
    });

    /* -- exports ----------------------------------------------------------- */
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('btnExportWork').addEventListener('click', function () {
      U.download('obs-model-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(OBS.store.exportAll(), null, 2), 'application/json');
    });
    $('btnImportWork').addEventListener('click', function () { pickFile('work'); });
    $('btnImportSale').addEventListener('click', function () { pickFile('sale'); });
    $('btnImportTop').addEventListener('click', function () { pickFile('sale'); });

    $('fileInput').addEventListener('change', function () {
      var file = this.files[0];
      var mode = this.dataset.mode;
      this.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          if (mode === 'work') {
            OBS.store.importAll(JSON.parse(reader.result));
            status('Restored your grades, lists and saved filters.', 'done');
            state.listId = OBS.store.activeListId();
            renderPresets();
            recompute();
          } else if (mode === 'filters') {
            var payload = JSON.parse(reader.result);
            var incoming = Array.isArray(payload) ? payload : payload.filterPresets;
            if (!Array.isArray(incoming)) {
              throw new Error('Not a saved-filters file. Use "export filters" to make one.');
            }
            var r = OBS.store.mergePresets(incoming);
            renderPresets();
            status('Imported filters — ' + r.added + ' new, ' + r.updated + ' updated.', 'done');
          } else if (mode === 'sires') {
            var list = OBS.bloodhorse.parseFile(reader.result);
            OBS.store.saveSireList(list);
            rebuildPedigree();
            recompute();
            renderBhLists();
            drawSireRows();
            var matched = 0, counts = saleSireCounts();
            Object.keys(counts).forEach(function (k) {
              if (OBS.bloodhorse.lookup(state.bhIndex, k)) matched++;
            });
            status('Imported ' + list.rows.length + ' sires from ' + list.listLabel + ' ' +
                   list.year + ' — ' + matched + ' of ' + Object.keys(counts).length +
                   ' sires in this sale now have racing data.', 'done');
            $('sireNote').textContent = 'Imported ' + list.listLabel + ' ' + list.year +
              ' (' + list.rows.length + ' sires).';
          } else {
            var res = OBS.data.parseFile(reader.result);
            state.loaded[res.sale.id] = res;
            $('saleSelect').value = res.sale.id;
            setCurrentSale(res.sale.id);
            status('Imported ' + res.sale.label + ' — ' + res.horses.length + ' hips.', 'done');
          }
        } catch (err) { status(err.message, 'error'); }
      };
      reader.readAsText(file);
    });

    /* -- theme ------------------------------------------------------------- */
    $('btnTheme').addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      state.settings.options.theme = next;
      saveSettings();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('sireModal').hidden) $('sireModal').hidden = true;
    });
  }

  /* The three manual ratings, keyed by the data-attribute suffix they use. */
  var RATINGS = {
    bv:   { get: OBS.store.breezeVisual, set: OBS.store.setBreezeVisual },
    conf: { get: OBS.store.conformation, set: OBS.store.setConformation },
    ped:  { get: OBS.store.pedigree,     set: OBS.store.setPedigree }
  };

  var noteTimer = {};
  function scheduleNoteSave(key, text) {
    clearTimeout(noteTimer[key]);
    noteTimer[key] = setTimeout(function () { OBS.store.setNoteText(key, text); }, 400);
  }
  var scoreTimer = {};
  function scheduleScoreRefresh(key) {
    clearTimeout(scoreTimer[key]);
    scoreTimer[key] = setTimeout(function () { refreshHorse(key); }, 250);
  }

  function inferFoalYear() {
    var sale = state.loaded[state.saleId] && state.loaded[state.saleId].sale;
    var y = sale && sale.year ? sale.year - 2 : new Date().getFullYear() - 2;
    var h = state.horses.filter(function (x) { return x.foalDate; })[0];
    return h ? h.foalDate.getFullYear() : y;
  }

  /* ----------------------------------------------------------- sire modal */

  function saleSireCounts() {
    var m = {};
    state.horses.forEach(function (h) { if (h.sireRaw) m[h.sireRaw] = (m[h.sireRaw] || 0) + 1; });
    return m;
  }

  function drawSireRows() {
    OBS.ui.renderSireRows($('sireRows'), state.bhIndex, state.sireIndex, saleSireCounts(),
      $('sireSearch').value, $('sireNeedsOnly').checked);
  }

  /** How much of the sale has no racing data behind its Pedigree score. */
  function sireCoverage() {
    var counts = saleSireCounts();
    var thin = 0, thinSires = 0, total = 0;
    Object.keys(counts).forEach(function (k) {
      total += counts[k];
      if (OBS.ui.needsRating(k, OBS.bloodhorse.lookup(state.bhIndex, k), counts)) {
        thin += counts[k]; thinSires++;
      }
    });
    return { total: total, thin: thin, thinSires: thinSires,
             pct: total ? Math.round(thin / total * 100) : 0 };
  }

  function renderBhLists() {
    var el = $('bhLists');
    if (!el) return;
    var lists = state.bhIndex.lists;
    if (!lists.length) {
      el.innerHTML = '<span class="dim" style="font-size:11px">None imported — Pedigree is scoring ' +
        'every sire at the neutral default. Import at least one list.</span>';
      return;
    }
    el.innerHTML = lists.map(function (l) {
      return '<span class="ref-sale' + (l.ignored ? ' is-ignored' : ' is-on') + '" ' +
        'title="' + U.escapeHtml(l.ignored
          ? 'Not used — sires-of-2YOs/3YOs lists are excluded by design'
          : 'Pooled into the "' + l.cohortLabel + '" cohort') + '">' +
        U.escapeHtml(l.listLabel) + ' ' + U.escapeHtml(l.year) +
        ' <span class="dim">' + (l.ignored ? 'not used' : l.count) + '</span>' +
        '<button class="ref-x" data-bh-remove="' + U.escapeHtml(l.id) + '" title="Remove">✕</button>' +
      '</span>';
    }).join('');

    // What each cohort ended up pooling, so the sample size is never a mystery.
    var cohorts = state.bhIndex.cohorts || [];
    if (cohorts.length) {
      el.insertAdjacentHTML('beforeend',
        '<div class="panel-note" style="width:100%;margin-top:6px">' +
        cohorts.map(function (c) {
          return '<b>' + U.escapeHtml(c.label) + '</b>: ' + c.sires + ' sires pooled over ' +
            c.years.join(' + ');
        }).join(' · ') + '</div>');
    }
  }

  function openSireBookNote() {
    var c = sireCoverage();
    if (!state.bhIndex.count) {
      $('sireNote').textContent = 'No sire list imported yet. Pedigree is scoring every sire at ' +
        'the neutral default until you add one — use "Import sire list" below.';
      return;
    }
    var multiYear = (state.bhIndex.cohorts || []).filter(function (x) { return x.years.length > 1; });
    $('sireNote').textContent =
      'Pedigree is scored from BloodHorse racing data — % black-type winners, earnings per ' +
      'runner and graded winners, shrunk for small books. Sires are ranked only within their own ' +
      'cohort; first-crop horses are never mixed in with established sires. ' +
      (multiYear.length
        ? 'Years are pooled for ' + multiYear.map(function (x) { return x.label.toLowerCase(); }).join(' and ') +
          ', giving a bigger sample than any single season. '
        : 'Import a second year of the same list to pool it and steady the ranking. ') +
      (c.thin ? c.thinSires + ' sires covering ' + c.thin + ' hips in this sale have no data — ' +
        'tick "Needs a rating" to work through them. ' : '') +
      'Auction prices are shown on the right for budgeting but never feed the score.';
  }

  function openSireBook() {
    $('sireModal').hidden = false;
    openSireBookNote();
    renderRefSales();
    renderBhLists();
    drawSireRows();
  }

  /* --------------------------------------------------------------- exports */

  function exportCsv() {
    if (!state.view.length) return;
    var head = ['Rank', 'Score', 'Hip', 'Sire', 'Dam', 'BM sire', 'Breeze', 'Dist', 'Foaled',
      'Sex', 'Colour', 'Bred', 'Consignor', 'Barn', 'Session',
      'Breeze visual', 'Conformation', 'Pedigree', 'Sire book', 'Short lists', 'Vet', 'Notes',
      'Breeze visual score', 'Conf score', 'Pedigree score', 'Coverage %',
      'Status', 'Result', 'Price', 'Video', 'Catalog page'];

    var rows = [head];
    state.view.forEach(function (h, i) {
      var s = h._score;
      var by = {};
      s.components.forEach(function (c) { by[c.id] = c.value === null ? '' : c.value.toFixed(1); });
      var note = OBS.store.getNote(h.key) || {};
      rows.push([
        i + 1,
        s.total === null ? '' : s.total.toFixed(1),
        h.hip, h.sire, h.dam, h.damSire,
        h.breezeSec === null ? '' : U.formatBreeze(h.breezeSec, { noColon: true }),
        h.breezeSec === null ? '' : h.distLabel,
        h.foalDate ? U.formatDate(h.foalDate) : '',
        h.sexLabel, h.colorLabel, h.foalArea, h.consignorSort, h.barn, h.session,
        OBS.store.breezeVisual(h.key) === null ? '' : OBS.store.breezeVisual(h.key),
        OBS.store.conformation(h.key) === null ? '' : OBS.store.conformation(h.key),
        OBS.store.pedigree(h.key) === null ? '' : OBS.store.pedigree(h.key),
        (function () { var s = OBS.sires.lookup(state.ctx, h.sireRaw); return s && s.value !== null ? s.value : ''; })(),
        OBS.store.listNamesFor(h.key).join('; '),
        OBS.store.vetStatus(h.key) === 'none' ? '' : OBS.store.VET_LABELS[OBS.store.vetStatus(h.key)],
        note.notes || '',
        by.breezeVisual, by.conformation, by.pedigree,
        Math.round(s.coverage * 100),
        h.status === 'out' ? 'OUT' : 'IN',
        h.sold ? 'SOLD' : (h.rna ? 'RNA' : ''),
        h.sold ? h.price : (h.rna ? h.bidTo : ''),
        h.videoLink, h.pedigreeLink
      ]);
    });

    var sale = state.loaded[state.saleId].sale;
    U.download('obs-' + sale.code + '-shortlist.csv', U.toCsv(rows), 'text/csv');
  }

  function pickFile(mode) {
    var el = $('fileInput');
    el.dataset.mode = mode;
    el.click();
  }

  /* ------------------------------------------------------------------ sync */

  function saveSettings() { OBS.store.setSettings(state.settings); }

  function syncOptionInputs() {
    var o = state.settings.options;
    $('optUnrated').value = o.unratedManual;
  }

  function syncFilterInputs() {
    var f = state.filters;
    $('fq').value = f.q;
    $('fDistance').value = f.distance;
    $('fRequireBreeze').checked = f.requireBreeze;
    $('fBreezeMin').value = f.breezeMin === null ? '' : U.formatBreeze(f.breezeMin, { noColon: true }).replace(' ', '.').replace('/5', '');
    $('fBreezeMax').value = f.breezeMax === null ? '' : U.formatBreeze(f.breezeMax, { noColon: true }).replace(' ', '.').replace('/5', '');
    $('fBreezePct').value = f.breezePctMax === null ? 100 : f.breezePctMax;
    $('fBreezePctVal').textContent = f.breezePctMax === null ? 'any' : f.breezePctMax + '%';
    $('fConfMin').value = f.confMin === null ? 0 : f.confMin;
    $('fConfMinVal').textContent = f.confMin === null ? 'any' : f.confMin.toFixed(1);
    $('fConfState').value = f.confState;
    $('fBvMin').value = f.bvMin === null ? 0 : f.bvMin;
    $('fBvMinVal').textContent = f.bvMin === null ? 'any' : f.bvMin.toFixed(1);
    $('fBvState').value = f.bvState;
    $('fPedMin').value = f.pedMin === null ? 0 : f.pedMin;
    $('fPedMinVal').textContent = f.pedMin === null ? 'any' : f.pedMin.toFixed(1);
    $('fPedState').value = f.pedState;
    $('fFoalFrom').value = U.toInputDate(f.foalFrom);
    $('fFoalTo').value = U.toInputDate(f.foalTo);
    $('fVideo').checked = f.needsVideo;
    $('fWalk').checked = f.needsWalkVideo;
    $('fPhoto').checked = f.needsPhoto;
    $('fOuts').checked = f.includeOuts;
    $('fResult').value = f.result;
    $('fPriceMin').value = f.priceMin === null ? '' : f.priceMin;
    $('fPriceMax').value = f.priceMax === null ? '' : f.priceMax;
    $('fScoreMin').value = f.scoreMin === null ? 0 : f.scoreMin;
    $('fScoreMinVal').textContent = f.scoreMin === null ? 'any' : f.scoreMin;
  }

  /* --------------------------------------------------------------- sharing */
  /*
   * The shared database is polled every few seconds, which means the table can
   * now be rebuilt at a moment you did not choose. Everything in this section
   * exists to make that invisible: a rebuild must never take an input away
   * mid-keystroke, and it must never restart a walk video you are watching.
   */

  /* Which control had focus, and where the caret was inside it. The grade
     inputs live in the table rows, so a repaint replaces the very element you
     are typing into — without this, a poll landing at the wrong moment eats a
     digit. */
  var FOCUS_ATTRS = ['conf', 'bv', 'ped', 'note', 'vet', 'sireRating'];

  function focusToken() {
    var el = document.activeElement;
    if (!el || !el.dataset) return null;
    for (var i = 0; i < FOCUS_ATTRS.length; i++) {
      var name = FOCUS_ATTRS[i];
      if (el.dataset[name] === undefined) continue;
      var t = { attr: 'data-' + name.replace(/[A-Z]/g, function (c) {
                 return '-' + c.toLowerCase(); }),
                val: el.dataset[name], start: null, end: null };
      try { t.start = el.selectionStart; t.end = el.selectionEnd; } catch (e) {}
      return t;
    }
    return null;
  }

  function restoreFocus(t) {
    if (!t) return;
    var el = document.querySelector('[' + t.attr + '="' + CSS.escape(t.val) + '"]');
    if (!el) return;
    el.focus();
    // Number inputs throw on setSelectionRange in some browsers; the focus is
    // the part that matters, the caret is a bonus.
    try { if (t.start !== null) el.setSelectionRange(t.start, t.end); } catch (e) {}
  }

  /**
   * A poll came back with someone else's work in it.
   *
   * This takes the same route the app already takes when *you* grade a horse:
   * patch the affected rows in place with `refreshHorse` and mark the ranking
   * stale, rather than rebuilding the table. Rebuilding would tear down the
   * media pane of an open horse — restarting a walk video someone is part-way
   * through — and replace the very input they are typing into. A colleague's
   * grade arriving is no more entitled to do that than your own is.
   *
   * The order therefore does not resort itself under your hands; the existing
   * **Re-rank** button appears, exactly as it does after you grade something.
   */
  function applyRemoteChanges() {
    var pending = OBS.sync.pendingIds();

    // A note you are part-way through typing has not reached the store yet
    // (it is debounced by 400ms), so it has no queue entry to protect it.
    // Treat the focused field as pending in its own right.
    var focused = document.activeElement;
    if (focused && focused.dataset && focused.dataset.note) {
      var k = 'rating:' + focused.dataset.note;
      // Field-scoped, so a grade someone else set on this same horse still
      // lands while you type. An entry already queued outranks this and stays.
      if (!pending[k]) pending[k] = { notes: true };
    }

    var res = OBS.store.applyRemote(OBS.sync.data(), pending);
    if (!res.touched) return;

    // The sire book feeds every score, so a list imported by someone else has
    // to be folded into the index before anything is rescored against it.
    if (res.structural) {
      rebuildPedigree();
      state.ctx = OBS.scoring.buildContext(
        state.horses, state.sireIndex, state.damSireIndex, state.settings, state.bhIndex
      );
      state.ctx._hist = state.histCache;
    }

    var token = focusToken();
    Object.keys(res.keys).forEach(refreshHorse);
    if (res.structural) {
      renderTabs();
      renderPresets();
      state.stale = true;
      $('btnRerank').hidden = false;
    }
    updateCountLine();
    restoreFocus(token);
  }

  function renderShare() {
    if (!OBS.sync.configured) return;
    var st = OBS.sync.status();
    var live = (st === 'live' || st === 'offline');

    $('shareLocked').hidden = live;
    $('shareLive').hidden = !live;

    var pill = $('syncPill');
    var pending = OBS.sync.pending();
    var text = { live: 'live', offline: 'offline', locked: 'locked',
                 connecting: '…', off: '' }[st] || '';
    pill.textContent = live && pending ? text + ' · ' + pending : text;
    pill.className = 'sync-pill is-' + st;
    pill.title = {
      live: 'Connected. Changes appear for everyone within a few seconds.',
      offline: 'No connection. You can carry on — your changes are saved here '
             + 'and go up when the signal comes back.',
      locked: 'Enter the access code to join the shared data.',
      connecting: 'Connecting…'
    }[st] || '';

    if (live) {
      // No error detail here. Once you are through the door, "offline" is a
      // normal state at a sale, not a fault to be diagnosed — the setup advice
      // belongs on the unlock screen, where it is actually actionable.
      $('shareStatus').textContent = st === 'offline'
        ? 'Offline — ' + pending + ' change' + (pending === 1 ? '' : 's') +
          ' waiting. They go up when the signal returns.'
        : pending ? 'Saving ' + pending + ' change' + (pending === 1 ? '' : 's') + '…'
                  : 'Up to date.';
    }
  }

  /**
   * The front door.
   *
   * Shown when sharing is configured and this device has never had a code
   * accepted. It is presentation, not protection — an overlay is removable
   * from devtools by anyone who cares to. What actually protects the data is
   * that `sr_read` refuses to return a single row without the code, so getting
   * past this gains you an empty app rather than anyone's shortlist.
   *
   * Critically, it keys off whether a code was ever *accepted here*, not off
   * the live connection. Gating on connectivity would lock someone out of
   * their own morning's grading the moment the signal dropped in a barn, which
   * is precisely when they need it.
   */
  function showGate(show) {
    var gate = $('accessGate');
    if (!gate) return;
    gate.hidden = !show;
    document.body.style.overflow = show ? 'hidden' : '';
    if (show) $('gateCode').focus();
  }

  /**
   * Push this browser's own work up — but only when it has never synced here
   * before.
   *
   * On a genuine first join, whatever was graded offline exists nowhere else,
   * so it is captured before the server's copy lands on top (the queued ops
   * shield those horses from the incoming snapshot). On a *re*-join — coming
   * back after the code was rotated, most obviously — the server has already
   * seen this device's work and may well have moved past it, so re-uploading
   * would quietly roll back whatever changed while it was locked out.
   *
   * Genuinely unsent edits are unaffected either way: they sit in the sync
   * queue and go up on the next flush regardless of which branch runs.
   */
  function contributeIfFirstJoin(res) {
    if (!res || !res.firstJoin) return;
    OBS.store.localOps().forEach(OBS.sync.push);
    OBS.sync.flush();
  }

  function wireGate() {
    var form = $('gateForm');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('gateCode');
      var err = $('gateError');
      var btn = $('gateSubmit');
      err.hidden = true;
      btn.disabled = true;

      OBS.sync.unlock(input.value).then(function (res) {
        input.value = '';
        contributeIfFirstJoin(res);
        applyRemoteChanges();
        renderShare();
        showGate(false);
      }).catch(function (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        input.select();
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  function wireShare() {
    if (!OBS.sync.configured) return;
    $('sharePanel').hidden = false;
    $('shareName').value = OBS.sync.identity();
    wireGate();
    // 'locked' means configured but no code has ever been accepted here.
    showGate(OBS.sync.status() === 'locked');

    OBS.sync.onChange(function (what) {
      if (what === 'data') applyRemoteChanges();
      renderShare();
      // Rotating the code makes the stored one stop working. The next sync
      // clears it and drops back to 'locked', which puts the door back up
      // rather than leaving someone editing into a void.
      if (OBS.sync.status() === 'locked') showGate(true);
    });

    $('btnShareUnlock').addEventListener('click', unlock);
    $('shareCode').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') unlock();
    });

    function unlock() {
      var input = $('shareCode');
      var err = $('shareError');
      err.hidden = true;
      $('btnShareUnlock').disabled = true;

      OBS.sync.unlock(input.value).then(function (res) {
        input.value = '';
        contributeIfFirstJoin(res);
        applyRemoteChanges();
        renderShare();
        showGate(false);
      }).catch(function (e) {
        err.textContent = e.message;
        err.hidden = false;
      }).then(function () {
        $('btnShareUnlock').disabled = false;
      });
    }

    $('shareName').addEventListener('change', function (e) {
      OBS.sync.setIdentity(e.target.value);
    });

    $('btnShareDisconnect').addEventListener('click', function () {
      if (!window.confirm('Sign out of the shared data on this device?\n\n' +
            'You will need the access code again to get back in. Grades already ' +
            'synced are safe — they live in the shared database, not here.')) return;
      OBS.sync.signOut();
      // Reload rather than just re-showing the door: signing out has to leave
      // no trace of the shared work on screen, and the cheapest way to be sure
      // of that is to start the page over.
      window.location.reload();
    });

    OBS.sync.start();
    renderShare();
  }

  /* ------------------------------------------------------------------ init */

  function init() {
    if (state.settings.options.theme) document.documentElement.dataset.theme = state.settings.options.theme;
    wire();
    renderWeights();
    renderPresets();
    renderTabs();
    syncOptionInputs();
    syncFilterInputs();
    $('storeNote').textContent = OBS.store.persistent
      ? 'Grades and notes are saved in this browser. Back them up before a sale.'
      : 'This browser is blocking local storage — your grades will vanish on reload. Back them up.';
    wireShare();
  }

  document.addEventListener('DOMContentLoaded', init);

  /* Exposed so you can poke at the model from the console — e.g.
     OBS.app.state.view.filter(h => h.sold) — and so future tools can hook in. */
  OBS.app = {
    state: state,
    recompute: recompute,
    loadSale: loadSale,
    setCurrentSale: setCurrentSale,
    /* Exposed so a shared-data change can be replayed by hand: stub
       OBS.sync.data() with a snapshot and call this to watch it land. */
    applyRemoteChanges: applyRemoteChanges,
    contributeIfFirstJoin: contributeIfFirstJoin
  };
})();
