'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createChatGuard,
  DEFAULT_CONTEXT_TOKENS,
  MAX_CONTEXT_TOKENS,
  MAX_MESSAGE_CHARS,
  MIN_CONTEXT_TOKENS,
  contextTokensFor,
  normalizeContextTokens,
} = require('../../backend/agent/chatLimits');
const { normalizeChatRequest } = require('../../backend/agent/chatRequest');

test('only an active chat blocks the same user; repeated completed chats are allowed', () => {
  const guard = createChatGuard();
  const release = guard.acquire('user-1');
  assert.throws(() => guard.acquire('user-1'), { code: 'CHAT_ALREADY_RUNNING' });
  guard.acquire('user-2')();
  release();
  release();

  for (let index = 0; index < 30; index += 1) {
    guard.acquire('user-1')();
  }
});

test('oversized chat messages are rejected before entering the model', () => {
  assert.equal(normalizeChatRequest({ message: '字'.repeat(MAX_MESSAGE_CHARS) }).suppliedMessage.length, MAX_MESSAGE_CHARS);
  assert.throws(() => normalizeChatRequest({ message: '字'.repeat(MAX_MESSAGE_CHARS + 1) }), {
    code: 'CHAT_MESSAGE_TOO_LONG',
    status: 400,
  });
});

test('context budget defaults to 256k and accepts configurable provider-sized limits', () => {
  assert.equal(DEFAULT_CONTEXT_TOKENS, 256000);
  assert.equal(contextTokensFor({ llm_context_tokens: 256000 }), 256000);
  assert.equal(normalizeContextTokens('512000'), 512000);
  assert.throws(() => normalizeContextTokens(MIN_CONTEXT_TOKENS - 1), { code: 'CHAT_CONTEXT_CONFIG_INVALID' });
  assert.throws(() => normalizeContextTokens(MAX_CONTEXT_TOKENS + 1), { code: 'CHAT_CONTEXT_CONFIG_INVALID' });
  assert.equal(contextTokensFor({ llm_context_tokens: 'not-a-number' }), DEFAULT_CONTEXT_TOKENS);
});
