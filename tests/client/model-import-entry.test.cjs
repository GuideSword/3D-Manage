const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function loadApi({ current = true, openURL = async () => {} } = {}) {
  const source = babel.transformSync(fs.readFileSync('utils/api.js', 'utf8'), { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const snapshot = { apiBaseUrl: 'https://erp.example/api', serverKey: 'key', sessionEpoch: 1, capabilities: {} };
  const api = {};
  vm.runInNewContext(source, { module: { exports: api }, exports: api, require(name) {
    if (name === 'react-native') return { Platform: { OS: 'web' }, Linking: { openURL } };
    if (name === 'expo-crypto') return { randomUUID: () => 'id' };
    if (name === './serverRuntime') return { getServerRuntime: () => snapshot, isCurrentRuntime: () => current, registerOperation: () => ({ controller: new AbortController(), release() {} }), StaleSessionError: class extends Error {} };
    if (name === './sessionStorage') return { getToken: async () => 'token', clearToken: async () => {}, setTokenForSnapshot: async () => true };
    if (name === './nativeDownload') return {};
    if (name === './userErrorCore.cjs') return { localizeTransportError: e => e };
    throw new Error(`unexpected ${name}`);
  }, fetch: async () => ({ ok: true, text: async () => JSON.stringify({ ticket: 'a+b' }) }), AbortController, URL, URLSearchParams, FormData, setTimeout, clearTimeout, console });
  return api;
}

test('authorizeModelImport requests a ticket and opens encoded helper URI', async () => {
  let opened;
  const api = loadApi({ openURL: async url => { opened = url; } });
  await api.authorizeModelImport();
  assert.equal(opened, 'manage3d-model://import?server=https%3A%2F%2Ferp.example&ticket=a%2Bb');
});

test('authorizeModelImport rejects a stale runtime before launching helper', async () => {
  let opened = false;
  const api = loadApi({ current: false, openURL: async () => { opened = true; } });
  await assert.rejects(api.authorizeModelImport());
  assert.equal(opened, false);
});
