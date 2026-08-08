/* State, event wiring, and the load pipeline. */
(function () {
  'use strict';
  var U = FT.util;
  var $ = function (id) { return document.getElementById(id); };

  var DEFAULT_SALE = 'N26A';   // The Saratoga Sale

  var state = {
    loaded: {},            // sale code -> { sale, horses }
    saleId: null,          // sale code of the sale being shopped
    horses: [],
    view: [],
    ctx: null,
    sireIndex: { byKey: {}, list: [] },       // Fasig market — reference only
    damSireIndex: { byKey: {}, list: [] },
    bhIndex: { byName: {}, lists: [], count: 0 },  // BloodHorse — the racing basis
    refSaleIds: [],        // sales pooled into the market index
    facets: null,
    settings: FT.store.getSettings(FT.scoring.cloneDefaults()),
    filters: FT.filters.blank(),
    sortBy: 'score',
    tab: 'catalog',        // 'catalog' | 'list'
    /* The one list the ★ button targets AND the one a list tab shows. Keeping
       these the same thing means clicking a list tab retargets the star, which
       is what you'd expect: you star into the list you're looking at. */
    listId: FT.store.activeListId(),
    presetId: '',          // saved filter currently loaded, '' if none
    openKey: null,
    stale: false,
    pickerState: {},       // pickerId -> { open, query }
    mediaTab: {},          // horse key -> which media tab is open
    histCache: {}          // horse key -> resolved sale history
  };

  // getSettings shallow-merges, so make sure the nested objects are whole.
  state.settings.weights = Object.assign({}, FT.scoring.DEFAULTS.weights, state.settings.weights);
  state.settings.options = Object.assign({}, FT.scoring.DEFAULTS.options, state.settings.options);
  // A stored weight for a component this model doesn't have would sit in the
  // settings forever and skew nothing visibly — drop it on load.
  Object.keys(state.settings.weights).forEach(function (k) {
    if (!FT.scoring.DEFAULTS.weights.hasOwnProperty(k)) delete state.settings.weights[k];
  });

  /* --------------------------------------------------------------- status */

  function status(text, kind) {
    var el = $('loadStatus');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'loadbar' + (kind ? ' is-' + kind : '');
  }

  /* ---------------------------------------------------------------- loading */

  function loadSale(code, opts) {
    opts = opts || {};
    code = String(code);
    if (state.loaded[code]) return Promise.resolve(state.loaded[code]);
    status('Pulling ' + (opts.label || code) + ' from the Fasig-Tipton catalogue…');
    return FT.data.fetchSale(code).then(function (res) {
      state.loaded[code] = res;
      return res;
    });
  }

  function setCurrentSale(code) {
    code = String(code);
    var entry = state.loaded[code];
    if (!entry) return;
    state.saleId = code;
    state.horses = entry.horses;
    state.facets = FT.filters.facets(entry.horses);
    state.openKey = null;
    $('resultsFilters').open = entry.horses.some(function (h) { return h.sold || h.rna; });
    rebuildIndexes();
    recompute();
    renderPickers();
  }

  function handleLoadClick() {
    var code = $('saleSelect').value;
    var label = $('saleSelect').selectedOptions[0].textContent;
    $('btnLoad').disabled = true;

    loadSale(code, { label: label })
      .then(function (res) {
        var outs = res.horses.filter(function (h) { return h.status === 'out'; }).length;
        status('Loaded ' + res.sale.label + ' — ' + res.horses.length + ' hips' +
               (outs ? ', ' + outs + ' already out' : '') + '.', 'done');
        setCurrentSale(code);
        return loadReferenceSales(FT.data.defaultRefSales(code)).then(function () {
          return loadHistorySales(code);
        });
      })
      .catch(function (err) {
        var offline = location.protocol === 'file:';
        status(
          'Could not pull live data: ' + err.message +
          (offline
            ? '  Your browser may be blocking the request from a file:// page — run "node serve.js" and use http://localhost:8098, or use Import JSON.'
            : '  Check your connection, or use Import JSON.'),
          'error'
        );
        $('empty').hidden = false;
      })
      .then(function () { $('btnLoad').disabled = false; });
  }

  /** Pool prior yearling sales into the market index, one at a time, in the
      background. Kentucky October is 1,600 hips, so this is deliberately
      sequential — the sale you're shopping is already usable. */
  function loadReferenceSales(codes) {
    var todo = codes.filter(function (c) { return !state.loaded[c]; });
    state.refSaleIds = codes.slice();
    if (!todo.length) { rebuildIndexes(); recompute(); return Promise.resolve(); }

    var i = 0;
    function next() {
      if (i >= todo.length) {
        status('Market index built from ' + state.refSaleIds.length + ' reference sale' +
               (state.refSaleIds.length === 1 ? '' : 's') + ' + the current one.', 'done');
        rebuildIndexes();
        recompute();
        renderRefSales();
        return;
      }
      var code = todo[i++];
      var meta = FT.data.saleByCode(code);
      status('Building the sire book — reading ' + (meta ? meta.label : code) + '…');
      renderRefSales();
      return FT.data.fetchSale(code)
        .then(function (res) { state.loaded[code] = res; })
        .catch(function () { state.refSaleIds = state.refSaleIds.filter(function (x) { return x !== code; }); })
        .then(next);
    }
    return Promise.resolve(next());
  }

  /**
   * The mixed sales this crop may already have passed through — November as
   * weanlings, Winter Mixed as short yearlings. Pulled quietly so "sale
   * history" can find a prior price without a round trip. These never enter
   * the market index or the sale picker.
   */
  function loadHistorySales(code) {
    var codes = FT.data.historySalesFor(code).filter(function (c) { return !state.loaded[c]; });
    if (!codes.length) return Promise.resolve();

    var i = 0;
    function next() {
      if (i >= codes.length) { status('Sale history ready.', 'done'); return; }
      var c = codes[i++];
      var meta = FT.data.saleByCode(c);
      status('Loading sale history — ' + (meta ? meta.label : c) + '…');
      return FT.data.fetchSale(c)
        .then(function (res) { state.loaded[c] = res; })
        .catch(function () { /* history is a bonus; never block on it */ })
        .then(next);
    }
    return Promise.resolve(next());
  }

  function rebuildIndexes() {
    var pool = [];
    var codes = state.refSaleIds.slice();
    if (state.saleId && codes.indexOf(state.saleId) === -1) codes.push(state.saleId);
    codes.forEach(function (c) {
      if (state.loaded[c]) pool = pool.concat(state.loaded[c].horses);
    });
    state.sireIndex = FT.sires.buildIndex(pool, 'sireRaw');
    state.damSireIndex = FT.sires.buildIndex(pool, 'damSireRaw');
    state.bhIndex = FT.bloodhorse.buildIndex(FT.store.sireLists());
  }

  /* -------------------------------------------------------------- pipeline */

  /* Note there is no "no sale loaded, nothing to do" guard here. Scoring an
     empty list is free, and the chrome this repaints — the tabs, their counts,
     the ★ target — is exactly what changes when you add or delete a short list
     before you've loaded anything. */
  function recompute() {
    state.ctx = FT.scoring.buildContext(
      state.horses, state.sireIndex, state.damSireIndex, state.settings, state.bhIndex
    );
    // The context is rebuilt on every filter change; the history cache must
    // outlive it or every keystroke would re-query Keeneland.
    state.ctx._hist = state.histCache;
    FT.scoring.scoreAll(state.horses, state.ctx);

    var rows = FT.filters.apply(state.horses, state.filters);
    // A short list is its own workspace: only horses on that list, and the
    // sidebar filters still apply on top so you can narrow it further.
    if (state.tab === 'list') {
      rows = rows.filter(function (h) { return FT.store.isOnList(h.key, state.listId); });
    }
    sortRows(rows);
    state.view = rows;
    state.stale = false;
    render();
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
        var af = FT.store.vetStatus(a.key) === 'failed' ? 1 : 0;
        var bf = FT.store.vetStatus(b.key) === 'failed' ? 1 : 0;
        return af - bf || cmp(a, b);
      });
      return;
    }
    rows.sort(cmp);
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    var loaded = !!state.horses.length;
    var onList = state.tab === 'list';
    var listed = loaded && onList ? FT.store.shortlistCount(state.saleId, state.listId) : 0;

    // Three mutually exclusive panes: no sale, empty short list, or the table.
    var showEmptyList = loaded && onList && listed === 0;
    $('empty').hidden = loaded;
    $('emptyShortlist').hidden = !showEmptyList;
    $('tableWrap').hidden = !loaded || showEmptyList;
    $('grid').classList.toggle('show-vet', onList);
    if (showEmptyList) {
      var l = FT.store.getList(state.listId);
      $('emptyListName').textContent = l ? l.name : 'this list';
    }

    FT.ui.renderRows($('rows'), state.view, state.ctx);

    renderTabs();
    $('countCatalog').textContent = loaded ? state.horses.length.toLocaleString() : '—';

    updateCountLine();

    FT.ui.renderChips($('activeChips'), FT.filters.activeSummary(state.filters));
    $('btnRerank').hidden = !state.stale;

    if (state.openKey) openDetail(state.openKey, true);
  }

  /** Tabs, the ★ target picker, and the rename/delete controls, all of which
      depend on the same list state. */
  function renderTabs() {
    var onList = state.tab === 'list';
    var lists = FT.store.allLists();

    document.querySelector('#tabs [data-tab="catalog"]').classList.toggle('is-on', !onList);
    FT.ui.renderListTabs($('listTabs'), lists, state.saleId, state.listId, onList);
    FT.ui.renderStarTarget($('starTarget'), lists, state.listId);

    // On a list tab the tab itself says where the star goes, so the picker is
    // noise; on the catalog it's the only thing that does.
    $('starTargetWrap').hidden = onList;
    $('listTools').hidden = !onList;
    $('btnDeleteList').hidden = lists.length <= 1;
  }

  function renderPresets() {
    FT.ui.renderPresets($('presetSelect'), FT.store.allPresets(), state.presetId);
  }

  function renderWeights() {
    var total = FT.ui.renderWeights($('weights'), state.settings);
    $('weightNote').textContent = total > 0
      ? 'Raw weights total ' + total + '; the model uses their relative share.'
      : 'Both weights are zero — give at least one factor some weight.';
  }

  function renderRefSales() {
    var el = $('refSales');
    if (!el) return;
    el.innerHTML = FT.data.SALES.map(function (s) {
      var on = state.refSaleIds.indexOf(s.code) !== -1;
      var loading = on && !state.loaded[s.code];
      var isCurrent = s.code === state.saleId;
      return '<span class="ref-sale' + (on || isCurrent ? ' is-on' : '') + (loading ? ' is-loading' : '') + '" ' +
             'data-ref="' + s.code + '"' + (isCurrent ? ' title="the sale you are shopping — always included"' : '') + '>' +
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
      var tabs = FT.ui.mediaTabs(horse);
      state.mediaTab[key] = tabs.length && !tabs[0].heavy ? tabs[0].id : '';
    }
    row.insertAdjacentHTML('afterend', FT.ui.detailHtml(horse, state.ctx, state.mediaTab[key]));
    state.openKey = key;
    loadSaleHistory(horse);
  }

  /**
   * Sale history is fetched when you open a horse, not up front — one
   * Keeneland request per mare instead of hundreds on load. Results are cached
   * for the session, so reopening a horse is instant.
   */
  function loadSaleHistory(horse) {
    var cache = state.histCache;
    if (cache[horse.key]) return;

    FT.saleHistory.forHorse(horse, state.loaded).then(function (res) {
      cache[horse.key] = res;
      var block = document.querySelector('[data-hist-for="' + CSS.escape(horse.key) + '"]');
      if (block) block.innerHTML = FT.ui.saleHistoryHtml(horse, res);
    }).catch(function (e) {
      cache[horse.key] = { entries: [], keeneland: 'error', error: e.message };
      var block = document.querySelector('[data-hist-for="' + CSS.escape(horse.key) + '"]');
      if (block) block.innerHTML = FT.ui.saleHistoryHtml(horse, cache[horse.key]);
    });
  }

  /** Repaint the detail panel's per-list chips and every tab count. */
  function syncListState(key) {
    var chips = document.querySelector('[data-list-chips="' + CSS.escape(key) + '"]');
    if (chips) chips.outerHTML = FT.ui.listChips(key);
    var row = document.querySelector('tr.hrow[data-key="' + CSS.escape(key) + '"]');
    if (row) {
      var btn = row.querySelector('.flag-btn');
      var on = FT.store.isFlagged(key);
      btn.classList.toggle('is-on', on);
      btn.textContent = on ? '★' : '☆';
      btn.title = on ? 'On: ' + FT.store.listNamesFor(key).join(', ')
                     : 'Add to the list the ★ picker is set to';
    }
    renderTabs();
  }

  /**
   * Repaint a horse's vet state everywhere it shows. Scratching is a decisive
   * call, not an incremental edit, so on the short list it re-sorts straight
   * away and the horse drops to the bottom then and there.
   */
  function applyVetStatus(key) {
    var st = FT.store.vetStatus(key);
    document.querySelectorAll('[data-vet="' + CSS.escape(key) + '"]').forEach(function (sel) {
      sel.value = st;
      sel.className = sel.className.replace(/\bvet-(none|requested|passed|failed)\b/g, '').trim() +
        ' vet-' + st;
    });
    var row = document.querySelector('tr.hrow[data-key="' + CSS.escape(key) + '"]');
    if (row) row.classList.toggle('is-scratched', st === 'failed');
    if (state.tab === 'list') recompute();
  }

  /** Swap the media pane without rebuilding the rest of the detail row. */
  function setMediaTab(key, tab) {
    var horse = state.horses.filter(function (h) { return h.key === key; })[0];
    if (!horse) return;
    state.mediaTab[key] = state.mediaTab[key] === tab ? '' : tab;
    var block = document.querySelector('tr.detail[data-detail-for="' + CSS.escape(key) + '"] .detail-media');
    if (!block) return;
    block.outerHTML = FT.ui.mediaHtml(horse, state.mediaTab[key]);
  }

  /** Rescore one horse and repaint its row + detail, without re-sorting. */
  function refreshHorse(key) {
    var horse = state.horses.filter(function (h) { return h.key === key; })[0];
    if (!horse || !state.ctx) return;
    horse._score = FT.scoring.score(horse, state.ctx);

    var vals = { conf: FT.store.conformation(key), ped: FT.store.pedigree(key) };
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
        var on = FT.store.isFlagged(key);
        flag.classList.toggle('is-on', on);
        flag.textContent = on ? '★' : '☆';
      }
    }

    // Refresh only the score breakdown. Rebuilding the whole detail row would
    // tear down the media pane — restarting a walk video, or losing your place
    // in it — and blow away focus in the notes box.
    var block = document.querySelector('[data-comp-block="' + CSS.escape(key) + '"]');
    if (block) block.innerHTML = FT.ui.componentsHtml(horse);

    Object.keys(vals).forEach(function (kind) {
      var v = vals[kind];
      var range = document.querySelector('[data-' + kind + '-range="' + CSS.escape(key) + '"]');
      if (range && document.activeElement !== range) range.value = v === null ? 5 : v;
      var out = document.querySelector('[data-' + kind + '-out="' + CSS.escape(key) + '"]');
      if (out) out.textContent = v === null ? '—' : v.toFixed(1);
    });

    state.stale = true;
    $('btnRerank').hidden = false;
    updateCountLine();
  }

  /** The line above the table: how many hips, and how much of your own work is in. */
  function updateCountLine() {
    var sale = state.loaded[state.saleId] && state.loaded[state.saleId].sale;
    if (!sale) { $('resultCount').textContent = 'No sale loaded'; return; }

    var bits = [];
    var graded = FT.store.gradedCount(state.saleId);
    var pedRated = FT.store.pedRatedCount(state.saleId);
    if (graded) bits.push(graded + ' graded');
    if (pedRated) bits.push(pedRated + ' ped');

    var list = state.tab === 'list' ? FT.store.getList(state.listId) : null;
    var head = list
      ? state.view.length.toLocaleString() + ' hip' + (state.view.length === 1 ? '' : 's') +
        ' on ' + list.name
      : state.view.length.toLocaleString() + ' of ' +
        state.horses.length.toLocaleString() + ' hips';
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
      FT.ui.renderPicker(el, {
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
    sel.innerHTML = FT.data.SALES.map(function (s) {
      return '<option value="' + s.code + '">' + U.escapeHtml(s.label) + '</option>';
    }).join('');
    sel.value = DEFAULT_SALE;
    $('apiHint').textContent = FT.data.saleUrl(DEFAULT_SALE);
    sel.addEventListener('change', function () {
      $('apiHint').textContent = FT.data.saleUrl(sel.value);
      if (state.loaded[sel.value]) {
        setCurrentSale(sel.value);
        loadReferenceSales(FT.data.defaultRefSales(sel.value));
      }
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
      state.settings = FT.scoring.cloneDefaults();
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

    $('fConfMin').addEventListener('input', function () {
      var v = Number(this.value);
      state.filters.confMin = v <= 0 ? null : v;
      $('fConfMinVal').textContent = v <= 0 ? 'any' : v.toFixed(1);
      reFilter();
    });
    $('fConfState').addEventListener('change', function () { state.filters.confState = this.value; recompute(); });

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

    ['fWalk:needsWalkVideo', 'fPhoto:needsPhoto', 'fXray:needsXray',
     'fUpdate:hasUpdate', 'fOuts:includeOuts']
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
      state.filters = FT.filters.blank();
      state.presetId = '';
      renderPresets();
      $('presetNote').textContent = '';
      syncFilterInputs();
      renderPickers();
      recompute();
    });

    /* -- saved filters ----------------------------------------------------- */
    $('presetSelect').addEventListener('change', function () {
      if (!this.value) { state.presetId = ''; $('presetNote').textContent = ''; return; }
      applyPreset(this.value);
    });

    $('btnPresetSave').addEventListener('click', function () {
      var current = state.presetId ? FT.store.getPreset(state.presetId) : null;
      FT.ui.askName({
        title: 'Save these filters',
        label: 'Name',
        ok: 'Save',
        value: current ? current.name : '',
        placeholder: 'My 15 stallions',
        note: 'Saving under a name that already exists overwrites it.'
      }).then(function (name) {
        if (!name) return;
        var rec = FT.store.savePreset(name, FT.filters.serialize(state.filters));
        state.presetId = rec.id;
        renderPresets();
        var n = FT.filters.activeSummary(state.filters).length;
        $('presetNote').textContent = 'Saved “' + rec.name + '” — ' + n +
          ' active filter' + (n === 1 ? '' : 's') + '.';
      });
    });

    $('btnPresetDelete').addEventListener('click', function () {
      var p = state.presetId ? FT.store.getPreset(state.presetId) : null;
      if (!p) { $('presetNote').textContent = 'Pick a saved filter first.'; return; }
      if (!window.confirm('Delete the saved filter “' + p.name + '”?')) return;
      FT.store.deletePreset(p.id);
      state.presetId = '';
      renderPresets();
      $('presetNote').textContent = 'Deleted “' + p.name + '”. The filters themselves are untouched.';
    });

    $('btnPresetExport').addEventListener('click', function () {
      var all = FT.store.allPresets();
      if (!all.length) { $('presetNote').textContent = 'Nothing saved to export yet.'; return; }
      U.download('ft-yearling-filters-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify({
          _format: 'ft-yearling-model-filters', _version: 1,
          exportedAt: new Date().toISOString(), filterPresets: all
        }, null, 2), 'application/json');
      $('presetNote').textContent = 'Exported ' + all.length + ' saved filter' +
        (all.length === 1 ? '' : 's') + '.';
    });

    $('btnPresetImport').addEventListener('click', function () { pickFile('filters'); });

    $('activeChips').addEventListener('click', function (e) {
      var id = e.target.dataset && e.target.dataset.clearFilter;
      if (!id) return;
      var fresh = FT.filters.blank();
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
        FT.ui.syncPickerCount(el, list.length);
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
      var flag = e.target.closest('[data-flag]');
      if (flag) {
        e.stopPropagation();
        FT.store.toggleOnList(flag.dataset.flag, state.listId);
        // On a list tab, un-starring means "get this off my list" — so act on
        // it now rather than waiting for a re-rank.
        if (state.tab === 'list') recompute();
        else syncListState(flag.dataset.flag);
        return;
      }
      var chip = e.target.closest('[data-toggle-list]');
      if (chip) {
        e.stopPropagation();
        var ck = chip.dataset.key;
        FT.store.toggleOnList(ck, chip.dataset.toggleList);
        // Taking a horse off the list you're viewing should drop it out of the
        // table; every other combination only needs the chips repainting.
        if (state.tab === 'list' && !FT.store.isOnList(ck, state.listId)) recompute();
        else syncListState(ck);
        return;
      }
      var tab = e.target.closest('[data-media-tab]');
      if (tab) {
        e.stopPropagation();
        setMediaTab(tab.dataset.mediaKey, tab.dataset.mediaTab);
        return;
      }
      var clearKind = e.target.dataset && (e.target.dataset.confClear ? 'conf'
                    : e.target.dataset.pedClear ? 'ped' : null);
      if (clearKind) {
        e.stopPropagation();
        var ck = e.target.dataset.confClear || e.target.dataset.pedClear;
        RATINGS[clearKind].set(ck, null);
        refreshHorse(ck);
        return;
      }
      // Clicking a control in the row means using that control — never
      // expanding the horse. Only chrome outside them toggles the detail.
      if (e.target.closest('select, input, textarea, a, label, iframe')) return;
      var row = e.target.closest('tr.hrow');
      if (row) openDetail(row.dataset.key);
    });

    $('rows').addEventListener('change', function (e) {
      var d = e.target.dataset || {};
      if (d.vet) {
        FT.store.setVetStatus(d.vet, e.target.value);
        applyVetStatus(d.vet);
        return;
      }
      if (d.ped) {
        FT.store.setPedigree(d.ped, e.target.value === '' ? null : Number(e.target.value));
        refreshHorse(d.ped);
        return;
      }
      if (!d.conf) return;
      FT.store.setConformation(d.conf, e.target.value === '' ? null : Number(e.target.value));
      refreshHorse(d.conf);
    });

    /* -- tabs and short lists ---------------------------------------------- */
    $('tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]');
      if (!t) return;
      var sameTab = t.dataset.tab === state.tab &&
                    (t.dataset.tab !== 'list' || t.dataset.list === state.listId);
      if (sameTab) return;
      state.tab = t.dataset.tab;
      if (t.dataset.list) setActiveList(t.dataset.list);
      state.openKey = null;
      recompute();
    });

    $('starTarget').addEventListener('change', function () {
      setActiveList(this.value);
      // Nothing about the rows changed, but every ★ now means something else,
      // so repaint the titles rather than leaving them lying about the target.
      render();
    });

    $('btnNewList').addEventListener('click', function () {
      FT.ui.askName({
        title: 'New short list', label: 'Name', ok: 'Create',
        placeholder: 'Colts to see',
        note: 'Lists are shared across sales; what\'s on them is per sale.'
      }).then(function (name) {
        if (!name) return;
        var r = FT.store.createList(name);
        state.tab = 'list';
        setActiveList(r.list.id);
        state.openKey = null;
        recompute();
        status(r.existed
          ? '“' + r.list.name + '” already exists — switched to it.'
          : 'Created “' + r.list.name + '”. The ★ button now adds to it.', 'done');
      });
    });

    $('btnRenameList').addEventListener('click', function () {
      var l = FT.store.getList(state.listId);
      if (!l) return;
      FT.ui.askName({ title: 'Rename list', label: 'Name', ok: 'Rename', value: l.name })
        .then(function (name) {
          if (!name || name === l.name) return;
          if (!FT.store.renameList(l.id, name)) {
            status('There is already a list called “' + name + '”.', 'error');
            return;
          }
          render();
          status('Renamed to “' + name + '”.', 'done');
        });
    });

    $('btnDeleteList').addEventListener('click', function () {
      var l = FT.store.getList(state.listId);
      if (!l) return;
      var n = FT.store.shortlistCount(state.saleId, l.id);
      // Deleting drops every horse's membership, on every sale — worth a beat.
      if (!window.confirm('Delete “' + l.name + '”?' +
          (n ? '\n\n' + n + ' hip' + (n === 1 ? '' : 's') + ' from this sale are on it. ' +
               'Their grades, notes and vet status are kept — only the list goes.' : ''))) return;
      FT.store.deleteList(l.id);
      state.tab = 'catalog';
      state.listId = FT.store.activeListId();
      state.openKey = null;
      recompute();
      status('Deleted “' + l.name + '”.', 'done');
    });

    // Detail-panel controls live in the same tbody.
    $('rows').addEventListener('input', function (e) {
      var d = e.target.dataset || {};
      var kind = d.confRange ? 'conf' : d.pedRange ? 'ped' : null;
      if (kind) {
        var k = d.confRange || d.pedRange;
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
      FT.store.setSireOverride(key, e.target.value === '' ? null : Number(e.target.value));
      // Reference only — but the badge beside each sire and the detail panel
      // both show it, so the table still needs repainting.
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
          '<p style="margin:6px 0 0">Worth importing: <b>Leading Sires</b> for two or three years, plus ' +
          '<b>First-Crop Sires</b> for the current year. A yearling sale leans on freshmen far more ' +
          'than a 2YO sale does, so First-Crop is not optional here.</p>';
      }
    });
    $('bhLists').addEventListener('click', function (e) {
      var rm = e.target.closest('[data-bh-remove]');
      if (!rm) return;
      FT.store.removeSireList(rm.dataset.bhRemove);
      rebuildIndexes(); recompute(); renderBhLists(); drawSireRows();
      $('sireNote').textContent = 'Sire list removed.';
    });

    $('refSales').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-ref]');
      if (!chip) return;
      var code = chip.dataset.ref;
      if (code === state.saleId) return;
      var i = state.refSaleIds.indexOf(code);
      if (i === -1) loadReferenceSales(state.refSaleIds.concat([code])).then(drawSireRows);
      else {
        state.refSaleIds.splice(i, 1);
        rebuildIndexes(); recompute(); renderRefSales(); drawSireRows();
      }
    });

    /* -- exports ----------------------------------------------------------- */
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('btnExportWork').addEventListener('click', function () {
      U.download('ft-yearling-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(FT.store.exportAll(), null, 2), 'application/json');
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
            FT.store.importAll(JSON.parse(reader.result));
            state.listId = FT.store.activeListId();
            renderPresets();
            status('Restored your grades, short lists and saved filters.', 'done');
            recompute();
          } else if (mode === 'filters') {
            var payload = JSON.parse(reader.result);
            var incoming = Array.isArray(payload) ? payload : payload && payload.filterPresets;
            if (!Array.isArray(incoming) || !incoming.length) {
              throw new Error('That file has no saved filters in it. Expected the JSON written ' +
                              'by "export filters".');
            }
            var r = FT.store.mergePresets(incoming);
            renderPresets();
            $('presetNote').textContent = 'Imported ' + r.added + ' new filter' +
              (r.added === 1 ? '' : 's') +
              (r.updated ? ', updated ' + r.updated + ' matching by name' : '') + '.';
            status('Imported ' + (r.added + r.updated) + ' saved filter' +
                   (r.added + r.updated === 1 ? '' : 's') + '.', 'done');
          } else if (mode === 'sires') {
            var list = FT.bloodhorse.parseFile(reader.result);
            FT.store.saveSireList(list);
            rebuildIndexes();
            recompute();
            renderBhLists();
            drawSireRows();
            var matched = 0, counts = saleSireCounts();
            Object.keys(counts).forEach(function (k) {
              if (FT.bloodhorse.lookup(state.bhIndex, k)) matched++;
            });
            status('Imported ' + list.rows.length + ' sires from ' + list.listLabel + ' ' +
                   list.year + ' — ' + matched + ' of ' + Object.keys(counts).length +
                   ' sires in this sale now have racing data.', 'done');
            $('sireNote').textContent = 'Imported ' + list.listLabel + ' ' + list.year +
              ' (' + list.rows.length + ' sires).';
          } else {
            var res = FT.data.parseFile(reader.result);
            state.loaded[res.sale.code] = res;
            $('saleSelect').value = res.sale.code;
            setCurrentSale(res.sale.code);
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

  /* The two manual ratings, keyed by the data-attribute suffix they use. */
  var RATINGS = {
    conf: { get: FT.store.conformation, set: FT.store.setConformation },
    ped:  { get: FT.store.pedigree,     set: FT.store.setPedigree }
  };

  var noteTimer = {};
  function scheduleNoteSave(key, text) {
    clearTimeout(noteTimer[key]);
    noteTimer[key] = setTimeout(function () { FT.store.setNoteText(key, text); }, 400);
  }
  var scoreTimer = {};
  function scheduleScoreRefresh(key) {
    clearTimeout(scoreTimer[key]);
    scoreTimer[key] = setTimeout(function () { refreshHorse(key); }, 250);
  }

  function setActiveList(id) {
    state.listId = id;
    FT.store.setActiveList(id);
  }

  /**
   * Load a saved filter over the current one.
   *
   * The one thing worth saying out loud afterwards is how much of it landed:
   * a filter saved against last year's catalogue can name fifteen stallions of
   * which nine are in this sale, and an unexplained empty table is a bad way to
   * find that out.
   */
  function applyPreset(id) {
    var p = FT.store.getPreset(id);
    if (!p) return;
    state.presetId = id;
    state.filters = FT.filters.deserialize(p.filters);
    syncFilterInputs();
    renderPickers();
    recompute();

    var cov = FT.filters.coverage(state.filters, state.facets);
    var misses = cov.filter(function (c) { return c.found < c.selected; });
    var note = 'Loaded “' + p.name + '”.';
    if (!state.facets) {
      note += ' Load a sale to see it applied.';
    } else if (misses.length) {
      note += ' ' + misses.map(function (c) {
        return c.found + ' of ' + c.selected + ' ' + c.label + (c.selected === 1 ? '' : 's') +
               ' are in this sale';
      }).join('; ') + '.';
    }
    $('presetNote').textContent = note;
    renderPresets();
  }

  function inferFoalYear() {
    var sale = state.loaded[state.saleId] && state.loaded[state.saleId].sale;
    var y = sale && sale.year ? sale.year - 1 : new Date().getFullYear() - 1;
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
    FT.ui.renderSireRows($('sireRows'), state.bhIndex, state.sireIndex, saleSireCounts(),
      $('sireSearch').value, $('sireNeedsOnly').checked);
  }

  /** How much of the sale has no racing data behind its Pedigree read. */
  function sireCoverage() {
    var counts = saleSireCounts();
    var thin = 0, thinSires = 0, total = 0;
    Object.keys(counts).forEach(function (k) {
      total += counts[k];
      if (FT.ui.needsRating(k, FT.bloodhorse.lookup(state.bhIndex, k), counts)) {
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
      el.innerHTML = '<span class="dim" style="font-size:11px">None imported — no racing data ' +
        'sits beside the Pedigree slider yet. Import at least one list.</span>';
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
      $('sireNote').textContent = 'No sire list imported yet. The Pedigree slider has nothing ' +
        'beside it until you add one — use "Import sire list" below.';
      return;
    }
    var multiYear = (state.bhIndex.cohorts || []).filter(function (x) { return x.years.length > 1; });
    $('sireNote').textContent =
      'These rankings come from BloodHorse racing data — % black-type winners, earnings per ' +
      'runner and graded winners, shrunk for small books. Sires are ranked only within their own ' +
      'cohort; first-crop sires are never mixed in with established ones. ' +
      (multiYear.length
        ? 'Years are pooled for ' + multiYear.map(function (x) { return x.label.toLowerCase(); }).join(' and ') +
          ', giving a bigger sample than any single season. '
        : 'Import a second year of the same list to pool it and steady the ranking. ') +
      (c.thin ? c.thinSires + ' sires covering ' + c.thin + ' hips in this sale have no data — ' +
        'tick "Needs a rating" to work through them. ' : '') +
      'They inform your Pedigree rating; they never set it. Auction prices are shown on the ' +
      'right for budgeting and feed nothing.';
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
    var head = ['Rank', 'Score', 'Hip', 'Sire', 'Dam', 'BM sire', 'Foaled',
      'Sex', 'Colour', 'Bred', 'Consignor', 'Barn', 'Session',
      'Conformation', 'Pedigree', 'Sire book', 'X-rays', 'Page update',
      'Short lists', 'Vet', 'Notes',
      'Conf score', 'Pedigree score', 'Coverage %',
      'Status', 'Result', 'Price', 'Walk video', 'Catalog page'];

    var rows = [head];
    state.view.forEach(function (h, i) {
      var s = h._score;
      var by = {};
      s.components.forEach(function (c) { by[c.id] = c.value === null ? '' : c.value.toFixed(1); });
      var note = FT.store.getNote(h.key) || {};
      rows.push([
        i + 1,
        s.total === null ? '' : s.total.toFixed(1),
        h.hip, h.sire, h.dam, h.damSire,
        h.foalDate ? U.formatDate(h.foalDate) : '',
        h.sexLabel, h.colorLabel, h.foalArea, h.consignorSort, h.barn, h.sessionLabel,
        FT.store.conformation(h.key) === null ? '' : FT.store.conformation(h.key),
        FT.store.pedigree(h.key) === null ? '' : FT.store.pedigree(h.key),
        (function () { var x = FT.sires.lookup(state.ctx, h.sireRaw); return x && x.value !== null ? x.value : ''; })(),
        h.hasXray ? 'YES' : '',
        h.hasUpdate ? h.update.replace(/\s*\n+\s*/g, ' ') : '',
        FT.store.listNamesFor(h.key).join('; '),
        FT.store.vetStatus(h.key) === 'none' ? '' : FT.store.VET_LABELS[FT.store.vetStatus(h.key)],
        note.notes || '',
        by.conformation, by.pedigree,
        Math.round(s.coverage * 100),
        h.status === 'out' ? 'OUT' : 'IN',
        h.sold ? 'SOLD' : (h.rna ? 'RNA' : ''),
        h.sold ? h.price : (h.rna ? h.bidTo : ''),
        h.walkVideoLink, h.pedigreeLink
      ]);
    });

    var sale = state.loaded[state.saleId].sale;
    var list = state.tab === 'list' ? FT.store.getList(state.listId) : null;
    var slug = list ? '-' + list.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
    U.download('ft-' + sale.code + (slug || '-catalog') + '.csv', U.toCsv(rows), 'text/csv');
  }

  function pickFile(mode) {
    var el = $('fileInput');
    el.dataset.mode = mode;
    el.click();
  }

  /* ------------------------------------------------------------------ sync */

  function saveSettings() { FT.store.setSettings(state.settings); }

  function syncOptionInputs() {
    $('optUnrated').value = state.settings.options.unratedManual;
  }

  function syncFilterInputs() {
    var f = state.filters;
    $('fq').value = f.q;
    $('fConfMin').value = f.confMin === null ? 0 : f.confMin;
    $('fConfMinVal').textContent = f.confMin === null ? 'any' : f.confMin.toFixed(1);
    $('fConfState').value = f.confState;
    $('fPedMin').value = f.pedMin === null ? 0 : f.pedMin;
    $('fPedMinVal').textContent = f.pedMin === null ? 'any' : f.pedMin.toFixed(1);
    $('fPedState').value = f.pedState;
    $('fFoalFrom').value = U.toInputDate(f.foalFrom);
    $('fFoalTo').value = U.toInputDate(f.foalTo);
    $('fWalk').checked = f.needsWalkVideo;
    $('fPhoto').checked = f.needsPhoto;
    $('fXray').checked = f.needsXray;
    $('fUpdate').checked = f.hasUpdate;
    $('fOuts').checked = f.includeOuts;
    $('fResult').value = f.result;
    $('fPriceMin').value = f.priceMin === null ? '' : f.priceMin;
    $('fPriceMax').value = f.priceMax === null ? '' : f.priceMax;
    $('fScoreMin').value = f.scoreMin === null ? 0 : f.scoreMin;
    $('fScoreMinVal').textContent = f.scoreMin === null ? 'any' : f.scoreMin;
  }

  /* ------------------------------------------------------------------ init */

  function init() {
    if (state.settings.options.theme) document.documentElement.dataset.theme = state.settings.options.theme;
    wire();
    renderWeights();
    renderTabs();
    renderPresets();
    syncOptionInputs();
    syncFilterInputs();
    $('storeNote').textContent = FT.store.persistent
      ? 'Grades and notes are saved in this browser. Back them up before a sale.'
      : 'This browser is blocking local storage — your grades will vanish on reload. Back them up.';
  }

  document.addEventListener('DOMContentLoaded', init);

  /* Exposed so you can poke at the model from the console — e.g.
     FT.app.state.view.filter(h => h.hasXray) — and so future tools can hook in. */
  FT.app = {
    state: state,
    recompute: recompute,
    loadSale: loadSale,
    setCurrentSale: setCurrentSale
  };
})();
