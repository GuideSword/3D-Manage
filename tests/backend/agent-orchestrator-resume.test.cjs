'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manage3d-orchestrator-resume-'));
process.env.DATA_DIR = dataDir;
const db = require('../../backend/db/agent');
const originalGetUserSettings = db.getUserSettings;
db.getUserSettings = () => ({ llm_api_key_enc: 'fixture', llm_base_url: 'http://fixture', llm_model: 'fixture', embed_enabled: 0 });

const inject = (relative, exports) => {
  const filename = require.resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
inject('../../backend/utils/crypto', { decrypt: () => 'fixture-key' });
inject('../../backend/agent/tools', { getToolsForContext: () => [], dispatchTool: async () => ({}) });
inject('../../backend/agent/providers/llm', {
  createLLMClient: () => ({}),
  streamChatCompletion: async () => (async function* () {
    yield { choices: [{ delta: { content: '已恢复回答' }, finish_reason: 'stop' }] };
  })(),
});
inject('../../backend/agent/memoryService', {
  prepareMemoryLayers: async () => ({ coreMemory: '', summary: '', archiveMatches: [], recentRounds: [] }),
});
const { runConversation } = require('../../backend/agent/orchestrator');

test.after(() => {
  db.getUserSettings = originalGetUserSettings;
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('disconnect preserves accepted text and explicit retry produces one effective user turn', async () => {
  const events = [];
  const abortController = new AbortController();
  await runConversation({ userId: 'owner', role: 'owner', userMessage: '查一下订单',
    signal: abortController.signal,
    onEvent: (name, value) => {
      events.push({ name, value });
      if (name === 'accepted') abortController.abort();
    },
  });
  const accepted = events.find(event => event.name === 'accepted')?.value;
  assert.ok(accepted?.conversationId && accepted?.messageId);
  let rows = db.getMessages(accepted.conversationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content.turn_state, 'interrupted');

  const retryEvents = [];
  await runConversation({ userId: 'owner', role: 'owner', conversationId: accepted.conversationId,
    retryMessageId: accepted.messageId, userMessage: '查一下订单', signal: new AbortController().signal,
    onEvent: (name, value) => retryEvents.push({ name, value }),
  });
  rows = db.getMessages(accepted.conversationId);
  assert.deepEqual(rows.map(row => row.role), ['user', 'assistant']);
  assert.equal(rows[0].id, accepted.messageId);
  assert.equal(rows[0].content.turn_state, 'complete');
  assert.equal(retryEvents.find(event => event.name === 'accepted')?.value.messageId, accepted.messageId);
  assert.equal(retryEvents.at(-1).name, 'done');
});
