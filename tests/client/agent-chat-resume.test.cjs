'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreConversationMessages } = require('../../utils/agentConversationCore.cjs');

test('restores dialog messages and identifies only the last unfinished user turn', () => {
  const rows = [
    { id: 'u1', role: 'user', content: { role: 'user', content: '订单进度？', turn_state: 'complete' } },
    { id: 'a1', role: 'assistant', content: { role: 'assistant', content: '正在打印' } },
    { id: 't1', role: 'tool', content: { role: 'tool', content: '{}' } },
    { id: 'u2', role: 'user', content: { role: 'user', content: '什么时候交付？', turn_state: 'interrupted' } },
  ];
  const restored = restoreConversationMessages(rows);
  assert.deepEqual(restored.messages.map(message => message.text), ['订单进度？', '正在打印', '什么时候交付？\n（回复未完成）']);
  assert.deepEqual(restored.retryMessage, { id: 'u2', text: '什么时候交付？', hasImages: false });
});

test('old completed messages and image messages do not lose their text', () => {
  assert.equal(restoreConversationMessages([{ id: 'old', role: 'user', content: { content: '旧消息' } }]).retryMessage, null);
  const restored = restoreConversationMessages([{ id: 'image', role: 'user', content: {
    content: [{ type: 'text', text: '这个模型' }, { type: 'image_attachment', attachment_id: 'a' }],
    turn_state: 'interrupted',
  } }]);
  assert.equal(restored.messages[0].text, '这个模型\n图片 1 张\n（回复未完成）');
  assert.equal(restored.retryMessage.hasImages, true);
});
