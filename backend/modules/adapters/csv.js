'use strict';
const { parseCsv, writeCsv } = require('./csvCodec');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createMaterialService } = require('../materials/service');
const { createModelService } = require('../models/service');
const { createOrderService } = require('../orders/service');
const { createInventoryService } = require('../inventory/service');
const { multiplyToCents, sumCents, parseScaled } = require('../../business-db/decimal');
const { formatGrams } = require('../inventory/quantity');
const v = require('../catalog/validation');

// IDs and lifecycle columns are for reference; CSV always creates new records.
const reference = ['id', 'version', 'active', 'created_at', 'updated_at'];
const definitions = {
  materials: { table: 'materials', columns: [...reference, 'code', 'name', 'type', 'brand', 'color', 'diameter', 'density', 'unit', 'unit_price', 'notes'],
    required: ['type', 'brand', 'color', 'unit_price'], operation: 'material.import',
    mapping: { code: 'code', name: 'name', type: 'type', brand: 'brand', color: 'color', diameter: 'diameter', density: 'density', unit: 'unit', unit_price: 'unitPrice', notes: 'notes' } },
  models: { table: 'models', columns: [...reference, 'name', 'description', 'source', 'file_count', 'image_count'],
    required: ['name'], operation: 'model.import', mapping: { name: 'name', description: 'description', source: 'source' } },
  lots: { table: 'stock_lots', columns: [...reference, 'material_id', 'warehouse_id', 'lot_no', 'serial_no', 'location', 'notes', 'qty_g', 'balance_status', 'state'],
    required: ['material_id', 'qty_g'], operation: 'lots.import', mapping: { material_id: 'materialId', warehouse_id: 'warehouseId', lot_no: 'lotNo', serial_no: 'serialNo', location: 'location', notes: 'notes', qty_g: 'qty_g', state: 'state' } },
  orders: { table: 'orders', columns: ['order_id', 'number', 'version', 'active', 'customer_id', 'customer_name', 'status', 'currency', 'notes', 'due_date', 'total', 'created_at', 'updated_at',
    'line_id', 'model_id', 'model_name', 'quantity', 'unit_price', 'subtotal', 'material_type', 'color', 'layer_height_mm', 'external_file_url', 'line_notes'],
    required: ['order_id', 'customer_id', 'quantity', 'unit_price'], operation: 'order.import' },
  transactions: { table: 'inventory_txns', columns: ['id', 'lot_id', 'order_id', 'actor_id', 'legacy_actor_id', 'type', 'qty_mg', 'before_qty_mg', 'after_qty_mg', 'delta_qty_mg', 'ledger_version', 'posting_seq', 'source', 'notes', 'created_at'] },
};
function definition(kind) {
  if (!Object.hasOwn(definitions, kind)) v.fail('不支持的 CSV 资料类型');
  return definitions[kind];
}
function mapped(row, mapping) {
  return Object.fromEntries(Object.entries(mapping).filter(([key]) => Object.hasOwn(row, key)).map(([key, target]) => [target, row[key]]));
}
function sameMoney(input, calculated) {
  if (input !== undefined && input !== '' && parseScaled(input, 2, 18) !== parseScaled(calculated, 2, 18)) v.fail('CSV 金额与数量和单价的计算结果不一致', 'CSV_AMOUNT_MISMATCH');
}
function ordersFromRows(rows) {
  const groups = new Map();
  const orderFields = ['customer_id', 'status', 'currency', 'notes', 'due_date', 'total'];
  for (const row of rows) {
    const groupId = v.id(row.order_id);
    let group = groups.get(groupId);
    if (!group) {
      group = { first: row, items: [], subtotals: [] }; groups.set(groupId, group);
    } else if (orderFields.some(key => row[key] !== group.first[key])) v.fail('同一订单各行的客户、状态、金额或备注不一致', 'CSV_ORDER_INCONSISTENT');
    const item = mapped(row, { model_id: 'modelId', model_name: 'modelName', quantity: 'quantity', unit_price: 'unitPrice', material_type: 'materialType',
      color: 'color', layer_height_mm: 'layerHeightMm', external_file_url: 'externalFileUrl', line_notes: 'notes' });
    const subtotal = multiplyToCents(item.quantity, item.unitPrice);
    sameMoney(row.subtotal, subtotal);
    group.items.push(item); group.subtotals.push(subtotal);
  }
  return [...groups.values()].map(({ first, items, subtotals }) => {
    sameMoney(first.total, sumCents(subtotals));
    const payload = mapped(first, { customer_id: 'customerId', status: 'status', currency: 'currency', notes: 'notes', due_date: 'dueDate' });
    return { ...payload, items };
  });
}
function createCsvAdapter(pool, options = {}) {
  const services = { materials: createMaterialService(pool), models: createModelService(pool, options), orders: createOrderService(pool, options), lots: createInventoryService(pool, options) };
  return {
    async importRecords(session, kind, text, key) {
      const def = definition(kind);
      if (!def.operation) v.fail('历史流水只允许导出，不能通过 CSV 重写');
      const rows = parseCsv(text, { allowedHeaders: def.columns, requiredHeaders: def.required });
      if (!rows.length) v.fail('CSV 没有可导入的数据');
      // Reference fields never restore disabled/unknown balances or immutable history.
      if (rows.some(row => row.active !== undefined && row.active !== '' && row.active !== 'true')) v.fail('请单独处理停用资料，不能将其作为启用的新资料导入');
      if (kind === 'lots' && rows.some(row => row.balance_status && row.balance_status !== 'tracked')) v.fail('历史库存余额需要迁移核对，不能作为期初库存导入');
      const items = kind === 'orders' ? ordersFromRows(rows) : rows.map(row => mapped(row, def.mapping));
      return services[kind].execute({ actorId: session?.actorId, tokenVersion: session?.tokenVersion, key, operation: def.operation,
        payload: kind === 'lots' ? { lots: items } : { items } });
    },
    async exportRecords(session, kind, query = {}) {
      const def = definition(kind);
      v.fields(query, ['search', 'active']);
      const { search, active } = v.page(query);
      return withAuthenticatedRead(pool, session, async (tx, actor) => {
        if (actor.role !== 'owner') v.fail('只有 Owner 可以批量导出资料', 'BUSINESS_FORBIDDEN', 403);
        let rows;
        // One repeatable-read snapshot for the entire export, with no 200-row page truncation.
        if (kind === 'orders') {
          rows = (await tx.query(`SELECT o.id AS order_id,o.number,o.version::text,o.active,o.customer_id,o.customer_snapshot->>'name' AS customer_name,
            o.status,o.currency,o.notes,o.due_date,o.total::text,o.created_at,o.updated_at,i.id AS line_id,i.model_id,i.model_name_snapshot AS model_name,
            i.quantity::text,i.unit_price::text,i.subtotal::text,i.spec_snapshot->>'materialType' AS material_type,i.spec_snapshot->>'color' AS color,
            i.spec_snapshot->>'layerHeightMm' AS layer_height_mm,i.spec_snapshot->>'externalFileUrl' AS external_file_url,i.spec_snapshot->>'notes' AS line_notes
            FROM erp.orders o LEFT JOIN erp.order_items i ON i.order_id=o.id
            WHERE ($1::text='' OR position(lower($1) in lower(concat_ws(' ',o.id,o.number,o.customer_snapshot->>'name',o.notes)))>0)
            AND ($2::boolean IS NULL OR o.active=$2) ORDER BY o.created_at DESC,o.id,i.position`, [search, active])).rows;
        } else if (kind === 'models') {
          rows = (await tx.query(`SELECT m.id,m.version::text,m.active,m.created_at,m.updated_at,m.name,m.description,m.source,
            (SELECT count(*)::text FROM erp.model_files f WHERE f.model_id=m.id) AS file_count,
            (SELECT count(*)::text FROM erp.model_images f WHERE f.model_id=m.id) AS image_count FROM erp.models m
            WHERE ($1::text='' OR position(lower($1) in lower(concat_ws(' ',m.name,m.description)))>0
              OR EXISTS(SELECT 1 FROM erp.model_files f WHERE f.model_id=m.id AND position(lower($1) in lower(coalesce(f.metadata->>'name','')))>0))
            AND ($2::boolean IS NULL OR m.active=$2) ORDER BY m.created_at DESC,m.id`, [search, active])).rows;
        } else if (kind === 'materials') {
          rows = (await tx.query(`SELECT id,version::text,active,created_at,updated_at,code,name,type,brand,color,diameter::text,density::text,unit,unit_price::text,notes
            FROM erp.materials WHERE ($1::text='' OR position(lower($1) in lower(concat_ws(' ',name,type,brand,color,notes,code)))>0)
            AND ($2::boolean IS NULL OR active=$2) ORDER BY created_at DESC,id`, [search, active])).rows;
        } else if (kind === 'lots') {
          rows = (await tx.query(`SELECT id,version::text,active,created_at,updated_at,material_id,warehouse_id,lot_no,serial_no,location,notes,qty_mg,balance_status,state
            FROM erp.stock_lots WHERE ($1::text='' OR position(lower($1) in lower(concat_ws(' ',id,lot_no,serial_no,location,notes)))>0)
            AND ($2::boolean IS NULL OR active=$2) ORDER BY created_at DESC,id`, [search, active])).rows.map(row => ({ ...row, qty_g: formatGrams(row.qty_mg) }));
        } else {
          if (active !== null) v.fail('历史流水不支持启用状态筛选');
          rows = (await tx.query(`SELECT id,lot_id,order_id,actor_id,legacy_actor_id,type,qty_mg,before_qty_mg,after_qty_mg,delta_qty_mg,
            ledger_version::text,posting_seq::text,source,notes,created_at FROM erp.inventory_txns
            WHERE ($1::text='' OR position(lower($1) in lower(concat_ws(' ',id,lot_id,order_id,type,notes)))>0)
            ORDER BY created_at DESC,id`, [search])).rows;
        }
        const content = writeCsv(def.columns, rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, v.iso(value)]))));
        return { filename: `${kind}.csv`, contentType: 'text/csv; charset=utf-8', count: rows.length, content };
      });
    },
  };
}
module.exports = { createCsvAdapter };
