'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../../backend/node_modules/better-sqlite3');
const { migrateAgentDb } = require('../../backend/db/migrations');
const { probeVision } = require('../../backend/agent/visionProbe');

const {
  buildCandidate,
  toPublicSettings,
  fingerprintEmbeddingConfig,
} = require('../../backend/agent/settingsService');
const { ensureStoredVisionCapability } = require('../../backend/agent/visionCapabilityService');
const storedSecrets = require('../../backend/utils/crypto');

const secrets = {
  decrypt(value) {
    return value === 'enc-old-llm' ? 'old-llm-key' : value === 'enc-old-embed' ? 'old-embed-key' : '';
  },
};

test('LLM-only configuration is valid and embedding remains disabled', () => {
  const candidate = buildCandidate({
    existing: null,
    input: {
      llm: { provider: 'openai_compat', baseUrl: 'https://llm.example/v1/', model: 'vision-model', apiKey: 'new-key' },
      embedding: { enabled: false },
    },
    secrets,
  });
  assert.equal(candidate.llm.baseUrl, 'https://llm.example/v1');
  assert.equal(candidate.llm.apiKey, 'new-key');
  assert.deepEqual(candidate.embedding, { enabled: false });
});

test('blank replacement keys preserve existing secrets without exposing them publicly', () => {
  const existing = {
    user_id: '7',
    llm_provider: 'openai_compat',
    llm_base_url: 'https://old.example/v1',
    llm_api_key_enc: 'enc-old-llm',
    llm_model: 'old-model',
    llm_vision_status: 'vision',
    llm_vision_checked_at: '2026-09-13T00:00:00.000Z',
    embed_enabled: 1,
    embed_base_url: 'https://embed.example/v1',
    embed_api_key_enc: 'enc-old-embed',
    embed_model: 'embo-01',
    embed_group_id: 'group-7',
    embed_config_fingerprint: 'fp',
  };
  const candidate = buildCandidate({
    existing,
    input: {
      llm: { provider: 'openai_compat', baseUrl: existing.llm_base_url, model: existing.llm_model, apiKey: '' },
      embedding: { enabled: true, baseUrl: existing.embed_base_url, model: existing.embed_model, groupId: existing.embed_group_id, apiKey: '' },
    },
    secrets,
  });
  assert.equal(candidate.llm.apiKey, 'old-llm-key');
  assert.equal(candidate.embedding.apiKey, 'old-embed-key');

  const publicSettings = toPublicSettings(existing);
  const serialized = JSON.stringify(publicSettings);
  assert.equal(publicSettings.llm.apiKeyConfigured, true);
  assert.equal(publicSettings.embedding.apiKeyConfigured, true);
  assert.equal(serialized.includes('old-llm-key'), false);
  assert.equal(serialized.includes('enc-old-llm'), false);
  assert.equal(serialized.includes('api_key_enc'), false);
});

test('partial embedding configuration is rejected while fully disabled embedding is allowed', () => {
  assert.throws(() => buildCandidate({
    existing: null,
    input: {
      llm: { baseUrl: 'https://llm.example/v1', model: 'chat', apiKey: 'key' },
      embedding: { enabled: true, baseUrl: 'https://embed.example/v1', model: 'embo-01', apiKey: 'embed-key' },
    },
    secrets,
  }), { code: 'EMBEDDING_CONFIG_INCOMPLETE' });
});

test('embedding fingerprint is stable and never depends on API key', () => {
  const first = fingerprintEmbeddingConfig({
    baseUrl: 'https://embed.example/v1/', model: 'embo-01', groupId: 'g', apiKey: 'one',
  });
  const second = fingerprintEmbeddingConfig({
    baseUrl: 'https://embed.example/v1', model: 'embo-01', groupId: 'g', apiKey: 'two',
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('legacy settings migrate without losing secrets and embedding becomes nullable', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_settings (
      user_id INTEGER PRIMARY KEY,
      llm_provider TEXT NOT NULL,
      llm_base_url TEXT NOT NULL,
      llm_api_key_enc TEXT NOT NULL,
      llm_model TEXT NOT NULL,
      embed_base_url TEXT NOT NULL,
      embed_api_key_enc TEXT NOT NULL,
      embed_model TEXT NOT NULL,
      embed_group_id TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO user_settings VALUES (
      7, 'openai_compat', 'https://llm.example/v1', 'enc-llm', 'chat',
      'https://embed.example/v1', 'enc-embed', 'embo-01', 'g-7', datetime('now')
    );
    CREATE TABLE model_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      source_text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      source_version INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrateAgentDb(db);
  migrateAgentDb(db);

  const migrated = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get('7');
  assert.equal(migrated.llm_api_key_enc, 'enc-llm');
  assert.equal(migrated.embed_api_key_enc, 'enc-embed');
  assert.equal(migrated.embed_enabled, 1);
  assert.equal(migrated.llm_vision_status, 'untested');
  assert.equal(db.pragma('user_version', { simple: true }), 3);

  db.prepare(`
    INSERT INTO user_settings (
      user_id, llm_provider, llm_base_url, llm_api_key_enc, llm_model, embed_enabled
    ) VALUES (?, ?, ?, ?, ?, 0)
  `).run('llm-only', 'openai_compat', 'https://llm-only.example/v1', 'enc-only', 'chat');
  const llmOnly = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get('llm-only');
  assert.equal(llmOnly.embed_base_url, null);
  assert.equal(llmOnly.embed_api_key_enc, null);
  assert.equal(llmOnly.embed_model, null);
  db.close();
});

test('vision probe recognizes a correct visual answer', async () => {
  const seen = [];
  const result = await probeVision({
    model: 'vision-model',
    complete: async (request) => {
      seen.push(request);
      return { choices: [{ message: { content: '4827' } }] };
    },
  });
  assert.equal(result.status, 'vision');
  assert.match(seen[0].messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('vision probe distinguishes text-only rejection from transient errors', async () => {
  const rejected = new Error('image input is unsupported for this model');
  rejected.status = 400;
  const textOnly = await probeVision({
    model: 'text-model',
    complete: async () => { throw rejected; },
  });
  assert.deepEqual(
    { status: textOnly.status, reasonCode: textOnly.reasonCode },
    { status: 'text_only', reasonCode: 'IMAGE_INPUT_REJECTED' },
  );

  const timeout = new Error('timed out');
  timeout.name = 'AbortError';
  const transient = await probeVision({
    model: 'slow-model',
    complete: async () => { throw timeout; },
  });
  assert.deepEqual(
    { status: transient.status, reasonCode: transient.reasonCode },
    { status: 'error', reasonCode: 'VISION_PROBE_TIMEOUT' },
  );
});

test('first image request lazily probes an untested stored model and persists the result', async () => {
  const updates = [];
  let probes = 0;
  const result = await ensureStoredVisionCapability({
    userId: '7',
    settings: {
      llm_base_url: 'https://llm.example/v1',
      llm_api_key_enc: 'encrypted-key',
      llm_model: 'vision-model',
      llm_vision_status: 'untested',
      llm_config_revision: 3,
    },
  }, {
    decrypt: () => 'plain-key',
    createClient: () => ({ chat: { completions: { create: async () => ({}) } } }),
    probeVision: async () => {
      probes += 1;
      return { status: 'vision', checkedAt: '2026-09-14T01:00:00.000Z' };
    },
    updateVisionStatus: (...args) => updates.push(args),
  });

  assert.equal(result.status, 'vision');
  assert.equal(probes, 1);
  assert.deepEqual(updates, [['7', 'vision', '2026-09-14T01:00:00.000Z']]);
});

test('known vision status is reused without another provider probe', async () => {
  const result = await ensureStoredVisionCapability({
    userId: '7',
    settings: { llm_vision_status: 'text_only' },
  }, {
    probeVision: async () => { throw new Error('must not run'); },
    updateVisionStatus: () => { throw new Error('must not update'); },
  });
  assert.equal(result.status, 'text_only');
});

test('development encryption can read keys saved before generated dev secrets existed', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.AGENT_KEY_ENC_SECRET;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.AGENT_KEY_ENC_SECRET;
    const legacyCiphertext = storedSecrets.encrypt('legacy-development-key');
    process.env.AGENT_KEY_ENC_SECRET = 'new-generated-development-secret-value';
    assert.equal(storedSecrets.decrypt(legacyCiphertext), 'legacy-development-key');
  } finally {
    if (previousNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSecret == null) delete process.env.AGENT_KEY_ENC_SECRET;
    else process.env.AGENT_KEY_ENC_SECRET = previousSecret;
  }
});
