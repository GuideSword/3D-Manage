'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createModelDownloadService } = require('../../backend/modules/modelDownloads/service');
function fixture() {
  let time = 1000;
  const users = Object.fromEntries(['owner', 'staff', 'viewer'].map(role => [role, { id: role, role, active: true, tokenVersion: '1' }]));
  const state = { policy: { enabled: false, passwordHash: null, version: '1' }, grants: {}, attempts: {}, audits: [] };
  const repo = { transaction: async fn => {
    const copy = structuredClone(state);
    const result = await fn({ actor: async id => users[id], policy: async () => copy.policy,
      savePolicy: async p => { copy.policy = p; },
      resource: async key => ['models/part.stl', 'models/other.stl', 'images/preview.png'].includes(key) ? { key, protected: key.startsWith('models/'), name: 'part.stl', size: 10, sha256: 'a'.repeat(64) } : null,
      grant: async hash => copy.grants[hash], insertGrant: async g => { copy.grants[g.hash] = g; }, consumeGrant: async hash => { copy.grants[hash].consumed = true; },
      attempts: async id => copy.attempts[id], saveAttempts: async (id, value) => { copy.attempts[id] = value; },
      prune: async () => {}, audit: async (actorId, action, diff) => copy.audits.push({ actorId, action, diff }),
    });
    Object.assign(state, copy); return result;
  } };
  return { service: createModelDownloadService(repo, { now: () => time }), state, users, tick: n => { time += n; } };
}
const owner = { actorId: 'owner', tokenVersion: '1' }, staff = { actorId: 'staff', tokenVersion: '1' };
const password = 'isolated-model-password-123';
const enable = f => f.service.configure(owner, { version: '1', enabled: true, password });
const authorize = (f, extra = {}, session = staff) => f.service.authorize(session, { key: 'models/part.stl', password, purpose: 'download', consent: true, ...extra });
const code = expected => error => error.code === expected;

test('only current owner can configure; anonymous cannot read; hashes and audits contain no secrets', async () => {
  const f = fixture();
  await assert.rejects(f.service.status(null), code('AUTHENTICATION_REQUIRED'));
  await assert.rejects(f.service.configure(staff, { version: '1', enabled: true, password }), code('BUSINESS_FORBIDDEN'));
  await enable(f);
  assert.equal((await f.service.status(staff)).enabled, true);
  assert.ok(f.state.policy.passwordHash.startsWith('$2'));
  assert.equal(JSON.stringify(f.state).includes(password), false);
  await assert.rejects(f.service.configure(owner, { version: '1', enabled: false }), code('VERSION_CONFLICT'));
});
test('all source paths require a file- and account-bound grant; preview still works', async () => {
  const f = fixture(); await enable(f);
  for (const key of ['models/part.stl', 'models/other.stl', 'old/source.bin']) await assert.rejects(f.service.check(staff, key), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
  assert.equal(await f.service.check(staff, 'images/preview.png'), true);
  const { token } = await authorize(f);
  assert.equal(JSON.stringify(f.state).includes(token), false);
  assert.equal(await f.service.check(staff, 'models/part.stl', token), true);
  assert.equal(await f.service.check(staff, 'models/part.stl', token), true); // Same transmission, multiple ranges.
  await assert.rejects(f.service.check(owner, 'models/part.stl', token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
  await assert.rejects(f.service.check(staff, 'models/other.stl', token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
});
test('members cannot rotate or disable policy; all roles including owner must verify the password', async () => {
  const f = fixture(); await enable(f);
  for (const role of ['staff', 'viewer']) {
    const session = { actorId: role, tokenVersion: '1' };
    for (const input of [{ version: '2', enabled: false }, { version: '2', enabled: true, password: 'unauthorized-replacement' }]) {
      await assert.rejects(f.service.configure(session, input), code('BUSINESS_FORBIDDEN'));
      assert.equal(f.state.policy.version, '2'); assert.equal(f.state.policy.enabled, true);
    }
    await assert.rejects(f.service.configure(session, { version: '2', enabled: true, role: 'owner', password }), code('DOWNLOAD_INPUT_INVALID'));
  }
  for (const role of ['owner', 'staff', 'viewer']) {
    const session = { actorId: role, tokenVersion: '1' };
    await assert.rejects(authorize(f, { password: 'wrong' }, session), code('MODEL_DOWNLOAD_PASSWORD_INVALID'));
    await assert.rejects(authorize(f, { password: undefined }, session), code('MODEL_DOWNLOAD_PASSWORD_INVALID'));
    const grant = await authorize(f, {}, session);
    assert.equal(await f.service.check(session, 'models/part.stl', grant.token), true);
    assert.deepEqual(Object.keys(await f.service.status(session)).sort(), ['enabled', 'version']);
  }
});

test('HTTP API rejects members changing policy and owner downloading without password', async t => {
  const express = require('../../backend/node_modules/express');
  const { createModelDownloadsRouter } = require('../../backend/modules/modelDownloads/http');
  const f = fixture(); await enable(f);
  const app = express();
  app.use(createModelDownloadsRouter({ service: f.service, authenticate: async role => ({ actorId: role, tokenVersion: '1' }), allowInsecureTest: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (role, endpoint, body, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { method, headers: { Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const role of ['staff', 'viewer']) {
    for (const body of [{ enabled: false, version: '2' }, { enabled: true, version: '2', password: 'member-tried-to-change-password' }]) {
      const response = await send(role, '/policy', body, 'PUT');
      assert.equal(response.status, 403); assert.equal((await response.json()).code, 'BUSINESS_FORBIDDEN');
    }
  }
  for (const role of ['owner', 'staff', 'viewer']) {
    const body = { key: 'models/part.stl', purpose: 'download', consent: true };
    assert.equal((await send(role, '/authorize', body)).status, 403);
    assert.equal((await send(role, '/authorize', { ...body, password })).status, 200);
  }
  const rotated = await send('owner', '/policy', { enabled: true, version: '2', password: 'new-owner-download-password' }, 'PUT');
  assert.equal(rotated.status, 200);
  assert.deepEqual(await rotated.json(), { enabled: true, version: '3' });
});
test('declining local transfer issues nothing; failures persist and throttle across requests', async () => {
  const f = fixture(); await enable(f);
  await assert.rejects(authorize(f, { consent: false }), code('DOWNLOAD_CONSENT_REQUIRED'));
  for (let n = 0; n < 5; n++) await assert.rejects(authorize(f, { password: 'wrong' }), code('MODEL_DOWNLOAD_PASSWORD_INVALID'));
  assert.equal(f.state.attempts.staff.count, 5);
  await assert.rejects(authorize(f), code('RATE_LIMITED'));
  f.tick(60001); await authorize(f);
  assert.equal(f.state.attempts.staff.count, 0);
});
test('expiry, policy rotation, account revocation and token changes invalidate grants', async () => {
  const f = fixture(); await enable(f);
  const first = await authorize(f); f.tick(300001);
  await assert.rejects(f.service.check(staff, 'models/part.stl', first.token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
  const second = await authorize(f);
  await f.service.configure(owner, { version: '2', enabled: true, password: 'replacement-model-password-456' });
  await assert.rejects(f.service.check(staff, 'models/part.stl', second.token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
  const third = await authorize(f, { password: 'replacement-model-password-456' });
  f.users.staff.active = false;
  await assert.rejects(f.service.check(staff, 'models/part.stl', third.token), code('AUTHENTICATION_REQUIRED'));
  f.users.staff.active = true; f.users.staff.tokenVersion = '2';
  await assert.rejects(f.service.check({ ...staff, tokenVersion: '2' }, 'models/part.stl', third.token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
});
test('handoff ticket redeems once; transfer token cannot serve as ordinary download grant', async () => {
  const f = fixture(); await enable(f);
  const ticket = await authorize(f, { purpose: 'handoff' });
  const transfer = await f.service.redeem(ticket.token);
  assert.equal(transfer.file.sha256, 'a'.repeat(64));
  await assert.rejects(f.service.redeem(ticket.token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
  assert.equal((await f.service.transfer(transfer.token)).key, 'models/part.stl');
  await assert.rejects(f.service.check(staff, 'models/part.stl', transfer.token), code('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED'));
  f.users.staff.active = false;
  await assert.rejects(f.service.transfer(transfer.token), code('AUTHENTICATION_REQUIRED'));
});

test('storage cutover cannot silently discard a configured model-download policy', async () => {
  const { parseSource } = require('../../backend/business-db/preflight/source');
  const { buildPreflightReport } = require('../../backend/business-db/preflight/report');
  const { importLegacySnapshot } = require('../../backend/business-db/import/legacy');
  for (const enabled of [true, false]) {
    const snapshot = { schemaVersion: 3, system: { serverId: '02d3a500-0000-4000-8000-000000000004', modelDownloads: { policy: { enabled, passwordHash: 'private-policy-hash-fixture' } } } };
    for (const collection of ['users', 'models', 'materials', 'orders', 'stockLots', 'inventoryTxns', 'auditLogs', 'objectUploads', 'commandReceipts']) snapshot[collection] = [];
    snapshot.users.push({ id: 'owner', email: 'owner@migration.example.test', role: 'owner', active: true, tokenVersion: 1, passwordHash: 'fixture-hash' });
    const source = parseSource(JSON.stringify(snapshot)), report = await buildPreflightReport(source);
    assert.ok(report.issues.some(issue => issue.code === 'DOWNLOAD_POLICY_MIGRATION_REQUIRED'));
    assert.deepEqual(report.issues.filter(issue => issue.severity === 'blocker').map(issue => issue.code), ['DOWNLOAD_POLICY_MIGRATION_REQUIRED']);
    assert.equal(JSON.stringify(report).includes('private-policy-hash-fixture'), false);
    let connected = false;
    await assert.rejects(importLegacySnapshot({ connect: async () => { connected = true; throw Error('Must not connect'); } }, { source, decisions: {} }), { code: 'ERP_IMPORT_SOURCE_BLOCKED' });
    assert.equal(connected, false);
  }
});
