const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { migrateAgentDb } = require('./migrations');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'agent.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Migrate legacy tables before the current schema creates indexes that
    // reference newly introduced columns.
    migrateAgentDb(db);
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  return db;
}

// User settings
function getUserSettings(userId) {
  return getDb().prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
}

function saveUserSettings(userId, settings) {
  getDb().prepare(`
    INSERT INTO user_settings (
      user_id, llm_provider, llm_base_url, llm_api_key_enc, llm_model,
      llm_vision_status, llm_vision_checked_at, llm_config_revision,
      embed_enabled, embed_base_url, embed_api_key_enc, embed_model,
      embed_group_id, embed_config_fingerprint, updated_at
    ) VALUES (
      @user_id, @llm_provider, @llm_base_url, @llm_api_key_enc, @llm_model,
      @llm_vision_status, @llm_vision_checked_at, @llm_config_revision,
      @embed_enabled, @embed_base_url, @embed_api_key_enc, @embed_model,
      @embed_group_id, @embed_config_fingerprint, datetime('now')
    )
    ON CONFLICT(user_id) DO UPDATE SET
      llm_provider = excluded.llm_provider,
      llm_base_url = excluded.llm_base_url,
      llm_api_key_enc = excluded.llm_api_key_enc,
      llm_model = excluded.llm_model,
      llm_vision_status = excluded.llm_vision_status,
      llm_vision_checked_at = excluded.llm_vision_checked_at,
      llm_config_revision = excluded.llm_config_revision,
      embed_enabled = excluded.embed_enabled,
      embed_base_url = excluded.embed_base_url,
      embed_api_key_enc = excluded.embed_api_key_enc,
      embed_model = excluded.embed_model,
      embed_group_id = excluded.embed_group_id,
      embed_config_fingerprint = excluded.embed_config_fingerprint,
      updated_at = datetime('now')
  `).run({ user_id: String(userId), ...settings });
}

function updateUserVisionStatus(userId, status, checkedAt = null) {
  getDb().prepare(`
    UPDATE user_settings
    SET llm_vision_status = ?, llm_vision_checked_at = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(status, checkedAt, String(userId));
}

// Kept temporarily for internal callers while routes move to the independent
// nested configuration contract.
const upsertUserSettings = saveUserSettings;

// Conversations
function listConversations(userId, { limit = 50, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT * FROM conversations
    WHERE user_id = ? AND archived_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}

function getConversation(id, userId) {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(id, userId);
}

function createConversation(conv) {
  getDb().prepare(`
    INSERT INTO conversations (id, user_id, title, intent, created_at, updated_at)
    VALUES (@id, @user_id, @title, @intent, datetime('now'), datetime('now'))
  `).run(conv);
}

function touchConversation(id) {
  getDb().prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

function deleteConversation(id, userId) {
  const result = getDb().prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

// Messages
function getMessages(conversationId) {
  const rows = getDb().prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC
  `).all(conversationId);
  return rows.map((r) => ({ ...r, content: JSON.parse(r.content) }));
}

function addMessage(msg) {
  const db = getDb();
  return db.transaction((value) => {
    const sequence = db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM messages WHERE conversation_id = ?
    `).get(value.conversation_id).next_sequence;
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, sequence, context_state, created_at)
      VALUES (@id, @conversation_id, @role, @content, @sequence, 'active', datetime('now'))
    `).run({ ...value, sequence, content: JSON.stringify(value.content) });
    return sequence;
  })(msg);
}

function addMessageWithAttachments(msg, attachments = []) {
  const db = getDb();
  return db.transaction((value, rows) => {
    const sequence = db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM messages WHERE conversation_id = ?
    `).get(value.conversation_id).next_sequence;
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, sequence, context_state, created_at)
      VALUES (@id, @conversation_id, @role, @content, @sequence, 'active', datetime('now'))
    `).run({ ...value, sequence, content: JSON.stringify(value.content) });
    const insertAttachment = db.prepare(`
      INSERT INTO message_attachments (
        id, user_id, conversation_id, message_id, display_name, mime_type,
        byte_size, sha256, storage_name, description
      ) VALUES (
        @id, @user_id, @conversation_id, @message_id, @display_name, @mime_type,
        @byte_size, @sha256, @storage_name, @description
      )
    `);
    rows.forEach((row) => insertAttachment.run({
      id: row.id,
      user_id: String(row.user_id),
      conversation_id: String(row.conversation_id),
      message_id: String(row.message_id),
      display_name: row.display_name,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      sha256: row.sha256,
      storage_name: row.storage_name,
      description: row.description || '',
    }));
    return sequence;
  })(msg, attachments);
}

function deleteConversationMessagesFromSequence(conversationId, userId, fromSequence) {
  const conversation = getDb().prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(String(conversationId), String(userId));
  if (!conversation) return 0;
  return getDb().prepare('DELETE FROM messages WHERE conversation_id = ? AND sequence >= ?')
    .run(String(conversationId), fromSequence).changes;
}

function getConversationSummary(conversationId, userId) {
  const row = getDb().prepare(`
    SELECT s.* FROM conversation_summaries s
    JOIN conversations c ON c.id = s.conversation_id
    WHERE s.conversation_id = ? AND s.user_id = ? AND c.user_id = ?
  `).get(String(conversationId), String(userId), String(userId));
  return row ? { ...row, summary: JSON.parse(row.summary_json) } : null;
}

function commitConversationSummary({ conversationId, userId, summary, throughSequence, passage }) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO conversation_summaries (
        conversation_id, user_id, summary_json, summarized_through_sequence,
        status, last_error, updated_at
      ) VALUES (?, ?, ?, ?, 'ready', NULL, datetime('now'))
      ON CONFLICT(conversation_id) DO UPDATE SET
        summary_json = excluded.summary_json,
        summarized_through_sequence = excluded.summarized_through_sequence,
        status = 'ready', last_error = NULL, updated_at = datetime('now')
    `).run(String(conversationId), String(userId), JSON.stringify(summary), throughSequence);
    db.prepare(`
      UPDATE messages SET context_state = 'summarized'
      WHERE conversation_id = ? AND sequence <= ?
    `).run(String(conversationId), throughSequence);
    if (passage?.text) {
      db.prepare(`
        INSERT INTO archival_passages (
          id, user_id, conversation_id, text, topic,
          source_sequence_start, source_sequence_end, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        passage.id,
        String(userId),
        String(conversationId),
        passage.text,
        passage.topic || '',
        passage.sourceSequenceStart,
        passage.sourceSequenceEnd,
        passage.startedAt || null,
        passage.endedAt || null,
      );
      const fts = db.prepare("SELECT value FROM agent_capabilities WHERE name = 'fts5_available'").get();
      if (fts?.value === '1') {
        db.prepare('INSERT INTO archival_passages_fts(passage_id, user_id, text, topic) VALUES (?, ?, ?, ?)')
          .run(passage.id, String(userId), passage.text, passage.topic || '');
      }
    }
  })();
}

function listCoreMemories(userId) {
  return getDb().prepare(`
    SELECT id, category, content, source_message_id, updated_at
    FROM core_memories WHERE user_id = ? AND status = 'active'
    ORDER BY updated_at DESC
  `).all(String(userId));
}

function getOwnedUserMessage(messageId, userId) {
  const row = getDb().prepare(`
    SELECT m.* FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ? AND m.role = 'user' AND c.user_id = ?
  `).get(String(messageId), String(userId));
  return row ? { ...row, content: JSON.parse(row.content) } : null;
}

function insertCoreMemory(memory) {
  getDb().prepare(`
    INSERT INTO core_memories (id, user_id, category, content, source_message_id, status)
    VALUES (@id, @user_id, @category, @content, @source_message_id, 'active')
  `).run({ ...memory, user_id: String(memory.user_id) });
}

function listArchivalPassages(userId, limit = 100) {
  return getDb().prepare(`
    SELECT id, conversation_id, text, topic, source_sequence_start,
           source_sequence_end, created_at
    FROM archival_passages WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(String(userId), limit);
}

function upsertArchivalEmbedding({ passageId, userId, configFingerprint, embedding }) {
  getDb().prepare(`
    INSERT INTO archival_embeddings (
      passage_id, user_id, config_fingerprint, embedding, vector_dim, updated_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(passage_id, user_id, config_fingerprint) DO UPDATE SET
      embedding = excluded.embedding,
      vector_dim = excluded.vector_dim,
      updated_at = datetime('now')
  `).run(String(passageId), String(userId), configFingerprint, JSON.stringify(embedding), embedding.length);
}

function listArchivalEmbeddings(userId, configFingerprint, limit = 100) {
  return getDb().prepare(`
    SELECT p.id, p.conversation_id, p.text, p.topic, p.source_sequence_start,
           p.source_sequence_end, e.embedding, e.vector_dim, p.created_at
    FROM archival_embeddings e
    JOIN archival_passages p ON p.id = e.passage_id AND p.user_id = e.user_id
    WHERE e.user_id = ? AND e.config_fingerprint = ?
    ORDER BY p.created_at DESC LIMIT ?
  `).all(String(userId), configFingerprint, limit).map((row) => ({
    ...row,
    embedding: JSON.parse(row.embedding),
  }));
}

function searchArchivalFts(userId, ftsQuery, limit = 5) {
  const capability = getDb().prepare("SELECT value FROM agent_capabilities WHERE name = 'fts5_available'").get();
  if (capability?.value !== '1') return [];
  return getDb().prepare(`
    SELECT p.id, p.conversation_id, p.text, p.topic, p.source_sequence_start,
           p.source_sequence_end, p.created_at, bm25(archival_passages_fts) AS rank
    FROM archival_passages_fts
    JOIN archival_passages p ON p.id = archival_passages_fts.passage_id
    WHERE archival_passages_fts MATCH ? AND archival_passages_fts.user_id = ?
    ORDER BY rank ASC LIMIT ?
  `).all(ftsQuery, String(userId), limit);
}

function getOwnedAttachment(attachmentId, userId, conversationId) {
  return getDb().prepare(`
    SELECT a.* FROM message_attachments a
    JOIN conversations c ON c.id = a.conversation_id
    WHERE a.id = ? AND a.user_id = ? AND a.conversation_id = ? AND c.user_id = ?
  `).get(String(attachmentId), String(userId), String(conversationId), String(userId)) || null;
}

function listConversationAttachments(conversationId, userId) {
  return getDb().prepare(`
    SELECT a.* FROM message_attachments a
    JOIN conversations c ON c.id = a.conversation_id
    WHERE a.conversation_id = ? AND a.user_id = ? AND c.user_id = ?
  `).all(String(conversationId), String(userId), String(userId));
}

function updateAttachmentDescriptions(attachmentIds, description) {
  if (!attachmentIds.length) return 0;
  const placeholders = attachmentIds.map(() => '?').join(',');
  return getDb().prepare(`
    UPDATE message_attachments SET description = ? WHERE id IN (${placeholders})
  `).run(String(description || '').slice(0, 500), ...attachmentIds.map(String)).changes;
}

function queueAttachmentCleanup(attachmentId, storageName, lastError) {
  getDb().prepare(`
    INSERT INTO attachment_cleanup_queue (attachment_id, storage_name, attempts, last_error, updated_at)
    VALUES (?, ?, 1, ?, datetime('now'))
    ON CONFLICT(attachment_id) DO UPDATE SET
      attempts = attachment_cleanup_queue.attempts + 1,
      last_error = excluded.last_error,
      updated_at = datetime('now')
  `).run(String(attachmentId), storageName, String(lastError || '').slice(0, 500));
}

function listAttachmentCleanup(limit = 25) {
  return getDb().prepare('SELECT * FROM attachment_cleanup_queue ORDER BY updated_at ASC LIMIT ?').all(limit);
}

function removeAttachmentCleanup(attachmentId) {
  return getDb().prepare('DELETE FROM attachment_cleanup_queue WHERE attachment_id = ?').run(String(attachmentId)).changes;
}

// Per-user model embeddings
function getModelEmbedding(userId, assetId, configFingerprint) {
  const row = getDb().prepare(`
    SELECT * FROM model_embeddings
    WHERE user_id = ? AND asset_id = ? AND config_fingerprint = ?
  `).get(String(userId), String(assetId), configFingerprint);
  return row ? { ...row, embedding: row.embedding ? JSON.parse(row.embedding) : null } : null;
}

function upsertModelEmbedding(row) {
  getDb().prepare(`
    INSERT INTO model_embeddings (
      user_id, asset_id, config_fingerprint, source_text, source_hash,
      embedding, vector_dim, status, last_error, updated_at
    ) VALUES (
      @user_id, @asset_id, @config_fingerprint, @source_text, @source_hash,
      @embedding, @vector_dim, @status, @last_error, datetime('now')
    )
    ON CONFLICT(user_id, asset_id, config_fingerprint) DO UPDATE SET
      source_text = excluded.source_text,
      source_hash = excluded.source_hash,
      embedding = excluded.embedding,
      vector_dim = excluded.vector_dim,
      status = excluded.status,
      last_error = excluded.last_error,
      updated_at = datetime('now')
  `).run({
    ...row,
    user_id: String(row.user_id),
    asset_id: String(row.asset_id),
    embedding: row.embedding ? JSON.stringify(row.embedding) : null,
  });
}

function getAllModelEmbeddings(userId, configFingerprint) {
  const rows = getDb().prepare(`
    SELECT asset_id, source_text, embedding, vector_dim
    FROM model_embeddings
    WHERE user_id = ? AND config_fingerprint = ? AND status = 'ready' AND embedding IS NOT NULL
  `).all(String(userId), configFingerprint);
  return rows.map((row) => ({ ...row, embedding: JSON.parse(row.embedding) }));
}

function deleteStaleModelEmbeddings(userId, configFingerprint, assetIds) {
  const db = getDb();
  if (!assetIds.length) {
    return db.prepare('DELETE FROM model_embeddings WHERE user_id = ? AND config_fingerprint = ?')
      .run(String(userId), configFingerprint).changes;
  }
  const placeholders = assetIds.map(() => '?').join(',');
  return db.prepare(`
    DELETE FROM model_embeddings
    WHERE user_id = ? AND config_fingerprint = ? AND asset_id NOT IN (${placeholders})
  `).run(String(userId), configFingerprint, ...assetIds.map(String)).changes;
}

function deleteAssetModelEmbeddings(assetId) {
  return getDb().prepare('DELETE FROM model_embeddings WHERE asset_id = ?').run(String(assetId)).changes;
}

function setModelIndexState(state) {
  getDb().prepare(`
    INSERT INTO model_embedding_index_state (
      user_id, config_fingerprint, status, total_count, ready_count,
      failed_count, last_error, started_at, updated_at
    ) VALUES (
      @user_id, @config_fingerprint, @status, @total_count, @ready_count,
      @failed_count, @last_error,
      CASE WHEN @status = 'running' THEN datetime('now') ELSE NULL END,
      datetime('now')
    )
    ON CONFLICT(user_id, config_fingerprint) DO UPDATE SET
      status = excluded.status,
      total_count = excluded.total_count,
      ready_count = excluded.ready_count,
      failed_count = excluded.failed_count,
      last_error = excluded.last_error,
      started_at = CASE WHEN excluded.status = 'running' THEN COALESCE(model_embedding_index_state.started_at, datetime('now')) ELSE model_embedding_index_state.started_at END,
      updated_at = datetime('now')
  `).run({ ...state, user_id: String(state.user_id) });
}

function getModelIndexState(userId, configFingerprint) {
  if (!configFingerprint) return null;
  return getDb().prepare(`
    SELECT status, total_count, ready_count, failed_count, last_error, started_at, updated_at
    FROM model_embedding_index_state
    WHERE user_id = ? AND config_fingerprint = ?
  `).get(String(userId), configFingerprint) || null;
}

function getAllMaterialEmbeddings() {
  const rows = getDb().prepare('SELECT material_id, source_text, embedding FROM material_embeddings').all();
  return rows.map((r) => ({ ...r, embedding: JSON.parse(r.embedding) }));
}

function upsertMaterialEmbedding(materialId, sourceText, embedding) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM material_embeddings WHERE material_id = ?').get(materialId);
  if (existing) {
    db.prepare(`
      UPDATE material_embeddings SET source_text = ?, embedding = ?, updated_at = datetime('now')
      WHERE material_id = ?
    `).run(sourceText, JSON.stringify(embedding), materialId);
  } else {
    db.prepare(`
      INSERT INTO material_embeddings (material_id, source_text, embedding)
      VALUES (?, ?, ?)
    `).run(materialId, sourceText, JSON.stringify(embedding));
  }
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  getDb,
  closeDb,
  // settings
  getUserSettings, saveUserSettings, updateUserVisionStatus, upsertUserSettings,
  // conversations
  listConversations, getConversation, createConversation, touchConversation, deleteConversation,
  // messages
  getMessages, addMessage, addMessageWithAttachments, deleteConversationMessagesFromSequence,
  getConversationSummary, commitConversationSummary,
  listCoreMemories, getOwnedUserMessage, insertCoreMemory, listArchivalPassages,
  upsertArchivalEmbedding, listArchivalEmbeddings, searchArchivalFts,
  getOwnedAttachment, listConversationAttachments, updateAttachmentDescriptions,
  queueAttachmentCleanup, listAttachmentCleanup, removeAttachmentCleanup,
  // embeddings
  getModelEmbedding, upsertModelEmbedding, getAllModelEmbeddings,
  deleteStaleModelEmbeddings, deleteAssetModelEmbeddings,
  setModelIndexState, getModelIndexState,
  upsertMaterialEmbedding, getAllMaterialEmbeddings,
};
