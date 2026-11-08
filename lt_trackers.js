// Lampa plugin: Linkomanija + Torrenta parseris
// Naudojimas: Lampa -> Nustatymai -> Papildiniai -> pridėti URL į šį failą
(function () {
  'use strict';

  var KEY = 'lt_trackers_';
  function cfg(name, def) { return Lampa.Storage.get(KEY + name, def || ''); }

  // ---------- Nustatymai (galima keisti per Lampa.Storage arba žemiau esančiame meniu) ----------
  var DEFAULTS = {
    lm_cookie: '',   // pvz. "uid=123; pass=abcdef..."  (iš naršyklės po prisijungimo)
    lm_passkey: '',  // Linkomanija profilio passkey (reikalingas .torrent atsisiuntimui)
    lm_url: 'https://www.linkomanija.net/browse.php?search={q}&incldead=0',
    ta_cookie: '',
    ta_url: 'https://torrenta.ai/search?q={q}' // PATIKRINKITE tikrą paieškos URL
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
    var links = doc.querySelectorAll(linkSel);
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var row = a.closest('tr') || a.parentNode;
      if (!row) continue;
      var title = (a.getAttribute('title') || a.textContent || '').trim();
      if (!title) continue;

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
    var url = cfg('lm_url', DEFAULTS.lm_url).replace('{q}', encodeURIComponent(q));
    var passkey = cfg('lm_passkey');
    fetchText(url, cfg('lm_cookie'), function (html) {
      var res = parseHtml(html, url, 'a[href*="details.php?id="]', 'Linkomanija', function (a, row, base) {
        var m = /id=(\d+)/.exec(a.getAttribute('href'));
        if (!m) return '';
        var dl = row.querySelector('a[href*="download.php"]');
        if (dl) return abs(base, dl.getAttribute('href')) + (passkey && dl.getAttribute('href').indexOf('passkey') < 0 ? '&passkey=' + passkey : '');
        return abs(base, 'download.php?id=' + m[1] + (passkey ? '&passkey=' + passkey : ''));
      });
      ok(res);
    }, fail);
  }

  function searchTA(q, ok, fail) {
    var url = cfg('ta_url', DEFAULTS.ta_url).replace('{q}', encodeURIComponent(q));
    fetchText(url, cfg('ta_cookie'), function (html) {
      var res = parseHtml(html, url, 'a[href*="torrent"]:not([href^="magnet:"])', 'Torrenta', function (a, row, base) {
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
      searchLM(q, function (l) { note('Linkomanija: ' + l.length); done(l); },
        function () { note('Linkomanija: klaida (slapukai/tinklas)'); done([]); });
      searchTA(q, function (l) { note('Torrenta: ' + l.length); done(l); },
        function () { note('Torrenta: klaida (URL/tinklas)'); done([]); });
    };

    // Nustatymų skiltis
    try {
    Lampa.SettingsApi.addComponent({ component: 'lt_trackers', name: 'LT Trackeriai', icon: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>' });
    ['lm_cookie', 'lm_passkey', 'lm_url', 'ta_url', 'ta_cookie'].forEach(function (name) {
      Lampa.SettingsApi.addParam({
        component: 'lt_trackers',
        param: { name: KEY + name, type: 'input', 'default': DEFAULTS[name] },
        field: { name: name, description: '' },
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
