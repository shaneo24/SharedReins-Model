#!/usr/bin/env node
/* Fill the Keeneland cache for a sale.
 *
 * WHY THIS EXISTS
 *
 *   Keeneland's search returns clean JSON but sends no CORS header, so a
 *   browser can never call it directly. Locally that is solved by serve.js
 *   proxying it; a copy hosted on GitHub Pages has no server to do that, and
 *   the Keeneland leg of sale history simply vanishes — which matters, because
 *   Keeneland November is where most of a crop's weanlings change hands.
 *
 *   So the rows are fetched here, ahead of the sale, and parked in Supabase.
 *   The deployed site reads them from there. One person runs this and everyone
 *   gets the data, the same bargain as the BloodHorse sire lists.
 *
 * YOU DO NOT NORMALLY RUN THIS BY HAND
 *
 *   .github/workflows/keeneland-cache.yml runs it daily, so the cache is
 *   already warm when anyone opens the site. This is the same script that job
 *   invokes; everything below is for running it yourself when you don't want
 *   to wait for the schedule.
 *
 * RUNNING IT ANYWAY
 *
 *   Set the access code once per terminal — never pass it as an argument,
 *   where it would land in your shell history:
 *
 *     export SR_CODE='your-access-code'          # bash
 *     $env:SR_CODE = 'your-access-code'          # PowerShell
 *
 *   Then, for a Fasig-Tipton sale code or an OBS numeric sale id:
 *
 *     node shared/fetch-keeneland.js N26A
 *     node shared/fetch-keeneland.js 149
 *
 *   Useful flags:
 *
 *     --dry-run [file]   fetch and write to JSON instead of Supabase. Needs no
 *                        access code, touches nothing. Good for a first look.
 *     --refresh          re-fetch mares already cached (default is to skip)
 *     --limit N          stop after N mares, for a quick trial
 *     --concurrency N    parallel Keeneland requests (default 4)
 *
 * NO DEPENDENCIES, in keeping with the rest of the project. Needs Node 18+ for
 * global fetch; this repo is on v24.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FT_API = 'https://www.fasigtipton.com/django/api/';
const OBS_API = 'https://obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/';
const KEE_HOST = 'https://flex.keeneland.com/misc/SearchResults.do';
const KEE_DELIM = '^!^';

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { sales: [], dryRun: false, dryFile: null, refresh: false,
                limit: Infinity, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      out.dryRun = true;
      // An optional filename may follow, but not another flag.
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) out.dryFile = argv[++i];
    } else if (a === '--refresh') out.refresh = true;
    else if (a === '--limit') out.limit = Number(argv[++i]) || Infinity;
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]) || 4);
    // Several sales in one run share a single de-duplicated mare list, which
    // matters when a scheduled job sweeps every open catalogue at once.
    else if (!a.startsWith('--')) out.sales.push(a);
  }
  return out;
}

function die(msg) {
  console.error('\n  ' + msg + '\n');
  process.exit(1);
}

/* ---------------------------------------------------------------- config */

/** Reuse the app's own Supabase settings rather than keeping a second copy. */
function loadConfig() {
  const candidates = ['Yearling/js/config.js', 'Two-Year-Old/js/config.js']
    .map(p => path.join(__dirname, '..', p));

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const sandbox = { window: {} };
    try {
      // The file is a single assignment to window.SHARED_REINS_CONFIG.
      new Function('window', src)(sandbox.window);
    } catch (e) { continue; }
    const cfg = sandbox.window.SHARED_REINS_CONFIG;
    if (cfg && cfg.url && !cfg.url.includes('YOUR-PROJECT')) return cfg;
  }
  return null;
}

/* ------------------------------------------------------- the catalogues */

async function getJson(url, label) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  return res.json();
}

/** Every dam in a Fasig-Tipton sale, e.g. N26A. */
async function fasigDams(code) {
  const sales = await getJson(
    FT_API + 'sales/?sale_identifier=' + encodeURIComponent(code), 'Fasig-Tipton');
  const list = Array.isArray(sales) ? sales : (sales.results || []);
  if (!list.length) throw new Error(`No Fasig-Tipton sale with identifier "${code}".`);
  const pk = list[0].id || list[0].pk;

  const horses = await getJson(FT_API + 'horses/?sale=' + pk, 'Fasig-Tipton');
  const rows = Array.isArray(horses) ? horses : (horses.results || []);
  return { label: list[0].name || code, dams: rows.map(h => h.dam) };
}

/** Every dam in an OBS sale, e.g. 149. */
async function obsDams(id) {
  const data = await getJson(OBS_API + id + '?is_digital=false', 'OBS');
  const rows = data.horses || data.data || (Array.isArray(data) ? data : []);
  if (!rows.length) throw new Error(`No horses in OBS sale "${id}".`);
  return { label: data.sale_name || ('OBS sale ' + id), dams: rows.map(h => h.dam) };
}

function damKey(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ------------------------------------------------------------ Keeneland */

async function keenelandByDam(dam) {
  const url = KEE_HOST +
    '?actionName=HorseSearch' +
    '&paramNames=' + encodeURIComponent(['search_id', 'search_all_mode', 'search_all_string'].join(KEE_DELIM)) +
    '&paramValues=' + encodeURIComponent(['-1', 'D', dam].join(KEE_DELIM));

  const res = await fetch(url, {
    headers: { 'User-Agent': 'shared-reins-model/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error('Keeneland returned HTTP ' + res.status);

  const body = await res.text();
  let rows;
  try { rows = JSON.parse(body); }
  catch (e) { throw new Error('Keeneland returned unparseable JSON'); }
  return Array.isArray(rows) ? rows : [];
}

/** Run `work` over `items` with a fixed number in flight. */
async function pool(items, concurrency, work) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------- Supabase */

function rpcCaller(cfg, code) {
  return async function rpc(fn, body) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(Object.assign({ p_code: code }, body))
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      if (parsed && parsed.code === '28000') throw new Error('Access code not accepted.');
      throw new Error((parsed && parsed.message) || ('HTTP ' + res.status));
    }
    return parsed;
  };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sales.length) {
    die('Usage: node shared/fetch-keeneland.js <sale…>   e.g. N26A  or  149  or  N26A N26B 149\n' +
        '       --dry-run [file]  --refresh  --limit N  --concurrency N');
  }

  const code = process.env.SR_CODE;
  let cfg = null, rpc = null;

  if (!args.dryRun) {
    cfg = loadConfig();
    if (!cfg) die('No Supabase settings found. Fill in js/config.js, or use --dry-run.');
    if (!code) {
      die('Set the access code first, so it stays out of your shell history:\n' +
          "         PowerShell:  $env:SR_CODE = 'your-access-code'\n" +
          "         bash:        export SR_CODE='your-access-code'\n\n" +
          '       Or run with --dry-run to fetch without storing anything.');
    }
    rpc = rpcCaller(cfg, code);
  }

  // --- the catalogues ---------------------------------------------------
  const allDams = [];
  for (const sale of args.sales) {
    const isFasig = /^[A-Za-z]/.test(sale);
    process.stdout.write(`Reading ${isFasig ? 'Fasig-Tipton' : 'OBS'} sale ${sale}… `);
    try {
      const { label, dams } = isFasig ? await fasigDams(sale) : await obsDams(sale);
      console.log(`${label} — ${dams.length} hips.`);
      allDams.push(...dams);
    } catch (e) {
      // One bad sale code shouldn't sink a sweep over several catalogues.
      console.log(`skipped (${e.message})`);
    }
  }
  if (!allDams.length) die('No catalogues could be read.');

  // One request per mare, not per hip: full siblings share a dam, a mare with
  // two foals across two sales is still one lookup, and de-duplicating across
  // the whole run is what makes sweeping several catalogues cheap.
  const unique = [...new Map(allDams.filter(Boolean).map(d => [damKey(d), d])).values()]
    .filter(d => damKey(d));
  console.log(`\n${allDams.length} hips across ${args.sales.length} sale(s) — ` +
              `${unique.length} distinct mares.`);

  // --- what is already cached ------------------------------------------
  let todo = unique;
  if (rpc && !args.refresh) {
    const have = await rpc('sr_keeneland_read', { p_dams: unique });
    const cached = new Set(Object.keys(have || {}));
    todo = unique.filter(d => !cached.has(damKey(d)));
    console.log(`${cached.size} already cached, ${todo.length} to fetch.` +
                (cached.size ? '  (--refresh to re-fetch them)' : ''));
  }
  if (args.limit < todo.length) {
    todo = todo.slice(0, args.limit);
    console.log(`Limited to ${todo.length}.`);
  }
  if (!todo.length) { console.log('\nNothing to do.'); return; }

  // --- fetch ------------------------------------------------------------
  console.log(`\nFetching from Keeneland, ${args.concurrency} at a time…`);
  const started = Date.now();
  let done = 0, failed = 0, withRows = 0;

  const entries = await pool(todo, args.concurrency, async (dam) => {
    try {
      const rows = await keenelandByDam(dam);
      if (rows.length) withRows++;
      return { dam, rows };
    } catch (e) {
      failed++;
      // A mare that failed is left uncached rather than cached as empty. The
      // app draws a hard line between "looked up, found nothing" and "never
      // looked up", and a failed request is the second of those.
      console.error(`  ! ${dam}: ${e.message}`);
      return null;
    } finally {
      done++;
      if (done % 25 === 0 || done === todo.length) {
        const secs = ((Date.now() - started) / 1000).toFixed(0);
        process.stdout.write(`  ${done}/${todo.length}  (${secs}s)\n`);
      }
    }
  });

  const good = entries.filter(Boolean);
  console.log(`\nFetched ${good.length} mares — ${withRows} with Keeneland history, ` +
              `${good.length - withRows} with none. ${failed} failed.`);

  // --- store ------------------------------------------------------------
  if (args.dryRun) {
    const file = args.dryFile || `keeneland-${args.sales.join('-')}.json`;
    fs.writeFileSync(file, JSON.stringify(good, null, 2), 'utf8');
    console.log(`\nDry run — wrote ${file}. Nothing was sent to Supabase.`);
    return;
  }

  // Batched so one oversized request can't fail the whole run.
  const BATCH = 50;
  let stored = 0;
  for (let i = 0; i < good.length; i += BATCH) {
    const chunk = good.slice(i, i + BATCH);
    const res = await rpc('sr_keeneland_write', { p_entries: chunk });
    stored += (res && res.applied) || 0;
    process.stdout.write(`  stored ${stored}/${good.length}\n`);
  }

  const status = await rpc('sr_keeneland_status', {});
  console.log(`\nDone. Cache now holds ${status.mares} mares ` +
              `(${status.withRows} with Keeneland history).`);
  console.log('Everyone with the access code sees this immediately — no redeploy.');
}

main().catch(e => die(e.message));
