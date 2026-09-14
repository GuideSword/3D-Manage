'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const babel = require('@babel/core');

const evaluateEsModule = (relativePath, mocks, globals = {}) => {
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
    Blob,
    Map,
    Promise,
    Set,
    URL,
    console,
    ...globals,
  };
  vm.runInNewContext(code, context, { filename });
  return module.exports;
};

const createNativeHarness = ({ cacheExists = false, onDownload } = {}) => {
  const snapshot = {
    apiBaseUrl: 'http://server.test/api',
    serverKey: 'a'.repeat(64),
    sessionEpoch: 3,
  };
  let current = true;
  const files = new Map();
  const tracked = [];
  const downloads = [];
  const deleted = [];
  const digests = [];
  const finalUri = 'file:///cache/3d-manage-image-fixed-digest.png';
  if (cacheExists) files.set(finalUri, { exists: true, size: 64 });

  const fileSystem = {
    cacheDirectory: 'file:///cache/',
    getInfoAsync: async (uri) => files.get(uri) || { exists: false },
    downloadAsync: async (uri, destination, options) => {
      downloads.push({ uri, destination, options });
      if (onDownload) await onDownload({ setCurrent: (value) => { current = value; } });
      files.set(destination, { exists: true, size: 32 });
      return { uri: destination, status: 200 };
    },
    moveAsync: async ({ from, to }) => {
      files.delete(from);
      files.set(to, { exists: true, size: 32 });
    },
    deleteAsync: async (uri) => {
      deleted.push(uri);
      files.delete(uri);
    },
  };

  const loader = evaluateEsModule('utils/protectedImage.js', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA256' },
      digestStringAsync: async (_algorithm, value) => {
        digests.push(value);
        return 'fixed-digest';
      },
    },
    'expo-file-system/legacy': fileSystem,
    './api': {
      buildProtectedFileSource: (fileUrl, token) => ({
        uri: `http://server.test${fileUrl}`,
        headers: { Authorization: `Bearer ${token}` },
      }),
    },
    './sessionFiles': {
      trackSessionFile: async (serverKey, uri) => tracked.push({ serverKey, uri }),
    },
    './serverRuntime': {
      getServerRuntime: () => snapshot,
      isCurrentRuntime: (captured) => captured === snapshot && current,
      StaleSessionError: class StaleSessionError extends Error {
        constructor() {
          super('stale');
          this.staleSession = true;
        }
      },
    },
  });

  return {
    deleted,
    digests,
    downloads,
    fileSystem,
    finalUri,
    loader,
    snapshot,
    tracked,
  };
};

test('native protected image download sends bearer auth and returns a local cache source', async () => {
  const harness = createNativeHarness();

  const resource = await harness.loader.loadProtectedImage('/api/files/models/1/cover.png', 'jwt');

  assert.equal(harness.downloads.length, 1);
  assert.equal(harness.downloads[0].options.headers.Authorization, 'Bearer jwt');
  assert.match(harness.digests[0], /\n3\n/);
  assert.equal(resource.source.uri, harness.finalUri);
  assert.equal(
    harness.tracked.some(({ serverKey, uri }) => (
      serverKey === harness.snapshot.serverKey && uri === harness.finalUri
    )),
    true
  );
});

test('native protected image loader reuses a non-empty cache file', async () => {
  const harness = createNativeHarness({ cacheExists: true });

  const resource = await harness.loader.loadProtectedImage('/api/files/models/1/cover.png', 'jwt');

  assert.equal(resource.source.uri, harness.finalUri);
  assert.equal(harness.downloads.length, 0);
});

test('native protected image loader deduplicates concurrent downloads', async () => {
  let releaseDownload;
  const gate = new Promise((resolve) => { releaseDownload = resolve; });
  const harness = createNativeHarness({ onDownload: () => gate });

  const first = harness.loader.loadProtectedImage('/api/files/models/1/cover.png', 'jwt');
  const second = harness.loader.loadProtectedImage('/api/files/models/1/cover.png', 'jwt');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.downloads.length, 1);

  releaseDownload();
  const [firstResource, secondResource] = await Promise.all([first, second]);
  assert.equal(firstResource.source.uri, harness.finalUri);
  assert.equal(secondResource.source.uri, harness.finalUri);
});

test('native protected image loader deletes output when the server session changes', async () => {
  const harness = createNativeHarness({
    onDownload: ({ setCurrent }) => setCurrent(false),
  });

  await assert.rejects(
    harness.loader.loadProtectedImage('/api/files/models/1/cover.png', 'jwt'),
    (error) => error.staleSession === true
  );
  assert.equal(harness.deleted.some((uri) => uri.includes('3d-manage-image-')), true);
});

test('web protected image loader fetches with auth and revokes its object URL', async () => {
  const snapshot = {
    apiBaseUrl: 'https://server.test/api',
    serverKey: 'b'.repeat(64),
    sessionEpoch: 2,
  };
  const requests = [];
  const revoked = [];
  const loader = evaluateEsModule('utils/protectedImage.js', {
    'react-native': { Platform: { OS: 'web' } },
    'expo-crypto': {},
    'expo-file-system/legacy': {},
    './api': {
      buildProtectedFileSource: () => ({
        uri: 'https://server.test/api/files/cover.png',
        headers: { Authorization: 'Bearer jwt' },
      }),
    },
    './sessionFiles': { trackSessionFile: async () => {} },
    './serverRuntime': {
      getServerRuntime: () => snapshot,
      isCurrentRuntime: (captured) => captured === snapshot,
      StaleSessionError: class StaleSessionError extends Error {},
    },
  }, {
    fetch: async (uri, options) => {
      requests.push({ uri, options });
      return { ok: true, status: 200, blob: async () => new Blob(['image']) };
    },
    URL: {
      createObjectURL: () => 'blob:protected-image',
      revokeObjectURL: (uri) => revoked.push(uri),
    },
  });

  const resource = await loader.loadProtectedImage('/api/files/cover.png', 'jwt');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer jwt');
  assert.equal(resource.source.uri, 'blob:protected-image');
  await resource.dispose();
  await resource.dispose();
  assert.deepEqual(revoked, ['blob:protected-image']);
});

test('concurrent session-file tracking preserves every cache path for cleanup', async () => {
  const serverKey = 'c'.repeat(64);
  const stored = new Map();
  const deleted = [];
  const storage = {
    getItem: async (key) => stored.get(key) || null,
    setItem: async (key, value) => { stored.set(key, value); },
    deleteItem: async (key) => { stored.delete(key); },
  };
  const sessionFiles = evaluateEsModule('utils/sessionFiles.js', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-file-system/legacy': {
      cacheDirectory: 'file:///cache/',
      deleteAsync: async (uri) => { deleted.push(uri); },
    },
    './storage': storage,
    './serverRuntime': { getServerRuntime: () => ({ serverKey }) },
  });
  const first = 'file:///cache/3d-manage-image-first.png';
  const second = 'file:///cache/3d-manage-image-second.png';

  await Promise.all([
    sessionFiles.trackSessionFile(serverKey, first),
    sessionFiles.trackSessionFile(serverKey, second),
  ]);
  await sessionFiles.clearTrackedFiles(serverKey);

  assert.deepEqual(new Set(deleted), new Set([first, second]));
});

test('model screens render protected files through the shared component', () => {
  const modelsScreen = fs.readFileSync(path.resolve('screens/ModelsScreen.js'), 'utf8');
  const detailScreen = fs.readFileSync(path.resolve('screens/ModelDetailScreen.js'), 'utf8');
  const componentIndex = fs.readFileSync(path.resolve('components/index.js'), 'utf8');

  assert.match(componentIndex, /export \{ default as ProtectedImage \} from '\.\/ProtectedImage';/);
  assert.match(modelsScreen, /<ProtectedImage[\s\S]*fileUrl=\{preferredImage\?\.fileUrl\}[\s\S]*token=\{token\}/);
  assert.match(detailScreen, /<ProtectedImage[\s\S]*fileUrl=\{image\.fileUrl\}[\s\S]*token=\{authToken\}/);
  assert.doesNotMatch(modelsScreen, /DEBUG-model-image/);
  assert.doesNotMatch(detailScreen, /DEBUG-model-image/);
});
