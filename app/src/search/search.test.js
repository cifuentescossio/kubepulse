// Run from app/: node --test src/search/
const test = require('node:test');
const assert = require('node:assert/strict');

// Force the local fallback: these tests never talk to Elasticsearch.
delete process.env.ELASTIC_ENDPOINT;
delete process.env.ELASTIC_API_KEY;

const express = require('express');
const rank = require('./rank');
const router = require('./index');

const PROFILE = {
  name: 'Daniel',
  role: 'Platform Engineer',
  interests: ['Agentes', 'Platform Engineering', 'MCP'],
  level: 'any',
  lang: 'es',
  a11y: { captions: true, wheelchair: false, avoid_crowded: false },
};

const localRecommend = (body) => {
  const { profile } = rank.validateProfile(body);
  const topics = rank.wantedTopics(profile.interests);
  return rank.recommend(profile, rank.localRank(rank.expandInterests(profile.interests), rank.defaultCatalog, topics));
};

test('validateProfile rejects bad bodies with a clear message', () => {
  assert.match(rank.validateProfile(null).error, /JSON object/);
  assert.match(rank.validateProfile([]).error, /JSON object/);
  assert.match(rank.validateProfile({}).error, /interests/);
  assert.match(rank.validateProfile({ interests: [] }).error, /1 to 10/);
  assert.match(rank.validateProfile({ interests: [''] }).error, /non-empty/);
  assert.match(rank.validateProfile({ interests: ['MCP'], level: 'expert' }).error, /level/);
  assert.match(rank.validateProfile({ interests: ['MCP'], lang: 'fr' }).error, /lang/);
  assert.match(rank.validateProfile({ interests: ['MCP'], a11y: { captions: 'yes' } }).error, /a11y.captions/);
});

test('validateProfile fills defaults', () => {
  const { profile } = rank.validateProfile({ interests: ['MCP', 'MCP '] });
  assert.deepEqual(profile.interests, ['MCP']);
  assert.equal(profile.level, 'any');
  assert.equal(profile.lang, 'es');
  assert.deepEqual(profile.a11y, { captions: false, wheelchair: false, avoid_crowded: false });
});

test('validateQuery requires a short non-empty q', () => {
  assert.ok(rank.validateQuery(undefined).error);
  assert.ok(rank.validateQuery('   ').error);
  assert.ok(rank.validateQuery('x'.repeat(201)).error);
  assert.equal(rank.validateQuery(' mcp ').q, 'mcp');
});

test('local recommend: one talk per slot, sorted, with contract fields', () => {
  const { talks, breaks } = localRecommend(PROFILE);
  assert.ok(talks.length >= 6);
  const starts = talks.map((t) => t.start);
  assert.equal(new Set(starts).size, starts.length, 'one talk per slot');
  assert.deepEqual([...starts].sort((a, b) => Date.parse(a) - Date.parse(b)), starts);
  for (const t of talks) {
    assert.deepEqual(Object.keys(t), [
      'id', 'title', 'speakers', 'start', 'end', 'room', 'topics', 'match_reason', 'parallel_alternative', 'forecast',
    ]);
    assert.match(t.start, /-07:00$/);
    assert.ok(t.match_reason.length > 0);
    assert.ok(['low', 'mid', 'high'].includes(t.forecast));
    assert.ok(t.room.id && t.room.name);
  }
  assert.ok(talks.filter((t) => t.parallel_alternative).length >= 3, 'several slots have an alternative');
  assert.deepEqual(breaks.map((b) => b.label), ['coffee', 'lunch']);
});

test('local recommend respects captions, wheelchair and level filters', () => {
  const byId = rank.defaultCatalog.talksById;
  const rooms = rank.defaultCatalog.roomsById;
  const { talks } = localRecommend({
    interests: ['eBPF', 'Seguridad', 'Observabilidad'],
    level: 'beginner',
    a11y: { captions: true, wheelchair: true },
  });
  for (const t of talks) {
    const talk = byId.get(t.id);
    assert.equal(talk.captions, true);
    assert.notEqual(talk.level, 'advanced');
    assert.equal(rooms.get(talk.room_id).wheelchair_accessible, true);
  }
});

test('avoid_crowded prefers a less crowded talk when both match', () => {
  const base = { interests: ['Agentes'], a11y: { avoid_crowded: false } };
  const slot = (r) => r.talks.find((t) => t.start === '2026-11-09T15:55:00-07:00');
  assert.equal(slot(localRecommend(base)).forecast, 'high');
  assert.notEqual(slot(localRecommend({ ...base, a11y: { avoid_crowded: true } })).forecast, 'high');
});

test('forecast follows the occupancy thresholds of the contract', () => {
  const talk = (n) => ({ room_id: 'ace', expected_attendance: n }); // capacity 1200
  assert.equal(rank.forecast(talk(500)), 'low');
  assert.equal(rank.forecast(talk(600)), 'mid');
  assert.equal(rank.forecast(talk(1080)), 'high');
});

test('topicsIn maps Spanish and English words to topics', () => {
  assert.deepEqual(rank.topicsIn('seguridad de agentes').sort(), ['Agentes', 'Seguridad']);
  assert.deepEqual(rank.topicsIn('observability'), ['Observabilidad']);
  assert.deepEqual(rank.topicsIn('gpus'), ['Inferencia / GPUs']);
});

test('HTTP: /recommend and /search answer from the local fallback without credentials', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const rec = await fetch(`${base}/recommend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(PROFILE),
  });
  assert.equal(rec.status, 200);
  assert.equal(rec.headers.get('x-kubepulse-source'), 'local');
  assert.equal(rec.headers.get('x-kubepulse-degraded'), 'true');
  assert.ok((await rec.json()).talks.length > 0);

  const bad = await fetch(`${base}/recommend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interests: 'MCP' }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /interests/);

  const search = await fetch(`${base}/search?q=${encodeURIComponent('MCP gateway')}`);
  assert.equal(search.status, 200);
  const { talks } = await search.json();
  assert.equal(talks[0].id, 't-1440-ace');

  assert.equal((await fetch(`${base}/search`)).status, 400);
});
