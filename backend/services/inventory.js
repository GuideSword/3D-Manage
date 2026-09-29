const { randomUUID, createHash } = require('node:crypto');
const { withData, appendAudit, now } = require('../utils/store');
const { gramsToMg, mgToGrams } = require('./inventoryQuantity');

class InventoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new InventoryError(status, code, message); };
const copy = (value) => JSON.parse(JSON.stringify(value));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const assertWriter = (actor, ownerOnly = false) => {
  if (!actor?.id || !(ownerOnly ? ['owner'] : ['owner', 'staff']).includes(actor.role)) {
    fail(403, 'INVENTORY_FORBIDDEN', '当前账号无权执行该库存操作');
  }
};
const assertUnit = (payload) => {
  if (payload.unit !== undefined && payload.unit !== 'g') fail(400, 'INVALID_UNIT', '库存数量单位必须为 g');
};
const readQty = (payload, defaultValue) => {
  assertUnit(payload);
  const value = has(payload, 'qty') ? payload.qty : has(payload, 'qty_g') ? payload.qty_g : defaultValue;
  const mg = gramsToMg(value);
  if (has(payload, 'qty') && has(payload, 'qty_g') && gramsToMg(payload.qty_g) !== mg) {
    fail(400, 'INVALID_QUANTITY', '数量字段不一致');
  }
  return mg;
};
const getLot = (data, id) => {
  const lot = data.stockLots.find((item) => String(item.id) === String(id));
  if (!lot) fail(404, 'LOT_NOT_FOUND', '库存批次不存在');
  return lot;
};
const assertVersion = (lot, version) => {
  if (version !== undefined && (!Number.isSafeInteger(version) || version !== lot.version)) {
    fail(409, 'VERSION_CONFLICT', '批次已被修改，请刷新后重新提交');
  }
};
const getBalanceMg = (lot) => {
  if (lot.balanceStatus === 'legacy_invalid') fail(409, 'LEGACY_BALANCE_INVALID', '历史余额无效，请先人工核对迁移数据');
  const mg = lot.qtyMg ?? gramsToMg(lot.qty ?? lot.qty_g);
  if (!Number.isSafeInteger(mg) || mg < 0) fail(409, 'LEGACY_BALANCE_INVALID', '历史余额无效，请先人工核对迁移数据');
  return mg;
};
const isLotAvailable = (lot) => lot.active !== false
  && (lot.state || lot.status || 'in_stock') === 'in_stock'
  && lot.balanceStatus !== 'legacy_invalid';

const appendMovement = (data, lot, { type, qtyMg, beforeMg, afterMg, actor, notes = '', orderId = '', source = 'manual' }) => {
  const txn = {
    id: randomUUID(), lotId: lot.id, materialId: lot.materialId || lot.material_id,
    type, qty: mgToGrams(qtyMg), qtyMg,
    beforeQty: mgToGrams(beforeMg), afterQty: mgToGrams(afterMg), deltaQty: mgToGrams(afterMg - beforeMg),
    beforeQtyMg: beforeMg, afterQtyMg: afterMg, deltaQtyMg: afterMg - beforeMg,
    source, notes, orderId, actorId: String(actor.id), createdAt: now(), ledgerVersion: 1,
  };
  data.inventoryTxns.push(txn);
  return txn;
};

const createLotInData = (data, payload, { actor, source = 'manual' }) => {
  assertWriter(actor);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(400, 'INVALID_COMMAND', '库存批次内容无效');
  const materialId = String(payload.materialId || payload.material_id || '');
  if (!data.materials.some((item) => String(item.id) === materialId)) fail(404, 'MATERIAL_NOT_FOUND', '耗材不存在');
  const qtyMg = readQty(payload, 0);
  const state = payload.state || payload.status || 'in_stock';
  if (!['in_stock', 'frozen'].includes(state)) fail(400, 'INVALID_COMMAND', '新批次只能设置为在库或冻结');
  const timestamp = now();
  const lot = {
    id: randomUUID(), materialId,
    lotNo: String(payload.lotNo ?? payload.lot_no ?? ''),
    serialNo: String(payload.serialNo ?? payload.serial_no ?? ''),
    location: String(payload.location ?? ''), notes: String(payload.notes ?? ''),
    photoKey: String(payload.photoKey ?? payload.photo_key ?? ''),
    qty: mgToGrams(qtyMg), qtyMg, state, active: true, version: 1,
    balanceStatus: 'tracked', ledgerBaselineQtyMg: 0, ledgerStartedAt: timestamp,
    createdAt: timestamp, updatedAt: timestamp,
  };
  data.stockLots.push(lot);
  if (qtyMg > 0) appendMovement(data, lot, {
    type: 'in', qtyMg, beforeMg: 0, afterMg: qtyMg, actor, source: 'opening',
    notes: source === 'import' ? '导入批次期初库存' : '新批次期初库存',
  });
  appendAudit(data, { actorId: String(actor.id), entity: 'stockLots', entityId: lot.id,
    action: source === 'import' ? 'create_from_import' : 'create', diff: copy(lot) });
  return lot;
};

const postTransactionInData = (data, payload, { actor }) => {
  const type = payload.type;
  assertWriter(actor, type === 'adjust');
  if (!['in', 'out', 'adjust', 'scrap'].includes(type)) fail(400, 'INVALID_COMMAND', '库存操作类型无效');
  const lot = getLot(data, payload.lotId || payload.lot_id);
  assertVersion(lot, payload.version);
  if (!isLotAvailable(lot)) {
    if (lot.balanceStatus === 'legacy_invalid') getBalanceMg(lot);
    fail(409, 'LOT_INACTIVE', '批次已停用、冻结或报废，不能过账');
  }
  const qtyMg = readQty(payload);
  if (type !== 'adjust' && qtyMg === 0) fail(400, 'INVALID_QUANTITY', '本次库存操作数量必须大于零');
  const notes = String(payload.notes || payload.reason || '');
  if (type === 'scrap' && !notes.trim()) fail(400, 'REASON_REQUIRED', '请填写原料报废原因');
  const orderId = String(payload.orderId || payload.relatedOrderId || payload.related_order_id || '');
  if (orderId && !data.orders.some((order) => String(order.id) === orderId)) fail(404, 'ORDER_NOT_FOUND', '关联订单不存在');
  const beforeMg = getBalanceMg(lot);
  const afterMg = type === 'adjust' ? qtyMg : type === 'in' ? beforeMg + qtyMg : beforeMg - qtyMg;
  if (afterMg < 0) fail(409, 'INSUFFICIENT_STOCK', '库存不足');
  if (!Number.isSafeInteger(afterMg)) fail(400, 'INVALID_QUANTITY', '库存数量超出安全范围');
  const before = copy(lot);
  lot.qtyMg = afterMg;
  lot.qty = mgToGrams(afterMg);
  if (has(lot, 'qty_g')) lot.qty_g = lot.qty;
  if (type === 'scrap' && afterMg === 0) lot.state = 'scrapped';
  lot.version = (lot.version || 1) + 1;
  lot.updatedAt = now();
  const txn = appendMovement(data, lot, { type, qtyMg, beforeMg, afterMg, actor, notes, orderId });
  appendAudit(data, { actorId: String(actor.id), entity: 'stockLots', entityId: lot.id,
    action: `inventory.${type}`, diff: { before, after: copy(lot), txn } });
  return txn;
};

const EDIT_FIELDS = ['lotNo', 'lot_no', 'serialNo', 'serial_no', 'location', 'notes', 'photoKey', 'photo_key', 'active', 'version'];
const updateLotInData = (data, id, payload, { actor }) => {
  assertWriter(actor);
  if (Object.keys(payload).some((key) => !EDIT_FIELDS.includes(key))) {
    fail(400, 'PROTECTED_LOT_FIELD', '批次编辑只能修改资料或启用状态，数量请通过库存操作修改');
  }
  const lot = getLot(data, id);
  assertVersion(lot, payload.version);
  const before = copy(lot);
  for (const [field, alias] of [['lotNo', 'lot_no'], ['serialNo', 'serial_no'], ['photoKey', 'photo_key'], ['location'], ['notes']]) {
    if (has(payload, field) || (alias && has(payload, alias))) lot[field] = String(payload[field] ?? payload[alias] ?? '');
  }
  if (has(payload, 'active')) {
    if (typeof payload.active !== 'boolean') fail(400, 'INVALID_COMMAND', '启用状态必须为布尔值');
    lot.active = payload.active;
  }
  lot.version = (lot.version || 1) + 1;
  lot.updatedAt = now();
  appendAudit(data, { actorId: String(actor.id), entity: 'stockLots', entityId: lot.id,
    action: has(payload, 'active') ? payload.active ? 'activate' : 'archive' : 'update', diff: { before, after: copy(lot) } });
  return lot;
};

const orderReferencesLot = (order, id) => [order, ...(Array.isArray(order.items) ? order.items : [])]
  .some((item) => String(item.lotId || item.lot_id || item.stockLotId || '') === String(id));
const deleteLotInData = (data, id, { actor }) => {
  assertWriter(actor);
  const lot = getLot(data, id);
  if (data.inventoryTxns.some((txn) => String(txn.lotId || txn.lot_id) === String(id))
    || data.orders.some((order) => orderReferencesLot(order, id))
    || lot.balanceStatus !== 'tracked' || getBalanceMg(lot) !== 0) {
    fail(409, 'LOT_REFERENCED', '批次有余额、历史流水或订单引用，请停用而非删除');
  }
  data.stockLots.splice(data.stockLots.indexOf(lot), 1);
  appendAudit(data, { actorId: String(actor.id), entity: 'stockLots', entityId: lot.id, action: 'delete', diff: lot });
  return { success: true };
};

// Caller must run this inside the store transaction. Exported for isolated fault tests.
const commandInData = (data, operation, payload, { actor, idempotencyKey }) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(400, 'INVALID_COMMAND', '库存操作内容无效');
  assertWriter(actor, operation === 'inventory.post' && payload.type === 'adjust');
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    fail(400, 'IDEMPOTENCY_KEY_REQUIRED', '请提供有效的库存操作幂等键，并使用同一键重试');
  }
  const digest = createHash('sha256').update(JSON.stringify(canonical({ operation, payload }))).digest('hex');
  const actorId = String(actor.id);
  const previous = data.commandReceipts.find((receipt) => receipt.actorId === actorId && receipt.key === idempotencyKey);
  if (previous) {
    if (previous.digest !== digest) fail(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求，请核对原操作');
    return copy(previous.result);
  }
  let body;
  let status = 200;
  const options = { actor };
  switch (operation) {
    case 'lot.create': body = createLotInData(data, payload, options); status = 201; break;
    case 'lots.import': {
      if (!Array.isArray(payload.lots) || !payload.lots.length) fail(400, 'INVALID_COMMAND', '没有可导入的库存批次');
      const items = payload.lots.map((lot) => createLotInData(data, lot, { actor, source: 'import' }));
      appendAudit(data, { actorId, entity: 'stock', action: 'lots.import', diff: { count: items.length } });
      body = { imported: items.length, items }; status = 201; break;
    }
    case 'inventory.post': body = postTransactionInData(data, payload, options); status = 201; break;
    case 'lot.update': body = updateLotInData(data, payload.id, payload.changes, options); break;
    case 'lot.archive': body = updateLotInData(data, payload.id, { ...payload.changes, active: false }, options); break;
    case 'lot.delete': body = deleteLotInData(data, payload.id, options); break;
    default: fail(400, 'INVALID_COMMAND', '库存操作类型无效');
  }
  const result = copy({ status, body });
  data.commandReceipts.push({ id: randomUUID(), actorId, key: idempotencyKey, operation, digest, result, createdAt: now() });
  return result;
};

const executeCommand = (operation, payload, options) => withData((data) => commandInData(data, operation, payload, options));

const inventorySummaryInData = (data, { material_type, low_stock_only = false } = {}) => data.materials
  .filter((material) => !material_type || material.type === material_type)
  .map((material) => {
    const lots = data.stockLots.filter((lot) => String(lot.materialId || lot.material_id) === String(material.id));
    const validLots = lots.filter((lot) => lot.balanceStatus !== 'legacy_invalid');
    const totalMg = validLots.reduce((sum, lot) => sum + BigInt(getBalanceMg(lot)), 0n);
    const availableMg = validLots.filter(isLotAvailable).reduce((sum, lot) => sum + BigInt(getBalanceMg(lot)), 0n);
    return {
      materialId: material.id,
      materialName: `${material.type || ''} ${material.brand || ''} ${material.color || ''}`.trim() || material.name || String(material.id),
      type: material.type, brand: material.brand, color: material.color,
      totalQty: Number(totalMg) / 1000, availableQty: Number(availableMg) / 1000,
      lotCount: lots.length, lowStock: availableMg < 100000n,
      balanceIncomplete: validLots.length !== lots.length,
      legacyUnverified: lots.some((lot) => lot.balanceStatus?.startsWith('legacy_')),
    };
  }).filter((item) => !low_stock_only || item.lowStock);
const inventorySummary = (args) => withData((data) => inventorySummaryInData(data, args), { write: false });

module.exports = {
  InventoryError, executeCommand, commandInData, createLotInData, postTransactionInData,
  updateLotInData, deleteLotInData, inventorySummary, inventorySummaryInData, isLotAvailable,
};
