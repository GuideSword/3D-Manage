# Navigation Readiness Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unsafe startup route read with a fail-closed observer that reads navigation state only after React Navigation reports readiness.

**Architecture:** Put readiness and subscription rules in a small CommonJS lifecycle module so they can be tested without mounting React Native. `App.js` initializes the active route to `null`, delegates route tracking to the observer, and retains the existing `isReady()` guard before navigation actions.

**Tech Stack:** Expo 54, React Native 0.81, React Navigation 7, JavaScript/CommonJS, Node.js built-in test runner.

---

### Task 1: Lock down the readiness lifecycle with a failing test

**Files:**
- Create: `tests/client/navigation-route-observer.test.cjs`

- [x] **Step 1: Write the observer lifecycle and App integration contract**

Create `tests/client/navigation-route-observer.test.cjs` with:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  subscribeToNavigationRoute,
} = require('../../utils/navigationRouteObserver.cjs');

const createNavigationRef = () => {
  const listeners = new Map();
  let ready = false;
  let routeName = null;
  let routeReads = 0;

  return {
    addListener(event, callback) {
      const callbacks = listeners.get(event) || new Set();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      return () => callbacks.delete(callback);
    },
    emit(event) {
      for (const callback of listeners.get(event) || []) callback();
    },
    getCurrentRoute() {
      routeReads += 1;
      if (!ready) throw new Error("The 'navigation' object hasn't been initialized yet");
      return routeName ? { name: routeName } : undefined;
    },
    isReady: () => ready,
    setReady(value) { ready = value; },
    setRoute(name) { routeName = name; },
    routeReads: () => routeReads,
  };
};

test('route observer waits for ready, follows state, and unsubscribes', () => {
  const navigationRef = createNavigationRef();
  const routes = [];
  const unsubscribe = subscribeToNavigationRoute(
    navigationRef,
    (routeName) => routes.push(routeName)
  );

  assert.equal(navigationRef.routeReads(), 0);
  assert.deepEqual(routes, []);

  navigationRef.setRoute('Home');
  navigationRef.setReady(true);
  navigationRef.emit('ready');
  assert.deepEqual(routes, ['Home']);

  navigationRef.setRoute('Settings');
  navigationRef.emit('state');
  assert.deepEqual(routes, ['Home', 'Settings']);

  unsubscribe();
  navigationRef.setRoute('Agent');
  navigationRef.emit('state');
  assert.deepEqual(routes, ['Home', 'Settings']);
});

test('App startup delegates route reads to the readiness observer', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'App.js'),
    'utf8'
  );

  assert.doesNotMatch(
    appSource,
    /useState\(\(\) => navigationRef\.getCurrentRoute\(\)/
  );
  assert.match(appSource, /subscribeToNavigationRoute\(navigationRef, setRouteName\)/);
});
```

- [x] **Step 2: Run the test and verify the current implementation is red**

Run: `node --test tests/client/navigation-route-observer.test.cjs`

Expected: FAIL with `Cannot find module '../../utils/navigationRouteObserver.cjs'`.

### Task 2: Implement and connect the fail-closed observer

**Files:**
- Create: `utils/navigationRouteObserver.cjs`
- Modify: `App.js:1-24`
- Test: `tests/client/navigation-route-observer.test.cjs`

- [x] **Step 1: Implement the pure navigation lifecycle module**

Create `utils/navigationRouteObserver.cjs` with:

```js
'use strict';

const subscribeToNavigationRoute = (navigationRef, onRouteName) => {
  if (!navigationRef || typeof navigationRef.isReady !== 'function') {
    throw new TypeError('A navigation container ref is required');
  }
  if (typeof onRouteName !== 'function') {
    throw new TypeError('A route listener is required');
  }

  const syncRoute = () => {
    if (!navigationRef.isReady()) return;
    onRouteName(navigationRef.getCurrentRoute()?.name ?? null);
  };
  const unsubscribeReady = navigationRef.addListener('ready', syncRoute);
  const unsubscribeState = navigationRef.addListener('state', syncRoute);

  syncRoute();

  return () => {
    unsubscribeReady();
    unsubscribeState();
  };
};

module.exports = { subscribeToNavigationRoute };
```

- [x] **Step 2: Replace the startup route read in `App.js`**

Add the import:

```js
import navigationRouteObserver from './utils/navigationRouteObserver.cjs';

const { subscribeToNavigationRoute } = navigationRouteObserver;
```

Replace the `AuthenticatedFab` route state and effect with:

```js
const [routeName, setRouteName] = React.useState(null);
React.useEffect(
  () => subscribeToNavigationRoute(navigationRef, setRouteName),
  []
);
```

Keep the existing `navigationRef.isReady()` check in `handlePress` unchanged.

- [x] **Step 3: Run the focused test and verify it is green**

Run: `node --test tests/client/navigation-route-observer.test.cjs`

Expected: PASS with 2 tests.

### Task 3: Add the regression test to client verification and validate Android

**Files:**
- Modify: `package.json:6-15`
- Test: `tests/client/navigation-route-observer.test.cjs`

- [x] **Step 1: Include the new test in `verify:client`**

Change the script to:

```json
"verify:client": "node utils/serverAddress.verify.js && node --test tests/client/server-lifecycle.test.cjs tests/client/navigation-route-observer.test.cjs"
```

- [x] **Step 2: Run the complete client verification**

Run: `npm run verify:client`

Expected: exit code 0; server address checks, 10 lifecycle tests, and 2 navigation observer tests pass.

- [x] **Step 3: Re-run the original startup failure loop**

Run: `node --test --test-name-pattern="App startup" tests/client/navigation-route-observer.test.cjs`

Expected: PASS; `App.js` contains no eager `getCurrentRoute()` state initializer.

- [x] **Step 4: Build the Android bundle**

Run: `npx expo export --platform android --output-dir .tmp/navigation-readiness-android-20260913`

Expected: Metro bundles successfully and exports Android assets without navigation initialization errors during compilation.

- [x] **Step 5: Check scoped diffs and preserve overlapping user work**

Run: `git diff --check -- App.js package.json utils/navigationRouteObserver.cjs tests/client/navigation-route-observer.test.cjs docs/superpowers/plans/2026-09-13-navigation-readiness-observer.md`

Expected: no whitespace errors. Do not commit the implementation automatically because `App.js` and `package.json` already contain unrelated user changes; report the verified working-tree changes for user review.
