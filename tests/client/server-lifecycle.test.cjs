'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const babel = require('@babel/core');
const { createSessionLifecycleCore } = require('../../utils/sessionLifecycleCore.cjs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyFor = (url, id) => crypto.createHash('sha256').update(`${url}\n${id}`).digest('hex');

const server = (url, id) => ({ apiBaseUrl: url, serverId: id, serverKey: keyFor(url, id) });

const evaluateEsModule = (relativePath, mocks) => {
  const filename = path.resolve(__dirname, '..', '..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const code = babel.transformSync(source, {
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
      throw new Error(`Unexpected import from ${relativePath}: ${id}`);
    },
    AbortController,
    FormData,
    URLSearchParams,
    Map,
    Set,
    Error,
    JSON,
    String,
    console,
  };
  vm.runInNewContext(code, context, { filename });
  return module.exports;
};

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

test('streamChat reads the token bound to its server snapshot', async () => {
  const snapshot = {
    apiBaseUrl: 'https://example.test/api',
    serverKey: 'a'.repeat(64),
    sessionEpoch: 4,
  };
  let released = false;
  let streamRequest = null;
  const runtime = {
    getServerRuntime: () => snapshot,
    isCurrentRuntime: (captured) => captured === snapshot,
    registerOperation: () => ({
      controller: new AbortController(),
      release: () => { released = true; },
    }),
    StaleSessionError: class StaleSessionError extends Error {},
  };
  const sessionStorage = evaluateEsModule('utils/sessionStorage.js', {
    'react-native': { Platform: { OS: 'web' } },
    'expo-secure-store': {},
    './storage': {
      __esModule: true,
      default: { getItem: async () => null, setItem: async () => {}, deleteItem: async () => {} },
    },
    './serverRuntime': runtime,
    './sessionFiles': {
      clearTrackedFiles: async () => {},
      trackPickedAsset: async () => {},
      trackSessionFile: async () => {},
    },
  });
  await sessionStorage.setToken(snapshot.serverKey, 'token-a');
  const agentApi = evaluateEsModule('utils/agentApi.js', {
    '../components/agent/sseClient': {
      streamSSE: async (url, options) => { streamRequest = { url, options }; },
    },
    './api': { apiRequest: async () => ({}) },
    './sessionStorage': sessionStorage,
    './serverRuntime': runtime,
  });

  await agentApi.streamChat({ message: '你好', images: [], onEvent: () => {} });

  assert.equal(streamRequest.url, 'https://example.test/api/agent/chat');
  assert.equal(streamRequest.options.headers.Authorization, 'Bearer token-a');
  assert.equal(released, true);
});

test('snapshot token lookup discards a token if the server changes during the read', async () => {
  const snapshot = {
    apiBaseUrl: 'https://example.test/api',
    serverKey: 'b'.repeat(64),
    sessionEpoch: 7,
  };
  let currentChecks = 0;
  const sessionStorage = evaluateEsModule('utils/sessionStorage.js', {
    'react-native': { Platform: { OS: 'web' } },
    'expo-secure-store': {},
    './storage': {
      __esModule: true,
      default: { getItem: async () => null, setItem: async () => {}, deleteItem: async () => {} },
    },
    './serverRuntime': {
      isCurrentRuntime: () => {
        currentChecks += 1;
        return currentChecks === 1;
      },
    },
    './sessionFiles': {
      clearTrackedFiles: async () => {},
      trackPickedAsset: async () => {},
      trackSessionFile: async () => {},
    },
  });
  await sessionStorage.setToken(snapshot.serverKey, 'token-b');

  const token = await sessionStorage.getTokenForSnapshot(snapshot);

  assert.equal(token, null);
  assert.equal(currentChecks, 2);
});
