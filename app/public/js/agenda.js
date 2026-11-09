/* /agenda · Paso 2 de 3. POST /recommend with the profile; falls back to /static/mock/agenda.json. */
(function () {
  'use strict';
  var KP = window.KP, el = KP.el, t = KP.t;

  var profile = KP.getProfile() || KP.defaultProfile();
  var state = { agenda: null, source: null, notice: 'agenda.loading', noticeVars: null, swaps: 0 };

  var main = document.getElementById('agenda-main');
  var titleEl = document.getElementById('agenda-title');
  var subtitleEl = document.getElementById('agenda-subtitle');
  var noticeEl = document.getElementById('agenda-notice');
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

  function talkRow(talk, index) {
    var meta = [];
    if (talk.speakers && talk.speakers.length) meta.push(talk.speakers.join(', '));
    if (talk.room && talk.room.name) meta.push(talk.room.name);

    var body = [
      el('h3', { className: 'talk__title', id: 'talk-' + index, tabindex: '-1', text: talk.title }),
      el('p', { className: 'talk__meta', text: meta.join(' · ') })
    ];
    if (talk.match_reason && talk.match_reason.length) {
      body.push(el('p', { className: 'talk__why', text: t('agenda.why', { tags: KP.joinTags(talk.match_reason, 'plus') }) }));
    }
    var alt = talk.parallel_alternative;
    if (alt) {
      body.push(el('p', { className: 'talk__parallel' }, [
        t('agenda.parallel') + ' ',
        el('button', {
          type: 'button', className: 'link-btn',
          'aria-label': t('agenda.swap', { title: alt.title, room: alt.room && alt.room.name }),
          onclick: function () { swap(index); }
        }, [alt.title + ' (' + KP.shortRoom(alt.room && alt.room.name) + ')'])
      ]));
    }

    return el('li', { className: 'slot' }, [
      el('article', { className: 'talk', 'aria-labelledby': 'talk-' + index }, [
        el('p', { className: 'talk__time' }, [el('time', { datetime: talk.start, text: KP.time(talk.start) })]),
        KP.topicIcon(talk.topics),
        el('div', { className: 'talk__body' }, body),
        el('div', { className: 'talk__status' }, [talk.forecast ? KP.forecastPill(talk.forecast) : null])
      ])
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

    timeline.textContent = '';
    sorted(agenda).forEach(function (row) {
      timeline.appendChild(row.kind === 'talk' ? talkRow(row.talk, row.index) : breakRow(row.brk));
    });

    var withAlt = talks.filter(function (x) { return x.parallel_alternative; }).length;
    countEl.textContent = t('agenda.summary.count', { n: talks.length }) +
      (withAlt ? ' ' + t('agenda.summary.parallel', { n: withAlt }) : '');

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

  function swap(index) {
    var before = state.agenda.talks[index];
    var after = KP.swapTalk(before);
    state.agenda.talks[index] = after;
    state.swaps += 1;
    persist();
    KP.track('recommendation_switched', {
      'kubepulse.from_talk': before.id, 'kubepulse.to_talk': after.id,
      'kubepulse.to_room': after.room && after.room.id, 'kubepulse.screen': 'agenda'
    });
    state.notice = 'agenda.swapped';
    state.noticeVars = { title: after.title, room: after.room && after.room.name };
    render();
    var heading = document.getElementById('talk-' + index);
    if (heading) heading.focus();
  }

  confirmBtn.addEventListener('click', function () {
    if (!state.agenda) return;
    persist();
    KP.track('agenda_confirmed', {
      'kubepulse.talks.count': (state.agenda.talks || []).length,
      'kubepulse.swaps': state.swaps,
      'kubepulse.agenda.source': state.source
    });
    location.href = KP.withDemo('/pulso');
  });

  document.addEventListener('kp:lang', render);

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
  });
})();
