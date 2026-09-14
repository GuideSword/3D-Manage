# Self-Hosted Distribution Phase One Implementation Plan

> **执行说明（2026-09-08 审查修订）：** 按本文依赖顺序逐项实施，以 `- [ ]` 跟踪。原文引用的 `superpowers:subagent-driven-development` / `superpowers:executing-plans` 当前未在技能目录中提供，不能作为执行前提；默认在当前任务内执行，只有用户明确授权才使用子代理。本文是实施与验收计划，代码段是局部实现示例，不能当作可直接复制完成整个任务的完整补丁。

**Goal:** Deliver an installable client that connects at runtime to a customer-owned, single-organization backend distributed through Docker Compose, with safe first-run initialization, account isolation, server-side secrets, persistent storage, and verified backup/restore.

**Architecture:** Add a public server metadata and one-time bootstrap protocol to the Express backend. Add a device-scoped server configuration provider above authentication so every API and file request resolves its base URL at runtime. Package the backend, PostgreSQL, persistent file directories, health checks, and operational scripts as one self-hosted deployment while retaining the current document store for this phase.

**Tech Stack:** Expo 54, React Native 0.81, React Navigation 7, Expo SecureStore, Node.js 22 LTS, Express 5, Zod, JWT, PostgreSQL 16, Docker Compose, PowerShell 7 / POSIX shell, Node integration verification. Node 20 已结束官方支持；Node 22 与现有 `better-sqlite3` 必须通过容器构建及运行测试后才能作为发布基线。

---

## Locked scope and file map

The companion design is `docs/superpowers/specs/2026-09-08-self-hosted-distribution-phase-one-design.md`.

New frontend units:

- `context/ServerConfigContext.js`: owns the active server, connection state, metadata, and safe replacement flow.
- `utils/serverConfig.js`: normalizes server input and persists device-scoped configuration.
- `utils/sessionStorage.js`: namespaces tokens by normalized endpoint plus server ID (serverKey) and clears account-scoped data.
- `screens/ServerSetupScreen.js`: first-run and replacement server form.
- `screens/ServerConnectionErrorScreen.js`: retry and replace-server recovery.
- `screens/BootstrapOwnerScreen.js`: one-time organization and Owner initialization.
- `screens/UsersScreen.js`: Owner account administration required after public registration is removed.

New backend units:

- `backend/config/runtime.js`: validates production configuration and exposes product/version constants.
- `backend/routes/system.js`: public metadata and one-time bootstrap endpoints.
- `backend/routes/users.js`: Owner-only list, create, role change, activation, and password reset endpoints.
- `backend/utils/validation.js`: common Zod parsing and structured validation responses.
- `backend/scripts/verify-self-hosted.js`: verifies bootstrap, permissions, server identity, and secrets.

Deployment units:

- `backend/Dockerfile` and `backend/.dockerignore`: reproducible backend image.
- `compose.yaml`: app and PostgreSQL services with persistent bind mounts.
- `.env.example`: non-secret configuration template.
- `deploy/backup.ps1` and `deploy/restore.ps1`: consistent Windows backup and restore flow.
- `docs/SELF_HOSTING.md`, `docs/UPGRADE.md`, and `docs/BACKUP_RESTORE.md`: customer operations documentation.

Existing files are changed only for wiring, dynamic URL resolution, permission corrections, server-side OSS credentials, packaging, and validation. Business database normalization is outside this phase.

### 实施依赖与交付范围

后端依赖顺序为 `Task 1 → Task 2（同时提供最小 POST /api/users）→ Task 3 → Task 4 → Task 5`；客户端依赖顺序为 `Task 6 → Task 7 → Task 8`；`Task 9 → Task 10 → Task 11 → Task 12` 完成交付。Task 5 的旧本地密钥删除在 Task 6 实现；Task 2 不得先删除注册再等待 Task 3 才让基线测试恢复。

本阶段正式验收目标是 Android 安装包、Linux x86_64 后端及 Windows 开发机上的 Linux 容器测试。iOS、Windows Server 原生容器、ARM64、商店上架均不算本阶段已承诺交付。Docker Compose、PostgreSQL JSONB 与 Android 优先属于实施建议，尚未通过部署和设备验证，不能描述为已具备的能力。

默认交付 PostgreSQL JSONB + 后端本地文件卷 + AI SQLite；OSS 保留为显式可选能力，不能仅设置 `OSS_BUCKET` 就声称文件已改用 OSS。代码级关系表重构不在本阶段；现有数据迁入 PostgreSQL 的工具与验证属于本阶段必要工作。

末尾“审查补充任务”是各 Task 的必需步骤，须在对应任务完成前验收；不能仅勾选原有步骤跳过补充项。

审查后保留 12 个主任务，增加 R1–R5 作为安全、兼容及可恢复性补充。原有 `git add` 命令只列主文件；提交时须同时加入对应 R 项实际修改文件，先逐项查看 diff，不能使用全仓库无差别暂存。所有验收的预期结果是未来执行标准，本次文档审查没有运行尚未实现的命令。

### Task 1: Add runtime configuration validation and server identity

**Files:**

- Create: `backend/config/runtime.js`
- Modify: `backend/utils/store.js`
- Modify: `backend/server.js`
- Modify: `backend/package.json`
- Test: `backend/scripts/verify-self-hosted.js`

- [ ] **Step 1: Write the failing server identity verification**

Create `backend/scripts/verify-self-hosted.js` with a temporary file store, start the app, call `/api/system/info`, and assert the stable contract:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3d-manage-self-hosted-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.STORE_DRIVER = 'file';
process.env.JWT_SECRET = 'self-hosted-verify-secret-with-at-least-32-characters';
process.env.AGENT_KEY_ENC_SECRET = 'agent-verify-secret-with-at-least-32-characters';
process.env.BOOTSTRAP_TOKEN = 'bootstrap-test-only-32-byte-equivalent-secret';
process.env.NODE_ENV = 'test';

const app = require('../server');

const main = async () => {
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/system/info`);
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.product, '3D Manage');
    assert.equal(info.apiVersion, '1');
    assert.equal(info.initialized, false);
    assert.match(info.serverId, /^[0-9a-f-]{36}$/i);

    const second = await fetch(`${baseUrl}/api/system/info`).then((item) => item.json());
    assert.equal(second.serverId, info.serverId);
    console.log('Self-hosted verification passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the verification and confirm the missing route**

Run: `node backend/scripts/verify-self-hosted.js`

Expected: FAIL because `/api/system/info` returns 404.

- [ ] **Step 3: Add runtime configuration validation**

Create `backend/config/runtime.js`:

```js
const packageJson = require('../package.json');

const PRODUCT_NAME = '3D Manage';
const API_VERSION = '1';

const assertRuntimeConfig = () => {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['JWT_SECRET', 'AGENT_KEY_ENC_SECRET'];
  const missing = required.filter((key) => !process.env[key] || process.env[key].length < 32 || process.env[key].startsWith('CHANGE_ME_'));
  if (missing.length) {
    throw new Error(`Missing or weak production configuration: ${missing.join(', ')}`);
  }
  if (process.env.ADMIN_PASSWORD || process.env.ADMIN_EMAIL) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are not supported in production; use system bootstrap.');
  }
};

module.exports = {
  API_VERSION,
  PRODUCT_NAME,
  SERVER_VERSION: packageJson.version,
  assertRuntimeConfig,
};
```

Call `assertRuntimeConfig()` before Express middleware is created in `backend/server.js`.

- [ ] **Step 4: Persist server metadata in the existing store**

Import `randomUUID` from `node:crypto` in `backend/utils/store.js`, raise `schemaVersion` to `2`, and use an explicit persisted migration to install this shape without changing an existing `serverId`:

```js
if (!data.system) {
  data.system = {
    serverId: randomUUID(),
    organizationName: '',
    initializedAt: null,
  };
}
```

Do not generate identity during each read or from a process-wide mutable default object. Add a fresh-store factory and a versioned migration that durably writes `system`, `schemaVersion: 2`, and missing `tokenVersion: 1` before serving requests. For existing stores with users, mark initialized only after validating at least one active Owner; if none exists, stop with a local recovery instruction, never reopen public bootstrap. Persist a default organization name for legacy data and allow Owner to edit it. File mode migrates via atomic replacement; PostgreSQL mode migrates under a row lock. Test identity across process restarts and two simultaneous initializers. Do not add `system` to `COLLECTION_KEYS` because it is an object.

- [ ] **Step 5: Add the public information endpoint**

Create `backend/routes/system.js` with `GET /info`. Read the store with `{ write: false }` and return:

```js
{
  product: PRODUCT_NAME,
  serverId: data.system.serverId,
  organizationName: data.system.organizationName,
  initialized: Boolean(data.system.initializedAt),
  apiVersion: API_VERSION,
  serverVersion: SERVER_VERSION,
  capabilities: {
    agent: true,
    objectStorage: false,
    selfHosted: true,
  },
}
```

Mount it with `app.use('/api/system', require('./routes/system'))`. Capabilities describe enabled and verified features: default local-file mode reports `objectStorage: false`; AI is available only when enabled and its required runtime configuration validates. Return `Cache-Control: no-store`. Product and server IDs are compatibility identifiers, not substitutes for HTTPS authentication.

- [ ] **Step 6: Add the verification command and run both suites**

Add `"verify:self-hosted": "node scripts/verify-self-hosted.js"` to `backend/package.json`.

Run: `npm --prefix backend run verify:self-hosted`

Expected: `Self-hosted verification passed`.

Run: `npm run verify:backend`

Expected: the existing API verification still passes unchanged.

- [ ] **Step 7: Commit the server identity contract**

```bash
git add backend/config/runtime.js backend/utils/store.js backend/routes/system.js backend/server.js backend/package.json backend/scripts/verify-self-hosted.js
git commit -m "feat(server): add self-hosted server identity"
```

### Task 2: Implement one-time organization and Owner bootstrap

**Files:**

- Create: `backend/utils/validation.js`
- Create: `backend/utils/authTokens.js`
- Create: `backend/routes/users.js` (minimal Owner-only create route; extended in Task 3)
- Create: `backend/scripts/reset-owner-password.js`
- Modify: `backend/routes/system.js`
- Modify: `backend/routes/auth.js`
- Modify: `backend/middleware/auth.js`
- Modify: `backend/scripts/verify-self-hosted.js`
- Modify: `backend/scripts/verify-api.js`

- [ ] **Step 1: Add failing bootstrap cases**

Extend `verify-self-hosted.js` before its final success log:

```js
const bootstrapResponse = await fetch(`${baseUrl}/api/system/bootstrap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': process.env.BOOTSTRAP_TOKEN },
  body: JSON.stringify({
    organizationName: 'Verify Workshop',
    ownerName: 'Verify Owner',
    email: 'owner@example.com',
    password: 'OwnerPassword123!',
  }),
});
assert.equal(bootstrapResponse.status, 201);
const bootstrap = await bootstrapResponse.json();
assert.equal(bootstrap.user.role, 'owner');
assert.ok(bootstrap.token);

const repeatedBootstrap = await fetch(`${baseUrl}/api/system/bootstrap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': process.env.BOOTSTRAP_TOKEN },
  body: JSON.stringify({
    organizationName: 'Attacker',
    ownerName: 'Second Owner',
    email: 'second@example.com',
    password: 'OwnerPassword123!',
  }),
});
assert.equal(repeatedBootstrap.status, 409);
```

Also assert that anonymous `POST /api/auth/register` returns exactly `404`.

- [ ] **Step 2: Run the suite and confirm bootstrap is unavailable**

Run: `npm --prefix backend run verify:self-hosted`

Expected: FAIL because `POST /api/system/bootstrap` is not implemented.

- [ ] **Step 3: Add a reusable Zod request parser**

Create `backend/utils/validation.js`:

```js
const parseRequest = (schema, value, res) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    code: 'VALIDATION_FAILED',
    error: 'Request validation failed',
    details: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
  return null;
};

module.exports = { parseRequest };
```

- [ ] **Step 4: Implement atomic bootstrap**

Define a strict Zod schema in `backend/routes/system.js` requiring a non-empty organization and owner name, normalized email, and a password of at least 12 characters and at most 72 UTF-8 bytes (bcrypt input limit). Require the deployment-only `BOOTSTRAP_TOKEN` through `X-Bootstrap-Token`, compare it in constant time, and never log or persist the plaintext token in client settings. Reject missing/wrong tokens before creating any account. The deployment configuration generator creates 32 random bytes; initialized servers ignore this token and remain locked. In one `withData` mutation:

```js
if (data.system.initializedAt || data.users.length > 0) {
  return { status: 409, body: { code: 'SYSTEM_ALREADY_INITIALIZED', error: 'System is already initialized' } };
}

const owner = {
  id: nextId(data.users),
  email: input.email.toLowerCase(),
  name: input.ownerName,
  role: 'owner',
  active: true,
  tokenVersion: 1,
  passwordHash: bcrypt.hashSync(input.password, 12),
  createdAt: now(),
  updatedAt: now(),
};
data.users.push(owner);
data.system.organizationName = input.organizationName;
data.system.initializedAt = now();
appendAudit(data, {
  actorId: owner.id,
  entity: 'system',
  entityId: data.system.serverId,
  action: 'bootstrap',
  diff: { organizationName: input.organizationName, ownerEmail: owner.email },
});
```

Create `backend/utils/authTokens.js` as the only JWT signing implementation. It exports `issueToken(user)`, includes `{ sub, email, role, ver: tokenVersion }`, reads the configured secret, and uses `JWT_EXPIRES_IN || '7d'`. Import it from the system and auth routes. Authentication verifies the same secret and checks `payload.ver === user.tokenVersion`. Remove the duplicated `dev-secret-change-me` fallback from both the auth route and middleware. Never return the password or hash.

- [ ] **Step 5: Remove implicit default Owner and anonymous registration**

Delete `ensureDefaultOwner` and its calls from `backend/routes/auth.js`. Remove the anonymous `/register` route. Login against an empty store returns `409` with code `SYSTEM_NOT_INITIALIZED`.

Update both verification scripts to set a test `BOOTSTRAP_TOKEN` before app import and attach `X-Bootstrap-Token` to bootstrap calls. `verify-api.js` must bootstrap before login and replace its Viewer registration with Owner-authenticated `POST /api/users`. Implement that minimal create route in this task, using Task 3's schema and audit rules, so both suites pass at this commit. Bootstrap success returns `{ user, token, serverId }`. Public `/register` returns exactly 404. Test missing/wrong bootstrap tokens (403), valid bootstrap (201), concurrent valid requests (one 201, one 409), and persistence failure (no Owner or initialized marker committed).

Add a local console-only Owner password recovery command that takes an explicit Owner ID, reads the new password from hidden interactive input, updates only that Owner, increments tokenVersion, and audits the recovery without secrets. No anonymous password-reset API and no automatic promotion of an arbitrary user. If bootstrap succeeds but the response is lost, refresh metadata and use normal login; never create a second Owner.

- [ ] **Step 6: Verify initialization and regression behavior**

Run: `npm --prefix backend run verify:self-hosted`

Expected: bootstrap succeeds once and the second attempt returns 409.

Run: `npm run verify:backend`

Expected: `API verification passed`.

- [ ] **Step 7: Commit bootstrap**

```bash
git add backend/utils/validation.js backend/utils/authTokens.js backend/routes/system.js backend/routes/auth.js backend/routes/users.js backend/server.js backend/middleware/auth.js backend/scripts/reset-owner-password.js backend/scripts/verify-self-hosted.js backend/scripts/verify-api.js start-project.ps1
git commit -m "feat(auth): add one-time owner bootstrap"
```

### Task 3: Add Owner-managed Staff and Viewer accounts

**Files:**

- Modify: `backend/routes/users.js`
- Create: `screens/UsersScreen.js`
- Modify: `backend/server.js`
- Modify: `utils/api.js`
- Modify: `screens/SettingsScreen.js`
- Modify: `navigation/AppNavigator.js`
- Modify: `constants/index.js`
- Test: `backend/scripts/verify-self-hosted.js`

- [ ] **Step 1: Add failing account-management permission tests**

After bootstrap, use the Owner token to create a Staff user through `POST /api/users`. Log in as Staff and assert `GET /api/users` returns 403. Also assert duplicate email returns 409 and role `owner` returns 400.

Use this exact request body:

```json
{
  "name": "Workshop Staff",
  "email": "staff@example.com",
  "password": "StaffPassword123!",
  "role": "staff"
}
```

- [ ] **Step 2: Run the test and confirm user-management extensions are missing**

Run: `npm --prefix backend run verify:self-hosted`

Expected: Task 2's POST create still passes; new GET/PATCH/reset-password cases fail before Task 3 implements them. Add these missing cases before writing the route extensions.

- [ ] **Step 3: Implement Owner-only user endpoints**

Create `backend/routes/users.js` guarded by `router.use(requireRoles('owner'))` and provide:

- `GET /`: public user fields only.
- `POST /`: create only `staff` or `viewer`, reject duplicate normalized email.
- `PATCH /:id`: update name, role, or active status; prevent an Owner from deactivating or demoting themselves.
- `POST /:id/reset-password`: hash a new password and increment the user's `tokenVersion`.

Reuse Task 2's tokenVersion and signing contract. Increment tokenVersion on role change, deactivation and password reset, so reactivation never revives old sessions. `/auth/me` must use the same middleware as other protected routes, not duplicate JWT verification. Reload the database role on every authorization check. Update and reset routes may manage Staff/Viewer only; reject any attempt to demote, deactivate, or reset an Owner through these routes. Owner changes their own password via `POST /api/auth/change-password`, which verifies the current password and increments tokenVersion. Every mutation writes an audit record using `req.user.id` and excludes passwords, hashes, tokens and keys. Add Owner-only `PATCH /api/system/organization` for organizationName.

- [ ] **Step 4: Add the frontend API and Owner screen**

Add `usersAPI` to `utils/api.js` with `getAll`, `create`, `update`, and `resetPassword`. Add `ROUTES.USERS` and its title. Build `UsersScreen.js` using existing `Card`, `Input`, `Picker`, and `Button` components. It must list role and active state, create Staff or Viewer, activate/deactivate users, and never offer Owner creation.

- [ ] **Step 5: Restrict the navigation entry**

In `SettingsScreen.js`, render “用户与权限” only when `user.role === ROLES.OWNER`. Register the screen in `AppNavigator.js`; the backend remains the security boundary if a navigation action is forged.

- [ ] **Step 6: Verify API and Expo bundling**

Run: `npm --prefix backend run verify:self-hosted`

Expected: account creation succeeds for Owner and is forbidden for Staff.

Run: `npx expo export --platform web --output-dir .tmp/self-hosted-users`

Expected: export completes without module or navigation errors.

- [ ] **Step 7: Commit account administration**

```bash
git add backend/routes/users.js backend/server.js backend/scripts/verify-self-hosted.js utils/api.js screens/UsersScreen.js screens/SettingsScreen.js navigation/AppNavigator.js constants/index.js
git commit -m "feat(users): add owner-managed accounts"
```

### Task 4: Close role and audit identity bypasses

**Files:**

- Modify: `backend/routes/agent.js`
- Modify: `backend/routes/stock.js`
- Modify: `backend/routes/orders.js`
- Modify: `backend/routes/materials.js`
- Modify: `backend/routes/models.js`
- Modify: `backend/agent/orchestrator.js`
- Modify: `backend/agent/tools/index.js`
- Modify: `backend/agent/tools/orders.js`
- Modify: `components/agent/DraftConfirmCard.js`
- Modify: `screens/AgentChatScreen.js`
- Test: `backend/scripts/verify-self-hosted.js`

- [ ] **Step 1: Add failing Viewer and actor identity tests**

Create a Viewer with the Owner API, log in as Viewer, and assert `POST /api/agent/drafts/confirm` returns 403. Submit a Staff inventory transaction with `actorId: 'forged-user'`, then read the persisted store and assert both the transaction and audit log use the authenticated Staff ID.

Also PATCH an order with `{ "status": "completed" }` through `/api/orders/:id` and assert it returns 400 with code `STATUS_REQUIRES_TRANSITION_ENDPOINT`.

- [ ] **Step 2: Run the suite and observe the bypasses**

Run: `npm --prefix backend run verify:self-hosted`

Expected: FAIL because Viewer can confirm an AI draft, inventory accepts a forged actor, or generic order update accepts status.

- [ ] **Step 3: Apply role checks to AI writes**

Keep conversation reads under `requireAuth`, but add `requireRoles('owner', 'staff')` directly to `/drafts/confirm`. Pass `{ userId, role }` into AI tool dispatch and require each future write tool to declare allowed roles before execution.

Current registered tools query data or extract a draft; they do not write orders. Keep Viewer read-only AI queries available, hide/disable the draft confirmation action for Viewer, and test the 403 before any provider call. Fix AI draft creation's `orders.length + 1` ID allocation to use `nextId`, map customer/items to the normal order shape, and use the common order creation service with strict draft inputs and authenticated audit actor. Test confirmation after a prior order deletion, then retrieve the order through the normal API and verify unique ID and displayed fields. Align AI order status enums with `draft/pending_review/in_progress/completed/cancelled`.

- [ ] **Step 4: Source all actor IDs from authentication**

Replace audit defaults and request-body actors in business routes with `String(req.user.id)`. Inventory transaction creation must use:

```js
actorId: String(req.user.id),
```

and its matching audit call must pass the same value. Apply the same rule to create, update, delete, import, export, upload, and status operations in all business routes.

- [ ] **Step 5: Reserve order status for the transition endpoint**

Before normalizing a generic order PATCH, reject a supplied `status` key:

```js
if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
  return res.status(400).json({
    code: 'STATUS_REQUIRES_TRANSITION_ENDPOINT',
    error: 'Use the order status endpoint to change status',
  });
}
```

The dedicated status route continues to enforce `allowedTransitions` and records the authenticated actor and reason.

- [ ] **Step 6: Run both backend suites**

Run: `npm --prefix backend run verify:self-hosted`

Expected: Viewer write returns 403, forged actor is ignored, and direct status patch returns 400.

Run: `npm run verify:backend`

Expected: existing business workflows pass after tests use the status endpoint.

- [ ] **Step 7: Commit permission corrections**

```bash
git add backend/routes/agent.js backend/routes/stock.js backend/routes/orders.js backend/routes/materials.js backend/routes/models.js backend/scripts/verify-self-hosted.js
git commit -m "fix(auth): enforce write roles and authenticated audit actors"
```

### Task 5: Move object-storage credentials fully to the backend

**Files:**

- Modify: `backend/config/oss.js`
- Modify: `backend/routes/oss.js`
- Modify: `backend/config/runtime.js`
- Modify: `backend/scripts/verify-api.js`
- Modify: `screens/SettingsScreen.js`
- Modify: `navigation/AppNavigator.js`
- Modify: `constants/index.js`
- Delete: `screens/OSSConfigScreen.js`
- Test: `backend/scripts/verify-self-hosted.js`

- [ ] **Step 1: Add a failing secret-injection test**

Set test OSS variables before requiring the app. Call `/api/oss/upload-url` as Staff with an alternate `config` object and assert the request returns `400 SENSITIVE_CONFIG_NOT_ACCEPTED`. Assert Viewer receives 403 from upload signing and can request only download signing.

- [ ] **Step 2: Run the suite and confirm request credentials are accepted**

Run: `npm --prefix backend run verify:self-hosted`

Expected: FAIL because the current route accepts credentials from `req.body`.

- [ ] **Step 3: Remove request-supplied OSS configuration**

Change OSS helpers so production calls always use environment variables. Route bodies contain only `objectKey` and bounded `expire`; reject `config`, `accessKeyId`, `accessKeySecret`, and `secretAccessKey` with `400 SENSITIVE_CONFIG_NOT_ACCEPTED`. Update `verify-api.js` to set test OSS environment variables before loading the app and stop sending credentials in route bodies.

Clamp signed URL expiry:

```js
const expirySchema = (fallback, maximum) => z.number().int().min(1).max(maximum).default(fallback);
```

Use a maximum of 600 seconds for upload and 3600 seconds for download. Reject malformed values instead of parsing prefixes or falling back silently. Import `z` from the existing Zod dependency.

- [ ] **Step 4: Remove the client credential screen and stored value**

Remove the OSS settings route and Settings entry. During ServerConfigProvider initialization, delete the legacy `ossConfig` key once. The client must never send OSS credentials.

- [ ] **Step 5: Verify secrets and frontend compilation**

Run: `npm --prefix backend run verify:self-hosted`

Expected: request credential injection is rejected and role checks pass.

Run: `rg -n "secretAccessKey|accessKeySecret|ossConfig" screens context utils`

Expected: no credential form or credential submission matches. The single documented `ossConfig` deletion migration in Task 6 is allowed; it must only delete the old key and never read or resubmit its value.

Run: `npx expo export --platform web --output-dir .tmp/self-hosted-oss`

Expected: export completes.

- [ ] **Step 6: Commit server-owned object storage**

```bash
git add backend/config/oss.js backend/routes/oss.js backend/config/runtime.js backend/scripts/verify-self-hosted.js backend/scripts/verify-api.js screens/SettingsScreen.js navigation/AppNavigator.js constants/index.js
git rm screens/OSSConfigScreen.js
git commit -m "fix(storage): keep object storage secrets on server"
```

### Task 6: Add runtime server configuration and namespaced sessions

**Files:**

- Create: `utils/serverAddress.js`
- Create: `utils/serverAddress.verify.js`
- Create: `utils/serverConfig.js`
- Create: `utils/sessionStorage.js`
- Create: `context/ServerConfigContext.js`
- Modify: `utils/api.js`
- Modify: `utils/agentApi.js`
- Modify: `context/AuthContext.js`
- Modify: `App.js`

- [ ] **Step 1: Define and manually exercise server normalization cases**

Implement `normalizeServerUrl` as a dependency-free CommonJS utility in `utils/serverAddress.js` with these exact results:

| Input | Result |
|---|---|
| `192.168.1.10:5000` | `http://192.168.1.10:5000/api` |
| `https://manage.example.com` | `https://manage.example.com/api` |
| `https://manage.example.com/api/` | `https://manage.example.com/api` |
| empty string, credentials in URL, query, or fragment | validation error |

Add a development-only executable check in `utils/serverAddress.verify.js` using Node `assert`. `utils/serverConfig.js` imports the CommonJS utility and owns asynchronous persistence and probing.

- [ ] **Step 2: Run the normalization check before implementation**

Run: `node utils/serverAddress.verify.js`

Expected: FAIL until `normalizeServerUrl` is exported.

- [ ] **Step 3: Implement device-scoped server persistence**

`utils/serverConfig.js` exports `loadServerConfig`, `saveServerConfig`, `clearServerConfig`, and `probeServer`. Use the storage key `serverConfig.v1`. Loading returns `null` unless the decoded object has non-empty `serverId` and `apiBaseUrl`. Saving persists only `serverId`, `apiBaseUrl`, `organizationName`, `initialized`, `apiVersion`, `serverVersion`, and `capabilities`. Probing sends `GET ${apiBaseUrl}/system/info` with an eight-second AbortController timeout. It accepts only `product === '3D Manage'` and `apiVersion === '1'`, returning structured codes for timeout, wrong product, incompatible API, and unreachable service.

- [ ] **Step 4: Namespace the authentication token**

Create `utils/sessionStorage.js`:

```js
import storage from './storage';

const tokenKey = (serverKey) => `jwtToken.v1.${serverKey}`;

export const getToken = (serverKey) => storage.getItem(tokenKey(serverKey));
export const setToken = (serverKey, token) => storage.setItem(tokenKey(serverKey), token);
export const clearSession = async (serverKey) => {
  await storage.deleteItem(tokenKey(serverKey));
  await storage.deleteItem(`drafts.v1.${serverKey}`);
};
```

Remove use of the global `jwtToken` key after performing a one-time deletion migration.

- [ ] **Step 5: Implement ServerConfigProvider**

The provider exposes:

```js
{
  initializing,
  server,
  connectionError,
  configureServer,
  refreshServer,
  replaceServer,
  clearServer,
}
```

`configureServer` probes before saving. `replaceServer` clears the old server session only after the new server probe succeeds. Persist `{ serverId, apiBaseUrl, organizationName, initialized, apiVersion, serverVersion, capabilities }`.

- [ ] **Step 6: Resolve every API request from the provider-owned server**

Refactor `apiRequest`, protected downloads, and Agent SSE to capture one immutable `{ apiBaseUrl, serverId, serverKey, sessionEpoch }` snapshot before reading the matching token. `serverKey` is a stable SHA-256 hex digest of `apiBaseUrl + '\n' + serverId`, encoded with a platform-supported crypto implementation; never namespace credentials by a server-supplied ID alone. Do not import a module-time `API_CONFIG.BASE_URL`. Strip client-only options such as `auth` before invoking fetch. Cancel outgoing requests on logout/switch and discard all success, login-token persistence, error and 401 callbacks if their captured epoch no longer matches.

Update AuthProvider to initialize only after ServerConfigProvider has loaded and to clear user state whenever serverKey changes. No server, failed probe, or uninitialized server must settle authentication initialization without sending `/auth/me`. A changed serverId at the same URL forces logout and a visible reconnection notice before any authenticated request.

- [ ] **Step 7: Wire provider order**

Use this provider nesting in `App.js`:

```jsx
<ThemeProvider>
  <ServerConfigProvider>
    <AuthProvider>
      <AppNavigator />
      <AuthenticatedFab />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </AuthProvider>
  </ServerConfigProvider>
</ThemeProvider>
```

- [ ] **Step 8: Verify normalization and bundle**

Run: `node utils/serverAddress.verify.js`

Expected: all normalization and rejection cases pass.

Run: `npx expo export --platform web --output-dir .tmp/self-hosted-runtime-server`

Expected: export completes without static API URL errors.

- [ ] **Step 9: Commit runtime configuration**

```bash
git add utils/serverAddress.js utils/serverAddress.verify.js utils/serverConfig.js utils/sessionStorage.js context/ServerConfigContext.js utils/api.js utils/agentApi.js context/AuthContext.js App.js
git commit -m "feat(client): add runtime server configuration"
```

### Task 7: Build first-run connection and Owner initialization screens

**Files:**

- Create: `screens/ServerSetupScreen.js`
- Create: `screens/ServerConnectionErrorScreen.js`
- Create: `screens/BootstrapOwnerScreen.js`
- Modify: `navigation/AppNavigator.js`
- Modify: `constants/index.js`
- Modify: `utils/api.js`
- Modify: `screens/LoginScreen.js`

- [ ] **Step 1: Add system API methods**

Add:

```js
export const systemAPI = {
  info: async () => apiRequest('/system/info', { auth: false }),
  bootstrap: async (payload, bootstrapToken) => apiRequest('/system/bootstrap', {
    method: 'POST',
    auth: false,
    headers: { 'X-Bootstrap-Token': bootstrapToken },
    body: JSON.stringify(payload),
  }),
};
```

`apiRequest` must support `auth: false` without reading a token.

- [ ] **Step 2: Implement ServerSetupScreen**

The form contains one server address field, a clear HTTP-on-LAN note, a test-and-save button, progress feedback, and exact error messages for timeout, incompatible API, wrong product, and unreachable server. It never saves an unverified endpoint.

- [ ] **Step 3: Implement connection recovery**

`ServerConnectionErrorScreen` shows the saved endpoint and server name, with “重试连接” and “更换服务器”. Retrying keeps the current configuration. Replacing opens ServerSetupScreen in replacement mode and retains the old endpoint on failure.

- [ ] **Step 4: Implement BootstrapOwnerScreen**

Collect organization name, owner name, email, password, password confirmation and the deployment bootstrap token. Require 12 characters, at most 72 UTF-8 password bytes, and matching confirmation. Send the setup token only as `X-Bootstrap-Token`. Call bootstrap, verify returned serverId matches the probed server, save the returned JWT under serverKey, refresh metadata, and enter the authenticated application. Clear password and setup token from memory on success, cancellation or navigation away.

- [ ] **Step 5: Replace the root navigation state machine**

Render exactly one branch:

```jsx
if (serverInitializing) return <LoadingScreen />;
if (!server) return <ServerSetupScreen />;
if (connectionError) return <ServerConnectionErrorScreen />;
if (!server.initialized) return <BootstrapOwnerScreen />;
if (authInitializing) return <LoadingScreen />;
if (!isAuthenticated) return <LoginScreen />;
return <AuthenticatedStack />;
```

Remove role selection, registration mode, default email, default password, and default-admin hints from `LoginScreen.js`. Show the connected organization and endpoint above the login form.

- [ ] **Step 6: Perform the first-run walkthrough**

Run backend with a fresh temporary `DATA_DIR`, start Expo, and verify:

1. No server produces the setup screen.
2. Invalid host is not saved.
3. Valid host shows initialization.
4. Owner bootstrap logs in.
5. App restart remembers the server and session.
6. Logout remembers the server and returns to login.

Run: `npx expo export --platform web --output-dir .tmp/self-hosted-onboarding`

Expected: export completes.

- [ ] **Step 7: Commit onboarding**

```bash
git add screens/ServerSetupScreen.js screens/ServerConnectionErrorScreen.js screens/BootstrapOwnerScreen.js screens/LoginScreen.js navigation/AppNavigator.js constants/index.js utils/api.js
git commit -m "feat(onboarding): add server connection and owner setup"
```

### Task 8: Implement safe logout and server replacement

**Files:**

- Modify: `context/AuthContext.js`
- Modify: `context/ServerConfigContext.js`
- Modify: `screens/SettingsScreen.js`
- Modify: `screens/ServerSetupScreen.js`
- Modify: `utils/serverConfig.js`
- Modify: `utils/sessionStorage.js`

- [ ] **Step 1: Define logout and replacement acceptance cases**

Document these executable manual assertions in `docs/SELF_HOSTING.md` as part of Task 11:

- Logout removes the current server token but retains endpoint and theme.
- Login to server A, replace with unreachable B: A remains active and its token is unchanged.
- Login to server A, replace with reachable B: A token is removed, B becomes active, login is required.
- Returning to A later requires login and does not expose previous screen state.

- [ ] **Step 2: Make logout clear the complete account session**

AuthProvider `signOut` immediately increments sessionEpoch, cancels API/SSE/file operations, clears the user and unmounts the authenticated tree including the out-of-navigation AI FAB. It then deletes the serverKey credential and tracked temporary files. If deletion fails, remain logged out, show a retry action, and block switch completion; do not claim cleanup succeeded. Device theme and selected server remain. This removes local credentials; it does not revoke copies of a stateless JWT held elsewhere. Server-side tokenVersion changes are the phase-one revocation mechanism.

- [ ] **Step 3: Add the replacement transaction**

`replaceServer(candidate)` follows this order:

1. Normalize and probe candidate.
2. If probe fails, return error without mutation.
3. Freeze old actions, increment sessionEpoch, abort operations and clear old user/navigation state.
4. Clear the old serverKey session, tracked temporary files and any stale token for the candidate.
5. Persist candidate metadata, then publish the new server snapshot and show its login/bootstrap page.

If persistence or cleanup fails after Step 3, remain logged out with the previous saved endpoint and a retry message. Never roll back to an authenticated old account. If probing fails before Step 3, leave the original selection and session unchanged. Switching from a server whose ID was copied from another server still requires login because serverKey includes the URL.

Use an `isReplacing` guard to reject duplicate taps.

- [ ] **Step 4: Add Settings UI**

Replace the read-only API address row with a server card showing organization, endpoint, server version, API version, and status. Add “测试连接” and “更换服务器”. Require a confirmation dialog before entering replacement mode.

- [ ] **Step 5: Verify the four acceptance cases and bundle**

Execute the cases from Step 1 on Web and one native development build.

Run: `npx expo export --platform web --output-dir .tmp/self-hosted-switching`

Expected: export completes.

- [ ] **Step 6: Commit session lifecycle**

```bash
git add context/AuthContext.js context/ServerConfigContext.js screens/SettingsScreen.js screens/ServerSetupScreen.js utils/serverConfig.js utils/sessionStorage.js
git commit -m "feat(client): isolate sessions when changing servers"
```

### Task 9: Add production Docker packaging

**Files:**

- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Create: `compose.yaml`
- Create: `.env.example`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add the PostgreSQL runtime dependency**

Run: `npm --prefix backend install pg`

Expected: `pg` appears in backend dependencies and the lockfile changes.

- [ ] **Step 2: Create the backend image**

Use Node 22 Bookworm Slim as the supported baseline. This image is a build starting point, not a verified artifact; test `better-sqlite3` loading and model preview fallback in the resulting Linux container:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["node", "server.js"]
```

Exclude `node_modules`, `.env*` except templates, logs, `data`, and `uploads` in `backend/.dockerignore`. If native prebuilds are unavailable, use a builder stage with Python/make/g++, copying modules into the same Node/OS runtime; do not fall back to an unsupported Node version. Pin the tested image digest at release and record native dependency versions.

- [ ] **Step 3: Create Compose services and persistent directories**

Create `compose.yaml` with:

- `db`: PostgreSQL 16, a named database, health check, and `./runtime/postgres:/var/lib/postgresql/data`.
- `app`: locally built backend, `STORE_DRIVER=postgres`, internal `DATABASE_URL`, runtime secrets, `./runtime/data:/app/data`, and `./runtime/uploads:/app/uploads`.
- App health check against `http://127.0.0.1:5000/api/system/info` so database availability is included.
- `depends_on.db.condition: service_healthy`.
- Restart policy `unless-stopped`.
- Port `${APP_PORT:-5000}:5000`.

Do not publish PostgreSQL to the host by default.

Explicitly pass `DATA_DIR=/app/data`, `UPLOAD_DIR=/app/uploads`, `PORT=5000`, `HOST=0.0.0.0`, `NODE_ENV=production`, both encryption secrets, `BOOTSTRAP_TOKEN`, `CORS_ORIGINS`, `STORE_TABLE` and `STORE_ID`; a Compose `.env` is interpolation input and is not automatically injected into a container. Require secrets with `${VARIABLE:?message}` and reject `CHANGE_ME_` at runtime. Generate database passwords using URL-safe random characters or correctly encode the password in DATABASE_URL. Never print a rendered Compose config containing secrets to support logs.

Add `deploy/init-config.mjs` to generate independent random secrets without overwriting an existing `.env`. Add a one-shot volume initialization service for app bind mounts (UID/GID matching the non-root app user); image-layer chown does not change host-mounted directory ownership. Verify `test -w /app/data` and `test -w /app/uploads` as the runtime user. Keep one app replica while AI SQLite is local. Add bounded Docker log rotation, app stop grace period and startup readiness that tests PostgreSQL, SQLite and file-directory access without exposing internal paths.

- [ ] **Step 4: Add a complete environment template**

Create `.env.example` with documented safe values and no real secrets:

```dotenv
APP_PORT=5000
POSTGRES_DB=manage3d
POSTGRES_USER=manage3d
POSTGRES_PASSWORD=CHANGE_ME_USE_LONG_RANDOM_DATABASE_PASSWORD
JWT_SECRET=CHANGE_ME_USE_32_RANDOM_CHARACTERS_MINIMUM
AGENT_KEY_ENC_SECRET=CHANGE_ME_USE_ANOTHER_32_RANDOM_CHARACTERS
BOOTSTRAP_TOKEN=CHANGE_ME_USE_A_SEPARATE_RANDOM_SETUP_TOKEN
CORS_ORIGINS=https://manage.example.com
OSS_REGION=
OSS_ACCESS_KEY_ID=
OSS_SECRET_ACCESS_KEY=
OSS_BUCKET=
OSS_ENDPOINT=
OSS_SECURE=true
```

Ignore `.env` and `runtime/`, while keeping `.env.example` tracked.

- [ ] **Step 5: Build and start from an empty runtime directory**

Run in a newly created disposable release directory: `node deploy/init-config.mjs`

Expected: generates a new `.env` with independent secrets; refuses to overwrite an existing file. A host Node installation is only required for this source-build workflow; the packaged container entrypoint also provides the same configuration generator for customer use.

Run: `docker compose config --quiet`, then `docker compose up -d --build`.

Expected: `docker compose ps` shows both services healthy.

Run: `curl.exe http://localhost:5000/api/system/info`

Expected: valid product metadata with `initialized: false`.

- [ ] **Step 6: Verify persistence across restart**

Bootstrap the test organization, create one order and upload one file, then run `docker compose restart`.

Expected: login, order, server ID, and uploaded file remain available.

- [ ] **Step 7: Commit container packaging**

```bash
git add backend/Dockerfile backend/.dockerignore backend/package.json backend/package-lock.json compose.yaml .env.example .gitignore
git commit -m "build(deploy): add self-hosted Docker Compose package"
```

### Task 10: Add backup and restore operations

**Files:**

- Create: `deploy/backup.ps1`
- Create: `deploy/restore.ps1`
- Create: `backend/scripts/checkpoint-agent-db.js`
- Modify: `backend/package.json`

- [ ] **Step 1: Add an AI database checkpoint command**

Create `backend/scripts/checkpoint-agent-db.js` that opens the existing Agent database, executes `PRAGMA wal_checkpoint(TRUNCATE)`, closes it, and prints `Agent database checkpoint complete`. Export or add a close function from `backend/db/agent.js` if required.

- [ ] **Step 2: Implement timestamped backup**

`deploy/backup.ps1` accepts `-OutputDirectory`, resolves it, creates one timestamped directory, and performs:

1. Resolve the explicit deployment directory and Compose project name; acquire an operation lock shared with restore/upgrade. Record whether the app was running and refuse competing operations.
2. Record metadata; stop the app and drain requests within the documented timeout. Keep it stopped throughout all snapshots.
3. Run a one-shot container against the stopped app's DATA_DIR to checkpoint SQLite; preserve the whole database directory including any WAL files if checkpoint fails, mark the backup failed, and never label a partial backup successful.
4. Run `pg_dump -Fc` inside the database container to a container-local file, then use `docker cp` to obtain `database.dump`. Avoid PowerShell text redirection of binary dumps.
5. Archive `runtime/data` and `runtime/uploads` through a helper container that can read their UID-owned files; do not copy live PostgreSQL data directories.
6. Write `manifest.json` with serverId, API/store schema versions, app image digest, PostgreSQL major, UTC timestamp, collection counts, hashes, encryption-key identifier (not the key) and storage mode.
7. Verify dump listing, archive contents and hashes. Keep incomplete backups marked as incomplete for diagnosis, rather than deleting the only copy on failure.
8. In `finally`, restart the app only if it was running beforehand and no restore is in progress; release the operation lock. A failed readiness check returns nonzero.

Deploy the same cold-backup sequence as `deploy/backup.sh` and `deploy/restore.sh` for Linux. PowerShell wrappers use PowerShell 7 with explicit native command exit-code checks. Provide an OS scheduler example for daily backups and retain at least the latest verified copy before pruning older backups. Encrypt/off-machine protect backups and keep `.env` / AGENT_KEY_ENC_SECRET in a separate restricted recovery bundle. Losing that encryption key makes restored AI credentials unreadable; CSV exports do not replace this backup.

Use PowerShell cmdlets with `-LiteralPath`; verify every resolved output path remains inside the supplied output directory before removing an incomplete backup.

- [ ] **Step 3: Implement guarded restore**

Both restore scripts require an explicit backup, deployment directory, Compose project and confirmed backup serverId. Inspect the target before mutation: for a populated target also require its current serverId and a verified pre-restore backup; allow empty-host recovery as a separate explicit mode. Check image/schema/PostgreSQL compatibility and required secret bundle. Reject archive absolute paths, traversal, unexpected symlinks and bad hashes before extraction. Stage file restoration into a new sibling directory and restore the dump into an isolated database first; verify counts and SQLite integrity. Only switch the stopped app to the restored database and directories after all checks pass. Preserve the prior database/directories until login and file validation succeed. On failure remain stopped or return to the verified prior state, never start a database/files mixture. Preserve the backup serverId; record an explicit auth-token invalidation step for the restored environment.

- [ ] **Step 4: Run a destructive-data recovery rehearsal on test data**

Run from the disposable deployment: `pwsh -File deploy/backup.ps1 -DeploymentDirectory . -ProjectName manage3d-acceptance -OutputDirectory .backups`

Expected: a timestamped backup contains `database.dump`, `files.tar.gz`, and `manifest.json` with valid hashes. Linux equivalent: `sh deploy/backup.sh --deployment-dir . --project-name manage3d-acceptance --output-dir .backups` in the same disposable deployment.

Delete one test order through the API, then restore using the test server ID.

Expected: the deleted test order, uploaded file hash, AI conversation and an encrypted AI-key decryption check are restored. Also rehearse restoration onto a completely empty deployment with the separate secret bundle; wrong key, corrupt dump or archive traversal must fail before target mutation. Use stubbed AI services for decryption verification, not paid external requests. Perform this only against the temporary Compose deployment created in Task 9.

- [ ] **Step 5: Commit operational scripts**

```bash
git add deploy/backup.ps1 deploy/restore.ps1 backend/scripts/checkpoint-agent-db.js backend/db/agent.js backend/package.json
git commit -m "feat(ops): add verified backup and restore scripts"
```

### Task 11: Create customer deployment and operations documentation

**Files:**

- Create: `docs/SELF_HOSTING.md`
- Create: `docs/UPGRADE.md`
- Create: `docs/BACKUP_RESTORE.md`
- Modify: `README.md`
- Modify: `backend/README.md`

- [ ] **Step 1: Write the quick-start deployment guide**

`docs/SELF_HOSTING.md` must contain exact prerequisites, configuration, firewall port, HTTPS recommendation, Docker commands, first Owner initialization, Staff creation, server address examples, persistence locations, health checks, shutdown, and log commands.

Include this minimum command sequence:

```powershell
node deploy/init-config.mjs
docker compose up -d --build
docker compose ps
curl.exe http://localhost:5000/api/system/info
docker compose logs -f app
```

Explain that deleting `runtime/` deletes customer data and is never part of an upgrade.

- [ ] **Step 2: Write the upgrade runbook**

`docs/UPGRADE.md` must require a successful backup, record the current version, pull or replace package files without overwriting `.env` and `runtime/`, rebuild, wait for health, verify server ID, run smoke checks, and describe rollback to the previous image plus backup restore.

- [ ] **Step 3: Write backup and recovery documentation**

`docs/BACKUP_RESTORE.md` documents backup contents, retention recommendation, off-machine copy, commands, server ID guard, test-recovery procedure, and recovery evidence to record. State clearly that a backup is untrusted until a restoration rehearsal succeeds.

- [ ] **Step 4: Update project READMEs**

Lead the root README with the two-part delivery model: installable client and self-hosted backend. Remove default production login instructions. Link the three operations documents and distinguish development startup from customer deployment.

- [ ] **Step 5: Check commands and links**

Run every read-only command shown in the docs against the temporary Compose deployment. Run:

```powershell
rg -n "Admin123456|dev-secret|TODO|TBD" README.md backend/README.md docs/SELF_HOSTING.md docs/UPGRADE.md docs/BACKUP_RESTORE.md
```

Expected: no default credential, placeholder, or unfinished-instruction matches.

- [ ] **Step 6: Commit customer documentation**

```bash
git add README.md backend/README.md docs/SELF_HOSTING.md docs/UPGRADE.md docs/BACKUP_RESTORE.md
git commit -m "docs: add self-hosting operations guides"
```

### Task 12: Produce and verify the first distributable Android build

**Files:**

- Modify: `app.json`
- Modify: `eas.json`
- Modify: `package.json`
- Create: `docs/RELEASE_CHECKLIST.md`
- Modify: `backend/scripts/verify-self-hosted.js`

- [ ] **Step 1: Finalize application identity and build profiles**

Retain the existing application identifier until release ownership is confirmed; do not invent a new reverse-domain identifier from an account name. Record the chosen package ID, signing-key custodian, EAS project ownership and version policy before the first external release. Changing an already-distributed package ID prevents in-place upgrades. Define:

- `preview`: internal signed APK for acceptance testing.
- `production`: signed APK with auto-incremented build number for direct customer download; AAB is an optional store-distribution profile, not the installable deliverable.

Set `android.buildType: "apk"` and `developmentClient: false` explicitly for the distributable profiles. Pin eas-cli as a tested development dependency so package scripts do not rely on an uninstalled global executable. Register SecureStore's Expo config plugin where required and verify an actual standalone build, not only Expo Go.

Add scripts:

```json
{
  "build:android:preview": "eas build --platform android --profile preview",
  "build:android:production": "eas build --platform android --profile production",
  "verify:release": "node --test tests/client/server-lifecycle.test.cjs && npm --prefix backend run verify:runtime && npm run verify:backend && npm --prefix backend run verify:self-hosted && npx expo export --platform web --output-dir .tmp/release-web"
}
```

- [ ] **Step 2: Extend the end-to-end self-hosted verification**

Make `verify-self-hosted.js` cover this final sequence:

1. Metadata before initialization.
2. Owner bootstrap exactly once.
3. Owner creates Staff and Viewer.
4. Staff can create an order.
5. Viewer cannot create through normal or Agent APIs.
6. Forged audit actor is ignored.
7. Request-supplied OSS credentials are rejected.
8. Metadata preserves server ID and reports initialization.

- [ ] **Step 3: Create the release checklist**

`docs/RELEASE_CHECKLIST.md` contains checkboxes for clean verification, Compose build, fresh bootstrap, persistence restart, backup restore rehearsal, Viewer permissions, Staff workflow, secret scan, Android installation, HTTP LAN test, HTTPS domain test, version compatibility, and artifact SHA-256 recording.

- [ ] **Step 4: Run automated release verification**

Run: `npm run verify:release`

Expected: client lifecycle, runtime configuration and both backend suites pass, then Expo Web export completes. PostgreSQL/Compose, restore and physical-device checks remain separate required release evidence.

Run:

```powershell
rg -n "Admin123456|dev-secret-change-me|secretAccessKey|accessKeySecret" App.js screens context utils backend -g "*.js"
```

Expected: no client-side storage credential matches and no production default credential values. Treat server-side credential field names, explicit rejection schemas and non-production test fixtures as expected matches requiring inspection; this grep is not by itself a passing security test.

- [ ] **Step 5: Build and install the preview APK**

Run: `npm run build:android:preview`

Expected: the build produces a standalone signed APK. EAS credentials and a physical test device are external release prerequisites; if unavailable, record the exact unverified release items and continue independent local verification without claiming the phase is complete. Test on a device with Metro and the development PC frontend server shut down, over both LAN HTTP and trusted HTTPS. Never disable certificate validation to pass a self-signed certificate test.

- [ ] **Step 6: Record the release artifact**

Record app version, build number, build URL, APK SHA-256, backend image tag, Git commit, test server version, and checklist date in the release checklist. Do not commit signing credentials or downloaded private artifacts.

- [ ] **Step 7: Commit release configuration**

```bash
git add app.json eas.json package.json backend/scripts/verify-self-hosted.js docs/RELEASE_CHECKLIST.md
git commit -m "build(release): prepare self-hosted preview distribution"
```

## 审查补充任务（对应主任务的必需验收项）

### R1：初始化、账号恢复与测试依赖（Task 1–3）

**补充文件：** `backend/utils/authTokens.js`、`backend/middleware/auth.js`、`backend/routes/system.js`、`backend/routes/users.js`、`backend/scripts/reset-owner-password.js`、`backend/scripts/verify-self-hosted.js`、`backend/scripts/verify-api.js`、`start-project.ps1`。

- [ ] 在发起监听前等待环境校验、数据库迁移与存储初始化完成；失败退出非零，不得启动一个始终返回 OK 的服务。迁移版本比当前程序更新时拒绝启动，避免旧程序覆盖新数据。
- [ ] Task 1 测试旧 schemaVersion=1 数据（含 Owner）、空数据、无 Owner 的异常用户数据；跨子进程重启检查 serverId，验证生成 ID 的迁移真正写入文件/数据库。
- [ ] Task 2 的所有 JWT 新用户都设置 tokenVersion=1；JWT 校验明确允许 HS256，签发与校验约定 issuer/audience 为本实例和 API；`/auth/me` 复用统一认证路径。旧无版本 token 必须失效并要求重新登录。
- [ ] 在 Task 2 中完成最小 Owner 创建用户 API 及 verify-api 迁移，Task 3 扩展列表/启停/重置/改角色。每个提交均须能跑通当时的两套后端验证，不能依赖未来任务补救。
- [ ] 采用可配置的登录与初始化限流：同来源短窗口失败达到上限返回 429；代理来源仅信任已配置代理。测试使用可调小阈值，避免等待真实长窗口；限制只在内存中用于本阶段单进程部署，并写明重启后计数重置。
- [ ] 验证没有初始化口令无法抢占管理员；旧 token 在改密码、停用和角色变化后立即失效，重新启用也不恢复旧 token；响应和审计中没有密码/hash/口令。
- [ ] 为遗失 Owner 密码提供主机控制台恢复；已有用户但无 Owner 时只能通过具有服务器访问权限的显式恢复操作修复，默认拒绝自动提升任意账号。
- [ ] 更新本地启动脚本，移除默认管理员宣传及静态开发 JWT 密钥；开发与测试也必须显式提供密钥或通过仅开发模式配置生成器生成，不能因删掉 auth fallback 而导致 `npm run start:all` 失效。
- [ ] 测试清理先关闭 HTTP/活动 SSE、PostgreSQL pool 及 SQLite 后再释放临时目录，避免 Windows 文件占用。校验临时路径是本次创建且位于测试临时根目录内，不能扩大删除范围。测试使用独立进程加载环境配置，防止 require 缓存复用另一套 DATA_DIR。

### R2：AI、权限界面与文件授权（Task 4–5）

**补充文件：** `backend/services/orderCreation.js`、`backend/agent/orchestrator.js`、`backend/agent/tools/index.js`、`backend/agent/tools/orders.js`、`backend/routes/files.js`、`backend/routes/oss.js`、`backend/config/storage.js`、`utils/permissions.js`、`components/agent/DraftConfirmCard.js`、`screens/{Home,Orders,OrderDetail,Models,ModelDetail,Materials,MaterialDetail,AgentChat,Settings}Screen.js`、`navigation/AppNavigator.js`。

- [ ] 抽出最小普通/AI 共用订单创建服务，统一 nextId、客户/订单行字段与审计，不把用户确认卡片作为服务端授权依据。为现有 Agent 工具声明允许角色，未知权限默认拒绝。
- [ ] 在前端用统一 canWrite/canManage/canExport 判断控制创建、编辑、删除、导入、导出、库存、用户管理和 AI 确认入口；Viewer 不得跳入写入页面。前端隐藏与后端 403 都要验证。
- [ ] 文件路由默认保护图片和附件，移除“按图片扩展名匿名放行”；测试现有模型预览在登录后仍能显示、退出后新请求返回 401。签名下载只允许当前有权读的已登记业务文件。
- [ ] OSS 上传签名必须由后端生成新对象键并验证其业务对象/上传用途；拒绝任意覆盖已存在对象。完成上传先核实待上传记录、大小、类型和归属再登记。未启用 OSS 时返回明确不可用错误；不接受请求注入存储 endpoint 或 credential。
- [ ] 收紧本地路径判断，使用 path.relative 确认目标不逃出 UPLOAD_DIR，避免 startsWith 将相邻同名前缀目录误判为内部路径；补目录穿越/兄弟目录用例。
- [ ] 下载与图片请求仅在目标为当前 API origin 时附带 JWT；外部 URL/对象存储短签名 URL 不附带 JWT，不允许自动跳转到外部 origin 时携带账号凭证。匿名候选服务器探测永远不发送旧令牌。
- [ ] 旧 `ossConfig` 只做一次删除迁移，不能自动把旧 Secret 上传到新服务器。AI 用户自带 Key 暂保留服务端加密保存；说明启用外部 AI 时所选对话/业务信息会发送给用户配置的模型提供方，自托管不等于没有外部网络请求。

### R3：运行时客户端、请求竞态与文件清理（Task 6–8）

**新增文件：** `utils/serverRuntime.js`（无 React 依赖的当前服务器快照与 epoch）、`utils/requestRegistry.js`（fetch/SSE/上传下载取消句柄）、`utils/sessionFiles.js`（仅管理 App 临时文件）、`utils/nativeDownload.js`、`tests/client/server-lifecycle.test.cjs`。

**补充修改：** `constants/index.js`、`utils/{api,agentApi,storage,upload}.js`、`screens/{Models,ModelDetail,CreateModel,CreateOrder,DataImport,AgentChat}Screen.js`、`components/agent/{sseClient,ImageAttachment}.js`、`context/{ServerConfig,Auth}Context.js`、`App.js`、根 `package.json` 和锁文件。

- [ ] ServerConfigProvider 负责读写设备配置和更新 serverRuntime；API 模块只读运行时快照，不反向调用 React hook，不与 AuthProvider 形成循环依赖。运行时快照包含 `{apiBaseUrl, serverId, serverKey, sessionEpoch}`；provider 持久化的仅为服务器元数据，sessionEpoch 不属于长期配置。
- [ ] URL 统一规范化：显式 http/https、IP/域名、1–65535 端口；禁止 userinfo/query/hash 和其他 scheme。支持根路径或 `/api`，本阶段拒绝任意反向代理子路径并给出原因。IPv6 用括号形式；缺省协议域名用 HTTPS，私网 IP 可显式确认 HTTP。相同 URL 的大小写/尾斜线形式只生成一个规范值。
- [ ] 不再以 localhost 为正式安装包静默默认值。开发环境变量只预填服务器输入框，仍需探测。手机上的 localhost 指手机自身，连接开发机须填开发机局域网地址。
- [ ] 候选探测失败、初始化未完成、服务端 503 和 API 版本不兼容都必须结束 loading；启动阶段没有 server 时 AuthProvider 不读旧 token。bootstrap 超时后重新读取 initialized，允许登录，不盲目重发创建。
- [ ] 对 GET 设置超时与手动重试；业务 POST、bootstrap、AI confirm、上传超时标记结果未知，不做自动重试。取消客户端请求不代表服务端事务回滚，提示用户刷新核实。
- [ ] 用可控延迟 fetch、SSE 假实现和内存存储编写自动化测试，执行 `node --test tests/client/server-lifecycle.test.cjs`：旧 A 登录成功延迟返回不得把 token 写入 B；A 的旧 401 不得清理 B；切换期间 token 读取不得配上另一服务器 URL；保存配置失败不得恢复旧登录；伪造同一 serverId 的 B 不得收到 A token；无服务器启动不得永久 loading。
- [ ] 登出清理失败或清理中杀进程时，下次启动不能自动读取遗留 token 登录。先持久化 `sessionCleanupPending` 标记，再清凭证与临时文件，成功后删除标记；启动发现标记先执行清理。连标记都无法写入时显示清理失败并保持进程内退出，不能承诺重启安全或静默继续切换。补存储故障和杀进程恢复用例。
- [ ] 补充所有图片/文件 URL 构造点，包括 ModelsScreen 与 ModelDetailScreen 的局部 helper。执行 `rg -n 'API_CONFIG.BASE_URL' screens components context utils`；预期业务请求不再使用静态地址。
- [ ] 使用 Expo 54 对应 FileSystem API。现有 `readAsStringAsync` 等旧方法如继续保留，要从 `expo-file-system/legacy` 导入；不可假设当前顶层导出在独立 App 中仍可调用。新增模块选择后在真机验证读取和删除。
- [ ] DocumentPicker 产生的缓存副本登记进 sessionFiles；只删除经确认属于 App 缓存目录的文件，不删除用户原始源文件或整个设备目录。注销/切换先取消操作再删除，程序异常退出后下次启动也清理已登记遗留文件。销毁 Web blob URL，API/敏感图片响应用 no-store；系统或浏览器管理的不可控副本不能承诺安全擦除。
- [ ] 当前 `downloadProtectedFile` 仅依赖 window.document，Android 无法完成下载。补原生鉴权下载至 App 临时目录，再通过系统导出/分享让用户明确保存；使用 Expo 兼容依赖并更新锁文件。用户导出副本保留；任务取消和退出清除 App 副本，真机断网时不能留下成功提示。
- [ ] 明确 Web token 存储不是 SecureStore：首版 Web 验证采用 sessionStorage（按标签页），Native 使用 SecureStore。不要持久化密码或业务列表；同设备退出登录后无旧用户数据。只有通过真机/浏览器验收才能声称临时文件清理已完成。

### R4：迁移、容器与 HTTPS（Task 9）

**新增文件：** `backend/scripts/migrate-file-to-postgres.js`、`backend/scripts/verify-postgres.js`、`backend/scripts/verify-runtime.js`、`deploy/init-config.mjs`、`compose.https.yaml`、`deploy/Caddyfile`、`backend/scripts/healthcheck.js`。

- [ ] 新增 `verify:postgres` 和 `verify:runtime` 脚本。PostgreSQL 验证使用单独测试数据库/Compose project，断言事务失败回滚、并发初始化只有一个 Owner、重启 serverId 稳定。runtime 验证在 Node 子进程中确认缺失密钥、CHANGE_ME_、无效端口、未知 driver、启用 AI 却缺密钥时非零退出。
- [ ] 实现 `node backend/scripts/migrate-file-to-postgres.js --source ABSOLUTE_STORE_JSON --dry-run`；报告 schema/集合数量/引用异常。正式迁移要求暂停写入、源备份、空目标 PostgreSQL；禁止合并覆盖现有目标。迁移保留 ID、hash、时间戳及新迁移 serverId，失败回滚，源文件只读。文件目录和 AI SQLite 随同复制并校验 hash；正常登录、订单查询、附件和 AI 数据均需核对。
- [ ] 为启动服务提供显式 async start/shutdown。SIGTERM 停止接新请求、终止/收尾 SSE、等待 writeQueue、关闭 HTTP、PostgreSQL pool 和 SQLite；超过停机时限非零退出并记录。不能再打印 graceful 后直接 process.exit(0)。备份只能在 app 确实停止后开始。
- [ ] 建立 CPU/内存/磁盘最低配置的实测记录，覆盖 500 MB 内存上传现有上限和并发行为；通过可配置上传大小/并发限制防止默认容器在常规操作时 OOM。不凭经验写下未经验证的最低内存保证。
- [ ] `compose.https.yaml` 增加反向代理与证书卷，文档写明域名 DNS、80/443、防火墙和自动续期；代理上传上限与后台一致，SSE 不缓存。HTTPS 模式 app 端口不直接暴露公网。HTTP 仅局域网测试；HTTPS Web 页面连接 HTTP API 的浏览器混合内容限制要说明，不能归咎 CORS。
- [ ] CORS 仅列实际 Web origin（精确 scheme/host/port），Native 无 Origin 可正常访问；不因地址可配置而放开所有 Web origin。不允许跳过 TLS 证书校验；自签证书需系统信任后再试。
- [ ] 在 Linux x86_64 干净环境实测挂载写权限、容器重启、无外部 AI/OSS 时基础业务仍运行、3MF 预览降级、健康检查失败和日志轮转。未验证 ARM64 不标注通用架构支持。

### R5：可恢复交付与发布前提（Task 10–12）

**补充文件：** `deploy/{backup,restore}.sh`、`deploy/{backup,restore}.ps1`、`deploy/package-release.mjs`、`docs/{SELF_HOSTING,UPGRADE,BACKUP_RESTORE,RELEASE_CHECKLIST}.md`、`.gitignore`、`eas.json`、根 `package.json` / 锁文件。

- [ ] 完整备份范围为 PostgreSQL dump、整个 AI SQLite 目录、uploads、版本/校验 manifest；独立保管配置和解密密钥。默认本地文件卷才能标记基础恢复演练通过；若发布启用了 OSS，必须追加远端对象清单/版本与恢复步骤，否则明确远端对象不在本备份覆盖范围。
- [ ] Linux 是交付主环境，不能只交 PowerShell 运维脚本。PowerShell 与 shell 共享备份格式；测试中文文件名、非 ASCII 内容和二进制 dump，禁止通过文本管道转码。记录停机窗口，并让用户选择调度时间。
- [ ] 先做目标快照再恢复，校验备份与目标 ID 两个维度。全新服务器恢复不要求已有同一 serverId；复制实例并同时上线则属于克隆，要离线生成新身份并重新登录，不能把灾备恢复当作多服务器克隆。
- [ ] 升级记录旧镜像 digest/schema/配置，不覆盖 `.env`、runtime 或卷；保存两个可用版本。若新版本做了不兼容迁移，回退必须使用同一时间点数据库、文件和密钥，禁止只降容器镜像。
- [ ] 加入 `.tmp/`、`.backups/`、发布归档和 runtime 到忽略规则；配置生成器不得覆盖现有 `.env`。不要在项目真实 runtime 上执行“从空目录启动”和恢复演练；测试命令必须带专用 project name、端口和临时目录。
- [ ] 生成 `release-manifest.json`，包括 Git commit、客户端版本/签名证书指纹、后端镜像 tag/digest、API/schema/PostgreSQL 版本、文件 SHA-256 和支持平台。交付归档含 Compose、环境模板、脚本、客户文档、服务端源码/构建文件；排除真实密钥、客户数据、签名私钥、node_modules 和日志。提供构建模式，以及在有网络/凭证时取得已发布镜像的说明；未发布镜像时不得写不存在的下载地址。
- [ ] EAS project/account 与签名证书归发布方保管，不把开发者登录交给客户；客户部署后端不需要 Expo/EAS 账号。APK 发布前确认现有 package ID 是否已经对外分发；真机测从上一测试包覆盖安装后设置保留和数据隔离。AAB 只用于后续商店通道。
- [ ] CI/本地发布总入口串联客户端生命周期测试、运行时测试、两套后端测试和 Expo export；Compose/PostgreSQL、恢复、真机以单独命令/检查点记录结果。缺 Docker、EAS 凭证、证书域名或设备时标为“未验证”，不能将文档/编译通过算作交付通过。

### 验收证据矩阵

| 产品要求 | 对应任务 | 必须取得的证据 |
|---|---|---|
| 一套后端一个组织、合法 Owner | Task 1–3 / R1 | 迁移/并发 bootstrap/部署口令/账号生命周期自动化结果 |
| 首次连接与可恢复登录 | Task 6–7 / R3 | 无地址、失败、已初始化/未初始化、响应丢失的状态验证 |
| 换服务器不串账号 | Task 6–8 / R3 | 两服务器延迟响应、同 ID 不同 URL、401 及持久化失败测试 |
| 退出清理本地业务痕迹 | Task 8 / R3 | Native 临时文件检查、Web blob 释放、旧页面/SSE 消失 |
| Viewer 只读 | Task 3–5 / R2 | 普通写和 AI confirm 均 403，前端无写入口 |
| 私密文件可用且不泄漏令牌 | Task 5–8 / R2–R3 | 已登录图片显示、匿名文件拒绝、外链无 JWT、原生下载 |
| 新部署及旧数据迁移 | Task 9 / R4 | 干净 Linux 容器启动、卷权限、PostgreSQL 迁移与回滚 |
| 全部数据可恢复 | Task 10–11 / R5 | 空机恢复、坏包拒绝、文件 hash、AI 解密、旧目标保留 |
| 客户能实际安装与升级 | Task 12 / R5 | 独立签名 APK、无 Metro、LAN/HTTPS、覆盖安装、发布 manifest |

### 本次审查参考（核对日期：2026-09-08）

- [Node.js 官方版本生命周期](https://nodejs.org/en/about/previous-releases)：Node 20 已 EOL；采用受支持 LTS 并验证原生模块。
- [Docker Compose 环境变量插值](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)：`.env` 插值与容器 environment 是不同层，使用必需变量校验。
- [Expo Android APK 构建](https://docs.expo.dev/build-reference/apk/)：直接安装选择 APK profile，不能以 AAB 代替。
- [Expo SDK 54 FileSystem](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/)：核对原生文件操作与 legacy 方法入口。

## Final phase acceptance

- [ ] Complete R1–R5 and record evidence from every row in the acceptance matrix; unsupported or unavailable environments are explicitly unverified.

- [ ] Run `npm run verify:release` and retain the successful output.
- [ ] Run `docker compose -p manage3d-acceptance up -d --build` in a new disposable deployment directory with dedicated ports and volumes; do not empty the repository's real runtime directory.
- [ ] Complete one fresh Owner bootstrap and create one Staff and one Viewer.
- [ ] Verify Staff writes and Viewer read-only behavior through both normal UI and AI entry points.
- [ ] Restart Compose and confirm server ID, login, order, and file persistence.
- [ ] Complete a backup, mutate test data, restore, and confirm recovery.
- [ ] Install the preview APK on a physical device and connect using a runtime-entered endpoint.
- [ ] Complete every item in `docs/RELEASE_CHECKLIST.md` before labeling the phase deliverable.
