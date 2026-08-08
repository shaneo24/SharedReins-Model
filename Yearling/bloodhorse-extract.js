/* ---------------------------------------------------------------------------
 * BloodHorse sire-list extractor
 *
 * BloodHorse sends no CORS headers and sits behind Imperva bot protection, so
 * the model can't pull these lists itself. This runs in your own browser, on a
 * page you're already looking at, and saves the table to a JSON file you then
 * load with "Import sire list".
 *
 * HOW TO USE
 *   1. Open https://www.bloodhorse.com/horse-racing/thoroughbred-breeding/sire-lists
 *      and set Racing Year / List Type / Standing Location to what you want.
 *   2. Press F12 for developer tools, click the Console tab.
 *   3. Paste this whole file in, press Enter. A .json file downloads.
 *   4. In the model: Sire book -> Import sire list.
 *
 * Repeat for each list you want (Sires of Two-Year-Olds, First-Crop Sires,
 * Leading Sires). The model keeps them separate and picks the most relevant
 * one for each sire.
 * ------------------------------------------------------------------------- */

(function () {
  'use strict';

  function num(s) {
    if (s === null || s === undefined) return null;
    var m = String(s).replace(/[$,%\s]/g, '').match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }
  function pair(s) {
    var p = String(s || '').split('/').map(function (x) { return x.trim(); });
    return [num(p[0]), num(p[1])];
  }
  function sel(name) {
    var el = document.querySelector('select[name="' + name + '"]');
    if (!el) return { value: '', label: '' };
    return { value: el.value, label: (el.options[el.selectedIndex] || {}).text || '' };
  }

  var table = document.querySelector('table.blacktype-sire-table');
  if (!table || !table.querySelectorAll('tbody tr').length) {
    alert('No sire list table found. Make sure the list has finished loading, then try again.');
    return;
  }

  /* Column positions are NOT stable across list types — Leading Sires carries
     13 columns (Rank and Sire are duplicated for the sticky header clone),
     First-Crop carries 11. Reading by index silently shifts every field on
     some lists, so map the header text to positions instead. */
  var headers = [].slice.call(table.querySelectorAll('thead th')).map(function (th) {
    return th.innerText.replace(/\s+/g, ' ').trim().toLowerCase();
  });

  function col(re) {
    for (var i = 0; i < headers.length; i++) if (re.test(headers[i])) return i;
    return -1;
  }

  var IX = {
    rank: col(/^rank/),
    sire: col(/^sire/),
    fee: col(/stud fee/),
    foals: col(/named ?foals/),
    rnrs: col(/rnrs\s*\/\s*wnrs/),
    btw: col(/btwnrs/),
    bth: col(/bthrs/),
    gsw: col(/gswnrs/),
    awd: col(/^awd/),
    earn: col(/progeny earnings/)
  };

  if (IX.sire === -1 || IX.rnrs === -1) {
    alert('Could not recognise this table\'s columns. BloodHorse may have changed its layout.');
    return;
  }

  function at(cells, i) {
    return i === -1 || !cells[i] ? '' : cells[i].innerText.replace(/\s+/g, ' ').trim();
  }

  var rows = [].slice.call(table.querySelectorAll('tbody tr')).map(function (tr) {
    var cells = [].slice.call(tr.querySelectorAll('td,th'));

    /* The sire cell is "Name\nSire of sire (year)". Split the RAW innerText on
       the newline — don't trust a link: pensioned/deceased sires have no
       stallion-register profile, and the only <a> there is an icon with no
       text, which would silently yield "Uncle Mo Indian Charlie (2008)". */
    var lines = (cells[IX.sire] ? cells[IX.sire].innerText : '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    var named = tr.querySelector('.stallion-name a');
    var sire = ((named && named.innerText.trim()) || lines[0] || '');

    var fee = at(cells, IX.fee);
    var rw = pair(at(cells, IX.rnrs));
    var bt = pair(at(cells, IX.btw));
    var bh = pair(at(cells, IX.bth));
    var gs = pair(at(cells, IX.gsw));
    var money = at(cells, IX.earn).match(/\$[\d,]+/g) || [];

    return {
      rank: num(at(cells, IX.rank)),
      sire: sire,
      sireLine: lines[1] || '',
      studFee: num(fee.split(' ')[0]),
      farm: fee.replace(/^\$[\d,]+\s*/, ''),
      foals: num(at(cells, IX.foals)),
      rnrs: rw[0], wnrs: rw[1],
      btw: bt[0], btwPct: bt[1],
      bth: bh[0], bthPct: bh[1],
      gsw: gs[0], g1w: gs[1],
      awd: num(at(cells, IX.awd)),
      earnings: money[0] ? num(money[0]) : null,
      aer: money[1] ? num(money[1]) : null
    };
  }).filter(function (r) { return r.sire; });

  var listType = sel('listType'), year = sel('year'), region = sel('standingRegion');

  var payload = {
    _format: 'bloodhorse-sire-list',
    _version: 1,
    source: 'BloodHorse sire lists',
    url: location.href,
    extractedAt: new Date().toISOString(),
    year: year.value || String(new Date().getFullYear()),
    listType: listType.value || 'g',
    listLabel: listType.label || 'Leading Sires',
    region: region.label || '',
    rows: rows
  };

  var name = 'bloodhorse-' + payload.year + '-' + payload.listType + '.json';
  var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

  console.log('Extracted ' + rows.length + ' sires from "' + payload.listLabel +
              '" (' + payload.year + ') -> ' + name);
})();
