// Owner: D · Frontend. Renders /perfil, /agenda, /pulso from app/views.
const express = require('express');

const router = express.Router();

function render(view, page, step) {
  return (req, res) => {
    res.render(view, {
      page,
      step,
      demo: req.query.demo === '1',
    });
  };
}

router.get('/', (req, res) => res.redirect(req.query.demo === '1' ? '/perfil?demo=1' : '/perfil'));
router.get('/perfil', render('perfil.html', 'perfil', 1));
router.get('/agenda', render('agenda.html', 'agenda', 2));
router.get('/pulso', render('pulso.html', 'pulso', 3));

module.exports = router;
