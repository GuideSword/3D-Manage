'use strict';
const v = require('../catalog/validation');
const { formatGrams } = require('./quantity');
const LOT_COLUMNS = 'id,material_id,warehouse_id,lot_no,serial_no,location,notes,photo_key,qty_mg,baseline_qty_mg,balance_status,state,active,version,ledger_started_at,created_at,updated_at,legacy_payload::text AS legacy_raw';
const TXN_COLUMNS = `t.id,t.lot_id,t.order_id,t.actor_id,t.legacy_actor_id,t.type,t.qty_mg,t.before_qty_mg,t.after_qty_mg,
  t.delta_qty_mg,t.ledger_version,t.posting_seq,t.source,t.notes,t.created_at,t.legacy_payload::text AS legacy_raw,l.material_id`;
function lotDTO(row) {
  const legacy = v.legacy(row.legacy_raw);
  return { ...legacy, ...(row.balance_status === 'legacy_invalid' ? { legacyBalance: legacy.qty ?? legacy.qty_g ?? null } : {}),
    id: row.id, materialId: row.material_id, material_id: row.material_id, warehouseId: row.warehouse_id,
    lotNo: row.lot_no, lot_no: row.lot_no, serialNo: row.serial_no, serial_no: row.serial_no,
    location: row.location, notes: row.notes, photoKey: row.photo_key, photo_key: row.photo_key,
    qtyMg: row.qty_mg, qty: formatGrams(row.qty_mg), qty_g: formatGrams(row.qty_mg),
    ledgerBaselineQtyMg: row.baseline_qty_mg, balanceStatus: row.balance_status,
    state: row.state, status: row.state, active: row.active, version: row.version,
    ledgerStartedAt: v.iso(row.ledger_started_at), createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at) };
}
function txnDTO(row) {
  const legacy = v.legacy(row.legacy_raw);
  const historical = row.ledger_version === null;
  return { ...legacy, id: row.id, lotId: row.lot_id, materialId: row.material_id, orderId: row.order_id || '',
    actorId: row.actor_id || row.legacy_actor_id || '', type: row.type, source: row.source, notes: row.notes,
    qty: historical ? legacy.qty ?? legacy.qty_g ?? null : formatGrams(row.qty_mg), qtyMg: row.qty_mg,
    beforeQty: formatGrams(row.before_qty_mg), beforeQtyMg: row.before_qty_mg,
    afterQty: formatGrams(row.after_qty_mg), afterQtyMg: row.after_qty_mg,
    deltaQty: formatGrams(row.delta_qty_mg), deltaQtyMg: row.delta_qty_mg,
    ledgerVersion: row.ledger_version, legacy: historical, postingSequence: row.posting_seq,
    orderingVerified: row.posting_seq !== null, createdAt: v.iso(row.created_at) };
}
async function lotRow(tx, id, lock = false) {
  const row = (await tx.query(`SELECT ${LOT_COLUMNS} FROM erp.stock_lots WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [v.id(id)])).rows[0];
  if (!row) v.fail('库存批次不存在', 'ENTITY_NOT_FOUND', 404);
  return row;
}
const get = async (tx, id) => lotDTO(await lotRow(tx, id));
async function getTransaction(tx, id) {
  const row = (await tx.query(`SELECT ${TXN_COLUMNS} FROM erp.inventory_txns t JOIN erp.stock_lots l ON l.id=t.lot_id WHERE t.id=$1`, [v.id(id)])).rows[0];
  if (!row) v.fail('库存流水不存在', 'ENTITY_NOT_FOUND', 404);
  return txnDTO(row);
}
module.exports = { LOT_COLUMNS, TXN_COLUMNS, lotDTO, txnDTO, lotRow, get, getTransaction };
