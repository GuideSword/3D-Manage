# model-import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows `model-import` workflow that scans a selected folder, imports supported 3D files with resumable concurrent transfers, and safely cleans incomplete work after cancellation or interruption.

**Architecture:** Extend the existing `tools/model-handoff` Windows helper with a separate import dispatcher, PowerShell task engine, atomic local manifest, and WinForms workbench. Add a backend import contract and storage adapters for both the legacy file store and the relational runtime; the browser/RN app only requests a short-lived import ticket and opens the helper through `manage3d-model://import`.

**Tech Stack:** PowerShell 7/WinForms and `System.Net.Http` for Windows, Express/Node.js with existing `node:test` for the legacy API, PostgreSQL migrations and services for relational mode, React Native/Expo for the model-library entry point.

---

### Task 1: Define the shared import contract and storage metadata

**Files:**
- Create: `backend/modules/modelImport/contract.js`
- Modify: `backend/utils/store.js:8-43`
- Create: `backend/business-db/migrations/0009_model_import.sql`
- Test: `tests/backend/model-import-contract.test.cjs`

- [ ] **Step 1: Write failing contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeItem, isSupportedExtension, nextState } = require('../../backend/modules/modelImport/contract');

test('normalizes supported metadata and rejects traversal paths', () => {
  assert.equal(isSupportedExtension('part.STL'), true);
  assert.equal(normalizeItem({ itemId: 'i-1', relativePath: 'a\\part.stl', originalName: 'part.stl', size: 12, sha256: 'a'.repeat(64) }).relativePath, 'a/part.stl');
  assert.throws(() => normalizeItem({ itemId: 'i-1', relativePath: '../part.stl', originalName: 'part.stl', size: 12, sha256: 'a'.repeat(64) }), /路径/);
});

test('allows only legal item transitions', () => {
  assert.equal(nextState('uploading', 'verified'), 'completed');
  assert.throws(() => nextState('completed', 'uploading'), /状态/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/backend/model-import-contract.test.cjs`

Expected: FAIL because `backend/modules/modelImport/contract.js` does not exist.

- [ ] **Step 3: Implement the contract**

Export `MODEL_EXTENSIONS` (`.stl`, `.obj`, `.3mf`, `.step`, `.stp`), `ZIP_EXTENSION`, job/item states, `normalizeItem`, `normalizeOptions`, `isSupportedExtension`, and `nextState`. Normalize Windows separators to `/`, reject absolute paths and any `..` segment, require a 64-character lowercase SHA-256, and reject sizes outside the configured upload limit.

Add `modelImportJobs` and `modelImportItems` to `COLLECTION_KEYS` in `backend/utils/store.js` and initialize both arrays in `createFreshData()`.

Add `0009_model_import.sql` with these relational tables and indexes:

```sql
CREATE TABLE erp.model_import_jobs (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  client_job_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','running','cancelling','cancelled','completed','completed_with_errors')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, client_job_id)
);
CREATE TABLE erp.model_import_items (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES erp.model_import_jobs(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  relative_path text NOT NULL,
  original_name text NOT NULL,
  extension text NOT NULL,
  byte_size bigint NOT NULL,
  sha256 text NOT NULL,
  state text NOT NULL CHECK (state IN ('discovered','queued','preparing','uploading','verifying','completed','duplicate','failed','cancelled','cleaned')),
  model_id text,
  description_facts text NOT NULL DEFAULT '',
  description_ai jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, id),
  UNIQUE(actor_id, job_id, sha256)
);
CREATE INDEX model_import_items_job_state ON erp.model_import_items(job_id, state);
CREATE INDEX model_import_items_actor_sha ON erp.model_import_items(actor_id, sha256);
```

- [ ] **Step 4: Run the focused test and migration validator**

Run: `node --test tests/backend/model-import-contract.test.cjs`

Expected: PASS. Run: `node --test tests/backend/erp-core-schema.test.cjs` after the migration is present; expected PASS with migration history remaining contiguous.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/modelImport/contract.js backend/utils/store.js backend/business-db/migrations/0009_model_import.sql tests/backend/model-import-contract.test.cjs
git commit -m "feat: add model import contract and storage schema"
```

### Task 2: Implement legacy-store import service and HTTP routes

**Files:**
- Create: `backend/modules/modelImport/legacyService.js`
- Create: `backend/routes/modelImport.js`
- Modify: `backend/application/legacyRuntime.js`
- Modify: `backend/modules/modelDownloads/service.js`
- Modify: `backend/modules/modelDownloads/http.js`
- Test: `tests/backend/model-import-http.test.cjs`

- [ ] **Step 1: Add route contract tests**

Cover these requests with the project’s existing Express test harness: `POST /api/model-import/handoff/authorize`, `POST /api/model-import/jobs`, `POST /api/model-import/jobs/:jobId/items/prepare`, multipart `POST /file`, `GET /jobs/:jobId`, `POST /cleanup`, and `DELETE /jobs/:jobId`. Assert owner/staff access, duplicate SHA-256 response, hash mismatch response, completed-item cleanup protection, and idempotent retry.

- [ ] **Step 2: Run the focused route test to verify it fails**

Run: `node --test tests/backend/model-import-http.test.cjs`

Expected: FAIL with 404 responses because the route is not mounted.

- [ ] **Step 3: Implement legacy service operations**

In `legacyService.js`, implement `createJob`, `prepareItem`, `completeFile`, `getJob`, `cleanupJob`, and `cancelJob` using `withData`. Reuse `saveFile`, `deleteFile`, `createModelPreview`, `appendAudit`, `nextId`, and the existing model shape. Store the import marker under `model.import` and keep `descriptionFacts`/`descriptionAi` in the model record. `prepareItem` must search every `model.files[*].sha256` for the actor-visible duplicate before creating a pending model. `completeFile` must compare multer buffer length and SHA-256 with the item metadata before appending the stored file and clearing the pending marker.

- [ ] **Step 4: Add the route and ticket redemption**

Mount `router.use('/model-import', require('../routes/modelImport'))` in `legacyRuntime.js`. Add a short-lived, purpose-scoped import ticket to the existing model-download service so `POST /model-import/handoff/authorize` returns a one-use token containing actor ID, server ID, purpose `model-import`, and a 5-minute expiry. The import routes accept that token or the normal authenticated bearer token, never log it, and reject a token issued for model download.

The multipart route must use a dedicated `multer.memoryStorage()` instance with the existing `MAX_UPLOAD_BYTES` limit and call `limitUploadConcurrency`. Return stable codes: `MODEL_IMPORT_DUPLICATE`, `MODEL_IMPORT_HASH_MISMATCH`, `MODEL_IMPORT_ITEM_NOT_FOUND`, `MODEL_IMPORT_JOB_NOT_FOUND`, and `MODEL_IMPORT_COMPLETED_CLEANUP_FORBIDDEN`.

- [ ] **Step 5: Run focused tests and the existing API verification**

Run: `node --test tests/backend/model-import-http.test.cjs backend/scripts/verify-api.js`

Expected: all model-import assertions pass and existing model upload verification remains green.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/modelImport/legacyService.js backend/routes/modelImport.js backend/application/legacyRuntime.js backend/modules/modelDownloads/service.js backend/modules/modelDownloads/http.js tests/backend/model-import-http.test.cjs
git commit -m "feat: add legacy model import API"
```

### Task 3: Add relational-runtime support

**Files:**
- Create: `backend/modules/modelImport/relationalService.js`
- Create: `backend/modules/adapters/modelImportHttp.js`
- Modify: `backend/modules/adapters/http.js`
- Modify: `backend/application/relationalRuntime.js`
- Test: `tests/backend/model-import-relational.test.cjs`

- [ ] **Step 1: Write relational service tests**

Use the existing isolated PostgreSQL test setup to assert job/item creation, duplicate lookup by actor and SHA-256, file completion in one transaction, cleanup of pending rows, and refusal to delete completed rows.

- [ ] **Step 2: Implement the relational service**

Use `withAuthenticatedRead` for reads and the existing command transaction/idempotency helpers for writes. The service must insert `erp.models` with `source='imported'`, insert the pending `erp.model_import_items` row, write the uploaded file through `modules/models/files.js`, update `erp.model_files.metadata` with the source path and SHA-256, and mark the item completed only after the file hash and size match.

- [ ] **Step 3: Mount the relational endpoints**

Add `createModelImportRouter({ pool, uploadDirectory, authentication })` in `modelImportHttp.js`. Mount it before the generic relational router in `relationalRuntime.js`, and add `/model-import` to the capability response in `modules/adapters/http.js`. Require `Idempotency-Key` and `X-Business-Rules-Version: 2` on all relational writes, matching the existing router contract.

- [ ] **Step 4: Run relational tests**

Run: `node --test tests/backend/model-import-relational.test.cjs`

Expected: PASS with no skipped tests. Then run `pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite core` to verify migrations and schema checks.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/modelImport/relationalService.js backend/modules/adapters/modelImportHttp.js backend/modules/adapters/http.js backend/application/relationalRuntime.js tests/backend/model-import-relational.test.cjs
git commit -m "feat: support model import in relational runtime"
```

### Task 4: Build the PowerShell scanner, ZIP safety, and manifest engine

**Files:**
- Create: `tools/model-handoff/Import.Core.psm1`
- Create: `tools/model-handoff/Import.Ui.psm1`
- Create: `tests/ops/model-import-core.verify.ps1`
- Modify: `tests/ops/model-handoff.verify.ps1`

- [ ] **Step 1: Define scanner tests**

Create a temporary fixture tree containing `part.stl`, `nested\gear.obj`, a duplicate copy, an unsupported `.txt`, a ZIP containing `inside.3mf`, and a ZIP entry named `..\escape.stl`. Assert that recursive scanning returns only selected extensions, duplicate rows contain the complete source path and SHA-256, safe ZIP entries are extracted, and traversal entries are rejected.

- [ ] **Step 2: Implement pure scanner functions**

Export `Get-ModelImportFiles`, `Expand-SafeModelArchive`, `Get-ModelImportFacts`, and `New-ModelImportItem`. Normalize all relative paths to `/`, reject reparse points and absolute ZIP entries, cap archive entries at 10,000 and uncompressed bytes at the configured maximum, and calculate SHA-256 using `Get-FileHash`.

- [ ] **Step 3: Implement atomic manifest and state transitions**

Export `New-ImportManifest`, `Save-ImportManifest`, `Read-ImportManifest`, `Set-ImportJobState`, and `Set-ImportItemState`. Write JSON to `manifest.json.tmp`, flush and replace `manifest.json`, and keep a backup copy when replacing. Reject transitions out of `completed`, `duplicate`, `cancelled`, or `cleaned`.

- [ ] **Step 4: Implement the concurrent task engine**

Export `Start-ModelImportJob`, `Stop-ModelImportJob`, `Resume-ModelImportJob`, and `Repair-ModelImportJob`. Use a bounded `System.Collections.Concurrent.ConcurrentQueue` and 1–4 worker runspaces. Each worker calls prepare, streams multipart upload through `System.Net.Http.HttpClient`, updates the manifest after every state change, retries only transient transport/503 failures with exponential backoff, and reports item failures without stopping other workers.

- [ ] **Step 5: Run PowerShell core verification**

Run: `pwsh -NoProfile -File tests/ops/model-import-core.verify.ps1`

Expected: PASS for scanner, ZIP safety, manifest atomicity, state transitions, cancellation and simulated restart recovery.

- [ ] **Step 6: Commit**

```bash
git add tools/model-handoff/Import.Core.psm1 tools/model-handoff/Import.Ui.psm1 tests/ops/model-import-core.verify.ps1 tests/ops/model-handoff.verify.ps1
git commit -m "feat: add model import scanner and resumable engine"
```

### Task 5: Add the Windows workbench and protocol dispatcher

**Files:**
- Create: `tools/model-handoff/Import-Models.ps1`
- Create: `tools/model-handoff/Dispatch-ModelHandoff.ps1`
- Modify: `tools/model-handoff/Install.ps1`
- Modify: `tools/model-handoff/Handoff.Core.psm1`
- Modify: `tools/model-handoff/README.md`

- [ ] **Step 1: Implement protocol dispatch**

Move URI routing into `Dispatch-ModelHandoff.ps1`: `manage3d-model://open` invokes the existing `Open-Model.ps1`; `manage3d-model://import` validates the same server binding and invokes `Import-Models.ps1`. Reject unknown hosts, duplicate query keys, non-HTTPS servers and arguments beyond the single URI.

- [ ] **Step 2: Implement the four-step WinForms workbench**

Build the confirmed screen flow: folder picker, multi-select format list, scan preview with complete paths, and transfer workbench with stats, per-item status, progress, retry and cancel confirmation. Add controls for AI enhancement, concurrency 1–4, failure-continue and recovery choice. Keep UI callbacks thin; all work runs through `Import.Core.psm1`.

- [ ] **Step 3: Wire authorization and independent launch**

When launched with a ticket, redeem it and store only the short-lived import token in memory. When launched without a ticket, load the bound server config and ask the user to confirm the server before creating a new authenticated session. Never accept an arbitrary server from a URI.

- [ ] **Step 4: Update installation and release packaging**

Change `Install.ps1` to copy `Dispatch-ModelHandoff.ps1`, `Import-Models.ps1`, `Import.Core.psm1`, and `Import.Ui.psm1`; register the dispatcher as the `manage3d-model` command without changing `.stl`/`.obj`/`.3mf` file associations. Update `README.md`, `release-manifest.json`, and `package-release.ps1` with the import feature and version bump.

- [ ] **Step 5: Run Windows helper verification**

Run: `pwsh -NoProfile -File tests/ops/model-handoff.verify.ps1` and `pwsh -NoProfile -File tools/model-handoff/package-release.ps1 -OutputDirectory .tmp/model-import-release`.

Expected: protocol, checksum, dispatcher, installer and ZIP package checks pass; the package contains every helper file exactly once.

- [ ] **Step 6: Commit**

```bash
git add tools/model-handoff/Dispatch-ModelHandoff.ps1 tools/model-handoff/Import-Models.ps1 tools/model-handoff/Install.ps1 tools/model-handoff/Handoff.Core.psm1 tools/model-handoff/Import.Core.psm1 tools/model-handoff/Import.Ui.psm1 tools/model-handoff/README.md tools/model-handoff/release-manifest.json tools/model-handoff/package-release.ps1 tests/ops/model-handoff.verify.ps1
git commit -m "feat: add model import Windows workbench"
```

### Task 6: Add the model-library entry point and import ticket API client

**Files:**
- Modify: `utils/api.js`
- Modify: `screens/ModelsScreen.js`
- Create: `components/ModelImportCard.js`
- Modify: `backend/routes/modelImport.js`
- Modify: `backend/modules/adapters/modelImportHttp.js`
- Test: `tests/client/model-import-entry.test.cjs`

- [ ] **Step 1: Add the client contract test**

Assert that `authorizeModelImport()` calls `/model-import/handoff/authorize`, opens `manage3d-model://import?server=<encoded>&ticket=<encoded>`, and disables the button when the current runtime is stale or the user role is not owner/staff.

- [ ] **Step 2: Implement the API helper**

Add `authorizeModelImport()` to `utils/api.js`. It must capture the current runtime, call the endpoint through `apiRequest`, verify the runtime is unchanged, and call `Linking.openURL` with the exact encoded server and ticket. Expose a stable error for missing helper installation.

- [ ] **Step 3: Add the model-library card**

Create `ModelImportCard.js` using the existing theme and button patterns. Display the helper version, install/checksum links, server connection state, and a “批量导入模型” action. Render only for `owner` and `staff`.

- [ ] **Step 4: Place the entry point in `ModelsScreen.js`**

Add the card above the model grid/list, preserve existing search and pagination, and refresh the list when the helper reports a completed batch on the next foreground event.

- [ ] **Step 5: Run client tests**

Run: `node --test tests/client/model-import-entry.test.cjs`

Expected: PASS without changing existing model-list tests.

- [ ] **Step 6: Commit**

```bash
git add utils/api.js screens/ModelsScreen.js components/ModelImportCard.js backend/routes/modelImport.js backend/modules/adapters/modelImportHttp.js tests/client/model-import-entry.test.cjs
git commit -m "feat: expose model import from model library"
```

### Task 7: Add optional AI description enhancement and audit output

**Files:**
- Modify: `backend/routes/modelImport.js`
- Modify: `backend/modules/modelImport/legacyService.js`
- Modify: `backend/modules/modelImport/relationalService.js`
- Modify: `backend/agent/modelIndex.js`
- Test: `tests/backend/model-import-describe.test.cjs`

- [ ] **Step 1: Test the opt-in boundary**

Assert that completed imports remain usable when description enhancement fails, facts are never overwritten, cloud enhancement requires explicit `aiDescription=true`, and audit entries record only item ID, provider and status.

- [ ] **Step 2: Implement description enhancement**

Generate `descriptionFacts` locally at prepare time. The describe endpoint receives only the stored preview/metadata unless the user explicitly enables cloud vision; store `{ text, source, model, generatedAt, confidence }` in `descriptionAi`. Keep file completion independent from AI completion.

- [ ] **Step 3: Queue model index reconciliation**

After a model reaches `completed`, call the existing `queueUserAssetIndex`/`queueUserModelReconcile` hook once. Do not index pending, duplicate or cleaned items.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/backend/model-import-describe.test.cjs tests/backend/model-index.test.cjs`

Expected: PASS with failed AI calls leaving the completed model intact.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/modelImport.js backend/modules/modelImport/legacyService.js backend/modules/modelImport/relationalService.js backend/agent/modelIndex.js tests/backend/model-import-describe.test.cjs
git commit -m "feat: add opt-in model descriptions"
```

### Task 8: Run end-to-end verification and document operations

**Files:**
- Create: `tests/backend/model-import-e2e.test.cjs`
- Create: `tests/ops/model-import-recovery.verify.ps1`
- Modify: `README.md`
- Modify: `docs/UPGRADE.md`
- Modify: `tools/model-handoff/README.md`

- [ ] **Step 1: Write the five-file cancellation scenario**

Use a fake import server and five fixtures. Start two workers, force cancellation while item 3 is uploading, assert item 1–2 completed records remain, item 3 is cleaned, and items 4–5 remain queued or are never prepared.

- [ ] **Step 2: Write restart and repair verification**

Terminate the helper after each of `preparing`, `uploading`, and `verifying`; restart it; assert `Repair-ModelImportJob` removes only incomplete server rows and resumes the remaining source files. Add a separate “取消任务” branch that removes all pending rows but not completed rows.

- [ ] **Step 3: Run the complete verification set**

Run:

```bash
npm run verify:client
npm run verify:backend
node --test tests/backend/model-import-contract.test.cjs tests/backend/model-import-http.test.cjs tests/backend/model-import-relational.test.cjs tests/backend/model-import-describe.test.cjs tests/backend/model-import-e2e.test.cjs
pwsh -NoProfile -File tests/ops/model-import-core.verify.ps1
pwsh -NoProfile -File tests/ops/model-import-recovery.verify.ps1
```

Expected: all commands exit 0; no existing test is skipped; package verification reports the same SHA-256 that is published with the helper archive.

- [ ] **Step 4: Update operational documentation**

Document helper installation, checksum verification, HTTPS requirement, supported formats, ZIP limits, recovery behavior, cancellation semantics, AI privacy choice, concurrency setting, and uninstall steps. State explicitly that source files are never overwritten.

- [ ] **Step 5: Commit**

```bash
git add tests/backend/model-import-e2e.test.cjs tests/ops/model-import-recovery.verify.ps1 README.md docs/UPGRADE.md tools/model-handoff/README.md
git commit -m "test: verify model import recovery and document operations"
```

## Self-review checklist

- Spec coverage: folder selection, format selection, recursion, ZIP extraction, duplicate path reporting, 2-way default concurrency with 1–4 range, continued failures, cancel confirmation and cleanup, power-loss repair, two-layer descriptions, existing helper reuse, legacy and relational storage, UI entry point, tests and staged rollout are covered by Tasks 1–8.
- Placeholder scan: no `TODO`, `TBD`, or unspecified implementation step remains in the plan.
- Type consistency: item states and job states are defined in Task 1 and reused by the PowerShell engine, legacy service, relational service, UI, and tests.
- Compatibility: existing model upload, Bambu Studio handoff, and model-list behavior remain available throughout the rollout.

