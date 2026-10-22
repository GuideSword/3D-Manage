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

  if (value.conversationId !== undefined && value.conversationId !== null
      && (typeof value.conversationId !== 'string' || !value.conversationId.trim()
        || value.conversationId.length > 128)) {
    throw new ChatRequestError('CONVERSATION_ID_INVALID', '会话标识无效');
  }

  const retryMessageId = value.retryMessageId == null ? undefined : value.retryMessageId;
  if (retryMessageId !== undefined) {
    if (typeof retryMessageId !== 'string' || !retryMessageId.trim() || retryMessageId.length > 128) {
      throw new ChatRequestError('RETRY_MESSAGE_INVALID', '重试消息标识无效');
    }
    if (typeof value.conversationId !== 'string' || !value.conversationId.trim()) {
      throw new ChatRequestError('RETRY_CONVERSATION_REQUIRED', '重试需要原会话');
    }
    if (images.length > 0) {
      throw new ChatRequestError('RETRY_IMAGES_UNSUPPORTED', '图片消息中断后请重新选择图片并发起新问题');
    }
  }

  return {
    conversationId: value.conversationId,
    retryMessageId,
    suppliedMessage,
    images,
    modelMessage: suppliedMessage || '请分析这些图片',
  };
}

module.exports = { ChatRequestError, normalizeChatRequest };
