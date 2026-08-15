/* Rendering. Pure-ish: builds markup from state, leaves event wiring to app.js
   (which uses delegation, so 1200 rows stay cheap). */
window.OBS = window.OBS || {};

OBS.ui = (function () {
  'use strict';
  var U = OBS.util;
  var esc = U.escapeHtml;

  /* --------------------------------------------------------------- weights */

  function renderWeights(container, settings) {
    var total = OBS.scoring.COMPONENTS.reduce(function (a, c) {
      return a + (Number(settings.weights[c.id]) || 0);
    }, 0);

    container.innerHTML = OBS.scoring.COMPONENTS.map(function (c) {
      var w = Number(settings.weights[c.id]) || 0;
      var share = total > 0 ? (w / total) * 100 : 0;
      return '' +
        '<div class="wrow">' +
          '<span class="wrow-label">' + esc(c.label) + '</span>' +
          '<span class="wrow-val">' + share.toFixed(0) + '%</span>' +
          '<input class="wrow-slider" type="range" min="0" max="100" step="1" ' +
                 'value="' + w + '" data-weight="' + c.id + '">' +
          '<span class="wrow-share"><i style="width:' + share.toFixed(1) + '%"></i></span>' +
        '</div>';
    }).join('');

    return total;
  }

  /* --------------------------------------------------------------- pickers */

  /**
   * A collapsible multi-select. `items` are {key,label,count}.
   * State lives in app.js; this only draws and reports clicks via data-attrs.
   */
  function renderPicker(el, opts) {
    var selected = opts.selected || [];
    var query = (el.dataset.query || '').toLowerCase();
    var open = el.classList.contains('is-open');

    var shown = query
      ? opts.items.filter(function (i) { return i.label.toLowerCase().indexOf(query) !== -1; })
      : opts.items;
    var cap = opts.limit || 400;

    /* Keep your place in a long list when the picker is redrawn for a reason
       that didn't change what's in it. Typing in the search box *does* change
       it, so that one starts at the top again. */
    var scroller = el.querySelector('.picker-list');
    var keepScroll = scroller && el.dataset.renderedQuery === (el.dataset.query || '')
      ? scroller.scrollTop : 0;

    el.dataset.picker = opts.id;
    el.innerHTML = '' +
      '<div class="picker-head">' +
        '<b>' + esc(opts.title) + '</b>' +
        (selected.length ? '<span class="picker-count">' + selected.length + '</span>' : '') +
        '<span style="margin-left:auto">' + (open ? '▾' : '▸') + '</span>' +
      '</div>' +
      '<div class="picker-body">' +
        (opts.items.length > 12
          ? '<input class="picker-search" type="search" placeholder="Filter…" value="' + esc(el.dataset.query || '') + '">'
          : '') +
        '<div class="picker-list">' +
          shown.slice(0, cap).map(function (i) {
            var on = selected.indexOf(i.key) !== -1;
            return '<label class="picker-item">' +
              '<input type="checkbox" value="' + esc(i.key) + '"' + (on ? ' checked' : '') + '>' +
              '<span>' + esc(i.label) + '</span>' +
              '<span class="n">' + i.count + '</span>' +
            '</label>';
          }).join('') +
          (shown.length > cap ? '<div class="panel-note">…' + (shown.length - cap) + ' more, keep typing</div>' : '') +
          (!shown.length ? '<div class="panel-note">No matches</div>' : '') +
        '</div>' +
        '<div class="picker-tools">' +
          '<button class="link-btn" data-pick-action="none">clear</button>' +
        '</div>' +
      '</div>';

    el.dataset.renderedQuery = el.dataset.query || '';
    if (keepScroll) {
      var again = el.querySelector('.picker-list');
      if (again) again.scrollTop = keepScroll;
    }
  }

  /**
   * Update only the "n selected" badge in a picker's header.
   *
   * Ticking a box doesn't change anything else about the picker — the browser
   * has already flipped the checkbox, and the per-item counts are facets of
   * the whole sale, not of the filtered set. Redrawing the picker for that
   * would replace the scroller and bounce you back to the top of a 150-sire
   * list on every click, so it doesn't.
   */
  function syncPickerCount(el, n) {
    var head = el.querySelector('.picker-head');
    if (!head) return;
    var badge = head.querySelector('.picker-count');
    if (!n) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'picker-count';
      head.insertBefore(badge, head.querySelector('b').nextSibling);
    }
    badge.textContent = n;
  }

  /* -------------------------------------------------- lists & saved filters */

  function renderListTabs(container, lists, saleId, activeListId, onList) {
    container.innerHTML = lists.map(function (l) {
      var n = saleId ? OBS.store.shortlistCount(saleId, l.id) : 0;
      return '<button class="tab' + (onList && l.id === activeListId ? ' is-on' : '') + '" ' +
        'data-tab="list" data-list="' + esc(l.id) + '">' + esc(l.name) +
        '<span class="tab-count">' + n + '</span></button>';
    }).join('');
  }

  function renderStarTarget(sel, lists, activeListId) {
    sel.innerHTML = lists.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === activeListId ? ' selected' : '') + '>' +
        esc(l.name) + '</option>';
    }).join('');
    sel.value = activeListId;
  }

  function renderPresets(sel, presets, activeId) {
    sel.innerHTML = '<option value="">' +
        (presets.length ? 'Saved filters…' : 'No saved filters yet') + '</option>' +
      presets.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === activeId ? ' selected' : '') + '>' +
          esc(p.name) + '</option>';
      }).join('');
    sel.value = activeId && presets.some(function (p) { return p.id === activeId; }) ? activeId : '';
  }

  /** Per-horse list membership, as toggle chips. */
  function listChips(key) {
    return '<div class="list-chips" data-list-chips="' + esc(key) + '">' +
      OBS.store.allLists().map(function (l) {
        var on = OBS.store.isOnList(key, l.id);
        return '<button class="list-chip' + (on ? ' is-on' : '') + '" ' +
          'data-toggle-list="' + esc(l.id) + '" data-key="' + esc(key) + '">' +
          (on ? '★ ' : '☆ ') + esc(l.name) + '</button>';
      }).join('') +
    '</div>';
  }

  /* ------------------------------------------------------------------ rows */

  function scoreTier(v) {
    if (v === null || v === undefined) return 't3';
    if (v >= 68) return 't1';
    if (v >= 45) return 't2';
    return 't3';
  }

  function breezeCell(h, ctx) {
    if (h.breezeSec === null) {
      return '<span class="breeze-dist">' + (h.status === 'out' ? '—' : 'not yet') + '</span>';
    }
    var arr = ctx.breezeByDist[h.furlongs] || [];
    var pct = arr.length > 1 ? U.percentileRank(arr, h.breezeSec) : null;
    var cls = pct === null ? '' : (pct <= 0.15 ? ' breeze-fast' : (pct >= 0.7 ? ' breeze-slow' : ''));
    return '<span class="breeze-time' + cls + '">' + U.formatBreeze(h.breezeSec) + '</span> ' +
           '<span class="breeze-dist">' + esc(h.distLabel) + '</span>';
  }

  function resultCell(h) {
    if (h.status === 'out') return '<span class="tag tag-out">OUT</span>';
    if (h.sold) return '<span class="tag tag-sold">' + U.moneyShort(h.price) + '</span>';
    if (h.rna) return '<span class="tag tag-rna">RNA ' + (h.bidTo ? U.moneyShort(h.bidTo) : '') + '</span>';
    return '<span class="breeze-dist">—</span>';
  }

  function vetSelect(key, cls) {
    var v = OBS.store.vetStatus(key);
    return '<select class="' + cls + ' vet-' + v + '" data-vet="' + esc(key) + '">' +
      OBS.store.VET_STATES.map(function (s) {
        return '<option value="' + s + '"' + (s === v ? ' selected' : '') + '>' +
          esc(s === 'none' ? '—' : OBS.store.VET_LABELS[s]) + '</option>';
      }).join('') +
    '</select>';
  }

  /** The sire book's number, shown beside the sire's name as reference. */
  function sireBadge(h, ctx) {
    var s = OBS.sires.lookup(ctx, h.sireRaw);
    if (!s || s.value === null) return '';
    return ' <span class="sire-badge' + (s.source === 'yours' ? ' is-yours' : '') + '" ' +
      'title="Sire book rating — reference only, not part of the score">' + s.value + '</span>';
  }

  /* Hip leads the row. There is no position-in-the-list column: a hip number
     and a rank are both small integers sitting side by side, and having them
     disagree — as they almost always do — made the table harder to read than
     the rank was worth. The hip is the horse's actual identity; the ranking is
     already expressed by the order of the rows. */
  function rowHtml(h, ctx) {
    var s = h._score || { total: null, components: [] };
    var total = s.total;
    var conf = OBS.store.conformation(h.key);
    var bv = OBS.store.breezeVisual(h.key);
    var ped = OBS.store.pedigree(h.key);
    var flagged = OBS.store.isFlagged(h.key);
    var scratched = OBS.store.vetStatus(h.key) === 'failed';

    return '' +
    '<tr class="hrow' + (h.status === 'out' ? ' is-out' : '') +
        (scratched ? ' is-scratched' : '') + '" data-key="' + esc(h.key) + '">' +
      '<td class="c-hip"><span class="hip-num">' + esc(h.hip) + '</span>' +
        '<div class="hip-sub">Barn ' + esc(h.barn || '—') + '</div></td>' +
      '<td class="c-score">' +
        '<div class="score-cell ' + scoreTier(total) + '">' +
          '<span class="score-num">' + (total === null ? '—' : total.toFixed(0)) + '</span>' +
          '<span class="score-bar"><i style="width:' + (total === null ? 0 : U.clamp(total, 0, 100)) + '%"></i></span>' +
        '</div>' +
      '</td>' +
      '<td class="c-ped">' +
        '<div class="ped-sire">' + esc(h.sire || '—') + sireBadge(h, ctx) + '</div>' +
        '<div class="ped-dam">' + esc(h.dam || '—') +
          (h.damSire ? ' <span style="opacity:.7">(' + esc(h.damSire) + ')</span>' : '') + '</div>' +
      '</td>' +
      '<td class="c-pd">' +
        '<input class="conf-input' + (ped !== null ? ' is-set' : '') + '" type="number" ' +
               'min="0" max="10" step="0.5" placeholder="–" ' +
               'value="' + (ped === null ? '' : ped) + '" data-ped="' + esc(h.key) + '">' +
      '</td>' +
      '<td class="c-breeze">' + breezeCell(h, ctx) + '</td>' +
      '<td class="c-bv">' +
        '<input class="conf-input' + (bv !== null ? ' is-set' : '') + '" type="number" ' +
               'min="0" max="10" step="0.5" placeholder="–" ' +
               'value="' + (bv === null ? '' : bv) + '" data-bv="' + esc(h.key) + '">' +
      '</td>' +
      '<td class="c-foal">' + U.formatDate(h.foalDate) + '</td>' +
      '<td class="c-sex">' + esc(h.sexLabel) + '</td>' +
      '<td class="c-cons">' + esc(h.consignorSort || '—') + '</td>' +
      '<td class="c-conf">' +
        '<input class="conf-input' + (conf !== null ? ' is-set' : '') + '" type="number" ' +
               'min="0" max="10" step="0.5" placeholder="–" ' +
               'value="' + (conf === null ? '' : conf) + '" data-conf="' + esc(h.key) + '">' +
      '</td>' +
      '<td class="c-vet">' + vetSelect(h.key, 'vet-select') + '</td>' +
      '<td class="c-result">' + resultCell(h) + '</td>' +
      '<td class="c-flag">' +
        '<button class="flag-btn' + (flagged ? ' is-on' : '') + '" data-flag="' + esc(h.key) + '" ' +
                'title="Shortlist">' + (flagged ? '★' : '☆') + '</button>' +
      '</td>' +
    '</tr>';
  }

  /* Renders the whole filtered set — no paging. A search that silently omits
     a match is worse than any render cost, and there isn't much of one:
     1,224 rows (the largest OBS sale) takes about 65ms. */
  function renderRows(tbody, horses, ctx) {
    tbody.innerHTML = horses.map(function (h) { return rowHtml(h, ctx); }).join('');
    return horses.length;
  }

  /* ---------------------------------------------------------------- detail */

  /** The score breakdown. Split out so grading can refresh it without
      touching the media pane below (which may hold a playing video). */
  function componentsHtml(h) {
    var s = h._score || { components: [], coverage: 1 };

    var comps = s.components.map(function (c) {
      var v = c.value;
      return '<div class="comp' + (c.applied ? '' : ' is-off') + '">' +
        '<div class="comp-head">' +
          '<b>' + esc(c.label) + '</b>' +
          '<span class="comp-w">weight ' + c.weight + '</span>' +
          '<span class="comp-v">' + (v === null ? 'n/a' : v.toFixed(0)) + '</span>' +
        '</div>' +
        '<div class="comp-bar"><i style="width:' + (v === null ? 0 : U.clamp(v, 0, 100)) + '%"></i></div>' +
        '<div class="comp-detail">' + esc(c.detail || '') + '</div>' +
      '</div>';
    }).join('');

    var coverageWarn = s.coverage < 0.001
      ? '<div class="coverage-warn">No score yet — rate this horse below and it enters the ranking.</div>'
      : s.coverage < 0.999
        ? '<div class="coverage-warn">Scored on ' + Math.round(s.coverage * 100) +
          '% of the model — you haven\'t rated the rest.</div>'
        : '';

    return comps + coverageWarn;
  }

  /* Which media a hip has, in the order the tabs should appear. The photo
     leads because it's ~150KB; the breeze videos are ~35MB apiece, so nothing
     loads until you ask for it. */
  function mediaTabs(h) {
    var tabs = [];
    if (h.photoLink) tabs.push({ id: 'photo', label: 'Photo', url: h.photoLink });
    if (h.pedigreeLink) tabs.push({ id: 'page', label: 'Catalog page', url: h.pedigreeLink });
    if (h.videoLink) tabs.push({ id: 'breeze', label: 'Breeze video', url: h.videoLink, heavy: true });
    if (h.walkVideoLink) tabs.push({ id: 'walk', label: 'Walk video', url: h.walkVideoLink, heavy: true });
    return tabs;
  }

  function mediaPane(tab) {
    if (!tab) return '';
    // No loading="lazy" here on purpose: the element only exists once you've
    // opened its tab, so deferring again buys nothing and can stop the fetch
    // firing at all when the pane isn't in view.
    if (tab.id === 'photo') {
      return '<img src="' + esc(tab.url) + '" alt="Conformation photo">';
    }
    if (tab.id === 'page') {
      return '<iframe src="' + esc(tab.url) + '#view=FitH" title="Catalog page"></iframe>';
    }
    return '<video src="' + esc(tab.url) + '" controls preload="metadata" playsinline></video>';
  }

  /**
   * @param {String} active  media tab id to show; '' means none open yet.
   */
  function mediaHtml(h, active) {
    var tabs = mediaTabs(h);
    if (!tabs.length) return '';

    var current = tabs.filter(function (t) { return t.id === active; })[0] || null;

    var buttons = tabs.map(function (t) {
      return '<button class="media-tab' + (current && t.id === current.id ? ' is-on' : '') + '" ' +
        'data-media-tab="' + t.id + '" data-media-key="' + esc(h.key) + '">' +
        esc(t.label) + (t.heavy ? '<span class="media-heavy" title="Large file — loads when you open it">~35MB</span>' : '') +
      '</button>';
    }).join('');

    var openLink = current
      ? '<a class="media-open" href="' + esc(current.url) + '" target="_blank" rel="noopener">open full size ↗</a>'
      : '';

    return '<div class="detail-block detail-media">' +
      '<h4>Media' +
        (h.updatesLink ? ' <a class="media-open" href="' + esc(h.updatesLink) +
          '" target="_blank" rel="noopener">consignor updates ↗</a>' : '') +
      '</h4>' +
      '<div class="media-tabs">' + buttons + openLink + '</div>' +
      (current
        ? '<div class="media-pane media-' + current.id + '">' + mediaPane(current) + '</div>'
        : '<div class="media-hint">Pick one above — nothing is downloaded until you do.</div>') +
    '</div>';
  }

  /** One 0-10 slider. `kind` is 'bv' or 'conf' — it drives the data-attrs. */
  function gradeRow(label, kind, key, value, aside) {
    return '<div class="grade-row">' +
      '<span class="grade-label">' + esc(label) +
        (aside ? '<em>' + esc(aside) + '</em>' : '') +
      '</span>' +
      '<input type="range" min="0" max="10" step="0.5" value="' + (value === null ? 5 : value) + '" ' +
             'data-' + kind + '-range="' + esc(key) + '">' +
      '<span class="grade-val" data-' + kind + '-out="' + esc(key) + '">' +
        (value === null ? '—' : value.toFixed(1)) + '</span>' +
      '<button class="btn btn-sm" data-' + kind + '-clear="' + esc(key) + '">clear</button>' +
    '</div>';
  }

  /** Full sire-book detail for the panel: cohort, sample, key rates. */
  function sireFacts(ctx, name, label) {
    var s = OBS.sires.lookup(ctx, name);
    if (!s) return '';
    var bits = [];
    if (s.override !== null) bits.push('your rating ' + s.override);
    if (s.bh) {
      var r = s.bh.row;
      var f = [s.bh.cohort.label + ' ' + (s.bh.years || []).join('+'), s.bh.rating + '/100'];
      if (r.rnrs) f.push(r.rnrs + ' rnrs');
      if (r.btwPct !== null) f.push(r.btwPct.toFixed(1) + '% BTW');
      if (r.aer) f.push(U.moneyShort(r.aer) + '/rnr');
      bits.push(f.join(', '));
    }
    if (s.market && s.market.medianPrice) {
      bits.push('OBS median ' + U.moneyShort(s.market.medianPrice));
    }
    return bits.length ? '<dt>' + esc(label) + '</dt><dd class="dim">' + esc(bits.join(' · ')) + '</dd>' : '';
  }

  /** Where this horse has been sold before. Filled in asynchronously. */
  function saleHistoryHtml(h, state) {
    if (!state) {
      return '<div class="hist-line dim">Looking up sale history…</div>';
    }
    var rows = OBS.saleHistory.sortEntries(state.entries || []);

    var body = rows.length
      ? rows.map(function (e) {
          var outcome = e.out ? '<span class="tag tag-out">OUT</span>'
            : e.price ? '<span class="tag tag-sold">' + U.moneyShort(e.price) + '</span>'
            : e.rna ? '<span class="tag tag-rna">RNA' + (e.bidTo ? ' ' + U.moneyShort(e.bidTo) : '') + '</span>'
            : '<span class="dim">—</span>';
          var where = e.link
            ? '<a href="' + esc(e.link) + '" target="_blank" rel="noopener">' + esc(e.sale) + '</a>'
            : esc(e.sale);
          return '<div class="hist-row">' +
            '<span class="hist-src src-' + esc(e.source.toLowerCase()) + '">' + esc(e.source) + '</span>' +
            '<span class="hist-sale">' + where + '</span>' +
            '<span class="hist-meta dim">' +
              (e.soldAs ? esc(e.soldAs) : '') + (e.hip ? ' · hip ' + esc(e.hip) : '') +
              (e.consignor ? ' · ' + esc(e.consignor) : '') +
            '</span>' +
            '<span class="hist-price">' + outcome + '</span>' +
          '</div>';
        }).join('')
      : '<div class="hist-line dim">No prior sale found.</div>';

    var note = '';
    if (state.keeneland === 'unavailable') {
      note = '<div class="hist-line dim">OBS sales only. Either run ' +
             '<code>node serve.js</code> and open it there, or fill the shared cache with ' +
             '<code>node shared/fetch-keeneland.js</code>, to include Keeneland.</div>';
    } else if (state.keeneland === 'uncached') {
      // The cache is reachable, this mare simply isn't in it — which is a
      // one-command fix rather than a missing feature, so say which command.
      note = '<div class="hist-line dim">This mare isn\'t in the shared Keeneland cache yet. ' +
             'Run <code>node shared/fetch-keeneland.js ' + esc(h.saleId || '&lt;sale&gt;') +
             '</code> to fill it for the whole sale.</div>';
    } else if (state.keeneland === 'error') {
      note = '<div class="hist-line dim">Keeneland lookup failed: ' + esc(state.error || '') + '</div>';
    }
    return body + note;
  }

  function detailHtml(h, ctx, activeMedia) {
    var conf = OBS.store.conformation(h.key);
    var bv = OBS.store.breezeVisual(h.key);
    var ped = OBS.store.pedigree(h.key);
    var note = OBS.store.getNote(h.key);

    return '' +
    '<tr class="detail" data-detail-for="' + esc(h.key) + '"><td colspan="13"><div class="detail-inner">' +
      '<div class="detail-block">' +
        '<h4>Why it scores what it scores</h4>' +
        '<div data-comp-block="' + esc(h.key) + '">' + componentsHtml(h) + '</div>' +

        '<h4 style="margin-top:14px">Short lists &amp; vet</h4>' +
        listChips(h.key) +
        '<div class="vet-row">' +
          vetSelect(h.key, 'vet-select vet-select-lg') +
        '</div>' +
        '<textarea class="note-box" placeholder="Notes — walk, shoulder, knees, vet findings, price ceiling…" ' +
                  'data-note="' + esc(h.key) + '">' + esc(note && note.notes || '') + '</textarea>' +

        /* The sliders sit at the bottom of this column, under the notes, so
           everything you *enter* about a horse — lists, vet, notes, the three
           ratings — is in one place, and the right column stays purely what
           the sale tells you. */
        '<h4 style="margin-top:14px">Your ratings</h4>' +
        gradeRow('Breeze visual', 'bv', h.key, bv,
          h.breezeSec === null ? 'no work' : U.formatBreeze(h.breezeSec) + ' ' + h.distLabel) +
        gradeRow('Conformation', 'conf', h.key, conf, '') +
        gradeRow('Pedigree', 'ped', h.key, ped,
          OBS.sires.reference(ctx, h) || 'no sire data') +
      '</div>' +
      '<div class="detail-block">' +
        '<h4>Hip ' + esc(h.hip) + (h.name ? ' — ' + esc(h.name) : '') + '</h4>' +
        '<dl class="kv">' +
          '<dt>Sire</dt><dd>' + esc(h.sire || '—') + '</dd>' +
          sireFacts(ctx, h.sireRaw, 'Sire book') +
          '<dt>Dam</dt><dd>' + esc(h.dam || '—') + '</dd>' +
          '<dt>BM sire</dt><dd>' + esc(h.damSire || '—') + '</dd>' +
          sireFacts(ctx, h.damSireRaw, 'BM sire book') +
          '<dt>Bred</dt><dd>' + esc(h.foalArea || '—') + '</dd>' +
          '<dt>Foaled</dt><dd>' + U.formatDate(h.foalDate) + '</dd>' +
          '<dt>Sex / colour</dt><dd>' + esc(h.sexLabel) + ' · ' + esc(h.colorLabel) + '</dd>' +
          '<dt>Consignor</dt><dd>' + esc(h.consignor || '—') + '</dd>' +
          '<dt>Barn</dt><dd>' + esc(h.barn || '—') + '</dd>' +
          '<dt>Session</dt><dd>' + esc(h.session || '—') + '</dd>' +
          '<dt>Work</dt><dd>' + (h.breezeSec === null ? 'none published'
              : U.formatBreeze(h.breezeSec) + ' at ' + esc(h.distLabel) +
                (h.breezeDate ? ' on ' + U.formatDate(h.breezeDate) : '') +
                (h.breezeSet ? ' (set ' + esc(h.breezeSet) + ')' : '')) + '</dd>' +
          (h.buyer ? '<dt>Buyer</dt><dd>' + esc(h.buyer) + '</dd>' : '') +
          (h.announcement ? '<dt>Announced</dt><dd>' + esc(h.announcement) + '</dd>' : '') +
        '</dl>' +
        '<h4 style="margin-top:12px">Sale history</h4>' +
        '<div class="hist" data-hist-for="' + esc(h.key) + '">' +
          saleHistoryHtml(h, ctx._hist && ctx._hist[h.key]) +
        '</div>' +
      '</div>' +
      mediaHtml(h, activeMedia) +
    '</div></td></tr>';
  }

  /* ------------------------------------------------------------- sire book */

  /** A sire the model is guessing at: in this sale, no racing data, no override. */
  function needsRating(key, bhEntry, saleCounts) {
    if (!saleCounts[key]) return false;
    if (OBS.store.getSireOverride(key) !== null) return false;
    return !bhEntry;
  }

  /**
   * The sire book is organised around the sires in the sale you're shopping:
   * every one of them gets a row whether or not any data exists for it, so the
   * gaps are visible and fillable.
   */
  function renderSireRows(tbody, bhIndex, marketIndex, saleCounts, query, needsOnly) {
    var q = (query || '').trim().toLowerCase();

    // Every sire in the sale, plus any rated sire matching the search.
    var keys = Object.keys(saleCounts);
    var seen = {};
    keys.forEach(function (k) { seen[k] = true; });
    if (q) {
      Object.keys(bhIndex.byName).forEach(function (n) {
        var e = bhIndex.byName[n];
        var k = e.sire.toUpperCase();
        if (!seen[k] && e.sire.toLowerCase().indexOf(q) !== -1) { keys.push(k); seen[k] = true; }
      });
    }

    var rows = keys.map(function (k) {
      var bh = OBS.bloodhorse.lookup(bhIndex, k);
      return {
        key: k,
        name: U.titleCase(k),
        inSale: saleCounts[k] || 0,
        bh: bh,
        market: marketIndex.byKey[k] || null,
        override: OBS.store.getSireOverride(k)
      };
    }).filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1) return false;
      if (needsOnly && !needsRating(r.key, r.bh, saleCounts)) return false;
      return true;
    });

    rows.sort(function (a, b) {
      if ((a.inSale > 0) !== (b.inSale > 0)) return b.inSale - a.inSale;
      var ar = a.override !== null ? a.override : (a.bh ? a.bh.rating : -1);
      var br = b.override !== null ? b.override : (b.bh ? b.bh.rating : -1);
      return br - ar || b.inSale - a.inSale;
    });

    tbody.innerHTML = rows.slice(0, 700).map(function (r) {
      var bh = r.bh, m = r.market;
      var cells;

      if (bh) {
        var d = bh.row;
        var yrs = (bh.years || []).slice().sort();
        cells =
          '<td class="bh-col">' +
            '<span class="src-chip cohort-' + esc(bh.cohort.id) + '">' + esc(bh.cohort.label) + '</span>' +
            '<span class="dim">' + esc(yrs.join('+')) + '</span>' +
          '</td>' +
          '<td class="num bh-col">' + (d.rnrs === null ? '—' : d.rnrs) + '</td>' +
          '<td class="num bh-col">' + (d.btwPct === null ? '—' : d.btwPct.toFixed(1) + '%') + '</td>' +
          '<td class="num bh-col">' + (d.gsw || 0) + '/' + (d.g1w || 0) + '</td>' +
          '<td class="num bh-col">' + U.moneyShort(d.aer) + '</td>' +
          '<td class="num bh-col">' + (d.awd === null ? '—' : d.awd.toFixed(2) + 'f') + '</td>' +
          '<td class="num"><b>' + bh.rating + '</b></td>';
      } else {
        cells = '<td class="bh-col dim" colspan="6">' +
          (bhIndex.count ? 'not on the imported lists' : 'no sire list imported') + '</td>' +
          '<td class="num dim">' + (r.override === null ? '—' : '') + '</td>';
      }

      return '<tr>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td class="num">' + (r.inSale || '') + '</td>' +
        cells +
        '<td class="num mkt-col dim">' + (m ? U.moneyShort(m.medianPrice) : '—') + '</td>' +
        '<td class="num mkt-col dim">' + (m ? Math.round(m.sellThrough * 100) + '%' : '—') + '</td>' +
        '<td class="num"><input class="sire-override" type="number" min="0" max="100" step="1" ' +
            'placeholder="–" value="' + (r.override === null ? '' : r.override) + '" ' +
            'data-sire="' + esc(r.key) + '"></td>' +
      '</tr>';
    }).join('');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="dim" style="padding:14px">No sires match.</td></tr>';
    }
  }

  /* ------------------------------------------------------------------ misc */

  function renderChips(el, active) {
    el.innerHTML = active.map(function (a) {
      return '<span class="chip">' + esc(a.text) +
        '<button data-clear-filter="' + esc(a.id) + '" title="Remove">✕</button></span>';
    }).join('');
  }

  return {
    renderWeights: renderWeights,
    renderPicker: renderPicker,
    syncPickerCount: syncPickerCount,
    renderListTabs: renderListTabs,
    renderStarTarget: renderStarTarget,
    renderPresets: renderPresets,
    listChips: listChips,
    renderRows: renderRows,
    detailHtml: detailHtml,
    componentsHtml: componentsHtml,
    saleHistoryHtml: saleHistoryHtml,
    mediaHtml: mediaHtml,
    mediaTabs: mediaTabs,
    renderSireRows: renderSireRows,
    needsRating: needsRating,
    renderChips: renderChips
  };
})();
