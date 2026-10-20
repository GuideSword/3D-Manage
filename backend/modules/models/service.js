'use strict';
const { randomUUID } = require('node:crypto');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater, createVersionedDeleter } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const { listChildren, addChild, removeChild } = require('./files');
const { createAutoPreviewPublisher } = require('./preview');
const COLUMNS = 'id,name,description,source,active,version,created_at,updated_at,legacy_payload::text AS legacy_raw';
const WRITABLE = ['name', 'description', 'source'];
const update = createVersionedUpdater({ 'erp.models': [...WRITABLE, 'active'] }, { touchUpdatedAt: true, allowEmptyChanges: true });
const remove = createVersionedDeleter(['erp.models']);
async function dto(tx, row) {
  return { ...v.legacy(row.legacy_raw), id: row.id, name: row.name, description: row.description, source: row.source,
    active: row.active, version: row.version, createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at),
    files: await listChildren(tx, row.id, 'model_files'), images: await listChildren(tx, row.id, 'model_images') };
}
async function get(tx, recordId) {
  const row = (await tx.query(`SELECT ${COLUMNS} FROM erp.models WHERE id=$1`, [v.id(recordId)])).rows[0];
  if (!row) v.fail('模型不存在', 'ENTITY_NOT_FOUND', 404);
  return dto(tx, row);
}
function normalize(input, creating = false) {
  v.fields(input, WRITABLE, creating ? ['name'] : []);
  if (!creating && !Object.keys(input).length) v.fail('至少填写一个修改字段');
  const values = {};
  for (const [key, value] of Object.entries(input)) {
    values[key] = v.string(value, { required: key !== 'description', trim: key !== 'description', max: key === 'description' ? 20000 : 500 });
    if (key === 'source' && !['original', 'remix', 'imported'].includes(values.source)) v.fail('模型来源必须是 original、remix 或 imported');
  }
  return values;
}
function modelCommands({ uploadDirectory } = {}) {
  const publishPreview = createAutoPreviewPublisher({ uploadDirectory });
  async function create(tx, { payload, audit }) {
    const values = { id: randomUUID(), description: '', source: 'original', ...normalize(payload, true) };
    const names = Object.keys(values);
    await tx.query(`INSERT INTO erp.models(${names.join(',')}) VALUES(${names.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
    const item = await get(tx, values.id);
    await audit({ entity: 'models', entityId: item.id, action: 'create', diff: item });
    return { status: 201, body: item };
  }
  const commands = {
    'model.create': { roles: ['owner', 'staff'], handle: create },
    'model.update': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'changes'], ['id', 'version', 'changes']);
      await update(tx, { table: 'erp.models', id: payload.id, expectedVersion: payload.version, changes: normalize(payload.changes) });
      const item = await get(tx, payload.id);
      await audit({ entity: 'models', entityId: item.id, action: 'update', diff: payload.changes });
      return { status: 200, body: item };
    } },
    'model.setActive': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'active'], ['id', 'version', 'active']);
      await update(tx, { table: 'erp.models', id: payload.id, expectedVersion: payload.version, changes: { active: v.boolean(payload.active) } });
      const item = await get(tx, payload.id);
      await audit({ entity: 'models', entityId: item.id, action: item.active ? 'activate' : 'deactivate', diff: { active: item.active } });
      return { status: 200, body: item };
    } },
    'model.delete': { roles: ['owner', 'staff'], async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version'], ['id', 'version']);
      let before;
      await remove(tx, { table: 'erp.models', id: payload.id, expectedVersion: payload.version, beforeDelete: async client => {
        before = await get(client, payload.id);
        await client.query('DELETE FROM erp.model_files WHERE model_id=$1', [payload.id]);
        await client.query('DELETE FROM erp.model_images WHERE model_id=$1', [payload.id]);
      } });
      await audit({ entity: 'models', entityId: payload.id, action: 'delete', diff: { before } });
      return { status: 200, body: { success: true } };
    } },
    'model.import': { roles: ['owner', 'staff'], async handle(tx, context) {
      const items = [];
      for (const payload of v.batch(context.payload)) items.push((await create(tx, { ...context, payload })).body);
      return { status: 201, body: { imported: items.length, items } };
    } },
  };
  for (const [kind, table] of [['file', 'model_files'], ['image', 'model_images']]) {
    for (const action of ['add', 'remove']) {
      commands[`model.${kind}.${action}`] = { roles: ['owner', 'staff'], async handle(tx, { payload, actor, audit }) {
        const extra = action === 'add' ? 'file' : 'childId';
        v.fields(payload, ['id', 'version', extra], ['id', 'version', extra]);
        // Parent row update serializes child positions and shares the edit version contract.
        await update(tx, { table: 'erp.models', id: payload.id, expectedVersion: payload.version, changes: {} });
        const child = action === 'add' ? await addChild(tx, payload.id, table, payload.file, uploadDirectory)
          : await removeChild(tx, payload.id, table, payload.childId);
        let previewImage = null;
        if (kind === 'file' && action === 'add') {
          const preview = await publishPreview(child);
          if (preview.file) {
            // Generated upload facts and both associations share this command's transaction/receipt.
            await tx.query('INSERT INTO erp.object_uploads(id,owner_id,file_key,metadata) VALUES($1,$2,$3,$4)',
              [preview.file.uploadId, actor.id, preview.file.fileKey, JSON.stringify(preview.file)]);
            await audit({ entity: 'objectUploads', entityId: preview.file.uploadId, action: 'generatePreview', diff: preview.file });
            previewImage = await addChild(tx, payload.id, 'model_images', preview.file, uploadDirectory);
          } else if (preview.warning) {
            child.previewWarning = preview.warning;
            await tx.query('UPDATE erp.model_files SET metadata=metadata || $3::jsonb WHERE model_id=$1 AND id=$2',
              [payload.id, child.id, JSON.stringify({ previewWarning: preview.warning })]);
          }
        }
        const item = await get(tx, payload.id);
        await audit({ entity: 'models', entityId: item.id, action: `${kind}.${action}`, diff: previewImage ? { ...child, previewImage } : child });
        return { status: action === 'add' ? 201 : 200, body: item };
      } };
    }
  }
  return commands;
}
function createModelService(pool, options = {}) {
  return { execute: createBusinessCommands(pool, modelCommands(options)),
    get: (session, recordId) => withAuthenticatedRead(pool, session, tx => get(tx, recordId)),
    list: (session, query = {}) => withAuthenticatedRead(pool, session, async tx => {
      const { search, active, limit, offset } = v.page(query);
      const where = `($1::text='' OR position(lower($1) in lower(concat_ws(' ',name,description)))>0
        OR EXISTS(SELECT 1 FROM erp.model_files f WHERE f.model_id=m.id AND position(lower($1) in lower(coalesce(f.metadata->>'name','')))>0))
        AND ($2::boolean IS NULL OR active=$2)`;
      const params = [search, active];
      const total = (await tx.query(`SELECT count(*)::int AS n FROM erp.models m WHERE ${where}`, params)).rows[0].n;
      const rows = (await tx.query(`SELECT ${COLUMNS} FROM erp.models m WHERE ${where} ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`, [...params, limit, offset])).rows;
      const items = [];
      for (const row of rows) items.push(await dto(tx, row));
      return { items, total };
    }),
  };
}
module.exports = { createModelService, modelCommands, validateModelChanges: input => normalize(input) };
