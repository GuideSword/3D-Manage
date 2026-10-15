'use strict';
const { randomUUID } = require('node:crypto');
const { multiplyToCents, sumCents, parseScaled } = require('../../business-db/decimal');
const v = require('../catalog/validation');
const FIELDS = ['id', 'modelId', 'modelName', 'quantity', 'unitPrice', 'materialType', 'color', 'layerHeightMm', 'externalFileUrl', 'notes'];
const has = (row, key) => Object.hasOwn(row, key);
function logicalModel(row) {
  const snapshot = v.legacy(row.spec_raw);
  return row.model_id || snapshot.modelId || snapshot.modelAssetId || snapshot.model_asset_id || '';
}
async function normalizeLines(items, { existing = [], resolveModel }) {
  if (!Array.isArray(items) || !items.length || items.length > 1000) v.fail('订单需要 1 至 1000 个项目');
  const previous = new Map(existing.map(row => [row.id, row]));
  const used = new Set();
  const lines = [];
  let pricingChanged = items.length !== existing.length;
  for (const [position, input] of items.entries()) {
    v.fields(input, FIELDS);
    const old = has(input, 'id') ? previous.get(v.id(input.id)) : null;
    if (has(input, 'id') && !old) v.fail('订单行不存在，新增行请由服务器生成标识', 'ORDER_LINE_NOT_FOUND');
    const id = old?.id || randomUUID();
    if (used.has(id)) v.fail('订单行标识不能重复');
    used.add(id);
    const quantity = v.decimal(has(input, 'quantity') ? input.quantity : old?.quantity, { positive: true, scale: 3, digits: 15 });
    const price = v.decimal(has(input, 'unitPrice') ? input.unitPrice : old?.unit_price);
    const reprice = !old || parseScaled(quantity, 3, 15) !== parseScaled(old.quantity, 3, 15)
      || parseScaled(price, 6, 14) !== parseScaled(old.unit_price, 6, 14);
    pricingChanged ||= reprice;
    const subtotal = reprice ? multiplyToCents(quantity, price) : old.subtotal;
    const oldModel = old ? logicalModel(old) : '';
    const modelId = has(input, 'modelId') ? v.string(input.modelId, { max: 500 }) : oldModel;
    let foreignModel = old?.model_id ?? null;
    let modelName = old?.model_name_snapshot || '';
    if (!old || modelId !== oldModel) {
      if (modelId) {
        const model = await resolveModel(modelId);
        if (!model || !model.active) v.fail('所选模型不存在或已停用', 'MODEL_UNAVAILABLE', 409);
        foreignModel = model.id;
        modelName = model.name;
      } else {
        foreignModel = null;
        modelName = v.string(input.modelName, { max: 500 });
      }
    } else if (!modelId && has(input, 'modelName')) modelName = v.string(input.modelName, { max: 500 });
    const patch = { id, modelId, modelName, quantity, unitPrice: price, subtotal };
    for (const field of ['materialType', 'color', 'notes', 'externalFileUrl', 'layerHeightMm']) {
      if (!has(input, field)) continue;
      if (field === 'layerHeightMm') patch[field] = input[field] == null || input[field] === '' ? '' : v.decimal(input[field], { positive: true, digits: 6 });
      else patch[field] = v.string(input[field], { max: field === 'notes' ? 10000 : field === 'externalFileUrl' ? 2000 : 240 });
      if (field === 'externalFileUrl' && patch[field] && !/^https?:\/\//i.test(patch[field]) && !patch[field].startsWith('/api/files/')) {
        v.fail('外部文件地址必须是 HTTP/HTTPS 或已上传文件地址');
      }
    }
    lines.push({ id, position, modelId: foreignModel, modelName, quantity, unitPrice: price, subtotal, patch, existing: Boolean(old) });
  }
  if (existing.some(row => !used.has(row.id))) pricingChanged = true;
  return { lines, pricingChanged, total: sumCents(lines.map(row => row.subtotal)) };
}
async function saveLines(tx, orderId, normalized) {
  for (const row of normalized.lines) {
    const values = [orderId, row.id, row.position, row.modelId, row.modelName, row.quantity, row.unitPrice, row.subtotal, JSON.stringify(row.patch)];
    if (row.existing) {
      await tx.query(`UPDATE erp.order_items SET position=$3,model_id=$4,model_name_snapshot=$5,quantity=$6,unit_price=$7,subtotal=$8,
        spec_snapshot=spec_snapshot||$9::jsonb WHERE order_id=$1 AND id=$2`, values);
    } else {
      await tx.query(`INSERT INTO erp.order_items(order_id,id,position,model_id,model_name_snapshot,quantity,unit_price,subtotal,spec_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, values);
    }
  }
  await tx.query('DELETE FROM erp.order_items WHERE order_id=$1 AND NOT(id=ANY($2::text[]))', [orderId, normalized.lines.map(row => row.id)]);
}
module.exports = { normalizeLines, saveLines, logicalModel };
