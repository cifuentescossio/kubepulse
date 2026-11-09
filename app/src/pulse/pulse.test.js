// Owner: C · Pulso. Run from app/: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const pulse = require('./index');
const { createSimulator, toSlcIso } = require('./simulator');
const { createPeerBroadcaster } = require('./peers');
const { FALLBACK_ROOMS, FALLBACK_SLOTS } = require('./rooms');

const ISO_SLC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-07:00$/;
const SLOT_MINUTES = FALLBACK_SLOTS.map((s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)));
const T0 = Date.parse('2026-11-09T22:00:00Z'); // 15:00 in Salt Lake City

function makeApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).type('text/plain').send('not found\n'));
  return app;
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const quietLog = () => {};

let main; // the module's own router, as server.js mounts it

test.before(async () => {
  main = await listen(makeApp(pulse));
});

test.after(() => {
  main.server.close();
});

test.beforeEach(() => {
  pulse.simulator.clearChaos();
  delete process.env.DEMO_MODE;
});

test('GET /pulse matches the contract', async () => {
  const res = await fetch(`${main.base}/pulse`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['rooms', 'updated_at']);
  assert.match(body.updated_at, ISO_SLC);
  assert.ok(body.rooms.length >= 1);
  for (const r of body.rooms) {
    assert.deepEqual(Object.keys(r).sort(), ['capacity', 'id', 'name', 'occupancy', 'trend']);
    assert.equal(typeof r.id, 'string');
    assert.equal(typeof r.name, 'string');
    assert.ok(Number.isInteger(r.capacity) && r.capacity > 0);
    assert.ok(r.occupancy >= 0 && r.occupancy <= 1, `occupancy ${r.occupancy}`);
    assert.ok(['up', 'down', 'flat'].includes(r.trend));
  }
});

test('GET /pulse/history returns 360 points over the last 30 min, oldest first', async () => {
  const room = pulse.simulator.rooms()[0].id;
  const res = await fetch(`${main.base}/pulse/history?room=${room}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.room, room);
  assert.equal(body.points.length, 360);
  for (const p of body.points) {
    assert.deepEqual(Object.keys(p).sort(), ['occupancy', 't']);
    assert.match(p.t, ISO_SLC);
    assert.ok(p.occupancy >= 0 && p.occupancy <= 1);
  }
  const ts = body.points.map((p) => Date.parse(p.t));
  for (let i = 1; i < ts.length; i++) assert.equal(ts[i] - ts[i - 1], 5000);
});

test('GET /pulse/history validates room', async () => {
  for (const qs of ['', '?room=', '?room=nope', '?room[]=ace']) {
    const res = await fetch(`${main.base}/pulse/history${qs}`);
    assert.equal(res.status, 400, `query "${qs}"`);
    assert.ok((await res.json()).error);
  }
});

test('POST /chaos is 404 without DEMO_MODE=true, forwarded or not', async () => {
  let res = await post(main.base, { room: 'ace' });
  assert.equal(res.status, 404);
  process.env.DEMO_MODE = 'false';
  res = await post(main.base);
  assert.equal(res.status, 404);
  res = await post(main.base, { room: 'ace', start: toSlcIso(Date.now()), until: toSlcIso(Date.now() + 60_000) }, {
    'X-KubePulse-Forwarded': '1',
  });
  assert.equal(res.status, 404);
  assert.equal(pulse.isChaosActive(), false);
});

test('two simulators with the same clock give exactly the same output', () => {
  let clock = T0;
  const now = () => clock;
  const a = createSimulator({ rooms: FALLBACK_ROOMS, slotMinutes: SLOT_MINUTES, now });
  const b = createSimulator({ rooms: FALLBACK_ROOMS, slotMinutes: SLOT_MINUTES, now });
  const seen = new Set();
  // Walk a whole conference day, one sample every 7 min.
  for (let i = 0; i < 24 * 60; i += 7) {
    clock = T0 - 15 * 3600_000 + i * 60_000;
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(a.current(), b.current());
    for (const r of FALLBACK_ROOMS) {
      const v = a.occupancy(r.id, clock);
      assert.ok(v >= 0 && v < 0.96, `${r.id} ${v}`);
      seen.add(v);
    }
  }
  assert.deepEqual(a.history('r254'), b.history('r254'));
  assert.ok(seen.size > 50, 'values vary over the day');

  // Any instant inside the same 5 s tick gives the same value.
  const tickStart = Math.floor(T0 / 5000) * 5000;
  assert.equal(a.occupancy('ace', tickStart), b.occupancy('ace', tickStart + 4999));
  // History is the same function: its last point is /pulse's value.
  clock = T0;
  const last = a.history('ace').points.at(-1);
  assert.equal(last.t, a.snapshot().updated_at);
  assert.equal(last.occupancy, a.snapshot().rooms.find((r) => r.id === 'ace').occupancy);
});

test('chaos on one pod is forwarded to its peers and both answer the same', async () => {
  process.env.DEMO_MODE = 'true';
  let clock = T0 + 1234;
  const now = () => clock;
  const simA = createSimulator({ rooms: FALLBACK_ROOMS, now });
  const simB = createSimulator({ rooms: FALLBACK_ROOMS, now });
  const podB = await listen(
    makeApp(pulse.createPulseRouter({ simulator: simB, broadcaster: { broadcast: async () => [] }, log: quietLog })),
  );
  let forwarded;
  const real = createPeerBroadcaster({
    resolve: async () => ['127.0.0.1', '10.0.0.9'],
    selfAddresses: () => new Set(['10.0.0.9']), // pod A's own IP is skipped
    port: podB.port,
    log: quietLog,
  });
  const broadcaster = { broadcast: (c) => (forwarded = real.broadcast(c)) };
  const podA = await listen(makeApp(pulse.createPulseRouter({ simulator: simA, broadcaster, log: quietLog })));
  try {
    const res = await post(podA.base, { room: 'r254' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.room, 'r254');
    assert.match(body.until, ISO_SLC);

    const results = await forwarded;
    assert.deepEqual(results, [{ ip: '127.0.0.1', status: 200 }]);
    assert.deepEqual(simB.getChaosState(), simA.getChaosState());
    assert.equal(simB.getChaosState().until, body.until);

    // Alternating between pods now reads the same numbers (the bug was 0.60 / 0.96 / 0.59 / 0.96).
    for (let i = 0; i < 10; i++) {
      clock += 5000;
      const sa = await (await fetch(`${podA.base}/pulse`)).json();
      const sb = await (await fetch(`${podB.base}/pulse`)).json();
      assert.deepEqual(sa, sb);
      assert.ok(sa.rooms.find((r) => r.id === 'r254').occupancy >= 0.96);
    }
    const ha = await (await fetch(`${podA.base}/pulse/history?room=r254`)).json();
    const hb = await (await fetch(`${podB.base}/pulse/history?room=r254`)).json();
    assert.deepEqual(ha, hb);

    // Same window forwarded twice is idempotent.
    const again = await post(podB.base, { room: 'r254', start: toSlcIso(T0 + 1000), until: body.until }, {
      'X-KubePulse-Forwarded': '1',
    });
    assert.equal(again.status, 200);

    // Both pods keep the 409 while it lasts.
    for (const base of [podA.base, podB.base]) {
      const busy = await post(base, { room: 'ace' });
      assert.equal(busy.status, 409);
      assert.deepEqual(await busy.json(), { error: 'chaos already active', room: 'r254', until: body.until });
    }
  } finally {
    podA.server.close();
    podB.server.close();
  }
});

test('forwarded chaos is validated and taken as is', async () => {
  process.env.DEMO_MODE = 'true';
  const clock = T0;
  const sim = createSimulator({ rooms: FALLBACK_ROOMS, now: () => clock });
  let broadcasts = 0;
  const pod = await listen(
    makeApp(
      pulse.createPulseRouter({ simulator: sim, broadcaster: { broadcast: async () => broadcasts++ }, log: quietLog }),
    ),
  );
  const fwd = { 'X-KubePulse-Forwarded': '1' };
  try {
    const bad = [
      {},
      { room: 'ace' },
      { room: 'ace', start: 'yesterday', until: toSlcIso(T0 + 60_000) },
      { room: 'ace', start: toSlcIso(T0), until: toSlcIso(T0 - 1000) },
      { room: 'ace', start: toSlcIso(T0), until: toSlcIso(T0 + 10 * 60_000) }, // longer than 3 min
      { room: 42, start: toSlcIso(T0), until: toSlcIso(T0 + 60_000) },
      { room: 'nope', start: toSlcIso(T0), until: toSlcIso(T0 + 60_000) },
    ];
    for (const body of bad) {
      const res = await post(pod.base, body, fwd);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    // Started 40 s ago on the other pod: kept with its own start/until, not restarted here.
    const start = toSlcIso(T0 - 40_000);
    const until = toSlcIso(T0 - 40_000 + 180_000);
    const res = await post(pod.base, { room: 'gi', start, until }, fwd);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { room: 'gi', until });
    assert.equal(sim.getChaosState().remaining_ms, 140_000);
    assert.equal(broadcasts, 0, 'a forwarded chaos is not forwarded again');
  } finally {
    pod.server.close();
  }
});

test('two pods that start chaos at once converge on the same one', () => {
  const clock = T0;
  const a = createSimulator({ rooms: FALLBACK_ROOMS, now: () => clock });
  const b = createSimulator({ rooms: FALLBACK_ROOMS, now: () => clock - 2000 }); // B's request came 2 s earlier
  const ca = a.triggerChaos('ace');
  const cb = b.triggerChaos('gi');
  // Each forwards to the other.
  const atA = a.applyChaos({ room: cb.room, start: cb.start, until: cb.until });
  const atB = b.applyChaos({ room: ca.room, start: ca.start, until: ca.until });
  assert.equal(atA.ok, true); // B's earlier chaos replaces A's
  assert.equal(atB.ok, false);
  assert.equal(atB.reason, 'busy');
  assert.equal(a.getChaosState().room, 'gi');
  assert.equal(b.getChaosState().room, 'gi');
  assert.equal(a.getChaosState().until, b.getChaosState().until);
});

test('POST /chaos responds without waiting for peers, and alone when DNS does not resolve', async () => {
  process.env.DEMO_MODE = 'true';
  const sim = createSimulator({ rooms: FALLBACK_ROOMS });
  const hang = { broadcast: () => new Promise(() => {}) };
  const pod = await listen(makeApp(pulse.createPulseRouter({ simulator: sim, broadcaster: hang, log: quietLog })));
  try {
    const t0 = Date.now();
    const res = await post(pod.base, { room: 'ace' });
    assert.equal(res.status, 200);
    assert.ok(Date.now() - t0 < 500);
  } finally {
    pod.server.close();
  }

  const logs = [];
  const noDns = createPeerBroadcaster({
    resolve: async () => {
      throw Object.assign(new Error('queryA ENOTFOUND app-peers'), { code: 'ENOTFOUND' });
    },
    log: (m) => logs.push(m),
  });
  assert.deepEqual(await noDns.broadcast({ room: 'ace', start: 'x', until: 'y' }), []);
  assert.deepEqual(await noDns.broadcast({ room: 'ace', start: 'x', until: 'y' }), []);
  assert.equal(logs.length, 1, 'missing DNS is logged once');
});

test('a slow peer times out after the per-peer limit and only logs', async () => {
  const silent = http.createServer(() => {}); // accepts, never answers
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const logs = [];
  try {
    const b = createPeerBroadcaster({
      resolve: async () => ['127.0.0.1'],
      selfAddresses: () => new Set(),
      port: silent.address().port,
      timeoutMs: 150,
      log: (m) => logs.push(m),
    });
    const t0 = Date.now();
    const [r] = await b.broadcast({ room: 'ace', start: 'x', until: 'y' });
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(r.ip, '127.0.0.1');
    assert.ok(r.error);
    assert.equal(logs.length, 1);
  } finally {
    silent.closeAllConnections();
    silent.close();
  }
});

test('POST /chaos with DEMO_MODE=true on the module router pins the room and allows one at a time', async () => {
  process.env.DEMO_MODE = 'true';
  const room = pulse.simulator.rooms().at(-1).id;
  let res = await post(main.base, { room });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.room, room);
  assert.match(body.until, ISO_SLC);

  assert.equal(pulse.isChaosActive(), true);
  const st = pulse.getChaosState();
  assert.equal(st.room, room);
  assert.ok(st.remaining_ms > 170_000 && st.remaining_ms <= 180_000);

  const snap = await (await fetch(`${main.base}/pulse`)).json();
  assert.ok(snap.rooms.find((r) => r.id === room).occupancy >= 0.96);

  res = await post(main.base, { room: pulse.simulator.rooms()[0].id });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).room, room);
});

test('POST /chaos defaults to ace and rejects unknown rooms', async () => {
  process.env.DEMO_MODE = 'true';
  let res = await post(main.base, { room: 'nope' });
  assert.equal(res.status, 400);
  res = await post(main.base, { room: 42 });
  assert.equal(res.status, 400);
  res = await post(main.base);
  assert.equal(res.status, 200);
  const expected = pulse.simulator.hasRoom('ace') ? 'ace' : pulse.simulator.rooms()[0].id;
  assert.equal((await res.json()).room, expected);
});

test('chaos ends by itself after 3 minutes and stays visible in the history', () => {
  let clock = T0;
  const sim = createSimulator({ rooms: FALLBACK_ROOMS, now: () => clock });
  assert.equal(sim.triggerChaos('gi').ok, true);
  for (let i = 0; i < 35; i++) {
    clock += 5000;
    assert.ok(sim.occupancy('gi') >= 0.96);
  }
  clock = T0 + 5 * 60 * 1000;
  assert.equal(sim.isChaosActive(), false);
  assert.deepEqual(sim.getChaosState(), { active: false, room: null, until: null, remaining_ms: 0 });
  assert.ok(sim.occupancy('gi') < 0.96);
  const high = sim.history('gi').points.filter((p) => p.occupancy >= 0.96);
  assert.ok(high.length >= 36 && high.length <= 38, `got ${high.length} chaos points`);
  // Past the 30-minute window the spike is gone and the window is dropped.
  clock = T0 + 40 * 60 * 1000;
  assert.equal(sim.history('gi').points.filter((p) => p.occupancy >= 0.96).length, 0);
  assert.equal(sim.triggerChaos('ace').ok, true);
});

test('chaosLatency delays only while chaos is active, and is capped', async () => {
  const mw = pulse.chaosLatency({ minMs: 50, maxMs: 60_000 });
  const run = () =>
    new Promise((resolve) => {
      const t0 = Date.now();
      mw({}, {}, () => resolve(Date.now() - t0));
    });
  assert.ok((await run()) < 20);
  pulse.simulator.triggerChaos(pulse.simulator.rooms()[0].id);
  const waited = await run();
  assert.ok(waited >= 45 && waited <= 3100, `waited ${waited} ms`);
});
