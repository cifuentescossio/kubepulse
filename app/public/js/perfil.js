/* /perfil · Paso 1 de 3. Profile lives only in localStorage `kubepulse.profile`. */
(function () {
  'use strict';
  var KP = window.KP;
  var MIN = 2, MAX = 5;

  var form = document.getElementById('profile-form');
  var F = form.elements;
  var status = document.getElementById('interests-status');
  var formStatus = document.getElementById('form-status');
  var chipsField = form.querySelector('.chips-field');
  var chips = Array.prototype.slice.call(form.querySelectorAll('input[name="interests"]'));
  var lastMessage = null; // { key } so we can re-translate on language change

  function selected() { return chips.filter(function (c) { return c.checked; }).map(function (c) { return c.value; }); }

  function renderStatus() {
    var n = selected().length;
    var text = KP.t('perfil.interests.count', { n: n });
    if (lastMessage) text += ' · ' + KP.t(lastMessage);
    status.textContent = text;
    status.classList.toggle('field-status--error', lastMessage === 'perfil.interests.min');
  }

  function fill(p) {
    F.name.value = p.name || '';
    if (p.role) F.role.value = p.role;
    F.level.value = p.level || 'any';
    F.lang.value = p.lang === 'en' ? 'en' : (p.lang === 'es' ? 'es' : KP.contentLang());
    var set = p.interests || [];
    chips.forEach(function (c) { c.checked = set.indexOf(c.value) !== -1; });
    var a = p.a11y || {};
    F.captions.checked = !!a.captions;
    F.wheelchair.checked = !!a.wheelchair;
    F.avoid_crowded.checked = !!a.avoid_crowded;
  }

  function read() {
    return {
      name: F.name.value.trim().slice(0, 60),
      role: F.role.value,
      interests: selected(),
      level: F.level.value,
      lang: F.lang.value,
      a11y: {
        captions: F.captions.checked,
        wheelchair: F.wheelchair.checked,
        avoid_crowded: F.avoid_crowded.checked
      }
    };
  }

  chips.forEach(function (c) {
    c.addEventListener('change', function () {
      var n = selected().length;
      if (c.checked && n > MAX) {
        c.checked = false;
        lastMessage = 'perfil.interests.max';
      } else {
        lastMessage = (lastMessage === 'perfil.interests.min' && n < MIN) ? lastMessage : null;
      }
      chipsField.removeAttribute('aria-invalid');
      renderStatus();
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var profile = read();
    if (profile.interests.length < MIN) {
      lastMessage = 'perfil.interests.min';
      chipsField.setAttribute('aria-invalid', 'true');
      renderStatus();
      chips[0].focus();
      return;
    }
    KP.saveProfile(profile);
    // The old agenda no longer matches the new interests.
    try { localStorage.removeItem(KP.KEYS.agenda); } catch (err) { /* ignore */ }
    // Privacy: RUM (Dash0) gets only a non-personal count. Never role, interests,
    // language or accessibility needs: the profile stays in localStorage.
    KP.track('profile_saved', {
      'kubepulse.interests.count': profile.interests.length
    });
    formStatus.textContent = KP.t('perfil.saved');
    location.href = KP.withDemo('/schedule');
  });

  document.addEventListener('kp:lang', renderStatus);

  fill(KP.getProfile() || KP.defaultProfile());
  KP.ready().then(renderStatus);
})();
