'use strict';
const { randomUUID } = require('node:crypto');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater, createVersionedDeleter } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const repo = require('./repository');
const { normalizeLines, saveLines } = require('./lines');
const { addAttachment, removeAttachment } = require('./attachments');
const bump = createVersionedUpdater({ 'erp.orders': ['notes'] }, { touchUpdatedAt: true, allowEmptyChanges: true });
const remove = createVersionedDeleter(['erp.orders']);
const TRANSITIONS = Object.freeze({ draft: ['pending_review', 'cancelled'], pending_review: ['in_progress', 'cancelled', 'draft'],
  in_progress: ['completed', 'cancelled', 'pending_review', 'draft'], completed: ['in_progress', 'pending_review', 'draft', 'cancelled'], cancelled: ['draft'] });

function dueDate(value) {
  if (value == null || value === '') return null;
  const input = v.string(value, { max: 30 });
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(input)
      || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString().slice(0, 10) !== input.slice(0, 10)) v.fail('日期格式或日期值无效');
  return input;
}
function orderStatus(value) {
  if (typeof value !== 'string' || !Object.hasOwn(TRANSITIONS, value)) v.fail('订单状态无效');
  return value;
}
function validateOrderProposalChanges(input) {
  v.fields(input, ['notes', 'dueDate', 'status', 'reason']);
  if (!Object.keys(input).length || (Object.hasOwn(input, 'reason') && !Object.hasOwn(input, 'status'))) v.fail('修改字段为空或缺少对应状态');
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, key === 'dueDate' ? dueDate(value) : key === 'status' ? orderStatus(value) : v.string(value)]));
}
async function lockOrder(tx, payload) {
  await tx.query('SELECT id FROM erp.orders WHERE id=$1 FOR UPDATE', [v.id(payload.id)]);
  return bump(tx, { table: 'erp.orders', id: payload.id, expectedVersion: payload.version, changes: {} });
}
async function commercialEditable(tx, order) {
  if (!['draft', 'pending_review'].includes(order.status)
      || (await tx.query('SELECT 1 FROM erp.inventory_txns WHERE order_id=$1 LIMIT 1', [order.id])).rows.length) {
    v.fail('订单已进入执行或已有库存记录，只能修改说明性资料', 'ORDER_COMMERCIAL_LOCKED', 409);
  }
}
async function customerSnapshot(tx, id) {
  const row = (await tx.query(`SELECT active,jsonb_build_object('id',id,'code',code,'name',name,'contactName',contact_name,
    'email',email,'phone',phone,'address',address)::text AS snapshot FROM erp.customers WHERE id=$1 FOR SHARE`, [v.id(id)])).rows[0];
  if (!row || !row.active) v.fail('所选客户不存在或已停用', 'CUSTOMER_UNAVAILABLE', 409);
  return row.snapshot;
}
const resolveModel = tx => async id => (await tx.query('SELECT id,name,active FROM erp.models WHERE id=$1 FOR SHARE', [id])).rows[0];
async function setColumns(tx, id, values) {
  const columns = Object.keys(values);
  if (!columns.length) return;
  await tx.query(`UPDATE erp.orders SET ${columns.map((column, i) => `${column}=$${i + 2}`).join(',')} WHERE id=$1`, [id, ...Object.values(values)]);
}

function orderCommands({ uploadDirectory } = {}) {
  async function create(tx, { payload, actor, audit }) {
    v.fields(payload, ['customerId', 'items', 'currency', 'status', 'notes', 'dueDate'], ['customerId', 'items']);
    if (payload.currency !== undefined && payload.currency !== 'CNY') v.fail('当前只支持人民币订单');
    const status = payload.status ?? 'draft';
    if (!['draft', 'pending_review'].includes(status)) v.fail('新订单只能处于草稿或待审核状态');
    const snapshot = await customerSnapshot(tx, payload.customerId);
    const normalized = await normalizeLines(payload.items, { resolveModel: resolveModel(tx) });
    const id = randomUUID();
    await tx.query(`INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,notes,due_date,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, `SO-${id}`, payload.customerId, snapshot, status, normalized.total,
      v.string(payload.notes), dueDate(payload.dueDate), actor.id]);
    await saveLines(tx, id, normalized);
    const item = await repo.get(tx, id);
    await audit({ entity: 'orders', entityId: id, action: 'create', diff: item });
    return { status: 201, body: item };
  }
  const commands = {
    'order.create': { roles: ['owner', 'staff'], handle: create },
    'order.update': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'changes'], ['id', 'version', 'changes']);
      const changes = v.fields(payload.changes, ['customerId', 'items', 'notes', 'dueDate']);
      if (!Object.keys(changes).length) v.fail('至少填写一个修改字段');
      const current = await lockOrder(tx, payload);
      const columns = {};
      if (Object.hasOwn(changes, 'notes')) columns.notes = v.string(changes.notes);
      if (Object.hasOwn(changes, 'dueDate')) columns.due_date = dueDate(changes.dueDate);
      if (Object.hasOwn(changes, 'customerId') && changes.customerId !== current.customer_id) {
        await commercialEditable(tx, current);
        columns.customer_id = v.id(changes.customerId);
        columns.customer_snapshot = await customerSnapshot(tx, changes.customerId);
      }
      if (Object.hasOwn(changes, 'items')) {
        const previous = await repo.lineRows(tx, payload.id);
        const onlyDescriptions = Array.isArray(changes.items) && changes.items.length === previous.length
          && changes.items.every((row, i) => row && row.id === previous[i].id && Object.keys(row).every(key => ['id', 'notes'].includes(key)));
        if (!onlyDescriptions) await commercialEditable(tx, current);
        const normalized = await normalizeLines(changes.items, { existing: previous, resolveModel: resolveModel(tx) });
        await saveLines(tx, payload.id, normalized);
        if (normalized.pricingChanged) columns.total = normalized.total;
      }
      await setColumns(tx, payload.id, columns);
      const item = await repo.get(tx, payload.id);
      await audit({ entity: 'orders', entityId: item.id, action: 'update', diff: { fromVersion: String(payload.version), changes } });
      return { status: 200, body: item };
    } },
    'order.refreshCustomer': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version'], ['id', 'version']);
      const current = await lockOrder(tx, payload);
      await commercialEditable(tx, current);
      const before = (await tx.query('SELECT customer_snapshot::text AS raw FROM erp.orders WHERE id=$1', [payload.id])).rows[0].raw;
      const snapshot = await customerSnapshot(tx, current.customer_id);
      await setColumns(tx, payload.id, { customer_snapshot: snapshot });
      const item = await repo.get(tx, payload.id);
      await audit({ entity: 'orders', entityId: item.id, action: 'customer.refresh', diff: { before: v.legacy(before), after: item.customer } });
      return { status: 200, body: item };
    } },
    'order.transition': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'status', 'reason'], ['id', 'version', 'status']);
      orderStatus(payload.status);
      const current = await lockOrder(tx, payload);
      if (current.status !== payload.status && !TRANSITIONS[current.status].includes(payload.status)) v.fail('不允许进行该订单状态转换', 'ORDER_TRANSITION_INVALID');
      const reason = Object.hasOwn(payload, 'reason') ? v.string(payload.reason) : current.status_reason;
      await setColumns(tx, payload.id, { status: payload.status, status_reason: reason });
      const item = await repo.get(tx, payload.id);
      await audit({ entity: 'orders', entityId: item.id, action: 'status', diff: { before: { status: current.status, reason: current.status_reason }, after: { status: item.status, reason } } });
      return { status: 200, body: item };
    } },
    'order.delete': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version'], ['id', 'version']);
      let before;
      await remove(tx, { table: 'erp.orders', id: payload.id, expectedVersion: payload.version, beforeDelete: async client => {
        before = await repo.get(client, payload.id);
        await client.query('DELETE FROM erp.order_items WHERE order_id=$1', [payload.id]);
        await client.query('DELETE FROM erp.order_attachments WHERE order_id=$1', [payload.id]);
      } });
      await audit({ entity: 'orders', entityId: payload.id, action: 'delete', diff: { before } });
      return { status: 200, body: { success: true } };
    } },
    'order.import': { roles: ['owner', 'staff'], async handle(tx, context) {
      const items = [];
      for (const payload of v.batch(context.payload)) items.push((await create(tx, { ...context, payload })).body);
      return { status: 201, body: { imported: items.length, items } };
    } },
  };
  for (const action of ['add', 'remove']) {
    commands[`order.attachment.${action}`] = { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      const extra = action === 'add' ? 'file' : 'position';
      v.fields(payload, ['id', 'version', extra], ['id', 'version', extra]);
      await lockOrder(tx, payload);
      const attachment = action === 'add' ? await addAttachment(tx, payload.id, payload.file, uploadDirectory)
        : await removeAttachment(tx, payload.id, payload.position);
      const item = await repo.get(tx, payload.id);
      await audit({ entity: 'orders', entityId: item.id, action: `attachment.${action}`, diff: attachment });
      return { status: action === 'add' ? 201 : 200, body: item };
    } };
  }
  return commands;
}

function createOrderService(pool, options = {}) {
  return { execute: createBusinessCommands(pool, orderCommands(options)),
    get: (session, id) => withAuthenticatedRead(pool, session, tx => repo.get(tx, id)),
    list: (session, query = {}) => withAuthenticatedRead(pool, session, async tx => {
      const { search, active, limit, offset } = v.page(query, ['status', 'customerId', 'dateFrom', 'dateTo']);
      const status = query.status === undefined || query.status === 'all' ? null : query.status;
      if (status !== null && !Object.hasOwn(TRANSITIONS, status)) v.fail('订单状态筛选无效');
      const customerId = query.customerId == null || query.customerId === '' ? null : v.id(query.customerId);
      const from = query.dateFrom == null ? null : dueDate(query.dateFrom);
      const end = query.dateTo == null ? null : dueDate(query.dateTo);
      const until = end === null ? null : new Date(Date.parse(end) + (end.length === 10 ? 86400000 : 1)).toISOString();
      if (from && until && Date.parse(from) >= Date.parse(until)) v.fail('开始日期不能晚于结束日期');
      const where = `($1::text='' OR position(lower($1) in lower(concat_ws(' ',id,number,customer_snapshot->>'name',notes)))>0)
        AND ($2::boolean IS NULL OR active=$2) AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR customer_id=$4)
        AND ($5::timestamptz IS NULL OR created_at>=$5::timestamptz) AND ($6::timestamptz IS NULL OR created_at<$6::timestamptz)`;
      const params = [search, active, status, customerId, from, until];
      const total = (await tx.query(`SELECT count(*)::int AS n FROM erp.orders WHERE ${where}`, params)).rows[0].n;
      const rows = (await tx.query(`SELECT ${repo.COLUMNS} FROM erp.orders WHERE ${where} ORDER BY created_at DESC,id LIMIT $7 OFFSET $8`, [...params, limit, offset])).rows;
      const items = [];
      for (const row of rows) items.push(await repo.detail(tx, row));
      return { items, total };
    }),
  };
}
module.exports = { createOrderService, orderCommands, validateOrderProposalChanges };
