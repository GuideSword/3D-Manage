'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../../backend/node_modules/better-sqlite3');
const { migrateAgentDb } = require('../../backend/db/migrations');

test('version 2 messages gain stable sequence and layered memory tables idempotently', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    INSERT INTO conversations VALUES ('c1', 'u1');
    INSERT INTO messages VALUES ('m2', 'c1', 'assistant', '{"role":"assistant","content":"two"}', '2026-01-01');
    INSERT INTO messages VALUES ('m1', 'c1', 'user', '{"role":"user","content":"one"}', '2026-01-01');
    PRAGMA user_version = 2;
  `);
  migrateAgentDb(db);
  migrateAgentDb(db);

  const messages = db.prepare('SELECT id, sequence, context_state, content FROM messages ORDER BY sequence').all();
  assert.deepEqual(messages.map((row) => row.sequence), [1, 2]);
  assert.equal(messages.every((row) => row.context_state === 'active'), true);
  assert.equal(JSON.parse(messages[0].content).role !== undefined, true);
  for (const table of ['conversation_summaries', 'core_memories', 'archival_passages', 'message_attachments']) {
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table)), true, table);
  }
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  db.close();
});

test('fresh runtime schema can allocate sequenced messages', () => {
  const schema = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../backend/db/schema.sql'), 'utf8');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAgentDb(db);
  db.exec(schema);
  db.prepare(`INSERT INTO conversations(id, user_id, title, intent) VALUES('c', 'u', 't', 'chat')`).run();
  db.prepare(`
    INSERT INTO messages(id, conversation_id, role, content, sequence, context_state)
    VALUES('m', 'c', 'user', '{}', 1, 'active')
  `).run();
  assert.equal(db.prepare('SELECT sequence FROM messages WHERE id = ?').get('m').sequence, 1);
  db.close();
});
