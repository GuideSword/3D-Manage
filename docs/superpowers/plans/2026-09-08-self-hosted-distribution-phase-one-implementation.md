# Self-Hosted Distribution Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an installable client that connects at runtime to a customer-owned, single-organization backend distributed through Docker Compose, with safe first-run initialization, account isolation, server-side secrets, persistent storage, and verified backup/restore.

**Architecture:** Add a public server metadata and one-time bootstrap protocol to the Express backend. Add a device-scoped server configuration provider above authentication so every API and file request resolves its base URL at runtime. Package the backend, PostgreSQL, persistent file directories, health checks, and operational scripts as one self-hosted deployment while retaining the current document store for this phase.

**Tech Stack:** Expo 54, React Native 0.81, React Navigation 7, Expo SecureStore, Node.js 20, Express 5, Zod, JWT, PostgreSQL, Docker Compose, PowerShell, Node integration verification.

---

## Locked scope and file map

The companion design is `docs/superpowers/specs/2026-09-08-self-hosted-distribution-phase-one-design.md`.

New frontend units:

- `context/ServerConfigContext.js`: owns the active server, connection state, metadata, and safe replacement flow.
- `utils/serverConfig.js`: normalizes server input and persists device-scoped configuration.
- `utils/sessionStorage.js`: namespaces tokens by server ID and clears account-scoped data.
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
  const missing = required.filter((key) => !process.env[key] || process.env[key].length < 32);
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

Import `randomUUID` from `node:crypto` in `backend/utils/store.js`, raise `schemaVersion` to `2`, and make `ensureCollections` install this shape without changing an existing `serverId`:

```js
if (!data.system) {
  data.system = {
    serverId: randomUUID(),
    organizationName: '',
    initializedAt: null,
  };
}
```

Add `system` to `DEFAULT_DATA`. Do not add it to `COLLECTION_KEYS` because it is an object.

- [ ] **Step 5: Add the public information endpoint**

Create `backend/routes/system.js` with `GET /info`. Read the store with `{ write: false }` and return:

```js
{
  product: PRODUCT_NAME,
  serverId: data.system.serverId,
  organizationName: data.system.organizationName,
  initialized: Boolean(data.system.initializedAt && data.users.length),
  apiVersion: API_VERSION,
  serverVersion: SERVER_VERSION,
  capabilities: {
    agent: true,
    objectStorage: Boolean(process.env.OSS_BUCKET),
    selfHosted: true,
  },
}
```

Mount it with `app.use('/api/system', require('./routes/system'))`.

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
  headers: { 'Content-Type': 'application/json' },
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
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    organizationName: 'Attacker',
    ownerName: 'Second Owner',
    email: 'second@example.com',
    password: 'OwnerPassword123!',
  }),
});
assert.equal(repeatedBootstrap.status, 409);
```

Also assert that anonymous `POST /api/auth/register` returns `404` or `405`.

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

Define a Zod schema in `backend/routes/system.js` requiring a non-empty organization and owner name, normalized email, and a 12-character password. In one `withData` mutation:

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

Update `verify-api.js` to call `/api/system/bootstrap` before login instead of relying on `admin@example.com / Admin123456`.

- [ ] **Step 6: Verify initialization and regression behavior**

Run: `npm --prefix backend run verify:self-hosted`

Expected: bootstrap succeeds once and the second attempt returns 409.

Run: `npm run verify:backend`

Expected: `API verification passed`.

- [ ] **Step 7: Commit bootstrap**

```bash
git add backend/utils/validation.js backend/utils/authTokens.js backend/routes/system.js backend/routes/auth.js backend/middleware/auth.js backend/scripts/verify-self-hosted.js backend/scripts/verify-api.js
git commit -m "feat(auth): add one-time owner bootstrap"
```

### Task 3: Add Owner-managed Staff and Viewer accounts

**Files:**

- Create: `backend/routes/users.js`
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

- [ ] **Step 2: Run the test and confirm `/api/users` is missing**

Run: `npm --prefix backend run verify:self-hosted`

Expected: FAIL with 404 for `/api/users`.

- [ ] **Step 3: Implement Owner-only user endpoints**

Create `backend/routes/users.js` guarded by `router.use(requireRoles('owner'))` and provide:

- `GET /`: public user fields only.
- `POST /`: create only `staff` or `viewer`, reject duplicate normalized email.
- `PATCH /:id`: update name, role, or active status; prevent an Owner from deactivating or demoting themselves.
- `POST /:id/reset-password`: hash a new password and increment the user's `tokenVersion`.

Add `tokenVersion: 1` when bootstrap and account creation create users. Include `ver: user.tokenVersion` in issued JWTs, and make authentication reject a token whose `ver` differs from the stored user. Every mutation writes an audit record using `req.user.id`. Mount the router at `/api/users`.

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
- Test: `backend/scripts/verify-self-hosted.js`

- [ ] **Step 1: Add failing Viewer and actor identity tests**

Create a Viewer with the Owner API, log in as Viewer, and assert `POST /api/agent/drafts/confirm` returns 403. Submit a Staff inventory transaction with `actorId: 'forged-user'`, then read the persisted store and assert both the transaction and audit log use the authenticated Staff ID.

Also PATCH an order with `{ "status": "completed" }` through `/api/orders/:id` and assert it returns 400 with code `STATUS_REQUIRES_TRANSITION_ENDPOINT`.

- [ ] **Step 2: Run the suite and observe the bypasses**

Run: `npm --prefix backend run verify:self-hosted`

Expected: FAIL because Viewer can confirm an AI draft, inventory accepts a forged actor, or generic order update accepts status.

- [ ] **Step 3: Apply role checks to AI writes**

Keep conversation reads under `requireAuth`, but add `requireRoles('owner', 'staff')` directly to `/drafts/confirm`. Pass `{ userId, role }` into AI tool dispatch and require each future write tool to declare allowed roles before execution.

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
const clampExpiry = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};
```

Use a maximum of 600 seconds for upload and 3600 seconds for download.

- [ ] **Step 4: Remove the client credential screen and stored value**

Remove the OSS settings route and Settings entry. During ServerConfigProvider initialization, delete the legacy `ossConfig` key once. The client must never send OSS credentials.

- [ ] **Step 5: Verify secrets and frontend compilation**

Run: `npm --prefix backend run verify:self-hosted`

Expected: request credential injection is rejected and role checks pass.

Run: `rg -n "secretAccessKey|accessKeySecret|ossConfig" screens context utils`

Expected: no matches.

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
const tokenKey = (serverId) => `jwtToken.v1.${serverId}`;

export const getToken = (serverId) => storage.getItem(tokenKey(serverId));
export const setToken = (serverId, token) => storage.setItem(tokenKey(serverId), token);
export const clearSession = async (serverId) => {
  await storage.deleteItem(tokenKey(serverId));
  await storage.deleteItem(`drafts.v1.${serverId}`);
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

Refactor `apiRequest`, protected downloads, and Agent SSE to receive or retrieve the active server at request time. Do not import a module-time `API_CONFIG.BASE_URL`. Use the matching server ID to retrieve the JWT.

Update AuthProvider to initialize only after ServerConfigProvider has loaded and to clear user state whenever `server.serverId` changes.

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
  bootstrap: async (payload) => apiRequest('/system/bootstrap', {
    method: 'POST',
    auth: false,
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

Collect organization name, owner name, email, password, and password confirmation. Require 12 characters and matching confirmation. Call bootstrap, save the returned JWT under the returned server ID, refresh metadata, and enter the authenticated application.

- [ ] **Step 5: Replace the root navigation state machine**

Render exactly one branch:

```jsx
if (serverInitializing || authInitializing) return <LoadingScreen />;
if (!server) return <ServerSetupScreen />;
if (connectionError) return <ServerConnectionErrorScreen />;
if (!server.initialized) return <BootstrapOwnerScreen />;
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

AuthProvider `signOut` calls `clearSession(server.serverId)`, clears the user, and increments a `sessionEpoch`. Key authenticated screen trees by `sessionEpoch` so component state unmounts immediately.

- [ ] **Step 3: Add the replacement transaction**

`replaceServer(candidate)` follows this order:

1. Normalize and probe candidate.
2. If probe fails, return error without mutation.
3. Clear the old server session.
4. Persist candidate metadata.
5. Clear in-memory user and navigation state.

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

Use Node 20 Bookworm Slim so `better-sqlite3` has a compatible runtime:

```dockerfile
FROM node:20-bookworm-slim
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

Exclude `node_modules`, local `.env`, logs, `data`, and `uploads` in `backend/.dockerignore`.

- [ ] **Step 3: Create Compose services and persistent directories**

Create `compose.yaml` with:

- `db`: PostgreSQL 16, a named database, health check, and `./runtime/postgres:/var/lib/postgresql/data`.
- `app`: locally built backend, `STORE_DRIVER=postgres`, internal `DATABASE_URL`, runtime secrets, `./runtime/data:/app/data`, and `./runtime/uploads:/app/uploads`.
- App health check against `http://127.0.0.1:5000/api/system/info` so database availability is included.
- `depends_on.db.condition: service_healthy`.
- Restart policy `unless-stopped`.
- Port `${APP_PORT:-5000}:5000`.

Do not publish PostgreSQL to the host by default.

- [ ] **Step 4: Add a complete environment template**

Create `.env.example` with documented safe values and no real secrets:

```dotenv
APP_PORT=5000
POSTGRES_DB=manage3d
POSTGRES_USER=manage3d
POSTGRES_PASSWORD=CHANGE_ME_USE_LONG_RANDOM_DATABASE_PASSWORD
JWT_SECRET=CHANGE_ME_USE_32_RANDOM_CHARACTERS_MINIMUM
AGENT_KEY_ENC_SECRET=CHANGE_ME_USE_ANOTHER_32_RANDOM_CHARACTERS
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

Run: `Copy-Item .env.example .env`

Replace all values beginning with `CHANGE_ME_` with locally generated test secrets.

Run: `docker compose up -d --build`

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

1. Confirm `compose.yaml` and `.env` exist.
2. Read and record server metadata, then run the Agent database checkpoint inside the app container.
3. Stop only the app service so no business or AI write can begin during the snapshot.
4. Run `pg_dump` inside the database container to `database.sql`.
5. Archive `runtime/data` and `runtime/uploads` to `files.tar.gz`.
6. Write `manifest.json` with timestamp, server ID, server version, SHA-256 hashes, and filenames.
7. Restart the app in a `finally` block, including when backup creation fails.
8. Fail and remove only the incomplete timestamped backup directory when any step fails.

Use PowerShell cmdlets with `-LiteralPath`; verify every resolved output path remains inside the supplied output directory before removing an incomplete backup.

- [ ] **Step 3: Implement guarded restore**

`deploy/restore.ps1` accepts `-BackupDirectory` and mandatory `-ConfirmServerId`. It validates manifest hashes and refuses the restore unless `-ConfirmServerId` matches the server ID recorded in the backup manifest. It then stops the app, restores PostgreSQL, replaces only `runtime/data` and `runtime/uploads`, starts services, waits for health, and verifies that the restored server reports the manifest server ID.

- [ ] **Step 4: Run a destructive-data recovery rehearsal on test data**

Run: `powershell -ExecutionPolicy Bypass -File deploy/backup.ps1 -OutputDirectory .backups`

Expected: a timestamped backup contains `database.sql`, `files.tar.gz`, and `manifest.json` with valid hashes.

Delete one test order through the API, then restore using the test server ID.

Expected: the deleted test order and uploaded file are available again. Perform this only against the temporary Compose deployment created in Task 9.

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
Copy-Item .env.example .env
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

Change the Android package from the anonymous identifier to `com.guidesword.manage3d`, retain semantic app versioning, and define:

- `preview`: internal APK for customer acceptance testing.
- `production`: signed AAB with auto-incremented build number.

Add scripts:

```json
{
  "build:android:preview": "eas build --platform android --profile preview",
  "build:android:production": "eas build --platform android --profile production",
  "verify:release": "npm run verify:backend && npm --prefix backend run verify:self-hosted && npx expo export --platform web --output-dir .tmp/release-web"
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

Expected: both backend suites pass and Expo Web export completes.

Run:

```powershell
rg -n "Admin123456|dev-secret-change-me|secretAccessKey|accessKeySecret" App.js screens context utils backend -g "*.js"
```

Expected: no client-side storage credential matches and no production default credential matches. Test fixtures may use explicit non-production secrets inside verification scripts.

- [ ] **Step 5: Build and install the preview APK**

Run: `npm run build:android:preview`

Expected: EAS returns a successful build artifact. Install it on a physical Android device, connect once to a LAN HTTP deployment and once to an HTTPS test deployment, and complete the checklist.

- [ ] **Step 6: Record the release artifact**

Record app version, build number, build URL, APK SHA-256, backend image tag, Git commit, test server version, and checklist date in the release checklist. Do not commit signing credentials or downloaded private artifacts.

- [ ] **Step 7: Commit release configuration**

```bash
git add app.json eas.json package.json backend/scripts/verify-self-hosted.js docs/RELEASE_CHECKLIST.md
git commit -m "build(release): prepare self-hosted preview distribution"
```

## Final phase acceptance

- [ ] Run `npm run verify:release` and retain the successful output.
- [ ] Run `docker compose up -d --build` from an empty `runtime/` directory and confirm healthy services.
- [ ] Complete one fresh Owner bootstrap and create one Staff and one Viewer.
- [ ] Verify Staff writes and Viewer read-only behavior through both normal UI and AI entry points.
- [ ] Restart Compose and confirm server ID, login, order, and file persistence.
- [ ] Complete a backup, mutate test data, restore, and confirm recovery.
- [ ] Install the preview APK on a physical device and connect using a runtime-entered endpoint.
- [ ] Complete every item in `docs/RELEASE_CHECKLIST.md` before labeling the phase deliverable.
