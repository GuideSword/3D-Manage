'use strict';

function preserveAgentSendError(messages = [], error = {}) {
  const message = error?.message || '小鲤处理失败，请稍后重试';
  const next = messages.map((item) => {
    if (item?.toolCall && !item.toolCall.result) {
      return { ...item, toolCall: { ...item.toolCall, result: { error: message, code: error?.code }, ok: false } };
    }
    return item;
  });
  let assistantIndex = -1;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]?.role === 'assistant' && next[i]?.isStreaming) {
      assistantIndex = i;
      break;
    }
  }
  if (assistantIndex >= 0) {
    const assistant = { ...next[assistantIndex], text: message, isStreaming: false, isError: true };
    next.splice(assistantIndex, 1);
    next.push(assistant);
    return next;
  }
  return [...next, { id: `agent-error-${Date.now()}`, role: 'assistant', text: message, isError: true }];
}

module.exports = { preserveAgentSendError };
