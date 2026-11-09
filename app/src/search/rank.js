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

// Whole words (ES and EN) that name each topic. Matching is by complete token, never by substring,
// so "for" does not hit "platform" and "gen" does not hit "agentes".
const TOPIC_ALIASES = {
  Agentes: ['agente', 'agentes', 'agent', 'agents', 'agentic', 'agentico', 'agentica', 'agenticos'],
  'Platform Engineering': ['platform', 'platforms', 'plataforma', 'plataformas', 'idp', 'idps', 'backstage'],
  MCP: ['mcp'],
  Seguridad: ['seguridad', 'security', 'secure', 'securing', 'attack', 'attacks', 'ataque', 'ataques', 'sandbox', 'sandboxes', 'hardening'],
  Observabilidad: ['observabilidad', 'observability', 'opentelemetry', 'otel', 'tracing', 'traces', 'trazas', 'metrics', 'metricas', 'logs'],
  eBPF: ['ebpf', 'cilium'],
  GitOps: ['gitops', 'argo', 'argocd', 'flux'],
  'Inferencia / GPUs': ['inferencia', 'inference', 'gpu', 'gpus', 'llm', 'llms', 'vllm', 'serving'],
};
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'for', 'of', 'to', 'in', 'on', 'with', 'by', 'at', 'or', 'from',
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'en', 'con', 'para', 'por', 'un', 'una', 'al',
]);
// A query word may also be a prefix of an alias ("secur" -> security), only from 4 letters on.
const MIN_PREFIX = 4;

const tokens = (text) => norm(text).split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w));

const ALIAS_INDEX = Object.entries(TOPIC_ALIASES).map(([topic, aliases]) => ({
  topic,
  name: norm(topic),
  aliases: new Set(aliases.map(norm)),
}));

const tokenNamesTopic = (word, entry) =>
  entry.aliases.has(word) ||
  (word.length >= MIN_PREFIX && [...entry.aliases].some((a) => a.length > word.length && a.startsWith(word)));

// Canonical topics mentioned in free text, in Spanish or English:
// "seguridad de agentes" -> Seguridad, Agentes; "observability" -> Observabilidad.
function topicsIn(text) {
  const whole = norm(text);
  const words = tokens(text);
  return ALIAS_INDEX.filter((e) => whole === e.name || words.some((w) => tokenNamesTopic(w, e))).map((e) => e.topic);
}

// Topics of the talk that are in `topics` (canonical names, as returned by topicsIn).
const matchReason = (talk, topics) => talk.topics.filter((t) => topics.includes(t));

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

// One entry of parallel_matches: the talk fields of the contract, without nested alternatives.
const formatMatch = (talk, reason, catalog) => ({
  id: talk.id,
  title: talk.title,
  speakers: talk.speakers,
  start: talk.start,
  end: talk.end,
  room: roomRef(talk, catalog),
  topics: talk.topics,
  match_reason: reason,
  forecast: forecast(talk, catalog),
});

// `matches` is only passed by /recommend; /search keeps its current shape.
function formatTalk(talk, reason, alternative, catalog, matches) {
  const out = {
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
  };
  if (matches) out.parallel_matches = matches;
  out.forecast = forecast(talk, catalog);
  return out;
}

// Two talks overlap when each one starts before the other ends (touching edges do not count).
const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

// ---------- local ranking (fallback when Elasticsearch is unavailable) ----------

// Ordered talk ids for free text: topic matches weigh most, then word hits (title hits count twice).
function localRank(text, catalog = defaultCatalog, terms = []) {
  const words = [...new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
  const topics = terms.length ? terms : topicsIn(text);
  const scored = catalog.talks.map((talk) => {
    const haystack = norm(`${talk.title} ${talk.abstract} ${talk.speakers.join(' ')} ${talk.topics.join(' ')}`);
    const topicHits = matchReason(talk, topics).length;
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
const MAX_PARALLEL_MATCHES = 4;

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

  const byScore = (a, b) => b.score - a.score || a.talk.id.localeCompare(b.talk.id);
  const picks = [...slots.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([, list]) => list.sort(byScore));
  const recommendedIds = new Set(picks.map(([best]) => best.talk.id));
  // Pool for parallel_matches: eligible talks that share at least one interest topic.
  const matching = candidates.filter((c) => c.reason.length > 0).sort(byScore);

  const talks = picks.map(([best, alt]) => {
    const matches = matching
      .filter((c) => !recommendedIds.has(c.talk.id) && overlaps(c.talk, best.talk))
      .slice(0, MAX_PARALLEL_MATCHES)
      .map((c) => formatMatch(c.talk, c.reason, catalog));
    const alternative = matches.length ? catalog.talksById.get(matches[0].id) : alt ? alt.talk : null;
    return formatTalk(best.talk, best.reason, alternative, catalog, matches);
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
