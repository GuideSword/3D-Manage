'use strict';

const { z } = require('zod');

const trimString = (value, fallback = '') => value == null ? fallback : String(value).trim();
const finiteOrUndefined = (value) => {
  if (value == null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const optionalNumber = z.preprocess(finiteOrUndefined, z.number().finite().optional());
const requiredPositiveNumber = z.preprocess(
  finiteOrUndefined,
  z.number().finite().positive(),
);
const requiredNonNegativeNumber = z.preprocess(
  finiteOrUndefined,
  z.number().finite().nonnegative(),
);

const orderDraftItemSchema = z.object({
  model_asset_id: z.union([z.string(), z.number()]).optional().default(''),
  model_name: z.string().trim().max(200).optional().default(''),
  material_type: z.string().trim().min(1).max(120),
  color: z.string().trim().max(120).optional().default(''),
  layer_height_mm: optionalNumber,
  qty: requiredPositiveNumber,
  unit_price: requiredNonNegativeNumber,
  notes: z.string().trim().max(1000).optional().default(''),
}).strict();

const orderDraftSchema = z.object({
  customer_name: z.string().trim().min(1).max(200),
  due_date: z.string().trim().max(40).nullable().optional().default(null),
  notes: z.string().trim().max(5000).optional().default(''),
  items: z.array(orderDraftItemSchema).min(1),
  confidence: z.number().finite().min(0).max(1).optional(),
  missing_fields: z.array(z.string()).optional().default([]),
}).strict();

const normalizeDraftItem = (item = {}) => ({
  ...item,
  model_asset_id: item.model_asset_id == null ? '' : String(item.model_asset_id).trim(),
  model_name: trimString(item.model_name),
  material_type: trimString(item.material_type),
  color: trimString(item.color),
  layer_height_mm: finiteOrUndefined(item.layer_height_mm),
  qty: finiteOrUndefined(item.qty),
  unit_price: finiteOrUndefined(item.unit_price),
  notes: trimString(item.notes),
});

const missingOrderDraftFields = (draft = {}) => {
  const missing = [];
  if (!trimString(draft.customer_name)) missing.push('customer_name');
  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    missing.push('items');
    return missing;
  }
  draft.items.forEach((item, index) => {
    if (!trimString(item?.material_type)) missing.push(`items[${index}].material_type`);
    const qty = finiteOrUndefined(item?.qty);
    if (qty == null || qty <= 0) missing.push(`items[${index}].qty`);
    const unitPrice = finiteOrUndefined(item?.unit_price);
    if (unitPrice == null || unitPrice < 0) missing.push(`items[${index}].unit_price`);
  });
  return missing;
};

const normalizeOrderDraft = (input = {}) => {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const draft = {
    ...source,
    customer_name: trimString(source.customer_name),
    due_date: source.due_date == null || source.due_date === '' ? null : trimString(source.due_date),
    notes: trimString(source.notes),
    items: Array.isArray(source.items) ? source.items.map(normalizeDraftItem) : [],
    confidence: finiteOrUndefined(source.confidence),
  };
  // The model-provided marker is intentionally ignored. Always derive it from
  // the normalized values so stale markers cannot make a populated form look empty.
  draft.missing_fields = missingOrderDraftFields(draft);
  return draft;
};

module.exports = {
  orderDraftSchema,
  orderDraftItemSchema,
  normalizeOrderDraft,
  missingOrderDraftFields,
};
