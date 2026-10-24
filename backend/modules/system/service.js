'use strict';
const { withBusinessTransaction } = require('../../business-db/transaction');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createBusinessCommands } = require('../../business-db/commands');
const { createVersionedUpdater } = require('../../business-db/versioned');
const { readBusinessWriteState } = require('../../business-db/maintenance');
const orders = require('../orders/repository');
const v = require('../catalog/validation');
const update = createVersionedUpdater({ 'erp.installation': ['organization_name'] });
async function installation(tx) {
  return (await tx.query("SELECT server_id,organization_name,initialized_at,storage_mode,version FROM erp.installation WHERE id='default'")).rows[0];
}
async function organization(tx) {
  const row = await installation(tx);
  if (!row) v.fail('系统尚未初始化', 'SYSTEM_NOT_INITIALIZED', 409);
  if (row.storage_mode !== 'relational') v.fail('关系业务入口尚未启用', 'RELATIONAL_STORAGE_NOT_ACTIVE', 503);
  return { serverId: row.server_id, organizationName: row.organization_name, version: row.version };
}
function createSystemService(pool) {
  return {
    execute: createBusinessCommands(pool, { 'organization.update': { roles: ['owner'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['version', 'organizationName'], ['version', 'organizationName']);
      const name = v.string(payload.organizationName, { required: true, trim: true, max: 120 });
      const before = await organization(tx);
      await update(tx, { table: 'erp.installation', id: 'default', expectedVersion: payload.version, changes: { organization_name: name } });
      await audit({ entity: 'system', entityId: before.serverId, action: 'organization.update', diff: { before: before.organizationName, after: name } });
      return { status: 200, body: await organization(tx) };
    } } }),
    organization: session => withAuthenticatedRead(pool, session, organization),
    publicStatus: () => withBusinessTransaction(pool, async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = await installation(tx);
      const writeState = row ? await readBusinessWriteState(tx) : 'open';
      return { serverId: row?.server_id ?? null, organizationName: row?.organization_name ?? '',
        organizationVersion: row?.version ?? null, initialized: Boolean(row?.initialized_at), storageMode: row?.storage_mode ?? 'legacy',
        maintenance: writeState === 'maintenance', businessWritable: row?.storage_mode === 'relational' && writeState === 'open' };
    }),
    dashboard: session => withAuthenticatedRead(pool, session, async tx => {
      const counts = (await tx.query("SELECT count(*) FILTER(WHERE status='pending_review')::int AS pending_review,count(*) FILTER(WHERE status='in_progress')::int AS in_progress FROM erp.orders WHERE active")).rows[0];
      const stock = (await tx.query("SELECT count(*)::int AS low_stock FROM erp.stock_lots WHERE active AND state='in_stock' AND balance_status<>'legacy_invalid' AND qty_mg<=100000")).rows[0];
      const rows = (await tx.query(`SELECT ${orders.COLUMNS} FROM erp.orders WHERE active ORDER BY created_at DESC,id DESC LIMIT 4`)).rows;
      const recentOrders = [];
      for (const row of rows) recentOrders.push(await orders.detail(tx, row));
      return { stats: { pendingReview: counts.pending_review, inProgress: counts.in_progress, lowStock: stock.low_stock }, recentOrders };
    }),
  };
}
module.exports = { createSystemService };
