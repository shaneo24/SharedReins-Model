/* GENERATED FILE — do not edit.
   Master copy is shared/sync.js; regenerate with:
     node shared/sync-build.js
*/
/* Shared data transport.
 *
 * MASTER COPY. This file is the source of truth and is copied verbatim into
 * Yearling/js/sync.js and Two-Year-Old/js/sync.js, which differ only in the
 * two constants at the top of the IIFE (namespace object and app id). If you
 * change one, run shared/sync-build.js to push it to both.
 *
 * WHAT THIS IS
 *
 *   Everything the models store used to live in localStorage, which is a box
 *   on one machine in one browser. This puts the shared parts in a database
 *   so four people walking the same barn see the same short list.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 *   It is not a replacement for localStorage — it sits behind it. Every write
 *   still lands locally first and the app never waits on the network to
 *   respond to you. Sale grounds have famously bad reception; a tool that
 *   stalls when the bars drop is worse than one that never synced at all.
 *   Offline writes queue and go up when there is signal.
 *
 * NO DEPENDENCIES
 *
 *   Both server functions are reachable over plain POST, so there is no SDK
 *   and no CDN script — the app stays classic scripts that run from file://.
 *   Live updates are a poll rather than a websocket: sr_read with a `since`
 *   cursor is an indexed timestamp scan that returns an empty array almost
 *   every time, and at the handful of people this is built for the difference
 *   from a socket is not observable.
 */
window.__SR_SYNC__ = function (NS, APP) {
  'use strict';

  /* ------------------------------------------------------------ constants */

  var LS = 'shared-reins.sync.' + APP + '.';

  var POLL_ACTIVE = 5000;    // tab in front of you
  var POLL_HIDDEN = 30000;   // tab in the background — still live, just calmer
  var PUSH_DEBOUNCE = 600;   // a slider drag is one write, not forty
  var RETRY_MAX = 60000;

  /* --------------------------------------------------------------- config */
  /* Filled in by js/config.js. Absent or still on the placeholders means the
     app runs exactly as it always did: local-only, no network, no prompts. */

  var cfg = (window.SHARED_REINS_CONFIG || {});
  var configured = !!(cfg.url && cfg.anonKey &&
                      cfg.url.indexOf('YOUR-PROJECT') === -1 &&
                      cfg.anonKey.indexOf('YOUR-ANON-KEY') === -1);

  /* ----------------------------------------------------------- local state */

  function lsGet(k, fallback) {
    try {
      var raw = window.localStorage.getItem(LS + k);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {}
  }
  function lsDel(k) {
    try { window.localStorage.removeItem(LS + k); } catch (e) {}
  }

  var code    = lsGet('code', null);      // the access code, once accepted
  var label   = lsGet('name', null);      // display name as typed
  var cursor  = lsGet('cursor', null);    // server clock of our last good read
  var queue   = lsGet('queue', []);       // ops written offline, not yet up
  var snap    = lsGet('snap', emptySnap());  // last known remote state

  var status  = !configured ? 'off' : (code ? 'connecting' : 'locked');
  var lastError = null;
  var listeners = [];
  var pollTimer = null, pushTimer = null, retryDelay = 1000;
  var inFlight = false;

  function emptySnap() {
    return {
      ratings: {},        // horseKey -> { conf, ped, breeze, notes, by }
      vet: {},            // horseKey -> { vet, by }
      lists: {},          // id -> { name, deleted }
      members: {},        // horseKey -> listId -> { by, deleted }
      sireOverrides: {},  // SIRE -> { rating, by }
      presets: {},        // id -> { name, filters, by, deleted }
      sireLists: {}       // id -> { payload, deleted }
    };
  }

  /* The display name is optional and carries no weight: it is recorded
     against a change so a number that moves under you says who moved it.
     Sharing works perfectly well with it blank. */

  /* ------------------------------------------------------------ listeners */

  function emit(what) {
    listeners.forEach(function (fn) {
      try { fn(what); } catch (e) { /* a bad listener must not stop the rest */ }
    });
  }
  function setStatus(s, err) {
    if (s === status && !err) return;
    status = s;
    lastError = err || null;
    emit('status');
  }

  /* ---------------------------------------------------------------- fetch */

  function rpc(fn, body) {
    return window.fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        throw badCode('Access code not accepted.');
      }
      return res.text().then(function (text) {
        var parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          // Postgres raises 28000 for a bad code; PostgREST forwards it as the
          // error `code`. Anything else is a genuine fault worth surfacing.
          var msg = (parsed && (parsed.message || parsed.hint)) || ('HTTP ' + res.status);
          if (parsed && parsed.code === '28000') throw badCode('Access code not accepted.');
          throw new Error(msg);
        }
        return parsed;
      });
    }).catch(function (e) {
      if (e && (e.badCode || e.reachable === false)) throw e;
      // fetch rejects with a bare TypeError for DNS failure, no connection and
      // a CORS refusal alike. "Failed to fetch" in front of someone at a sale
      // is no use; name the two things actually worth checking.
      if (e instanceof TypeError) {
        var net = new Error('Could not reach the shared database. Check your ' +
                            'connection, and that the URL in js/config.js is right.');
        net.reachable = false;
        throw net;
      }
      throw e;
    });
  }

  function badCode(msg) {
    var e = new Error(msg);
    e.badCode = true;
    return e;
  }

  /* ----------------------------------------------------------- normalising */
  /* The server hands back rows; the app wants maps. Applying a delta on top of
     the existing snapshot is what makes the `since` cursor worth having. */

  function applyRows(payload) {
    var s = snap;

    (payload.ratings || []).forEach(function (r) {
      var v = {
        conf: numOrNull(r.conf),
        ped: numOrNull(r.ped),
        breeze: numOrNull(r.breeze),
        notes: r.notes || '',
        by: r.updated_by || ''
      };
      // A row stripped of every field is a rating withdrawn, not an empty one.
      // Keeping the husk would leave the horse looking rated.
      if (v.conf === null && v.ped === null && v.breeze === null && !v.notes) {
        delete s.ratings[r.horse_key];
      } else {
        s.ratings[r.horse_key] = v;
      }
    });

    (payload.horseShared || []).forEach(function (r) {
      if (!r.vet || r.vet === 'none') delete s.vet[r.horse_key];
      else s.vet[r.horse_key] = { vet: r.vet, by: r.vet_by || '' };
    });

    (payload.lists || []).forEach(function (r) {
      s.lists[r.id] = { name: r.name, deleted: !!r.deleted };
    });

    (payload.listMembers || []).forEach(function (r) {
      var byKey = s.members[r.horse_key] || (s.members[r.horse_key] = {});
      if (r.deleted) {
        delete byKey[r.list_id];
        if (!Object.keys(byKey).length) delete s.members[r.horse_key];
      } else {
        byKey[r.list_id] = { by: r.added_by || '' };
      }
    });

    (payload.sireOverrides || []).forEach(function (r) {
      if (r.rating === null || r.rating === undefined) delete s.sireOverrides[r.sire];
      else s.sireOverrides[r.sire] = { rating: Number(r.rating), by: r.set_by || '' };
    });

    (payload.filterPresets || []).forEach(function (r) {
      s.presets[r.id] = {
        name: r.name, filters: r.filters, by: r.saved_by || '', deleted: !!r.deleted
      };
    });

    (payload.sireLists || []).forEach(function (r) {
      s.sireLists[r.id] = { payload: r.payload, deleted: !!r.deleted };
    });

    lsSet('snap', snap);
  }

  function numOrNull(v) {
    return (v === null || v === undefined || v === '') ? null : Number(v);
  }

  /* ------------------------------------------------------------- the pull */

  function pull() {
    if (!canSync() || inFlight) return Promise.resolve(false);
    inFlight = true;

    return rpc('sr_read', { p_code: code, p_app: APP, p_since: cursor })
      .then(function (payload) {
        inFlight = false;
        retryDelay = 1000;
        if (!payload) { setStatus('live'); return false; }

        var changed = countRows(payload) > 0;
        applyRows(payload);
        // Rewind a second: two writes inside the same clock tick, one of them
        // landing after our read started, would otherwise never be seen again.
        cursor = new Date(new Date(payload.now).getTime() - 1000).toISOString();
        lsSet('cursor', cursor);

        setStatus('live');
        if (changed) emit('data');
        return changed;
      })
      .catch(function (err) {
        inFlight = false;
        if (err.badCode) { lockOut(); return false; }
        setStatus('offline', err);
        return false;
      });
  }

  function countRows(p) {
    var n = 0;
    ['ratings', 'horseShared', 'lists', 'listMembers',
     'sireOverrides', 'filterPresets', 'sireLists'].forEach(function (k) {
      n += (p[k] || []).length;
    });
    return n;
  }

  /* ------------------------------------------------------------- the push */

  /**
   * Queue an op. Ops are coalesced on their identity, so dragging a slider
   * across a range sends the value you settled on rather than every value it
   * passed through on the way.
   */
  function push(op) {
    if (!configured) return;
    var id = opId(op);
    for (var i = 0; i < queue.length; i++) {
      if (opId(queue[i]) === id) { queue[i] = mergeOp(queue[i], op); schedulePush(); return; }
    }
    queue.push(op);
    lsSet('queue', queue);
    schedulePush();
  }

  function opId(op) {
    switch (op.op) {
      case 'rating':       return 'rating:' + op.key;
      case 'vet':          return 'vet:' + op.key;
      case 'list':         return 'list:' + op.id;
      case 'listMember':   return 'lm:' + op.key + ':' + op.listId;
      case 'sireOverride': return 'so:' + op.sire;
      case 'filterPreset': return 'fp:' + op.id;
      case 'sireList':     return 'sl:' + op.id;
      default:             return 'x:' + Math.random();
    }
  }

  /* A queued rating op carries only the fields it touched, and so does the new
     one — grading conformation then typing a note must send both, not the
     second alone. */
  function mergeOp(oldOp, newOp) {
    return Object.assign({}, oldOp, newOp);
  }

  function schedulePush() {
    lsSet('queue', queue);
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, PUSH_DEBOUNCE);
  }

  function flush() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (!canSync() || !queue.length) return Promise.resolve();

    var sending = queue.slice();
    return rpc('sr_write', {
      p_code: code, p_app: APP, p_who: label || null, p_ops: sending
    })
      .then(function () {
        // Drop exactly what went up. Anything queued while the request was in
        // flight stays put rather than being silently discarded.
        queue = queue.filter(function (q) {
          return sending.indexOf(q) === -1;
        });
        lsSet('queue', queue);
        retryDelay = 1000;
        setStatus('live');
        return pull();   // pick up our own row plus anything that raced us
      })
      .catch(function (err) {
        if (err.badCode) { lockOut(); return; }
        setStatus('offline', err);
        // Keep the queue and try again later — this is the bad-reception path,
        // and dropping a morning's grading here would be unforgivable.
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
        setTimeout(flush, retryDelay);
      });
  }

  /* --------------------------------------------------------------- access */

  function canSync() {
    return configured && !!code;
  }

  function lockOut() {
    code = null;
    lsDel('code');
    setStatus('locked', badCode('Access code not accepted.'));
  }

  /**
   * Try a code against the server. Only a successful read stores it.
   *
   * Resolves with `{ firstJoin }`. That flag matters: a device joining for the
   * first time may hold offline work that exists nowhere else and must be
   * contributed, whereas a device coming *back* — after the code was rotated,
   * say — holds a copy the server has already seen and possibly moved past.
   * Re-uploading the latter would roll back whatever changed in the meantime.
   */
  function unlock(candidate) {
    if (!configured) return Promise.reject(new Error('Sharing is not configured.'));
    var trimmed = String(candidate || '').trim();
    if (!trimmed) return Promise.reject(new Error('Enter the access code.'));

    // Read before the successful pull overwrites it.
    var firstJoin = !cursor;

    return rpc('sr_read', { p_code: trimmed, p_app: APP, p_since: null })
      .then(function (payload) {
        code = trimmed;
        lsSet('code', code);
        applyRows(payload || {});
        cursor = payload ? new Date(new Date(payload.now).getTime() - 1000).toISOString() : null;
        lsSet('cursor', cursor);
        setStatus('live');
        emit('data');
        start();
        return { firstJoin: firstJoin };
      });
  }

  /** Purely cosmetic — see the note by `label`. Blank is allowed. */
  function setIdentity(name) {
    label = String(name || '').trim().slice(0, 40) || null;
    if (label) lsSet('name', label); else lsDel('name');
    emit('identity');
    return true;
  }

  function signOut() {
    code = null; queue = []; cursor = null; snap = emptySnap();
    lsDel('code'); lsDel('queue'); lsDel('cursor'); lsDel('snap');
    setStatus(configured ? 'locked' : 'off');
    emit('data');
  }

  /* ---------------------------------------------------------------- timing */

  function start() {
    if (!canSync()) return;
    stop();
    pull();
    schedulePoll();
  }
  function stop() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }
  function schedulePoll() {
    stop();
    var hidden = (typeof document !== 'undefined' && document.hidden);
    pollTimer = setTimeout(function () {
      pull().then(schedulePoll, schedulePoll);
    }, hidden ? POLL_HIDDEN : POLL_ACTIVE);
  }

  if (typeof document !== 'undefined') {
    // Coming back to the tab should feel instant, not "wait up to 30 seconds".
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && canSync()) { pull(); }
      schedulePoll();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { if (canSync()) { flush(); pull(); } });
    // Best-effort last flush. Not relied upon — the queue is already on disk.
    window.addEventListener('pagehide', function () { flush(); });
  }

  /* ------------------------------------------------------------------ read */

  function ratingFor(key) { return snap.ratings[key] || null; }

  /** Who last touched a shared value, for the "changed by" line in the UI. */
  function creditFor(kind, key) {
    var row = kind === 'vet' ? snap.vet[key] : snap.ratings[key];
    return (row && row.by) || '';
  }

  return {
    APP: APP,
    configured: configured,
    status: function () { return status; },
    error: function () { return lastError; },
    identity: function () { return label || ''; },
    setIdentity: setIdentity,
    unlock: unlock,
    signOut: signOut,
    onChange: function (fn) { listeners.push(fn); },
    start: start,
    pull: pull,
    push: push,
    flush: flush,
    pending: function () { return queue.length; },
    /* Which rows have local edits that have not gone up yet. The store uses
       this to decide a merge: an unsent local edit is newer than anything the
       server can be holding, so it wins and must not be overwritten by the
       pull that is about to land on top of it. */
    pendingIds: function () {
      var out = {};
      queue.forEach(function (q) { out[opId(q)] = true; });
      return out;
    },
    data: function () { return snap; },
    ratingFor: ratingFor,
    creditFor: creditFor
  };
};

window.OBS = window.OBS || {};
OBS.sync = window.__SR_SYNC__(window.OBS, 'twoyo');
