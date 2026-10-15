'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;

test('core schema enforces business invariants on PostgreSQL 16', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  const v1 = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-core-v1-'));
  t.after(() => fs.rm(v1, { recursive: true, force: true }));
  await fs.copyFile(path.resolve(__dirname, '../../backend/business-db/migrations/0001_foundation.sql'), path.join(v1, '0001_foundation.sql'));
  assert.deepEqual((await migrateBusinessDatabase(pool, { migrationsDirectory: v1 })).applied, [1]);
  const migrated = await migrateBusinessDatabase(pool);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.applied, [2]);
  assert.deepEqual((await migrateBusinessDatabase(pool)).applied, []);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.installation')).rows[0].n, 0);

  await t.test('users enforce normalized unique email, roles and positive versions', async () => {
    await pool.query("INSERT INTO erp.users(id,email,name,role,password_hash) VALUES('u1','owner@example.test','Owner','owner','original-hash')");
    await assert.rejects(pool.query("INSERT INTO erp.users(id,email,name,role,password_hash) VALUES('u2','OWNER@example.test','Other','staff','hash')"), { code: '23505' });
    await assert.rejects(pool.query("UPDATE erp.users SET role='admin' WHERE id='u1'"), { code: '23514' });
    await assert.rejects(pool.query("UPDATE erp.users SET version=0 WHERE id='u1'"), { code: '23514' });
    await assert.rejects(pool.query("UPDATE erp.users SET token_version=0 WHERE id='u1'"), { code: '23514' });
  });
  await t.test('customer names may repeat, codes cannot, and used profiles cannot be deleted', async () => {
    await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('c1','C1','同名客户'),('c2','C2','同名客户')");
    await assert.rejects(pool.query("INSERT INTO erp.customers(id,code,name) VALUES('c3','C1','重复编号')"), { code: '23505' });
    await pool.query("INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by) VALUES('o1','O1','c1','{\"name\":\"历史名称\"}','draft',1.00,'u1')");
    await assert.rejects(pool.query("DELETE FROM erp.customers WHERE id='c1'"), { code: '23503' });
    await assert.rejects(pool.query("DELETE FROM erp.users WHERE id='u1'"), { code: '23503' });
    await pool.query("UPDATE erp.customers SET name='改名',active=false WHERE id='c1'");
    assert.equal((await pool.query("SELECT customer_snapshot->>'name' AS name FROM erp.orders WHERE id='o1'")).rows[0].name, '历史名称');
  });
  await t.test('decimal domains reject truncation, nonfinite, negative and overflowing values', async () => {
    await pool.query("INSERT INTO erp.order_items(order_id,id,position,quantity,unit_price,subtotal,spec_snapshot) VALUES('o1','i1',0,0.333,3.000001,1.00,'{\"extra\":9007199254740993.01}')");
    assert.equal((await pool.query("SELECT spec_snapshot->>'extra' AS extra FROM erp.order_items WHERE id='i1'")).rows[0].extra, '9007199254740993.01');
    for (const expression of ['0.3333', '0', '-1', '1e15', "'NaN'", "'Infinity'"]) {
      await assert.rejects(pool.query(`UPDATE erp.order_items SET quantity=${expression} WHERE id='i1'`), { code: '23514' });
    }
    for (const expression of ['0.0000001', '-1', '1e14', "'NaN'", "'Infinity'"]) {
      await assert.rejects(pool.query(`UPDATE erp.order_items SET unit_price=${expression} WHERE id='i1'`), { code: '23514' });
    }
    for (const expression of ['0.001', '-1', '1e18', "'NaN'", "'Infinity'"]) {
      await assert.rejects(pool.query(`UPDATE erp.orders SET total=${expression} WHERE id='o1'`), { code: '23514' });
    }
    await assert.rejects(pool.query("INSERT INTO erp.order_items(order_id,id,position,quantity,unit_price,subtotal) VALUES('o1','i2',0,1,1,1)"), { code: '23505' });
    await assert.rejects(pool.query("UPDATE erp.orders SET currency='USD' WHERE id='o1'"), { code: '23514' });
    await assert.rejects(pool.query("UPDATE erp.orders SET status='paid' WHERE id='o1'"), { code: '23514' });
  });
  await t.test('models and files preserve order and unknown attributes with reference protection', async () => {
    await pool.query("INSERT INTO erp.models(id,name) VALUES('m1','模型')");
    await pool.query("INSERT INTO erp.model_files(model_id,id,position,file_key,url,metadata) VALUES('m1','f1',0,'same.stl','/api/files/same.stl','{\"extra\":true}')");
    await assert.rejects(pool.query("DELETE FROM erp.models WHERE id='m1'"), { code: '23503' });
    await assert.rejects(pool.query("INSERT INTO erp.model_files(model_id,id,position) VALUES('missing','f2',1)"), { code: '23503' });
  });
  await t.test('only one default warehouse and valid stock balances are allowed', async () => {
    await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('w1','DEFAULT','默认仓库',true)");
    await assert.rejects(pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('w2','OTHER','其他仓库',true)"), { code: '23505' });
    await pool.query("INSERT INTO erp.materials(id,name) VALUES('mat1','PLA')");
    await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status) VALUES('l1','mat1','w1',500000,0,'tracked')");
    await assert.rejects(pool.query("UPDATE erp.stock_lots SET qty_mg=-1 WHERE id='l1'"), { code: '23514' });
    await assert.rejects(pool.query("UPDATE erp.stock_lots SET baseline_qty_mg=1 WHERE id='l1'"), { code: '23514' });
    await assert.rejects(pool.query("DELETE FROM erp.materials WHERE id='mat1'"), { code: '23503' });
    await assert.rejects(pool.query("DELETE FROM erp.warehouses WHERE id='w1'"), { code: '23503' });
    await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status,active,legacy_payload) VALUES('bad','mat1','w1',NULL,NULL,'legacy_invalid',false,'{\"qty\":\"corrupt\"}')");
  });
  await t.test('new movements enforce arithmetic and direction; old absolute adjustments remain separate', async () => {
    await pool.query("INSERT INTO erp.inventory_txns(id,lot_id,actor_id,type,qty_mg,before_qty_mg,after_qty_mg,delta_qty_mg,ledger_version) VALUES('t1','l1','u1','in',500000,0,500000,500000,1)");
    await assert.rejects(pool.query("INSERT INTO erp.inventory_txns(id,lot_id,type,qty_mg,before_qty_mg,after_qty_mg,delta_qty_mg,ledger_version) VALUES('bad','l1','out',100,500,400,100,1)"), { code: '23514' });
    await assert.rejects(pool.query("UPDATE erp.inventory_txns SET qty_mg=1 WHERE id='t1'"), { code: '55000' });
    await assert.rejects(pool.query("DELETE FROM erp.inventory_txns WHERE id='t1'"), { code: '55000' });
    await pool.query("INSERT INTO erp.inventory_txns(id,lot_id,type,legacy_payload) VALUES('old','l1','adjust','{\"qty\":500,\"absolute\":true}')");
    assert.equal((await pool.query("SELECT delta_qty_mg FROM erp.inventory_txns WHERE id='old'")).rows[0].delta_qty_mg, null);
  });
  await t.test('audit and receipts preserve historical actors, payloads and uniqueness', async () => {
    await pool.query("INSERT INTO erp.audit_logs(id,actor_id,legacy_actor_id,entity,entity_id,action,legacy_payload) VALUES('a1',NULL,'deleted','orders','o1','edit','{\"actorId\":\"deleted\"}')");
    await assert.rejects(pool.query("UPDATE erp.audit_logs SET action='delete' WHERE id='a1'"), { code: '55000' });
    const sql = "INSERT INTO erp.command_receipts(id,scope,actor_id,key,payload_hash,status_code,result) VALUES($1,'inventory','u1','key',$2,200,'{}')";
    await pool.query(sql, ['r1', 'a'.repeat(64)]);
    await assert.rejects(pool.query(sql, ['r2', 'a'.repeat(64)]), { code: '23505' });
    await assert.rejects(pool.query(sql, ['r3', 'wrong']), { code: '23514' });
  });
  await t.test('migration sources and legacy IDs have unique, constrained mappings', async () => {
    await pool.query("INSERT INTO erp.migration_runs(id,source_sha256,decisions_sha256,source_raw,status) VALUES('run1',$1,$2,'{}','importing')", ['a'.repeat(64), 'b'.repeat(64)]);
    await pool.query("INSERT INTO erp.legacy_id_map(run_id,collection,source_id,target_table,target_id) VALUES('run1','orders','o1','orders','o1')");
    await assert.rejects(pool.query("INSERT INTO erp.legacy_id_map(run_id,collection,source_id,target_table,target_id) VALUES('run1','orders','o1','orders','other')"), { code: '23505' });
  });
});
