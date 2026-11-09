// Single Elasticsearch client for the app and the ingest script.
// Returns null when credentials are missing, so callers fall back to local ranking.
const { Client } = require('@elastic/elasticsearch');

const INDEX = 'talks';
// Multilingual embeddings (Elastic Inference Service): Spanish interests match English abstracts.
const INFERENCE_ID = '.jina-embeddings-v5-text-small';

const MAPPINGS = {
  dynamic: false,
  properties: {
    id: { type: 'keyword' },
    title: { type: 'text' },
    abstract: { type: 'text' },
    semantic: { type: 'semantic_text', inference_id: INFERENCE_ID },
    speakers: { type: 'keyword' },
    room_id: { type: 'keyword' },
    start: { type: 'date' },
    end: { type: 'date' },
    topics: { type: 'keyword' },
    level: { type: 'keyword' },
    language: { type: 'keyword' },
    captions: { type: 'boolean' },
  },
};

let client;

function getClient() {
  if (client !== undefined) return client;
  const { ELASTIC_ENDPOINT: node, ELASTIC_API_KEY: apiKey } = process.env;
  client = node && apiKey ? new Client({ node, auth: { apiKey }, maxRetries: 0, requestTimeout: 5000 }) : null;
  return client;
}

// Text that feeds the semantic_text field: title + abstract + topics.
function semanticText(talk) {
  return `${talk.title}. ${talk.abstract} Topics: ${talk.topics.join(', ')}.`;
}

module.exports = { INDEX, INFERENCE_ID, MAPPINGS, getClient, semanticText };
