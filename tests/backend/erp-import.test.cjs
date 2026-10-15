'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseSource } = require('../../backend/business-db/preflight/source');
const { buildPreflightReport } = require('../../backend/business-db/preflight/report');
const { validateDecisions, REVIEW_ACTIONS } = require('../../backend/business-db/import/decisions');
const { importLegacySnapshot } = require('../../backend/business-db/import/legacy');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const timestamp = '2026-09-29T00:00:00.000Z';
const cli = path.resolve(__dirname, '../../backend/scripts/erp-import-rehearsal.js');

test('rehearsal CLI refuses default, nonlocal and daily database targets without disclosing secrets', () => {
  for (const [name, value] of [['DATABASE_URL', 'postgresql://user:secret@127.0.0.1/daily'],
    ['ERP_REHEARSAL_URL', 'postgresql://user:secret@192.168.0.32/erp_import_rehearsal'],
    ['ERP_REHEARSAL_URL', 'postgresql://user:secret@127.0.0.1/daily']]) {
    const child = spawnSync(process.execPath, [cli, '--source-file', 'missing.json', '--decisions-file', 'missing.json', '--target-env', name],
      { encoding: 'utf8', env: { ...process.env, [name]: value } });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.ok(!child.stderr.includes('secret'));
  }
});

function fixture() {
  const order = id => ({ id, number: `ORDER-${id}`, createdBy: 'u1', status: 'draft', statusReason: '保留原原因', currency: 'CNY', total: 1,
    customer: { id: 'same', name: '同名客户', extra: true }, attachments: [], createdAt: timestamp,
    items: [{ id: 'line1', modelId: 'm1', modelName: '历史模型名', quantity: '0.333', unitPrice: '3.000001', subtotal: 1, color: '旧颜色' }] });
  return { schemaVersion: 3, system: { serverId: 'f5942634-5fdd-4964-abc6-3971b1787c0b', initializedAt: timestamp, organizationName: '测试组织' },
    users: [{ id: 'u1', email: 'Owner@example.test', name: '原用户', role: 'owner', tokenVersion: 7, passwordHash: 'untouched-hash', active: true }],
    orders: [order('o1'), order('o2')], models: [{ id: 'm1', name: '模型', files: [], images: [] }], materials: [{ id: 'mat1', type: 'PLA', unitPrice: '0.010001' }],
    stockLots: [{ id: 'l1', materialId: 'mat1', qtyMg: 400000, qty: 400, ledgerBaselineQtyMg: 500000, balanceStatus: 'legacy_unverified', version: 2 }],
    inventoryTxns: [{ id: 'old', lotId: 'l1', type: 'adjust', qty: 500 },
      { id: 'new', lotId: 'l1', type: 'out', qty: 100, qtyMg: 100000, beforeQtyMg: 500000, afterQtyMg: 400000, deltaQtyMg: -100000, ledgerVersion: 1, actorId: 'u1', orderId: 'o1' }],
    auditLogs: [{ id: 'a1', actorId: 'deleted', entity: 'orders', entityId: 'o1', action: 'edit', diff: { extra: true }, createdAt: timestamp }],
    commandReceipts: [{ id: 'r1', actorId: 'u1', key: 'original-key', operation: 'inventory.post', digest: 'a'.repeat(64), result: { status: 201, body: { id: 'new' } } }],
    objectUploads: [{ id: 'upload1', objectKey: 'remote/file.stl', createdBy: 'u1', status: 'pending', purpose: 'model', entityId: 'm1' }] };
}
function decisionsFor(report) {
  return { sourceSha256: report.sourceSha256, approved: true,
    customers: report.customerMappings.map(row => ({ orderId: row.orderId, targetId: row.targetKey, action: 'create_separate_customer' })),
    reviews: report.issues.filter(row => row.severity === 'review').map(({ severity, ...row }) => ({ ...row, action: REVIEW_ACTIONS[row.code] })) };
}
async function prepared(data = fixture(), uploadDirectory) {
  const source = parseSource(JSON.stringify(data).replace('"extra":true', '"extra":9007199254740993.01'));
  const report = await buildPreflightReport(source, { uploadDirectory });
  assert.equal(report.blockerCount, 0);
  return { source, decisions: decisionsFor(report), report, uploadDirectory };
}

test('decisions require the exact source and every review; customers cannot silently merge', async () => {
  const { source, report, decisions } = await prepared();
  assert.equal(validateDecisions(report, decisions).sourceSha256, source.sha256);
  for (const mutate of [d => { d.approved = false; }, d => { d.sourceSha256 = '0'.repeat(64); },
    d => { d.reviews.pop(); }, d => { d.reviews.push(d.reviews[0]); },
    d => { d.reviews[0].action = 'ignore'; }, d => { d.customers[1].targetId = d.customers[0].targetId; },
    d => { d.customers.pop(); }, d => { d.customers.push({ ...d.customers[0], orderId: 'unknown' }); }]) {
    const changed = structuredClone(decisions); mutate(changed);
    assert.throws(() => validateDecisions(report, changed), { code: 'ERP_IMPORT_DECISIONS_INVALID' });
  }
});

test('isolated legacy import preserves business facts and rolls back incomplete work', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  const reset = async () => { await pool.query('DROP SCHEMA IF EXISTS erp CASCADE'); await migrateBusinessDatabase(pool); };

  await t.test('complete import keeps exact JSON, independent customers, amounts, balances, files and credentials', async () => {
    await reset();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-import-files-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.writeFile(path.join(directory, 'model.stl'), 'solid model');
    const data = fixture();
    data.models[0].files = [{ id: 'f1', fileKey: 'model.stl', fileUrl: '/api/files/model.stl', size: 11, sha256: createHash('sha256').update('solid model').digest('hex'), extra: true }];
    const options = await prepared(data, directory);
    const raw = options.source.raw;
    const result = await importLegacySnapshot(pool, options);
    assert.equal(result.status, 'completed');
    assert.equal(result.reused, false);
    assert.equal((await pool.query('SELECT source_raw FROM erp.migration_runs')).rows[0].source_raw, raw);
    assert.equal((await pool.query("SELECT legacy_payload->'customer'->>'extra' AS extra FROM erp.orders WHERE id='o1'")).rows[0].extra, '9007199254740993.01');
    assert.deepEqual((await pool.query('SELECT total::text AS total FROM erp.orders ORDER BY id')).rows, [{ total: '1' }, { total: '1' }]);
    assert.equal((await pool.query('SELECT status_reason FROM erp.orders LIMIT 1')).rows[0].status_reason, '保留原原因');
    assert.equal((await pool.query('SELECT count(DISTINCT customer_id)::int AS n FROM erp.orders')).rows[0].n, 2);
    assert.deepEqual((await pool.query('SELECT password_hash,token_version::text FROM erp.users')).rows[0], { password_hash: 'untouched-hash', token_version: '7' });
    assert.equal((await pool.query("SELECT qty_mg FROM erp.stock_lots WHERE id='l1'")).rows[0].qty_mg, '400000');
    assert.equal((await pool.query("SELECT delta_qty_mg FROM erp.inventory_txns WHERE id='old'")).rows[0].delta_qty_mg, null);
    assert.deepEqual((await pool.query('SELECT id FROM erp.inventory_txns ORDER BY posting_seq')).rows.map(row => row.id), ['old', 'new']);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.inventory_txns WHERE posting_seq IS NULL')).rows[0].n, 0);
    assert.deepEqual((await pool.query("SELECT actor_id,legacy_actor_id FROM erp.audit_logs WHERE id='a1'")).rows[0], { actor_id: null, legacy_actor_id: 'deleted' });
    assert.equal((await pool.query('SELECT status_code FROM erp.command_receipts')).rows[0].status_code, 201);
    assert.equal((await pool.query("SELECT metadata->>'status' AS status FROM erp.object_uploads")).rows[0].status, 'pending');
    assert.equal((await pool.query('SELECT file_key FROM erp.model_files')).rows[0].file_key, 'model.stl');
    assert.equal((await pool.query('SELECT storage_mode FROM erp.installation')).rows[0].storage_mode, 'legacy');
    assert.equal(options.source.raw, raw);
    const again = await importLegacySnapshot(pool, options);
    assert.equal(again.reused, true);
    assert.equal(again.runId, result.runId);
    const differentDecision = structuredClone(options.decisions);
    differentDecision.customers[0].targetId += '-changed';
    await assert.rejects(importLegacySnapshot(pool, { ...options, decisions: differentDecision }), { code: 'ERP_IMPORT_DECISIONS_CHANGED' });
    await pool.query("UPDATE erp.order_items SET spec_snapshot='{}' WHERE order_id='o1'");
    await assert.rejects(importLegacySnapshot(pool, options), { code: 'ERP_IMPORT_RECONCILIATION_FAILED' });
    const changed = await prepared({ ...data, updatedAt: timestamp }, directory);
    await assert.rejects(importLegacySnapshot(pool, changed), { code: 'ERP_IMPORT_TARGET_NOT_EMPTY' });
  });
  await t.test('concurrent same-source imports commit only once', async () => {
    await reset();
    const options = await prepared();
    const results = await Promise.all([importLegacySnapshot(pool, options), importLegacySnapshot(pool, options)]);
    assert.equal(results.filter(r => r.reused).length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.migration_runs')).rows[0].n, 1);
  });
  await t.test('numeric order amounts beyond 2^53 retain every cent without float conversion', async () => {
    await reset();
    const data = fixture();
    data.orders[0].total = '9007199254740993.01';
    Object.assign(data.orders[0].items[0], { quantity: '100', unitPrice: '90071992547409.930100', subtotal: '9007199254740993.01' });
    const source = parseSource(JSON.stringify(data).replaceAll('"9007199254740993.01"', '9007199254740993.01'));
    const report = await buildPreflightReport(source);
    assert.equal(report.blockerCount, 0);
    await importLegacySnapshot(pool, { source, decisions: decisionsFor(report) });
    const row = (await pool.query("SELECT total::text,legacy_payload->>'total' AS original,jsonb_typeof(legacy_payload->'total') AS original_type FROM erp.orders WHERE id='o1'")).rows[0];
    assert.deepEqual(row, { total: '9007199254740993.01', original: '9007199254740993.01', original_type: 'number' });
  });
  await t.test('mid-import database failure rolls back identity, facts, mappings and run record together', async () => {
    await reset();
    await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT inject_failure CHECK (id <> 'a1')");
    await assert.rejects(importLegacySnapshot(pool, await prepared()), { code: '23514' });
    for (const table of ['installation', 'users', 'orders', 'customers', 'materials', 'models', 'stock_lots', 'inventory_txns', 'migration_runs', 'legacy_id_map']) {
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM erp.${table}`)).rows[0].n, 0, table);
    }
  });
  await t.test('preflight blockers, absent approval and changed raw source never write target data', async () => {
    await reset();
    const options = await prepared();
    await assert.rejects(importLegacySnapshot(pool, { ...options, decisions: { ...options.decisions, approved: false } }), { code: 'ERP_IMPORT_DECISIONS_INVALID' });
    const bad = fixture(); bad.orders[0].total = 3;
    await assert.rejects(importLegacySnapshot(pool, { source: parseSource(JSON.stringify(bad)), decisions: options.decisions }), { code: 'ERP_IMPORT_SOURCE_BLOCKED' });
    await assert.rejects(importLegacySnapshot(pool, { ...options, source: { ...options.source, raw: options.source.raw + ' ' } }), { code: 'PREFLIGHT_SOURCE_CHANGED' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.users')).rows[0].n, 0);
  });
  await t.test('mutating the inspection tree cannot change the original data imported', async () => {
    await reset();
    const options = await prepared();
    options.source.data.users[0].passwordHash = 'tampered';
    await importLegacySnapshot(pool, options);
    assert.equal((await pool.query('SELECT password_hash FROM erp.users')).rows[0].password_hash, 'untouched-hash');
  });
  await t.test('a deleted current model keeps the original line snapshot with a null FK', async () => {
    await reset();
    const data = fixture(); data.models = [];
    await importLegacySnapshot(pool, await prepared(data));
    assert.deepEqual((await pool.query("SELECT model_id,model_name_snapshot,spec_snapshot->>'modelId' AS old_id FROM erp.order_items LIMIT 1")).rows[0], { model_id: null, model_name_snapshot: '历史模型名', old_id: 'm1' });
  });
  await t.test('database-side payload alteration is detected and causes the whole import to roll back', async () => {
    await reset();
    await pool.query(`CREATE FUNCTION erp.corrupt_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.spec_snapshot := '{}'::jsonb; RETURN NEW; END; $$;
      CREATE TRIGGER corrupt_probe BEFORE INSERT ON erp.order_items FOR EACH ROW EXECUTE FUNCTION erp.corrupt_probe()`);
    await assert.rejects(importLegacySnapshot(pool, await prepared()), { code: 'ERP_IMPORT_RECONCILIATION_FAILED' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.migration_runs')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.users')).rows[0].n, 0);
  });
  await t.test('CLI performs an isolated import and preserves the source file bytes', async () => {
    await reset();
    const options = await prepared();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-import-cli-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const sourceFile = path.join(dir, 'source.json');
    const decisionsFile = path.join(dir, 'decisions.json');
    await fs.writeFile(sourceFile, options.source.raw);
    await fs.writeFile(decisionsFile, JSON.stringify(options.decisions));
    const args = [cli, '--source-file', sourceFile, '--decisions-file', decisionsFile, '--target-env', 'ERP_BUSINESS_TEST_DATABASE_URL'];
    for (const reused of [false, true]) {
      const child = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.productionCutover, false);
      assert.equal(result.reused, reused);
    }
    assert.equal(await fs.readFile(sourceFile, 'utf8'), options.source.raw);
  });
});
