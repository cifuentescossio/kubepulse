/* /pulso · Paso 3 de 3. Polls GET /pulse every 5 s, charts GET /pulse/history, Obee warns when a room fills.
   If the backend is slow or down, the last data stays on screen with "hace X s"; with no data at all,
   /static/mock/pulse.json and /static/mock/pulse-history.json keep the UI alive. */
(function () {
  'use strict';
  var KP = window.KP, el = KP.el, t = KP.t;

  var POLL_MS = 5000;
  var HISTORY_MS = 60000;
  var WINDOW_MS = 30 * 60 * 1000;

  var profile = KP.getProfile() || KP.defaultProfile();
  var threshold = profile.a11y && profile.a11y.avoid_crowded ? 0.75 : 0.9;

  var state = {
    agenda: null, agendaFromMock: false,
    pulse: null, rooms: {}, lastOk: 0, failing: false, pulseFromMock: false,
    historyRoom: null, history: [], historyFromMock: false,
    banner: null,          // { kind: 'full'|'noalt'|'switched', key, vars }
    dismissedKey: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var routeList = $('route-list'), routeNotice = $('route-notice'), roomGrid = $('room-grid');
  var freshness = $('freshness'), region = $('obee-region'), headerTags = $('header-tags');
  var chartBox = $('chart-box'), chartTitle = $('chart-title'), canvas = $('chart-canvas');
  var chart = null;

  // ---------- agenda / next talk ----------
  function talks() { return (state.agenda && state.agenda.talks) || []; }

  function nextIndex() {
    var list = talks(), now = Date.now();
    for (var i = 0; i < list.length; i++) {
      if (new Date(list[i].end).getTime() > now) return i;
    }
    return list.length - 1; // day is over: keep the last talk as "next" so the demo still has a focus room
  }

  function occOf(roomId) {
    var r = state.rooms[roomId];
    return r ? r.occupancy : null;
  }

  // ---------- header tags ----------
  function renderTags() {
    var list = profile.interests || [];
    headerTags.textContent = '';
    list.forEach(function (i) { headerTags.appendChild(el('li', { className: 'header-chip', text: KP.tag(i) })); });
    headerTags.hidden = list.length === 0;
  }

  // ---------- route ----------
  function renderRoute() {
    var list = talks(), next = nextIndex();
    routeList.textContent = '';
    list.forEach(function (talk, i) {
      // Live occupancy only means something for the next talk and the ones after it.
      var past = i < next;
      var occ = !past && talk.room ? occOf(talk.room.id) : null;
      var full = occ != null && occ >= 0.9;
      var meta = [];
      if (talk.speakers && talk.speakers.length) meta.push(talk.speakers.join(', '));
      if (talk.room && talk.room.name) meta.push(talk.room.name);
      var titleId = 'route-talk-' + i;
      routeList.appendChild(el('li', {}, [
        el('article', { className: 'talk route-talk' + (full ? ' route-talk--full' : '') + (past ? ' route-talk--past' : '') + (i === next ? ' route-talk--next' : ''), 'aria-labelledby': titleId }, [
          el('p', { className: 'talk__time' }, [el('time', { datetime: talk.start, text: KP.time(talk.start) })]),
          KP.topicIcon(talk.topics),
          el('div', { className: 'talk__body' }, [
            i === next ? el('p', { className: 'next-badge', text: t('pulso.next') }) : null,
            el('h3', { className: 'talk__title', id: titleId, text: talk.title }),
            el('p', { className: 'talk__meta', text: meta.join(' · ') })
          ]),
          el('div', { className: 'talk__status' }, [
            occ != null ? KP.occPill(occ) : past ? el('span', { className: 'done-label', text: t('pulso.done') }) : null
          ])
        ])
      ]));
    });
    if (state.agendaFromMock) {
      routeNotice.hidden = false;
      routeNotice.textContent = '';
      routeNotice.appendChild(document.createTextNode(t('pulso.noroute') + ' '));
      routeNotice.appendChild(el('a', { href: KP.withDemo('/perfil'), text: t('pulso.build') }));
    } else {
      routeNotice.hidden = true;
    }
  }

  // ---------- rooms ----------
  var TREND = { up: '↑', down: '↓', flat: '→' };
  function renderRooms() {
    roomGrid.textContent = '';
    ((state.pulse && state.pulse.rooms) || []).forEach(function (r) {
      var lv = KP.level(r.occupancy);
      var trend = TREND[r.trend] ? r.trend : 'flat';
      roomGrid.appendChild(el('li', { className: 'room-card room-card--' + lv }, [
        el('p', { className: 'room-card__name', text: KP.shortRoom(r.name) }),
        el('p', { className: 'room-card__pct', text: KP.pct(r.occupancy) + '%' }),
        el('p', { className: 'room-card__state' }, [
          el('span', { 'aria-hidden': 'true', text: KP.SYMBOLS[lv] + ' ' }), t('occ.' + lv)
        ]),
        el('p', { className: 'room-card__trend' }, [
          el('span', { 'aria-hidden': 'true', text: TREND[trend] + ' ' }),
          el('span', { className: 'visually-hidden', text: t('pulso.trend', { trend: '' }) }),
          t('trend.' + trend)
        ])
      ]));
    });
  }

  function renderFreshness() {
    if (!state.lastOk) return;
    var s = Math.max(0, Math.round((Date.now() - state.lastOk) / 1000));
    freshness.removeAttribute('data-i18n');
    var text;
    if (state.pulseFromMock) text = t('pulso.mock');
    else if (state.failing) text = t('pulso.stale', { s: s });
    else text = t('pulso.updated', { s: s });
    freshness.textContent = text;
    freshness.classList.toggle('freshness--stale', state.failing || state.pulseFromMock);
  }

  // ---------- Obee banner ----------
  function evaluateBanner() {
    var list = talks(), i = nextIndex();
    if (i < 0 || !state.pulse) return;
    var talk = list[i];
    var occ = talk.room ? occOf(talk.room.id) : null;
    if (occ == null) return;

    if (occ < threshold - 0.05) {
      // Room recovered: drop a warning silently (no announcement), keep a "switched" confirmation.
      if (state.banner && state.banner.kind !== 'switched') { state.banner = null; renderBanner(); }
      return;
    }
    if (occ < threshold) return;

    var alt = talk.parallel_alternative;
    var altOcc = alt && alt.room ? occOf(alt.room.id) : null;
    var useAlt = alt && (altOcc == null || altOcc < threshold);
    var key = talk.id + '|' + (useAlt ? alt.id : '-');
    if (key === state.dismissedKey) return;
    if (state.banner && state.banner.key === key) return; // same situation: don't re-announce every poll

    var tagValue = (talk.match_reason && talk.match_reason[0]) || (talk.topics && talk.topics[0]) || '';
    state.banner = {
      kind: useAlt ? 'full' : 'noalt', key: key, index: i,
      vars: {
        pct: KP.pct(occ), title: useAlt ? alt.title : '', room: useAlt && alt.room ? alt.room.name : '',
        tagValue: tagValue, alt: altOcc != null ? KP.pct(altOcc) : '—'
      }
    };
    renderBanner();
  }

  function renderBanner() {
    region.textContent = '';
    var b = state.banner;
    if (!b) return;
    var vars = Object.assign({}, b.vars, { tag: KP.tag(b.vars.tagValue || '') });
    var msgKey = b.kind === 'full' ? 'pulso.obee.full' : b.kind === 'noalt' ? 'pulso.obee.full.noalt' : 'pulso.obee.switched';
    var actions = [];
    if (b.kind === 'full') {
      actions.push(el('button', {
        type: 'button', className: 'btn btn--primary',
        'aria-label': t('pulso.obee.switch.label', { title: vars.title, room: vars.room }),
        onclick: function () { switchTalk(b.index); }
      }, [t('pulso.obee.switch')]));
    }
    actions.push(el('button', {
      type: 'button', className: 'icon-btn', 'aria-label': t('pulso.obee.dismiss'),
      onclick: function () {
        state.dismissedKey = b.key; state.banner = null; renderBanner();
        var h = document.getElementById('route-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
      }
    }, [el('span', { 'aria-hidden': 'true', text: '×' })]));

    region.appendChild(el('div', { className: 'obee-banner' + (b.kind === 'switched' ? ' obee-banner--ok' : '') }, [
      el('img', { src: '/static/mascots/obee_full.svg', alt: t('obee.alt'), width: '48', height: '48' }),
      el('p', { className: 'obee-banner__text', text: t(msgKey, vars) }),
      el('div', { className: 'obee-banner__actions' }, actions)
    ]));
  }

  function switchTalk(index) {
    var list = talks();
    var before = list[index];
    if (!before || !before.parallel_alternative) return;
    var after = KP.swapTalk(before);
    list[index] = after;
    state.agenda.swaps = (state.agenda.swaps || 0) + 1;
    if (!state.agendaFromMock) KP.saveAgenda(state.agenda);
    KP.track('recommendation_switched', {
      'kubepulse.from_talk': before.id, 'kubepulse.to_talk': after.id,
      'kubepulse.to_room': after.room && after.room.id, 'kubepulse.screen': 'pulso',
      'kubepulse.from_room.occupancy': occOf(before.room && before.room.id)
    });
    state.banner = {
      kind: 'switched', key: after.id + '|switched', index: index,
      vars: { title: after.title, room: after.room ? after.room.name : '' }
    };
    renderBanner();
    renderRoute();
    loadHistory();
    // Focus stays sensible: the button is gone, so move focus to the updated route.
    var h = document.getElementById('route-talk-' + index);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  // ---------- chart ----------
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function chartRoomName() {
    var r = state.rooms[state.historyRoom];
    if (r) return r.name;
    var talk = talks()[nextIndex()];
    return talk && talk.room ? talk.room.name : state.historyRoom || '';
  }

  function renderChart() {
    var pts = state.history;
    var name = chartRoomName();
    chartTitle.textContent = name ? t('pulso.chart.title', { room: KP.shortRoom(name) }) : '';
    if (!pts.length) {
      chartBox.setAttribute('aria-label', t('pulso.chart.empty'));
      return;
    }
    chartBox.setAttribute('aria-label', t('pulso.chart.aria', {
      room: name, from: KP.pct(pts[0].occupancy), to: KP.pct(pts[pts.length - 1].occupancy)
    }));
    if (typeof window.Chart !== 'function') return; // CDN blocked: the aria-label + title still tell the story

    var labels = pts.map(function (p) { return KP.time(p.t); });
    var values = pts.map(function (p) { return KP.pct(p.occupancy); });
    var limit = pts.map(function () { return 90; });
    var line = css('--chart-line'), limitColor = css('--chart-limit'), grid = css('--chart-grid'), muted = css('--muted');
    var font = { family: css('--font-body') || 'sans-serif', size: 12 };

    if (!chart) {
      chart = new window.Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: t('pulso.chart.series'), data: values, borderColor: line, backgroundColor: line, borderWidth: 3, pointRadius: values.length < 3 ? 4 : 0, pointHitRadius: 10, tension: 0.25 },
            { label: t('pulso.chart.limit'), data: limit, borderColor: limitColor, borderWidth: 2, borderDash: [6, 5], pointRadius: 0, pointHitRadius: 0, fill: false }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: reducedMotion() ? false : { duration: 400 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + c.parsed.y + '%'; } } }
          },
          scales: {
            y: { min: 0, max: 100, ticks: { stepSize: 25, color: muted, font: font, callback: function (v) { return v + '%'; } }, grid: { color: grid }, border: { display: false } },
            x: { ticks: { color: muted, font: font, maxTicksLimit: 4, maxRotation: 0 }, grid: { display: false } }
          }
        }
      });
    } else {
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].pointRadius = values.length < 3 ? 4 : 0;
      chart.data.datasets[0].label = t('pulso.chart.series');
      chart.data.datasets[0].borderColor = chart.data.datasets[0].backgroundColor = line;
      chart.data.datasets[1].data = limit;
      chart.data.datasets[1].label = t('pulso.chart.limit');
      chart.data.datasets[1].borderColor = limitColor;
      chart.options.scales.y.ticks.color = chart.options.scales.x.ticks.color = muted;
      chart.options.scales.y.ticks.font = chart.options.scales.x.ticks.font = font;
      chart.options.scales.y.grid.color = grid;
      chart.update(reducedMotion() ? 'none' : undefined);
    }
  }

  function trimHistory() {
    if (!state.history.length) return;
    var last = new Date(state.history[state.history.length - 1].t).getTime();
    state.history = state.history.filter(function (p) { return last - new Date(p.t).getTime() <= WINDOW_MS; });
  }

  function loadHistory() {
    var talk = talks()[nextIndex()];
    var room = talk && talk.room ? talk.room.id : null;
    if (!room) return Promise.resolve();
    if (state.historyRoom !== room) { state.history = []; state.historyFromMock = false; }
    state.historyRoom = room;
    return KP.fetchJSON('/pulse/history?room=' + encodeURIComponent(room), { timeout: 4000 })
      .then(function (data) {
        if (!data || !Array.isArray(data.points)) throw new Error('bad payload');
        state.history = data.points.slice();
        state.historyFromMock = false;
      })
      .catch(function () {
        // Keep whatever we already have for this room; otherwise use the sample curve.
        if (state.history.length && !state.historyFromMock) return;
        return KP.fetchJSON('/static/mock/pulse-history.json').then(function (data) {
          var pts = data.points || [];
          var now = occOf(room);
          // The sample is for ACE; for another room, shift it so it ends at that room's live value.
          var shift = (data.room !== room && now != null && pts.length) ? now - pts[pts.length - 1].occupancy : 0;
          state.history = pts.map(function (p) { return { t: p.t, occupancy: Math.max(0, Math.min(1, p.occupancy + shift)) }; });
          state.historyFromMock = true;
        }).catch(function () { state.history = []; });
      })
      .then(function () { trimHistory(); renderChart(); });
  }

  // Each live /pulse answer extends the line, so a chaos spike shows up within one poll.
  function appendLivePoint() {
    if (!state.pulse || state.pulseFromMock || !state.historyRoom) return;
    var occ = occOf(state.historyRoom);
    if (occ == null) return;
    var tIso = state.pulse.updated_at || new Date().toISOString();
    var last = state.history[state.history.length - 1];
    if (state.historyFromMock) { state.history = []; state.historyFromMock = false; last = null; }
    if (last && new Date(tIso).getTime() <= new Date(last.t).getTime()) return;
    state.history.push({ t: tIso, occupancy: occ });
    trimHistory();
  }

  // ---------- polling ----------
  function applyPulse(data, fromMock) {
    state.pulse = data;
    state.rooms = {};
    (data.rooms || []).forEach(function (r) { state.rooms[r.id] = r; });
    state.pulseFromMock = fromMock;
    state.lastOk = Date.now();
    renderRooms();
    renderRoute();
    renderFreshness();
    appendLivePoint();
    renderChart();
    evaluateBanner();
  }

  var pollTimer = null, inFlight = null;
  function poll() {
    if (inFlight) return inFlight; // never run two polling loops
    clearTimeout(pollTimer);
    inFlight = KP.fetchJSON('/pulse', { timeout: 4000 })
      .then(function (data) {
        if (!data || !Array.isArray(data.rooms)) throw new Error('bad payload');
        state.failing = false;
        applyPulse(data, false);
      })
      .catch(function () {
        state.failing = true;
        if (!state.pulse) {
          return KP.fetchJSON('/static/mock/pulse.json').then(function (data) { applyPulse(data, true); });
        }
        renderFreshness();
      })
      .catch(function () { /* even the mock failed: keep the page as is */ })
      .then(function () { inFlight = null; pollTimer = setTimeout(poll, POLL_MS); });
    return inFlight;
  }

  // ---------- boot ----------
  function loadAgenda() {
    var stored = KP.getAgenda();
    if (stored && Array.isArray(stored.talks) && stored.talks.length) {
      state.agenda = stored;
      return Promise.resolve();
    }
    return KP.fetchJSON('/static/mock/agenda.json').then(function (data) {
      state.agenda = data;
      state.agendaFromMock = true;
    }).catch(function () { state.agenda = { talks: [], breaks: [] }; state.agendaFromMock = true; });
  }

  function rerenderAll() {
    renderTags(); renderRoute(); renderRooms(); renderFreshness(); renderBanner(); renderChart();
  }

  document.addEventListener('kp:lang', function () {
    if (chart) { chart.destroy(); chart = null; } // labels/times are language-dependent
    rerenderAll();
  });
  document.addEventListener('kp:theme', function () {
    if (chart) { chart.destroy(); chart = null; } // colors and fonts come from the theme
    renderChart();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  setInterval(renderFreshness, 1000);
  setInterval(loadHistory, HISTORY_MS);

  // Exposed for the demo chaos button (added in pulso view when ?demo=1).
  window.KPPulse = {
    poll: poll, loadHistory: loadHistory,
    nextRoom: function () { var tk = talks()[nextIndex()]; return tk && tk.room ? tk.room : null; }
  };

  KP.ready()
    .then(loadAgenda)
    .then(function () { renderTags(); renderRoute(); return poll(); })
    .then(loadHistory);
})();
