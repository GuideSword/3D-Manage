'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createBusinessCommands } = require('../../backend/business-db/commands');
const { createVersionedUpdater } = require('../../backend/business-db/versioned');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;

test('command registration rejects untrusted or malformed descriptors', () => {
  for (const definitions of [null, [], { bad: {} }, { bad: { roles: ['admin'], handle() {} } }, { bad: { roles: ['viewer'], handle() {} } }, { bad: { roles: ['owner'], scope: '', handle() {} } }]) {
    assert.throws(() => createBusinessCommands({}, definitions), { code: 'ERP_COMMAND_REGISTRY_INVALID' });
  }
});

test('relational commands enforce permissions, transactions and durable idempotency', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.users(id,email,role,password_hash,token_version) VALUES('owner','owner@test','owner','hash',7),('staff','staff@test','staff','hash',2),('viewer','viewer@test','viewer','hash',1)");
  await pool.query("INSERT INTO erp.materials(id,name) VALUES('m1','PLA')");
  const update = createVersionedUpdater({ 'erp.materials': ['notes'] });
  let calls = 0;
  const write = async (tx, { actor, payload, audit }) => {
    calls += 1;
    const row = await update(tx, { table: 'erp.materials', id: 'm1', expectedVersion: payload.version, changes: { notes: payload.notes } });
    await audit({ entity: 'materials', entityId: row.id, action: 'update', diff: { notes: payload.notes }, actorId: 'forged' });
    return { status: 200, body: { id: row.id, version: row.version, notes: row.notes, actorId: actor.id } };
  };
  const registry = {
    'material.update': { roles: ['owner', 'staff'], handle: write },
    'owner.only': { roles: ['owner'], handle: write },
    'missing.audit': { roles: ['owner'], async handle(tx) { await tx.query("UPDATE erp.materials SET notes='bad' WHERE id='m1'"); return { status: 200, body: {} }; } },
    'inventory.post': { roles: ['owner', 'staff'], scope: 'inventory', authorize: (actor, payload) => payload.type !== 'adjust' || actor.role === 'owner', handle: write },
    'user.rename': { roles: ['owner'], async handle(tx, { actor, payload, audit }) {
      const row = (await tx.query('UPDATE erp.users SET name=$2,version=version+1 WHERE id=$1 RETURNING id,name,version', [actor.id, payload.name])).rows[0];
      await audit({ entity: 'users', entityId: actor.id, action: 'rename', diff: { name: row.name } });
      return { status: 200, body: row };
    } },
  };
  const execute = createBusinessCommands(pool, registry);
  const request = (key, payload = { version: '1', notes: 'saved' }) => ({ operation: 'material.update', actorId: 'owner', tokenVersion: '7', key, payload });
  await t.test('current database identity wins over forged roles; stale, disabled and read-only sessions fail', async () => {
    await assert.rejects(execute({ ...request('role'), operation: 'owner.only', actorId: 'staff', tokenVersion: '2', role: 'owner' }), { code: 'BUSINESS_FORBIDDEN', status: 403 });
    await assert.rejects(execute({ ...request('viewer'), actorId: 'viewer', tokenVersion: '1', role: 'owner' }), { code: 'BUSINESS_FORBIDDEN' });
    await assert.rejects(execute({ ...request('stale'), tokenVersion: '6' }), { code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await assert.rejects(execute({ ...request('missing'), actorId: 'absent' }), { code: 'AUTHENTICATION_REQUIRED' });
    await pool.query("UPDATE erp.users SET active=false WHERE id='staff'");
    await assert.rejects(execute({ ...request('disabled'), actorId: 'staff', tokenVersion: '2' }), { code: 'AUTHENTICATION_REQUIRED' });
    await pool.query("UPDATE erp.users SET active=true WHERE id='staff'");
    await assert.rejects(execute({ ...request('adjust'), operation: 'inventory.post', actorId: 'staff', tokenVersion: '2', payload: { type: 'adjust' } }), { code: 'BUSINESS_FORBIDDEN' });
    assert.equal(calls, 0);
  });
  await t.test('same key with reordered JSON replays a durable result and writes a single audit', async () => {
    const result = await execute(request('once'));
    assert.equal(result.body.version, '2');
    const again = await execute(request('once', { notes: 'saved', version: '1' }));
    assert.deepEqual(again, result);
    assert.equal(calls, 1);
    assert.deepEqual((await pool.query('SELECT actor_id,entity FROM erp.audit_logs')).rows, [{ actor_id: 'owner', entity: 'materials' }]);
    await assert.rejects(execute(request('once', { notes: 'different', version: '1' })), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    const afterRestart = createBusinessCommands(pool, registry);
    assert.deepEqual(await afterRestart(request('once')), result);
  });
  await t.test('same-key concurrency only executes once; independent keys still obey optimistic versions', async () => {
    const input = request('concurrent', { version: '2', notes: 'parallel' });
    const results = await Promise.all([execute(input), execute(input)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(calls, 2);
    const competing = await Promise.allSettled(['winner1', 'winner2'].map(key => execute(request(key, { version: '3', notes: key }))));
    assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(competing.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  });
  await t.test('missing audit and receipt insertion failures roll back the business write', async () => {
    const before = (await pool.query("SELECT notes,version FROM erp.materials WHERE id='m1'")).rows[0];
    await assert.rejects(execute({ ...request('no-audit'), operation: 'missing.audit' }), { code: 'ERP_COMMAND_AUDIT_REQUIRED' });
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT receipt_probe CHECK(key <> 'receipt-failure')");
    await assert.rejects(execute(request('receipt-failure', { version: before.version, notes: 'rollback' })), { code: 'BUSINESS_DATA_INVALID', status: 400 });
    assert.deepEqual((await pool.query("SELECT notes,version FROM erp.materials WHERE id='m1'")).rows[0], before);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.audit_logs WHERE diff->>'notes'='rollback'")).rows[0].n, 0);
    await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT audit_probe CHECK(diff->>'notes' <> 'audit-failure')");
    await assert.rejects(execute(request('audit-failure', { version: before.version, notes: 'audit-failure' })), { code: 'BUSINESS_DATA_INVALID' });
    assert.deepEqual((await pool.query("SELECT notes,version FROM erp.materials WHERE id='m1'")).rows[0], before);
  });
  await t.test('migrated inventory receipts can replay without running a new mutation', async () => {
    const payload = { notes: 'legacy', version: 1 };
    const digest = createHash('sha256').update(JSON.stringify({ operation: 'inventory.post', payload })).digest('hex');
    await pool.query("INSERT INTO erp.command_receipts(id,scope,actor_id,key,payload_hash,status_code,result) VALUES('old','inventory','owner','legacy-key',$1,201,$2)", [digest, JSON.stringify({ status: 201, body: { original: true } })]);
    const before = calls;
    const result = await execute({ ...request('legacy-key', payload), operation: 'inventory.post' });
    assert.deepEqual(result, { status: 201, body: { original: true } });
    assert.equal(calls, before);
  });
  await t.test('actor scopes isolate identical keys and authorization is rechecked even on replay', async () => {
    const version = (await pool.query("SELECT version FROM erp.materials WHERE id='m1'")).rows[0].version;
    await execute({ ...request('once', { version, notes: 'staff-change' }), actorId: 'staff', tokenVersion: '2' });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.command_receipts WHERE key='once'")).rows[0].n, 2);
    await pool.query("UPDATE erp.users SET role='viewer' WHERE id='staff'");
    await assert.rejects(execute({ ...request('once', { version, notes: 'staff-change' }), actorId: 'staff', tokenVersion: '2' }), { code: 'BUSINESS_FORBIDDEN' });
  });
  await t.test('same-key self-account updates replay successfully without an actor-lock deadlock', async () => {
    const input = { ...request('rename-self', { name: '新姓名' }), operation: 'user.rename' };
    const results = await Promise.all([execute(input), execute(input)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].body.version, '2');
  });
});
