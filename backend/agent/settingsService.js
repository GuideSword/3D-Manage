'use strict';

const nodeCrypto = require('crypto');
const defaultSecrets = require('../utils/crypto');
const { createLLMClient } = require('./providers/llm');
const defaultEmbedProvider = require('./providers/embed');
const { probeVision } = require('./visionProbe');

function settingsError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value, field = '服务 Base URL') {
  const normalized = cleanText(value).replace(/\/+$/, '');
  if (!normalized) throw settingsError('CONFIG_INCOMPLETE', `${field} 不能为空`);

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (_) {
    throw settingsError('CONFIG_INVALID_URL', `${field} 必须是有效的 HTTP(S) 地址`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw settingsError('CONFIG_INVALID_URL', `${field} 只支持 HTTP 或 HTTPS`);
  }
  return normalized;
}

function getExistingSecret(existing, field, secrets) {
  const encrypted = existing?.[field];
  if (!encrypted) return '';
  try {
    return cleanText(secrets.decrypt(encrypted));
  } catch (_) {
    throw settingsError('CONFIG_SECRET_UNREADABLE', '已保存的 API Key 无法解密，请重新填写', 500);
  }
}

function fingerprintEmbeddingConfig(config) {
  const baseUrl = normalizeBaseUrl(config?.baseUrl, 'Embedding Base URL').toLowerCase();
  const model = cleanText(config?.model);
  const groupId = cleanText(config?.groupId);
  return nodeCrypto
    .createHash('sha256')
    .update(JSON.stringify({ protocol: 'embedding-v1', baseUrl, model, groupId }))
    .digest('hex');
}

function buildCandidate({ existing = null, input = {}, secrets = defaultSecrets } = {}) {
  const llmInput = input.llm || {};
  const llmBaseUrl = normalizeBaseUrl(llmInput.baseUrl, '大模型 Base URL');
  const llmModel = cleanText(llmInput.model);
  const llmApiKey = cleanText(llmInput.apiKey)
    || getExistingSecret(existing, 'llm_api_key_enc', secrets);

  if (!llmModel || !llmApiKey) {
    throw settingsError('LLM_CONFIG_INCOMPLETE', '请完整填写大模型 Base URL、API Key 和模型名');
  }

  const llm = {
    provider: cleanText(llmInput.provider) || existing?.llm_provider || 'openai_compat',
    baseUrl: llmBaseUrl,
    apiKey: llmApiKey,
    model: llmModel,
    apiKeyReplaced: Boolean(cleanText(llmInput.apiKey)),
  };

  const embeddingInput = input.embedding || {};
  if (embeddingInput.enabled !== true) {
    return { llm, embedding: { enabled: false } };
  }

  const embeddingBaseUrl = normalizeBaseUrl(embeddingInput.baseUrl, 'Embedding Base URL');
  const embeddingModel = cleanText(embeddingInput.model);
  const embeddingGroupId = cleanText(embeddingInput.groupId);
  const embeddingApiKey = cleanText(embeddingInput.apiKey)
    || getExistingSecret(existing, 'embed_api_key_enc', secrets);

  if (!embeddingModel || !embeddingGroupId || !embeddingApiKey) {
    throw settingsError(
      'EMBEDDING_CONFIG_INCOMPLETE',
      '启用 Embedding 时，请完整填写 Base URL、API Key、模型名和 Group ID',
    );
  }

  const embedding = {
    enabled: true,
    baseUrl: embeddingBaseUrl,
    apiKey: embeddingApiKey,
    model: embeddingModel,
    groupId: embeddingGroupId,
    apiKeyReplaced: Boolean(cleanText(embeddingInput.apiKey)),
  };
  embedding.configFingerprint = fingerprintEmbeddingConfig(embedding);
  return { llm, embedding };
}

async function testLlmCandidate(candidate, dependencies = {}) {
  const createClient = dependencies.createClient || createLLMClient;
  try {
    const client = createClient({ baseUrl: candidate.llm.baseUrl, apiKey: candidate.llm.apiKey });
    const response = await client.chat.completions.create({
      model: candidate.llm.model,
      messages: [{ role: 'user', content: '只回复 OK' }],
      max_completion_tokens: 8,
    });
    const reply = String(response?.choices?.[0]?.message?.content || '').trim();
    const vision = await (dependencies.probeVision || probeVision)({
      model: candidate.llm.model,
      complete: (request) => client.chat.completions.create(request),
    });
    return {
      llm: { ok: true, model: response?.model || candidate.llm.model, reply },
      vision,
    };
  } catch (error) {
    return {
      llm: {
        ok: false,
        error: '连接大模型服务失败，请检查地址、模型名和 API Key',
        ...(error?.status ? { status: error.status } : {}),
      },
      vision: { status: 'untested', checkedAt: null, reasonCode: 'LLM_TEST_FAILED' },
    };
  }
}

async function testEmbeddingCandidate(candidate, dependencies = {}) {
  if (!candidate.embedding.enabled) return { enabled: false, ok: true, skipped: true };
  const provider = dependencies.embedProvider || defaultEmbedProvider;
  try {
    const vectors = await provider.embed({
      baseUrl: candidate.embedding.baseUrl,
      apiKey: candidate.embedding.apiKey,
      groupId: candidate.embedding.groupId,
      model: candidate.embedding.model,
      texts: ['连接测试'],
      type: 'query',
    });
    return { enabled: true, ok: true, dim: vectors?.[0]?.length || 0 };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      error: '连接 Embedding 服务失败，请检查地址、模型名、Group ID 和 API Key',
      ...(error?.status ? { status: error.status } : {}),
    };
  }
}

function persistedRow({ candidate, existing, vision, preserveEmbedding = false, secrets = defaultSecrets }) {
  const priorLlmKey = existing?.llm_api_key_enc;
  const llmCiphertext = !candidate.llm.apiKeyReplaced && priorLlmKey
    ? priorLlmKey
    : secrets.encrypt(candidate.llm.apiKey);
  const priorPlaintext = existing?.llm_api_key_enc
    ? getExistingSecret(existing, 'llm_api_key_enc', secrets)
    : '';
  const llmChanged = !existing
    || existing.llm_provider !== candidate.llm.provider
    || existing.llm_base_url !== candidate.llm.baseUrl
    || existing.llm_model !== candidate.llm.model
    || priorPlaintext !== candidate.llm.apiKey;

  let embeddingFields;
  if (preserveEmbedding && existing) {
    embeddingFields = {
      embed_enabled: existing.embed_enabled ? 1 : 0,
      embed_base_url: existing.embed_base_url || null,
      embed_api_key_enc: existing.embed_api_key_enc || null,
      embed_model: existing.embed_model || null,
      embed_group_id: existing.embed_group_id || null,
      embed_config_fingerprint: existing.embed_config_fingerprint || null,
    };
  } else if (candidate.embedding.enabled) {
    const embedCiphertext = !candidate.embedding.apiKeyReplaced && existing?.embed_api_key_enc
      ? existing.embed_api_key_enc
      : secrets.encrypt(candidate.embedding.apiKey);
    embeddingFields = {
      embed_enabled: 1,
      embed_base_url: candidate.embedding.baseUrl,
      embed_api_key_enc: embedCiphertext,
      embed_model: candidate.embedding.model,
      embed_group_id: candidate.embedding.groupId,
      embed_config_fingerprint: candidate.embedding.configFingerprint,
    };
  } else {
    embeddingFields = {
      embed_enabled: 0,
      embed_base_url: null,
      embed_api_key_enc: null,
      embed_model: null,
      embed_group_id: null,
      embed_config_fingerprint: null,
    };
  }

  return {
    llm_provider: candidate.llm.provider,
    llm_base_url: candidate.llm.baseUrl,
    llm_api_key_enc: llmCiphertext,
    llm_model: candidate.llm.model,
    llm_vision_status: vision?.status || 'untested',
    llm_vision_checked_at: vision?.checkedAt || null,
    llm_config_revision: llmChanged ? Number(existing?.llm_config_revision || 0) + 1 : Number(existing?.llm_config_revision || 1),
    ...embeddingFields,
  };
}

function toPublicSettings(row) {
  if (!row) {
    return {
      configured: false,
      llm: {
        provider: 'openai_compat',
        baseUrl: '',
        model: '',
        apiKeyConfigured: false,
        visionStatus: 'untested',
        visionCheckedAt: null,
      },
      embedding: {
        enabled: false,
        baseUrl: '',
        model: '',
        groupId: '',
        apiKeyConfigured: false,
        configFingerprint: null,
      },
    };
  }

  return {
    configured: Boolean(row.llm_api_key_enc),
    llm: {
      provider: row.llm_provider || 'openai_compat',
      baseUrl: row.llm_base_url || '',
      model: row.llm_model || '',
      apiKeyConfigured: Boolean(row.llm_api_key_enc),
      visionStatus: row.llm_vision_status || 'untested',
      visionCheckedAt: row.llm_vision_checked_at || null,
    },
    embedding: {
      enabled: Boolean(row.embed_enabled),
      baseUrl: row.embed_base_url || '',
      model: row.embed_model || '',
      groupId: row.embed_group_id || '',
      apiKeyConfigured: Boolean(row.embed_api_key_enc),
      configFingerprint: row.embed_config_fingerprint || null,
    },
  };
}

module.exports = {
  buildCandidate,
  fingerprintEmbeddingConfig,
  normalizeBaseUrl,
  persistedRow,
  settingsError,
  testEmbeddingCandidate,
  testLlmCandidate,
  toPublicSettings,
};
