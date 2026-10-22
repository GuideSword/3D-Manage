const { z } = require('zod');

const fieldSchema = z.object({
  customer_name: z.string().max(200).optional(),
  customer_email: z.string().max(200).optional(),
  customer_phone: z.string().max(100).optional(),
  due_date: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(5000).optional(),
  status: z.enum(['draft', 'pending_review', 'in_progress', 'completed', 'cancelled']).optional(),
  name: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  source: z.enum(['original', 'remix', 'imported']).optional(),
  type: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  diameter: z.number().nonnegative().optional(),
  color: z.string().max(120).optional(),
  density: z.number().nonnegative().optional(),
  unit_price: z.number().nonnegative().optional(),
  unit: z.string().max(40).optional(),
});

const schema = z.object({
  entity: z.enum(['orders', 'models', 'materials']),
  id: z.string().min(1),
  changes: fieldSchema,
});

const fields = {
  orders: ['customer_name', 'customer_email', 'customer_phone', 'due_date', 'notes', 'status'],
  models: ['name', 'description', 'source'],
  materials: ['type', 'brand', 'diameter', 'color', 'density', 'unit_price', 'unit', 'notes'],
};

function validateProposal(proposal) {
  const parsed = schema.parse(proposal);
  const keys = Object.keys(parsed.changes);
  if (!keys.length || keys.some((key) => !fields[parsed.entity].includes(key))) {
    throw new Error('修改字段为空或不适用于该记录');
  }
  return parsed;
}

module.exports = [{
  name: 'propose_record_update',
  allowedRoles: ['owner', 'staff'],
  description: '为已有订单、模型或耗材提出字段修改。只生成待确认提案，不写数据库；必须使用查询得到的准确 ID。',
  schema,
  parameters: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: ['orders', 'models', 'materials'] },
      id: { type: 'string' },
      changes: { type: 'object', properties: Object.fromEntries(Object.entries(fieldSchema.shape).map(([key, value]) => [key, value._def.innerType?._def.typeName === 'ZodEnum' ? { type: 'string', enum: value._def.innerType._def.values } : { type: value._def.innerType?._def.typeName === 'ZodNumber' ? 'number' : 'string' }])), additionalProperties: false },
    },
    required: ['entity', 'id', 'changes'],
  },
  handler: async (args, ctx) => ctx.db.prepareRecordUpdate(validateProposal(args)),
}];

module.exports.validateProposal = validateProposal;
