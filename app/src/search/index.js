// Owner: B · Datos. POST /recommend and GET /search (see docs/contracts.md).
// Hybrid search in Elasticsearch (RRF of BM25 + semantic_text). If Elastic is not configured,
// fails or takes longer than ES_TIMEOUT_MS, it ranks data/talks.json locally and answers anyway.
// Response headers say which one answered: X-KubePulse-Source (elastic|local), X-KubePulse-Degraded.
const express = require('express');
const { INDEX, getClient } = require('./elastic');
const rank = require('./rank');

// Budget for the whole Elasticsearch call, connection included. SEARCH_TIMEOUT_MS only exists to
// test the Elastic path from a slow network; production keeps the default.
const ES_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS) || 1500;
const router = express.Router();

// During POST /chaos, C · Pulso's middleware adds bounded latency before the handler runs, so it
// never counts against the Elasticsearch deadline above. No-op until src/pulse exports it.
let chaosLatency = () => (_req, _res, next) => next();
try {
  const pulse = require('../pulse');
  if (typeof pulse.chaosLatency === 'function') chaosLatency = pulse.chaosLatency;
} catch {
  // pulse module missing or failing to load: search keeps working without chaos latency.
}

// Open the keep-alive connection at startup so the first visitor does not pay for TLS.
getClient()?.ping({}, { requestTimeout: 10000 }).catch(() => {});

function withDeadline(promise, ms, controller) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Elasticsearch took longer than ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function esFilters(profile) {
  const filter = [];
  if (profile?.level === 'beginner') filter.push({ bool: { must_not: { term: { level: 'advanced' } } } });
  if (profile?.level === 'advanced') filter.push({ bool: { must_not: { term: { level: 'beginner' } } } });
  if (profile?.a11y.captions) filter.push({ term: { captions: true } });
  if (profile?.a11y.wheelchair) {
    const rooms = rank.defaultCatalog.rooms.filter((r) => r.wheelchair_accessible).map((r) => r.id);
    filter.push({ terms: { room_id: rooms } });
  }
  return filter;
}

// Ordered talk ids from Elasticsearch: RRF over BM25 (keywords + exact topics) and semantic.
// One query ranks the whole catalog, so /recommend builds parallel_matches for every slot from these
// same ids (rank.recommend), with no query per slot.
const CATALOG_SIZE = rank.defaultCatalog.talks.length;

async function hybridIds({ lexical, semantic, topics = [], filter = [] }) {
  const es = getClient();
  if (!es) throw new Error('Elasticsearch not configured');
  const should = [{ multi_match: { query: lexical, fields: ['title^2', 'abstract', 'speakers'] } }];
  if (topics.length) should.push({ terms: { topics, boost: 3 } });

  const controller = new AbortController();
  const res = await withDeadline(
    es.search(
      {
        index: INDEX,
        size: CATALOG_SIZE,
        _source: false,
        retriever: {
          rrf: {
            retrievers: [
              { standard: { query: { bool: { should, filter, minimum_should_match: 1 } } } },
              { standard: { query: { bool: { must: { semantic: { field: 'semantic', query: semantic } }, filter } } } },
            ],
            rank_window_size: Math.max(50, CATALOG_SIZE), // RRF needs size <= rank_window_size
            rank_constant: 20,
          },
        },
      },
      { requestTimeout: ES_TIMEOUT_MS, signal: controller.signal, maxRetries: 0 },
    ),
    ES_TIMEOUT_MS,
    controller,
  );
  return res.hits.hits.map((h) => h._id);
}

// Runs the Elasticsearch ranking, or the local one if it fails. Sets the source headers.
async function rankedIds(res, query, localFallback) {
  try {
    const ids = await hybridIds(query);
    res.set({ 'X-KubePulse-Source': 'elastic', 'X-KubePulse-Degraded': 'false' });
    return ids;
  } catch (err) {
    if (getClient()) console.warn(`search: Elasticsearch unavailable, using local ranking (${err.message})`);
    res.set({ 'X-KubePulse-Source': 'local', 'X-KubePulse-Degraded': 'true' });
    return localFallback();
  }
}

router.post('/recommend', chaosLatency(), async (req, res) => {
  const { profile, error } = rank.validateProfile(req.body);
  if (error) return res.status(400).json({ error });

  const topics = rank.wantedTopics(profile.interests);
  const lexical = `${rank.expandInterests(profile.interests)} ${rank.expandInterests(topics)}`;
  const semantic = `${profile.role ? `${profile.role}. ` : ''}Interested in: ${profile.interests.join(', ')}`;
  const ids = await rankedIds(
    res,
    { lexical, semantic, topics, filter: esFilters(profile) },
    () => rank.localRank(lexical, rank.defaultCatalog, topics),
  );
  return res.json(rank.recommend(profile, ids));
});

router.get('/search', chaosLatency(), async (req, res) => {
  const { q, error } = rank.validateQuery(req.query.q);
  if (error) return res.status(400).json({ error });

  const topics = rank.topicsIn(q);
  const lexical = `${q} ${rank.expandInterests(topics)}`;
  const ids = await rankedIds(res, { lexical, semantic: q, topics }, () => rank.localRank(q, rank.defaultCatalog, topics));
  return res.json({ talks: rank.searchResults(q, ids) });
});

module.exports = router;
