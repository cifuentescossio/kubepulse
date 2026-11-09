// Owner: C · Pulso. Run from app/: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pulse = require('./index');
const { createSimulator, toSlcIso } = require('./simulator');
const { FALLBACK_ROOMS } = require('./rooms');

const ISO_SLC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-07:00$/;

let server;
let base;

test.before(async () => {
  pulse.simulator.stop(); // tests drive the module's simulator without the interval
  const app = express();
  app.use(express.json());
  app.use(pulse);
  app.use((_req, res) => res.status(404).type('text/plain').send('not found\n'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  pulse.simulator.stop();
});

test.beforeEach(() => {
  pulse.simulator.clearChaos();
  delete process.env.DEMO_MODE;
});

const postChaos = (body) =>
  fetch(`${base}/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('GET /pulse matches the contract', async () => {
  const res = await fetch(`${base}/pulse`);
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

test('GET /pulse/history returns ~30 min of points for a valid room', async () => {
  const room = pulse.simulator.rooms()[0].id;
  const res = await fetch(`${base}/pulse/history?room=${room}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.room, room);
  assert.ok(body.points.length > 300 && body.points.length <= 361, `got ${body.points.length} points`);
  for (const p of body.points) {
    assert.deepEqual(Object.keys(p).sort(), ['occupancy', 't']);
    assert.match(p.t, ISO_SLC);
    assert.ok(p.occupancy >= 0 && p.occupancy <= 1);
  }
  assert.ok(body.points[0].t <= body.points.at(-1).t, 'points are oldest first');
});

test('GET /pulse/history validates room', async () => {
  for (const qs of ['', '?room=', '?room=nope', '?room[]=ace']) {
    const res = await fetch(`${base}/pulse/history${qs}`);
    assert.equal(res.status, 400, `query "${qs}"`);
    assert.ok((await res.json()).error);
  }
});

test('POST /chaos is 404 without DEMO_MODE=true', async () => {
  let res = await postChaos({ room: 'ace' });
  assert.equal(res.status, 404);
  process.env.DEMO_MODE = 'false';
  res = await postChaos();
  assert.equal(res.status, 404);
  assert.equal(pulse.isChaosActive(), false);
});

test('POST /chaos with DEMO_MODE=true pins the room at >= 96% and allows one at a time', async () => {
  process.env.DEMO_MODE = 'true';
  const room = pulse.simulator.rooms().at(-1).id;
  let res = await postChaos({ room });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.room, room);
  assert.match(body.until, ISO_SLC);

  assert.equal(pulse.isChaosActive(), true);
  const st = pulse.getChaosState();
  assert.equal(st.active, true);
  assert.equal(st.room, room);
  assert.ok(st.remaining_ms > 170_000 && st.remaining_ms <= 180_000);

  const snap = await (await fetch(`${base}/pulse`)).json();
  assert.ok(snap.rooms.find((r) => r.id === room).occupancy >= 0.96);

  res = await postChaos({ room: pulse.simulator.rooms()[0].id });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).room, room);
});

test('POST /chaos defaults to ace and rejects unknown rooms', async () => {
  process.env.DEMO_MODE = 'true';
  let res = await postChaos({ room: 'nope' });
  assert.equal(res.status, 400);
  res = await postChaos({ room: 42 });
  assert.equal(res.status, 400);
  res = await postChaos();
  assert.equal(res.status, 200);
  const expected = pulse.simulator.hasRoom('ace') ? 'ace' : pulse.simulator.rooms()[0].id;
  assert.equal((await res.json()).room, expected);
});

test('chaos ends by itself after 3 minutes and the room comes back down', () => {
  let clock = Date.parse('2026-11-09T22:00:00Z'); // 15:00 in Salt Lake City
  const sim = createSimulator({ rooms: FALLBACK_ROOMS, now: () => clock });
  sim.start();
  sim.stop();
  assert.equal(sim.triggerChaos('gi').ok, true);
  for (let i = 0; i < 35; i++) {
    clock += 5000;
    sim.tick();
    assert.ok(sim.current().find((c) => c.room.id === 'gi').occupancy >= 0.96);
  }
  clock += 5 * 60 * 1000;
  for (let i = 0; i < 60; i++) {
    clock += 5000;
    sim.tick();
  }
  assert.equal(sim.isChaosActive(), false);
  assert.deepEqual(sim.getChaosState(), { active: false, room: null, until: null, remaining_ms: 0 });
  assert.ok(sim.current().find((c) => c.room.id === 'gi').occupancy < 0.96);
});

test('history ring buffer stays bounded at 30 minutes', () => {
  let clock = Date.parse('2026-11-09T16:00:00Z');
  const sim = createSimulator({ rooms: FALLBACK_ROOMS, now: () => clock });
  for (let i = 0; i < 2000; i++) {
    clock += 5000;
    sim.tick();
  }
  const { points } = sim.history('ace');
  assert.equal(points.length, 361);
  assert.equal(points.at(-1).t, toSlcIso(clock));
  assert.equal(points[0].t, toSlcIso(clock - 30 * 60 * 1000));
});

test('chaosLatency delays only while chaos is active, and is capped', async () => {
  const mw = pulse.chaosLatency({ minMs: 50, maxMs: 60_000 });
  const run = () =>
    new Promise((resolve) => {
      const t0 = Date.now();
      mw({}, {}, () => resolve(Date.now() - t0));
    });
  assert.ok((await run()) < 20);
  process.env.DEMO_MODE = 'true';
  pulse.simulator.triggerChaos(pulse.simulator.rooms()[0].id);
  const waited = await run();
  assert.ok(waited >= 45 && waited <= 3100, `waited ${waited} ms`);
});
