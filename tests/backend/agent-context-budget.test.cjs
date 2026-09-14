'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assembleBudgetedContext,
  estimateTokens,
  groupConversationRounds,
} = require('../../backend/agent/contextBudget');

test('token estimation accounts for CJK, ASCII, and safety envelope', () => {
  assert.equal(estimateTokens('测试'), 3);
  assert.equal(estimateTokens('abcdefgh'), 3);
});

test('conversation grouping keeps assistant tool calls and tool results in one round', () => {
  const rounds = groupConversationRounds([
    { role: 'user', content: 'one' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't' }] },
    { role: 'tool', tool_call_id: 't', content: '{"ok":true}' },
    { role: 'assistant', content: 'done' },
    { role: 'user', content: 'two' },
  ]);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].length, 4);
});

test('budget keeps mandatory layers and at least three recent rounds', () => {
  const currentMessage = { role: 'user', content: 'current request' };
  const recentRounds = Array.from({ length: 12 }, (_, i) => [
    { role: 'user', content: `q${i} ${'x'.repeat(500)}` },
    { role: 'assistant', content: `a${i} ${'y'.repeat(500)}` },
  ]);
  const result = assembleBudgetedContext({
    systemMessages: [{ role: 'system', content: 'system' }],
    coreMemory: 'stable preference',
    summary: 'older decisions',
    archiveMatches: Array.from({ length: 5 }, (_, i) => ({ text: `${i} ${'z'.repeat(1000)}` })),
    recentRounds,
    currentMessage,
    maxInputTokens: 2200,
  });
  assert.ok(result.estimatedTokens <= 2200 || result.overBudget);
  assert.ok(result.recentRoundsKept >= 3);
  assert.equal(result.messages.at(-1), currentMessage);
  assert.equal(result.messages[0].role, 'system');
});
