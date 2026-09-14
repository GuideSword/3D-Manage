'use strict';

const { z } = require('zod');
const { applyCoreMemoryCandidate } = require('../memoryService');
const { readOwnedAttachment } = require('../attachmentStore');

const schema = z.object({
  category: z.enum(['user_preferences', 'business_constraints', 'active_goals']),
  content: z.string().min(1).max(500),
}).strict();

const rememberFact = {
  name: 'remember_explicit_user_fact',
  allowedRoles: ['owner', 'staff', 'viewer'],
  description: '仅当用户在当前消息中明确陈述长期偏好、业务约束或持续目标时，保存一条核心记忆；禁止推测。',
  schema,
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['user_preferences', 'business_constraints', 'active_goals'] },
      content: { type: 'string', minLength: 1, maxLength: 500 },
    },
    required: ['category', 'content'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => applyCoreMemoryCandidate({
    userId: ctx.userId,
    category: args.category,
    content: args.content,
    sourceMessageId: ctx.currentUserMessageId,
  }),
};

const recallSchema = z.object({ attachment_id: z.string().uuid() }).strict();
const recallImage = {
  name: 'recall_conversation_image',
  allowedRoles: ['owner', 'staff', 'viewer'],
  description: '当历史摘要提到某张对话图片且确实需要重新查看时，按 attachment_id 临时取回该图片。',
  schema: recallSchema,
  parameters: {
    type: 'object',
    properties: { attachment_id: { type: 'string', format: 'uuid' } },
    required: ['attachment_id'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const owned = await readOwnedAttachment({
      attachmentId: args.attachment_id,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    });
    return {
      __imageRecall: true,
      attachmentId: args.attachment_id,
      mimeType: owned.metadata.mime_type,
      dataUrl: `data:${owned.metadata.mime_type};base64,${owned.buffer.toString('base64')}`,
    };
  },
};

module.exports = [rememberFact, recallImage];
