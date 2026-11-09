// Owner: E · Extras. Picks the talks that give the LLM its context (simple RAG).
// Uses B · Data's local ranking from src/search/rank.js when it exists (require only, never modified),
// and a small keyword ranking of its own otherwise, so /ask works before B's module is merged.
const MAX_CONTEXT_TALKS = 8;

function optionalRequire(path) {
  try {
    return require(path);
  } catch {
    return null;
  }
}

const rank = optionalRequire('../search/rank');

function loadDefaultCatalog() {
  if (rank?.defaultCatalog) return { talks: rank.defaultCatalog.talks, rooms: rank.defaultCatalog.rooms };
  return {
    talks: optionalRequire('../../data/talks.json') || [],
    rooms: optionalRequire('../../data/rooms.json') || [],
  };
}

const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const wordsOf = (text) => [...new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];

// Fallback ranking: topic hits weigh most, then word hits in title (x2), abstract and speakers.
function keywordRank(text, talks) {
  const words = wordsOf(text);
  return talks
    .map((talk) => {
      const topics = (talk.topics || []).map(norm);
      const title = norm(talk.title || '');
      const haystack = `${title} ${norm(talk.abstract || '')} ${norm((talk.speakers || []).join(' '))}`;
      const topicHits = topics.filter((t) => words.some((w) => t.includes(w))).length;
      const wordHits = words.filter((w) => haystack.includes(w)).length;
      const titleHits = words.filter((w) => title.includes(w)).length;
      return { id: talk.id, score: topicHits * 5 + wordHits + titleHits };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((s) => s.id);
}

function rankedIds(text, catalog) {
  if (rank?.localRank && rank?.buildCatalog && rank?.topicsIn) {
    try {
      return rank.localRank(text, rank.buildCatalog(catalog.talks, catalog.rooms), rank.topicsIn(text));
    } catch {
      // B's ranking rejected this catalog: use ours below.
    }
  }
  return keywordRank(text, catalog.talks);
}

// The question plus the profile's interests and role decide which talks are relevant.
function relevantTalks(question, profile, catalog, limit = MAX_CONTEXT_TALKS) {
  const interests = Array.isArray(profile?.interests) ? profile.interests.filter((i) => typeof i === 'string') : [];
  const role = typeof profile?.role === 'string' ? profile.role : '';
  const text = [question, ...interests, role].join(' ');
  const byId = new Map(catalog.talks.map((t) => [t.id, t]));
  return rankedIds(text, catalog)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, limit);
}

function roomName(talk, catalog) {
  return catalog.rooms.find((r) => r.id === talk.room_id)?.name || talk.room_id || '';
}

module.exports = { MAX_CONTEXT_TALKS, keywordRank, loadDefaultCatalog, relevantTalks, roomName, usesSearchRank: !!rank };
