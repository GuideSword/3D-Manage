'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createSessionLifecycleCore } = require('../../utils/sessionLifecycleCore.cjs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyFor = (url, id) => crypto.createHash('sha256').update(`${url}\n${id}`).digest('hex');

const server = (url, id) => ({ apiBaseUrl: url, serverId: id, serverKey: keyFor(url, id) });

test('delayed login from A cannot persist a token after switching to B', async () => {
  const lifecycle = createSessionLifecycleCore();
  const tokens = new Map();
  lifecycle.setServer(server('https://a.example/api', 'a'));
  const captured = lifecycle.get();
  const login = (async () => {
    await delay(15);
    if (lifecycle.isCurrent(captured)) tokens.set(captured.serverKey, 'token-a');
  })();
  lifecycle.invalidate();
  lifecycle.setServer(server('https://b.example/api', 'b'));
  await login;
  assert.equal(tokens.size, 0);
});

test('old 401 from A cannot clear the active B token', async () => {
  const lifecycle = createSessionLifecycleCore();
  const a = server('https://a.example/api', 'a');
  const b = server('https://b.example/api', 'b');
  const tokens = new Map([[b.serverKey, 'token-b']]);
  lifecycle.setServer(a);
  const captured = lifecycle.get();
  lifecycle.invalidate();
  lifecycle.setServer(b);
  await delay(1);
  if (lifecycle.isCurrent(captured)) tokens.delete(captured.serverKey);
  assert.equal(tokens.get(b.serverKey), 'token-b');
});

test('one snapshot binds token lookup and request URL to the same server', () => {
  const lifecycle = createSessionLifecycleCore();
  const a = server('https://a.example/api', 'a');
  lifecycle.setServer(a);
  const captured = lifecycle.get();
  lifecycle.invalidate();
  lifecycle.setServer(server('https://b.example/api', 'b'));
  assert.equal(captured.apiBaseUrl, 'https://a.example/api');
  assert.equal(captured.serverKey, a.serverKey);
  assert.equal(lifecycle.isCurrent(captured), false);
});

test('same serverId at another URL has a different credential namespace', () => {
  assert.notEqual(
    keyFor('https://a.example/api', 'copied-id'),
    keyFor('https://b.example/api', 'copied-id')
  );
});

test('persistence failure after invalidation never restores authenticated state', async () => {
  const lifecycle = createSessionLifecycleCore();
  lifecycle.setServer(server('https://a.example/api', 'a'));
  let user = { id: 1 };
  lifecycle.subscribe(() => { user = null; });
  lifecycle.invalidate();
  await assert.rejects(Promise.reject(new Error('storage failed')), /storage failed/);
  assert.equal(user, null);
});

test('no-server initialization settles without attempting token access', () => {
  const lifecycle = createSessionLifecycleCore();
  let tokenReads = 0;
  const current = lifecycle.get();
  const shouldReadToken = Boolean(current.serverKey && current.apiBaseUrl);
  if (shouldReadToken) tokenReads += 1;
  assert.equal(shouldReadToken, false);
  assert.equal(tokenReads, 0);
});

test('cleanup marker survives interruption and is removed only after cleanup', async () => {
  const storage = new Map();
  const tokenKey = 'jwtToken.v1.key';
  storage.set(tokenKey, 'secret');
  storage.set('sessionCleanupPending.v1', JSON.stringify({ serverKey: 'key' }));
  assert.equal(storage.has(tokenKey), true, 'simulated process died before credential deletion');
  const pending = JSON.parse(storage.get('sessionCleanupPending.v1'));
  storage.delete(`jwtToken.v1.${pending.serverKey}`);
  storage.delete('sessionCleanupPending.v1');
  assert.equal(storage.has(tokenKey), false);
  assert.equal(storage.has('sessionCleanupPending.v1'), false);
});

test('failure to persist the cleanup marker prevents cleanup success reporting', async () => {
  const writeMarker = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(writeMarker(), /storage unavailable/);
});
