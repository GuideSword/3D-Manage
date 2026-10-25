'use strict';

const { z } = require('zod');
const { ENTITY_NAMES, ENTITY_DEFINITIONS } = require('../contracts/entities');

// This converter intentionally covers the small Zod vocabulary used by Agent
// tools. Keeping additionalProperties:false in the object branch is important:
// provider supplied arguments must never silently add a second API contract.
function zodToJsonSchema(schema) {
  const def = schema?._def || {};
  const type = def.typeName;
  if (type === 'ZodObject') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    const properties = {}, required = [];
    for (const [key, value] of Object.entries(shape || {})) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional?.() && typeName(value) !== 'ZodDefault') required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (type === 'ZodString') {
    const json = { type: 'string' };
    for (const check of def.checks || []) {
      if (check.kind === 'min') json.minLength = check.value;
      if (check.kind === 'max') json.maxLength = check.value;
      if (check.kind === 'datetime') json.format = 'date-time';
    }
    return json;
  }
  if (type === 'ZodNumber') {
    const json = { type: 'number' };
    for (const check of def.checks || []) {
      if (check.kind === 'int') json.type = 'integer';
      if (check.kind === 'min') json.minimum = check.value;
      if (check.kind === 'max') json.maximum = check.value;
    }
    return json;
  }
  if (type === 'ZodBoolean') return { type: 'boolean' };
  if (type === 'ZodEnum') return { type: 'string', enum: def.values };
  if (type === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) };
  if (type === 'ZodRecord') return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) };
  if (type === 'ZodAny' || type === 'ZodUnknown') return {};
  if (type === 'ZodDefault') return zodToJsonSchema(def.innerType);
  if (type === 'ZodOptional' || type === 'ZodNullable') return zodToJsonSchema(def.innerType);
  if (type === 'ZodEffects') return zodToJsonSchema(def.schema);
  if (type === 'ZodUnion') return { anyOf: def.options.map(zodToJsonSchema) };
  if (type === 'ZodLiteral') return { const: def.value };
  return {};
}

function typeName(schema) { return schema?._def?.typeName; }

const entitySchema = z.enum(ENTITY_NAMES);
const listSchema = z.object({
  entity: entitySchema,
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(80).optional(),
  source: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  from: z.string().trim().max(80).optional(),
  to: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
  all: z.boolean().default(false),
}).strict();
const searchSchema = z.object({
  entity: entitySchema,
  query: z.string().trim().max(200),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
  all: z.boolean().default(false),
}).strict();
const getSchema = z.object({ entity: entitySchema, id: z.string().trim().min(1).max(200) }).strict();
const describeSchema = z.object({ entity: entitySchema }).strict();

function portFor(ctx) {
  const port = ctx?.agentDataPort || ctx?.dataPort;
  if (!port) throw Object.assign(new Error('Agent 数据接口未配置'), { code: 'AGENT_CONFIGURATION_INVALID', status: 503 });
  return port;
}

function descriptor(entity, schema, description, handler) {
  return { name: entity, allowedRoles: ['owner', 'staff', 'viewer'], description, schema, parameters: zodToJsonSchema(schema), handler };
}

const tools = [
  descriptor('describe_entity', describeSchema, '读取业务实体字段、类型、必填和可编辑定义。', async ({ entity }, ctx) => {
    const port = portFor(ctx);
    return typeof port.describeEntity === 'function' ? port.describeEntity(entity) : port.describe(entity);
  }),
  descriptor('list_records', listSchema, '按统一实体契约列出订单、模型、耗材或库存，返回完整分页元数据。', async (args, ctx) => {
    const { entity, ...query } = args;
    return portFor(ctx).list(entity, query);
  }),
  descriptor('get_record', getSchema, '读取一个业务实体的完整详情。', async ({ entity, id }, ctx) => portFor(ctx).get(entity, id)),
  descriptor('search_records', searchSchema, '在统一业务实体中按关键词搜索并返回分页结果。', async ({ entity, query, ...rest }, ctx) => {
    const port = portFor(ctx);
    return port.search(entity, { ...rest, query, search: query });
  }),
];

module.exports = tools;
module.exports.zodToJsonSchema = zodToJsonSchema;
module.exports.portFor = portFor;
module.exports.entitySchema = entitySchema;
module.exports.ENTITY_DEFINITIONS = ENTITY_DEFINITIONS;

