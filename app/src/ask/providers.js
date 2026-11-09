// Owner: E · Extras. LLM providers for /ask, called with native fetch (no SDKs).
// Keys come only from env. Errors never include keys, prompts or the question.
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 350;

class ProviderError extends Error {}

// Rejects after `ms` and aborts the request, even if the fetch implementation ignores the signal.
async function withTimeout(ms, run) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError(`timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new ProviderError('invalid JSON response');
  }
}

function nonEmpty(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError('empty answer');
  return text.trim();
}

async function askOpenAI({ system, user }, { env, fetchImpl, signal }) {
  if (!env.OPENAI_API_KEY) throw new ProviderError('OPENAI_API_KEY is not set');
  const res = await fetchImpl(OPENAI_URL, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const body = await readJson(res);
  return nonEmpty(body?.choices?.[0]?.message?.content);
}

// Elasticsearch inference API, `completion` task: POST _inference/completion/<id> { input }.
async function askElastic({ system, user }, { env, fetchImpl, signal }) {
  const { ELASTIC_ENDPOINT: endpoint, ELASTIC_API_KEY: apiKey, ELASTIC_LLM_INFERENCE_ID: inferenceId } = env;
  if (!endpoint || !apiKey) throw new ProviderError('ELASTIC_ENDPOINT or ELASTIC_API_KEY is not set');
  if (!inferenceId) throw new ProviderError('ELASTIC_LLM_INFERENCE_ID is not set');
  const url = `${endpoint.replace(/\/+$/, '')}/_inference/completion/${encodeURIComponent(inferenceId)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `ApiKey ${apiKey}` },
    body: JSON.stringify({ input: `${system}\n\n${user}` }),
  });
  const body = await readJson(res);
  return nonEmpty(body?.completion?.[0]?.result);
}

const PROVIDERS = { openai: askOpenAI, elastic: askElastic };

module.exports = { PROVIDERS, ProviderError, withTimeout };
