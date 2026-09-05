// Tools that produce structured DRAFT output (no DB writes).
// The Orchestrator detects the `extract_order_draft` tool call and emits
// an SSE 'draft' event for the frontend to render the confirmation card.

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
// extract_order_draft
// Identity handler — just returns the parsed args. The Orchestrator
// detects this tool name and emits an SSE 'draft' event.
// Does NOT write to the DB; user must confirm via /agent/drafts/confirm.
// ------------------------------------------------------------------
const extractOrderDraftSchema = z.object({
  customer_name: z.string().optional(),
  due_date: z.string().optional().describe('ISO 日期 (YYYY-MM-DD)'),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        material_type: z.string(),
        color: z.string().optional(),
        layer_height_mm: z.number().optional(),
        qty: z.number().int().positive(),
        unit_price: z.number().nonnegative(),
        model_asset_id: z.number().int().optional(),
      })
    )
    .default([]),
  confidence: z.number().min(0).max(1).describe('抽取置信度 0-1'),
  missing_fields: z.array(z.string()).default([]),
});

const extractOrderDraft = {
  name: 'extract_order_draft',
  description:
    '从用户输入的文本里抽取订单信息，返回结构化草稿。**不会写入数据库**，只返回给前端展示并等待用户确认。',
  schema: extractOrderDraftSchema,
  parameters: zodToJsonSchema(extractOrderDraftSchema),
  handler: async (args) => {
    // Identity: just pass the parsed draft through. The Orchestrator
    // will detect this tool name and emit a 'draft' SSE event so the
    // frontend can show a confirmation card.
    return args;
  },
};

module.exports = [extractOrderDraft];
