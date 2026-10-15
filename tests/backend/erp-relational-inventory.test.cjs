'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createInventoryService } = require('../../backend/modules/inventory/service');
const { createOrderService } = require('../../backend/modules/orders/service');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const owner = { actorId: 'owner', tokenVersion: '1' };
const staff = { actorId: 'staff', tokenVersion: '1' };
const viewer = { actorId: 'viewer', tokenVersion: '1' };

test('relational inventory is exact, serializable per lot and preserves historical facts', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-inventory-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const v3 = path.join(dir, 'v3'); await fs.mkdir(v3);
  for (const name of ['0001_foundation.sql', '0002_core.sql', '0003_order_editing.sql']) {
    await fs.copyFile(path.resolve(__dirname, '../../backend/business-db/migrations', name), path.join(v3, name));
  }
  await migrateBusinessDatabase(pool, { migrationsDirectory: v3 });
  await pool.query("INSERT INTO erp.users(id,email,role,password_hash) VALUES('owner','owner@test','owner','hash'),('staff','staff@test','staff','hash'),('viewer','viewer@test','viewer','hash')");
  await pool.query("INSERT INTO erp.materials(id,type,brand,color,active) VALUES('mat','PLA','品牌','白',true),('big','BIG','品牌','白',true),('disabled','PLA','品牌','黑',false)");
  await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('w1','DEFAULT','默认仓库',true)");
  await pool.query(`INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status,active,legacy_payload) VALUES
    ('legacy','mat','w1',400000,500000,'legacy_unverified',true,'{"qty":400,"extra":9007199254740993.01}'),
    ('invalid','mat','w1',NULL,NULL,'legacy_invalid',false,'{"qty":"损坏的旧余额"}')`);
  await pool.query(`INSERT INTO erp.inventory_txns(id,lot_id,type,legacy_payload) VALUES('old-adjust','legacy','adjust','{"qty":500,"extra":9007199254740993.01}')`);
  await pool.query(`INSERT INTO erp.inventory_txns(id,lot_id,type,qty_mg,before_qty_mg,after_qty_mg,delta_qty_mg,ledger_version,actor_id)
    VALUES('v3-out','legacy','out',100000,500000,400000,-100000,1,'owner')`);
  await migrateBusinessDatabase(pool);
  await fs.writeFile(path.join(dir, 'photo.png'), 'image fixture');
  const inventory = createInventoryService(pool, { uploadDirectory: dir });
  let key = 0;
  const command = (operation, payload, actor = owner, requestKey) => inventory.execute({ ...actor, operation, payload, key: requestKey || `stock-${++key}` });
  const create = (qty = '500', extra = {}, actor = staff) => command('lot.create', { materialId: 'mat', qty, unit: 'g', ...extra }, actor).then(r => r.body);
  const post = (lot, type, qty, extra = {}, actor = owner, requestKey) => command('inventory.post', { lotId: lot.id, type, qty, ...extra }, actor, requestKey).then(r => r.body);

  await t.test('new lots have exact controlled openings, server IDs and one real movement', async () => {
    const lot = await create('500.001');
    assert.match(lot.id, /^[a-f0-9-]{36}$/);
    assert.equal(lot.version, '1'); assert.equal(lot.qtyMg, '500001'); assert.equal(lot.qty, '500.001');
    assert.equal(lot.ledgerBaselineQtyMg, '0'); assert.equal(lot.warehouseId, 'w1');
    const txns = await inventory.listTransactions(viewer, { lotId: lot.id });
    assert.equal(txns.total, 1);
    assert.equal(txns.items[0].source, 'opening');
    assert.equal(txns.items[0].actorId, 'staff');
    assert.equal(txns.items[0].beforeQtyMg, '0');
    assert.equal(txns.items[0].afterQtyMg, '500001');
    assert.match(txns.items[0].postingSequence, /^\d+$/);
  });
  await t.test('milligram arithmetic never accumulates float error and supports exact int64 balances', async () => {
    const lot = await create('0.3');
    await post(lot, 'out', '0.1'); await post(lot, 'out', '0.1'); await post(lot, 'in', '0.001');
    assert.equal((await inventory.get(viewer, lot.id)).qty, '0.101');
    const max = await create('9223372036854775.807', { materialId: 'big' });
    await assert.rejects(post(max, 'in', '0.001'), { code: 'INVALID_QUANTITY', status: 400 });
    await create('9223372036854775.807', { materialId: 'big' });
    const summary = (await inventory.summary(viewer, { materialId: 'big' }))[0];
    assert.equal(summary.totalQtyMg, '18446744073709551614');
    assert.equal(summary.totalQty, '18446744073709551.614');
    const exact = await create('9007199254740.993');
    await post(exact, 'out', '0.001');
    assert.equal((await inventory.get(viewer, exact.id)).qtyMg, '9007199254740992');
  });
  await t.test('in/out/count/scrap preserve before, after, delta and a non-editable ledger', async () => {
    let lot = await create('500');
    let txn = await post(lot, 'out', '100', {}, staff);
    assert.deepEqual([txn.beforeQty, txn.afterQty, txn.deltaQty], ['500', '400', '-100']);
    await post(lot, 'in', '50', {}, staff);
    lot = await inventory.get(owner, lot.id);
    txn = await post(lot, 'adjust', '425', { version: lot.version, notes: '实盘' });
    assert.deepEqual([txn.qty, txn.beforeQty, txn.afterQty, txn.deltaQty], ['425', '450', '425', '-25']);
    await post(lot, 'scrap', '425', { notes: '损坏' });
    lot = await inventory.get(viewer, lot.id);
    assert.equal(lot.qty, '0'); assert.equal(lot.state, 'scrapped');
    await assert.rejects(post(lot, 'in', '1'), { code: 'LOT_INACTIVE' });
    await assert.rejects(pool.query('UPDATE erp.inventory_txns SET notes=$2 WHERE id=$1', [txn.id, 'edit']), { code: '55000' });
  });
  await t.test('roles, count versions, reasons and payload precision are enforced without partial writes', async () => {
    const lot = await create('1');
    for (const type of ['adjust', 'scrap']) await assert.rejects(post(lot, type, '1', { version: lot.version, notes: '原因' }, staff), { code: 'BUSINESS_FORBIDDEN', status: 403 });
    await assert.rejects(post(lot, 'adjust', '0'), { code: 'VERSION_INVALID' });
    await assert.rejects(post(lot, 'adjust', '0', { version: '99' }), { code: 'VERSION_CONFLICT' });
    await assert.rejects(post(lot, 'scrap', '1'), { code: 'REASON_REQUIRED' });
    await assert.rejects(post(lot, 'out', '1', {}, viewer), { code: 'BUSINESS_FORBIDDEN' });
    for (const qty of ['0', '-1', '1g', '1e2', '0.0001', '', 0.1]) await assert.rejects(post(lot, 'out', qty), { status: 400 });
    await assert.rejects(post(lot, 'in', '1', { unit: 'kg' }), { code: 'INVALID_UNIT' });
    await assert.rejects(post(lot, 'in', '1', { qty_g: '2' }), { code: 'INVALID_QUANTITY' });
    assert.equal((await inventory.get(viewer, lot.id)).qty, '1');
    assert.equal((await inventory.listTransactions(viewer, { lotId: lot.id })).total, 1);
    await post(lot, 'adjust', '0', { version: lot.version });
    assert.equal((await inventory.get(viewer, lot.id)).qty, '0');
  });
  await t.test('same-key concurrency replays one committed result and own receipts stay isolated', async () => {
    const lot = await create('10');
    const payload = { lotId: lot.id, type: 'out', qty: '2' };
    const results = await Promise.all([command('inventory.post', payload, staff, 'same-out'), command('inventory.post', payload, staff, 'same-out')]);
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(await inventory.getReceipt(staff, 'same-out'), results[0]);
    await assert.rejects(inventory.getReceipt(owner, 'same-out'), { code: 'COMMAND_NOT_FOUND' });
    await assert.rejects(command('inventory.post', { ...payload, qty: '3' }, staff, 'same-out'), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal((await inventory.get(viewer, lot.id)).qty, '8');
    assert.equal((await inventory.listTransactions(viewer, { lotId: lot.id })).total, 2);
  });
  await t.test('different keys cannot oversell and concurrent credits keep a continuous ordered ledger', async () => {
    const lot = await create('1');
    const competed = await Promise.allSettled(['out-a', 'out-b'].map(k => post(lot, 'out', '0.75', {}, staff, k)));
    assert.equal(competed.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(competed.find(r => r.status === 'rejected').reason.code, 'INSUFFICIENT_STOCK');
    assert.equal((await inventory.get(viewer, lot.id)).qty, '0.25');
    await Promise.all(Array.from({ length: 10 }, (_, i) => post(lot, 'in', '0.001', {}, staff, `credit-${i}`)));
    assert.equal((await inventory.get(viewer, lot.id)).qty, '0.26');
    const rows = (await pool.query('SELECT before_qty_mg,after_qty_mg,delta_qty_mg,posting_seq FROM erp.inventory_txns WHERE lot_id=$1 ORDER BY posting_seq', [lot.id])).rows;
    let balance = 0n; let sequence = 0n;
    for (const row of rows) {
      assert.equal(BigInt(row.before_qty_mg), balance);
      balance += BigInt(row.delta_qty_mg); assert.equal(BigInt(row.after_qty_mg), balance);
      assert.ok(BigInt(row.posting_seq) > sequence); sequence = BigInt(row.posting_seq);
    }
    assert.equal(balance, 260n);
  });
  await t.test('editing, archive, restore and freeze never alter balances or append quantity facts', async () => {
    let lot = await create('500');
    const initial = lot;
    lot = (await command('lot.update', { id: lot.id, version: lot.version, changes: { location: 'A-01', notes: '', photoKey: 'photo.png' } })).body;
    assert.equal(lot.qtyMg, initial.qtyMg); assert.equal(lot.notes, ''); assert.equal(lot.location, 'A-01');
    await assert.rejects(command('lot.update', { id: lot.id, version: lot.version, changes: { qtyMg: '1' } }), { status: 400 });
    await assert.rejects(command('lot.update', { id: lot.id, version: '1', changes: { notes: '旧版本' } }), { code: 'VERSION_CONFLICT' });
    lot = (await command('lot.setState', { id: lot.id, version: lot.version, state: 'frozen' })).body;
    await assert.rejects(post(lot, 'out', '1'), { code: 'LOT_INACTIVE' });
    lot = (await command('lot.setState', { id: lot.id, version: lot.version, state: 'in_stock' })).body;
    lot = (await command('lot.archive', { id: lot.id, version: lot.version })).body;
    await assert.rejects(post(lot, 'in', '1'), { code: 'LOT_INACTIVE' });
    lot = (await command('lot.update', { id: lot.id, version: lot.version, changes: { active: true, photoKey: '' } })).body;
    assert.equal(lot.qtyMg, initial.qtyMg);
    assert.equal((await inventory.listTransactions(viewer, { lotId: lot.id })).total, 1);
    assert.equal(await fs.readFile(path.join(dir, 'photo.png'), 'utf8'), 'image fixture');
  });
  await t.test('legacy absolute counts are retained, not summed; unknown v3 order remains unverified', async () => {
    let lot = await inventory.get(viewer, 'legacy'); assert.equal(lot.qty, '400');
    assert.equal(lot.extra, '9007199254740993.01');
    const old = await inventory.getTransaction(viewer, 'old-adjust');
    assert.equal(old.qty, '500'); assert.equal(old.deltaQtyMg, null); assert.equal(old.legacy, true);
    assert.equal(old.postingSequence, null);
    assert.equal((await inventory.getTransaction(viewer, 'v3-out')).orderingVerified, false);
    await post(lot, 'in', '10', {}, staff);
    lot = await inventory.get(viewer, 'legacy');
    assert.equal(lot.qty, '410'); assert.equal(lot.ledgerBaselineQtyMg, '500000'); assert.equal(lot.balanceStatus, 'legacy_unverified');
    assert.equal((await pool.query("SELECT legacy_payload->>'extra' AS extra FROM erp.inventory_txns WHERE id='old-adjust'")).rows[0].extra, '9007199254740993.01');
    await assert.rejects(command('lot.delete', { id: lot.id, version: lot.version }), { code: 'LOT_REFERENCED' });
  });
  await t.test('invalid historical balances are visible and cannot be operated, reactivated or deleted', async () => {
    const invalid = await inventory.get(viewer, 'invalid');
    assert.equal(invalid.qty, null); assert.equal(invalid.legacyBalance, '损坏的旧余额');
    await assert.rejects(post(invalid, 'in', '1'), { code: 'LEGACY_BALANCE_INVALID' });
    await assert.rejects(command('lot.update', { id: invalid.id, version: invalid.version, changes: { active: true } }), { code: 'LEGACY_BALANCE_INVALID' });
    await assert.rejects(command('lot.delete', { id: invalid.id, version: invalid.version }), { code: 'LOT_REFERENCED' });
    const summary = (await inventory.summary(viewer, { materialId: 'mat' }))[0];
    assert.equal(summary.balanceIncomplete, true); assert.equal(summary.legacyUnverified, true);
  });
  await t.test('creation requires an active material and the default warehouse; invalid photo and references roll back', async () => {
    await assert.rejects(create('1', { materialId: 'missing' }), { code: 'MATERIAL_UNAVAILABLE' });
    await assert.rejects(create('1', { materialId: 'disabled' }), { code: 'MATERIAL_UNAVAILABLE' });
    await assert.rejects(create('1', { warehouseId: 'other' }), { code: 'INVALID_WAREHOUSE' });
    await assert.rejects(create('1', { photoKey: '../escape' }), { code: 'FILE_REFERENCE_INVALID' });
    const lot = await create('1');
    await assert.rejects(post(lot, 'out', '1', { orderId: 'missing' }), { code: 'ORDER_NOT_FOUND' });
    assert.equal((await inventory.get(viewer, lot.id)).qty, '1');
  });
  await t.test('batch import is all-or-nothing and a replay does not duplicate openings', async () => {
    const before = (await inventory.list(viewer)).total;
    await assert.rejects(command('lots.import', { lots: [{ materialId: 'mat', qty: '1' }, { materialId: 'mat', qty: '0.0001' }] }), { status: 400 });
    assert.equal((await inventory.list(viewer)).total, before);
    const payload = { lots: [{ materialId: 'mat', qty: '1' }, { materialId: 'mat', qty: '2' }] };
    const result = await command('lots.import', payload, staff, 'lots-import');
    assert.equal(result.body.imported, 2);
    assert.deepEqual(await command('lots.import', payload, staff, 'lots-import'), result);
    assert.equal((await inventory.list(viewer)).total, before + 2);
  });
  await t.test('receipt and audit failures roll back balance, version, ledger and all command facts', async () => {
    const lot = await create('5');
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT stock_receipt_probe CHECK(key <> 'stock-receipt-fail')");
    await assert.rejects(post(lot, 'out', '1', {}, owner, 'stock-receipt-fail'), { code: 'BUSINESS_DATA_INVALID' });
    assert.deepEqual(await inventory.get(viewer, lot.id), lot);
    await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT stock_audit_probe CHECK(diff->'txn'->>'notes' IS DISTINCT FROM '审计失败')");
    await assert.rejects(post(lot, 'scrap', '1', { notes: '审计失败' }), { code: 'BUSINESS_DATA_INVALID' });
    assert.deepEqual(await inventory.get(viewer, lot.id), lot);
    assert.equal((await inventory.listTransactions(viewer, { lotId: lot.id })).total, 1);
  });
  await t.test('zero unused lots can be deleted, but historical order snapshots protect references', async () => {
    const lot = await create('0');
    assert.equal((await inventory.listTransactions(viewer, { lotId: lot.id })).total, 0);
    await assert.rejects(command('lot.delete', { id: lot.id }), { code: 'VERSION_INVALID' });
    assert.equal((await command('lot.delete', { id: lot.id, version: lot.version })).body.success, true);
    await assert.rejects(inventory.get(viewer, lot.id), { code: 'ENTITY_NOT_FOUND' });
    const referenced = await create('0');
    await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('c1','C1','客户'),('c2','C2','另一个客户')");
    await pool.query("INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by,legacy_payload) VALUES('legacy-order','LEGACY','c1','{}','draft',0,'owner',$1)", [JSON.stringify({ stockLotId: referenced.id })]);
    await assert.rejects(command('lot.delete', { id: referenced.id, version: referenced.version }), { code: 'LOT_REFERENCED' });
  });
  await t.test('order and inventory locks prevent concurrent commercial edits after stock posting', async () => {
    const orders = createOrderService(pool);
    const order = (await orders.execute({ ...owner, key: 'order-lock-create', operation: 'order.create', payload: { customerId: 'c1', items: [{ quantity: '1', unitPrice: '1' }] } })).body;
    const lot = await create('2');
    const blocker = await pool.connect();
    const waitFor = async pattern => {
      for (let i = 0; i < 200; i++) {
        const row = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1) AS waiting", [pattern])).rows[0];
        if (row.waiting) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail('Expected a real blocked PostgreSQL operation');
    };
    let posting; let editing;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM erp.stock_lots WHERE id=$1 FOR UPDATE', [lot.id]);
      posting = post(lot, 'out', '1', { orderId: order.id }, staff).then(value => ({ value }), error => ({ error }));
      await waitFor('%erp.stock_lots%FOR UPDATE%');
      editing = orders.execute({ ...owner, key: 'order-lock-update', operation: 'order.update', payload: { id: order.id, version: order.version, changes: { customerId: 'c2' } } }).then(value => ({ value }), error => ({ error }));
      await waitFor('%erp.orders%FOR UPDATE%');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    const posted = await posting; assert.ok(posted.value, posted.error?.message);
    const edited = await editing; assert.equal(edited.error?.code, 'ORDER_COMMERCIAL_LOCKED');
    assert.equal((await inventory.get(viewer, lot.id)).qty, '1');
    assert.equal((await orders.get(viewer, order.id)).customerId, 'c1');
  });
  await t.test('read filters, availability summaries and stale sessions use the same current balances', async () => {
    const lot = await create('3', { lotNo: '搜索批次' });
    const found = await inventory.list(viewer, { search: '搜索批次', materialId: 'mat', state: 'in_stock' });
    assert.equal(found.total, 1); assert.equal(found.items[0].id, lot.id);
    assert.equal((await inventory.list(viewer, { search: '%_\' OR true --' })).total, 0);
    await assert.rejects(inventory.list(viewer, { limit: -1 }), { status: 400 });
    await assert.rejects(inventory.get({ ...viewer, tokenVersion: '2' }, lot.id), { code: 'AUTHENTICATION_REQUIRED' });
    const sum = (await inventory.summary(viewer, { materialId: 'mat' }))[0];
    assert.ok(BigInt(sum.totalQtyMg) >= BigInt(sum.availableQtyMg));
    await pool.query("UPDATE erp.users SET active=false WHERE id='viewer'");
    await assert.rejects(inventory.listTransactions(viewer), { code: 'AUTHENTICATION_REQUIRED' });
  });
});
