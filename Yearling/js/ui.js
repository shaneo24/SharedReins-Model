/* Rendering. Pure-ish: builds markup from state, leaves event wiring to app.js
   (which uses delegation, so hundreds of rows stay cheap). */
window.FT = window.FT || {};

FT.ui = (function () {
  'use strict';
  var U = FT.util;
  var esc = U.escapeHtml;

  /* --------------------------------------------------------------- weights */

  function renderWeights(container, settings) {
    var total = FT.scoring.COMPONENTS.reduce(function (a, c) {
      return a + (Number(settings.weights[c.id]) || 0);
    }, 0);

    container.innerHTML = FT.scoring.COMPONENTS.map(function (c) {
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

  /* ---------------------------------------------------------- name prompt */

  /**
   * One small modal, shared by "new list", "rename list" and "save filter".
   * Resolves with the trimmed name, or null if cancelled. `window.prompt` would
   * have done the job, but it's blocked in enough places (and looks enough like
   * a phishing box) that a real dialog is worth twenty lines.
   */
  function askName(opts) {
    var modal = document.getElementById('promptModal');
    var input = document.getElementById('promptInput');
    document.getElementById('promptTitle').textContent = opts.title || 'Name';
    document.getElementById('promptLabel').textContent = opts.label || 'Name';
    document.getElementById('promptNote').textContent = opts.note || '';
    document.getElementById('promptOk').textContent = opts.ok || 'Save';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    modal.hidden = false;
    input.focus();
    input.select();

    return new Promise(function (resolve) {
      function done(value) {
        modal.hidden = true;
        modal.removeEventListener('click', onClick);
        input.removeEventListener('keydown', onKey);
        resolve(value);
      }
      function onClick(e) {
        if (e.target === modal || e.target.id === 'promptCancel' || e.target.id === 'promptClose') done(null);
        else if (e.target.id === 'promptOk') {
          var v = input.value.trim();
          if (v) done(v);
          else input.focus();
        }
      }
      function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); var v = input.value.trim(); if (v) done(v); }
        else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      }
      modal.addEventListener('click', onClick);
      input.addEventListener('keydown', onKey);
    });
  }

  /* -------------------------------------------------------- filter presets */

  function renderPresets(sel, presets, activeId) {
    sel.innerHTML = '<option value="">' +
        (presets.length ? 'Saved filters…' : 'No saved filters yet') + '</option>' +
      presets.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === activeId ? ' selected' : '') + '>' +
          esc(p.name) + '</option>';
      }).join('');
    sel.value = activeId && presets.some(function (p) { return p.id === activeId; }) ? activeId : '';
  }

  /* -------------------------------------------------------------- the tabs */

  /** One tab per short list, with its count for the sale you're shopping. */
  function renderListTabs(container, lists, saleId, activeListId, onList) {
    container.innerHTML = lists.map(function (l) {
      var n = saleId ? FT.store.shortlistCount(saleId, l.id) : 0;
      return '<button class="tab' + (onList && l.id === activeListId ? ' is-on' : '') + '" ' +
        'data-tab="list" data-list="' + esc(l.id) + '">' + esc(l.name) +
        '<span class="tab-count">' + n + '</span></button>';
    }).join('');
  }

  /** The "★ to" picker — which list the star in each row drops a horse onto. */
  function renderStarTarget(sel, lists, activeListId) {
    sel.innerHTML = lists.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === activeListId ? ' selected' : '') + '>' +
        esc(l.name) + '</option>';
    }).join('');
    sel.value = activeListId;
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
   * has already flipped the checkbox, and the per-item counts are facets of the
   * whole sale, not of the filtered set. Redrawing the picker for that would
   * replace the scroller and bounce you back to the top of a 150-sire list on
   * every click, so it doesn't.
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

  /* ------------------------------------------------------------------ rows */

  function scoreTier(v) {
    if (v === null || v === undefined) return 't3';
    if (v >= 68) return 't1';
    if (v >= 45) return 't2';
    return 't3';
  }

  function resultCell(h) {
    if (h.status === 'out') return '<span class="tag tag-out">OUT</span>';
    if (h.sold) return '<span class="tag tag-sold">' + U.moneyShort(h.price) + '</span>';
    if (h.rna) return '<span class="tag tag-rna">RNA ' + (h.bidTo ? U.moneyShort(h.bidTo) : '') + '</span>';
    return '<span class="dim">—</span>';
  }

  /* What a hip brings with it before you've looked at anything: films lodged in
     the repository, a walk video, and whether the page has been updated since
     the catalog was printed. All three change what's worth walking to. */
  function evidenceCell(h) {
    var bits = [];
    if (h.hasXray) {
      bits.push('<span class="ev ev-xray" title="Repository films lodged' +
        (h.repoUpdated ? ' — last updated ' + esc(h.repoUpdated) : '') + '">X</span>');
    }
    if (h.hasWalkVideo) bits.push('<span class="ev ev-vid" title="Walk video">▶</span>');
    if (h.hasUpdate) {
      bits.push('<span class="ev ev-upd" title="Catalog page updated' +
        (h.updateDate ? ' ' + esc(h.updateDate) : '') + '">U</span>');
    }
    return bits.length ? bits.join('') : '<span class="dim">—</span>';
  }

  function vetSelect(key, cls) {
    var v = FT.store.vetStatus(key);
    return '<select class="' + cls + ' vet-' + v + '" data-vet="' + esc(key) + '">' +
      FT.store.VET_STATES.map(function (s) {
        return '<option value="' + s + '"' + (s === v ? ' selected' : '') + '>' +
          esc(s === 'none' ? '—' : FT.store.VET_LABELS[s]) + '</option>';
      }).join('') +
    '</select>';
  }

  /** The sire book's number, shown beside the sire's name as reference. */
  function sireBadge(h, ctx) {
    var s = FT.sires.lookup(ctx, h.sireRaw);
    if (!s || s.value === null) return '';
    return ' <span class="sire-badge' + (s.source === 'yours' ? ' is-yours' : '') + '" ' +
      'title="Sire book rating — reference only, not part of the score">' + s.value + '</span>';
  }

  function rowHtml(h, rank, ctx) {
    var s = h._score || { total: null, components: [] };
    var total = s.total;
    var conf = FT.store.conformation(h.key);
    var ped = FT.store.pedigree(h.key);
    var flagged = FT.store.isFlagged(h.key);
    var scratched = FT.store.vetStatus(h.key) === 'failed';

    return '' +
    '<tr class="hrow' + (h.status === 'out' ? ' is-out' : '') +
        (scratched ? ' is-scratched' : '') + '" data-key="' + esc(h.key) + '">' +
      '<td class="c-rank">' + rank + '</td>' +
      '<td class="c-score">' +
        '<div class="score-cell ' + scoreTier(total) + '">' +
          '<span class="score-num">' + (total === null ? '—' : total.toFixed(0)) + '</span>' +
          '<span class="score-bar"><i style="width:' + (total === null ? 0 : U.clamp(total, 0, 100)) + '%"></i></span>' +
        '</div>' +
      '</td>' +
      '<td class="c-hip"><span class="hip-num">' + esc(h.hip) + '</span>' +
        '<div class="hip-sub">Barn ' + esc(h.barn || '—') + '</div></td>' +
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
      '<td class="c-conf">' +
        '<input class="conf-input' + (conf !== null ? ' is-set' : '') + '" type="number" ' +
               'min="0" max="10" step="0.5" placeholder="–" ' +
               'value="' + (conf === null ? '' : conf) + '" data-conf="' + esc(h.key) + '">' +
      '</td>' +
      '<td class="c-ev">' + evidenceCell(h) + '</td>' +
      '<td class="c-foal">' + U.formatDate(h.foalDate) + '</td>' +
      '<td class="c-sex">' + esc(h.sexLabel) + '</td>' +
      '<td class="c-cons">' + esc(h.consignorSort || '—') + '</td>' +
      '<td class="c-vet">' + vetSelect(h.key, 'vet-select') + '</td>' +
      '<td class="c-result">' + resultCell(h) + '</td>' +
      '<td class="c-flag">' +
        '<button class="flag-btn' + (flagged ? ' is-on' : '') + '" data-flag="' + esc(h.key) + '" ' +
                'title="' + esc(flagged ? 'On: ' + FT.store.listNamesFor(h.key).join(', ')
                                        : 'Add to the list the ★ picker is set to') + '">' +
          (flagged ? '★' : '☆') + '</button>' +
      '</td>' +
    '</tr>';
  }

  /* Renders the whole filtered set — no paging. A search that silently omits a
     match is worse than any render cost, and a Fasig-Tipton yearling sale is a
     few hundred hips, not a few thousand. */
  function renderRows(tbody, horses, ctx) {
    tbody.innerHTML = horses.map(function (h, i) { return rowHtml(h, i + 1, ctx); }).join('');
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
     leads because it's small and it's what you look at first; the walk video
     is a Vimeo embed that only starts streaming once you open its tab. */
  function mediaTabs(h) {
    var tabs = [];
    if (h.photoLink) tabs.push({ id: 'photo', label: 'Photo', url: h.photoLink });
    if (h.pedigreeLink) tabs.push({ id: 'page', label: 'Catalog page', url: h.pedigreeLink });
    if (h.walkVideoId) {
      tabs.push({
        id: 'walk', label: 'Walk video', heavy: true,
        url: h.walkVideoLink,
        embed: 'https://player.vimeo.com/video/' + h.walkVideoId + '?app_id=122963'
      });
    }
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
    return '<iframe class="vimeo" src="' + esc(tab.embed) + '" title="Walk video" ' +
           'allow="fullscreen; picture-in-picture" allowfullscreen></iframe>';
  }

  /**
   * @param {String} active  media tab id to show; '' means none open yet.
   */
  function mediaHtml(h, active) {
    var tabs = mediaTabs(h);
    if (!tabs.length) return '<div class="detail-block detail-media"><h4>Media</h4>' +
      '<div class="media-hint">No photo, catalog page or walk video for this hip.</div></div>';

    var current = tabs.filter(function (t) { return t.id === active; })[0] || null;

    var buttons = tabs.map(function (t) {
      return '<button class="media-tab' + (current && t.id === current.id ? ' is-on' : '') + '" ' +
        'data-media-tab="' + t.id + '" data-media-key="' + esc(h.key) + '">' +
        esc(t.label) + (t.heavy ? '<span class="media-heavy" title="Streams from Vimeo once you open this tab">streams</span>' : '') +
      '</button>';
    }).join('');

    var openLink = current
      ? '<a class="media-open" href="' + esc(current.url) + '" target="_blank" rel="noopener">open full size ↗</a>'
      : '';

    return '<div class="detail-block detail-media">' +
      '<h4>Media</h4>' +
      '<div class="media-tabs">' + buttons + openLink + '</div>' +
      (current
        ? '<div class="media-pane media-' + current.id + '">' + mediaPane(current) + '</div>'
        : '<div class="media-hint">Pick one above — nothing is downloaded until you do.</div>') +
    '</div>';
  }

  /**
   * A toggle per short list. The ★ in the table is the fast path and always
   * targets one list; this is where you say "and also put it on the vet list"
   * without changing what the star is pointed at.
   */
  function listChips(key) {
    return '<div class="list-chips" data-list-chips="' + esc(key) + '">' +
      FT.store.allLists().map(function (l) {
        var on = FT.store.isOnList(key, l.id);
        return '<button class="list-chip' + (on ? ' is-on' : '') + '" ' +
          'data-toggle-list="' + esc(l.id) + '" data-key="' + esc(key) + '">' +
          (on ? '★ ' : '☆ ') + esc(l.name) + '</button>';
      }).join('') +
    '</div>';
  }

  /** One 0-10 slider. `kind` is 'conf' or 'ped' — it drives the data-attrs. */
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
    var s = FT.sires.lookup(ctx, name);
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
      bits.push('yearling median ' + U.moneyShort(s.market.medianPrice));
    }
    return bits.length ? '<dt>' + esc(label) + '</dt><dd class="dim">' + esc(bits.join(' · ')) + '</dd>' : '';
  }

  /* The repository is the x-ray and scope set a consignor lodges before the
     sale. It never scores anything — it tells you whether there is something
     to send your vet to, which is the question you actually have. */
  function repositoryHtml(h) {
    if (!h.hasXray && !h.repoDocs.length) {
      return '<div class="hist-line dim">Nothing lodged in the repository.</div>';
    }
    var bits = [];
    if (h.hasXray) bits.push('X-rays lodged');
    h.repoDocs.forEach(function (d) { bits.push(d); });
    return '<div class="hist-line">' + esc(bits.join(' · ')) +
      (h.repoUpdated ? ' <span class="dim">· updated ' + esc(h.repoUpdated) + '</span>' : '') +
      '</div>';
  }

  /* Fasig-Tipton posts page updates right up to the hammer — a half-brother
     winning a stakes last week is not in the printed catalog but is very much
     part of the page you're rating. */
  function updateHtml(h) {
    if (!h.hasUpdate) return '';
    return '<h4 style="margin-top:12px">Catalog update' +
      (h.updateDate ? ' <span class="dim" style="text-transform:none;letter-spacing:0">' +
        esc(h.updateDate) + '</span>' : '') + '</h4>' +
      '<div class="update-box">' + esc(h.update) + '</div>';
  }

  /** Where this horse has been sold before. Filled in asynchronously. */
  function saleHistoryHtml(h, state) {
    if (!state) {
      return '<div class="hist-line dim">Looking up sale history…</div>';
    }
    var rows = FT.saleHistory.sortEntries(state.entries || []);

    /* "Nothing found" only means "never sold before" when every source
       actually answered. With the Keeneland proxy missing — which is the
       normal state on static hosting — a weanling bought at Keeneland November
       looks identical to one that has never been through a ring, and claiming
       the latter would be a lie the note underneath doesn't undo. */
    var partial = state.keeneland !== 'ok';

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
      : (partial
          ? '<div class="hist-line dim">Nothing at Fasig-Tipton. Keeneland wasn\'t checked, ' +
            'so this horse may still have sold as a weanling.</div>'
          : '<div class="hist-line dim">No prior sale found — this looks like a first trip ' +
            'through the ring.</div>');

    var note = '';
    if (state.keeneland === 'unavailable') {
      note = '<div class="hist-line dim">Keeneland needs the local server — ' +
             'run <code>node serve.js</code> and open it there to include Keeneland November, ' +
             'where most of this crop\'s weanlings sold.</div>';
    } else if (state.keeneland === 'error') {
      note = '<div class="hist-line dim">Keeneland lookup failed: ' + esc(state.error || '') + '</div>';
    }
    return body + note;
  }

  function detailHtml(h, ctx, activeMedia) {
    var conf = FT.store.conformation(h.key);
    var ped = FT.store.pedigree(h.key);
    var note = FT.store.getNote(h.key);

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
        '<h4 style="margin-top:12px">Repository</h4>' +
        repositoryHtml(h) +
        '<textarea class="note-box" placeholder="Notes — walk, shoulder, knees, films, price ceiling…" ' +
                  'data-note="' + esc(h.key) + '">' + esc(note && note.notes || '') + '</textarea>' +
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
          '<dt>Session</dt><dd>' + esc(h.sessionLabel || '—') + '</dd>' +
          (h.status === 'out'
            ? '<dt>Out</dt><dd>' + (h.outDate ? U.formatDate(h.outDate) : 'withdrawn') + '</dd>' : '') +
          (h.buyer ? '<dt>Buyer</dt><dd>' + esc(h.buyer) + '</dd>' : '') +
        '</dl>' +
        updateHtml(h) +
        '<h4 style="margin-top:12px">Sale history</h4>' +
        '<div class="hist" data-hist-for="' + esc(h.key) + '">' +
          saleHistoryHtml(h, ctx._hist && ctx._hist[h.key]) +
        '</div>' +
        '<h4 style="margin-top:12px">Your ratings</h4>' +
        gradeRow('Conformation', 'conf', h.key, conf,
          h.hasWalkVideo ? 'photo + walk video' : (h.hasPhoto ? 'photo only' : 'no media')) +
        gradeRow('Pedigree', 'ped', h.key, ped,
          FT.sires.reference(ctx, h) || 'no sire data') +
      '</div>' +
      mediaHtml(h, activeMedia) +
    '</div></td></tr>';
  }

  /* ------------------------------------------------------------- sire book */

  /** A sire the model is guessing at: in this sale, no racing data, no override. */
  function needsRating(key, bhEntry, saleCounts) {
    if (!saleCounts[key]) return false;
    if (FT.store.getSireOverride(key) !== null) return false;
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
      var bh = FT.bloodhorse.lookup(bhIndex, k);
      return {
        key: k,
        name: U.titleCase(k),
        inSale: saleCounts[k] || 0,
        bh: bh,
        market: marketIndex.byKey[k] || null,
        override: FT.store.getSireOverride(k)
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
    askName: askName,
    renderPresets: renderPresets,
    renderListTabs: renderListTabs,
    renderStarTarget: renderStarTarget,
    listChips: listChips,
    renderWeights: renderWeights,
    renderPicker: renderPicker,
    syncPickerCount: syncPickerCount,
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
