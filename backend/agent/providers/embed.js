// Embedding provider for MiniMax.
//
// MiniMax's embedding endpoint at /v1/embeddings uses a DIFFERENT body shape
// from OpenAI: it requires { model, type, texts } where type is 'db' (for
// indexing documents) or 'query' (for searching). It ALSO requires a GroupId
// query parameter on the URL. This is MiniMax-specific — not all providers
// use this protocol.
//
// embo-01 outputs 1536-dim vectors. This module stores them as plain
// numbers; the caller (orchestrator) decides where to persist them.

/**
 * Call MiniMax's embeddings endpoint.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl    e.g. "https://api.minimax.io/v1"
 * @param {string} opts.apiKey     user's MiniMax API key
 * @param {string} opts.groupId    MiniMax GroupId (required)
 * @param {string} opts.model      e.g. "embo-01"
 * @param {string[]} opts.texts    texts to embed
 * @param {'db'|'query'} [opts.type]  'db' for indexing, 'query' for searching
 * @returns {Promise<number[][]>}   one vector per input text
 */
async function embed({ baseUrl, apiKey, groupId, model, texts, type = 'db' }) {
  if (!baseUrl || !apiKey || !groupId || !model) {
    throw new Error('embed: baseUrl, apiKey, groupId, model are all required');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('embed: texts must be a non-empty array');
  }
  if (!['db', 'query'].includes(type)) {
    throw new Error(`embed: type must be 'db' or 'query', got "${type}"`);
  }

  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/embeddings`);
  url.searchParams.set('GroupId', groupId);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, type, texts }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MiniMax embed HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  if (json.base_resp && json.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax embed error: ${json.base_resp.status_code} ${json.base_resp.status_msg || ''}`
    );
  }
  if (!Array.isArray(json.vectors)) {
    throw new Error(`MiniMax embed: expected vectors array, got ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.vectors;
}

/**
 * Convenience: embed a single query string.
 */
async function embedQuery({ baseUrl, apiKey, groupId, model, text }) {
  const [vec] = await embed({ baseUrl, apiKey, groupId, model, texts: [text], type: 'query' });
  return vec;
}

module.exports = {
  embed,
  embedQuery,
};
