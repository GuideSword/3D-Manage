'use strict';
const { randomUUID } = require('node:crypto');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater, createVersionedDeleter } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const TYPES = { customers: 'customer', suppliers: 'supplier' };
const FIELDS = { code: 'code', name: 'name', contactName: 'contact_name', email: 'email', phone: 'phone', address: 'address', notes: 'notes' };
const COLUMNS = 'id,code,name,contact_name,email,phone,address,notes,active,version,created_at,updated_at,legacy_payload::text AS legacy_raw';
function dto(row) {
  const legacy = v.legacy(row.legacy_raw);
  return { ...legacy, ...(Object.hasOwn(legacy, 'contact_name') ? { contact_name: row.contact_name } : {}), id: row.id, code: row.code, name: row.name, contactName: row.contact_name,
    email: row.email, phone: row.phone, address: row.address, notes: row.notes, active: row.active, version: row.version,
    createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at) };
}
function normalize(input, creating = false) {
  v.fields(input, Object.keys(FIELDS), creating ? ['code', 'name'] : []);
  if (!Object.keys(input).length) v.fail('至少填写一个修改字段');
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [FIELDS[key], v.string(value, {
    required: ['code', 'name'].includes(key), trim: key !== 'notes',
    max: key === 'notes' ? 10000 : key === 'address' ? 2000 : key === 'email' ? 320 : ['code', 'phone'].includes(key) ? 120 : 240,
  })]));
}
function createPartnerService(pool, kind) {
  if (!Object.hasOwn(TYPES, kind)) v.fail('不支持的主数据类型', 'MASTER_DATA_TYPE_INVALID');
  const prefix = TYPES[kind], table = `erp.${kind}`;
  const update = createVersionedUpdater({ [table]: [...Object.values(FIELDS), 'active'] }, { touchUpdatedAt: true });
  const remove = createVersionedDeleter([table]);
  async function get(tx, id) {
    const row = (await tx.query(`SELECT ${COLUMNS} FROM ${table} WHERE id=$1`, [v.id(id)])).rows[0];
    if (!row) v.fail('资料不存在', 'ENTITY_NOT_FOUND', 404);
    return dto(row);
  }
  const commands = {
    [`${prefix}.create`]: { async handle(tx, { payload, audit }) {
      const values = { id: randomUUID(), ...normalize(payload, true) }, columns = Object.keys(values);
      await tx.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
      const item = await get(tx, values.id);
      await audit({ entity: kind, entityId: item.id, action: 'create', diff: item });
      return { status: 201, body: item };
    } },
    [`${prefix}.update`]: { async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'changes'], ['id', 'version', 'changes']);
      await update(tx, { table, id: payload.id, expectedVersion: payload.version, changes: normalize(payload.changes) });
      const item = await get(tx, payload.id);
      await audit({ entity: kind, entityId: item.id, action: 'update', diff: payload.changes });
      return { status: 200, body: item };
    } },
    [`${prefix}.setActive`]: { async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'active'], ['id', 'version', 'active']);
      await update(tx, { table, id: payload.id, expectedVersion: payload.version, changes: { active: v.boolean(payload.active) } });
      const item = await get(tx, payload.id);
      await audit({ entity: kind, entityId: item.id, action: item.active ? 'activate' : 'deactivate', diff: { active: item.active } });
      return { status: 200, body: item };
    } },
    [`${prefix}.delete`]: { async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version'], ['id', 'version']);
      let before;
      await remove(tx, { table, id: payload.id, expectedVersion: payload.version, beforeDelete: async client => { before = await get(client, payload.id); } });
      await audit({ entity: kind, entityId: payload.id, action: 'delete', diff: { before } });
      return { status: 200, body: { success: true } };
    } },
  };
  return { execute: createBusinessCommands(pool, Object.fromEntries(Object.entries(commands).map(([key, value]) => [key, { roles: ['owner', 'staff'], ...value }]))),
    get: (session, id) => withAuthenticatedRead(pool, session, tx => get(tx, id)),
    list: (session, query = {}) => withAuthenticatedRead(pool, session, async tx => {
      const { search, active, limit, offset } = v.page(query);
      const where = "($1::text='' OR position(lower($1) in lower(concat_ws(' ',code,name,contact_name,email,phone,address,notes)))>0) AND ($2::boolean IS NULL OR active=$2)";
      const total = (await tx.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, [search, active])).rows[0].n;
      const rows = (await tx.query(`SELECT ${COLUMNS} FROM ${table} WHERE ${where} ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`, [search, active, limit, offset])).rows;
      return { items: rows.map(dto), total };
    }),
  };
}
module.exports = { createPartnerService };
