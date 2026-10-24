'use strict';
const v = require('../catalog/validation');
const repo = require('./repository');
const { formatGrams } = require('./quantity');
async function list(tx, query) {
  const { search, active, limit, offset } = v.page(query, ['materialId', 'state', 'warehouseId', 'balanceStatus']);
  const materialId = query.materialId == null ? null : v.id(query.materialId);
  const warehouseId = query.warehouseId == null ? null : v.id(query.warehouseId);
  const state = query.state ?? null;
  const balanceStatus = query.balanceStatus ?? null;
  if (state !== null && !['in_stock', 'frozen', 'scrapped'].includes(state)) v.fail('批次状态筛选无效');
  if (balanceStatus !== null && !['tracked', 'legacy_unverified', 'legacy_invalid'].includes(balanceStatus)) v.fail('余额状态筛选无效');
  const where = `($1::text='' OR position(lower($1) in lower(concat_ws(' ',id,lot_no,serial_no,location,notes)))>0)
    AND ($2::boolean IS NULL OR active=$2) AND ($3::text IS NULL OR material_id=$3) AND ($4::text IS NULL OR state=$4)
    AND ($5::text IS NULL OR warehouse_id=$5) AND ($6::text IS NULL OR balance_status=$6)`;
  const params = [search, active, materialId, state, warehouseId, balanceStatus];
  const total = (await tx.query(`SELECT count(*)::int AS n FROM erp.stock_lots WHERE ${where}`, params)).rows[0].n;
  const rows = (await tx.query(`SELECT ${repo.LOT_COLUMNS} FROM erp.stock_lots WHERE ${where} ORDER BY created_at DESC,id LIMIT $7 OFFSET $8`, [...params, limit, offset])).rows;
  return { items: rows.map(repo.lotDTO), total };
}
async function listTransactions(tx, query) {
  const { search, active, limit, offset } = v.page(query, ['lotId', 'materialId', 'type', 'orderId']);
  const params = [search, active, query.lotId == null ? null : v.id(query.lotId), query.materialId == null ? null : v.id(query.materialId),
    query.type == null ? null : v.string(query.type, { required: true, max: 50 }), query.orderId == null ? null : v.id(query.orderId)];
  const from = 'FROM erp.inventory_txns t JOIN erp.stock_lots l ON l.id=t.lot_id';
  const where = `($1::text='' OR position(lower($1) in lower(concat_ws(' ',t.id,l.lot_no,t.notes)))>0)
    AND ($2::boolean IS NULL OR l.active=$2) AND ($3::text IS NULL OR t.lot_id=$3) AND ($4::text IS NULL OR l.material_id=$4)
    AND ($5::text IS NULL OR t.type=$5) AND ($6::text IS NULL OR t.order_id=$6)`;
  const total = (await tx.query(`SELECT count(*)::int AS n ${from} WHERE ${where}`, params)).rows[0].n;
  const rows = (await tx.query(`SELECT ${repo.TXN_COLUMNS} ${from} WHERE ${where} ORDER BY t.posting_seq DESC NULLS LAST,t.created_at DESC,t.id LIMIT $7 OFFSET $8`, [...params, limit, offset])).rows;
  return { items: rows.map(repo.txnDTO), total };
}
async function summary(tx, query) {
  v.fields(query, ['materialId', 'materialType', 'material_type', 'lowStockOnly', 'low_stock_only']);
  const materialId = query.materialId == null ? null : v.id(query.materialId);
  const type = v.string(query.materialType ?? query.material_type);
  const lowStockOnly = query.lowStockOnly ?? query.low_stock_only ?? false;
  v.boolean(lowStockOnly);
  const rows = (await tx.query(`SELECT m.id,m.type,m.brand,m.color,m.name,m.active,m.unit,
    count(l.id)::int AS lot_count,
    coalesce(sum(l.qty_mg) FILTER(WHERE l.balance_status<>'legacy_invalid'),0)::text AS total_mg,
    coalesce(sum(l.qty_mg) FILTER(WHERE l.balance_status<>'legacy_invalid' AND l.active AND l.state='in_stock'),0)::text AS available_mg,
    coalesce(bool_or(l.balance_status='legacy_invalid'),false) AS incomplete,
    coalesce(bool_or(l.balance_status IN ('legacy_unverified','legacy_invalid')),false) AS unverified
    FROM erp.materials m LEFT JOIN erp.stock_lots l ON l.material_id=m.id
    WHERE ($1::text IS NULL OR m.id=$1) AND ($2::text='' OR m.type=$2)
    GROUP BY m.id ORDER BY m.id`, [materialId, type])).rows;
  return rows.map(row => ({ materialId: row.id, materialName: [row.type, row.brand, row.color].filter(Boolean).join(' ') || row.name || row.id,
    type: row.type, brand: row.brand, color: row.color, materialActive: row.active, displayUnit: row.unit, unit: 'g',
    lotCount: row.lot_count, totalQtyMg: row.total_mg, availableQtyMg: row.available_mg,
    totalQty: formatGrams(row.total_mg), availableQty: formatGrams(row.available_mg),
    lowStock: BigInt(row.available_mg) < 100000n, balanceIncomplete: row.incomplete, legacyUnverified: row.unverified }))
    .filter(row => !lowStockOnly || row.lowStock);
}
module.exports = { list, listTransactions, summary };
