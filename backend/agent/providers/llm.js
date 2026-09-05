// LLM provider using OpenAI-compatible protocol.
// Works with MiniMax, DeepSeek, Qwen, OpenAI itself, etc. — any provider
// that exposes a POST /v1/chat/completions endpoint.

const OpenAI = require('openai');

/**
 * Create an OpenAI SDK client pointed at the user's chosen provider.
 * @param {object} opts
 * @param {string} opts.baseUrl  e.g. "https://api.minimax.io/v1"
 * @param {string} opts.apiKey   user's BYOK key
 */
function createLLMClient({ baseUrl, apiKey }) {
  if (!baseUrl || !apiKey) {
    throw new Error('createLLMClient: baseUrl and apiKey are required');
  }
  return new OpenAI({ baseURL: baseUrl, apiKey });
}

/**
 * Stream a chat completion. Returns the raw OpenAI SDK stream object
 * (an async iterable of ChatCompletionChunk). Caller is responsible
 * for parsing deltas and accumulating.
 */
function streamChatCompletion(client, params) {
  return client.chat.completions.create({
    ...params,
    stream: true,
    stream_options: { include_usage: true },
  });
}

/**
 * Non-streaming list of available models. Used by the "test connection" button.
 * Returns array of { id, ... }.
 */
async function listModels(client) {
  const res = await client.models.list();
  return res.data || [];
}

module.exports = {
  createLLMClient,
  streamChatCompletion,
  listModels,
};
