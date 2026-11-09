/* KubePulse · shared frontend helpers: theme, i18n, profile storage, occupancy, fetch, RUM events. */
(function () {
  'use strict';

  var THEMES = ['kube', 'dark', 'mujeres', 'daltonismo', 'lectura', 'pride'];
  var LANGS = ['en', 'zh', 'hi', 'es', 'fr'];
  var LOCALES = { en: 'en-US', zh: 'zh-CN', hi: 'hi-IN', es: 'es-ES', fr: 'fr-FR' };
  var KEYS = { theme: 'kubepulse.theme', lang: 'kubepulse.lang', profile: 'kubepulse.profile', agenda: 'kubepulse.agenda' };
  var TZ = 'America/Denver'; // Salt Lake City

  var root = document.documentElement;
  var dict = null;          // { es: {...}, en: {...} }
  var dictPromise = null;

  // ---------- storage (never throws) ----------
  function load(key) {
    try { var v = localStorage.getItem(key); return v == null ? null : JSON.parse(v); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function loadRaw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function saveRaw(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

  // ---------- RUM events (Dash0). No-op when the SDK isn't loaded. ----------
  function track(name, attributes) {
    try {
      if (typeof window.dash0 === 'function') {
        window.dash0('sendEvent', name, { attributes: attributes || {} });
      }
    } catch (e) { /* telemetry must never break the UI */ }
  }

  // ---------- i18n ----------
  function lang() { var l = root.getAttribute('lang'); return LANGS.indexOf(l) === -1 ? 'en' : l; }
  // Talks and the API only know es|en; other UI languages ask for English talks.
  function contentLang() { return lang() === 'es' ? 'es' : 'en'; }
  function locale() { return LOCALES[lang()] || 'en-US'; }

  function loadDict() {
    if (!dictPromise) {
      dictPromise = fetch('/static/i18n.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('i18n ' + r.status); return r.json(); })
        .then(function (d) { dict = d; return d; })
        .catch(function () { dict = { en: {} }; return dict; });
    }
    return dictPromise;
  }

  // t('key', {name: 'Daniel'}) → translated string with {placeholders} filled.
  // Falls back to English, then to `fallback`, then to the key itself.
  function t(key, vars, fallback) {
    var table = (dict && dict[lang()]) || {};
    var s = table[key];
    if (s == null && dict && dict.en) s = dict.en[key];
    if (s == null) s = fallback != null ? fallback : key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    }
    return s;
  }

  // Display label for an interest/topic tag. Tag values stay canonical (Spanish) for the API.
  function tag(value) { return t('tag.' + value, null, value); }

  function applyI18n(scope) {
    scope = scope || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!el.hasAttribute('data-i18n-default')) el.setAttribute('data-i18n-default', el.textContent);
      el.textContent = t(key, null, el.getAttribute('data-i18n-default'));
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var parts = pair.split(':');
        if (parts.length !== 2) return;
        var attr = parts[0].trim(), key = parts[1].trim();
        var dkey = 'data-i18n-default-' + attr;
        if (!el.hasAttribute(dkey)) el.setAttribute(dkey, el.getAttribute(attr) || '');
        el.setAttribute(attr, t(key, null, el.getAttribute(dkey)));
      });
    });
    var titleKey = document.body && document.body.getAttribute('data-title-key');
    if (titleKey) document.title = t(titleKey) + ' · KubePulse';
  }

  function setLang(next, opts) {
    if (LANGS.indexOf(next) === -1) next = 'en';
    var prev = lang();
    root.setAttribute('lang', next);
    saveRaw(KEYS.lang, next);
    document.querySelectorAll('[data-lang-select]').forEach(function (s) { s.value = next; });
    return loadDict().then(function () {
      applyI18n();
      updateThemeLabel();
      document.dispatchEvent(new CustomEvent('kp:lang', { detail: { lang: next } }));
      if (!(opts && opts.silent) && prev !== next) track('lang_changed', { 'kubepulse.lang': next, 'kubepulse.lang.previous': prev });
    });
  }

  // ---------- themes ----------
  function theme() {
    var th = root.getAttribute('data-theme');
    return THEMES.indexOf(th) === -1 ? 'kube' : th;
  }

  function updateThemeLabel() {
    var current = theme();
    var label = document.querySelector('[data-theme-current]');
    if (label) label.textContent = t('theme.short.' + current, null, current);
    document.querySelectorAll('input[name="kp-theme"]').forEach(function (r) { r.checked = r.value === current; });
  }

  function setTheme(next) {
    if (THEMES.indexOf(next) === -1) return;
    var prev = theme();
    root.setAttribute('data-theme', next);
    saveRaw(KEYS.theme, next);
    updateThemeLabel();
    document.dispatchEvent(new CustomEvent('kp:theme', { detail: { theme: next } }));
    if (prev !== next) track('theme_changed', { 'kubepulse.theme': next, 'kubepulse.theme.previous': prev });
  }

  function initThemePicker() {
    var picker = document.querySelector('[data-theme-picker]');
    if (!picker) return;
    var toggle = picker.querySelector('[data-theme-toggle]');
    var panel = picker.querySelector('.theme-picker__panel');

    function open() {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      var checked = panel.querySelector('input:checked') || panel.querySelector('input');
      if (checked) checked.focus();
    }
    function close(returnFocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener('click', function () { panel.hidden ? open() : close(true); });
    panel.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'kp-theme') setTheme(e.target.value);
    });
    // Enter / click on an option confirms and closes; arrow keys only preview.
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.name === 'kp-theme') { e.preventDefault(); close(true); }
    });
    panel.addEventListener('click', function (e) {
      // Pointer clicks on an option (detail > 0) close the menu; keyboard Space keeps it open.
      if (e.detail > 0 && e.target.closest && e.target.closest('.theme-option')) {
        setTimeout(function () { close(true); }, 0);
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
    document.addEventListener('click', function (e) { if (!picker.contains(e.target)) close(false); });
    picker.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !picker.contains(e.relatedTarget)) close(false);
    });
  }


  // ---------- occupancy ----------
  // < 0.50 low "Hay espacio" · 0.50–0.89 mid "Llenándose" · >= 0.90 high "Llena"
  var SYMBOLS = { low: '●', mid: '▲', high: '■' };
  function level(occ) { return occ >= 0.9 ? 'high' : occ >= 0.5 ? 'mid' : 'low'; }
  function pct(occ) { return Math.round(Math.max(0, Math.min(1, occ)) * 100); }

  // <span class="occ occ--mid"><span aria-hidden>▲</span> Llenándose 71%</span>
  function occPill(occ, opts) {
    var lv = level(occ);
    var el = document.createElement('span');
    el.className = 'occ occ--' + lv + (opts && opts.className ? ' ' + opts.className : '');
    var sym = document.createElement('span');
    sym.className = 'occ__sym';
    sym.setAttribute('aria-hidden', 'true');
    sym.textContent = SYMBOLS[lv];
    el.appendChild(sym);
    el.appendChild(document.createTextNode(' ' + t('occ.' + lv) + ' ' + pct(occ) + '%'));
    return el;
  }

  function forecastPill(forecast) {
    var lv = SYMBOLS[forecast] ? forecast : 'low';
    var el = document.createElement('span');
    el.className = 'occ occ--' + lv;
    var sym = document.createElement('span');
    sym.className = 'occ__sym';
    sym.setAttribute('aria-hidden', 'true');
    sym.textContent = SYMBOLS[lv];
    el.appendChild(sym);
    el.appendChild(document.createTextNode(' ' + t('forecast.' + lv)));
    return el;
  }

  // ---------- topic icons (neutral line icons; mascots never label talks) ----------
  var ICONS = {
    chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3"/>',
    shield: '<path d="M12 2.8l7.5 3v5.6c0 4.6-3.2 8.4-7.5 9.8-4.3-1.4-7.5-5.2-7.5-9.8V5.8z"/><path d="M8.8 12.2l2.3 2.3 4.3-4.6"/>',
    layers: '<path d="M12 3.5l9 4.6-9 4.6-9-4.6z"/><path d="M3 12.3l9 4.6 9-4.6"/><path d="M3 16.4l9 4.6 9-4.6"/>',
    activity: '<path d="M2.5 12h4l3-7 5 14 3-7h4"/>'
  };
  function topicIconKind(topics) {
    var first = (topics && topics[0]) || '';
    if ((topics || []).indexOf('Seguridad') !== -1) return { icon: 'shield', tone: 'red' };
    if (first === 'Platform Engineering' || first === 'GitOps') return { icon: 'layers', tone: 'green' };
    if (first === 'Observabilidad' || first === 'eBPF') return { icon: 'activity', tone: 'blue' };
    return { icon: 'chip', tone: 'blue' };
  }
  function topicIcon(topics) {
    var k = topicIconKind(topics);
    var span = document.createElement('span');
    span.className = 'topic-icon topic-icon--' + k.tone;
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + ICONS[k.icon] + '</svg>';
    return span;
  }

  // Join tags for display: "MCP + Agentes" or "Agentes, MCP y GitOps".
  function joinTags(tags, sep) {
    var labels = (tags || []).map(tag);
    if (sep === 'plus') return labels.join(t('list.plus'));
    if (labels.length <= 1) return labels.join('');
    return labels.slice(0, -1).join(', ') + t('list.and') + labels[labels.length - 1];
  }

  // Small DOM helper: el('p', {className: 'x', text: 'hi'}, [children])
  function el(tagName, props, children) {
    var node = document.createElement(tagName);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') node.textContent = props[k];
      else if (k === 'className') node.className = props[k];
      else if (k.indexOf('on') === 0 && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null && props[k] !== false) node.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // ---------- agenda helpers (shared by /schedule and /live) ----------
  // Parallel talks that also match the person's interests. Newer backends send `parallel_matches`
  // (always an array); older ones and the sample agenda may only send `parallel_alternative`.
  function hasMatches(talk) { return !!talk && Array.isArray(talk.parallel_matches); }
  function parallelOptions(talk) {
    if (!talk) return [];
    if (hasMatches(talk)) return talk.parallel_matches.filter(function (m) { return m && m.id; });
    return talk.parallel_alternative ? [talk.parallel_alternative] : [];
  }

  function asOption(talk) {
    return {
      id: talk.id, title: talk.title, speakers: talk.speakers || [], start: talk.start, end: talk.end,
      room: talk.room, topics: talk.topics || [], match_reason: talk.match_reason || [], forecast: talk.forecast || null
    };
  }

  // Put the parallel talk `id` in the slot. The previous pick becomes the first parallel option, so the
  // person can switch back. Options that only carry id/title/room (old `parallel_alternative`) inherit the
  // slot's times and the reason it was picked.
  function pickParallel(talk, id) {
    var opts = parallelOptions(talk);
    var chosen = opts.filter(function (o) { return o.id === id; })[0];
    // parallel_alternative may be a parallel talk that matches no interest (then it isn't in parallel_matches).
    if (!chosen && talk && talk.parallel_alternative && talk.parallel_alternative.id === id) chosen = talk.parallel_alternative;
    if (!chosen) return talk;
    var prev = asOption(talk);
    var originalId = talk.original_id || talk.id;
    var next = {
      id: chosen.id, title: chosen.title, room: chosen.room,
      speakers: chosen.speakers || [], start: chosen.start || talk.start, end: chosen.end || talk.end,
      topics: chosen.topics || talk.topics, match_reason: chosen.match_reason || talk.match_reason,
      forecast: chosen.forecast || null,
      parallel_alternative: prev,
      original_id: originalId,
      swapped: chosen.id !== originalId
    };
    if (hasMatches(talk)) {
      next.parallel_matches = [prev].concat(opts.filter(function (o) { return o.id !== id; }));
    }
    return next;
  }

  // Legacy: swap with `parallel_alternative`.
  function swapTalk(talk) {
    var alt = talk && talk.parallel_alternative;
    return alt ? pickParallel(talk, alt.id) : talk;
  }

  // Options of a slot (recommended first, then its parallel matches) ranked by live occupancy.
  // occOf(roomId) returns 0..1 or null. Rooms without live data keep their order, after the known ones.
  // Returns { options: [{ talk, occ, recommended }], leastId } where leastId is the least crowded known room's talk.
  function rankByOccupancy(talk, occOf) {
    var rec = { talk: talk, occ: talk.room ? occOf(talk.room.id) : null, recommended: true, i: 0 };
    var others = parallelOptions(talk).map(function (o, i) {
      return { talk: o, occ: o.room ? occOf(o.room.id) : null, recommended: false, i: i + 1 };
    });
    others.sort(function (a, b) {
      if (a.occ == null && b.occ == null) return a.i - b.i;
      if (a.occ == null) return 1;
      if (b.occ == null) return -1;
      return a.occ - b.occ || a.i - b.i;
    });
    var least = null;
    [rec].concat(others).forEach(function (o) {
      if (o.occ != null && (least == null || o.occ < least.occ)) least = o;
    });
    // Only worth a label when there is something to compare.
    var known = [rec].concat(others).filter(function (o) { return o.occ != null; }).length;
    return { options: [rec].concat(others), leastId: least && known > 1 ? least.talk.id : null };
  }
  function shortRoom(name) { return String(name || '').replace(/^Grand Ballroom\s+/i, ''); }
  function getAgenda() { return load(KEYS.agenda); }
  function saveAgenda(a) { return save(KEYS.agenda, a); }

  // ---------- time ----------
  function time(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(locale(), {
      hour: 'numeric', minute: '2-digit', timeZone: TZ, hour12: lang() === 'en'
    }).format(d);
  }
  function day(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(locale(), {
      weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ
    }).format(d);
  }

  // ---------- fetch with timeout ----------
  function fetchJSON(url, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 6000) : null;
    var init = { method: opts.method || 'GET', headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(url, init).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) { var err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
      return r.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  // ---------- profile ----------
  function getProfile() { return load(KEYS.profile); }
  function saveProfile(p) { return save(KEYS.profile, p); }
  function defaultProfile() {
    return {
      name: '', role: 'Platform Engineer', interests: [], level: 'any', lang: contentLang(),
      a11y: { captions: false, wheelchair: false, avoid_crowded: false }
    };
  }

  // Keep ?demo=1 on internal links so the demo flow survives navigation.
  function isDemo() { return /[?&]demo=1(&|$)/.test(location.search); }
  function withDemo(href) {
    if (!isDemo()) return href;
    return href + (href.indexOf('?') === -1 ? '?' : '&') + 'demo=1';
  }

  // ---------- init ----------
  function init() {
    document.querySelectorAll('[data-lang-select]').forEach(function (s) {
      s.addEventListener('change', function () { setLang(s.value); });
    });
    initThemePicker();
    setLang(lang(), { silent: true });
  }

  window.KP = {
    KEYS: KEYS, THEMES: THEMES,
    t: t, tag: tag, lang: lang, contentLang: contentLang, setLang: setLang, applyI18n: applyI18n, ready: loadDict,
    theme: theme, setTheme: setTheme,
    level: level, pct: pct, occPill: occPill, forecastPill: forecastPill, SYMBOLS: SYMBOLS,
    time: time, day: day,
    topicIcon: topicIcon, joinTags: joinTags, el: el,
    swapTalk: swapTalk, pickParallel: pickParallel, parallelOptions: parallelOptions, hasMatches: hasMatches,
    rankByOccupancy: rankByOccupancy, shortRoom: shortRoom, getAgenda: getAgenda, saveAgenda: saveAgenda,
    fetchJSON: fetchJSON, load: load, save: save,
    getProfile: getProfile, saveProfile: saveProfile, defaultProfile: defaultProfile,
    isDemo: isDemo, withDemo: withDemo,
    track: track
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
