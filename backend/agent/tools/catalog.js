'use strict';

const { z } = require('zod');
const { zodToJsonSchema, portFor } = require('./entities');
const { ENTITY_DEFINITIONS } = require('../contracts/entities');

const actorFor = (ctx) => ctx?.actor || { id: String(ctx?.userId ?? ''), role: ctx?.role, serverId: ctx?.serverId || 'legacy' };
const pageFields = {
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
  all: z.boolean().default(false),
};
const listModelsSchema = z.object({ ...pageFields, source: z.string().trim().max(80).optional() }).strict();
const listMaterialsSchema = z.object({ ...pageFields, type: z.string().trim().max(120).optional() }).strict();
const detailSchema = z.object({ id: z.string().trim().min(1).max(200) }).strict();
const changesSchema = z.record(z.any()).default({});
const descriptor = (name, schema, description, handler, allowedRoles = ['owner', 'staff', 'viewer']) => ({ name, allowedRoles, description, schema, parameters: zodToJsonSchema(schema), handler });

function validateChanges(entity, changes) {
  const fields = ENTITY_DEFINITIONS[entity]?.fields || {};
  for (const key of Object.keys(changes || {})) {
    if (!Object.hasOwn(fields, key) || fields[key].readonly) throw Object.assign(new Error(`字段 ${key} 不属于可修改的 ${entity} 字段`), { code: 'TOOL_ARGUMENT_INVALID', path: ['changes', key], status: 400 });
  }
  return changes || {};
}

module.exports = [
  descriptor('list_models', listModelsSchema, '列出模型摘要和分页信息（名称、描述、来源、文件数量、图片数量）。用户询问有哪些模型、模型列表时使用；用户需要某个模型的文件或图片详情时再调用 get_model_detail。', (args, ctx) => portFor(ctx).list('models', args)),
  descriptor('get_model_detail', detailSchema, '读取单个模型的完整资料，包括描述、来源、模型文件和图片。', ({ id }, ctx) => portFor(ctx).get('models', id)),
  descriptor('prepare_model_update', z.object({ id: detailSchema.shape.id, changes: changesSchema }).strict(), '准备修改模型资料；不会立即写入，必须展示变更并等待确认。', async ({ id, changes }, ctx) => ({ proposal: await portFor(ctx).prepareUpdate('models', id, validateChanges('models', changes), actorFor(ctx)) }), ['owner', 'staff']),
  descriptor('prepare_model_delete', detailSchema, '准备删除模型资料；不会立即删除，必须得到用户明确确认。', async ({ id }, ctx) => ({ proposal: await portFor(ctx).prepareDelete('models', id, actorFor(ctx)) }), ['owner', 'staff']),
  descriptor('list_materials', listMaterialsSchema, '列出耗材资料和分页信息（材质、品牌、颜色、直径、密度、单价、单位、备注）。用户询问已有耗材、材料或耗材列表时使用。', (args, ctx) => portFor(ctx).list('materials', args)),
  descriptor('get_material_detail', detailSchema, '读取单个耗材的完整资料。', ({ id }, ctx) => portFor(ctx).get('materials', id)),
  descriptor('prepare_material_create', z.object({ changes: changesSchema }).strict(), '准备新增耗材资料；不会立即写入，必须展示字段并等待用户确认。', async ({ changes }, ctx) => ({ proposal: await portFor(ctx).prepareCreate('materials', validateChanges('materials', changes), actorFor(ctx)) }), ['owner', 'staff']),
  descriptor('prepare_material_update', z.object({ id: detailSchema.shape.id, changes: changesSchema }).strict(), '准备修改耗材资料；不会立即写入，必须展示变更并等待确认。', async ({ id, changes }, ctx) => ({ proposal: await portFor(ctx).prepareUpdate('materials', id, validateChanges('materials', changes), actorFor(ctx)) }), ['owner', 'staff']),
  descriptor('prepare_material_delete', detailSchema, '准备删除耗材资料；存在批次或库存流水时系统会拒绝，且必须得到用户明确确认。', async ({ id }, ctx) => ({ proposal: await portFor(ctx).prepareDelete('materials', id, actorFor(ctx)) }), ['owner', 'staff']),
];
