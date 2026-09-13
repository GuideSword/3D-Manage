# Agent Multimodal and Service Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-image chat reliable on Expo 54, make API keys write-only, make Embedding fully independent and optional, automatically verify vision capability, and maintain usable per-user model embeddings.

**Architecture:** Keep React state free of Base64 by separating pure attachment rules from the Expo file reader. Move settings, image validation, vision probing, and model indexing out of the route/orchestrator into focused backend services. SQLite migrations make optional Embedding safe for existing installations and isolate vectors by user and embedding configuration.

**Tech Stack:** Expo 54, React Native 0.81, Express 5, Zod, better-sqlite3, Node.js test runner, existing OpenAI-compatible and MiniMax providers.

---

## File map

- Create `utils/agentImageCore.cjs`: platform-neutral image limits, selection normalization, MIME checks, and immutable list operations.
- Create `utils/agentImage.js`: Expo 54 `File` adapter that reads selected URIs only at send time.
- Modify `components/agent/ImageAttachment.js`: controlled multi-image picker and visible removal controls.
- Modify `screens/AgentChatScreen.js`: single attachment owner, image-only send, preparation state, success clearing, failure restore.
- Modify `utils/agentApi.js`: settings GET/test APIs and structured chat completion result.
- Create `backend/agent/imagePayload.js`: authoritative data URL decoding, signature checks, and multimodal part construction.
- Create `backend/agent/settingsService.js`: write-only merge, validation, encryption, and public projection.
- Create `backend/agent/visionProbe.js`: real image capability probe with stable classification.
- Create `backend/agent/fixtures/vision-probe.png`: small fixed `4827` capability-test image used only by the probe.
- Create `backend/agent/modelIndex.js`: source hashing, per-user backfill, incremental reindex, progress, and cleanup.
- Create `backend/db/migrations.js`: idempotent SQLite migrations for existing Agent databases.
- Modify `backend/db/schema.sql` and `backend/db/agent.js`: nullable Embedding settings, capability fields, isolated model vectors, index progress queries.
- Modify `backend/routes/agent.js`: validated chat input and settings endpoints.
- Modify `backend/routes/models.js`: publish model create/update/delete events after successful business mutations.
- Modify `backend/agent/orchestrator.js`, `backend/agent/tools/index.js`, `backend/agent/tools/models.js`, and `backend/agent/dbBridge.js`: omit semantic search without a usable index and query only the active vector space.
- Modify `screens/AgentSettingsScreen.js`: confirmed status-card interface with independent forms and no secret display.
- Create `tests/client/agent-image-core.test.cjs` and `tests/client/agent-chat-contract.test.cjs`.
- Create `tests/backend/agent-image-payload.test.cjs`, `tests/backend/agent-settings.test.cjs`, and `tests/backend/model-index.test.cjs`.
- Modify root and backend `package.json` scripts so the new tests are part of normal verification.

### Task 1: Establish the image failure loop and pure attachment rules

**Files:**
- Create: `tests/client/agent-image-core.test.cjs`
- Create: `utils/agentImageCore.cjs`
- Modify: `package.json`

- [ ] **Step 1: Capture the original Android failure before edits**

Run the existing app in Expo Go, choose one PNG, and record the exact result in the task notes:

```text
选择图片失败
Cannot read property 'Base64' of undefined
```

This is the original red-capable feedback loop. The final verification must repeat the same actions on Android.

- [ ] **Step 2: Write failing pure-rule tests**

Create tests that require `utils/agentImageCore.cjs` and assert these exact contracts:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  normalizePickedAssets,
  appendImages,
  removeImage,
} = require('../../utils/agentImageCore.cjs');

test('normalizes multiple picker assets without storing Base64', () => {
  const result = normalizePickedAssets({
    canceled: false,
    assets: [{ uri: 'file:///a.png', name: 'a.png', mimeType: 'image/png', size: 12 }],
  });
  assert.deepEqual(result, [{ id: 'file:///a.png:12', uri: 'file:///a.png', name: 'a.png', mimeType: 'image/png', size: 12 }]);
  assert.equal('dataUrl' in result[0], false);
});

test('enforces four images, four MiB each, and six MiB total', () => {
  assert.equal(MAX_IMAGE_COUNT, 4);
  assert.equal(MAX_IMAGE_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_TOTAL_IMAGE_BYTES, 6 * 1024 * 1024);
  assert.throws(() => appendImages([], [
    { id: 'a', size: 4 * 1024 * 1024 },
    { id: 'b', size: 3 * 1024 * 1024 },
  ]), { code: 'IMAGE_TOTAL_TOO_LARGE' });
});

test('removes an attachment without mutating the prior list', () => {
  const before = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(removeImage(before, 'a'), [{ id: 'b' }]);
  assert.equal(before.length, 2);
});
```

- [ ] **Step 3: Run the test and verify it fails at the missing module seam**

Run: `node --test tests/client/agent-image-core.test.cjs`

Expected: FAIL with `Cannot find module '../../utils/agentImageCore.cjs'`.

- [ ] **Step 4: Implement the pure rules**

Implement exported constants and functions. `normalizePickedAssets` must reject missing URI, infer MIME only from `.jpg`, `.jpeg`, `.png`, and `.webp`, emit errors with stable `.code`, and never add Base64. `appendImages` must deduplicate by `id`, then check per-file, count, and aggregate limits. `removeImage` must return a new array.

- [ ] **Step 5: Add the client verification script and run it**

Add to `package.json`:

```json
"verify:agent-client": "node --test tests/client/agent-image-core.test.cjs tests/client/agent-chat-contract.test.cjs"
```

Until Task 3 creates the second test, run:

`node --test tests/client/agent-image-core.test.cjs`

Expected: all current tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- utils/agentImageCore.cjs tests/client/agent-image-core.test.cjs package.json
git commit -m "test(client): define agent image attachment rules"
```

### Task 2: Replace the Expo legacy read path with an injectable adapter

**Files:**
- Create: `utils/agentImage.js`
- Modify: `tests/client/agent-image-core.test.cjs`
- Modify: `components/agent/ImageAttachment.js`

- [ ] **Step 1: Add a failing adapter contract test**

Expose a factory from `agentImageCore.cjs` so Node tests can inject a reader and assert send-time encoding without importing React Native:

```js
test('prepares a data URL through the injected Expo 54 reader', async () => {
  const prepared = await prepareImagesForSend(
    [{ id: 'a', uri: 'file:///a.png', name: 'a.png', mimeType: 'image/png', size: 3 }],
    async (uri) => {
      assert.equal(uri, 'file:///a.png');
      return 'AQID';
    }
  );
  assert.deepEqual(prepared, [{ name: 'a.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AQID' }]);
});
```

Also add a regression assertion that production source does not contain `FileSystem.EncodingType.Base64`.

- [ ] **Step 2: Run and confirm the regression is red**

Run: `node --test tests/client/agent-image-core.test.cjs`

Expected: FAIL because `prepareImagesForSend` is missing and the current component still contains `FileSystem.EncodingType.Base64`.

- [ ] **Step 3: Implement the Expo adapter**

`utils/agentImage.js` must use the modern runtime API:

```js
import { File } from 'expo-file-system';
import core from './agentImageCore.cjs';

export const prepareAgentImages = (images) => core.prepareImagesForSend(
  images,
  async (uri) => {
    const file = new File(uri);
    if (!file.exists) {
      const error = new Error('Selected image is no longer available');
      error.code = 'IMAGE_READ_FAILED';
      throw error;
    }
    return file.base64();
  }
);
```

Remove all `expo-file-system` access from `ImageAttachment.js`. The component should only invoke Document Picker with `multiple: true`, normalize results, and notify the parent.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/client/agent-image-core.test.cjs`

Expected: PASS, including the assertion that the old API string is absent.

- [ ] **Step 5: Commit**

```powershell
git add -- utils/agentImage.js utils/agentImageCore.cjs components/agent/ImageAttachment.js tests/client/agent-image-core.test.cjs
git commit -m "fix(client): read agent images with Expo 54 file API"
```

### Task 3: Make the composer controlled, multi-image, and failure-safe

**Files:**
- Modify: `components/agent/ImageAttachment.js`
- Modify: `screens/AgentChatScreen.js`
- Modify: `utils/agentApi.js`
- Create: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Write source-contract tests for state ownership and send eligibility**

The test reads the two source files and asserts the structural seam that is feasible without a React Native test renderer:

```js
test('chat screen owns attachments and permits image-only sends', () => {
  const source = fs.readFileSync('screens/AgentChatScreen.js', 'utf8');
  assert.match(source, /<ImageAttachment[\s\S]*images=\{images\}/);
  assert.match(source, /const canSend = Boolean\(input\.trim\(\) \|\| images\.length\)/);
  assert.match(source, /prepareAgentImages\(snapshot\.images\)/);
});

test('attachment component is controlled and has a visible remove action', () => {
  const source = fs.readFileSync('components/agent/ImageAttachment.js', 'utf8');
  assert.doesNotMatch(source, /useState\(\[\]\)/);
  assert.match(source, /accessibilityLabel=\{`删除图片/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/client/agent-chat-contract.test.cjs`

Expected: FAIL because `ImageAttachment` owns private image state and text is currently mandatory.

- [ ] **Step 3: Implement the confirmed composer behavior**

Change the component contract to:

```jsx
<ImageAttachment
  images={images}
  disabled={sending || preparingImages}
  onAdd={(picked) => setImages((current) => appendImages(current, picked))}
  onRemove={(id) => setImages((current) => removeImage(current, id))}
/>
```

In `send`, take `{ text, images }` as a snapshot, prepare images before adding optimistic bubbles, send an empty `message` when the user supplied no text, and keep the visible user bubble text empty for an image-only message. The backend alone adds the internal “请分析这些图片” fallback. Clear the composer only after a `done` event. On an `error` event or thrown request, restore the snapshot unless the user has already edited a newer draft. Keep sending disabled until completion.

Change `streamChat` to resolve `{ terminalEvent: 'done' | 'error', data }` instead of swallowing the distinction. `AgentChatScreen` uses that result as the authoritative clear/restore signal; the existing `onEvent` callback continues to render deltas and tool events.

- [ ] **Step 4: Run client tests**

Run: `npm run verify:agent-client`

Expected: all Agent client tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- components/agent/ImageAttachment.js screens/AgentChatScreen.js utils/agentApi.js tests/client/agent-chat-contract.test.cjs
git commit -m "feat(client): support reliable multi-image agent messages"
```

### Task 4: Validate image payloads before opening SSE

**Files:**
- Create: `backend/agent/imagePayload.js`
- Create: `tests/backend/agent-image-payload.test.cjs`
- Modify: `backend/routes/agent.js`
- Modify: `backend/agent/orchestrator.js`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing payload tests**

Test `parseAgentImages(images, visionStatus)` with a minimal valid PNG fixture and assert valid conversion to `{ type: 'image_url' }`. Add cases for five images, unsupported MIME, malformed Base64, mismatched PNG signature, one file above 4 MiB, total above 6 MiB, `untested`, and `text_only`. Assert exact error codes from the design.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/backend/agent-image-payload.test.cjs`

Expected: FAIL with missing `backend/agent/imagePayload.js`.

- [ ] **Step 3: Implement authoritative parsing**

Use these exports:

```js
const LIMITS = Object.freeze({ count: 4, each: 4 * 1024 * 1024, total: 6 * 1024 * 1024 });

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function parseAgentImages(images = [], visionStatus) {
  if (!Array.isArray(images)) fail('IMAGE_PAYLOAD_INVALID', 'images must be an array');
  if (images.length > LIMITS.count) fail('IMAGE_LIMIT_EXCEEDED', 'Too many images');
  if (images.length && visionStatus !== 'vision') {
    fail(
      visionStatus === 'untested' ? 'IMAGE_CAPABILITY_UNTESTED' : 'IMAGE_CAPABILITY_UNSUPPORTED',
      'The configured model is not verified for image input',
      422
    );
  }
  let total = 0;
  const decoded = images.map((image) => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image?.dataUrl || '');
    if (!match || match[2].length % 4 === 1) fail('IMAGE_TYPE_UNSUPPORTED', 'Invalid image data URL');
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const normalizedInput = match[2].replace(/=+$/, '');
    if (buffer.toString('base64').replace(/=+$/, '') !== normalizedInput) {
      fail('IMAGE_READ_FAILED', 'Invalid Base64 image data');
    }
    const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg) || (mimeType === 'image/webp' && !webp)) {
      fail('IMAGE_TYPE_UNSUPPORTED', 'Image signature does not match MIME');
    }
    if (buffer.length > LIMITS.each) fail('IMAGE_TOO_LARGE', 'Image exceeds per-file limit');
    total += buffer.length;
    return { buffer, dataUrl: image.dataUrl, name: image.name || 'image', mimeType, byteSize: buffer.length };
  });
  if (total > LIMITS.total) fail('IMAGE_TOTAL_TOO_LARGE', 'Images exceed aggregate limit');
  return {
    decoded,
    parts: decoded.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
  };
}

module.exports = { LIMITS, parseAgentImages };
```

Validate PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, and WebP `RIFF....WEBP`. Reject images unless status is `vision`.

- [ ] **Step 4: Move validation before SSE headers**

In `/agent/chat`, validate the request body and images before `res.setHeader`/`flushHeaders`. Accept `(trimmed message || images.length > 0)`, apply the hidden fallback prompt for image-only requests, and return JSON `{ code, error }` for pre-stream validation failures. Only then open SSE and call the orchestrator.

Pass transient image parts and persistent image metadata separately. `runConversation` may include data URLs in the outbound provider request, but `sqliteDb.addMessage` must receive only `{ type: 'image_placeholder', name, mime_type, byte_size }` parts. Add a test that serializes every stored message and asserts it contains no `data:image/` prefix.

When a provider rejects image content during the live LLM call, classify the error as `IMAGE_CAPABILITY_UNSUPPORTED`, update the current configuration from `vision` to `untested`, and emit the stable error code so the next image attempt re-runs capability detection.

- [ ] **Step 5: Add and run backend tests**

Add to `backend/package.json`:

```json
"test:agent": "node --test ../tests/backend/agent-*.test.cjs"
```

Run: `npm --prefix backend run test:agent`

Expected: image payload tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- backend/agent/imagePayload.js backend/routes/agent.js backend/agent/orchestrator.js backend/package.json tests/backend/agent-image-payload.test.cjs
git commit -m "feat(backend): validate agent image payloads"
```

### Task 5: Migrate settings and expose write-only persistence

**Files:**
- Create: `backend/db/migrations.js`
- Modify: `backend/db/schema.sql`
- Modify: `backend/db/agent.js`
- Create: `backend/agent/settingsService.js`
- Create: `tests/backend/agent-settings.test.cjs`

- [ ] **Step 1: Write migration and secrecy tests**

Create a temporary version-0 SQLite database using the current schema, insert encrypted LLM/Embedding settings, run `migrateAgentDb(db)`, and assert data survives while `embed_*` columns accept null. Test `toPublicSettings` and assert serialized output contains none of the plaintext, ciphertext, or ciphertext field names.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/backend/agent-settings.test.cjs`

Expected: FAIL because migrations and settings service do not exist.

- [ ] **Step 3: Implement idempotent migrations**

Call `migrateAgentDb(db)` from `getDb()` after the base schema is executed. Migration version 1 must transactionally rebuild `user_settings` with nullable Embedding columns and add:

```sql
llm_vision_status TEXT NOT NULL DEFAULT 'untested',
llm_vision_checked_at TEXT,
llm_config_revision INTEGER NOT NULL DEFAULT 1,
embed_enabled INTEGER NOT NULL DEFAULT 0,
embed_config_fingerprint TEXT
```

Copy existing rows with `embed_enabled = 1`, preserve encrypted values, swap tables, recreate indexes, and set `PRAGMA user_version = 1`. A second migration run must make no changes.

- [ ] **Step 4: Implement settings storage primitives**

Replace all-or-nothing `upsertUserSettings` with `saveUserSettings(userId, completeRow)`. Add `getPublicUserSettings(userId)` returning only allowed public fields and configured booleans. Keep raw-row access private to backend services; do not export decrypted or encrypted secrets from a route-facing function.

- [ ] **Step 5: Implement candidate merge rules**

`settingsService.buildCandidate(userId, body)` must normalize URLs, trim fields, decrypt an existing secret only when the request omits a replacement, require an LLM Key on first save, and enforce complete Embedding fields when `embedding.enabled` is true. `persistCandidate` encrypts replacement values, retains existing ciphertext for blank values, increments the LLM revision on LLM changes, and never returns the row.

- [ ] **Step 6: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: settings migration, merge, and secrecy tests PASS.

```powershell
git add -- backend/db/migrations.js backend/db/schema.sql backend/db/agent.js backend/agent/settingsService.js tests/backend/agent-settings.test.cjs
git commit -m "feat(agent): make AI credentials write-only and embedding optional"
```

### Task 6: Add candidate connection tests and automatic vision probing

**Files:**
- Create: `backend/agent/visionProbe.js`
- Create: `backend/agent/fixtures/vision-probe.png`
- Modify: `backend/agent/settingsService.js`
- Modify: `backend/routes/agent.js`
- Modify: `tests/backend/agent-settings.test.cjs`

- [ ] **Step 1: Add failing service tests with injected providers**

Cover: LLM reply success, LLM failure retaining the old row, correct visual answer producing `vision`, provider image rejection producing `text_only`, timeout producing `error`, Embedding failure retaining the old Embedding configuration, and GET projection never returning secrets.

- [ ] **Step 2: Run and verify red**

Run: `node --test tests/backend/agent-settings.test.cjs`

Expected: FAIL because probe classification and route endpoints are absent.

- [ ] **Step 3: Implement the probe**

`probeVision({ llm, model, signal })` sends a repository-owned tiny PNG containing the digits `4827` and asks for only the digits with a maximum output of 12 tokens. Return one of:

```js
{ status: 'vision', checkedAt }
{ status: 'text_only', checkedAt, reasonCode: 'IMAGE_INPUT_REJECTED' }
{ status: 'error', checkedAt, reasonCode: 'VISION_PROBE_TIMEOUT' }
```

Do not include the test image, provider response body, or request headers in logs.

- [ ] **Step 4: Implement route contracts**

Add `GET /keys`, convert connection testing to `POST /keys/test`, and update `PUT /keys` to test candidates before per-service persistence. Return `{ settings, tests: { llm, vision, embedding } }`. LLM failure returns 422 without writes. Vision `text_only` is a successful LLM save. Embedding failure leaves its old configuration unchanged and returns 422 for that service.

- [ ] **Step 5: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: all settings and vision tests PASS.

```powershell
git add -- backend/agent/visionProbe.js backend/agent/fixtures/vision-probe.png backend/agent/settingsService.js backend/routes/agent.js tests/backend/agent-settings.test.cjs
git commit -m "feat(agent): verify model vision capability server-side"
```

### Task 7: Redesign the settings screen around independent status cards

**Files:**
- Modify: `utils/agentApi.js`
- Modify: `screens/AgentSettingsScreen.js`
- Modify: `tests/client/agent-chat-contract.test.cjs`
- Modify: `tests/client/app-wide-ui.smoke.cjs`

- [ ] **Step 1: Add failing API/UI contract assertions**

Assert `agentApi` exports `getSettings`, POST-based `testSettings(candidate)`, and `saveSettings(candidate)`. In the settings source, assert independent `llm` and `embedding` draft state, the exact “API Key 已配置；输入新 Key 可替换” placeholder, an `Embedding · 可选` label, no text claiming keys are shared, and no code that assigns `embed_api_key` from `llmApiKey`.

- [ ] **Step 2: Run and verify failure**

Run: `npm run verify:agent-client`

Expected: FAIL on missing GET API and shared-key UI.

- [ ] **Step 3: Implement the B layout**

On mount, load public settings. Render collapsed status cards when configured and expand only the card being edited. LLM card shows connection and one of five vision badges. Embedding card explains that it enables natural-language model search and shows index progress. Key fields always initialize to `''`; `apiKeyConfigured` only changes placeholder/status, never input value.

Submit nested candidate data:

```js
{
  llm: { provider: 'openai_compat', baseUrl, model, ...(llmApiKey.trim() ? { apiKey: llmApiKey.trim() } : {}) },
  embedding: embedEnabled
    ? { enabled: true, baseUrl, model, groupId, ...(embedApiKey.trim() ? { apiKey: embedApiKey.trim() } : {}) }
    : { enabled: false },
}
```

Clear both local Key fields immediately after a successful save. Never add a reveal button for a stored Key; show/hide may apply only while typing an unsaved replacement.

- [ ] **Step 4: Update the visual smoke fixture**

Mock `GET /api/agent/keys` with configured booleans and statuses, navigate to Agent settings, and assert both cards, the optional label, and absence of any fixture secret. Capture updated light/dark screenshots only if the existing smoke workflow is already generating them.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify:agent-client`

Expected: PASS.

```powershell
git add -- utils/agentApi.js screens/AgentSettingsScreen.js tests/client/agent-chat-contract.test.cjs tests/client/app-wide-ui.smoke.cjs
git commit -m "feat(client): separate LLM and embedding configuration"
```

### Task 8: Build isolated, restartable model indexing

**Files:**
- Modify: `backend/db/schema.sql`
- Modify: `backend/db/migrations.js`
- Modify: `backend/db/agent.js`
- Create: `backend/agent/modelIndex.js`
- Create: `tests/backend/model-index.test.cjs`

- [ ] **Step 1: Write failing index lifecycle tests**

With a deterministic provider returning vectors derived from input length, test initial backfill of two models, no-op rerun with unchanged source hashes, regeneration after description change, deletion cleanup, one failed item producing `partial`, retry finishing `ready`, and separate rows for two users/configuration fingerprints.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/backend/model-index.test.cjs`

Expected: FAIL because `modelIndex.js` and isolated schema are missing.

- [ ] **Step 3: Add schema migration version 2**

Rebuild `model_embeddings` with these concrete columns and constraints:

```sql
CREATE TABLE model_embeddings_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  source_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  embedding TEXT,
  vector_dim INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','error')),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, asset_id, config_fingerprint)
);
```

Create `model_embedding_index_state` keyed by `user_id + config_fingerprint` with `status`, `total_count`, `ready_count`, `failed_count`, `last_error`, and timestamps. Migrate usable legacy rows only if a matching user/configuration can be identified; otherwise leave them out and let backfill rebuild safely. Set `user_version = 2`.

- [ ] **Step 4: Implement the index service**

Export `buildModelSource(model)`, `fingerprintEmbeddingConfig(config)`, `reconcileUserModelIndex({ userId, config, models, embed })`, `queueUserAssetIndex(...)`, and `deleteAssetIndexes(assetId)`. Use SHA-256 for source hash and fingerprint, never include API Key in either, process sequentially to limit API pressure, update progress after every asset, and coalesce duplicate in-process jobs by `userId:fingerprint`.

- [ ] **Step 5: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: index lifecycle tests PASS.

```powershell
git add -- backend/db/schema.sql backend/db/migrations.js backend/db/agent.js backend/agent/modelIndex.js tests/backend/model-index.test.cjs
git commit -m "feat(agent): maintain per-user model embedding indexes"
```

### Task 9: Connect model mutations and conditional semantic tools

**Files:**
- Modify: `backend/routes/models.js`
- Modify: `backend/agent/orchestrator.js`
- Modify: `backend/agent/tools/index.js`
- Modify: `backend/agent/tools/models.js`
- Modify: `backend/agent/dbBridge.js`
- Modify: `backend/agent/settingsService.js`
- Modify: `tests/backend/model-index.test.cjs`

- [ ] **Step 1: Add failing integration tests**

Test that model create/import/update queues only the acting user's enabled index, delete removes every user's rows for that asset, an unconfigured user receives no `search_models_semantic` tool, a ready user does, and a partial index returns rows plus `{ indexComplete: false }` metadata.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/backend/model-index.test.cjs`

Expected: FAIL because routes and tool registration are not connected.

- [ ] **Step 3: Publish mutation effects after durable writes**

After successful create/import/update responses are formed, call non-blocking `queueUserAssetIndex` for `req.user.id`; do not run provider calls inside `withData`. After delete succeeds, await local SQLite index cleanup. Catch background errors inside the index service so an indexing failure never changes the business API response.

- [ ] **Step 4: Make semantic tools capability-dependent**

Replace the fixed tool list with `getToolsForContext({ embeddingReady })`. Build `ctx.embed` only when enabled settings decrypt successfully. Change `semanticSearchModels` to require `userId` and the active fingerprint, reject vector dimension mismatches, and return index completeness metadata. If no ready rows exist, omit the semantic tool and retain keyword search.

- [ ] **Step 5: Start and resume backfill at safe entry points**

After a successful Embedding save, queue full reconciliation. On `GET /keys`, resume an interrupted/partial current-user job. Before a semantic Agent turn, queue stale reconciliation without blocking the current keyword-capable turn.

- [ ] **Step 6: Verify and commit**

Run: `npm --prefix backend run test:agent`

Expected: all Agent backend tests PASS.

```powershell
git add -- backend/routes/models.js backend/agent/orchestrator.js backend/agent/tools/index.js backend/agent/tools/models.js backend/agent/dbBridge.js backend/agent/settingsService.js tests/backend/model-index.test.cjs
git commit -m "feat(agent): enable semantic search only for usable indexes"
```

### Task 10: Full verification and Android regression closure

**Files:**
- Modify: `README.md`
- Modify: `docs/AGENT_DESIGN.md`

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm run verify:agent-client
npm run verify:client
npm --prefix backend run test:agent
npm run verify:backend
npm --prefix backend run agent:verify
npx expo export --platform web --output-dir .tmp/agent-multimodal-web
```

Expected: every command exits 0; export completes without missing-module or syntax errors.

- [ ] **Step 2: Repeat the original Android feedback loop**

In Expo Go on Android:

1. Save an LLM-only configuration and verify ordinary text chat works.
2. Tap the image button with an untested configuration and verify automatic detection runs.
3. Select two images, delete one, add another, and send without text.
4. Confirm no `Base64` error, both images reach the model, and attachments clear after `done`.
5. Cause a network failure and confirm text/images remain available for retry.
6. Send a second message and confirm old images are not resent.

Expected: all six checks pass.

- [ ] **Step 3: Verify secrets and optional Embedding manually**

Inspect `GET /api/agent/keys`, logs, and UI after saving. Confirm no key value, suffix, ciphertext, or Authorization header appears. Disable Embedding and verify chat/keyword tools work; enable it with independent credentials and verify backfill reaches `ready` and a fuzzy model query returns a semantic result.

- [ ] **Step 4: Update documentation only where behavior changed**

Document LLM-only operation, independent optional Embedding, write-only keys, automatic vision status, image limits, and the MiniMax-specific Group ID requirement. Remove statements that keys are shared.

- [ ] **Step 5: Final cleanup and commit**

Search for temporary instrumentation and obsolete claims:

```powershell
rg -n "\[DEBUG-|共用.*API Key|EncodingType\.Base64" . --glob '!node_modules/**' --glob '!.superpowers/**'
git diff --check
```

Expected: no debug markers, no old shared-key text, no production legacy API access, and no whitespace errors.

```powershell
git add -- README.md docs/AGENT_DESIGN.md
git commit -m "docs: document multimodal and optional embedding setup"
```
