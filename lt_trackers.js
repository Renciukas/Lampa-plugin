// Lampa plugin: Linkomanija + Torrenta parseris
// Naudojimas: Lampa -> Nustatymai -> Papildiniai -> pridėti URL į šį failą
(function () {
  'use strict';

  var KEY = 'lt_trackers_';
  // ĮRAŠYKITE SAVO DUOMENIS ČIA (tik vietinėje kopijoje savo kompiuteryje, NE GitHub):
  var LOCAL = {
    lm_cookie: '',   // pvz. 'login=XXXX; PHPSESSID=YYYY'
    lm_passkey: '',  // Linkomanija passkey
    ta_cookie: ''
  };
  function cfg(name, def) { return Lampa.Storage.get(KEY + name, '') || LOCAL[name] || def || ''; }

  // ---------- Nustatymai (galima keisti per Lampa.Storage arba žemiau esančiame meniu) ----------
  var DEFAULTS = {
    lm_cookie: '',   // pvz. "uid=123; pass=abcdef..."  (iš naršyklės po prisijungimo)
    lm_passkey: '',  // Linkomanija profilio passkey (reikalingas .torrent atsisiuntimui)
    lm_url: 'https://www.linkomanija.net/browse.php?search={q}&submit.x=0&submit.y=0',
    ta_cookie: '',
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

  // Bendras HTML lentelės parseris su euristika
  function parseHtml(html, base, linkSel, tracker, buildLink) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var out = [];
    var all = doc.querySelectorAll(linkSel);
    var rows = [], best = [];
    for (var k = 0; k < all.length; k++) {
      var an = all[k];
      var rw = an.closest('tr') || an.parentNode;
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
    var url = DEFAULTS.ta_url.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+'));
    fetchText(url, cfg('ta_cookie'), function (html) {
      var res = parseHtml(html, url, 'a[href*="/lt/t"]', 'Torrent.ai', function (a, row, base) {
        var dl = row.querySelector('a[href$=".torrent"], a[href*="download"]');
        return dl ? abs(base, dl.getAttribute('href')) : '';
      });
      ok(res);
    }, fail);
  }

  function start() {
    try { Lampa.Noty.show('LT Trackeriai: papildinys įkeltas'); } catch (e) {}
    var original = Lampa.Parser.get;

    Lampa.Parser.get = function (params, oncomplete, onerror) {
      var q = (params.movie && (params.movie.original_title || params.movie.original_name)) || params.search || '';
      var all = [], pending = 2;
      function note(t) { try { Lampa.Noty.show(t); } catch (e) {} }
      note('LT paieška: ' + q);

      function done(list) {
        all = all.concat(list || []);
        if (--pending === 0) {
          all.sort(function (a, b) { return b.Seeders - a.Seeders; });
          oncomplete({ Results: all });
        }
      }
      searchLM(q, function (l) {
          note('Linkomanija: ' + l.length + ' | passkey: ' + (cfg('lm_passkey') ? 'yra' : 'NERA'));
          if (l[0]) setTimeout(function () { note('Nuoroda: ' + (l[0].Link || l[0].MagnetUri).replace(/passkey=[^&]+/, 'passkey=***').substring(0, 120)); }, 2500);
          done(l);
        },
        function () { note('Linkomanija: klaida (slapukai/tinklas)'); done([]); });
      searchTA(q, function (l) { note('Torrenta: ' + l.length); done(l); },
        function () { note('Torrenta: klaida (URL/tinklas)'); done([]); });
    };

    // Nustatymų skiltis
    try {
    Lampa.SettingsApi.addComponent({ component: 'lt_trackers', name: 'LT Trackeriai', icon: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>' });
    var FIELDS = {
      lm_cookie: ['Linkomanija slapukai', 'uid=...; pass=...'],
      lm_passkey: ['Linkomanija passkey', 'passkey iš profilio'],
      ta_cookie: ['Torrent.ai slapukai', 'slapukai iš naršyklės']
    };
    Object.keys(FIELDS).forEach(function (name) {
      Lampa.SettingsApi.addParam({
        component: 'lt_trackers',
        param: { name: KEY + name, type: 'input', values: '', placeholder: FIELDS[name][1], 'default': '' },
        field: { name: FIELDS[name][0], description: '' },
        onChange: function () {}
      });
    });
    } catch (e) { console.log('LT settings error', e); }

    // Įjungiame, kad Lampa naudotų parserį ir rodytų torrentų mygtuką
    Lampa.Storage.set('parser_use', true);
  }

  if (window.appready) start();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
