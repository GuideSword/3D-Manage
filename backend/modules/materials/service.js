'use strict';
const { randomUUID } = require('node:crypto');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater, createVersionedDeleter } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const COLUMNS = 'id,code,name,type,brand,color,diameter::text,density::text,unit,unit_price::text,notes,active,version,created_at,updated_at,legacy_payload::text AS legacy_raw';
const WRITABLE = ['code', 'name', 'type', 'brand', 'color', 'diameter', 'density', 'unit', 'unitPrice', 'notes'];
const update = createVersionedUpdater({ 'erp.materials': [...WRITABLE.filter(x => x !== 'unitPrice'), 'unit_price', 'active'] }, { touchUpdatedAt: true });
const remove = createVersionedDeleter(['erp.materials']);
function dto(row) {
  return { ...v.legacy(row.legacy_raw), id: row.id, code: row.code, name: row.name, type: row.type, materialType: row.type,
    brand: row.brand, color: row.color, diameter: row.diameter, diameter_mm: row.diameter, density: row.density, unit: row.unit, unitPrice: row.unit_price, unit_price: row.unit_price,
    notes: row.notes, active: row.active, version: row.version, createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at) };
}
async function get(tx, recordId) {
  const row = (await tx.query(`SELECT ${COLUMNS} FROM erp.materials WHERE id=$1`, [v.id(recordId)])).rows[0];
  if (!row) v.fail('耗材不存在', 'ENTITY_NOT_FOUND', 404);
  return dto(row);
}
function normalize(input, creating = false) {
  v.fields(input, WRITABLE, creating ? ['type', 'brand', 'color', 'unitPrice'] : []);
  if (!creating && !Object.keys(input).length) v.fail('至少填写一个修改字段');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'unitPrice') out.unit_price = v.decimal(value);
    else if (key === 'diameter' || key === 'density') out[key] = v.decimal(value, { nullable: true, positive: true, digits: 6 });
    else if (key === 'code') out.code = v.string(value, { trim: true, max: 120 }) || null;
    else if (key === 'unit') out.unit = v.string(value, { required: true, trim: true, max: 30 });
    else out[key] = v.string(value, { required: ['type', 'brand', 'color'].includes(key), trim: key !== 'notes', max: key === 'notes' ? 10000 : 240 });
  }
  return out;
}
async function create(tx, { payload, audit }) {
  const values = { id: randomUUID(), diameter: '1.75', unit: 'kg', ...normalize(payload, true) };
  const names = Object.keys(values);
  await tx.query(`INSERT INTO erp.materials(${names.join(',')}) VALUES(${names.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  const item = await get(tx, values.id);
  await audit({ entity: 'materials', entityId: item.id, action: 'create', diff: item });
  return { status: 201, body: item };
}
const materialCommands = {
  'material.create': { roles: ['owner', 'staff'], handle: create },
  'material.update': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
    v.fields(payload, ['id', 'version', 'changes'], ['id', 'version', 'changes']);
    const changes = normalize(payload.changes);
    await update(tx, { table: 'erp.materials', id: payload.id, expectedVersion: payload.version, changes });
    const item = await get(tx, payload.id);
    await audit({ entity: 'materials', entityId: item.id, action: 'update', diff: payload.changes });
    return { status: 200, body: item };
  } },
  'material.setActive': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
    v.fields(payload, ['id', 'version', 'active'], ['id', 'version', 'active']);
    await update(tx, { table: 'erp.materials', id: payload.id, expectedVersion: payload.version, changes: { active: v.boolean(payload.active) } });
    const item = await get(tx, payload.id);
    await audit({ entity: 'materials', entityId: item.id, action: item.active ? 'activate' : 'deactivate', diff: { active: item.active } });
    return { status: 200, body: item };
  } },
  'material.delete': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
    v.fields(payload, ['id', 'version'], ['id', 'version']);
    let before;
    await remove(tx, { table: 'erp.materials', id: payload.id, expectedVersion: payload.version,
      beforeDelete: async client => { before = await get(client, payload.id); } });
    await audit({ entity: 'materials', entityId: payload.id, action: 'delete', diff: { before } });
    return { status: 200, body: { success: true } };
  } },
  'material.import': { roles: ['owner', 'staff'], async handle(tx, context) {
    const rows = v.batch(context.payload);
    const items = [];
    for (const payload of rows) items.push((await create(tx, { ...context, payload })).body);
    return { status: 201, body: { imported: items.length, items } };
  } },
};
function createMaterialService(pool) {
  return { execute: createBusinessCommands(pool, materialCommands),
    get: (session, recordId) => withAuthenticatedRead(pool, session, tx => get(tx, recordId)),
    list: (session, query = {}) => withAuthenticatedRead(pool, session, async tx => {
      const { search, active, limit, offset } = v.page(query, ['type']);
      const type = query.type === undefined ? '' : v.string(query.type, { max: 240 });
      const where = "($1::text='' OR position(lower($1) in lower(concat_ws(' ',name,type,brand,color,notes,code)))>0) AND ($2::boolean IS NULL OR active=$2) AND ($3::text='' OR type=$3)";
      const params = [search, active, type];
      const total = (await tx.query(`SELECT count(*)::int AS n FROM erp.materials WHERE ${where}`, params)).rows[0].n;
      const rows = (await tx.query(`SELECT ${COLUMNS} FROM erp.materials WHERE ${where} ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`, [...params, limit, offset])).rows;
      return { items: rows.map(dto), total };
    }),
  };
}
module.exports = { createMaterialService, materialCommands };
