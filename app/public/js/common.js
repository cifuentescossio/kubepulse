/* KubePulse · shared frontend helpers: theme, i18n, profile storage, occupancy, fetch, RUM events. */
(function () {
  'use strict';

  var THEMES = ['kube', 'dark', 'mujeres', 'daltonismo', 'lectura', 'pride'];
  var LANGS = ['es', 'en'];
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
  function lang() { return root.getAttribute('lang') === 'en' ? 'en' : 'es'; }

  function loadDict() {
    if (!dictPromise) {
      dictPromise = fetch('/static/i18n.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('i18n ' + r.status); return r.json(); })
        .then(function (d) { dict = d; return d; })
        .catch(function () { dict = { es: {}, en: {} }; return dict; });
    }
    return dictPromise;
  }

  // t('key', {name: 'Daniel'}) → translated string with {placeholders} filled.
  // Falls back to Spanish, then to `fallback`, then to the key itself.
  function t(key, vars, fallback) {
    var table = (dict && dict[lang()]) || {};
    var s = table[key];
    if (s == null && dict && dict.es) s = dict.es[key];
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
    if (LANGS.indexOf(next) === -1) next = 'es';
    var prev = lang();
    root.setAttribute('lang', next);
    saveRaw(KEYS.lang, next);
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === next));
    });
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

  // Follow the OS dark-mode setting live, but only while the user hasn't picked a theme.
  function watchColorScheme() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (loadRaw(KEYS.theme)) return;
      root.setAttribute('data-theme', mq.matches ? 'dark' : 'kube');
      updateThemeLabel();
      document.dispatchEvent(new CustomEvent('kp:theme', { detail: { theme: theme() } }));
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
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

  // ---------- time ----------
  function time(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'es-ES', {
      hour: 'numeric', minute: '2-digit', timeZone: TZ, hour12: lang() === 'en'
    }).format(d);
  }
  function day(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'es-ES', {
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
      name: '', role: 'Platform Engineer', interests: [], level: 'any', lang: lang(),
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
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); });
    });
    initThemePicker();
    watchColorScheme();
    setLang(lang(), { silent: true });
  }

  window.KP = {
    KEYS: KEYS, THEMES: THEMES,
    t: t, tag: tag, lang: lang, setLang: setLang, applyI18n: applyI18n, ready: loadDict,
    theme: theme, setTheme: setTheme,
    level: level, pct: pct, occPill: occPill, forecastPill: forecastPill, SYMBOLS: SYMBOLS,
    time: time, day: day,
    fetchJSON: fetchJSON, load: load, save: save,
    getProfile: getProfile, saveProfile: saveProfile, defaultProfile: defaultProfile,
    isDemo: isDemo, withDemo: withDemo,
    track: track
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
