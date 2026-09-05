// Tools for querying inventory (consumables/materials). READ-ONLY via ctx.db.
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
// get_inventory_summary
// ------------------------------------------------------------------
const getInventorySummarySchema = z.object({
  material_type: z.string().optional().describe('按材料类型过滤，例如 PLA / ABS / PETG'),
  low_stock_only: z.boolean().default(false),
});

const getInventorySummary = {
  name: 'get_inventory_summary',
  description: '查耗材库存概要，按材料聚合。',
  schema: getInventorySummarySchema,
  parameters: zodToJsonSchema(getInventorySummarySchema),
  handler: async (args, ctx) => {
    return ctx.db.inventorySummary(args);
  },
};

module.exports = [getInventorySummary];
