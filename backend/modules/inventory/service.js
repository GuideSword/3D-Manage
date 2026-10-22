'use strict';
const { randomUUID } = require('node:crypto');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater, createVersionedDeleter } = require('../../business-db/versioned');
const { verifyUploadedFile } = require('../catalog/files');
const v = require('../catalog/validation');
const repo = require('./repository');
const { readQuantity } = require('./quantity');
const { appendMovement, postMovement, aliasId } = require('./movements');
const { list, listTransactions, summary } = require('./views');
const INFO = ['lotNo', 'lot_no', 'serialNo', 'serial_no', 'location', 'notes', 'photoKey', 'photo_key'];
const update = createVersionedUpdater({ 'erp.stock_lots': ['lot_no', 'serial_no', 'location', 'notes', 'photo_key', 'active', 'state'] }, { touchUpdatedAt: true });
const remove = createVersionedDeleter(['erp.stock_lots']);
function textAlias(input, a, b) {
  const value = v.string(input[a] ?? input[b]);
  if (Object.hasOwn(input, a) && Object.hasOwn(input, b) && v.string(input[a]) !== v.string(input[b])) v.fail('批次资料字段不一致');
  return value;
}
async function info(input, uploadDirectory) {
  const values = {};
  for (const [field, alias, column] of [['lotNo', 'lot_no', 'lot_no'], ['serialNo', 'serial_no', 'serial_no'], ['photoKey', 'photo_key', 'photo_key'], ['location', null, 'location'], ['notes', null, 'notes']]) {
    if (!Object.hasOwn(input, field) && !(alias && Object.hasOwn(input, alias))) continue;
    values[column] = textAlias(input, field, alias);
    if (column === 'photo_key' && values[column]) values[column] = (await verifyUploadedFile({ fileKey: values[column] }, uploadDirectory)).fileKey;
  }
  return values;
}
function expectedVersion(payload) {
  const nested = payload.changes?.version;
  if (payload.version !== undefined && nested !== undefined && String(payload.version) !== String(nested)) v.fail('批次版本字段不一致', 'VERSION_INVALID');
  return payload.version ?? nested;
}
function inventoryCommands({ uploadDirectory } = {}) {
  async function create(tx, { payload, actor, audit }, { importing = false } = {}) {
    v.fields(payload, ['materialId', 'material_id', 'warehouseId', 'qty', 'qty_g', 'unit', 'state', 'status', ...INFO]);
    const materialId = aliasId(payload, ['materialId', 'material_id']);
    if (!materialId || !(await tx.query('SELECT id FROM erp.materials WHERE id=$1 AND active FOR SHARE', [materialId])).rows.length) {
      v.fail('耗材不存在或已停用', 'MATERIAL_UNAVAILABLE', 409);
    }
    const warehouse = (await tx.query('SELECT id FROM erp.warehouses WHERE is_default AND active FOR SHARE')).rows[0];
    if (!warehouse) v.fail('默认仓库尚未建立', 'DEFAULT_WAREHOUSE_MISSING', 409);
    if (payload.warehouseId !== undefined && payload.warehouseId !== warehouse.id) v.fail('首版库存只能使用默认仓库', 'INVALID_WAREHOUSE');
    const state = payload.state ?? payload.status ?? 'in_stock';
    if (!['in_stock', 'frozen'].includes(state) || (payload.state !== undefined && payload.status !== undefined && payload.state !== payload.status)) v.fail('新批次只能设为在库或冻结');
    const qtyMg = readQuantity(payload, '0');
    const values = { id: randomUUID(), material_id: materialId, warehouse_id: warehouse.id, qty_mg: String(qtyMg),
      baseline_qty_mg: '0', balance_status: 'tracked', state, ...await info(payload, uploadDirectory) };
    const names = Object.keys(values);
    await tx.query(`INSERT INTO erp.stock_lots(${names.join(',')},ledger_started_at) VALUES(${names.map((_, i) => `$${i + 1}`).join(',')},clock_timestamp())`, Object.values(values));
    if (qtyMg > 0n) await appendMovement(tx, { lotId: values.id, actor, type: 'in', qtyMg, beforeMg: 0n, afterMg: qtyMg,
      source: 'opening', notes: importing ? '导入批次期初库存' : '新批次期初库存' });
    const lot = await repo.get(tx, values.id);
    await audit({ entity: 'stockLots', entityId: lot.id, action: importing ? 'create_from_import' : 'create', diff: lot });
    return { status: 201, body: lot };
  }
  async function edit(tx, { payload, audit }, archive = false) {
    v.fields(payload, ['id', 'version', 'changes'], archive ? ['id'] : ['id', 'changes']);
    const changes = v.fields(payload.changes ?? {}, [...INFO, 'active', 'version']);
    const columns = await info(changes, uploadDirectory);
    if (Object.hasOwn(changes, 'active')) columns.active = v.boolean(changes.active);
    if (archive) columns.active = false;
    if (!Object.keys(columns).length) v.fail('至少填写一个修改字段');
    const row = await repo.lotRow(tx, payload.id, true);
    if (row.balance_status === 'legacy_invalid' && columns.active === true) v.fail('历史余额无效，不能启用', 'LEGACY_BALANCE_INVALID', 409);
    await update(tx, { table: 'erp.stock_lots', id: payload.id, expectedVersion: expectedVersion(payload), changes: columns });
    const lot = await repo.get(tx, payload.id);
    await audit({ entity: 'stockLots', entityId: lot.id, action: archive ? 'archive' : Object.hasOwn(columns, 'active') ? lot.active ? 'activate' : 'archive' : 'update',
      diff: { before: repo.lotDTO(row), after: lot } });
    return { status: 200, body: lot };
  }
  const commands = {
    'lot.create': { handle: create },
    'lots.import': { async handle(tx, context) {
      v.fields(context.payload, ['lots'], ['lots']);
      const rows = context.payload.lots;
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000) v.fail('一次导入需要 1 至 1000 个批次');
      const items = [];
      for (const payload of rows) items.push((await create(tx, { ...context, payload }, { importing: true })).body);
      return { status: 201, body: { imported: items.length, items } };
    } },
    'inventory.post': { authorize: (actor, payload) => !['adjust', 'scrap'].includes(payload.type) || actor.role === 'owner', handle: postMovement },
    'lot.update': { handle: edit },
    'lot.archive': { handle: (tx, context) => edit(tx, context, true) },
    'lot.setState': { async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'state'], ['id', 'version', 'state']);
      if (!['in_stock', 'frozen'].includes(payload.state)) v.fail('状态只能在在库与冻结之间切换');
      const row = await repo.lotRow(tx, payload.id, true);
      if (row.balance_status === 'legacy_invalid') v.fail('历史余额无效，不能更改可用状态', 'LEGACY_BALANCE_INVALID', 409);
      if (row.state === 'scrapped') v.fail('已报废批次不能恢复，请新建批次入库', 'LOT_INACTIVE', 409);
      await update(tx, { table: 'erp.stock_lots', id: payload.id, expectedVersion: payload.version, changes: { state: payload.state } });
      const lot = await repo.get(tx, payload.id);
      await audit({ entity: 'stockLots', entityId: lot.id, action: 'state', diff: { before: row.state, after: lot.state } });
      return { status: 200, body: lot };
    } },
    'lot.delete': { async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version'], ['id']);
      let before;
      await remove(tx, { table: 'erp.stock_lots', id: payload.id, expectedVersion: payload.version, beforeDelete: async (client, row) => {
        if (row.balance_status !== 'tracked' || row.qty_mg !== '0'
            || (await client.query('SELECT 1 FROM erp.inventory_txns WHERE lot_id=$1 LIMIT 1', [payload.id])).rows.length) v.fail('批次有余额或历史记录，请停用而非删除', 'LOT_REFERENCED', 409);
        const references = await client.query(`SELECT 1 FROM erp.orders WHERE legacy_payload->>'lotId'=$1 OR legacy_payload->>'lot_id'=$1 OR legacy_payload->>'stockLotId'=$1
          UNION ALL SELECT 1 FROM erp.order_items WHERE spec_snapshot->>'lotId'=$1 OR spec_snapshot->>'lot_id'=$1 OR spec_snapshot->>'stockLotId'=$1 LIMIT 1`, [payload.id]);
        if (references.rows.length) v.fail('订单历史引用了该批次，请停用而非删除', 'LOT_REFERENCED', 409);
        before = repo.lotDTO(row);
      } });
      await audit({ entity: 'stockLots', entityId: payload.id, action: 'delete', diff: { before } });
      return { status: 200, body: { success: true } };
    } },
  };
  return Object.fromEntries(Object.entries(commands).map(([operation, definition]) => [operation, { roles: ['owner', 'staff'], scope: 'inventory', ...definition }]));
}
function createInventoryService(pool, options = {}) {
  return { execute: createBusinessCommands(pool, inventoryCommands(options)),
    get: (session, id) => withAuthenticatedRead(pool, session, tx => repo.get(tx, id)),
    list: (session, query = {}) => withAuthenticatedRead(pool, session, tx => list(tx, query)),
    getTransaction: (session, id) => withAuthenticatedRead(pool, session, tx => repo.getTransaction(tx, id)),
    listTransactions: (session, query = {}) => withAuthenticatedRead(pool, session, tx => listTransactions(tx, query)),
    summary: (session, query = {}) => withAuthenticatedRead(pool, session, tx => summary(tx, query)),
    getReceipt: (session, key) => withAuthenticatedRead(pool, session, async (tx, actor) => {
      if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) v.fail('操作标识无效');
      const row = (await tx.query("SELECT result FROM erp.command_receipts WHERE scope='inventory' AND actor_id=$1 AND key=$2", [actor.id, key])).rows[0];
      if (!row) v.fail('未找到当前账号的操作回执', 'COMMAND_NOT_FOUND', 404);
      return row.result;
    }),
  };
}
module.exports = { createInventoryService, inventoryCommands };
