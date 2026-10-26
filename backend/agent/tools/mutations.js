'use strict';

const { z } = require('zod');
const { ENTITY_NAMES, ENTITY_DEFINITIONS } = require('../contracts/entities');
const { zodToJsonSchema, portFor, entitySchema } = require('./entities');

const changesSchema = z.record(z.any()).default({});
const prepareCreateSchema = z.object({ entity: entitySchema, changes: changesSchema }).strict();
const prepareUpdateSchema = z.object({ entity: entitySchema, id: z.string().trim().min(1).max(200), changes: changesSchema }).strict();
const prepareDeleteSchema = z.object({ entity: entitySchema, id: z.string().trim().min(1).max(200) }).strict();

function actorFor(ctx) {
  return ctx?.actor || { id: String(ctx?.userId ?? ''), role: ctx?.role, serverId: ctx?.serverId || 'legacy' };
}

function validateChanges(entity, changes) {
  const fields = ENTITY_DEFINITIONS[entity]?.fields || {};
  for (const key of Object.keys(changes || {})) {
    if (!Object.hasOwn(fields, key)) {
      const error = Object.assign(new Error(`字段 ${key} 不属于 ${entity}`), {
        code: 'TOOL_ARGUMENT_INVALID', path: ['changes', key], status: 400,
      });
      throw error;
    }
    if (fields[key].readonly) {
      const error = Object.assign(new Error(`字段 ${key} 只读`), {
        code: 'TOOL_ARGUMENT_INVALID', path: ['changes', key], status: 400,
      });
      throw error;
    }
  }
  return changes || {};
}

function descriptor(name, schema, description, handler) {
  return { name, allowedRoles: ['owner', 'staff'], description, schema, parameters: zodToJsonSchema(schema), handler };
}

const tools = [
  descriptor('prepare_create', prepareCreateSchema, '生成创建业务记录的签名提案；不会写入数据库。', async ({ entity, changes }, ctx) => {
    const proposal = await portFor(ctx).prepareCreate(entity, validateChanges(entity, changes), actorFor(ctx));
    return { proposal };
  }),
  descriptor('prepare_update', prepareUpdateSchema, '生成更新业务记录的签名提案；不会写入数据库。', async ({ entity, id, changes }, ctx) => {
    const proposal = await portFor(ctx).prepareUpdate(entity, id, validateChanges(entity, changes), actorFor(ctx));
    return { proposal };
  }),
  descriptor('prepare_delete', prepareDeleteSchema, '生成删除业务记录的签名提案；不会写入数据库。', async ({ entity, id }, ctx) => {
    const proposal = await portFor(ctx).prepareDelete(entity, id, actorFor(ctx));
    return { proposal };
  }),
];

module.exports = tools;
module.exports.ENTITY_NAMES = ENTITY_NAMES;
module.exports.validateChanges = validateChanges;

