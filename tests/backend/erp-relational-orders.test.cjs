'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createOrderService } = require('../../backend/modules/orders/service');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const staff = { actorId: 'staff', tokenVersion: '1' };
const viewer = { actorId: 'viewer', tokenVersion: '1' };

test('relational orders preserve commercial facts and use exact transactional edits', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-orders-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const v2 = path.join(dir, 'v2');
  await fs.mkdir(v2);
  for (const name of ['0001_foundation.sql', '0002_core.sql']) await fs.copyFile(path.resolve(__dirname, '../../backend/business-db/migrations', name), path.join(v2, name));
  await migrateBusinessDatabase(pool, { migrationsDirectory: v2 });
  await pool.query("INSERT INTO erp.users(id,email,role,password_hash) VALUES('staff','staff@test','staff','hash'),('viewer','viewer@test','viewer','hash')");
  await pool.query("INSERT INTO erp.customers(id,code,name,address,active) VALUES('c1','C1','当前客户','原地址',true),('c2','C2','第二客户','第二地址',true),('disabled','C3','停用客户','',false)");
  await pool.query("INSERT INTO erp.models(id,name,active) VALUES('m1','当前模型名',true),('m2','第二模型',true),('disabled','停用模型',false)");
  await pool.query(`INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by,legacy_payload)
    VALUES('legacy','LEGACY','c1','{"id":"c1","name":"历史客户","extra":9007199254740993.01}','draft',9,'staff','{"statusReason":"原状态原因","extra":9007199254740993.01,"orderItems":[],"due_date":"旧日期"}')`);
  await pool.query(`INSERT INTO erp.order_items(order_id,id,position,model_id,model_name_snapshot,quantity,unit_price,subtotal,spec_snapshot)
    VALUES('legacy','old-line',0,'m1','历史模型名',2,1,9,'{"modelId":"m1","modelName":"历史模型名","extra":9007199254740993.01,"color":"旧颜色"}')`);
  await migrateBusinessDatabase(pool);
  await fs.writeFile(path.join(dir, 'order.pdf'), 'pdf fixture');
  const orders = createOrderService(pool, { uploadDirectory: dir });
  let key = 0;
  const command = (operation, payload, actor = staff, requestKey) => orders.execute({ ...actor, operation, payload, key: requestKey || `order-${++key}` });
  const create = (extra = {}) => command('order.create', { customerId: 'c1', items: [{ modelId: 'm1', quantity: '1', unitPrice: '2' }], ...extra }).then(r => r.body);

  await t.test('v2 upgrade retains status reason and legacy records without repricing', async () => {
    const old = await orders.get(viewer, 'legacy');
    assert.equal(old.statusReason, '原状态原因');
    assert.equal(old.total, '9');
    assert.equal(old.items[0].modelName, '历史模型名');
    assert.equal(old.extra, '9007199254740993.01');
  });
  await t.test('server IDs, actor, customer snapshot and exact per-line rounded amounts', async () => {
    const order = await create({ items: [{ quantity: '1', unitPrice: '0.005' }, { quantity: '1', unitPrice: '0.005' }] });
    assert.match(order.id, /^[a-f0-9-]{36}$/);
    assert.equal(order.version, '1');
    assert.equal(order.createdBy, 'staff');
    assert.equal(order.customer.name, '当前客户');
    assert.equal(order.total, '0.02');
    assert.deepEqual(order.items.map(r => r.subtotal), ['0.01', '0.01']);
    assert.notEqual(order.items[0].id, order.items[1].id);
    const huge = await create({ items: [{ quantity: '100', unitPrice: '90071992547409.930100' }] });
    assert.equal(huge.total, '9007199254740993.01');
  });
  await t.test('invalid precision, empty lines, client totals, actors and inactive references never create an order', async () => {
    const count = (await orders.list(viewer)).total;
    for (const change of [{ total: '9' }, { createdBy: 'viewer' }, { items: [] }, { currency: 'USD' },
      { customerId: 'missing' }, { customerId: 'disabled' }, { items: [{ modelId: 'disabled', quantity: '1', unitPrice: '1' }] },
      { items: [{ quantity: '0.0001', unitPrice: '1' }] }, { items: [{ quantity: '1', unitPrice: '0.0000001' }] },
      { items: [{ quantity: '1', unitPrice: '1', subtotal: '100' }] }, { items: [{ id: 'forged', quantity: '1', unitPrice: '1' }] }]) {
      await assert.rejects(create(change));
    }
    assert.equal((await orders.list(viewer)).total, count);
  });
  await t.test('notes, due-date and line descriptions preserve original totals, names and exact unknown JSON', async () => {
    let old = await orders.get(viewer, 'legacy');
    old = (await command('order.update', { id: old.id, version: old.version, changes: { notes: '', dueDate: null } })).body;
    assert.equal(old.total, '9');
    old = (await command('order.update', { id: old.id, version: old.version,
      changes: { items: [{ id: 'old-line', notes: '补充说明', modelId: 'm1', quantity: '2.000', unitPrice: '1.000000' }] } })).body;
    assert.equal(old.total, '9');
    assert.equal(old.items[0].subtotal, '9');
    assert.equal(old.items[0].modelName, '历史模型名');
    assert.equal(old.items[0].color, '旧颜色');
    assert.deepEqual(old.orderItems, old.items);
    assert.equal(old.due_date, null);
    assert.equal((await pool.query("SELECT spec_snapshot->>'extra' AS extra FROM erp.order_items WHERE order_id='legacy'")).rows[0].extra, '9007199254740993.01');
    await pool.query(`UPDATE erp.order_items SET model_id=NULL,spec_snapshot=spec_snapshot||'{"modelId":"deleted-model"}'::jsonb WHERE order_id='legacy'`);
    old = (await command('order.update', { id: old.id, version: old.version, changes: { items: [{ id: 'old-line', notes: '保留失效模型快照' }] } })).body;
    assert.equal(old.items[0].modelId, 'deleted-model');
    assert.equal(old.items[0].modelName, '历史模型名');
    old = (await command('order.update', { id: old.id, version: old.version, changes: { items: [{ id: 'old-line', quantity: '3' }] } })).body;
    assert.equal(old.total, '3.00');
  });
  await t.test('customer changes never rewrite existing snapshots; replacing or explicit refresh is audited', async () => {
    let order = await create();
    const originalName = order.customer.name;
    await pool.query("UPDATE erp.customers SET name='客户已改名',address='新地址' WHERE id='c1'");
    order = (await command('order.update', { id: order.id, version: order.version, changes: { notes: '备注' } })).body;
    assert.equal(order.customer.name, originalName);
    order = (await command('order.refreshCustomer', { id: order.id, version: order.version })).body;
    assert.equal(order.customer.name, '客户已改名');
    order = (await command('order.update', { id: order.id, version: order.version, changes: { customerId: 'c2' } })).body;
    assert.equal(order.customer.name, '第二客户');
    assert.equal(order.customerId, 'c2');
    assert.ok((await pool.query("SELECT 1 FROM erp.audit_logs WHERE entity_id=$1 AND action='customer.refresh'", [order.id])).rows.length);
  });
  await t.test('adding and removing lines recalculates only changed amounts with stable server IDs', async () => {
    let order = await create();
    const oldId = order.items[0].id;
    order = (await command('order.update', { id: order.id, version: order.version, changes: { items: [
      { id: oldId, quantity: '2' }, { quantity: '0.333', unitPrice: '3.000001' },
    ] } })).body;
    assert.equal(order.total, '5.00');
    assert.equal(order.items[0].id, oldId);
    const newId = order.items[1].id;
    assert.notEqual(newId, oldId);
    await assert.rejects(command('order.update', { id: order.id, version: order.version, changes: { items: [{ id: newId }, { id: newId }] } }), { status: 400 });
    order = (await command('order.update', { id: order.id, version: order.version, changes: { items: [{ id: newId, modelId: 'm2' }] } })).body;
    assert.equal(order.total, '1.00');
    assert.equal(order.items[0].id, newId);
    assert.equal(order.items[0].position, 0);
    assert.equal(order.items[0].modelName, '第二模型');
    const day = order.createdAt.slice(0, 10);
    assert.ok((await orders.list(viewer, { dateFrom: day, dateTo: day })).items.some(row => row.id === order.id));
  });
  await t.test('status graph, reasons and commercial editing restrictions are enforced with versions', async () => {
    let order = await create();
    await assert.rejects(command('order.transition', { id: order.id, version: order.version, status: 'completed' }), { code: 'ORDER_TRANSITION_INVALID' });
    await assert.rejects(command('order.update', { id: order.id, version: order.version, changes: { status: 'in_progress' } }), { status: 400 });
    for (const status of ['pending_review', 'in_progress']) order = (await command('order.transition', { id: order.id, version: order.version, status, reason: '人工确认' })).body;
    assert.equal(order.statusReason, '人工确认');
    for (const changes of [{ customerId: 'c2' }, { items: [{ id: order.items[0].id, quantity: '3' }] }]) {
      await assert.rejects(command('order.update', { id: order.id, version: order.version, changes }), { code: 'ORDER_COMMERCIAL_LOCKED', status: 409 });
    }
    await assert.rejects(command('order.refreshCustomer', { id: order.id, version: order.version }), { code: 'ORDER_COMMERCIAL_LOCKED' });
    order = (await command('order.update', { id: order.id, version: order.version, changes: { notes: '在制说明', dueDate: '2026-10-31' } })).body;
    assert.equal(order.notes, '在制说明');
    order = (await command('order.update', { id: order.id, version: order.version, changes: { items: order.items.map(row => ({ id: row.id, notes: '行说明' })) } })).body;
    assert.equal(order.items[0].notes, '行说明');
    order = (await command('order.transition', { id: order.id, version: order.version, status: 'cancelled' })).body;
    await assert.rejects(command('order.transition', { id: order.id, version: order.version, status: 'completed' }), { code: 'ORDER_TRANSITION_INVALID' });
  });
  await t.test('reordering edits existing lines in place and respects future foreign-key consumers', async () => {
    let order = await create({ items: [{ modelId: 'm1', quantity: '1', unitPrice: '1' }, { modelId: 'm2', quantity: '1', unitPrice: '2' }] });
    await pool.query('CREATE TABLE erp.order_line_probe(order_id text,item_id text,FOREIGN KEY(order_id,item_id) REFERENCES erp.order_items(order_id,id))');
    await pool.query('INSERT INTO erp.order_line_probe VALUES($1,$2)', [order.id, order.items[0].id]);
    const ids = order.items.map(r => r.id).reverse();
    order = (await command('order.update', { id: order.id, version: order.version, changes: { items: ids.map(id => ({ id })) } })).body;
    assert.deepEqual(order.items.map(r => r.id), ids);
    await assert.rejects(command('order.update', { id: order.id, version: order.version, changes: { items: [{ id: ids[0] }] } }), { code: 'ENTITY_REFERENCED' });
    assert.equal((await orders.get(viewer, order.id)).version, order.version);
    assert.equal((await orders.get(viewer, order.id)).items.length, 2);
  });
  await t.test('attachments validate bytes and preserve arbitrary metadata, versions and physical files', async () => {
    let order = await create();
    const payload = { id: order.id, version: order.version, file: { fileKey: 'order.pdf', name: '订单附件', size: 11, custom: true } };
    const added = await command('order.attachment.add', payload, staff, 'attachment-key');
    assert.deepEqual(await command('order.attachment.add', payload, staff, 'attachment-key'), added);
    order = added.body;
    assert.equal(order.attachments[0].custom, true);
    order = (await command('order.update', { id: order.id, version: order.version, changes: { notes: '' } })).body;
    assert.equal(order.attachments.length, 1);
    await assert.rejects(command('order.update', { id: order.id, version: order.version, changes: { attachments: [] } }), { status: 400 });
    await assert.rejects(command('order.attachment.add', { id: order.id, version: order.version, file: { fileKey: 'order.pdf', sha256: '0'.repeat(64) } }), { code: 'FILE_REFERENCE_INVALID' });
    order = (await command('order.attachment.remove', { id: order.id, version: order.version, position: order.attachments[0].position })).body;
    assert.equal(order.attachments.length, 0);
    assert.equal(await fs.readFile(path.join(dir, 'order.pdf'), 'utf8'), 'pdf fixture');
  });
  await t.test('concurrent edits pick one winner; receipt failure rolls back financial and child changes', async () => {
    let order = await create();
    const results = await Promise.allSettled(['A', 'B'].map(notes => command('order.update', { id: order.id, version: order.version, changes: { notes } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    order = await orders.get(viewer, order.id);
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT order_receipt_probe CHECK(key <> 'order-receipt-fail')");
    await assert.rejects(command('order.update', { id: order.id, version: order.version, changes: { items: [{ id: order.items[0].id, quantity: '5' }] } }, staff, 'order-receipt-fail'), { code: 'BUSINESS_DATA_INVALID' });
    assert.deepEqual(await orders.get(viewer, order.id), order);
  });
  await t.test('inventory facts prevent deletion and commercial edits even if status is reopened', async () => {
    const order = await create();
    await pool.query("INSERT INTO erp.materials(id,name) VALUES('mat1','PLA')");
    await pool.query("INSERT INTO erp.warehouses(id,code,name) VALUES('w1','W1','仓库')");
    await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status) VALUES('l1','mat1','w1',0,0,'tracked')");
    await pool.query("INSERT INTO erp.inventory_txns(id,lot_id,order_id,type,legacy_payload) VALUES('legacy-txn','l1',$1,'out','{}')", [order.id]);
    await assert.rejects(command('order.delete', { id: order.id, version: order.version }), { code: 'ENTITY_REFERENCED' });
    await assert.rejects(command('order.update', { id: order.id, version: order.version, changes: { customerId: 'c2' } }), { code: 'ORDER_COMMERCIAL_LOCKED' });
    assert.equal((await orders.get(viewer, order.id)).items.length, 1);
  });
  await t.test('unreferenced delete is versioned, auditable and idempotent', async () => {
    const order = await create();
    await assert.rejects(command('order.delete', { id: order.id, version: '99' }), { code: 'VERSION_CONFLICT' });
    const payload = { id: order.id, version: order.version };
    const result = await command('order.delete', payload, staff, 'delete-order');
    assert.deepEqual(await command('order.delete', payload, staff, 'delete-order'), result);
    await assert.rejects(orders.get(viewer, order.id), { code: 'ENTITY_NOT_FOUND' });
    assert.equal((await pool.query("SELECT diff->'before'->>'number' AS number FROM erp.audit_logs WHERE entity_id=$1 AND action='delete'", [order.id])).rows[0].number, order.number);
  });
  await t.test('bulk create is atomic and replays without duplicates; read filters remain consistent', async () => {
    const data = { customerId: 'c1', items: [{ quantity: '1', unitPrice: '1' }] };
    const before = (await orders.list(viewer)).total;
    await assert.rejects(command('order.import', { items: [data, { ...data, items: [] }] }));
    assert.equal((await orders.list(viewer)).total, before);
    const payload = { items: [data, data] };
    const result = await command('order.import', payload, staff, 'order-import');
    assert.equal(result.body.imported, 2);
    assert.deepEqual(await command('order.import', payload, staff, 'order-import'), result);
    assert.equal((await orders.list(viewer, { customerId: 'c2' })).total, 1);
    assert.equal((await orders.list(viewer, { search: '%_\' OR true --' })).total, 0);
    assert.equal((await orders.list(viewer, { dateFrom: '2000-01-01', dateTo: '2000-01-01' })).total, 0);
  });
  await t.test('Viewer writes, stale sessions, invalid filters and dates are rejected', async () => {
    await assert.rejects(command('order.create', { customerId: 'c1', items: [] }, viewer), { code: 'BUSINESS_FORBIDDEN' });
    await assert.rejects(orders.get({ ...viewer, tokenVersion: '2' }, 'legacy'), { code: 'AUTHENTICATION_REQUIRED' });
    await assert.rejects(orders.list(viewer, { status: 'paid' }), { status: 400 });
    await assert.rejects(create({ dueDate: '2026-02-31' }), { status: 400 });
  });
});
