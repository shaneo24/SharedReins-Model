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
  }
  function removeSireList(id) {
    delete bhLists[id];
    write('bloodhorse', bhLists);
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
    exportAll: exportAll, importAll: importAll, clearAll: clearAll
  };
})();
