// Lampa plugin: Linkomanija + Torrenta parseris
// Naudojimas: Lampa -> Nustatymai -> Papildiniai -> pridėti URL į šį failą
(function () {
  'use strict';

  var KEY = 'lt_trackers_';
  // ĮRAŠYKITE SAVO DUOMENIS ČIA (tik vietinėje kopijoje savo kompiuteryje, NE GitHub):
  var LOCAL = {
    lm_cookie: '',   // pvz. 'login=XXXX; PHPSESSID=YYYY'
    lm_passkey: '',  // Linkomanija passkey
    ta_cookie: '',
    ta_cookie2: '',
    ta_cookie3: '',
    ta_passkey: ''
  };
  var TA_DIAG = '';
  function taCookie() {
    var c = cfg('ta_cookie') + cfg('ta_cookie2') + cfg('ta_cookie3');
    // Automatinis pavadinimo pataisymas (jei įvestas pavadinimas neteisingas / sutrumpintas)
    return c.replace(/^ZwDQmzPeN[^=]*=/, 'ZwDQmzPeNOgy=');
  }
  function cfg(name, def) { return Lampa.Storage.get(KEY + name, '') || LOCAL[name] || def || ''; }

  // ---------- Nustatymai (galima keisti per Lampa.Storage arba žemiau esančiame meniu) ----------
  var DEFAULTS = {
    lm_cookie: '',   // pvz. "uid=123; pass=abcdef..."  (iš naršyklės po prisijungimo)
    lm_passkey: '',  // Linkomanija profilio passkey (reikalingas .torrent atsisiuntimui)
    lm_url: 'https://www.linkomanija.net/browse.php?search={q}&submit.x=0&submit.y=0',
    ta_cookie: '',
    ta_cookie2: '',
    ta_cookie3: '',
    ta_url: 'https://torrent.ai/lt/torrents?search={q}'
  };

  function toBytes(txt) {
    var m = /([\d.,]+)\s*(TB|GB|MB|KB)/i.exec(txt);
    if (!m) return 0;
    var n = parseFloat(m[1].replace(',', '.'));
    var mul = { KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }[m[2].toUpperCase()];
    return Math.round(n * mul);
  }

  function abs(base, href) {
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  // Suranda visą torrento eilutę (lentelės arba div), kurioje yra tik vienas torrentas
  function findRow(a, idRe, linkSel) {
    var cur = a, best = a.parentNode || a;
    for (var d = 0; d < 8; d++) {
      var p = cur.parentNode;
      if (!p || p.nodeType !== 1 || /^(BODY|HTML)$/i.test(p.tagName)) break;
      var ids = {}, n = 0, ls = p.querySelectorAll(linkSel);
      for (var j = 0; j < ls.length; j++) {
        var m = idRe.exec(ls[j].getAttribute('href') || '');
        if (m && !ids[m[1]]) { ids[m[1]] = 1; n++; }
      }
      if (n > 1) break;
      best = p; cur = p;
    }
    return best;
  }

  // Bendras HTML lentelės parseris su euristika
  function parseHtml(html, base, linkSel, tracker, buildLink, idRe) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var out = [];
    var all = doc.querySelectorAll(linkSel);
    var rows = [], best = [];
    for (var k = 0; k < all.length; k++) {
      var an = all[k];
      if (idRe && !idRe.test(an.getAttribute('href') || '')) continue;
      var rw = idRe ? findRow(an, idRe, linkSel) : (an.closest('tr') || an.parentNode);
      if (!rw) continue;
      var tx = (an.getAttribute('title') || an.textContent || '').trim();
      if (tx.length < 6 || /^\d+$/.test(tx)) continue;
      var ix = rows.indexOf(rw);
      if (ix < 0) { rows.push(rw); best.push({ a: an, t: tx }); }
      else if (tx.length > best[ix].t.length) { best[ix] = { a: an, t: tx }; }
    }
    for (var i = 0; i < rows.length; i++) {
      var a = best[i].a;
      var row = rows[i];
      var title = best[i].t;

      var cells = row.querySelectorAll('td');
      var nums = [], sizeTxt = '';
      for (var c = 0; c < cells.length; c++) {
        var t = cells[c].textContent.trim();
        if (/^\d+$/.test(t)) nums.push(parseInt(t, 10));
        if (/[\d.,]+\s*(TB|GB|MB|KB)/i.test(t)) sizeTxt = t;
      }
      if (!sizeTxt) { var mm = /[\d.,]+\s*(TB|GB|MB|KB)/i.exec(row.textContent || ''); if (mm) sizeTxt = mm[0]; }
      var seeders = nums.length >= 2 ? nums[nums.length - 2] : 0;
      var leech = nums.length >= 2 ? nums[nums.length - 1] : 0;

      var magnetEl = row.querySelector('a[href^="magnet:"]');
      var item = {
        Title: title,
        Tracker: tracker,
        Size: toBytes(sizeTxt),
        PublishDate: new Date().toISOString(),
        Seeders: seeders,
        Peers: leech,
        MagnetUri: magnetEl ? magnetEl.getAttribute('href') : '',
        Link: magnetEl ? '' : buildLink(a, row, base)
      };
      if (item.MagnetUri || item.Link) out.push(item);
    }
    return out;
  }

  function fetchText(url, cookie, ok, fail) {
    var net = new Lampa.Reguest();
    var headers = {};
    if (cookie) headers['Cookie'] = cookie;
    // native = apeina CORS Android TV aplikacijoje
    net.native(url, ok, fail, false, { dataType: 'text', headers: headers });
  }

  function searchLM(q, ok, fail) {
    var url = DEFAULTS.lm_url.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+'));
    var passkey = cfg('lm_passkey');
    fetchText(url, cfg('lm_cookie'), function (html) {
      if (/type=["']?password/i.test(html)) { fail(); return; }
      var res = parseHtml(html, url, 'a[href*="details?"], a[href*="details.php"]', 'Linkomanija', function (a, row, base) {
        var m = /details(?:\.php)?\?(?:id=)?(\d+)/.exec(a.getAttribute('href'));
        if (!m) return '';
        var dl = row.querySelector('a[href*="download"]');
        if (dl) {
          var h = abs(base, dl.getAttribute('href'));
          if (passkey && h.indexOf('passkey') < 0) h += (h.indexOf('?') < 0 ? '?' : '&') + 'passkey=' + passkey;
          return h;
        }
        return abs(base, 'download.php?id=' + m[1] + (passkey ? '&passkey=' + passkey : ''));
      });
      ok(res);
    }, fail);
  }

  function searchTA(q, ok, fail) {
    var qq = q.replace(/[:\-\u2013\u2014'"!?.,()&]+/g, ' ').replace(/\s+/g, ' ').trim();
    var url = DEFAULTS.ta_url.replace('{q}', encodeURIComponent(qq).replace(/%20/g, '+'));
    fetchText(url, taCookie(), function (html) {
      var tpass = cfg('ta_passkey');
      var cnt = (html.match(/href=["'](?:[^"']*\/)?t\d{5,}-/g) || []).length;
      var login = /type=["']?password/i.test(html);
      var hr = html.match(/href=["'][^"']+["']/g) || [], smp2 = [];
      for (var hi = 0; hi < hr.length && smp2.length < 2; hi++) {
        var hh = hr[hi].slice(6, -1);
        if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?)(\?|$)/i.test(hh)) continue;
        if (/\d{5,}/.test(hh)) smp2.push(hh.substring(0, 50));
      }
      TA_DIAG = html.length + ' B, nuorodų ' + cnt + (login ? ', reikia prisijungti' : '') + ', q=' + qq + (smp2.length ? ', pvz ' + smp2.join(' | ') : ', pvz nėra');
      var res = parseHtml(html, url, 'a[href]', 'Torrent.ai', function (a, row, base) {
        var m = /(?:^|\/)t(\d{5,})-/.exec(a.getAttribute('href') || '');
        if (!m) return '';
        var dl = row.querySelector('a[href*="/download"]');
        var h = dl ? abs(base, dl.getAttribute('href')) : abs(base, '/lt/download?id=' + m[1]);
        if (tpass && h.indexOf('passkey') < 0) h += (h.indexOf('?') < 0 ? '?' : '&') + 'passkey=' + tpass;
        return h;
      }, /(?:^|\/)t(\d{5,})-/);
      ok(res);
    }, fail);
  }

  // Techninis testas: ar su slapuku gaunamas tikras .torrent failas
  function probeTorrent(link, note) {
    function run(withCookie, delay) {
      setTimeout(function () {
        try {
          var net = new Lampa.Reguest();
          var label = withCookie ? 'su slapuku' : 'be slapuko';
          var opts = { dataType: 'text' };
          if (withCookie) opts.headers = { Cookie: taCookie() };
          net.native(link, function (r) {
            var info = typeof r;
            if (typeof r === 'string') {
              var hi = 0, ff = 0, mx = 0;
              for (var ci = 0; ci < r.length; ci++) {
                var cc = r.charCodeAt(ci);
                if (cc > mx) mx = cc;
                if (cc > 255) hi++;
                if (cc === 0xFFFD) ff++;
              }
              var pm = /6:pieces(\d+):/.exec(r);
              var integ = pm ? ' pieces=' + pm[1] + ' tail=' + (r.length - (pm.index + pm[0].length) - parseInt(pm[1], 10)) : ' pieces?';
              info += ' len=' + r.length + ' max=' + mx + ' >255:' + hi + ' FFFD:' + ff + integ;
            }
            note('TEST ' + label + ': ' + info);
          }, function (e) {
            note('TEST ' + label + ' klaida: ' + (e && (e.status || e.statusText || e.message) || e));
          }, false, opts);
        } catch (ex) { note('TEST išimtis: ' + ex.message); }
      }, delay);
    }
    run(true, 3000);
  }

  function start() {
    try { Lampa.Noty.show('LT Trackeriai: papildinys įkeltas'); } catch (e) {}
    var original = Lampa.Parser.get;

    Lampa.Parser.get = function (params, oncomplete, onerror) {
      var q = (params.movie && (params.movie.original_title || params.movie.original_name)) || params.search || '';
      var useTA = Lampa.Storage.get(KEY + 'ta_mode', 'on') !== 'off' && !!(taCookie() || cfg('ta_passkey'));
      var onlyLM = Lampa.Storage.get(KEY + 'mode', 'all') === 'lm';
      var pending = (onlyLM ? 1 : 2) + (useTA ? 1 : 0);
      var base = null, ours = [];
      function note(t) { try { Lampa.Noty.show(t); } catch (e) {} }

      function finish() {
        if (--pending > 0) return;
        var out = base || {};
        var results = (out.Results || []).concat(ours);
        results.sort(function (a, b) { return (b.Seeders || 0) - (a.Seeders || 0); });
        out.Results = results;
        oncomplete(out);
      }

      // 1) standartinis Lampa parseris (jac.red, Jackett ir kt.)
      if (!onlyLM) {
        try {
          original.call(Lampa.Parser, params, function (d) { base = d; finish(); }, function () { finish(); });
        } catch (e) { finish(); }
      }

      // 2) Linkomanija
      searchLM(q, function (l) { ours = ours.concat(l); finish(); },
        function () { note('Linkomanija: klaida (slapukai/tinklas)'); finish(); });

      // 3) Torrent.ai (tik jei įvesti slapukai)
      if (useTA) {
        searchTA(q, function (l) {
          if (l[0] && Lampa.Storage.get(KEY + 'ta_mode', 'on') === 'test') probeTorrent(l[0].Link, note);
          ours = ours.concat(l); finish();
        },
          function () { note('Torrent.ai: klaida'); finish(); });
      }
    };

    // Nustatymų skiltis
    try {
    Lampa.SettingsApi.addComponent({ component: 'lt_trackers', name: 'LT Trackeriai', icon: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>' });
    var FIELDS = {
      lm_cookie: ['Linkomanija slapukai', 'uid=...; pass=...'],
      lm_passkey: ['Linkomanija passkey', 'passkey iš profilio'],
      ta_cookie: ['Torrent.ai slapukas (1 dalis)', 'pradžia: PAVADINIMAS=reikšmė...'],
      ta_cookie2: ['Torrent.ai slapukas (2 dalis)', 'tęsinys, jei reikia'],
      ta_cookie3: ['Torrent.ai slapukas (3 dalis)', 'tęsinys, jei reikia'],
      ta_passkey: ['Torrent.ai passkey', 'passkey iš profilio']
    };
    Object.keys(FIELDS).forEach(function (name) {
      Lampa.SettingsApi.addParam({
        component: 'lt_trackers',
        param: { name: KEY + name, type: 'input', values: '', placeholder: FIELDS[name][1], 'default': '' },
        field: { name: FIELDS[name][0], description: '' },
        onChange: function () {}
      });
    });
    Lampa.SettingsApi.addParam({
      component: 'lt_trackers',
      param: { name: KEY + 'mode', type: 'select', values: { all: 'Viskas kartu', lm: 'Tik Linkomanija' }, 'default': 'all' },
      field: { name: 'Šaltiniai', description: 'Viskas kartu = ir kiti parseriai (jac.red ir kt.)' },
      onChange: function () {}
    });
    Lampa.SettingsApi.addParam({
      component: 'lt_trackers',
      param: { name: KEY + 'ta_mode', type: 'select', values: { on: 'Įjungta', off: 'Išjungta', test: 'Įjungta + techninis testas' }, 'default': 'on' },
      field: { name: 'Torrent.ai paieška', description: 'Įjungta: rodo Torrent.ai rezultatus (paleidimas gali nepavykti)' },
      onChange: function () {}
    });
    } catch (e) { console.log('LT settings error', e); }

    // Įjungiame, kad Lampa naudotų parserį ir rodytų torrentų mygtuką
    Lampa.Storage.set('parser_use', true);
  }

  if (window.appready) start();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
