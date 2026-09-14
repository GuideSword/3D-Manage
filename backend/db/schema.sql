-- user_settings: holds user's API key config
CREATE TABLE IF NOT EXISTS user_settings (
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
);

-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT,
  intent TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

-- messages (full message object as JSON, preserves tool_calls and reasoning_details)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  context_state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_conv_sequence ON messages(conversation_id, sequence);

-- model_embeddings (vector stored as JSON TEXT)
CREATE TABLE IF NOT EXISTS model_embeddings (
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
);
CREATE INDEX IF NOT EXISTS idx_model_emb_lookup
  ON model_embeddings(user_id, config_fingerprint, status);
CREATE INDEX IF NOT EXISTS idx_model_emb_asset ON model_embeddings(asset_id);

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
);

-- material_embeddings
CREATE TABLE IF NOT EXISTS material_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_material_emb_mat ON material_embeddings(material_id);

-- Letta-style layered memory and private image references
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
