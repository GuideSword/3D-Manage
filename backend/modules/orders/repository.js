'use strict';
const v = require('../catalog/validation');
const { fileMetadata } = require('../catalog/files');
const { logicalModel } = require('./lines');
const COLUMNS = `id,number,customer_id,customer_snapshot::text AS customer_raw,status,status_reason,currency,total::text,notes,due_date,created_by,version,active,created_at,updated_at,legacy_payload::text AS legacy_raw,
  (status IN ('draft','pending_review') AND NOT EXISTS(SELECT 1 FROM erp.inventory_txns fact WHERE fact.order_id=orders.id)) AS commercial_editable`;
async function lineRows(tx, id) {
  return (await tx.query(`SELECT id,position,model_id,model_name_snapshot,quantity::text,unit_price::text,subtotal::text,spec_snapshot::text AS spec_raw
    FROM erp.order_items WHERE order_id=$1 ORDER BY position`, [id])).rows;
}
async function detail(tx, row) {
  const lines = await lineRows(tx, row.id);
  const attachments = (await tx.query('SELECT position,file_key,original_name,metadata::text AS metadata_raw FROM erp.order_attachments WHERE order_id=$1 ORDER BY position', [row.id])).rows;
  const legacy = v.legacy(row.legacy_raw);
  const items = lines.map(line => {
    const spec = v.legacy(line.spec_raw);
    const modelId = logicalModel(line);
    const item = { ...spec, id: line.id, position: line.position, modelId, modelName: line.model_name_snapshot,
      quantity: line.quantity, qty: line.quantity, unitPrice: line.unit_price, unit_price: line.unit_price, subtotal: line.subtotal };
    for (const [alias, value] of [['modelAssetId', modelId], ['model_asset_id', modelId], ['model_name', line.model_name_snapshot]]) {
      if (Object.hasOwn(spec, alias)) item[alias] = value;
    }
    for (const [field, alias] of [['materialType', 'material_type'], ['layerHeightMm', 'layer_height_mm'], ['externalFileUrl', 'external_file_url']]) {
      item[field] = spec[field] ?? spec[alias] ?? '';
      if (Object.hasOwn(spec, alias)) item[alias] = item[field];
    }
    return item;
  });
  return { ...legacy, ...(Object.hasOwn(legacy, 'orderItems') ? { orderItems: items } : {}),
    ...(Object.hasOwn(legacy, 'due_date') ? { due_date: row.due_date } : {}),
    id: row.id, number: row.number, customerId: row.customer_id, customer: v.legacy(row.customer_raw),
    status: row.status, statusReason: row.status_reason, currency: row.currency, total: row.total, notes: row.notes, dueDate: row.due_date,
    commercialEditable: row.commercial_editable,
    createdBy: row.created_by, version: row.version, active: row.active, createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at),
    items,
    attachments: attachments.map(file => ({ ...fileMetadata(file.metadata_raw), position: file.position, fileKey: file.file_key, originalName: file.original_name })),
  };
}
async function get(tx, id) {
  const row = (await tx.query(`SELECT ${COLUMNS} FROM erp.orders WHERE id=$1`, [v.id(id)])).rows[0];
  if (!row) v.fail('订单不存在', 'ENTITY_NOT_FOUND', 404);
  return detail(tx, row);
}
module.exports = { COLUMNS, detail, get, lineRows };
