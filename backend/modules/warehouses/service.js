'use strict';
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const update = createVersionedUpdater({ 'erp.warehouses': ['name'] }, { touchUpdatedAt: true });
async function getDefault(tx, lock = false) {
  const row = (await tx.query('SELECT id,code,name,is_default,active,version,created_at,updated_at FROM erp.warehouses WHERE is_default AND active' + (lock ? ' FOR UPDATE' : ''))).rows[0];
  if (!row) v.fail('默认仓库尚未建立', 'DEFAULT_WAREHOUSE_MISSING', 409);
  return { id: row.id, code: row.code, name: row.name, isDefault: row.is_default, active: row.active, version: row.version,
    createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at) };
}
function createWarehouseService(pool) {
  return {
    getDefault: session => withAuthenticatedRead(pool, session, tx => getDefault(tx)),
    execute: createBusinessCommands(pool, { 'warehouse.update': { roles: ['owner'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'changes'], ['id', 'version', 'changes']);
      v.fields(payload.changes, ['name'], ['name']);
      const name = v.string(payload.changes.name, { required: true, trim: true, max: 240 });
      const before = await getDefault(tx, true);
      if (payload.id !== before.id) v.fail('只能修改当前默认仓库', 'ENTITY_NOT_FOUND', 404);
      await update(tx, { table: 'erp.warehouses', id: payload.id, expectedVersion: payload.version, changes: { name } });
      const item = await getDefault(tx);
      await audit({ entity: 'warehouses', entityId: item.id, action: 'update', diff: { before: { name: before.name }, after: { name } } });
      return { status: 200, body: item };
    } } }),
  };
}
module.exports = { createWarehouseService };
