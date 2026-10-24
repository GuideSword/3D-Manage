'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createMaterialService } = require('../../backend/modules/materials/service');
const { createModelService } = require('../../backend/modules/models/service');
const { withAuthenticatedRead } = require('../../backend/business-db/reads');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const owner = { actorId: 'owner', tokenVersion: '1' };
const staff = { actorId: 'staff', tokenVersion: '1' };
const viewer = { actorId: 'viewer', tokenVersion: '1' };
const material = { type: 'PLA', brand: '测试品牌', color: '白色', unit: 'kg', unitPrice: '25.000001', notes: '旧备注' };

test('relational catalog preserves data and enforces CRUD contracts', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.users(id,email,role,password_hash) VALUES('owner','owner@test','owner','hash'),('staff','staff@test','staff','hash'),('viewer','viewer@test','viewer','hash')");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-catalog-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'part.stl'), 'solid model');
  await fs.writeFile(path.join(root, 'photo.png'), 'image fixture');
  const materials = createMaterialService(pool);
  const models = createModelService(pool, { uploadDirectory: root });
  let key = 0;
  const command = (service, operation, payload, actor = staff, requestKey) => service.execute({ ...actor, operation, payload, key: requestKey || `catalog-${++key}` });
  let mat;
  let model;

  await t.test('create, read, search and edit material with exact price, server ID and original values', async () => {
    mat = (await command(materials, 'material.create', material)).body;
    assert.match(mat.id, /^[0-9a-f-]{36}$/);
    assert.equal(mat.version, '1');
    assert.equal(mat.unitPrice, '25.000001');
    assert.equal(mat.unit, 'kg');
    assert.equal((await materials.get(viewer, mat.id)).notes, '旧备注');
    await pool.query(`UPDATE erp.materials SET legacy_payload='{"oldExtra":{"value":9007199254740993.01},"unit_price":999}' WHERE id=$1`, [mat.id]);
    const edited = (await command(materials, 'material.update', { id: mat.id, version: '1', changes: { notes: '', color: '自定义色' } })).body;
    assert.equal(edited.version, '2');
    assert.equal(edited.notes, '');
    assert.equal(edited.brand, material.brand);
    assert.equal(edited.unitPrice, '25.000001');
    assert.equal(edited.unit_price, edited.unitPrice);
    assert.equal(edited.oldExtra.value, '9007199254740993.01');
    assert.equal((await pool.query("SELECT legacy_payload->'oldExtra'->>'value' AS value FROM erp.materials WHERE id=$1", [mat.id])).rows[0].value, '9007199254740993.01');
    assert.ok(edited.updatedAt >= mat.updatedAt);
    const page = await materials.list(viewer, { search: '自定义色', limit: 1, offset: 0 });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].id, mat.id);
    assert.equal((await materials.list(viewer, { search: '%_\' OR true --' })).total, 0);
    assert.equal((await materials.list(viewer, { limit: 1, offset: 100 })).total, 1);
    mat = edited;
  });
  await t.test('invalid precision, protected fields, unsafe numbers and Viewer writes are rejected', async () => {
    for (const changes of [{ unitPrice: '1.0000001' }, { unitPrice: 1.1 }, { diameter: '-1' }, { version: '99' }, { qtyMg: 5 }, { createdAt: 'now' }]) {
      await assert.rejects(command(materials, 'material.update', { id: mat.id, version: mat.version, changes }), { status: 400 });
    }
    await assert.rejects(command(materials, 'material.create', material, viewer), { code: 'BUSINESS_FORBIDDEN' });
    await assert.rejects(materials.get({ ...viewer, tokenVersion: '2' }, mat.id), { code: 'AUTHENTICATION_REQUIRED' });
    await assert.rejects(materials.list(viewer, { limit: -1 }), { status: 400 });
    assert.equal((await materials.get(viewer, mat.id)).version, mat.version);
  });
  await t.test('concurrent versions, durable retry, deactivate and reactivate', async () => {
    const before = mat.version;
    const result = await Promise.allSettled(['A', 'B'].map(notes => command(materials, 'material.update', { id: mat.id, version: before, changes: { notes } })));
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(result.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    mat = (await materials.get(viewer, mat.id));
    const payload = { id: mat.id, version: mat.version, active: false };
    const disabled = await command(materials, 'material.setActive', payload, owner, 'deactivate-key');
    assert.deepEqual(await command(materials, 'material.setActive', payload, owner, 'deactivate-key'), disabled);
    assert.equal((await materials.list(viewer, { active: 'true' })).total, 0);
    assert.equal((await materials.list(viewer, { active: 'false' })).total, 1);
    mat = (await command(materials, 'material.setActive', { id: mat.id, version: disabled.body.version, active: true })).body;
  });
  await t.test('material referenced by a stock lot cannot be deleted; unreferenced deletion checks version', async () => {
    await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('w1','DEFAULT','默认仓库',true)");
    await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status) VALUES('l1',$1,'w1',0,0,'tracked')", [mat.id]);
    await assert.rejects(command(materials, 'material.delete', { id: mat.id, version: mat.version }), { code: 'ENTITY_REFERENCED', status: 409 });
    const other = (await command(materials, 'material.create', { ...material, color: '蓝' })).body;
    await assert.rejects(command(materials, 'material.delete', { id: other.id, version: '99' }), { code: 'VERSION_CONFLICT' });
    assert.equal((await command(materials, 'material.delete', { id: other.id, version: other.version })).body.success, true);
    await assert.rejects(materials.get(viewer, other.id), { code: 'ENTITY_NOT_FOUND', status: 404 });
  });
  await t.test('model edits retain original files, images and unknown numeric metadata', async () => {
    await pool.query(`INSERT INTO erp.models(id,name,description,source,legacy_payload) VALUES('old-model','历史模型','描述','original','{"custom":{"value":9007199254740993.01}}')`);
    await pool.query(`INSERT INTO erp.model_files(model_id,id,position,file_key,url,metadata) VALUES('old-model','old-file',0,'part.stl','/api/files/part.stl','{"extra":9007199254740993.01,"sourceFileId":"source-old"}')`);
    await pool.query(`INSERT INTO erp.model_images(model_id,id,position,file_key,url,metadata) VALUES('old-model','old-image',0,'photo.png','/api/files/photo.png','{"unknown":true}')`);
    model = (await command(models, 'model.update', { id: 'old-model', version: '1', changes: { name: '更新后的模型', description: '' } })).body;
    assert.equal(model.files[0].id, 'old-file');
    assert.equal(model.images[0].id, 'old-image');
    assert.equal(model.files[0].extra, '9007199254740993.01');
    assert.equal(model.custom.value, '9007199254740993.01');
    assert.equal((await pool.query("SELECT metadata->>'extra' AS extra FROM erp.model_files WHERE id='old-file'")).rows[0].extra, '9007199254740993.01');
    await assert.rejects(command(models, 'model.update', { id: model.id, version: model.version, changes: { files: [] } }), { status: 400 });
    assert.equal((await models.list(viewer, { search: '更新后的' })).total, 1);
  });
  await t.test('verified file/image registration uses server IDs and optimistic parent versions, without deleting disk files', async () => {
    const payload = { id: model.id, version: model.version, file: { fileKey: 'photo.png', size: 13, name: '图片', type: 'image/png', extra: { kept: true } } };
    const added = await command(models, 'model.image.add', payload, staff, 'image-add-key');
    assert.deepEqual(await command(models, 'model.image.add', payload, staff, 'image-add-key'), added);
    model = added.body;
    assert.equal(model.images.length, 2);
    const child = model.images[1];
    assert.match(child.id, /^[0-9a-f-]{36}$/);
    assert.equal(child.extra.kept, true);
    assert.equal(child.fileUrl, '/api/files/photo.png');
    await assert.rejects(command(models, 'model.image.remove', { id: model.id, version: payload.version, childId: child.id }), { code: 'VERSION_CONFLICT' });
    model = (await command(models, 'model.image.remove', { id: model.id, version: model.version, childId: child.id })).body;
    assert.equal(model.images.length, 1);
    assert.equal(await fs.readFile(path.join(root, 'photo.png'), 'utf8'), 'image fixture');
  });
  await t.test('bad file hash/path cannot change the parent version, file records, audit or receipt', async () => {
    const before = model.version;
    for (const file of [{ fileKey: '../outside' }, { fileKey: 'part.stl', sha256: '0'.repeat(64) }, { fileKey: 'part.stl', size: 999 }]) {
      await assert.rejects(command(models, 'model.file.add', { id: model.id, version: before, file }), { status: 400 });
      assert.equal((await models.get(viewer, model.id)).version, before);
    }
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT image_receipt_probe CHECK(key <> 'image-receipt-fail')");
    await assert.rejects(command(models, 'model.image.add', { id: model.id, version: before, file: { fileKey: 'photo.png' } }, staff, 'image-receipt-fail'), { code: 'BUSINESS_DATA_INVALID' });
    const after = await models.get(viewer, model.id);
    assert.equal(after.version, before);
    assert.equal(after.images.length, 1);
  });
  await t.test('model deletion protects order references and rolls back child deletion', async () => {
    await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('c1','C1','客户')");
    await pool.query("INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by) VALUES('o1','O1','c1','{}','draft',1,'owner')");
    await pool.query("INSERT INTO erp.order_items(order_id,id,position,model_id,quantity,unit_price,subtotal) VALUES('o1','i1',0,$1,1,1,1)", [model.id]);
    await assert.rejects(command(models, 'model.delete', { id: model.id, version: model.version }), { code: 'ENTITY_REFERENCED' });
    assert.equal((await models.get(viewer, model.id)).files.length, 1);
    const unused = (await command(models, 'model.create', { name: '未使用模型', description: '', source: 'original' })).body;
    assert.equal((await command(models, 'model.delete', { id: unused.id, version: unused.version })).body.success, true);
    await assert.rejects(models.get(viewer, unused.id), { code: 'ENTITY_NOT_FOUND' });
  });
  await t.test('bulk import is atomic if any later row is invalid', async () => {
    const count = (await materials.list(owner)).total;
    await assert.rejects(command(materials, 'material.import', { items: [material, { ...material, unitPrice: '-1' }] }), { status: 400 });
    assert.equal((await materials.list(owner)).total, count);
    const modelCount = (await models.list(viewer)).total;
    await assert.rejects(command(models, 'model.import', { items: [{ name: '有效', source: 'original' }, { name: '', source: 'original' }] }), { status: 400 });
    assert.equal((await models.list(viewer)).total, modelCount);
  });
  await t.test('successful imports replay without duplicates; model activation and file removal keep full deletion audit', async () => {
    const payload = { items: [{ ...material, color: '导入色一' }, { ...material, color: '导入色二' }] };
    const imported = await command(materials, 'material.import', payload, staff, 'bulk-import');
    assert.equal(imported.body.imported, 2);
    assert.notEqual(imported.body.items[0].id, imported.body.items[1].id);
    assert.deepEqual(await command(materials, 'material.import', payload, staff, 'bulk-import'), imported);
    const modelsImported = await command(models, 'model.import', { items: [{ name: '批量模型一' }, { name: '批量模型二' }] });
    let other = modelsImported.body.items[0];
    other = (await command(models, 'model.file.add', { id: other.id, version: other.version, file: { fileKey: 'part.stl', name: '共享文件' } })).body;
    const child = other.files[0];
    other = (await command(models, 'model.setActive', { id: other.id, version: other.version, active: false })).body;
    assert.equal((await models.list(viewer, { active: 'false' })).total, 1);
    other = (await command(models, 'model.setActive', { id: other.id, version: other.version, active: true })).body;
    other = (await command(models, 'model.image.add', { id: other.id, version: other.version, file: { fileKey: 'photo.png', sourceFileId: child.id } })).body;
    await assert.rejects(command(models, 'model.file.remove', { id: other.id, version: other.version, childId: child.id }), { code: 'ENTITY_REFERENCED' });
    other = (await command(models, 'model.image.remove', { id: other.id, version: other.version, childId: other.images[0].id })).body;
    other = (await command(models, 'model.file.remove', { id: other.id, version: other.version, childId: child.id })).body;
    assert.equal(other.files.length, 0);
    // Deleting one model's child must preserve the same disk content used by another model.
    assert.equal((await models.get(viewer, model.id)).files[0].fileKey, 'part.stl');
    assert.equal(await fs.readFile(path.join(root, 'part.stl'), 'utf8'), 'solid model');
    await command(models, 'model.delete', { id: other.id, version: other.version });
    const audit = (await pool.query("SELECT diff->'before'->>'name' AS name FROM erp.audit_logs WHERE entity_id=$1 AND action='delete'", [other.id])).rows[0];
    assert.equal(audit.name, '批量模型一');
    const matToDelete = imported.body.items[0];
    await command(materials, 'material.delete', { id: matToDelete.id, version: matToDelete.version });
    assert.equal((await pool.query("SELECT diff->'before'->>'color' AS color FROM erp.audit_logs WHERE entity_id=$1 AND action='delete'", [matToDelete.id])).rows[0].color, '导入色一');
  });
  await t.test('read helpers are enforced read-only and do not expose credential columns', async () => {
    await assert.rejects(withAuthenticatedRead(pool, owner, async tx => { await tx.query("UPDATE erp.materials SET notes='forbidden'"); }), { code: '25006' });
    const result = await materials.list(viewer);
    assert.ok(!JSON.stringify(result).includes('password_hash'));
    await pool.query("UPDATE erp.users SET active=false WHERE id='viewer'");
    await assert.rejects(models.get(viewer, model.id), { code: 'AUTHENTICATION_REQUIRED' });
  });
});
