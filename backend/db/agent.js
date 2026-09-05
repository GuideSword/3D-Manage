const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  return db;
}

// User settings
function getUserSettings(userId) {
  return getDb().prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
}

function upsertUserSettings(userId, settings) {
  const existing = getUserSettings(userId);
  if (existing) {
    getDb().prepare(`
      UPDATE user_settings SET
        llm_provider = @llm_provider, llm_base_url = @llm_base_url,
        llm_api_key_enc = @llm_api_key_enc, llm_model = @llm_model,
        embed_base_url = @embed_base_url, embed_api_key_enc = @embed_api_key_enc,
        embed_model = @embed_model, embed_group_id = @embed_group_id,
        updated_at = datetime('now')
      WHERE user_id = @user_id
    `).run({ user_id: userId, ...settings });
  } else {
    getDb().prepare(`
      INSERT INTO user_settings
        (user_id, llm_provider, llm_base_url, llm_api_key_enc, llm_model,
         embed_base_url, embed_api_key_enc, embed_model, embed_group_id)
      VALUES
        (@user_id, @llm_provider, @llm_base_url, @llm_api_key_enc, @llm_model,
         @embed_base_url, @embed_api_key_enc, @embed_model, @embed_group_id)
    `).run({ user_id: userId, ...settings });
  }
}

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
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(conversationId);
  return rows.map((r) => ({ ...r, content: JSON.parse(r.content) }));
}

function addMessage(msg) {
  getDb().prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at)
    VALUES (@id, @conversation_id, @role, @content, datetime('now'))
  `).run({ ...msg, content: JSON.stringify(msg.content) });
}

// Embeddings
function upsertModelEmbedding(assetId, sourceText, embedding, sourceVersion = null) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM model_embeddings WHERE asset_id = ?').get(assetId);
  if (existing) {
    db.prepare(`
      UPDATE model_embeddings SET source_text = ?, embedding = ?, source_version = ?, updated_at = datetime('now')
      WHERE asset_id = ?
    `).run(sourceText, JSON.stringify(embedding), sourceVersion, assetId);
  } else {
    db.prepare(`
      INSERT INTO model_embeddings (asset_id, source_text, embedding, source_version)
      VALUES (?, ?, ?, ?)
    `).run(assetId, sourceText, JSON.stringify(embedding), sourceVersion);
  }
}

function getAllModelEmbeddings() {
  const rows = getDb().prepare('SELECT asset_id, source_text, embedding FROM model_embeddings').all();
  return rows.map((r) => ({ ...r, embedding: JSON.parse(r.embedding) }));
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
  getUserSettings, upsertUserSettings,
  // conversations
  listConversations, getConversation, createConversation, touchConversation, deleteConversation,
  // messages
  getMessages, addMessage,
  // embeddings
  upsertModelEmbedding, getAllModelEmbeddings,
  upsertMaterialEmbedding, getAllMaterialEmbeddings,
};
