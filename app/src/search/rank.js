// Pure ranking and formatting for /recommend and /search. No I/O, so it is easy to test
// and works the same whether the ranked order comes from Elasticsearch or the local fallback.
const talksData = require('../../data/talks.json');
const roomsData = require('../../data/rooms.json');

const LEVELS = ['any', 'beginner', 'advanced'];
const LANGS = ['es', 'en'];
const BREAKS = [
  { start: '2026-11-09T10:25:00-07:00', label: 'coffee' },
  { start: '2026-11-09T11:40:00-07:00', label: 'lunch' },
];
// English keywords per topic, so BM25 and the local fallback also hit English abstracts.
const TOPIC_KEYWORDS = {
  agentes: 'agents agentic agent',
  'platform engineering': 'platform engineering internal developer platform golden paths',
  mcp: 'MCP model context protocol tools',
  seguridad: 'security secure attacks sandbox hardening',
  observabilidad: 'observability OpenTelemetry tracing metrics logs',
  ebpf: 'eBPF kernel Cilium',
  gitops: 'GitOps Argo CD ArgoCD Flux',
  'inferencia / gpus': 'inference GPU GPUs LLM serving vLLM',
};

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function buildCatalog(talks = talksData, rooms = roomsData) {
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const talksById = new Map(talks.map((t) => [t.id, t]));
  return { talks, rooms, roomsById, talksById };
}

const defaultCatalog = buildCatalog();

// ---------- validation ----------

const isStr = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be a JSON object with an "interests" array' };
  }
  const { name, role, interests, level = 'any', lang = 'es', a11y = {} } = body;
  if (name !== undefined && !(typeof name === 'string' && name.length <= 80)) {
    return { error: '"name" must be a string of at most 80 characters' };
  }
  if (role !== undefined && !(typeof role === 'string' && role.length <= 80)) {
    return { error: '"role" must be a string of at most 80 characters' };
  }
  if (!Array.isArray(interests) || interests.length === 0 || interests.length > 10) {
    return { error: '"interests" must be an array of 1 to 10 strings' };
  }
  if (!interests.every((i) => isStr(i, 60))) {
    return { error: 'each interest must be a non-empty string of at most 60 characters' };
  }
  if (!LEVELS.includes(level)) return { error: `"level" must be one of ${LEVELS.join(', ')}` };
  if (!LANGS.includes(lang)) return { error: `"lang" must be one of ${LANGS.join(', ')}` };
  if (!a11y || typeof a11y !== 'object' || Array.isArray(a11y)) {
    return { error: '"a11y" must be an object' };
  }
  for (const key of ['captions', 'wheelchair', 'avoid_crowded']) {
    if (a11y[key] !== undefined && typeof a11y[key] !== 'boolean') {
      return { error: `"a11y.${key}" must be a boolean` };
    }
  }
  return {
    profile: {
      name: name || '',
      role: role || '',
      interests: [...new Set(interests.map((i) => i.trim()))],
      level,
      lang,
      a11y: { captions: !!a11y.captions, wheelchair: !!a11y.wheelchair, avoid_crowded: !!a11y.avoid_crowded },
    },
  };
}

function validateQuery(q) {
  if (typeof q !== 'string' || q.trim().length === 0) return { error: 'query parameter "q" is required' };
  if (q.length > 200) return { error: 'query parameter "q" must be at most 200 characters' };
  return { q: q.trim() };
}

// ---------- shared helpers ----------

// A topic matches an interest when they are equal ignoring case/accents, or one contains the other
// ("GPUs" matches "Inferencia / GPUs").
function topicMatches(topic, interest) {
  const t = norm(topic);
  const i = norm(interest);
  return t === i || (i.length >= 3 && (t.includes(i) || i.includes(t)));
}

const matchReason = (talk, interests) => talk.topics.filter((t) => interests.some((i) => topicMatches(t, i)));

const ALL_TOPICS = [...new Set(talksData.flatMap((t) => t.topics))];

// Canonical topics mentioned in free text, in Spanish or by an English keyword:
// "seguridad de agentes" -> Seguridad, Agentes; "observability" -> Observabilidad.
function topicsIn(text) {
  const words = norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return ALL_TOPICS.filter((t) => {
    const aliases = norm(TOPIC_KEYWORDS[norm(t)] || '').split(/\s+/).filter((a) => a.length >= 5);
    return [text, ...words].some((w) => topicMatches(t, w)) || words.some((w) => aliases.includes(w));
  });
}

const wantedTopics = (interests) => [...new Set(interests.flatMap((i) => topicsIn(i)))];

function forecast(talk, catalog = defaultCatalog) {
  const room = catalog.roomsById.get(talk.room_id);
  const ratio = room ? (talk.expected_attendance || 0) / room.capacity : 0;
  if (ratio >= 0.9) return 'high';
  if (ratio >= 0.5) return 'mid';
  return 'low';
}

function isEligible(talk, profile, catalog = defaultCatalog) {
  if (profile.level === 'beginner' && talk.level === 'advanced') return false;
  if (profile.level === 'advanced' && talk.level === 'beginner') return false;
  if (profile.a11y.captions && !talk.captions) return false;
  if (profile.a11y.wheelchair && !catalog.roomsById.get(talk.room_id)?.wheelchair_accessible) return false;
  return true;
}

// Text the search engines get for a profile: interests plus their English keywords.
function expandInterests(interests) {
  return interests.map((i) => `${i} ${TOPIC_KEYWORDS[norm(i)] || ''}`.trim()).join(' ');
}

const roomRef = (talk, catalog) => {
  const room = catalog.roomsById.get(talk.room_id);
  return { id: talk.room_id, name: room ? room.name : talk.room_id };
};

function formatTalk(talk, reason, alternative, catalog) {
  return {
    id: talk.id,
    title: talk.title,
    speakers: talk.speakers,
    start: talk.start,
    end: talk.end,
    room: roomRef(talk, catalog),
    topics: talk.topics,
    match_reason: reason,
    parallel_alternative: alternative
      ? { id: alternative.id, title: alternative.title, room: roomRef(alternative, catalog) }
      : null,
    forecast: forecast(talk, catalog),
  };
}

// ---------- local ranking (fallback when Elasticsearch is unavailable) ----------

// Ordered talk ids for free text: topic matches weigh most, then word hits (title hits count twice).
function localRank(text, catalog = defaultCatalog, terms = []) {
  const words = [...new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
  const scored = catalog.talks.map((talk) => {
    const haystack = norm(`${talk.title} ${talk.abstract} ${talk.speakers.join(' ')} ${talk.topics.join(' ')}`);
    const topicHits = matchReason(talk, terms.length ? terms : [text, ...words]).length;
    const wordHits = words.filter((w) => haystack.includes(w)).length;
    const titleHits = words.filter((w) => norm(talk.title).includes(w)).length;
    return { id: talk.id, score: topicHits * 5 + wordHits + titleHits };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((s) => s.id);
}

// ---------- /recommend ----------

// When no interest names a known topic (free text like "kubernetes cost"), the top-ranked talks
// count as relevant. Otherwise only talks sharing a topic with the interests do.
const TOP_K_RELEVANT = 8;

function recommend(profile, rankedIds, catalog = defaultCatalog) {
  const position = new Map(rankedIds.map((id, i) => [id, i]));
  const n = Math.max(rankedIds.length, 1);
  const wanted = wantedTopics(profile.interests);
  const freeText = wanted.length === 0;

  const candidates = catalog.talks
    .filter((talk) => isEligible(talk, profile, catalog))
    .map((talk) => {
      const reason = matchReason(talk, wanted);
      const pos = position.get(talk.id);
      const relevant = reason.length > 0 || (freeText && pos !== undefined && pos < TOP_K_RELEVANT);
      const fc = forecast(talk, catalog);
      let score = reason.length + (pos === undefined ? 0 : (n - pos) / n);
      if (talk.language === profile.lang) score += 0.25;
      if (profile.a11y.avoid_crowded) score -= fc === 'high' ? 1.5 : fc === 'mid' ? 0.3 : 0;
      return { talk, reason, relevant, score };
    })
    .filter((c) => c.relevant);

  const slots = new Map();
  for (const c of candidates) {
    if (!slots.has(c.talk.start)) slots.set(c.talk.start, []);
    slots.get(c.talk.start).push(c);
  }

  const talks = [...slots.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([, list]) => {
      list.sort((a, b) => b.score - a.score || a.talk.id.localeCompare(b.talk.id));
      const [best, alt] = list;
      return formatTalk(best.talk, best.reason, alt ? alt.talk : null, catalog);
    });

  return { talks, breaks: BREAKS };
}

// ---------- /search ----------

const SEARCH_LIMIT = 10;

function searchResults(q, rankedIds, catalog = defaultCatalog) {
  const terms = topicsIn(q);
  return rankedIds
    .map((id) => catalog.talksById.get(id))
    .filter(Boolean)
    .slice(0, SEARCH_LIMIT)
    .map((talk) => {
      // Alternative: another talk in the same slot that shares a topic with this one.
      const alt = catalog.talks.find(
        (t) => t.id !== talk.id && t.start === talk.start && t.topics.some((tp) => talk.topics.includes(tp)),
      );
      return formatTalk(talk, matchReason(talk, terms), alt || null, catalog);
    });
}

module.exports = {
  BREAKS,
  buildCatalog,
  defaultCatalog,
  expandInterests,
  forecast,
  isEligible,
  localRank,
  matchReason,
  recommend,
  searchResults,
  topicsIn,
  validateProfile,
  wantedTopics,
  validateQuery,
};
