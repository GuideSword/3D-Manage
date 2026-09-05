-- user_settings: holds user's API key config
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  llm_provider TEXT NOT NULL DEFAULT 'openai_compat',
  llm_base_url TEXT NOT NULL DEFAULT 'https://api.minimax.io/v1',
  llm_api_key_enc TEXT NOT NULL,
  llm_model TEXT NOT NULL DEFAULT 'MiniMax-M3',
  embed_base_url TEXT NOT NULL DEFAULT 'https://api.minimax.io/v1',
  embed_api_key_enc TEXT NOT NULL,
  embed_model TEXT NOT NULL DEFAULT 'embo-01',
  embed_group_id TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

-- model_embeddings (vector stored as JSON TEXT)
CREATE TABLE IF NOT EXISTS model_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  source_version INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_model_emb_asset ON model_embeddings(asset_id);

-- material_embeddings
CREATE TABLE IF NOT EXISTS material_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_material_emb_mat ON material_embeddings(material_id);
