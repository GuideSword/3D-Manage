'use strict';

const MAX_MESSAGE_CHARS = 1200;
const MAX_MODEL_TURNS = 4;
const MAX_OUTPUT_TOKENS = 1536;
const DEFAULT_CONTEXT_TOKENS = 256000;
const MIN_CONTEXT_TOKENS = 8192;
const MAX_CONTEXT_TOKENS = 1000000;
const RECOMMENDED_CONTEXT_TOKENS = { min: 65536, max: 256000 };

function normalizeContextTokens(value, fallback = DEFAULT_CONTEXT_TOKENS) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < MIN_CONTEXT_TOKENS || candidate > MAX_CONTEXT_TOKENS) {
    const error = chatLimitError(
      'CHAT_CONTEXT_CONFIG_INVALID',
      `上下文上限必须是 ${MIN_CONTEXT_TOKENS} 到 ${MAX_CONTEXT_TOKENS} 之间的整数`,
      400,
    );
    throw error;
  }
  return candidate;
}

function contextTokensFor(settings) {
  try {
    return normalizeContextTokens(settings?.llm_context_tokens);
  } catch (_) {
    return DEFAULT_CONTEXT_TOKENS;
  }
}

// Kept as a compatibility export for callers that imported the old constant.
const MAX_INPUT_TOKENS = DEFAULT_CONTEXT_TOKENS;

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
  DEFAULT_CONTEXT_TOKENS,
  MAX_CONTEXT_TOKENS,
  MAX_MESSAGE_CHARS,
  MAX_MODEL_TURNS,
  MAX_OUTPUT_TOKENS,
  MIN_CONTEXT_TOKENS,
  RECOMMENDED_CONTEXT_TOKENS,
  contextTokensFor,
  createChatGuard,
  normalizeContextTokens,
  validateChatLength,
};
