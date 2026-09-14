'use strict';

const sqliteDb = require('../db/agent');
const secrets = require('../utils/crypto');
const embedProvider = require('./providers/embed');
const { searchArchiveKeyword } = require('./memoryService');

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const denom = Math.sqrt(aa) * Math.sqrt(bb);
  return denom ? dot / denom : -1;
}

function publicPassage(row, score, strategy) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    text: row.text,
    topic: row.topic,
    sourceSequenceStart: row.source_sequence_start,
    sourceSequenceEnd: row.source_sequence_end,
    score,
    strategy,
  };
}

function ftsQuery(query) {
  return String(query || '')
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

async function searchArchive({ userId, query, embeddingConfig, limit = 5, db = sqliteDb, embed = embedProvider.embed }) {
  if (embeddingConfig?.apiKey && embeddingConfig?.configFingerprint) {
    try {
      const indexed = db.listArchivalEmbeddings(userId, embeddingConfig.configFingerprint, 100);
      if (indexed.length) {
        const vectors = await embed({ ...embeddingConfig, texts: [query], type: 'query' });
        const queryVector = vectors?.[0];
        const semantic = indexed
        .filter((row) => row.vector_dim === queryVector?.length)
        .map((row) => publicPassage(row, cosine(queryVector, row.embedding), 'embedding'))
        .filter((row) => row.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
        if (semantic.length) return semantic;
      }
    } catch (_) {
      // Text fallbacks are intentionally non-blocking.
    }
  }

  try {
    const queryText = ftsQuery(query);
    if (queryText) {
      const fts = db.searchArchivalFts(userId, queryText, limit)
        .map((row) => publicPassage(row, 1 / (1 + Math.max(0, Number(row.rank) || 0)), 'fts5'));
      if (fts.length) return fts;
    }
  } catch (_) {
    // Keyword fallback works even when SQLite lacks FTS5.
  }
  return searchArchiveKeyword(userId, query, limit, db);
}

function queueArchiveEmbedding({ userId, passage, db = sqliteDb, embed = embedProvider.embed }) {
  const settings = db.getUserSettings(userId);
  if (!settings?.embed_enabled || !settings.embed_api_key_enc || !settings.embed_config_fingerprint) return;
  let apiKey;
  try { apiKey = secrets.decrypt(settings.embed_api_key_enc); } catch (_) { return; }
  Promise.resolve(embed({
    baseUrl: settings.embed_base_url,
    apiKey,
    groupId: settings.embed_group_id,
    model: settings.embed_model,
    texts: [passage.text],
    type: 'db',
  })).then((vectors) => {
    const vector = vectors?.[0];
    if (Array.isArray(vector) && vector.length) {
      db.upsertArchivalEmbedding({
        passageId: passage.id,
        userId,
        configFingerprint: settings.embed_config_fingerprint,
        embedding: vector,
      });
    }
  }).catch(() => {});
}

function embeddingConfigForUser(userId, db = sqliteDb) {
  const settings = db.getUserSettings(userId);
  if (!settings?.embed_enabled || !settings.embed_api_key_enc) return null;
  try {
    return {
      baseUrl: settings.embed_base_url,
      apiKey: secrets.decrypt(settings.embed_api_key_enc),
      groupId: settings.embed_group_id,
      model: settings.embed_model,
      configFingerprint: settings.embed_config_fingerprint,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { embeddingConfigForUser, ftsQuery, queueArchiveEmbedding, searchArchive };
