'use strict';
const { randomUUID } = require('node:crypto');
const { createVersionedUpdater } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const repo = require('./repository');
const { MAX_MG, readQuantity } = require('./quantity');
const update = createVersionedUpdater({ 'erp.stock_lots': ['qty_mg', 'state'] }, { touchUpdatedAt: true });
function aliasId(payload, keys) {
  const values = keys.filter(key => payload[key] != null && payload[key] !== '').map(key => v.id(payload[key]));
  if (new Set(values).size > 1) v.fail('关联标识字段不一致');
  return values[0] || null;
}
async function appendMovement(tx, { lotId, orderId = null, actor, type, qtyMg, beforeMg, afterMg, source, notes }) {
  const id = randomUUID();
  await tx.query(`INSERT INTO erp.inventory_txns(id,lot_id,order_id,actor_id,type,qty_mg,before_qty_mg,after_qty_mg,delta_qty_mg,ledger_version,source,notes,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,clock_timestamp())`,
  [id, lotId, orderId, actor.id, type, String(qtyMg), String(beforeMg), String(afterMg), String(afterMg - beforeMg), source, notes]);
  return repo.getTransaction(tx, id);
}
async function postMovement(tx, { payload, actor, audit }, { source = 'manual' } = {}) {
  v.fields(payload, ['lotId', 'lot_id', 'type', 'qty', 'qty_g', 'unit', 'notes', 'reason', 'orderId', 'relatedOrderId', 'related_order_id', 'version'], ['type']);
  const type = payload.type;
  if (!['in', 'out', 'adjust', 'scrap'].includes(type)) v.fail('库存操作类型无效');
  if (['adjust', 'scrap'].includes(type) && actor.role !== 'owner') v.fail('只有 Owner 可执行盘点或报废', 'BUSINESS_FORBIDDEN', 403);
  const lotId = aliasId(payload, ['lotId', 'lot_id']);
  if (!lotId) v.fail('请选择库存批次');
  const orderId = aliasId(payload, ['orderId', 'relatedOrderId', 'related_order_id']);
  // The order lock precedes the lot lock, matching commercial edits and deletion.
  if (orderId && !(await tx.query('SELECT id FROM erp.orders WHERE id=$1 FOR SHARE', [orderId])).rows.length) v.fail('关联订单不存在', 'ORDER_NOT_FOUND', 404);
  const row = await repo.lotRow(tx, lotId, true);
  if (row.balance_status === 'legacy_invalid' || row.qty_mg === null) v.fail('历史余额无效，请先人工核对', 'LEGACY_BALANCE_INVALID', 409);
  if (!row.active || row.state !== 'in_stock') v.fail('批次已停用、冻结或报废，不能过账', 'LOT_INACTIVE', 409);
  const qtyMg = readQuantity(payload);
  if (type !== 'adjust' && qtyMg === 0n) v.fail('本次库存数量必须大于零', 'INVALID_QUANTITY');
  const notes = v.string(payload.notes) || v.string(payload.reason);
  if (type === 'scrap' && !notes.trim()) v.fail('请填写原料报废原因', 'REASON_REQUIRED');
  const beforeMg = BigInt(row.qty_mg);
  const afterMg = type === 'adjust' ? qtyMg : type === 'in' ? beforeMg + qtyMg : beforeMg - qtyMg;
  if (afterMg < 0n) v.fail('库存不足', 'INSUFFICIENT_STOCK', 409);
  if (afterMg > MAX_MG) v.fail('库存数量超出允许范围', 'INVALID_QUANTITY');
  await update(tx, { table: 'erp.stock_lots', id: lotId, expectedVersion: type === 'adjust' ? payload.version : payload.version ?? row.version,
    changes: { qty_mg: String(afterMg), state: type === 'scrap' && afterMg === 0n ? 'scrapped' : row.state } });
  const txn = await appendMovement(tx, { lotId, orderId, actor, type, qtyMg, beforeMg, afterMg, source, notes });
  await audit({ entity: 'stockLots', entityId: lotId, action: `inventory.${type}`, diff: { before: repo.lotDTO(row), after: await repo.get(tx, lotId), txn } });
  return { status: 201, body: txn };
}
module.exports = { appendMovement, postMovement, aliasId };
