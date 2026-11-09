// Owner: D · Frontend. Renders /perfil, /agenda, /pulso from app/views.
const express = require('express');

const router = express.Router();

// Cache-busting token for /static assets (served with maxAge 5m): changes on every deploy/restart.
const appVersion = process.env.APP_VERSION;
const assetVersion = encodeURIComponent(appVersion && appVersion !== 'dev' ? appVersion : Date.now().toString(36));

// Dash0 RUM settings come from the environment (Secret kubepulse-secrets), never from the repo.
// DASH0_RUM_TOKEN is a separate ingest-only token: it is public by design once it reaches the browser.
// When either value is empty the template doesn't load the SDK at all.
function rumConfig() {
  const token = (process.env.DASH0_RUM_TOKEN || '').trim();
  const endpoint = (process.env.DASH0_RUM_ENDPOINT || '').trim();
  if (!token || !endpoint) return null;
  return { token, endpoint, serviceName: 'kubepulse-web', version: appVersion || 'dev' };
}

function render(view, page, step) {
  return (req, res) => {
    res.render(view, {
      page,
      step,
      v: assetVersion,
      demo: req.query.demo === '1',
      rum: rumConfig(),
    });
  };
}

router.get('/', (req, res) => res.redirect(req.query.demo === '1' ? '/perfil?demo=1' : '/perfil'));
router.get('/perfil', render('perfil.html', 'perfil', 1));
router.get('/agenda', render('agenda.html', 'agenda', 2));
router.get('/pulso', render('pulso.html', 'pulso', 3));

module.exports = router;
