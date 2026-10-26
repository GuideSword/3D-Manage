'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preserveAgentSendError } = require('../../utils/agentChatStateCore.cjs');

test('send errors keep the user message and expose a visible assistant error', () => {
  const messages = [
    { id: 'old', role: 'assistant', text: '之前的回复' },
    { id: 'user', role: 'user', text: '现在有哪些模型' },
    { id: 'assistant', role: 'assistant', text: '', isStreaming: true },
    { id: 'tool', toolCall: { name: 'list_models', args: {}, result: null } },
  ];
  const next = preserveAgentSendError(messages, { message: '模型查询失败', code: 'TOOL_FAILED' });
  assert.equal(next.some(item => item.id === 'user'), true);
  assert.equal(next.at(-1).text, '模型查询失败');
  assert.equal(next.at(-1).isError, true);
  assert.equal(next.find(item => item.id === 'tool').toolCall.ok, false);
});

