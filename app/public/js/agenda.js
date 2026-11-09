/* /schedule · Step 2 of 3. POST /recommend with the profile; falls back to /static/mock/agenda.json.
   Each slot shows the recommended talk and the parallel talks that also match the person's interests,
   with the live occupancy of each room (GET /pulse every 15 s) so they can pick the least crowded one. */
(function () {
  'use strict';
  var KP = window.KP, el = KP.el, t = KP.t;

  var PULSE_MS = 15000;

  var profile = KP.getProfile() || KP.defaultProfile();
  var avoidCrowded = !!(profile.a11y && profile.a11y.avoid_crowded);
  var state = {
    agenda: null, source: null, notice: 'agenda.loading', noticeVars: null, swaps: 0,
    rooms: null,          // { roomId: occupancy 0..1 } from GET /pulse, null until the first answer
    pulseSig: '',         // rounded occupancies, to skip re-rendering when nothing visible changed
    watch: null           // { slotKey: { least, recHigh } } baseline for aria-live announcements
  };

  var main = document.getElementById('agenda-main');
  var titleEl = document.getElementById('agenda-title');
  var subtitleEl = document.getElementById('agenda-subtitle');
  var noticeEl = document.getElementById('agenda-notice');
  var liveEl = document.getElementById('occ-live');
  var timeline = document.getElementById('timeline');
  var tagsEl = document.getElementById('summary-tags');
  var countEl = document.getElementById('summary-count');
  var obeeEl = document.getElementById('obee-agenda');
  var confirmBtn = document.getElementById('confirm');

  // Request body exactly as docs/contracts.md (no extra fields).
  function requestBody() {
    var a = profile.a11y || {};
    return {
      name: profile.name || '', role: profile.role || '', interests: profile.interests || [],
      level: profile.level || 'any', lang: profile.lang === 'en' ? 'en' : 'es',
      a11y: { captions: !!a.captions, wheelchair: !!a.wheelchair, avoid_crowded: !!a.avoid_crowded }
    };
  }

  function valid(data) { return data && Array.isArray(data.talks); }

  function loadAgenda() {
    var stored = KP.getAgenda();
    // Keep a stored agenda (with the user's swaps) unless it was only the sample one: then retry the API.
    if (stored && valid(stored) && (stored.source === 'api' || stored.swaps)) {
      return Promise.resolve({ data: stored, source: stored.source || 'api' });
    }
    // /recommend can be slow under chaos; give it 8 s before using the sample agenda.
    return KP.fetchJSON('/recommend', { method: 'POST', body: requestBody(), timeout: 8000 })
      .then(function (data) {
        if (!valid(data)) throw new Error('bad payload');
        return { data: data, source: 'api' };
      })
      .catch(function () {
        return KP.fetchJSON('/static/mock/agenda.json').then(function (data) { return { data: data, source: 'mock' }; });
      });
  }

  function sorted(agenda) {
    var rows = (agenda.talks || []).map(function (talk, i) { return { kind: 'talk', start: talk.start, talk: talk, index: i }; })
      .concat((agenda.breaks || []).map(function (b) { return { kind: 'break', start: b.start, brk: b }; }));
    return rows.sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
  }

  // ---------- live occupancy ----------
  function occOf(roomId) {
    return state.rooms && Object.prototype.hasOwnProperty.call(state.rooms, roomId) ? state.rooms[roomId] : null;
  }

  // Live pill (symbol + text + %) when /pulse knows the room, otherwise the forecast.
  function statusPill(option) {
    var occ = option.room ? occOf(option.room.id) : null;
    if (occ != null) return KP.occPill(occ);
    return option.forecast ? KP.forecastPill(option.forecast) : null;
  }

  function leastBadge(isLeast) {
    if (!isLeast) return null;
    return el('span', { className: 'least-badge' + (avoidCrowded ? ' least-badge--suggested' : '') }, [
      el('span', { 'aria-hidden': 'true', text: '✓ ' }),
      t(avoidCrowded ? 'agenda.suggested' : 'agenda.least')
    ]);
  }

  // ---------- rendering ----------
  function talkMeta(talk, withTime) {
    var meta = [];
    if (withTime && talk.start) meta.push(KP.time(talk.start) + (talk.end ? '–' + KP.time(talk.end) : ''));
    if (talk.room && talk.room.name) meta.push(talk.room.name);
    if (talk.speakers && talk.speakers.length) meta.push(talk.speakers.join(', '));
    return meta.join(' · ');
  }

  function legacyParallel(talk, index) {
    var alt = talk.parallel_alternative;
    if (!alt) return null;
    return el('p', { className: 'talk__parallel' }, [
      t('agenda.parallel') + ' ',
      el('button', {
        type: 'button', className: 'link-btn', 'data-focus': 'swap-' + index,
        'aria-label': t('agenda.swap', { title: alt.title, room: alt.room && alt.room.name }),
        onclick: function () { pick(index, alt.id); }
      }, [alt.title + ' (' + KP.shortRoom(alt.room && alt.room.name) + ')'])
    ]);
  }

  function matchesSection(index, ranked) {
    var others = ranked.options.filter(function (o) { return !o.recommended; });
    if (!others.length) return null;
    var headingId = 'matches-' + index;
    return el('section', { className: 'parallel', 'aria-labelledby': headingId }, [
      el('h4', { className: 'parallel__title', id: headingId, text: t('agenda.matches') }),
      el('ul', { className: 'parallel__list' }, others.map(function (o) {
        var m = o.talk, isLeast = ranked.leastId === m.id;
        var cls = 'parallel-opt' + (isLeast ? ' parallel-opt--least' : '') + (isLeast && avoidCrowded ? ' parallel-opt--suggested' : '');
        var why = (m.match_reason && m.match_reason.length) ? m.match_reason : [];
        return el('li', { className: cls }, [
          el('div', { className: 'parallel-opt__body' }, [
            el('h5', { className: 'parallel-opt__title', text: m.title }),
            el('p', { className: 'talk__meta', text: talkMeta(m, true) }),
            why.length ? el('p', { className: 'talk__why', text: t('agenda.matches.why', { tags: KP.joinTags(why, 'plus') }) }) : null
          ]),
          el('div', { className: 'parallel-opt__status' }, [statusPill(m), leastBadge(isLeast)]),
          el('button', {
            type: 'button', className: 'btn btn--secondary parallel-opt__pick', 'data-focus': 'pick-' + index + '-' + m.id,
            'aria-label': t('agenda.pick.label', { title: m.title, room: m.room && m.room.name }),
            onclick: function () { pick(index, m.id); }
          }, [t('agenda.pick')])
        ]);
      }))
    ]);
  }

  function talkRow(talk, index) {
    var multi = KP.hasMatches(talk);
    var ranked = KP.rankByOccupancy(talk, occOf);
    var isLeast = multi && ranked.leastId === talk.id;

    var body = [
      el('h4', { className: 'talk__title', id: 'talk-' + index, tabindex: '-1', text: talk.title }),
      el('p', { className: 'talk__meta', text: talkMeta(talk, false) })
    ];
    if (talk.match_reason && talk.match_reason.length) {
      body.push(el('p', { className: 'talk__why', text: t('agenda.why', { tags: KP.joinTags(talk.match_reason, 'plus') }) }));
    }
    if (!multi) body.push(legacyParallel(talk, index));

    var slotHeading = 'slot-' + index;
    var timeText = KP.time(talk.start) + (talk.end ? '–' + KP.time(talk.end) : '');
    return el('li', { className: 'slot' }, [
      el('h3', { className: 'visually-hidden', id: slotHeading, text: t('agenda.slot', { time: timeText }) }),
      el('article', {
        className: 'talk' + (isLeast ? ' talk--least' : '') + (isLeast && avoidCrowded ? ' talk--suggested' : ''),
        'aria-labelledby': 'talk-' + index
      }, [
        el('p', { className: 'talk__time' }, [el('time', { datetime: talk.start, text: KP.time(talk.start) })]),
        KP.topicIcon(talk.topics),
        el('div', { className: 'talk__body' }, body),
        el('div', { className: 'talk__status' }, [statusPill(talk), leastBadge(isLeast)])
      ]),
      multi ? matchesSection(index, ranked) : null
    ]);
  }

  function breakRow(b) {
    return el('li', { className: 'slot slot--break' }, [
      el('time', { datetime: b.start, text: KP.time(b.start) }),
      ' · ' + t('agenda.break.' + (b.label === 'lunch' ? 'lunch' : 'coffee'))
    ]);
  }

  function renderNotice() {
    if (!state.notice) { noticeEl.textContent = ''; noticeEl.hidden = true; return; }
    noticeEl.hidden = false;
    noticeEl.textContent = t(state.notice, state.noticeVars);
  }

  function renderTimeline() {
    // Re-rendering replaces the buttons: keep keyboard focus on the same control.
    var active = document.activeElement;
    var focusKey = active && timeline.contains(active) ? active.getAttribute('data-focus') : null;
    timeline.textContent = '';
    sorted(state.agenda).forEach(function (row) {
      timeline.appendChild(row.kind === 'talk' ? talkRow(row.talk, row.index) : breakRow(row.brk));
    });
    if (focusKey) {
      var again = timeline.querySelector('[data-focus="' + focusKey + '"]');
      if (again) again.focus();
    }
  }

  function render() {
    var agenda = state.agenda;
    var name = (profile.name || '').trim();
    titleEl.textContent = name ? t('agenda.heading', { name: name }) : t('agenda.heading.anon');
    titleEl.removeAttribute('data-i18n');

    var interests = profile.interests || [];
    tagsEl.textContent = '';
    interests.forEach(function (i) { tagsEl.appendChild(el('li', { className: 'tag', text: KP.tag(i) })); });
    tagsEl.hidden = interests.length === 0;

    renderNotice();
    if (!agenda) return;

    var talks = agenda.talks || [];
    var firstStart = talks.length ? talks[0].start : (agenda.breaks && agenda.breaks[0] && agenda.breaks[0].start);
    var day = firstStart ? KP.day(firstStart) : '';
    day = day.charAt(0).toUpperCase() + day.slice(1);
    subtitleEl.textContent = interests.length
      ? t('agenda.subtitle', { day: day, tags: KP.joinTags(interests) })
      : t('agenda.subtitle.notags', { day: day });

    renderTimeline();

    var withMatches = talks.filter(function (x) { return KP.hasMatches(x) && KP.parallelOptions(x).length; }).length;
    var withAlt = talks.filter(function (x) { return !KP.hasMatches(x) && x.parallel_alternative; }).length;
    var count = t('agenda.summary.count', { n: talks.length });
    if (withMatches) count += ' ' + t('agenda.summary.matches', { n: withMatches });
    else if (withAlt) count += ' ' + t('agenda.summary.parallel', { n: withAlt });
    countEl.textContent = count;

    var busy = talks.filter(function (x) { return x.forecast === 'high'; })[0];
    obeeEl.removeAttribute('data-i18n');
    obeeEl.textContent = busy ? t('agenda.obee', { time: KP.time(busy.start) }) : t('agenda.obee.none');

    confirmBtn.disabled = talks.length === 0;
  }

  function persist() {
    KP.saveAgenda({
      talks: state.agenda.talks, breaks: state.agenda.breaks || [],
      source: state.source, swaps: state.swaps
    });
  }

  function pick(index, id) {
    var before = state.agenda.talks[index];
    var after = KP.pickParallel(before, id);
    if (after === before) return;
    state.agenda.talks[index] = after;
    state.swaps += 1;
    persist();
    // Privacy: no talk ids or rooms (they reveal the person's interests).
    KP.track('recommendation_switched', { 'kubepulse.screen': 'agenda' });
    state.notice = 'agenda.swapped';
    state.noticeVars = { title: after.title, room: after.room && after.room.name };
    render();
    state.watch = snapshot(); // the person caused this change: nothing to announce
    var heading = document.getElementById('talk-' + index);
    if (heading) heading.focus();
  }

  // ---------- aria-live: only relevant occupancy changes ----------
  // Watched: upcoming slots. Announced: a different least crowded option, or the recommended room becoming full.
  function upcoming() {
    var list = (state.agenda && state.agenda.talks) || [], now = Date.now();
    var next = list.filter(function (x) { return new Date(x.end || x.start).getTime() > now; });
    return next.length ? next : list; // the day is over (or the sample agenda): watch all of it
  }

  function snapshot() {
    var snap = {};
    upcoming().forEach(function (talk) {
      if (!KP.hasMatches(talk)) return;
      var occ = talk.room ? occOf(talk.room.id) : null;
      snap[talk.start] = { least: KP.rankByOccupancy(talk, occOf).leastId, recHigh: occ != null && occ >= 0.9 };
    });
    return snap;
  }

  function announce() {
    var prev = state.watch, next = snapshot();
    state.watch = next;
    if (!prev) return; // first answer: the page already shows it
    var msg = null;
    upcoming().some(function (talk) {
      var a = prev[talk.start], b = next[talk.start];
      if (!a || !b) return false;
      var time = KP.time(talk.start);
      if (b.recHigh && !a.recHigh) {
        msg = t('agenda.live.full', { time: time, title: talk.title, pct: KP.pct(occOf(talk.room.id)) });
        return true;
      }
      if (b.least && b.least !== a.least) {
        var opt = b.least === talk.id ? talk : KP.parallelOptions(talk).filter(function (o) { return o.id === b.least; })[0];
        if (!opt) return false;
        msg = t('agenda.live.least', { time: time, title: opt.title, room: opt.room && opt.room.name, pct: KP.pct(occOf(opt.room.id)) });
        return true;
      }
      return false;
    });
    if (msg) liveEl.textContent = msg;
  }

  function applyPulse(data) {
    var rooms = {};
    (data.rooms || []).forEach(function (r) { if (r && r.id != null && typeof r.occupancy === 'number') rooms[r.id] = r.occupancy; });
    state.rooms = rooms;
    var sig = Object.keys(rooms).sort().map(function (k) { return k + ':' + KP.pct(rooms[k]); }).join(',');
    if (!state.agenda) { state.pulseSig = sig; return; }
    if (sig !== state.pulseSig) {
      state.pulseSig = sig;
      renderTimeline();
    }
    announce();
  }

  var pulseTimer = null, inFlight = null;
  function pollPulse() {
    if (inFlight) return inFlight; // never run two polling loops
    clearTimeout(pulseTimer);
    var p = document.hidden ? Promise.resolve() : KP.fetchJSON('/pulse', { timeout: 4000 })
      .then(function (data) {
        if (!data || !Array.isArray(data.rooms)) throw new Error('bad payload');
        applyPulse(data);
      })
      .catch(function () {
        // Keep the last live values. With the sample agenda and no data yet, the sample pulse keeps the demo alive;
        // with a real agenda we show forecasts rather than invented live numbers.
        if (state.rooms || state.source !== 'mock') return;
        return KP.fetchJSON('/static/mock/pulse.json').then(applyPulse);
      })
      .catch(function () { /* forecasts stay on screen */ });
    inFlight = p.then(function () { inFlight = null; pulseTimer = setTimeout(pollPulse, PULSE_MS); });
    return inFlight;
  }

  confirmBtn.addEventListener('click', function () {
    if (!state.agenda) return;
    persist();
    KP.track('agenda_confirmed', {
      'kubepulse.talks.count': (state.agenda.talks || []).length,
      'kubepulse.swaps': state.swaps,
      'kubepulse.agenda.source': state.source
    });
    location.href = KP.withDemo('/live');
  });

  document.addEventListener('kp:lang', render);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.agenda) pollPulse(); });

  KP.ready().then(function () {
    render();
    return loadAgenda();
  }).then(function (res) {
    state.agenda = res.data;
    state.source = res.source;
    var stored = KP.getAgenda();
    state.swaps = (stored && stored.swaps) || 0;
    if (!(res.data.talks || []).length) state.notice = 'agenda.empty';
    else state.notice = res.source === 'mock' ? 'agenda.mock' : null;
    render();
  }).catch(function () {
    state.notice = 'agenda.empty';
    render();
  }).then(function () {
    main.setAttribute('aria-busy', 'false');
    return pollPulse();
  });
})();
