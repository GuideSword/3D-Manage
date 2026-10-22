'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manage3d-chat-resume-'));
process.env.DATA_DIR = tempDir;
const db = require('../../backend/db/agent');
const { normalizeChatRequest } = require('../../backend/agent/chatRequest');

test.after(() => {
  db.closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('an interrupted accepted user message survives while incomplete assistant output is removed', () => {
  db.createConversation({ id: 'resume-c1', user_id: 'user-a', title: '验收', intent: 'chat' });
  const sequence = db.addMessage({ id: 'resume-u1', conversation_id: 'resume-c1', role: 'user',
    content: { role: 'user', content: '上次订单怎么办', turn_state: 'pending' } });
  db.addMessage({ id: 'resume-a1', conversation_id: 'resume-c1', role: 'assistant',
    content: { role: 'assistant', content: '尚未完整' } });
  assert.equal(db.markUserMessageTurnState('resume-c1', 'user-a', 'resume-u1', 'interrupted'), true);
  assert.equal(db.deleteConversationMessagesFromSequence('resume-c1', 'user-a', sequence + 1), 1);
  const messages = db.getMessages('resume-c1');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content.turn_state, 'interrupted');
  assert.equal(db.getRetryableUserMessage('resume-c1', 'user-a', 'resume-u1')?.id, 'resume-u1');
  assert.equal(db.getRetryableUserMessage('resume-c1', 'user-b', 'resume-u1'), null);
});

test('completed or non-last user messages cannot be reused for a retry', () => {
  db.markUserMessageTurnState('resume-c1', 'user-a', 'resume-u1', 'complete');
  assert.equal(db.getRetryableUserMessage('resume-c1', 'user-a', 'resume-u1'), null);
  db.addMessage({ id: 'resume-u2', conversation_id: 'resume-c1', role: 'user',
    content: { role: 'user', content: '下一句', turn_state: 'interrupted' } });
  assert.equal(db.getRetryableUserMessage('resume-c1', 'user-a', 'resume-u1'), null);
  assert.equal(db.getRetryableUserMessage('resume-c1', 'user-a', 'resume-u2')?.id, 'resume-u2');
});

test('retry requires an owned conversation and cannot silently include images', () => {
  assert.equal(normalizeChatRequest({ message: 'abc', conversationId: 'c1', retryMessageId: null }).retryMessageId, undefined);
  assert.throws(() => normalizeChatRequest({ message: 'abc', retryMessageId: 'm1' }), /会话/);
  assert.throws(() => normalizeChatRequest({ message: 'abc', conversationId: 'c1', retryMessageId: 'm1', images: [{}] }), /图片/);
  assert.equal(normalizeChatRequest({ message: 'abc', conversationId: 'c1', retryMessageId: 'm1' }).retryMessageId, 'm1');
});

test('server restart converts an unfinished accepted turn into a retryable turn', () => {
  db.createConversation({ id: 'resume-crash', user_id: 'user-a', title: '重启', intent: 'chat' });
  db.addMessage({ id: 'resume-crash-user', conversation_id: 'resume-crash', role: 'user',
    content: { role: 'user', content: '继续刚才的话', turn_state: 'pending' } });
  db.addMessage({ id: 'resume-crash-assistant', conversation_id: 'resume-crash', role: 'assistant',
    content: { role: 'assistant', content: '未完成' } });
  db.closeDb();
  const rows = db.getMessages('resume-crash');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content.turn_state, 'interrupted');
  assert.equal(db.getRetryableUserMessage('resume-crash', 'user-a', 'resume-crash-user')?.id, 'resume-crash-user');
});

test('cold restore preserves complete history and rolling summary within the 8K context budget', () => {
  const { ensureRollingSummary } = require('../../backend/agent/memoryService');
  const { assembleBudgetedContext } = require('../../backend/agent/contextBudget');
  const { MAX_INPUT_TOKENS } = require('../../backend/agent/chatLimits');
  const conversationId = 'resume-cold-restore';
  const userId = 'user-a';
  db.createConversation({ id: conversationId, user_id: userId, title: '恢复验收', intent: 'chat' });
  for (let round = 1; round <= 14; round += 1) {
    db.addMessage({ id: `cold-u-${round}`, conversation_id: conversationId, role: 'user',
      content: { role: 'user', content: `第${round}轮订单要求：${'保留原规格与交期。'.repeat(30)}`, turn_state: 'complete' } });
    db.addMessage({ id: `cold-a-${round}`, conversation_id: conversationId, role: 'assistant',
      content: { role: 'assistant', content: `第${round}轮确认：${'按已确认要求处理。'.repeat(30)}` } });
  }
  const memory = ensureRollingSummary({ userId, conversationId, history: db.getMessages(conversationId) });
  const historyBefore = db.getMessages(conversationId);
  assert.equal(memory.recentRounds.length, 10);
  assert.ok(JSON.stringify(memory.summary).length <= 6000);
  const summaryBefore = db.getConversationSummary(conversationId, userId);
  const archiveBefore = db.listArchivalPassages(userId, 100);
  assert.ok(summaryBefore.summarized_through_sequence > 0);
  const databasePath = path.join(tempDir, 'agent.db');
  const backupPath = path.join(tempDir, 'agent.cold-backup.db');
  db.closeDb();
  fs.copyFileSync(databasePath, backupPath);
  db.deleteConversation(conversationId, userId);
  assert.equal(db.getConversation(conversationId, userId), undefined);
  db.closeDb();
  fs.copyFileSync(backupPath, databasePath);
  assert.deepEqual(db.getMessages(conversationId), historyBefore);
  assert.deepEqual(db.getConversationSummary(conversationId, userId), summaryBefore);
  assert.deepEqual(db.listArchivalPassages(userId, 100), archiveBefore);
  assert.equal(db.getConversation(conversationId, 'user-b'), undefined);
  assert.equal(db.getConversationSummary(conversationId, 'user-b'), null);
  assert.deepEqual(db.getDb().pragma('foreign_key_check'), []);
  const context = assembleBudgetedContext({
    systemMessages: [{ role: 'system', content: '你是订单助手。' }],
    summary: JSON.stringify(summaryBefore.summary),
    recentRounds: memory.recentRounds.map(round => round.map(row => row.content)),
    currentMessage: { role: 'user', content: '继续刚才的订单讨论' },
    maxInputTokens: MAX_INPUT_TOKENS,
  });
  assert.equal(context.overBudget, false);
  assert.ok(context.estimatedTokens <= 8000);
  assert.ok(context.recentRoundsKept >= 3);
  assert.equal(db.getMessages(conversationId).length, 28);
});
