// Owner: D · Frontend. Renders /perfil, /agenda, /pulso from app/views.
const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => res.redirect('/perfil'));

module.exports = router;
