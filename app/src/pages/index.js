// Owner: D · Frontend. Renders /perfil, /agenda, /pulso from app/views.
const express = require('express');

const router = express.Router();

// Cache-busting token for /static assets (served with maxAge 5m): changes on every deploy/restart.
const appVersion = process.env.APP_VERSION;
const assetVersion = encodeURIComponent(appVersion && appVersion !== 'dev' ? appVersion : Date.now().toString(36));

function render(view, page, step) {
  return (req, res) => {
    res.render(view, {
      page,
      step,
      v: assetVersion,
      demo: req.query.demo === '1',
    });
  };
}

router.get('/', (req, res) => res.redirect(req.query.demo === '1' ? '/perfil?demo=1' : '/perfil'));
router.get('/perfil', render('perfil.html', 'perfil', 1));
router.get('/agenda', render('agenda.html', 'agenda', 2));
router.get('/pulso', render('pulso.html', 'pulso', 3));

module.exports = router;
