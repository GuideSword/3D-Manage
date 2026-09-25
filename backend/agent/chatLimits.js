'use strict';

const MAX_MESSAGE_CHARS = 1200;
const MAX_MODEL_TURNS = 4;
const MAX_OUTPUT_TOKENS = 1536;
const MAX_INPUT_TOKENS = 8000;

function chatLimitError(code, message, status = 429) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateChatLength(message) {
  if (Array.from(message).length > MAX_MESSAGE_CHARS) {
    throw chatLimitError(
      'CHAT_MESSAGE_TOO_LONG',
      `每条消息最多 ${MAX_MESSAGE_CHARS} 个字，请精简后重试`,
      400,
    );
  }
}

function createChatGuard() {
  const activeUsers = new Set();

  function acquire(userId) {
    const id = String(userId);
    if (activeUsers.has(id)) {
      throw chatLimitError('CHAT_ALREADY_RUNNING', '请等待上一条回复完成后再发送');
    }

    activeUsers.add(id);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeUsers.delete(id);
    };
  }

  return { acquire };
}

module.exports = {
  MAX_INPUT_TOKENS,
  MAX_MESSAGE_CHARS,
  MAX_MODEL_TURNS,
  MAX_OUTPUT_TOKENS,
  createChatGuard,
  validateChatLength,
};
