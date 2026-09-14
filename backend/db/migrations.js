'use strict';

const USER_SETTINGS_SQL = `
  CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY,
    llm_provider TEXT NOT NULL DEFAULT 'openai_compat',
    llm_base_url TEXT NOT NULL,
    llm_api_key_enc TEXT NOT NULL,
    llm_model TEXT NOT NULL,
    llm_vision_status TEXT NOT NULL DEFAULT 'untested'
      CHECK(llm_vision_status IN ('untested','vision','text_only','error')),
    llm_vision_checked_at TEXT,
    llm_config_revision INTEGER NOT NULL DEFAULT 1,
    embed_enabled INTEGER NOT NULL DEFAULT 0 CHECK(embed_enabled IN (0,1)),
    embed_base_url TEXT,
    embed_api_key_enc TEXT,
    embed_model TEXT,
    embed_group_id TEXT,
    embed_config_fingerprint TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const MODEL_EMBEDDINGS_SQL = `
  CREATE TABLE model_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL,
    source_text TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    embedding TEXT,
    vector_dim INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','ready','error')),
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, asset_id, config_fingerprint)
  )
`;

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columns(db, table) {
  if (!tableExists(db, table)) return new Set();
  return new Set(db.pragma(`table_info(${table})`).map((column) => column.name));
}

function migrateSettings(db) {
  const current = columns(db, 'user_settings');
  const alreadyCurrent = [
    'llm_vision_status',
    'llm_vision_checked_at',
    'llm_config_revision',
    'embed_enabled',
    'embed_config_fingerprint',
  ].every((name) => current.has(name));

  if (alreadyCurrent) return;
  if (!current.size) {
    db.exec(USER_SETTINGS_SQL);
    return;
  }

  db.exec('ALTER TABLE user_settings RENAME TO user_settings_legacy');
  db.exec(USER_SETTINGS_SQL);
  db.exec(`
    INSERT INTO user_settings (
      user_id, llm_provider, llm_base_url, llm_api_key_enc, llm_model,
      llm_vision_status, llm_config_revision, embed_enabled,
      embed_base_url, embed_api_key_enc, embed_model, embed_group_id, updated_at
    )
    SELECT
      CAST(user_id AS TEXT), llm_provider, llm_base_url, llm_api_key_enc, llm_model,
      'untested', 1,
      CASE WHEN embed_api_key_enc IS NOT NULL AND embed_api_key_enc <> '' THEN 1 ELSE 0 END,
      embed_base_url, embed_api_key_enc, embed_model, embed_group_id, updated_at
    FROM user_settings_legacy
  `);
  db.exec('DROP TABLE user_settings_legacy');
}

function migrateModelEmbeddings(db) {
  const current = columns(db, 'model_embeddings');
  const alreadyCurrent = ['user_id', 'config_fingerprint', 'source_hash', 'status']
    .every((name) => current.has(name));

  if (!alreadyCurrent && current.size) {
    // Legacy vectors cannot be assigned to a user/configuration safely. They are
    // intentionally rebuilt by the restartable indexer after migration.
    db.exec('DROP TABLE model_embeddings');
  }
  if (!alreadyCurrent) db.exec(MODEL_EMBEDDINGS_SQL);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_model_emb_lookup
      ON model_embeddings(user_id, config_fingerprint, status);
    CREATE INDEX IF NOT EXISTS idx_model_emb_asset
      ON model_embeddings(asset_id);
    CREATE TABLE IF NOT EXISTS model_embedding_index_state (
      user_id TEXT NOT NULL,
      config_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','ready','partial','error')),
      total_count INTEGER NOT NULL DEFAULT 0,
      ready_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id, config_fingerprint)
    )
  `);
}

function migrateMemory(db) {
  const messageColumns = columns(db, 'messages');
  if (messageColumns.size) {
    if (!messageColumns.has('sequence')) db.exec('ALTER TABLE messages ADD COLUMN sequence INTEGER');
    if (!messageColumns.has('context_state')) {
      db.exec("ALTER TABLE messages ADD COLUMN context_state TEXT NOT NULL DEFAULT 'active'");
    }
    const conversations = db.prepare('SELECT DISTINCT conversation_id FROM messages').all();
    const update = db.prepare('UPDATE messages SET sequence = ? WHERE rowid = ?');
    for (const conversation of conversations) {
      const rows = db.prepare(`
        SELECT rowid FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC, rowid ASC
      `).all(conversation.conversation_id);
      rows.forEach((row, index) => update.run(index + 1, row.rowid));
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_conv_sequence ON messages(conversation_id, sequence)');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      summary_version INTEGER NOT NULL DEFAULT 1,
      summarized_through_sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('ready','error')),
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS core_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('user_preferences','business_constraints','active_goals')),
      content TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','deleted')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_core_memory_user ON core_memories(user_id, status);
    CREATE TABLE IF NOT EXISTS archival_passages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      text TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      source_sequence_start INTEGER NOT NULL,
      source_sequence_end INTEGER NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_archive_user ON archival_passages(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS archival_embeddings (
      passage_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      config_fingerprint TEXT NOT NULL,
      embedding TEXT NOT NULL,
      vector_dim INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(passage_id, user_id, config_fingerprint),
      FOREIGN KEY(passage_id) REFERENCES archival_passages(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','missing','delete_pending')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_attachment_owner ON message_attachments(user_id, conversation_id);
    CREATE TABLE IF NOT EXISTS attachment_cleanup_queue (
      attachment_id TEXT PRIMARY KEY,
      storage_name TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_capabilities (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS archival_passages_fts USING fts5(
      passage_id UNINDEXED, user_id UNINDEXED, text, topic
    )`);
    db.prepare(`
      INSERT INTO agent_capabilities(name, value, updated_at) VALUES('fts5_available', '1', datetime('now'))
      ON CONFLICT(name) DO UPDATE SET value = '1', updated_at = datetime('now')
    `).run();
  } catch (error) {
    if (!/fts5|no such module/i.test(error?.message || '')) throw error;
    db.prepare(`
      INSERT INTO agent_capabilities(name, value, updated_at) VALUES('fts5_available', '0', datetime('now'))
      ON CONFLICT(name) DO UPDATE SET value = '0', updated_at = datetime('now')
    `).run();
  }
}

function migrateAgentDb(db) {
  const migrate = db.transaction(() => {
    const version = db.pragma('user_version', { simple: true });
    if (version < 1) {
      migrateSettings(db);
      db.pragma('user_version = 1');
    }
    if (version < 2) {
      migrateModelEmbeddings(db);
      db.pragma('user_version = 2');
    }
    if (version < 3) {
      migrateMemory(db);
      db.pragma('user_version = 3');
    }
  });
  migrate();
}

module.exports = {
  migrateAgentDb,
  MODEL_EMBEDDINGS_SQL,
  USER_SETTINGS_SQL,
};
