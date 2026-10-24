# Responsive Xiaoli ERP Web Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Xiaoli-branded responsive desktop ERP shell while keeping the existing mobile web and native navigation behavior intact.

**Architecture:** Use the existing React Navigation bottom-tab navigator with its supported `tabBarPosition` switch: bottom tabs below the desktop breakpoint and a left rail above it. Keep dashboard data loading in `HomeScreen`/`CyberHome`, and make the dashboard compose into desktop rows through responsive styles and small layout wrappers. Reuse existing theme tokens and permissions.

**Tech Stack:** Expo 54, React Native 0.81, React Navigation bottom tabs, Jest-free Node test runner, Expo web export.

---

### Task 1: Add a shared responsive breakpoint helper

**Files:**
- Create: `utils/responsiveLayout.cjs`
- Test: `tests/client/responsive-layout.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getResponsiveLayout } = require('../../utils/responsiveLayout.cjs');

test('uses mobile layout below the desktop breakpoint', () => {
  assert.deepEqual(getResponsiveLayout(767, 'web'), { isWeb: true, isDesktop: false, isCompactDesktop: false });
});

test('uses full desktop layout at 1024px and above', () => {
  assert.deepEqual(getResponsiveLayout(1024, 'web'), { isWeb: true, isDesktop: true, isCompactDesktop: false });
});

test('marks the 768-1023 range as compact desktop', () => {
  assert.deepEqual(getResponsiveLayout(900, 'web'), { isWeb: true, isDesktop: true, isCompactDesktop: true });
});

test('never activates desktop chrome on native platforms', () => {
  assert.deepEqual(getResponsiveLayout(1440, 'ios'), { isWeb: false, isDesktop: false, isCompactDesktop: false });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/client/responsive-layout.test.cjs`
Expected: FAIL because `utils/responsiveLayout.cjs` does not exist.

- [ ] **Step 3: Implement the helper**

```js
const DESKTOP_BREAKPOINT = 768;
const COMPACT_DESKTOP_BREAKPOINT = 1024;

function getResponsiveLayout(width, platform = 'web') {
  const isWeb = platform === 'web';
  const safeWidth = Number.isFinite(width) ? width : 0;
  const isDesktop = isWeb && safeWidth >= DESKTOP_BREAKPOINT;
  return {
    isWeb,
    isDesktop,
    isCompactDesktop: isDesktop && safeWidth < COMPACT_DESKTOP_BREAKPOINT,
  };
}

module.exports = { DESKTOP_BREAKPOINT, COMPACT_DESKTOP_BREAKPOINT, getResponsiveLayout };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/client/responsive-layout.test.cjs`
Expected: PASS with four passing tests.

### Task 2: Add the responsive Xiaoli ERP navigation rail

**Files:**
- Modify: `navigation/TabNavigator.js`
- Modify: `navigation/CyberTabBar.js`
- Modify: `components/cyber/XiaoliBrandMark.js` only if a web-safe brand size adjustment is needed

- [ ] **Step 1: Switch the navigator position from viewport width**

In `TabNavigator`, call `useWindowDimensions()` and `getResponsiveLayout(width, Platform.OS)`, then set `tabBarPosition` to `left` for `isDesktop` and `bottom` otherwise. Keep the existing five `Tab.Screen` declarations and theme colors.

- [ ] **Step 2: Add desktop rail rendering to `CyberTabBar`**

Render the current pill bar when `isDesktop` is false. When true, render a full-height light/dark rail with the Xiaoli brand mark, grouped labels, the five existing tab actions, and permission-aware shortcuts for `Customers`, `Suppliers`, `DataImport`, `Users`, and `WarehouseSettings`. Each shortcut must use `navigation.navigate(routeName)` and an accessible label. Use `canManage`, `canExport`, and `masterDataCore.supportsMasterData(server)` to determine visibility.

- [ ] **Step 3: Verify route and permission behavior**

Run: `node --test tests/client/responsive-layout.test.cjs`
Expected: PASS. Then run `npx expo export --platform web --output-dir .tmp/responsive-web-nav` and confirm the bundle completes without unresolved imports.

### Task 3: Compose the desktop dashboard without changing data loading

**Files:**
- Modify: `components/home/CyberHome.js`
- Modify: `screens/HomeScreen.js` only if the responsive props need forwarding

- [ ] **Step 1: Add the desktop flag**

Use `useWindowDimensions()` and the shared helper in `CyberHome`; derive `isDesktop` from the current width and platform.

- [ ] **Step 2: Add desktop layout wrappers**

Wrap the two order status cards in a `desktopStatusRow` with horizontal flex at desktop width. Add a `desktopQuickRow` for the shortcuts and preserve the recent-order list below it. Increase the desktop page max width, hero height, and content padding while keeping the existing mobile styles as defaults.

- [ ] **Step 3: Keep the approved Xiaoli visual language**

Use existing `cyberTheme`, `hero.png`, `review.png`, and `production.png`; do not add a second palette. Desktop card backgrounds, borders, and text colors must come from `cyberTheme` so dark mode maps automatically.

- [ ] **Step 4: Verify dashboard behavior**

Run: `npx expo export --platform web --output-dir .tmp/responsive-web-dashboard`
Expected: export succeeds. Manually check mobile width (`390px`) and desktop width (`1440px`) in the exported site: status cards stack on mobile and sit side by side on desktop; refresh, order navigation, and permission-aware actions still render.

### Task 4: Add focused verification and run the existing client suite

**Files:**
- Modify: `package.json` only if a `verify:responsive` script is useful

- [ ] **Step 1: Run focused responsive tests**

Run: `node --test tests/client/responsive-layout.test.cjs`
Expected: PASS.

- [ ] **Step 2: Run existing client verification**

Run: `npm run verify:client`
Expected: existing client tests pass; if a pre-existing unrelated failure occurs, record the exact test and output.

- [ ] **Step 3: Run the web export**

Run: `npx expo export --platform web --output-dir .tmp/responsive-web`
Expected: export completes and writes a web bundle.

- [ ] **Step 4: Review the final diff**

Run: `git diff -- navigation/TabNavigator.js navigation/CyberTabBar.js components/home/CyberHome.js utils/responsiveLayout.cjs tests/client/responsive-layout.test.cjs`
Expected: only responsive navigation, dashboard layout, and focused verification changes are present; unrelated pre-existing worktree changes remain untouched.

