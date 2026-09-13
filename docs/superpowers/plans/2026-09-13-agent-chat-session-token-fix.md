# AI Chat Session Token Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore AI assistant message sending by implementing the missing snapshot-scoped token reader and locking the module boundary down with a regression test.

**Architecture:** Keep the existing `agentApi -> sessionStorage -> serverRuntime` flow. Add the missing `getTokenForSnapshot` export beside the existing snapshot-aware token writer, checking the captured runtime both before and after the asynchronous credential read so a server switch cannot reuse an old token.

**Tech Stack:** Expo 54, React Native 0.81, JavaScript ES modules, Node.js built-in test runner, Babel module transform already installed through Expo.

---

### Task 1: Reproduce the missing module export in the client verification suite

**Files:**
- Modify: `tests/client/server-lifecycle.test.cjs`

- [x] **Step 1: Add an ES-module evaluation helper and chat integration regression test**

Append the following helper and test to `tests/client/server-lifecycle.test.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

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
```

- [x] **Step 2: Run the test and verify it fails on the reported symptom**

Run: `node --test tests/client/server-lifecycle.test.cjs`

Expected: FAIL in both new tests with `getTokenForSnapshot is not a function`.

### Task 2: Implement the snapshot-scoped token reader

**Files:**
- Modify: `utils/sessionStorage.js`
- Test: `tests/client/server-lifecycle.test.cjs`

- [x] **Step 1: Add the missing export next to `getToken`**

Add this implementation immediately after `getToken`:

```js
export const getTokenForSnapshot = async (captured) => {
  if (!isCurrentRuntime(captured)) return null;
  const token = await getToken(captured.serverKey);
  return isCurrentRuntime(captured) ? token : null;
};
```

- [x] **Step 2: Run the focused regression test**

Run: `node --test tests/client/server-lifecycle.test.cjs`

Expected: PASS, including `streamChat reads the token bound to its server snapshot`.

- [x] **Step 3: Run the full client verification command**

Run: `npm run verify:client`

Expected: exit code 0 with server address and lifecycle checks passing.

### Task 3: Re-run the original reproduction and finalize

**Files:**
- Modify: `docs/superpowers/plans/2026-09-13-agent-chat-session-token-fix.md`

- [x] **Step 1: Re-run the module-boundary reproduction**

Run: `node --test --test-name-pattern="streamChat reads the token" tests/client/server-lifecycle.test.cjs`

Expected: PASS; `streamChat` reaches the mocked SSE boundary with `Bearer token-a` instead of throwing before request registration.

- [x] **Step 2: Check for debugging residue and whitespace errors**

Run: `rg -n "\[DEBUG-" utils tests/client`

Expected: no matches.

Run: `git diff --check -- utils/sessionStorage.js tests/client/server-lifecycle.test.cjs docs/superpowers/plans/2026-09-13-agent-chat-session-token-fix.md`

Expected: no output and exit code 0.

- [x] **Step 3: Commit the fix without including unrelated working-tree changes**

```powershell
git add -- utils/sessionStorage.js tests/client/server-lifecycle.test.cjs docs/superpowers/plans/2026-09-13-agent-chat-session-token-fix.md
git commit -m "fix(client): restore AI chat token lookup" -- utils/sessionStorage.js tests/client/server-lifecycle.test.cjs docs/superpowers/plans/2026-09-13-agent-chat-session-token-fix.md
```
