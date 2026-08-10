#!/usr/bin/env node
/* Copies shared/sync.js into both apps.
 *
 * The two models are deliberately separate folders with their own copies of
 * everything — that is how this project has always been laid out, and it is
 * why one can be edited at a sale without disturbing the other. The transport
 * layer is the one file where drift between them would cause real damage
 * (a schema change applied to one app and not the other), so it gets a master
 * copy and this fifteen-line script instead of a hand-maintained duplicate.
 *
 *   node shared/sync-build.js
 *
 * No dependencies, in keeping with the rest of the project.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var master = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');

var TARGETS = [
  { dir: 'Yearling',      ns: 'FT',  app: 'yearling' },
  { dir: 'Two-Year-Old',  ns: 'OBS', app: 'twoyo' }
];

var HEADER = '/* GENERATED FILE — do not edit.\n' +
             '   Master copy is shared/sync.js; regenerate with:\n' +
             '     node shared/sync-build.js\n' +
             '*/\n';

TARGETS.forEach(function (t) {
  var tail = '\nwindow.' + t.ns + ' = window.' + t.ns + ' || {};\n' +
             t.ns + '.sync = window.__SR_SYNC__(window.' + t.ns + ", '" + t.app + "');\n";
  var out = path.join(root, t.dir, 'js', 'sync.js');
  fs.writeFileSync(out, HEADER + master + tail, 'utf8');
  console.log('wrote ' + path.relative(root, out) + '  (' + t.ns + ' / ' + t.app + ')');
});
