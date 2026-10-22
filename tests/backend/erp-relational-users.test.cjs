'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createBusinessCommands } = require('../../backend/business-db/commands');
const { TOKEN_AUDIENCE } = require('../../backend/utils/authTokens');
const { createUserService } = require('../../backend/modules/users/service');
const { createUserAuthentication } = require('../../backend/modules/users/authentication');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const secret = 'isolated-users-fixture-key-at-least-32-bytes';
const password = 'Fixture-Password-2026!';
const newPassword = 'Changed-Password-2026!';
const serverId = 'f5942634-5fdd-4964-abc6-3971b1787c0b';
const session = id => ({ actorId: id, tokenVersion: '1' });

test('user factories require an explicit credential key', () => {
  assert.throws(() => createUserService({}), { code: 'AUTH_CONFIGURATION_INVALID' });
  assert.throws(() => createUserAuthentication({}, { jwtSecret: 'short' }), { code: 'AUTH_CONFIGURATION_INVALID' });
});

test('database outages remain service errors instead of silently invalidating the session', async () => {
  const offline = Object.assign(new Error('isolated database outage'), { code: 'ECONNRESET' });
  const unavailable = { connect: async () => { throw offline; }, query: async () => { throw offline; } };
  const auth = createUserAuthentication(unavailable, { jwtSecret: secret });
  const token = jwt.sign({ sub: 'ownerA', ver: 1 }, secret, { algorithm: 'HS256', audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` });
  await assert.rejects(auth.authenticate(token), error => error === offline);
  await assert.rejects(auth.login({ email: 'ownera@test.example', password }), error => error === offline);
});

test('relational users protect credentials, current sessions and the last Owner', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  const hash = await bcrypt.hash(password, 12);
  const users = createUserService(pool, { jwtSecret: secret });
  const auth = createUserAuthentication(pool, { jwtSecret: secret });
  let key = 0;
  const command = (operation, payload, actor = 'ownerA', requestKey) => users.execute({ ...session(actor), operation, payload, key: requestKey || `users-${++key}` });
  const reset = async () => {
    await pool.query('DROP SCHEMA IF EXISTS erp CASCADE');
    await migrateBusinessDatabase(pool);
    await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'测试组织',now(),'legacy')", [serverId]);
    await pool.query("INSERT INTO erp.users(id,email,name,role,password_hash) VALUES('ownerA','ownera@test.example','Owner A','owner',$1),('ownerB','ownerb@test.example','Owner B','owner',$1),('staff','staff@test.example','员工','staff',$1),('viewer','viewer@test.example','访客','viewer',$1)", [hash]);
  };
  const publicOnly = user => {
    for (const field of ['password', 'passwordHash', 'password_hash', 'tokenVersion', 'token_version', 'legacy_payload', 'legacy_raw']) assert.equal(Object.hasOwn(user, field), false, field);
  };
  const create = (email = 'new@test.example', role = 'staff') => command('user.create', { name: '新用户', email, role, password });

  await t.test('Owner creates and edits users with server IDs, unchanged email/hash and safe public DTOs', async () => {
    await reset();
    const created = (await create(' New@Test.Example ')).body;
    assert.match(created.id, /^[a-f0-9-]{36}$/); assert.equal(created.email, 'new@test.example'); assert.equal(created.version, '1'); publicOnly(created);
    const oldHash = (await pool.query('SELECT password_hash FROM erp.users WHERE id=$1', [created.id])).rows[0].password_hash;
    const edited = (await command('user.update', { id: created.id, version: created.version, changes: { name: '新姓名' } })).body;
    assert.equal(edited.name, '新姓名'); assert.equal(edited.version, '2'); assert.equal(edited.email, created.email); publicOnly(edited);
    assert.equal((await pool.query('SELECT password_hash FROM erp.users WHERE id=$1', [created.id])).rows[0].password_hash, oldHash);
    assert.equal((await users.list(session('ownerA'), { search: '新姓名' })).total, 1);
    assert.equal((await users.get(session('ownerA'), created.id)).name, '新姓名');
    assert.equal((await users.me(session('staff'))).name, '员工');
  });
  await t.test('Staff/Viewer cannot manage accounts and protected fields/duplicate emails/invalid passwords are rejected', async () => {
    await reset();
    for (const actor of ['staff', 'viewer']) {
      await assert.rejects(command('user.create', { name: '越权', email: 'x@test.example', role: 'staff', password }, actor), { code: 'BUSINESS_FORBIDDEN' });
      await assert.rejects(users.list(session(actor)), { code: 'BUSINESS_FORBIDDEN' });
    }
    await assert.rejects(create('OWNERa@test.example'), { code: 'ENTITY_CONFLICT', status: 409 });
    for (const changes of [{ email: 'changed@test.example' }, { passwordHash: 'forged' }, { tokenVersion: 100 }, { name: '' }]) {
      await assert.rejects(command('user.update', { id: 'staff', version: '1', changes }), { status: 400 });
    }
    for (const bad of ['short', '中'.repeat(30)]) await assert.rejects(command('user.create', { email: 'x@test.example', name: '用户', role: 'staff', password: bad }), { status: 400 });
  });
  await t.test('login accepts existing hashes and legacy numeric JWT versions, while verification is server-bound', async () => {
    await reset();
    const login = await auth.login({ email: ' OWNERa@test.example ', password });
    publicOnly(login.user);
    const verified = await auth.authenticate(login.token);
    assert.equal(verified.actorId, 'ownerA'); assert.equal(verified.tokenVersion, '1'); publicOnly(verified.user);
    const options = { algorithm: 'HS256', audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` };
    const legacy = jwt.sign({ sub: 'ownerA', ver: 1 }, secret, options);
    assert.equal((await auth.authenticate(legacy)).actorId, 'ownerA');
    const forgedRole = jwt.sign({ sub: 'staff', role: 'owner', ver: 1 }, secret, options);
    assert.equal((await auth.authenticate(forgedRole)).user.role, 'staff');
    for (const token of ['not-a-token', jwt.sign({ sub: 'ownerA', ver: 1 }, secret, { ...options, expiresIn: -1 }),
      jwt.sign({ sub: 'ownerA', ver: 1 }, 'a-different-valid-secret', options),
      jwt.sign({ sub: 'ownerA', ver: 1 }, secret, { ...options, issuer: '3d-manage:other-server' }),
      jwt.sign({ sub: 'ownerA', ver: 1 }, secret, { ...options, algorithm: 'HS384' })]) assert.equal(await auth.authenticate(token), null);
    assert.equal((await pool.query("SELECT password_hash FROM erp.users WHERE id='ownerA'")).rows[0].password_hash, hash);
    assert.ok((await users.me(session('ownerA'))).lastLoginAt);
    for (const [email, wrong] of [['missing@test.example', password], ['ownera@test.example', 'wrong-password']]) await assert.rejects(auth.login({ email, password: wrong }), { code: 'AUTHENTICATION_FAILED', status: 401 });
  });
  await t.test('role/activation changes invalidate old sessions while name changes retain them', async () => {
    await reset();
    const login = await auth.login({ email: 'staff@test.example', password });
    let edited = (await command('user.update', { id: 'staff', version: '1', changes: { name: '可继续登录' } })).body;
    assert.ok(await auth.authenticate(login.token));
    edited = (await command('user.update', { id: 'staff', version: edited.version, changes: { role: 'viewer' } })).body;
    assert.equal(await auth.authenticate(login.token), null);
    const second = await auth.login({ email: 'staff@test.example', password });
    edited = (await command('user.update', { id: 'staff', version: edited.version, changes: { active: false } })).body;
    assert.equal(await auth.authenticate(second.token), null);
    await assert.rejects(auth.login({ email: 'staff@test.example', password }), { code: 'AUTHENTICATION_FAILED' });
    await command('user.update', { id: 'staff', version: edited.version, changes: { active: true } });
    assert.equal(await auth.authenticate(second.token), null);
  });
  await t.test('Owner reset is versioned and idempotent; password and hashes never enter audits or receipts', async () => {
    await reset();
    const login = await auth.login({ email: 'staff@test.example', password });
    const payload = { id: 'staff', version: '1', password: newPassword };
    const resetResult = await command('user.resetPassword', payload, 'ownerA', 'reset-once');
    assert.deepEqual(await command('user.resetPassword', payload, 'ownerA', 'reset-once'), resetResult);
    assert.equal(await auth.authenticate(login.token), null);
    assert.ok(await auth.login({ email: 'staff@test.example', password: newPassword }));
    await assert.rejects(auth.login({ email: 'staff@test.example', password }), { code: 'AUTHENTICATION_FAILED' });
    const saved = (await pool.query("SELECT password_hash,token_version FROM erp.users WHERE id='staff'")).rows[0];
    assert.equal(await bcrypt.compare(newPassword, saved.password_hash), true); assert.equal(saved.token_version, '2');
    const logs = JSON.stringify((await pool.query('SELECT diff::text FROM erp.audit_logs')).rows);
    const receipts = JSON.stringify((await pool.query('SELECT result::text FROM erp.command_receipts')).rows);
    assert.ok(!logs.includes(newPassword) && !receipts.includes(newPassword)); assert.ok(!logs.includes('$2b$') && !receipts.includes('$2b$'));
    const weakDigest = createHash('sha256').update(JSON.stringify({ operation: 'user.resetPassword', payload: { id: 'staff', password: newPassword, version: '1' } })).digest('hex');
    assert.notEqual((await pool.query("SELECT payload_hash FROM erp.command_receipts WHERE key='reset-once'")).rows[0].payload_hash, weakDigest);
    await assert.rejects(command('user.resetPassword', { id: 'ownerB', version: '1', password: newPassword }), { code: 'OWNER_MANAGED_SEPARATELY' });
  });
  await t.test('all roles can change only their own password and old tokens immediately stop working', async () => {
    await reset();
    for (const actor of ['ownerA', 'staff', 'viewer']) {
      const email = `${actor.toLowerCase()}@test.example`;
      const login = await auth.login({ email, password });
      const activeSession = await auth.authenticate(login.token);
      await assert.rejects(users.changeOwnPassword({ ...activeSession, key: `bad-${actor}`, payload: { version: '1', currentPassword: 'wrong', newPassword } }), { code: 'CURRENT_PASSWORD_INVALID' });
      await assert.rejects(users.changeOwnPassword({ ...activeSession, key: `target-${actor}`, payload: { id: 'ownerB', version: '1', currentPassword: password, newPassword } }), { status: 400 });
      await users.changeOwnPassword({ ...activeSession, key: `change-${actor}`, payload: { version: '1', currentPassword: password, newPassword } });
      assert.equal(await auth.authenticate(login.token), null);
      const nextLogin = await auth.login({ email, password: newPassword });
      const nextSession = await auth.authenticate(nextLogin.token);
      assert.deepEqual((await users.changeOwnPassword({ ...nextSession, key: `change-${actor}`, payload: { version: '1', currentPassword: password, newPassword } })).body, { success: true });
      assert.equal(nextSession.tokenVersion, '2');
    }
  });
  await t.test('two Owners cannot concurrently deactivate themselves and leave no active Owner', async () => {
    await reset();
    const results = await Promise.allSettled(['ownerA', 'ownerB'].map(actor => command('user.update', { id: actor, version: '1', changes: { active: false } }, actor)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'LAST_OWNER_PROTECTED');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.users WHERE role='owner' AND active")).rows[0].n, 1);
  });
  await t.test('the database rejects losing the last Owner and prevents repeatable-read write skew', async () => {
    await reset();
    const a = await pool.connect(); const b = await pool.connect();
    try {
      for (const client of [a, b]) { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); await client.query("SELECT count(*) FROM erp.users WHERE role='owner' AND active"); }
      await a.query("UPDATE erp.users SET active=false WHERE id='ownerA'"); await a.query('COMMIT');
      await assert.rejects(b.query("UPDATE erp.users SET active=false WHERE id='ownerB'"), { code: '40001' }); await b.query('ROLLBACK');
    } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); a.release(); b.release(); }
    await assert.rejects(pool.query("UPDATE erp.users SET role='staff' WHERE id='ownerB'"), { code: '23514', constraint: 'users_last_owner' });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.users WHERE role='owner' AND active")).rows[0].n, 1);
  });
  await t.test('a deferred Owner violation rolls back audits and receipts and is reported as a conflict', async () => {
    await reset(); await pool.query("UPDATE erp.users SET active=false WHERE id='ownerB'");
    const bypass = createBusinessCommands(pool, { 'probe.disable': { roles: ['owner'], lockUsers: true, async handle(tx, { actor, audit }) {
      await tx.query('UPDATE erp.users SET active=false WHERE id=$1', [actor.id]);
      await audit({ entity: 'users', entityId: actor.id, action: 'probe', diff: {} });
      return { status: 200, body: {} };
    } } });
    await assert.rejects(bypass({ ...session('ownerA'), operation: 'probe.disable', key: 'probe-disable', payload: {} }), { code: 'LAST_OWNER_PROTECTED', status: 409 });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.command_receipts')).rows[0].n, 0);
  });
  await t.test('concurrent version edits pick one winner; reset failures roll back hashes and sessions', async () => {
    await reset();
    const results = await Promise.allSettled(['A', 'B'].map(name => command('user.update', { id: 'staff', version: '1', changes: { name } })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    const user = await users.get(session('ownerA'), 'staff');
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT user_receipt_probe CHECK(key <> 'reset-failure')");
    await assert.rejects(command('user.resetPassword', { id: 'staff', version: user.version, password: newPassword }, 'ownerA', 'reset-failure'), { code: 'BUSINESS_DATA_INVALID' });
    const saved = (await pool.query("SELECT password_hash,token_version,version FROM erp.users WHERE id='staff'")).rows[0];
    assert.equal(saved.password_hash, hash); assert.equal(saved.token_version, '1'); assert.equal(saved.version, user.version);
    await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT user_audit_probe CHECK(action <> 'password.reset')");
    await assert.rejects(command('user.resetPassword', { id: 'staff', version: user.version, password: newPassword }), { code: 'BUSINESS_DATA_INVALID' });
    assert.equal((await pool.query("SELECT password_hash FROM erp.users WHERE id='staff'")).rows[0].password_hash, hash);
  });
  await t.test('unused accounts can be deleted with audit, while login history and self-delete protect identities', async () => {
    await reset();
    const user = (await create()).body;
    await command('user.delete', { id: user.id, version: user.version });
    await assert.rejects(users.get(session('ownerA'), user.id), { code: 'ENTITY_NOT_FOUND' });
    await auth.login({ email: 'staff@test.example', password });
    await assert.rejects(command('user.delete', { id: 'staff', version: '1' }), { code: 'ENTITY_REFERENCED' });
    await assert.rejects(command('user.delete', { id: 'ownerA', version: '1' }), { code: 'CURRENT_USER_PROTECTED' });
    await pool.query("INSERT INTO erp.users(id,email,name,role,password_hash,legacy_payload) VALUES('legacy-only','legacy@test.example','历史账号','staff',$1,'{\"id\":\"legacy-only\"}')", [hash]);
    await assert.rejects(command('user.delete', { id: 'legacy-only', version: '1' }), { code: 'ENTITY_REFERENCED' });
  });
  await t.test('uninitialized login and malformed/stale sessions do not mutate credentials', async () => {
    await reset(); await pool.query('DELETE FROM erp.installation');
    await assert.rejects(auth.login({ email: 'ownera@test.example', password }), { code: 'SYSTEM_NOT_INITIALIZED' });
    assert.equal(await auth.authenticate('not-a-token'), null);
    await assert.rejects(users.me({ actorId: 'ownerA', tokenVersion: '999' }), { code: 'AUTHENTICATION_REQUIRED' });
    assert.equal((await pool.query("SELECT password_hash FROM erp.users WHERE id='ownerA'")).rows[0].password_hash, hash);
  });
  await t.test('credential preparation holds no user write lock and revalidates the actor before mutation', async () => {
    await reset();
    let signal; let release;
    const started = new Promise(resolve => { signal = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let called = false;
    const execute = createBusinessCommands(pool, { 'probe.prepare': { roles: ['owner'], lockUsers: true,
      async prepare() { signal(); await gate; return {}; },
      async handle(tx, { actor, audit }) { called = true; await audit({ entity: 'users', entityId: actor.id, action: 'probe', diff: {} }); return { status: 200, body: {} }; },
    } });
    const pending = execute({ ...session('ownerA'), operation: 'probe.prepare', key: 'prepare-race', payload: {} }).then(value => ({ value }), error => ({ error }));
    await started;
    try { await pool.query("UPDATE erp.users SET active=false WHERE id='ownerA'"); }
    finally { release(); }
    assert.equal((await pending).error?.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(called, false);
  });
  await t.test('JWT and revocation counters retain values beyond JavaScript safe integers', async () => {
    await reset(); await pool.query("UPDATE erp.users SET token_version=9007199254740993 WHERE id='staff'");
    const login = await auth.login({ email: 'staff@test.example', password });
    assert.equal((await auth.authenticate(login.token)).tokenVersion, '9007199254740993');
    await command('user.resetPassword', { id: 'staff', version: '1', password: newPassword });
    assert.equal(await auth.authenticate(login.token), null);
    assert.equal((await pool.query("SELECT token_version FROM erp.users WHERE id='staff'")).rows[0].token_version, '9007199254740994');
  });
  await t.test('v4 upgrade preserves the old password, token counter, last login and unknown numeric JSON', async () => {
    await pool.query('DROP SCHEMA erp CASCADE');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-users-v4-'));
    t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
    for (const name of ['0001_foundation.sql', '0002_core.sql', '0003_order_editing.sql', '0004_inventory_posting_order.sql']) {
      await fs.copyFile(path.resolve(__dirname, '../../backend/business-db/migrations', name), path.join(directory, name));
    }
    await migrateBusinessDatabase(pool, { migrationsDirectory: directory });
    await pool.query(`INSERT INTO erp.users(id,email,name,role,password_hash,token_version,legacy_payload)
      VALUES('upgrade','upgrade@test.example','Owner','owner',$1,7,'{"lastLoginAt":"2026-09-29T00:00:00.000Z","extra":9007199254740993.01}')`, [hash]);
    await migrateBusinessDatabase(pool);
    const row = (await pool.query("SELECT password_hash,token_version,last_login_at,legacy_payload->>'extra' AS extra FROM erp.users WHERE id='upgrade'")).rows[0];
    assert.equal(row.password_hash, hash); assert.equal(row.token_version, '7');
    assert.equal(row.last_login_at.toISOString(), '2026-09-29T00:00:00.000Z'); assert.equal(row.extra, '9007199254740993.01');
  });
});
