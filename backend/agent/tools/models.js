// Tools for searching model assets.
// All tools here are READ-ONLY against the JSON store via ctx.db.
// Tools receive (args, ctx) where ctx = { db, embed, userId }.

const { z } = require('zod');

// ------------------------------------------------------------------
// Minimal Zod -> JSON Schema converter (handles the cases we use).
// Kept local to avoid circular requires with ./index.js.
// ------------------------------------------------------------------
function zodToJsonSchema(schema) {
  const t = schema._def.typeName;

  if (t === 'ZodObject') {
    const shape = schema._def.shape();
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return { type: 'object', properties, required };
  }

  if (t === 'ZodString') {
    const json = { type: 'string' };
    if (Array.isArray(schema._def.checks)) {
      for (const check of schema._def.checks) {
        if (check.kind === 'datetime') json.format = 'date-time';
        if (check.kind === 'uuid') json.format = 'uuid';
        if (check.kind === 'min') json.minLength = check.value;
        if (check.kind === 'max') json.maxLength = check.value;
      }
    }
    return json;
  }

  if (t === 'ZodNumber') {
    const json = { type: 'number' };
    if (Array.isArray(schema._def.checks)) {
      for (const check of schema._def.checks) {
        if (check.kind === 'int') json.type = 'integer';
        if (check.kind === 'min') json.minimum = check.value;
        if (check.kind === 'max') json.maximum = check.value;
      }
    }
    return json;
  }

  if (t === 'ZodBoolean') return { type: 'boolean' };

  if (t === 'ZodEnum') {
    return { type: 'string', enum: schema._def.values };
  }

  if (t === 'ZodArray') {
    return { type: 'array', items: zodToJsonSchema(schema._def.type) };
  }

  if (t === 'ZodOptional') return zodToJsonSchema(schema._def.innerType);
  if (t === 'ZodDefault') return zodToJsonSchema(schema._def.innerType);
  if (t === 'ZodNullable') return zodToJsonSchema(schema._def.innerType);

  return {};
}

// ------------------------------------------------------------------
// search_models_by_keyword
// ------------------------------------------------------------------
const searchModelsByKeywordSchema = z.object({
  keyword: z.string().describe('模型名/标签关键词'),
  limit: z.number().int().min(1).max(50).default(20),
});

const searchModelsByKeyword = {
  name: 'search_models_by_keyword',
  description: '按模型名称或标签关键词精确查找模型资产。',
  schema: searchModelsByKeywordSchema,
  parameters: zodToJsonSchema(searchModelsByKeywordSchema),
  handler: async (args, ctx) => {
    return ctx.db.searchModelsByKeyword(args.keyword, args.limit);
  },
};

// ------------------------------------------------------------------
// search_models_semantic
// ------------------------------------------------------------------
const searchModelsSemanticSchema = z.object({
  query: z.string().describe('自然语言描述'),
  top_k: z.number().int().min(1).max(20).default(5),
});

const searchModelsSemantic = {
  name: 'search_models_semantic',
  description:
    '按自然语言描述做语义搜索，适合外观/用途类模糊查询（\'莲花形状\'、\'做手机壳的\'）。',
  schema: searchModelsSemanticSchema,
  parameters: zodToJsonSchema(searchModelsSemanticSchema),
  handler: async (args, ctx) => {
    const vec = await ctx.embed.embedQuery(args.query);
    return ctx.db.semanticSearchModels(vec, args.top_k);
  },
};

module.exports = [searchModelsByKeyword, searchModelsSemantic];
