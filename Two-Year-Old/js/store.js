/* localStorage-backed persistence: conformation grades, notes, weights,
   sire rating overrides. Everything here survives a page reload and is
   exportable so a day's ringside work is never trapped in one browser. */
window.OBS = window.OBS || {};

OBS.store = (function () {
  'use strict';

  var NS = 'obs-model.v1.';
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

  /* ------------------------------------------------- per-horse user ratings */
  /* Keyed "<saleId>:<hip>" -> { conf, notes, flag } where conf is 0-10. */

  var notes = read('notes', {});

  function getNote(key) { return notes[key] || null; }
  function conformation(key) {
    var n = notes[key];
    return n && typeof n.conf === 'number' ? n.conf : null;
  }
  function setConformation(key, value) {
    var n = notes[key] || (notes[key] = {});
    if (value === null || value === '' || isNaN(value)) delete n.conf;
    else n.conf = OBS.util.clamp(parseFloat(value), 0, 10);
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
  }
  /* Breeze visual: what you thought of the horse *watching* the work, as
     opposed to what the stopwatch said. Same 0-10 scale as conformation. */
  function breezeVisual(key) {
    var n = notes[key];
    return n && typeof n.bv === 'number' ? n.bv : null;
  }
  function setBreezeVisual(key, value) {
    var n = notes[key] || (notes[key] = {});
    if (value === null || value === '' || isNaN(value)) delete n.bv;
    else n.bv = OBS.util.clamp(parseFloat(value), 0, 10);
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
  }
  function watchedCount(saleId) {
    var p = saleId + ':', n = 0;
    for (var k in notes) if (k.indexOf(p) === 0 && typeof notes[k].bv === 'number') n++;
    return n;
  }

  /* Pedigree: your own read of the page. The sire book is there to inform it —
     it is never scored on your behalf. */
  function pedigree(key) {
    var n = notes[key];
    return n && typeof n.ped === 'number' ? n.ped : null;
  }
  function setPedigree(key, value) {
    var n = notes[key] || (notes[key] = {});
    if (value === null || value === '' || isNaN(value)) delete n.ped;
    else n.ped = OBS.util.clamp(parseFloat(value), 0, 10);
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
  }
  function pedRatedCount(saleId) {
    var p = saleId + ':', n = 0;
    for (var k in notes) if (k.indexOf(p) === 0 && typeof notes[k].ped === 'number') n++;
    return n;
  }

  function setNoteText(key, text) {
    var n = notes[key] || (notes[key] = {});
    if (text) n.notes = text; else delete n.notes;
    if (!Object.keys(n).length) delete notes[key];
    write('notes', notes);
  }
  /* ----------------------------------------------------------- short lists */
  /* A horse can sit on several lists at once — "colts to see" and "over
     budget" are different thoughts about the same animal, and forcing one
     boolean to carry both loses information.

     List *definitions* are global; membership is per-horse and therefore
     inherently per-sale, since the keys carry the sale id. A list you use
     every year ("vet these") survives switching sales; its contents don't. */

  var lists = read('lists', null);
  if (!Array.isArray(lists) || !lists.length) lists = [{ id: 'main', name: 'Short list' }];

  var activeList = read('activeList', lists[0].id);
  if (!lists.some(function (l) { return l.id === activeList; })) activeList = lists[0].id;

  function newId() {
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Earlier builds stored a single `flag: true`. Fold those into the first
     list rather than dropping them — a barn's worth of stars may already be
     recorded. Runs once, because the flag is deleted as it goes. */
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
    return { list: l, existed: false };
  }
  function renameList(id, name) {
    var l = getList(id);
    if (!l) return null;
    var clean = String(name || '').trim();
    if (!clean || listByName(clean, id)) return null;   // taken, or nothing given
    l.name = clean;
    write('lists', lists);
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
      if (i !== -1) notes[k].lists.splice(i, 1);
      if (!notes[k].lists.length) delete notes[k].lists;
      if (!Object.keys(notes[k]).length) delete notes[k];
    }
    write('notes', notes);
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
     scratch: it stays on the shortlist but sinks to the bottom. */

  var VET_STATES = ['none', 'requested', 'passed', 'failed'];
  var VET_LABELS = {
    none: 'No vet yet',
    requested: 'Report requested',
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
  function gradedCount(saleId) {
    var p = saleId + ':', n = 0;
    for (var k in notes) if (k.indexOf(p) === 0 && typeof notes[k].conf === 'number') n++;
    return n;
  }
  function mergeNotes(incoming) {
    for (var k in incoming) notes[k] = Object.assign({}, notes[k], incoming[k]);
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
    else sireOverrides[k] = OBS.util.clamp(parseFloat(value), 0, 100);
    write('sireOverrides', sireOverrides);
  }
  function allSireOverrides() { return sireOverrides; }
  function mergeSireOverrides(incoming) {
    Object.assign(sireOverrides, incoming);
    write('sireOverrides', sireOverrides);
  }

  /* ------------------------------------------------------- filter presets */
  /* A named set of filters. Stored flat as JSON, so `foalFrom`/`foalTo` are
     "YYYY-MM-DD" strings rather than Dates — js/filters.js owns that
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
    return rec;
  }
  function deletePreset(id) {
    presets = presets.filter(function (p) { return p.id !== id; });
    write('filterPresets', presets);
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
        presets.push({ id: newId(), name: String(p.name),
                       savedAt: p.savedAt || new Date().toISOString(), filters: p.filters });
        added++;
      }
    });
    write('filterPresets', presets);
    return { added: added, updated: updated };
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
  }
  function removeSireList(id) {
    delete bhLists[id];
    write('bloodhorse', bhLists);
  }

  /* --------------------------------------------------------------- settings */

  function getSettings(fallback) { return Object.assign({}, fallback, read('settings', {})); }
  function setSettings(s) { write('settings', s); }

  /* ------------------------------------------------------- backup / restore */

  function exportAll() {
    return {
      _format: 'obs-model-backup',
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
   * `flag: true` per horse; mergeNotes brings those in and the migration above
   * folds them into the first list on next load, so nothing is lost.
   */
  function importAll(obj) {
    if (!obj || obj._format !== 'obs-model-backup') {
      throw new Error('Not an OBS model backup file.');
    }
    if (Array.isArray(obj.lists) && obj.lists.length) mergeLists(obj.lists);
    if (obj.notes) mergeNotes(obj.notes);
    if (obj.sireOverrides) mergeSireOverrides(obj.sireOverrides);
    if (Array.isArray(obj.filterPresets)) mergePresets(obj.filterPresets);
    if (obj.settings) write('settings', Object.assign(read('settings', {}), obj.settings));
    migrateImportedFlags();
  }

  /** Lists come in by id so membership still resolves; names update in place. */
  function mergeLists(incoming) {
    incoming.forEach(function (l) {
      if (!l || !l.id || !l.name) return;
      var existing = getList(l.id);
      if (existing) existing.name = String(l.name);
      else lists.push({ id: l.id, name: String(l.name) });
    });
    write('lists', lists);
  }

  /** A v1 backup restores `flag: true`; fold it in immediately. */
  function migrateImportedFlags() {
    var changed = false;
    for (var k in notes) {
      if (!notes[k].flag) continue;
      if (!Array.isArray(notes[k].lists)) notes[k].lists = [];
      if (notes[k].lists.indexOf(lists[0].id) === -1) notes[k].lists.push(lists[0].id);
      delete notes[k].flag;
      changed = true;
    }
    if (changed) write('notes', notes);
  }

  function clearAll() {
    notes = {}; sireOverrides = {}; presets = [];
    lists = [{ id: 'main', name: 'Short list' }];
    activeList = lists[0].id;
    write('notes', notes); write('sireOverrides', sireOverrides);
    write('filterPresets', presets); write('lists', lists);
    write('activeList', activeList); write('settings', {});
  }

  return {
    persistent: hasLS,
    getNote: getNote, conformation: conformation, setConformation: setConformation,
    breezeVisual: breezeVisual, setBreezeVisual: setBreezeVisual, watchedCount: watchedCount,
    pedigree: pedigree, setPedigree: setPedigree, pedRatedCount: pedRatedCount,
    setNoteText: setNoteText, isFlagged: isFlagged,
    allNotes: allNotes, gradedCount: gradedCount, mergeNotes: mergeNotes,

    allLists: allLists, getList: getList, createList: createList,
    renameList: renameList, deleteList: deleteList,
    activeListId: activeListId, setActiveList: setActiveList,
    listsFor: listsFor, listNamesFor: listNamesFor,
    isOnList: isOnList, setOnList: setOnList, toggleOnList: toggleOnList,

    allPresets: allPresets, getPreset: getPreset, savePreset: savePreset,
    deletePreset: deletePreset, mergePresets: mergePresets,

    VET_STATES: VET_STATES, VET_LABELS: VET_LABELS,
    vetStatus: vetStatus, setVetStatus: setVetStatus, shortlistCount: shortlistCount,
    sireLists: sireLists, saveSireList: saveSireList, removeSireList: removeSireList,
    getSireOverride: getSireOverride, setSireOverride: setSireOverride,
    allSireOverrides: allSireOverrides,
    getSettings: getSettings, setSettings: setSettings,
    exportAll: exportAll, importAll: importAll, clearAll: clearAll
  };
})();
