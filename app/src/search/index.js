// Owner: B · Datos. POST /recommend and GET /search (see docs/contracts.md).
const express = require('express');

const router = express.Router();

router.post('/recommend', (_req, res) => res.status(501).json({ error: 'not implemented' }));
router.get('/search', (_req, res) => res.status(501).json({ error: 'not implemented' }));

module.exports = router;
