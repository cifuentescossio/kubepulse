// Owner: C · Pulso. GET /pulse, GET /pulse/history, POST /chaos (see docs/contracts.md).
const express = require('express');

const router = express.Router();

router.get('/pulse', (_req, res) => res.status(501).json({ error: 'not implemented' }));
router.get('/pulse/history', (_req, res) => res.status(501).json({ error: 'not implemented' }));

module.exports = router;
