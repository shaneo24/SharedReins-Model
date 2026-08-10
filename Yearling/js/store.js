/* localStorage-backed persistence: conformation grades, pedigree ratings,
   notes, weights, sire rating overrides. Everything here survives a page
   reload and is exportable so a day's work on the grounds is never trapped in
   one browser.

   The namespace is deliberately its own: grades from the OBS 2YO model and
   grades from this one are different judgements about different horses, and
   should never bleed into each other. */
window.FT = window.FT || {};

FT.store = (function () {
  'use strict';

  var NS = 'ft-yearling-model.v1.';
  var mem = {}; // fallback when localStorage is unavailable (private mode, file:// lockdown)
  var hasLS = (function () {
    try { window.localStorage.setItem(NS + '__t', '1'); window.localStorage.removeItem(NS + '__t'); return true; }
    catch (e) { return false; }
  })();

  function read(key, fallback) {
    try {
      var raw = hasLS ? window.localStorage.getItem(NS + key) : mem[key];
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    var raw = JSON.stringify(value);
    if (hasLS) { try { window.localStorage.setItem(NS + key, raw); } catch (e) { mem[key] = raw; } }
    else mem[key] = raw;
  }

  /* ------------------------------------------------------------- sharing */
  /* localStorage stays the working copy and every write still lands here
     first, so the app never waits on a network to answer you. `emit` mirrors
     the same change up to the shared database when sharing is switched on.
     With the placeholders still in js/config.js this is inert and the model
     behaves exactly as it did before any of it existed.

     `absorbing` guards the other direction: applying a change that came down
     from the server must not bounce it straight back up again. */

  var absorbing = false;

  function emit(op) {
    if (absorbing) return;
    if (FT.sync && FT.sync.configured) FT.sync.push(op);
  }

  /* A rating op carries only the field it touched, never the whole record.
     Two people working the same horse from different ends — one grading the
     physical while the other reads the page — would otherwise each send a
     complete row and wipe the other's column. */
  function emitRating(key, field, value) {
    var op = { op: 'rating', key: key };
    op[field] = (value === undefined ? null : value);
    emit(op);
  }

  /* ------------------------------------------------- per-horse user ratings */
  /* Keyed "<saleCode>:<hip>" -> { conf, ped, notes, lists, vet }. */

  var notes = read('notes', {});

  function getNote(key) { return notes[key] || null; }

  function setNum(key, field, value) {
    var n = notes[key] || (notes[key] = {});
    if (value === null || value === '' || isNaN(value)) delete n[field];
    else n[field] = FT.util.clamp(parseFloat(value), 0, 10);
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
    emitRating(key, field, n[field]);
  }
  function getNum(key, field) {
    var n = notes[key];
    return n && typeof n[field] === 'number' ? n[field] : null;
  }
  function countWith(saleId, field) {
    var p = saleId + ':', n = 0;
    for (var k in notes) if (k.indexOf(p) === 0 && typeof notes[k][field] === 'number') n++;
    return n;
  }

  function conformation(key) { return getNum(key, 'conf'); }
  function setConformation(key, v) { setNum(key, 'conf', v); }
  function gradedCount(saleId) { return countWith(saleId, 'conf'); }

  /* Pedigree: your own read of the page. The sire book is there to inform it —
     it is never scored on your behalf. */
  function pedigree(key) { return getNum(key, 'ped'); }
  function setPedigree(key, v) { setNum(key, 'ped', v); }
  function pedRatedCount(saleId) { return countWith(saleId, 'ped'); }

  function setNoteText(key, text) {
    var n = notes[key] || (notes[key] = {});
    if (text) n.notes = text; else delete n.notes;
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
    emitRating(key, 'notes', text || null);
  }
  /* ----------------------------------------------------------- short lists */
  /* A horse can sit on several lists at once — "colts to see" and "over
     budget" are different thoughts about the same animal, and forcing one
     boolean to carry both loses information.

     List *definitions* are global; membership is per-horse and therefore
     inherently per-sale, since the keys carry the sale code. That way a list
     you use every year ("vet these") survives switching sales, while its
     contents don't bleed across. */

  var lists = read('lists', null);
  if (!Array.isArray(lists) || !lists.length) lists = [{ id: 'main', name: 'Short list' }];

  var activeList = read('activeList', lists[0].id);
  if (!lists.some(function (l) { return l.id === activeList; })) activeList = lists[0].id;

  function newId() {
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Earlier builds stored a single `flag: true`. Fold those into the first
     list rather than dropping them — someone may already have starred a barn's
     worth of horses. Runs once, because the flag is deleted as it goes. */
  (function migrateFlags() {
    var changed = false;
    for (var k in notes) {
      if (!notes[k].flag) continue;
      if (!Array.isArray(notes[k].lists)) notes[k].lists = [];
      if (notes[k].lists.indexOf(lists[0].id) === -1) notes[k].lists.push(lists[0].id);
      delete notes[k].flag;
      changed = true;
    }
    if (changed) write('notes', notes);
  })();

  function allLists() { return lists.slice(); }
  function getList(id) {
    return lists.filter(function (l) { return l.id === id; })[0] || null;
  }
  function listByName(name, exceptId) {
    var n = String(name || '').trim().toLowerCase();
    return lists.filter(function (l) {
      return l.name.toLowerCase() === n && l.id !== exceptId;
    })[0] || null;
  }
  /**
   * Returns `{ list, existed }`. Two tabs with the same name would be
   * indistinguishable, so a duplicate name hands back the list that already
   * has it rather than making a second — the caller says so.
   */
  function createList(name) {
    var clean = String(name || '').trim() || 'Untitled';
    var dupe = listByName(clean);
    if (dupe) return { list: dupe, existed: true };
    var l = { id: newId(), name: clean };
    lists.push(l);
    write('lists', lists);
    emit({ op: 'list', id: l.id, name: l.name });
    return { list: l, existed: false };
  }
  function renameList(id, name) {
    var l = getList(id);
    if (!l) return null;
    var clean = String(name || '').trim();
    if (!clean || listByName(clean, id)) return null;   // taken, or nothing given
    l.name = clean;
    write('lists', lists);
    emit({ op: 'list', id: l.id, name: l.name });
    return l;
  }
  /** Removing a list also removes every horse's membership of it. */
  function deleteList(id) {
    if (lists.length <= 1) return false;         // always keep one to star into
    lists = lists.filter(function (l) { return l.id !== id; });
    write('lists', lists);
    for (var k in notes) {
      if (!Array.isArray(notes[k].lists)) continue;
      var i = notes[k].lists.indexOf(id);
      if (i === -1) continue;
      notes[k].lists.splice(i, 1);
      emit({ op: 'listMember', key: k, listId: id, deleted: true });
      if (!notes[k].lists.length) delete notes[k].lists;
      if (!Object.keys(notes[k]).length) delete notes[k];
    }
    write('notes', notes);
    // Deleting the list itself last: a client that saw only this op would drop
    // the tab and its memberships together anyway, but sending the memberships
    // first means a half-delivered batch never leaves orphaned rows behind.
    emit({ op: 'list', id: id, name: '', deleted: true });
    if (activeList === id) setActiveList(lists[0].id);
    return true;
  }

  function activeListId() { return activeList; }
  function setActiveList(id) {
    if (!getList(id)) return;
    activeList = id;
    write('activeList', activeList);
  }

  function listsFor(key) {
    var n = notes[key];
    return n && Array.isArray(n.lists) ? n.lists.slice() : [];
  }
  function listNamesFor(key) {
    return listsFor(key).map(function (id) {
      var l = getList(id);
      return l ? l.name : null;
    }).filter(Boolean);
  }
  function isOnList(key, listId) { return listsFor(key).indexOf(listId) !== -1; }
  function setOnList(key, listId, on) {
    if (!getList(listId)) return;
    var n = notes[key] || (notes[key] = {});
    var arr = Array.isArray(n.lists) ? n.lists : (n.lists = []);
    var i = arr.indexOf(listId);
    if (on && i === -1) arr.push(listId);
    if (!on && i !== -1) arr.splice(i, 1);
    if (!arr.length) delete n.lists;
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
    emit({ op: 'listMember', key: key, listId: listId, deleted: !on });
  }
  function toggleOnList(key, listId) {
    var on = !isOnList(key, listId);
    setOnList(key, listId, on);
    return on;
  }
  /** On any list at all — what the ★ in the table reflects. */
  function isFlagged(key) { return listsFor(key).length > 0; }

  /* ------------------------------------------------------------ vet status */
  /* A horse moves none -> requested -> passed | failed. 'failed' is the
     scratch: it stays on the shortlist but sinks to the bottom.

     At a yearling sale this tracks what you made of the repository films as
     much as a physical exam — same four states either way. */

  var VET_STATES = ['none', 'requested', 'passed', 'failed'];
  var VET_LABELS = {
    none: 'No vet yet',
    requested: 'Films pulled',
    passed: 'Vetted clean',
    failed: 'Did not vet'
  };

  function vetStatus(key) {
    var n = notes[key];
    return n && VET_STATES.indexOf(n.vet) !== -1 ? n.vet : 'none';
  }
  function setVetStatus(key, value) {
    var n = notes[key] || (notes[key] = {});
    if (!value || value === 'none' || VET_STATES.indexOf(value) === -1) delete n.vet;
    else n.vet = value;
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
    emit({ op: 'vet', key: key, vet: n.vet || 'none' });
  }
  /** Hips from this sale on `listId` — or on any list, if listId is omitted. */
  function shortlistCount(saleId, listId) {
    var p = saleId + ':', n = 0;
    for (var k in notes) {
      if (k.indexOf(p) !== 0) continue;
      var ls = notes[k].lists;
      if (!Array.isArray(ls) || !ls.length) continue;
      if (!listId || ls.indexOf(listId) !== -1) n++;
    }
    return n;
  }
  function allNotes() { return notes; }
  function mergeNotes(incoming) {
    for (var k in incoming) {
      var merged = Object.assign({}, notes[k], incoming[k]);
      // A version-1 backup carries `flag: true` instead of a list membership.
      if (merged.flag) {
        if (!Array.isArray(merged.lists)) merged.lists = [];
        if (merged.lists.indexOf(lists[0].id) === -1) merged.lists.push(lists[0].id);
        delete merged.flag;
      }
      // Membership of a list that no longer exists would be invisible and
      // uncountable, so drop it rather than carrying a dangling id.
      if (Array.isArray(merged.lists)) {
        merged.lists = merged.lists.filter(function (id) { return !!getList(id); });
        if (!merged.lists.length) delete merged.lists;
      }
      notes[k] = merged;
    }
    write('notes', notes);
  }

  /* ----------------------------------------------------------- sire ratings */
  /* Manual 0-100 overrides, keyed by UPPERCASE sire name. */

  var sireOverrides = read('sireOverrides', {});
  function getSireOverride(name) {
    var v = sireOverrides[(name || '').toUpperCase()];
    return typeof v === 'number' ? v : null;
  }
  function setSireOverride(name, value) {
    var k = (name || '').toUpperCase();
    if (value === null || value === '' || isNaN(value)) delete sireOverrides[k];
    else sireOverrides[k] = FT.util.clamp(parseFloat(value), 0, 100);
    write('sireOverrides', sireOverrides);
    emit({ op: 'sireOverride', sire: k,
           rating: k in sireOverrides ? sireOverrides[k] : null });
  }
  function allSireOverrides() { return sireOverrides; }
  function mergeSireOverrides(incoming) {
    Object.assign(sireOverrides, incoming);
    write('sireOverrides', sireOverrides);
  }

  /* ------------------------------------------------- BloodHorse sire lists */
  /* Imported rather than fetched — BloodHorse sends no CORS headers. Kept
     separate from `notes` so a grades backup and a sire-list import are
     independent things. */

  var bhLists = read('bloodhorse', {});

  function sireLists() { return bhLists; }
  function saveSireList(list) {
    bhLists[list.id] = list;
    write('bloodhorse', bhLists);
    emit({ op: 'sireList', id: list.id, payload: list });
  }
  function removeSireList(id) {
    delete bhLists[id];
    write('bloodhorse', bhLists);
    emit({ op: 'sireList', id: id, deleted: true });
  }

  /* ------------------------------------------------------- filter presets */
  /* A named set of filters. Saved flat as JSON, so `foalFrom`/`foalTo` are
     stored as "YYYY-MM-DD" strings rather than Dates — js/filters.js owns that
     conversion, this only stores what it's handed. */

  var presets = read('filterPresets', []);
  if (!Array.isArray(presets)) presets = [];

  function allPresets() {
    return presets.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function getPreset(id) {
    return presets.filter(function (p) { return p.id === id; })[0] || null;
  }
  /** Saving under an existing name overwrites it — that's the "update" path. */
  function savePreset(name, flat) {
    var clean = String(name || '').trim();
    if (!clean) throw new Error('Give the filter a name.');
    var existing = presets.filter(function (p) {
      return p.name.toLowerCase() === clean.toLowerCase();
    })[0];
    var rec = existing || { id: newId() };
    rec.name = clean;
    rec.savedAt = new Date().toISOString();
    rec.filters = flat;
    if (!existing) presets.push(rec);
    write('filterPresets', presets);
    emit({ op: 'filterPreset', id: rec.id, name: rec.name, filters: rec.filters });
    return rec;
  }
  function deletePreset(id) {
    presets = presets.filter(function (p) { return p.id !== id; });
    write('filterPresets', presets);
    emit({ op: 'filterPreset', id: id, name: '', filters: {}, deleted: true });
  }
  /** Import merges by name, so re-importing your own export is idempotent. */
  function mergePresets(incoming) {
    var added = 0, updated = 0;
    (incoming || []).forEach(function (p) {
      if (!p || !p.name || !p.filters) return;
      var existing = presets.filter(function (x) {
        return x.name.toLowerCase() === String(p.name).toLowerCase();
      })[0];
      if (existing) {
        existing.filters = p.filters;
        existing.savedAt = p.savedAt || new Date().toISOString();
        updated++;
      } else {
        presets.push({ id: newId(), name: String(p.name), savedAt: p.savedAt || new Date().toISOString(),
                       filters: p.filters });
        added++;
      }
    });
    write('filterPresets', presets);
    return { added: added, updated: updated };
  }

  /* --------------------------------------------------------------- settings */

  function getSettings(fallback) { return Object.assign({}, fallback, read('settings', {})); }
  function setSettings(s) { write('settings', s); }

  /* ------------------------------------------------------- backup / restore */

  function exportAll() {
    return {
      _format: 'ft-yearling-model-backup',
      _version: 2,
      exportedAt: new Date().toISOString(),
      notes: notes,
      lists: lists,
      sireOverrides: sireOverrides,
      filterPresets: presets,
      settings: read('settings', {})
    };
  }

  /**
   * Restore a backup. Version 1 files predate named short lists and carry
   * `flag: true` instead; `mergeNotes` folds those into the first list.
   */
  function importAll(obj) {
    if (!obj || obj._format !== 'ft-yearling-model-backup') {
      throw new Error('Not a Fasig-Tipton yearling model backup file.');
    }
    if (Array.isArray(obj.lists) && obj.lists.length) mergeLists(obj.lists);
    if (obj.notes) mergeNotes(obj.notes);
    if (obj.sireOverrides) mergeSireOverrides(obj.sireOverrides);
    if (Array.isArray(obj.filterPresets)) mergePresets(obj.filterPresets);
    if (obj.settings) write('settings', Object.assign(read('settings', {}), obj.settings));
  }

  /** Lists come back by id, so a restore onto the same machine is a no-op. */
  function mergeLists(incoming) {
    incoming.forEach(function (l) {
      if (!l || !l.id || !l.name) return;
      var existing = getList(l.id);
      if (existing) existing.name = l.name;
      else lists.push({ id: l.id, name: String(l.name) });
    });
    write('lists', lists);
  }

  /* ------------------------------------------------- applying what came down */

  /**
   * Fold the shared database's view of the world into the local copy.
   *
   * Called on every poll that brought something back. Remote wins, with one
   * exception: a row with an edit still sitting in the outbound queue is one
   * the server has not been told about yet, so what it is holding is by
   * definition stale and must not land on top of you. That is the difference
   * between "someone else changed this while I watched" and "my own grade
   * flickered back to its old value because reception dropped".
   *
   * Returns `{ touched, keys, structural }`. `keys` is the set of horses whose
   * own values moved, which lets app.js patch just those rows in place rather
   * than rebuilding the table — the difference between a colleague's grade
   * appearing quietly and the page jumping under your hands. `structural` means
   * lists, saved filters or the sire book changed, so the chrome needs a
   * repaint and the ranking is stale.
   */
  function applyRemote(s, pending) {
    var out = { touched: false, keys: {}, structural: false };
    if (!s) return out;
    pending = pending || {};
    var touched = false;
    var keys = out.keys;

    absorbing = true;
    try {
      for (var key in s.ratings) {
        // A pending entry is either `true` (the whole horse is protected —
        // there is an unsent edit queued for it) or a set of field names, which
        // is how a note being typed right now shields itself without also
        // blocking a colleague's grade for the same horse from landing.
        var hold = pending['rating:' + key];
        if (hold === true) continue;
        hold = hold || {};

        var r = s.ratings[key];
        var n = notes[key] || {};
        var before = JSON.stringify([n.conf, n.ped, n.notes]);
        if (!hold.conf)  { if (r.conf === null) delete n.conf; else n.conf = r.conf; }
        if (!hold.ped)   { if (r.ped === null) delete n.ped;   else n.ped = r.ped; }
        if (!hold.notes) { if (r.notes) n.notes = r.notes;     else delete n.notes; }
        if (JSON.stringify([n.conf, n.ped, n.notes]) !== before) {
          touched = true; keys[key] = true;
        }
        if (Object.keys(n).length) notes[key] = n; else delete notes[key];
      }
      // A horse the server has no rating row for, but we hold grades on, was
      // rated here and never uploaded — leave it alone. It goes up on the next
      // flush rather than being deleted out from under its author.

      for (var vk in s.vet) {
        if (pending['vet:' + vk]) continue;
        var vn = notes[vk] || (notes[vk] = {});
        if (vn.vet !== s.vet[vk].vet) {
          vn.vet = s.vet[vk].vet; touched = true; keys[vk] = true;
        }
      }

      for (var lid in s.lists) {
        if (pending['list:' + lid]) continue;
        var def = s.lists[lid], have = getList(lid);
        if (def.deleted) {
          if (have && lists.length > 1) {
            lists = lists.filter(function (l) { return l.id !== lid; });
            touched = true; out.structural = true;
          }
        } else if (have) {
          if (have.name !== def.name) {
            have.name = def.name; touched = true; out.structural = true;
          }
        } else {
          lists.push({ id: lid, name: def.name });
          touched = true; out.structural = true;
        }
      }
      if (!lists.length) lists = [{ id: 'main', name: 'Short list' }];
      if (!getList(activeList)) activeList = lists[0].id;

      for (var mk in s.members) {
        for (var mlid in s.members[mk]) {
          if (pending['lm:' + mk + ':' + mlid]) continue;
          if (!getList(mlid)) continue;      // membership of a list we dropped
          var mn = notes[mk] || (notes[mk] = {});
          var arr = Array.isArray(mn.lists) ? mn.lists : (mn.lists = []);
          if (arr.indexOf(mlid) === -1) {
            arr.push(mlid); touched = true; out.structural = true; keys[mk] = true;
          }
        }
      }
      // Memberships removed elsewhere: anything we hold that the server does
      // not, and that we are not mid-way through sending.
      for (var nk in notes) {
        if (!Array.isArray(notes[nk].lists)) continue;
        notes[nk].lists = notes[nk].lists.filter(function (lid2) {
          if (pending['lm:' + nk + ':' + lid2]) return true;
          var remote = s.members[nk] && s.members[nk][lid2];
          if (!remote) { touched = true; out.structural = true; keys[nk] = true; }
          return !!remote;
        });
        if (!notes[nk].lists.length) delete notes[nk].lists;
        if (!Object.keys(notes[nk]).length) delete notes[nk];
      }

      for (var sk in s.sireOverrides) {
        if (pending['so:' + sk]) continue;
        if (sireOverrides[sk] !== s.sireOverrides[sk].rating) {
          sireOverrides[sk] = s.sireOverrides[sk].rating;
          touched = true; out.structural = true;
        }
      }

      for (var pid in s.presets) {
        if (pending['fp:' + pid]) continue;
        var rp = s.presets[pid];
        presets = presets.filter(function (p) { return p.id !== pid; });
        if (!rp.deleted) {
          presets.push({ id: pid, name: rp.name, filters: rp.filters,
                         savedAt: new Date().toISOString() });
        }
        touched = true; out.structural = true;
      }

      for (var blid in s.sireLists) {
        if (pending['sl:' + blid]) continue;
        var rb = s.sireLists[blid];
        if (rb.deleted) {
          if (bhLists[blid]) { delete bhLists[blid]; touched = true; out.structural = true; }
        } else if (JSON.stringify(bhLists[blid]) !== JSON.stringify(rb.payload)) {
          bhLists[blid] = rb.payload; touched = true; out.structural = true;
        }
      }

      if (touched) {
        write('notes', notes); write('lists', lists);
        write('sireOverrides', sireOverrides); write('filterPresets', presets);
        write('bloodhorse', bhLists); write('activeList', activeList);
      }
    } finally {
      absorbing = false;
    }
    out.touched = touched;
    return out;
  }

  /**
   * Everything held locally, as write ops.
   *
   * Sent once when a browser first joins the shared database, so a machine
   * that has been grading offline for a week contributes its work instead of
   * having it silently overwritten by the first pull. Ops are last-write-wins
   * per field, so re-sending something the server already agrees with is a
   * no-op rather than a conflict.
   */
  function localOps() {
    var ops = [];
    for (var k in notes) {
      var n = notes[k];
      if (typeof n.conf === 'number' || typeof n.ped === 'number' || n.notes) {
        var op = { op: 'rating', key: k };
        if (typeof n.conf === 'number') op.conf = n.conf;
        if (typeof n.ped === 'number') op.ped = n.ped;
        if (n.notes) op.notes = n.notes;
        ops.push(op);
      }
      if (n.vet && n.vet !== 'none') ops.push({ op: 'vet', key: k, vet: n.vet });
      (Array.isArray(n.lists) ? n.lists : []).forEach(function (lid) {
        ops.push({ op: 'listMember', key: k, listId: lid });
      });
    }
    lists.forEach(function (l) { ops.push({ op: 'list', id: l.id, name: l.name }); });
    for (var sk in sireOverrides) {
      ops.push({ op: 'sireOverride', sire: sk, rating: sireOverrides[sk] });
    }
    presets.forEach(function (p) {
      ops.push({ op: 'filterPreset', id: p.id, name: p.name, filters: p.filters });
    });
    for (var bid in bhLists) {
      ops.push({ op: 'sireList', id: bid, payload: bhLists[bid] });
    }
    return ops;
  }

  /* Local only, and deliberately so: with sharing on, this browser is a view
     of a database several people are writing to, and "reset my copy" must not
     mean "delete everyone's work". app.js disconnects sharing alongside this,
     because a local wipe followed by the next poll putting it all back would
     otherwise look like the button was broken. */
  function clearAll() {
    notes = {}; sireOverrides = {}; presets = [];
    lists = [{ id: 'main', name: 'Short list' }];
    activeList = 'main';
    write('notes', notes); write('sireOverrides', sireOverrides);
    write('filterPresets', presets); write('lists', lists);
    write('activeList', activeList); write('settings', {});
  }

  return {
    persistent: hasLS,
    getNote: getNote,
    conformation: conformation, setConformation: setConformation, gradedCount: gradedCount,
    pedigree: pedigree, setPedigree: setPedigree, pedRatedCount: pedRatedCount,
    setNoteText: setNoteText, isFlagged: isFlagged,
    allNotes: allNotes, mergeNotes: mergeNotes,
    allLists: allLists, getList: getList, createList: createList,
    renameList: renameList, deleteList: deleteList,
    activeListId: activeListId, setActiveList: setActiveList,
    listsFor: listsFor, listNamesFor: listNamesFor,
    isOnList: isOnList, setOnList: setOnList, toggleOnList: toggleOnList,
    VET_STATES: VET_STATES, VET_LABELS: VET_LABELS,
    vetStatus: vetStatus, setVetStatus: setVetStatus, shortlistCount: shortlistCount,
    sireLists: sireLists, saveSireList: saveSireList, removeSireList: removeSireList,
    getSireOverride: getSireOverride, setSireOverride: setSireOverride,
    allSireOverrides: allSireOverrides,
    allPresets: allPresets, getPreset: getPreset, savePreset: savePreset,
    deletePreset: deletePreset, mergePresets: mergePresets,
    getSettings: getSettings, setSettings: setSettings,
    exportAll: exportAll, importAll: importAll, clearAll: clearAll,
    applyRemote: applyRemote, localOps: localOps
  };
})();
