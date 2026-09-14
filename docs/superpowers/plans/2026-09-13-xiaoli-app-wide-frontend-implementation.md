# Xiaoli App-Wide Frontend Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the approved Xiaoli blue-purple frontend system from Home, Orders, and Models to every primary, detail, form, inventory, system, authentication, and AI screen without changing backend contracts or business behavior.

**Architecture:** Make the existing theme context the compatibility boundary by replacing only its legacy semantic color values with the approved cyber palette. Upgrade shared presentation primitives so deep screens inherit the visual system automatically, then add purpose-built branded chrome only where a page needs a visible identity or Xiaoli assistant entry. Screen containers retain all API calls, permissions, route parameters, validation, and write handlers.

**Tech Stack:** Expo 54, React Native 0.81, React Navigation 7, `expo-linear-gradient`, Ionicons, Node client tests, and Playwright smoke tests against an isolated Expo Web export.

---

## File map

- Modify `constants/index.js`: replace warm light/dark semantic tokens and shadows with the approved lavender/indigo system while preserving every existing key.
- Modify `components/cyber/theme.js`: derive cyber-specific aliases from the global compatibility palette.
- Create `components/cyber/XiaoliBrandMark.js`: reusable real-character brand mark for login, server, setup, and AI empty states.
- Modify `components/Card.js`, `components/Button.js`, `components/Input.js`, `components/Picker.js`, `components/ui/ScreenHeader.js`, `components/ui/EmptyState.js`, and `components/ui/ThemeModePicker.js`: upgrade shared surfaces and controls.
- Modify `navigation/TabNavigator.js`, `navigation/CyberTabBar.js`, `navigation/AppNavigator.js`, and `navigation/AgentStack.js`: apply cyber chrome to all primary and nested routes.
- Modify `screens/MaterialsScreen.js` and `screens/SettingsScreen.js`: complete the remaining primary tabs with branded headers and embedded Xiaoli assistant entries.
- Modify `components/agent/DraggableFab.js`, `screens/AgentChatScreen.js`, and `screens/AgentSettingsScreen.js`: replace generic paw/ASCII branding and restyle chat chrome.
- Modify `screens/LoginScreen.js`, `screens/ServerSetupScreen.js`, `screens/BootstrapOwnerScreen.js`, and `screens/ServerConnectionErrorScreen.js`: add strong Xiaoli brand treatment to entry and recovery flows.
- Verify all detail/form/transaction/admin screens through their existing use of the upgraded theme and primitives: `OrderDetailScreen.js`, `ModelDetailScreen.js`, `MaterialDetailScreen.js`, `CreateOrderScreen.js`, `CreateModelScreen.js`, `CreateMaterialScreen.js`, `InboundTransactionScreen.js`, `OutboundTransactionScreen.js`, `AdjustTransactionScreen.js`, `DataImportScreen.js`, and `UsersScreen.js`.
- Create `tests/client/app-wide-ui.smoke.cjs`: verify primary navigation, nested route rendering, real Xiaoli branding, dark/light themes, and narrow overflow.
- Generate `docs/ui-concepts/xiaoli-app-wide-*.png`: final representative screenshots.

### Task 1: Lock the global visual contract

**Files:**
- Create: `tests/client/app-wide-ui.smoke.cjs`
- Test: `tests/client/app-wide-ui.smoke.cjs`

- [x] **Step 1: Build an isolated fixture server**

Reuse the exported-app static server and system/auth fixtures from `tests/client/orders-models-ui.smoke.cjs`. Listen on port `0`, calculate `appUrl` from `server.address().port`, and intercept `/api/materials`, `/api/stock/lots`, `/api/users`, `/api/orders`, `/api/models`, and `/api/agent/settings` with deterministic data.

```js
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const appUrl = `http://127.0.0.1:${server.address().port}`;
```

- [x] **Step 2: Assert the remaining primary tabs**

After login, navigate to Materials and Settings. Assert that `耗材仓库` and `设置中心` render, each exposes one `打开小鲤 AI 助手` control, and no horizontal overflow occurs at 320px.

```js
await page.getByRole('tab', { name: '耗材', exact: true }).click();
await page.getByText('耗材仓库', { exact: true }).waitFor();
assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手' }).count(), 1);
await page.getByRole('tab', { name: '设置', exact: true }).click();
await page.getByText('设置中心', { exact: true }).waitFor();
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
```

- [x] **Step 3: Assert nested and AI routes**

Open a material detail, return, open inventory, open the inbound transaction, then open Xiaoli from the header. Assert route titles and the image-backed assistant empty state.

```js
await page.getByText('PLA', { exact: true }).click();
await page.getByText('耗材详情', { exact: true }).waitFor();
await page.goBack();
await page.getByText('库存', { exact: true }).click();
await page.getByText('入库', { exact: true }).click();
await page.getByText('入库操作', { exact: true }).waitFor();
await page.goBack();
await page.getByRole('button', { name: '打开小鲤 AI 助手' }).click();
await page.getByText('小鲤已就位', { exact: true }).waitFor();
assert.equal(await page.getByText('ฅ^•ﻌ•^ฅ', { exact: true }).count(), 0);
```

- [x] **Step 4: Run the contract red**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/xiaoli-export
$env:NODE_PATH='C:\Users\sword\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tests/client/app-wide-ui.smoke.cjs
```

Expected: FAIL because Materials and Settings do not yet provide the embedded Xiaoli entry and the Agent empty state still renders ASCII art.

### Task 2: Make the approved palette global without breaking legacy consumers

**Files:**
- Modify: `constants/index.js`
- Modify: `components/cyber/theme.js`
- Create: `components/cyber/XiaoliBrandMark.js`
- Modify: `components/cyber/index.js`

- [x] **Step 1: Replace the light and dark compatibility palettes**

Retain all existing property names. Use these core values and map status aliases to the approved secondary tones:

```js
export const LIGHT_COLORS = {
  primary: '#7351E8', primaryDark: '#5A3CC7', primarySoft: '#EEE9FF',
  accent: '#D72DAC', accentSoft: '#FFF0FC', secondary: '#0089C9',
  success: '#3F9B72', successSoft: '#E8F7F0', warning: '#D72DAC', warningSoft: '#FFF0FC',
  danger: '#C95368', dangerSoft: '#FFEAF0', info: '#0089C9', infoSoft: '#E6F8FF',
  light: '#FFFFFF', dark: '#201A58', background: '#F2F1FF', surface: '#EEEAFE',
  surfaceElevated: '#FFFFFFE8', surfaceMuted: '#F8F6FF', text: '#201A58',
  textSecondary: '#62628B', textTertiary: '#8785A9', border: '#E4DEFF',
  borderStrong: '#CFC4F4', disabled: '#CFC4F4', onPrimary: '#FFFFFF',
  onAccent: '#FFFFFF', onSuccess: '#FFFFFF', onWarning: '#FFFFFF', onDanger: '#FFFFFF',
  overlay: 'rgba(27, 20, 66, 0.46)',
};
```

Use `#151329` for the dark background, `#292443` for elevated surfaces, `#F1EDFF` for text, `#B39AFF` for primary, `#F399D7` for warning/accent, and `#70D7FF` for info.

- [x] **Step 2: Derive cyber aliases from global colors**

Import `LIGHT_COLORS` and `DARK_COLORS` into `components/cyber/theme.js`, select the palette by `dark`, and return its keys plus `glass`, `pink`, `pinkSoft`, `blue`, `blueSoft`, `hero`, `pinkCard`, `blueCard`, and `glow`. This prevents the homepage and nested screens from drifting.

- [x] **Step 3: Create the reusable character mark**

`XiaoliBrandMark` uses `require('../../assets/xiaoli/hero.png')`, a clipped image, optional `AI` badge, and accessibility label. It accepts `size`, `showBadge`, and `style`; it makes no navigation or API calls.

```jsx
<View accessibilityRole="image" accessibilityLabel={showBadge ? '小鲤 AI 助手' : '小鲤'} style={[styles.shell, { width: size, height: size }, style]}>
  <Image source={xiaoliImage} resizeMode="cover" style={[styles.image, { width: size * 1.28, height: size * 1.44 }]} />
  {showBadge ? <View style={styles.badge}><Text style={styles.badgeText}>AI</Text></View> : null}
</View>
```

- [x] **Step 4: Export and compile**

Export the mark from `components/cyber/index.js`, then run `npx expo export --platform web --output-dir .tmp/xiaoli-export`.

Expected: PASS; no existing screen loses a required semantic color key.

### Task 3: Upgrade shared cards, controls, states, and navigation

**Files:**
- Modify: `components/Card.js`
- Modify: `components/Button.js`
- Modify: `components/Input.js`
- Modify: `components/Picker.js`
- Modify: `components/ui/ScreenHeader.js`
- Modify: `components/ui/EmptyState.js`
- Modify: `components/ui/ThemeModePicker.js`
- Modify: `navigation/AppNavigator.js`
- Modify: `navigation/AgentStack.js`

- [x] **Step 1: Apply cyber surface geometry**

Use 20px cards, 15px fields/buttons, `colors.surfaceElevated` glass surfaces, `colors.border`, and low-intensity purple shadows. Keep component props, event handlers, disabled rules, and accessibility props unchanged.

- [x] **Step 2: Make empty states character-led**

Render `XiaoliBrandMark` above the existing icon and copy. Keep `actionLabel`, `onAction`, and all incoming text unchanged. The character is decorative and does not replace the state icon.

- [x] **Step 3: Restyle nested native headers**

Set `AppNavigator` and `AgentStack` header backgrounds to `colors.surfaceElevated`, title text to `colors.text`, tint to `colors.primary`, and header borders/shadows to the theme border. Do not rename, add, or remove routes and permission gates.

- [x] **Step 4: Verify deep-screen inheritance**

Run `npm run verify:client` and `npx expo export --platform web --output-dir .tmp/xiaoli-export`.

Expected: all client tests and compilation pass; detail, create, transaction, import, user, and agent-settings screens inherit the new palette through existing `useAppTheme`, `Card`, `Input`, `Picker`, `Button`, and navigation header usage.

### Task 4: Finish Materials and Settings primary pages

**Files:**
- Modify: `screens/MaterialsScreen.js`
- Modify: `screens/SettingsScreen.js`
- Modify: `navigation/TabNavigator.js`
- Modify: `navigation/CyberTabBar.js`
- Modify: `App.js`

- [x] **Step 1: Replace the Materials header and conditional search**

Use `CyberPageHeader`, `CyberIconButton`, `CyberSearchField`, `CyberMetricStrip`, and the existing Xiaoli assistant button. Keep the Materials/Inventory segment, API calls, deletion, refresh, transaction routes, and `homeRequest` behavior unchanged.

```jsx
<CyberPageHeader eyebrow="MATERIAL STOCK" title="耗材仓库" subtitle="每一卷材料，都安排得明明白白。"
  onAssistant={() => navigation.navigate(ROUTES.AGENT)}
  actions={editable && activeTab === 'materials' ? <CyberIconButton icon="add" label="新建耗材" active onPress={() => navigation.navigate(ROUTES.CREATE_MATERIAL)} /> : null} />
<CyberSearchField value={searchQuery} onChangeText={setSearchQuery} placeholder="搜索材质、品牌或颜色" />
```

- [x] **Step 2: Add the Settings branded header**

Rename the visible title to `设置中心`, add subtitle `把工作台调成最顺手的样子。`, and place the Xiaoli assistant entry at the right. Update the theme description to `日间薰衣草云光，夜间深靛星光`; keep every account, server, import, logout, and permission callback unchanged.

- [x] **Step 3: Remove duplicate native/FAB chrome**

Set `headerShown: false` for Materials and Settings in `TabNavigator`. Make every route use the cyber tab background. Add Materials and Settings to `routesWithEmbeddedAssistant` in `App.js` so every primary screen exposes exactly one assistant control.

- [x] **Step 4: Run the app-wide smoke test green for primary pages**

Run `node tests/client/app-wide-ui.smoke.cjs` with the Playwright `NODE_PATH`.

Expected: Materials and Settings assertions pass in light and dark themes and at 320px.

### Task 5: Replace generic assistant and entry branding with Xiaoli

**Files:**
- Modify: `components/agent/DraggableFab.js`
- Modify: `screens/AgentChatScreen.js`
- Modify: `screens/LoginScreen.js`
- Modify: `screens/ServerSetupScreen.js`
- Modify: `screens/BootstrapOwnerScreen.js`
- Modify: `screens/ServerConnectionErrorScreen.js`
- Modify: `screens/AgentSettingsScreen.js`

- [x] **Step 1: Replace the paw FAB**

Render `XiaoliBrandMark size={50} showBadge` inside the existing animated shell. Preserve PanResponder, edge snapping, clamping, and `onPress`; add accessibility role and label to the touch target.

- [x] **Step 2: Replace the Agent ASCII mascot**

Replace only the `catFace` text and mascot badge with `XiaoliBrandMark size={104} showBadge`. Keep streaming, tool calls, drafts, composer, confirmation, and cancellation logic unchanged.

- [x] **Step 3: Brand entry and recovery screens**

Replace the login paw and server/setup generic leading marks with `XiaoliBrandMark`. Add the mark above Bootstrap Owner and connection-error cards. Preserve all validation, cleanup, replacement, bootstrap-token, timeout, and retry branches.

- [x] **Step 4: Refine AI settings surfaces**

Use the global cards/fields and add a `ScreenHeader` with `AI SERVICE`, `小鲤服务设置`, and the existing service explanation. Do not change provider defaults, API-key persistence, testing, clearing, or save behavior.

- [x] **Step 5: Export and rerun the app-wide smoke**

Run the Web export and `node tests/client/app-wide-ui.smoke.cjs`.

Expected: PASS; the AI page contains the actual Xiaoli asset and no ASCII cat or paw-only assistant identity remains.

### Task 6: Full regression and visual handoff

**Files:**
- Update: `docs/superpowers/plans/2026-09-13-xiaoli-app-wide-frontend-implementation.md`
- Generate: `docs/ui-concepts/xiaoli-app-wide-materials-light.png`
- Generate: `docs/ui-concepts/xiaoli-app-wide-settings-light.png`
- Generate: `docs/ui-concepts/xiaoli-app-wide-agent-dark.png`
- Generate: `docs/ui-concepts/xiaoli-app-wide-login-light.png`

- [x] **Step 1: Run client verification**

Run `npm run verify:client`.

Expected: all lifecycle and client address checks pass.

- [x] **Step 2: Run all UI smoke suites**

Run homepage, Orders/Models, and app-wide Playwright suites against the fresh export.

Expected: all suites exit 0 with no page errors or horizontal overflow.

- [x] **Step 3: Run three-platform export**

Run `npx expo export --platform all --output-dir .tmp/xiaoli-export`.

Expected: Web, Android, and iOS bundles complete without Metro errors.

- [x] **Step 4: Inspect source boundaries**

Run:

```powershell
git diff --check
git status --short
git diff --name-only -- server utils
```

Expected: no whitespace errors and no backend or API utility business file changes caused by this frontend phase.

- [x] **Step 5: Record actual outcomes**

## Verification results

- Red contract: `node tests/client/app-wide-ui.smoke.cjs` initially failed with `0 !== 1` because Materials exposed no `打开小鲤 AI 助手` control.
- Client regression: `npm run verify:client` passed the server-address verification and all 8 lifecycle tests.
- Static build: `npx expo export --platform all --output-dir .tmp/xiaoli-export` passed for Web, Android, and iOS.
- Homepage smoke: light and dark rendering, counts, retry behavior, and production navigation passed.
- Orders/Models smoke: light and dark search/filter/view contracts and narrow overflow checks passed.
- App-wide smoke: light and dark Materials, Material Detail, Create Material, Inbound Transaction, Settings, Server Setup, Login, and Agent routes passed with no runtime errors.
- Representative screenshots were generated as `docs/ui-concepts/xiaoli-app-wide-{server,login,materials,material-detail,create-material,inbound,settings,agent}-{light,dark}.png`.
- Visual inspection confirmed the same lavender/indigo palette, rounded glass surfaces, status colors, and real Xiaoli character across primary and nested routes. The AI modal contains no duplicate floating assistant control.
- `git diff --check` passed; only existing Windows line-ending notices were reported.
- The implementation changed presentation files, navigation chrome, shared theme tokens, and client tests only. It did not modify backend directories, `utils/api.js`, `utils/agentApi.js`, permission helpers, API parameters, route names, or business-state handlers.

Append a `## Verification results` section containing the exact commands, pass/fail outcomes, screenshot paths, and any accepted responsive refinements. Do not commit unrelated self-hosted documents, generated Android directories, APK/output artifacts, or pre-existing user work.
