// Owner: C · Pulso. GET /pulse, GET /pulse/history, POST /chaos (see docs/contracts.md).
//
// Occupancy is deterministic (simulator.js), so every replica answers the same. A chaos started on
// one pod is forwarded to the others (peers.js) with X-KubePulse-Forwarded: 1.
//
// Other modules can read the chaos state without touching this folder's internals:
//   const pulse = require('../pulse');
//   pulse.isChaosActive()            // boolean
//   pulse.getChaosState()            // { active, room, until, remaining_ms }
//   router.post('/recommend', pulse.chaosLatency(), handler)  // bounded delay during chaos
const express = require('express');
const { createSimulator } = require('./simulator');
const { loadRooms, loadSlotMinutes } = require('./rooms');
const { registerOccupancyGauge } = require('./otel');
const { createPeerBroadcaster, FORWARDED_HEADER } = require('./peers');

const DEFAULT_CHAOS_ROOM = 'ace'; // the contract's example room

const demoMode = () => process.env.DEMO_MODE === 'true';

function createPulseRouter({ simulator, broadcaster, log = (msg) => console.warn(msg) }) {
  const router = express.Router();

  router.get('/pulse', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(simulator.snapshot());
  });

  router.get('/pulse/history', (req, res) => {
    const room = typeof req.query.room === 'string' ? req.query.room : '';
    if (!room) return res.status(400).json({ error: 'missing query parameter: room' });
    const body = simulator.history(room);
    if (!body) return res.status(400).json({ error: `unknown room: ${room}` });
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.post('/chaos', async (req, res, next) => {
    if (!demoMode()) return next(); // falls through to the app's 404
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requested = body.room;
    if (requested !== undefined && typeof requested !== 'string') {
      return res.status(400).json({ error: 'room must be a string' });
    }

    // The public URL reaches this router too, so the header only counts from a pod behind app-peers.
    // From anyone else it is ignored and the request is handled as a normal POST /chaos.
    let fromPeer = false;
    if (req.get(FORWARDED_HEADER) === '1') {
      try {
        fromPeer = await broadcaster.isPeer(req.socket.remoteAddress);
      } catch {
        fromPeer = false;
      }
    }

    if (fromPeer) {
      // From a peer: take its window as is and don't forward again.
      const result = simulator.applyChaos({ room: requested, start: body.start, until: body.until });
      if (result.ok) return res.json({ room: result.room, until: result.until });
      if (result.reason === 'busy') {
        return res.status(409).json({ error: 'chaos already active', room: result.room, until: result.until });
      }
      if (result.reason === 'unknown_room') return res.status(400).json({ error: `unknown room: ${requested}` });
      return res.status(400).json({ error: 'forwarded chaos needs room, start and until (ISO 8601)' });
    }

    const fallback = simulator.hasRoom(DEFAULT_CHAOS_ROOM) ? DEFAULT_CHAOS_ROOM : simulator.rooms()[0].id;
    const result = simulator.triggerChaos(requested || fallback);
    if (result.ok) {
      // Fire and forget: the response never waits for the peers.
      Promise.resolve()
        .then(() => broadcaster.broadcast({ room: result.room, start: result.start, until: result.until }))
        .catch((err) => log(`pulse: chaos broadcast failed: ${err.message}`));
      return res.json({ room: result.room, until: result.until });
    }
    if (result.reason === 'unknown_room') return res.status(400).json({ error: `unknown room: ${requested}` });
    // One chaos at a time.
    return res.status(409).json({ error: 'chaos already active', room: result.room, until: result.until });
  });

  return router;
}

const simulator = createSimulator({ rooms: loadRooms(), slotMinutes: loadSlotMinutes() });
registerOccupancyGauge(simulator);
const router = createPulseRouter({ simulator, broadcaster: createPeerBroadcaster() });

// Express middleware: during chaos, wait a random delay in [minMs, maxMs] before continuing.
// Uses a timer only (no CPU), capped at 3 s whatever the caller passes.
function chaosLatency({ minMs = 400, maxMs = 1500 } = {}) {
  const lo = Math.max(0, Math.min(minMs, 3000));
  const hi = Math.max(lo, Math.min(maxMs, 3000));
  return (_req, _res, next) => {
    if (!simulator.isChaosActive()) return next();
    setTimeout(next, lo + Math.random() * (hi - lo));
  };
}

module.exports = router;
Object.assign(module.exports, {
  isChaosActive: () => simulator.isChaosActive(),
  getChaosState: () => simulator.getChaosState(),
  chaosLatency,
  createPulseRouter,
  simulator, // tests: simulator.clearChaos()
});
