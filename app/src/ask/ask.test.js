// Owner: E · Extras. Run from app/: node --test
// Every provider call goes to a fake fetch: these tests never touch the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAskRouter } = require('./index');
const { keywordRank } = require('./context');

const CATALOG = {
  rooms: [
    { id: 'ace', name: 'Grand Ballroom ACE', capacity: 1200, wheelchair_accessible: true },
    { id: 'gi', name: 'Grand Ballroom GI', capacity: 900, wheelchair_accessible: true },
  ],
  talks: [
    {
      id: 't-0920-ace',
      title: 'MCP Without Polling: Building Reactive Agents',
      abstract: 'Continuous queries push updates to MCP agents.',
      speakers: ['Aman Singh'],
      room_id: 'ace',
      start: '2026-11-09T09:20:00-07:00',
      end: '2026-11-09T09:45:00-07:00',
      topics: ['MCP', 'Agentes'],
      level: 'intermediate',
      language: 'en',
      captions: true,
    },
    {
      id: 't-1000-gi',
      title: 'GitOps at Scale with Argo CD',
      abstract: 'Running Argo CD for hundreds of clusters.',
      speakers: ['Ana Ruiz'],
      room_id: 'gi',
      start: '2026-11-09T10:00:00-07:00',
      end: '2026-11-09T10:25:00-07:00',
      topics: ['GitOps'],
      level: 'advanced',
      language: 'es',
      captions: false,
    },
  ],
};

const SECRET = 'placeholder-test-value';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function startApp(options) {
  const app = express();
  app.use(express.json());
  app.use(createAskRouter({ catalog: CATALOG, timeoutMs: 100, ...options }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // The real fetch talks to our local test server; the router gets the fake one.
  const ask = (body) =>
    fetch(`${base}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ask, close: () => server.close() };
}

// Captures console.warn so tests can check nothing sensitive is logged.
function captureWarnings(t) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  t.after(() => {
    console.warn = original;
  });
  return lines;
}

test('validation: question is required and at most 500 characters', async (t) => {
  const app = await startApp({ env: { LLM_PROVIDER: 'none' } });
  t.after(app.close);
  for (const body of [{}, { question: '' }, { question: '   ' }, { question: 42 }, { question: 'x'.repeat(501) }]) {
    const res = await app.ask(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(typeof (await res.json()).error, 'string');
  }
  assert.equal((await app.ask({ question: 'x'.repeat(500) })).status, 200);
  assert.equal((await app.ask({ question: 'mcp', lang: 'fr' })).status, 400);
  assert.equal((await app.ask({ question: 'mcp', profile: 'nope' })).status, 400);
});

test('LLM_PROVIDER=none answers locally with the contract shape and degraded headers', async (t) => {
  let calls = 0;
  const app = await startApp({ env: { LLM_PROVIDER: 'none' }, fetch: async () => (calls++, json(200, {})) });
  t.after(app.close);
  const res = await app.ask({ question: '¿Qué charlas hay de MCP?', lang: 'es' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-kubepulse-source'), 'local');
  assert.equal(res.headers.get('x-kubepulse-degraded'), 'true');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'citations', 'degraded', 'provider']);
  assert.equal(body.provider, 'none');
  assert.equal(body.degraded, true);
  assert.deepEqual(body.citations, ['t-0920-ace']);
  assert.match(body.answer, /MCP Without Polling/);
  assert.match(body.answer, /2026-11-09T09:20:00-07:00/);
  assert.equal(calls, 0);
});

test('local answer without matches has no citations and follows lang', async (t) => {
  const app = await startApp({ env: {} });
  t.after(app.close);
  const body = await (await app.ask({ question: 'zzz qqq', lang: 'en' })).json();
  assert.deepEqual(body.citations, []);
  assert.match(body.answer, /could not find/);
});

test('openai: sends talks as context and returns cited ids', async (t) => {
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return json(200, { choices: [{ message: { content: 'Ve a [t-0920-ace] a las 2026-11-09T09:20:00-07:00.' } }] });
  };
  const app = await startApp({ env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: SECRET }, fetch: fakeFetch });
  t.after(app.close);
  const res = await app.ask({ question: 'Quiero ver algo de MCP', profile: { interests: ['Agentes'] } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-kubepulse-source'), 'openai');
  assert.equal(res.headers.get('x-kubepulse-degraded'), 'false');
  const body = await res.json();
  assert.deepEqual(body, {
    answer: 'Ve a [t-0920-ace] a las 2026-11-09T09:20:00-07:00.',
    citations: ['t-0920-ace'],
    provider: 'openai',
    degraded: false,
  });
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.init.headers.authorization, `Bearer ${SECRET}`);
  const userMsg = request.body.messages.find((m) => m.role === 'user').content;
  assert.match(userMsg, /\[t-0920-ace\]/);
  assert.match(userMsg, /Question: Quiero ver algo de MCP/);
  assert.match(request.body.messages[0].content, /Spanish/);
});

test('elastic: calls the completion inference endpoint with the API key', async (t) => {
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return json(200, { completion: [{ result: 'Try [t-1000-gi].' }] });
  };
  const env = {
    LLM_PROVIDER: 'elastic',
    ELASTIC_ENDPOINT: 'https://es.example.test/',
    ELASTIC_API_KEY: SECRET,
    ELASTIC_LLM_INFERENCE_ID: 'my-llm',
  };
  const app = await startApp({ env, fetch: fakeFetch });
  t.after(app.close);
  const res = await app.ask({ question: 'gitops talks?', lang: 'en' });
  assert.equal(res.headers.get('x-kubepulse-source'), 'elastic');
  const body = await res.json();
  assert.equal(body.provider, 'elastic');
  assert.deepEqual(body.citations, ['t-1000-gi']);
  assert.equal(request.url, 'https://es.example.test/_inference/completion/my-llm');
  assert.equal(request.init.headers.authorization, `ApiKey ${SECRET}`);
});

test('provider errors fall back to local without logging the question or the key', async (t) => {
  const warnings = captureWarnings(t);
  const app = await startApp({
    env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: SECRET },
    fetch: async () => json(500, { error: 'boom' }),
  });
  t.after(app.close);
  const question = 'pregunta-privada sobre MCP';
  const res = await app.ask({ question });
  assert.equal(res.headers.get('x-kubepulse-source'), 'local');
  assert.equal(res.headers.get('x-kubepulse-degraded'), 'true');
  const body = await res.json();
  assert.equal(body.provider, 'none');
  assert.equal(body.degraded, true);
  assert.deepEqual(body.citations, ['t-0920-ace']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 500/);
  assert.ok(!warnings[0].includes('pregunta-privada') && !warnings[0].includes(SECRET));
});

test('a provider that hangs past the timeout falls back to local', async (t) => {
  captureWarnings(t);
  // Ignores the abort signal on purpose: the router must still give up on time.
  const app = await startApp({ env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: SECRET }, fetch: () => new Promise(() => {}) });
  t.after(app.close);
  const started = Date.now();
  const res = await app.ask({ question: 'MCP' });
  assert.ok(Date.now() - started < 2000);
  assert.equal(res.headers.get('x-kubepulse-source'), 'local');
  assert.equal((await res.json()).degraded, true);
});

test('missing credentials or bad responses degrade instead of failing', async (t) => {
  captureWarnings(t);
  const cases = [
    { env: { LLM_PROVIDER: 'openai' }, fetch: async () => json(200, {}) },
    { env: { LLM_PROVIDER: 'elastic', ELASTIC_ENDPOINT: 'https://es', ELASTIC_API_KEY: SECRET }, fetch: async () => json(200, {}) },
    { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: SECRET }, fetch: async () => json(200, { choices: [] }) },
    { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: SECRET }, fetch: async () => { throw new Error('network down'); } },
    { env: { LLM_PROVIDER: 'something-else' }, fetch: async () => json(200, {}) },
  ];
  for (const options of cases) {
    const app = await startApp(options);
    const res = await app.ask({ question: 'MCP' });
    app.close();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-kubepulse-source'), 'local');
  }
});

test('keyword ranking puts topic matches first', () => {
  assert.deepEqual(keywordRank('argo gitops', CATALOG.talks), ['t-1000-gi']);
  assert.deepEqual(keywordRank('mcp agents', CATALOG.talks)[0], 't-0920-ace');
});
