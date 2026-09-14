'use strict';

const crypto = require('crypto');
const sqliteDb = require('../db/agent');
const secrets = require('../utils/crypto');
const embedProvider = require('./providers/embed');
const { fingerprintEmbeddingConfig } = require('./settingsService');
const { withData } = require('../utils/store');

const jobs = new Map();

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function buildModelSource(model = {}) {
  return [
    `名称：${clean(model.name)}`,
    `描述：${clean(model.description)}`,
    `标签：${Array.isArray(model.tags) ? model.tags.map(clean).filter(Boolean).join('、') : clean(model.tags)}`,
    `来源：${clean(model.source)}`,
    `版本：${clean(model.currentVersion || model.current_version)}`,
  ].join('\n');
}

function hashSource(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

async function reconcileUserModelIndex({ userId, config, models = [], embed, db = sqliteDb }) {
  const normalizedUserId = String(userId);
  const fingerprint = config.configFingerprint || fingerprintEmbeddingConfig(config);
  const assetIds = models.map((model) => String(model.id));
  let ready = 0;
  let failed = 0;
  let lastError = null;

  db.setModelIndexState({
    user_id: normalizedUserId,
    config_fingerprint: fingerprint,
    status: 'running',
    total_count: models.length,
    ready_count: 0,
    failed_count: 0,
    last_error: null,
  });

  for (const model of models) {
    const assetId = String(model.id);
    const sourceText = buildModelSource(model);
    const sourceHash = hashSource(sourceText);
    const existing = db.getModelEmbedding(normalizedUserId, assetId, fingerprint);
    if (existing?.status === 'ready' && existing.source_hash === sourceHash) {
      ready += 1;
    } else {
      db.upsertModelEmbedding({
        user_id: normalizedUserId,
        asset_id: assetId,
        config_fingerprint: fingerprint,
        source_text: sourceText,
        source_hash: sourceHash,
        embedding: null,
        vector_dim: null,
        status: 'pending',
        last_error: null,
      });
      try {
        const vectors = await embed({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          groupId: config.groupId,
          model: config.model,
          texts: [sourceText],
          type: 'db',
        });
        const vector = vectors?.[0];
        if (!Array.isArray(vector) || vector.length === 0) throw new Error('Embedding provider returned an empty vector');
        db.upsertModelEmbedding({
          user_id: normalizedUserId,
          asset_id: assetId,
          config_fingerprint: fingerprint,
          source_text: sourceText,
          source_hash: sourceHash,
          embedding: vector,
          vector_dim: vector.length,
          status: 'ready',
          last_error: null,
        });
        ready += 1;
      } catch (error) {
        failed += 1;
        lastError = error?.message || String(error);
        db.upsertModelEmbedding({
          user_id: normalizedUserId,
          asset_id: assetId,
          config_fingerprint: fingerprint,
          source_text: sourceText,
          source_hash: sourceHash,
          embedding: null,
          vector_dim: null,
          status: 'error',
          last_error: lastError,
        });
      }
    }

    db.setModelIndexState({
      user_id: normalizedUserId,
      config_fingerprint: fingerprint,
      status: failed ? 'partial' : 'running',
      total_count: models.length,
      ready_count: ready,
      failed_count: failed,
      last_error: lastError,
    });
  }

  db.deleteStaleModelEmbeddings(normalizedUserId, fingerprint, assetIds);
  const status = failed ? (ready ? 'partial' : 'error') : 'ready';
  const finalState = {
    user_id: normalizedUserId,
    config_fingerprint: fingerprint,
    status,
    total_count: models.length,
    ready_count: ready,
    failed_count: failed,
    last_error: lastError,
  };
  db.setModelIndexState(finalState);
  return finalState;
}

function embeddingConfigFromSettings(settings) {
  if (!settings?.embed_enabled || !settings.embed_api_key_enc) return null;
  const config = {
    baseUrl: settings.embed_base_url,
    apiKey: secrets.decrypt(settings.embed_api_key_enc),
    model: settings.embed_model,
    groupId: settings.embed_group_id,
    configFingerprint: settings.embed_config_fingerprint,
  };
  config.configFingerprint = config.configFingerprint || fingerprintEmbeddingConfig(config);
  return config;
}

function queueUserModelReconcile(userId) {
  const settings = sqliteDb.getUserSettings(userId);
  let config;
  try {
    config = embeddingConfigFromSettings(settings);
  } catch (error) {
    console.warn(`[model-index] embedding configuration is unavailable: ${error?.message || String(error)}`);
    return Promise.resolve({ status: 'failed', error: 'EMBEDDING_CONFIG_UNAVAILABLE' });
  }
  if (!config) return Promise.resolve(null);
  const jobKey = `${String(userId)}:${config.configFingerprint}`;
  if (jobs.has(jobKey)) return jobs.get(jobKey);

  const job = withData((data) => data.models || [], { write: false })
    .then((models) => reconcileUserModelIndex({
      userId,
      config,
      models,
      embed: embedProvider.embed,
    }))
    .catch((error) => {
      console.warn('[agent-index] model reconciliation failed:', error?.message || String(error));
      return null;
    })
    .finally(() => jobs.delete(jobKey));
  jobs.set(jobKey, job);
  return job;
}

function queueUserAssetIndex({ userId }) {
  return queueUserModelReconcile(userId);
}

function deleteAssetIndexes(assetId) {
  return sqliteDb.deleteAssetModelEmbeddings(String(assetId));
}

module.exports = {
  buildModelSource,
  deleteAssetIndexes,
  embeddingConfigFromSettings,
  hashSource,
  queueUserAssetIndex,
  queueUserModelReconcile,
  reconcileUserModelIndex,
};
