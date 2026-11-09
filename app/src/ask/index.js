// Owner: E · Extras. POST /ask with swappable LLM provider (see docs/contracts.md).
const express = require('express');

const router = express.Router();

router.post('/ask', (_req, res) => res.status(501).json({ error: 'not implemented' }));

module.exports = router;
