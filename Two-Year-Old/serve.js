/* Minimal static file server — no dependencies, no install.
 *
 *   node serve.js          -> http://localhost:8099
 *   node serve.js 3000     -> http://localhost:3000
 *
 * You need this (rather than double-clicking index.html) because browsers
 * refuse cross-site requests from file:// pages, which blocks the live pull
 * from the OBS catalog.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8099;

/* ------------------------------------------------------- Keeneland proxy */

/* Keeneland's horse search returns clean JSON but sends no CORS header, so a
 * browser can't call it directly. It has no bot protection though, so this
 * server can fetch it and pass it through. Searching by dam returns every foal
 * that mare has sent through a Keeneland sale; the client picks the right one
 * by foaling year.
 *
 * This is why sale history needs `node serve.js` rather than opening
 * index.html off disk.
 */
const KEE_DELIM = '^!^';

function keenelandByDam(dam) {
  const params =
    'actionName=HorseSearch' +
    '&paramNames=' + encodeURIComponent(['search_id', 'search_all_mode', 'search_all_string'].join(KEE_DELIM)) +
    '&paramValues=' + encodeURIComponent(['-1', 'D', dam].join(KEE_DELIM));

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'flex.keeneland.com',
      path: '/misc/SearchResults.do?' + params,
      method: 'GET',
      headers: { 'User-Agent': 'obs-model/1.0', 'Accept': 'application/json' }
    }, r => {
      let body = '';
      r.on('data', d => { body += d; });
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error('Keeneland returned HTTP ' + r.statusCode));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Keeneland returned unparseable JSON')); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(new Error('Keeneland timed out')); });
    req.on('error', reject);
    req.end();
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);

  if (rel === '/api/keeneland') {
    const dam = new URL(req.url, 'http://localhost').searchParams.get('dam');
    if (!dam) return sendJson(res, 400, { error: 'Missing ?dam=' });
    keenelandByDam(dam)
      .then(rows => sendJson(res, 200, { dam, rows }))
      .catch(err => sendJson(res, 502, { dam, error: err.message }));
    return;
  }

  // Lets the client tell "no proxy here" apart from "proxy broke".
  if (rel === '/api/ping') return sendJson(res, 200, { ok: true, keeneland: true });

  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) {           // no climbing out of the project
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`OBS model running at http://localhost:${PORT}`);
});
