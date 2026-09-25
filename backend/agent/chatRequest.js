'use strict';

const { validateChatLength } = require('./chatLimits');

class ChatRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ChatRequestError';
    this.code = code;
    this.status = status;
  }
}

function normalizeChatRequest(body) {
  const value = body && typeof body === 'object' ? body : {};
  const suppliedMessage = typeof value.message === 'string' ? value.message.trim() : '';
  const images = Array.isArray(value.images) ? value.images : [];

  if (!suppliedMessage && images.length === 0) {
    throw new ChatRequestError('MESSAGE_REQUIRED', '请输入消息或选择图片');
  }

  validateChatLength(suppliedMessage);

  return {
    conversationId: value.conversationId,
    suppliedMessage,
    images,
    modelMessage: suppliedMessage || '请分析这些图片',
  };
}

module.exports = { ChatRequestError, normalizeChatRequest };
