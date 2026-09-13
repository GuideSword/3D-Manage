# Protected Model Image Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render authenticated model images reliably in the model list and detail gallery while deleting app-owned image caches whenever the server or authenticated user changes.

**Architecture:** A focused loader converts a protected remote file URL into a renderable local resource: authenticated `expo-file-system` cache files on native and revocable blob URLs on web. A shared `ProtectedImage` component owns async/stale/error UI state, while existing session-file tracking performs logout and server-switch cleanup; sign-in invalidates the old session and clears tracked files before authenticating another user.

**Tech Stack:** React Native 0.81, Expo 54, `expo-file-system/legacy`, `expo-crypto`, Node test runner, Android/ADB verification.

---

## File structure

- Create `utils/protectedImage.js`: authenticated download, deterministic cache naming, in-flight deduplication, stale-session checks, and resource disposal/invalidation.
- Create `components/ProtectedImage.js`: reusable loading/fallback/error wrapper around React Native `Image`.
- Modify `components/index.js`: export the shared component.
- Modify `screens/ModelsScreen.js`: replace direct protected network image rendering.
- Modify `screens/ModelDetailScreen.js`: replace direct protected network image rendering.
- Modify `context/AuthContext.js`: invalidate old work and delete tracked cache files before every new sign-in.
- Create `tests/client/protected-image.test.cjs`: loader behavior and screen integration contract.
- Modify `tests/client/server-lifecycle.test.cjs`: sign-in cache-cleanup ordering contract.
- Modify `package.json`: include the new deterministic tests in `verify:client`.

### Task 1: Authenticated image loader

**Files:**
- Create: `utils/protectedImage.js`
- Test: `tests/client/protected-image.test.cjs`

- [ ] **Step 1: Write failing native loader tests**

Use the existing Babel/VM ESM harness pattern from `tests/client/server-lifecycle.test.cjs`. Mock `react-native`, `expo-crypto`, `expo-file-system/legacy`, `./api`, `./sessionFiles`, and `./serverRuntime`, then assert:

```js
const resource = await loader.loadProtectedImage('/api/files/models/1/cover.png', 'jwt');
assert.equal(download.options.headers.Authorization, 'Bearer jwt');
assert.equal(resource.source.uri, expectedCacheUri);
assert.equal(trackedUris.includes(expectedCacheUri), true);
```

Add separate tests that call the loader twice concurrently and expect one download, return a pre-existing cache file without downloading, and invalidate the runtime during download and expect temporary/final files to be deleted with `StaleSessionError` thrown.

- [ ] **Step 2: Run the loader tests and verify red**

Run: `node --test tests/client/protected-image.test.cjs`

Expected: FAIL because `utils/protectedImage.js` does not exist.

- [ ] **Step 3: Implement the loader**

Implement this public contract:

```js
export const loadProtectedImage = async (fileUrl, token) => ({
  source: { uri: 'file://...' },
  dispose: async () => undefined,
  invalidate: async () => FileSystem.deleteAsync('file://...', { idempotent: true }),
});
```

The native branch must:

```js
const remoteSource = buildProtectedFileSource(fileUrl, token);
const digest = await Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256,
  `${captured.serverKey}\n${remoteSource.uri}`
);
const destination = `${FileSystem.cacheDirectory}3d-manage-image-${digest}${extension}`;
await trackSessionFile(captured.serverKey, destination);
const result = await FileSystem.downloadAsync(remoteSource.uri, temporary, {
  headers: remoteSource.headers || {},
});
if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}`);
await FileSystem.moveAsync({ from: temporary, to: destination });
```

Check `isCurrentRuntime(captured)` after hashing, download, move, and tracking. Delete temporary/final output and throw `StaleSessionError` whenever the captured runtime is stale. Use a module-level `Map` keyed by server key plus URL so concurrent native callers share one promise. Cache hits require `getInfoAsync(destination)` to return `exists: true` and `size > 0`.

The web branch must `fetch` with `remoteSource.headers`, reject non-2xx responses, create an object URL from the response blob, re-check the runtime, and return `dispose`/`invalidate` functions that revoke that URL exactly once.

- [ ] **Step 4: Run loader tests and verify green**

Run: `node --test tests/client/protected-image.test.cjs`

Expected: all protected-image loader tests pass.

- [ ] **Step 5: Commit the loader**

```powershell
git add -- utils/protectedImage.js tests/client/protected-image.test.cjs
git commit -m "feat(client): cache authenticated model images"
```

### Task 2: Shared protected image component and screen adoption

**Files:**
- Create: `components/ProtectedImage.js`
- Modify: `components/index.js`
- Modify: `screens/ModelsScreen.js`
- Modify: `screens/ModelDetailScreen.js`
- Test: `tests/client/protected-image.test.cjs`

- [ ] **Step 1: Add a failing integration contract test**

Read the three source files and assert both screens import/use `ProtectedImage`, forward `fileUrl` and `token`, and no longer pass protected HTTP sources directly to React Native `Image`:

```js
assert.match(modelsScreen, /<ProtectedImage[\s\S]*fileUrl=\{preferredImage\?\.fileUrl\}[\s\S]*token=\{token\}/);
assert.match(detailScreen, /<ProtectedImage[\s\S]*fileUrl=\{image\.fileUrl\}[\s\S]*token=\{authToken\}/);
assert.match(componentIndex, /export \{ default as ProtectedImage \} from '\.\/ProtectedImage';/);
```

- [ ] **Step 2: Run the integration contract and verify red**

Run: `node --test tests/client/protected-image.test.cjs`

Expected: FAIL because the component is not exported or used.

- [ ] **Step 3: Implement `ProtectedImage`**

The component must expose this focused interface:

```js
const ProtectedImage = ({ fileUrl, token, fallback = null, onError, ...imageProps }) => {
  const [resource, setResource] = useState(null);
  const [failed, setFailed] = useState(false);
  // Effect loads fileUrl+token, ignores stale completion, and calls dispose on cleanup.
  // Native decode failure calls resource.invalidate(), reports onError, and shows fallback.
  return resource && !failed
    ? <Image {...imageProps} source={resource.source} onError={handleImageError} />
    : fallback;
};
```

Effect cleanup must dispose blob URLs, must not delete healthy native cache files, and must prevent an older async result from replacing a newer `fileUrl`.

- [ ] **Step 4: Replace both direct image paths**

In `ModelsScreen`, remove `Image`, `buildProtectedFileSource`, `buildImageSource`, and temporary `[DEBUG-model-image]` probes. Render:

```jsx
<ProtectedImage
  fileUrl={preferredImage?.fileUrl}
  token={token}
  style={styles.previewImage}
  resizeMode="cover"
  fallback={(
    <View style={styles.previewFallback}>
      <Ionicons name="cube-outline" size={isGrid ? 42 : 34} color={t.primary} />
    </View>
  )}
/>
```

In `ModelDetailScreen`, remove `Image`, `buildProtectedFileSource`, `buildAssetSource`, and temporary debug probes. Render each gallery item with:

```jsx
<ProtectedImage
  fileUrl={image.fileUrl}
  token={authToken}
  style={styles.galleryImage}
  resizeMode="cover"
  fallback={(
    <View style={styles.galleryFallback}>
      <Ionicons name="image-outline" size={36} color={colors.textTertiary} />
    </View>
  )}
/>
```

- [ ] **Step 5: Run integration and loader tests**

Run: `node --test tests/client/protected-image.test.cjs`

Expected: all tests pass and `rg -n "DEBUG-model-image" screens components utils` produces no matches.

- [ ] **Step 6: Commit the component adoption**

```powershell
git add -- components/ProtectedImage.js components/index.js screens/ModelsScreen.js screens/ModelDetailScreen.js tests/client/protected-image.test.cjs
git commit -m "fix(client): render protected model images from cache"
```

### Task 3: User-change cache invalidation

**Files:**
- Modify: `context/AuthContext.js`
- Modify: `tests/client/server-lifecycle.test.cjs`

- [ ] **Step 1: Add the failing sign-in lifecycle contract**

Assert that `signIn` captures the configured `serverKey`, invalidates outstanding work, clears tracked files, and only then calls login:

```js
const signInBody = authContext.match(/const signIn[\s\S]*?\}, \[server\?\.serverKey\]\);/)[0];
assert.ok(signInBody.indexOf('beginSessionInvalidation()') < signInBody.indexOf('clearTrackedFiles(serverKey)'));
assert.ok(signInBody.indexOf('clearTrackedFiles(serverKey)') < signInBody.indexOf('authAPI.login(credentials)'));
```

Keep the existing runtime tests proving `replaceServer`, `clearServer`, and `signOut` invoke `clearSessionSafely`, whose `clearSession` calls `clearTrackedFiles`.

- [ ] **Step 2: Run lifecycle tests and verify red**

Run: `node --test tests/client/server-lifecycle.test.cjs`

Expected: FAIL because sign-in does not clear tracked files.

- [ ] **Step 3: Clear cache before authenticating**

Update `AuthContext`:

```js
import { clearSessionSafely, clearTrackedFiles } from '../utils/sessionStorage';

const signIn = useCallback(async (credentials) => {
  const serverKey = server?.serverKey;
  beginSessionInvalidation();
  if (serverKey) await clearTrackedFiles(serverKey);
  const result = await authAPI.login(credentials);
  setUser(result.user || null);
  return result;
}, [server?.serverKey]);
```

If cleanup fails, login must not start, so cached bytes from a previous user cannot be shown to a new user.

- [ ] **Step 4: Run lifecycle tests and verify green**

Run: `node --test tests/client/server-lifecycle.test.cjs`

Expected: all lifecycle tests pass.

- [ ] **Step 5: Commit lifecycle cleanup**

```powershell
git add -- context/AuthContext.js tests/client/server-lifecycle.test.cjs
git commit -m "fix(client): clear image cache before sign in"
```

### Task 4: Full verification and cleanup

**Files:**
- Modify: `package.json`
- Verify: Android emulator and Expo web export

- [ ] **Step 1: Add deterministic tests to client verification**

Set the script to:

```json
"verify:client": "node utils/serverAddress.verify.js && node --test tests/client/server-lifecycle.test.cjs tests/client/navigation-route-observer.test.cjs tests/client/protected-image.test.cjs"
```

- [ ] **Step 2: Run client verification**

Run: `npm run verify:client`

Expected: all address, lifecycle, navigation, and protected-image tests pass.

- [ ] **Step 3: Produce a fresh web export**

Run: `npx expo export --platform web --output-dir .tmp/release-web`

Expected: Metro export completes without module-resolution or syntax errors.

- [ ] **Step 4: Re-run the original Android repro**

Reload `exp://192.168.3.43:8081`, open the Models tab, and verify the cover displays. Open the model detail and verify both gallery images display. Navigate Home → Models twice to exercise cache reuse.

Capture a screenshot to `.tmp/model-images-fixed.png` and verify:

```powershell
adb -s emulator-5558 logcat -d -v brief | Select-String -Pattern '401|DEBUG-model-image'
```

Expected: no model-image 401 and no temporary debug instrumentation output.

- [ ] **Step 5: Check scope and commit verification wiring**

Run:

```powershell
git diff --check
git status --short
```

Confirm only planned files are staged for this task and preserve all unrelated user changes. Then:

```powershell
git add -- package.json
git commit -m "test(client): verify protected image loading"
```
