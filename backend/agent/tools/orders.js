// Tools for querying orders. All READ-ONLY via ctx.db.
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
// list_orders
// ------------------------------------------------------------------
const listOrdersSchema = z.object({
  status: z
    .enum(['draft', 'pending', 'in_progress', 'done', 'cancelled'])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const listOrders = {
  name: 'list_orders',
  description: '按状态/日期范围查询订单列表，做统计/汇总用。',
  schema: listOrdersSchema,
  parameters: zodToJsonSchema(listOrdersSchema),
  handler: async (args, ctx) => {
    return ctx.db.listOrders(args);
  },
};

// ------------------------------------------------------------------
// get_order_detail
// ------------------------------------------------------------------
const getOrderDetailSchema = z.object({
  order_id: z.string().describe('订单 ID（UUID）'),
});

const getOrderDetail = {
  name: 'get_order_detail',
  description: '取单个订单的完整明细（含订单行）。',
  schema: getOrderDetailSchema,
  parameters: zodToJsonSchema(getOrderDetailSchema),
  handler: async (args, ctx) => {
    return ctx.db.getOrderDetail(args.order_id);
  },
};

module.exports = [listOrders, getOrderDetail];
