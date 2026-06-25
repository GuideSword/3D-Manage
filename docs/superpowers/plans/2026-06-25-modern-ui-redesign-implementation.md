# Modern UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the full React Native/Expo app UI into a modern professional operations interface, with stronger visual treatment on model-library screens.

**Architecture:** Keep the existing screen and navigation structure. First add reusable design tokens and upgrade shared UI primitives, then apply them across navigation, tab screens, detail screens, and form screens without changing API calls or backend data behavior.

**Tech Stack:** React Native 0.81.5, Expo 54, React Navigation 7, Expo Vector Icons Ionicons, existing JavaScript modules.

---

## File Structure

- Modify `constants/index.js`: add modern color, spacing, radius, typography, and shadow tokens while keeping existing exports compatible.
- Modify `components/Card.js`: make cards border-first, lower-shadow surfaces with variants and padding options.
- Modify `components/Button.js`: add icon support, ghost/subtle hierarchy, modern sizes, and stable loading state.
- Modify `components/Input.js`: add focus styling and modern production form control styles.
- Modify `components/Picker.js`: align trigger and modal sheet with the new form system.
- Modify `components/Badge.js`: add soft status badge treatment while keeping filled/outline compatibility.
- Modify `navigation/AppNavigator.js`: replace heavy blue stack headers with neutral operational headers.
- Modify `navigation/TabNavigator.js`: modernize tab bar styling and fix visible Chinese tab titles.
- Modify tab screens: `screens/LoginScreen.js`, `screens/HomeScreen.js`, `screens/OrdersScreen.js`, `screens/ModelsScreen.js`, `screens/MaterialsScreen.js`, `screens/SettingsScreen.js`.
- Modify detail screens: `screens/OrderDetailScreen.js`, `screens/ModelDetailScreen.js`, `screens/MaterialDetailScreen.js`.
- Modify form and utility screens: `screens/CreateOrderScreen.js`, `screens/CreateModelScreen.js`, `screens/CreateMaterialScreen.js`, `screens/InboundTransactionScreen.js`, `screens/OutboundTransactionScreen.js`, `screens/AdjustTransactionScreen.js`, `screens/DataImportScreen.js`, `screens/OSSConfigScreen.js`.

## Task 1: Design Tokens and Shared Components

**Files:**
- Modify: `constants/index.js`
- Modify: `components/Card.js`
- Modify: `components/Button.js`
- Modify: `components/Input.js`
- Modify: `components/Picker.js`
- Modify: `components/Badge.js`

- [ ] **Step 1: Update design tokens**

Add these exports to `constants/index.js` while keeping existing `COLORS` keys available:

```js
export const COLORS = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primarySoft: '#DBEAFE',
  accent: '#0F766E',
  accentSoft: '#CCFBF1',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#0284C7',
  infoSoft: '#E0F2FE',
  light: '#F6F8FB',
  dark: '#111827',
  background: '#F6F8FB',
  surface: '#EEF2F7',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  text: '#111827',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  disabled: '#CBD5E1',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pill: 999,
};

export const TYPOGRAPHY = {
  screenTitle: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  sectionTitle: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  meta: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
};

export const SHADOWS = {
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  floating: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 6,
  },
};
```

- [ ] **Step 2: Redesign `Card`**

Implement `variant`, `padding`, and `interactive` surface styles. Preserve existing `children` and `style` props.

- [ ] **Step 3: Redesign `Button`**

Add `iconLeft`, `iconRight`, and `fullWidth` props. Keep current `title`, `variant`, `size`, `disabled`, and `loading` behavior.

- [ ] **Step 4: Redesign `Input`**

Add focused border styling using local focus state. Keep existing props and validation rendering.

- [ ] **Step 5: Redesign `Picker`**

Use the same border, height, radius, typography, and disabled/error treatment as `Input`. Keep current modal selection behavior.

- [ ] **Step 6: Redesign `Badge`**

Use soft backgrounds by default and keep `filled` and `outline` compatibility. Ensure long text does not overflow.

- [ ] **Step 7: Run component parse check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: the command completes without JavaScript syntax errors.

- [ ] **Step 8: Commit component system**

Run:

```bash
git add constants/index.js components/Card.js components/Button.js components/Input.js components/Picker.js components/Badge.js
git commit -m "Redesign shared UI primitives"
```

## Task 2: Navigation Shell

**Files:**
- Modify: `navigation/AppNavigator.js`
- Modify: `navigation/TabNavigator.js`

- [ ] **Step 1: Modernize stack header**

Use light header background, dark title text, primary back/action tint, and a subtle bottom border.

- [ ] **Step 2: Modernize tab bar**

Use elevated white tab bar, muted inactive color, primary active color, stable icon sizing, and corrected Chinese titles:

```text
首页
订单
模型
耗材
设置
```

- [ ] **Step 3: Run navigation parse check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: export completes without navigation or style syntax errors.

- [ ] **Step 4: Commit navigation shell**

Run:

```bash
git add navigation/AppNavigator.js navigation/TabNavigator.js
git commit -m "Modernize app navigation shell"
```

## Task 3: Login and Home Screens

**Files:**
- Modify: `screens/LoginScreen.js`
- Modify: `screens/HomeScreen.js`

- [ ] **Step 1: Redraw login**

Use neutral background, brand block, segmented login/register buttons, redesigned inputs, and a visually quiet default credentials hint. Keep `signIn`, `register`, validation, and auth mode behavior unchanged.

- [ ] **Step 2: Redraw home dashboard**

Use a compact dashboard header, three metric cards, quick-action grid, and recent order rows. Keep `loadDashboard`, refresh, export, and navigation behavior unchanged.

- [ ] **Step 3: Correct touched visible labels**

Use these user-visible labels where the screen renders corrupted Chinese:

```text
3D 打印管理系统
登录后访问订单、模型、耗材和库存数据
登录
注册
姓名
邮箱
密码
默认管理员：admin@example.com / Admin123456
欢迎回来
运营概览
待审核订单
执行中订单
低库存批次
快捷操作
最近订单
暂无最近订单
```

- [ ] **Step 4: Run parse check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: export completes without syntax errors.

- [ ] **Step 5: Commit login and dashboard**

Run:

```bash
git add screens/LoginScreen.js screens/HomeScreen.js
git commit -m "Redraw login and dashboard UI"
```

## Task 4: Tab-Level Work Screens

**Files:**
- Modify: `screens/OrdersScreen.js`
- Modify: `screens/ModelsScreen.js`
- Modify: `screens/MaterialsScreen.js`
- Modify: `screens/SettingsScreen.js`

- [ ] **Step 1: Redraw orders work queue**

Modernize header actions, search field, status chips, order cards, empty state, and delete affordance. Preserve data loading, filtering, route params, deletion, and navigation.

- [ ] **Step 2: Redraw models asset library**

Modernize list/grid cards, preview areas, active source filter hint, empty state, and floating create action. Preserve search, source filtering, token-auth image source construction, and navigation.

- [ ] **Step 3: Redraw materials inventory**

Modernize materials/inventory segmented tabs, inventory action panel, material cards, lot cards, search field, empty states, and create/delete actions. Preserve stock/material API behavior.

- [ ] **Step 4: Redraw settings**

Use modern section rows for OSS config, data import, account/system info, and sign out. Preserve existing navigation and auth behavior.

- [ ] **Step 5: Correct touched visible labels**

Use clear Chinese labels for headers, filters, search fields, empty states, action buttons, and section titles touched in these files.

- [ ] **Step 6: Run parse check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: export completes without syntax errors.

- [ ] **Step 7: Commit tab-level screens**

Run:

```bash
git add screens/OrdersScreen.js screens/ModelsScreen.js screens/MaterialsScreen.js screens/SettingsScreen.js
git commit -m "Redraw main management screens"
```

## Task 5: Detail Screens

**Files:**
- Modify: `screens/OrderDetailScreen.js`
- Modify: `screens/ModelDetailScreen.js`
- Modify: `screens/MaterialDetailScreen.js`

- [ ] **Step 1: Redraw order detail**

Add top identity section, compact metadata groups, section cards for customer/items/attachments/actions, and visually separated destructive action. Preserve status transitions, delete behavior, and navigation.

- [ ] **Step 2: Redraw model detail**

Add top identity section, image gallery treatment, file list sections, upload sections, and separated delete action. Preserve upload, image, delete, and auth token behavior.

- [ ] **Step 3: Redraw material detail**

Add top identity section, stock summary, lot list, transaction actions, metadata rows, and separated delete action. Preserve material loading, stock lot loading, navigation, and deletion.

- [ ] **Step 4: Correct touched visible labels**

Use clear Chinese labels for section headings, action buttons, empty states, and destructive confirmation text touched by these files.

- [ ] **Step 5: Run parse check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: export completes without syntax errors.

- [ ] **Step 6: Commit detail screens**

Run:

```bash
git add screens/OrderDetailScreen.js screens/ModelDetailScreen.js screens/MaterialDetailScreen.js
git commit -m "Redraw detail screen layouts"
```

## Task 6: Form, Transaction, and Utility Screens

**Files:**
- Modify: `screens/CreateOrderScreen.js`
- Modify: `screens/CreateModelScreen.js`
- Modify: `screens/CreateMaterialScreen.js`
- Modify: `screens/InboundTransactionScreen.js`
- Modify: `screens/OutboundTransactionScreen.js`
- Modify: `screens/AdjustTransactionScreen.js`
- Modify: `screens/DataImportScreen.js`
- Modify: `screens/OSSConfigScreen.js`

- [ ] **Step 1: Redraw create order**

Use form sections, dense section headings, modern date/file buttons, order item cards, and stable submit/cancel area. Preserve current form state, validation, upload selection, and API submit behavior.

- [ ] **Step 2: Redraw create model**

Use modern model identity, source segmented control, model file upload section, image upload section, and submit/cancel area. Preserve file and image upload behavior.

- [ ] **Step 3: Redraw create material**

Use modern material identity, specs, price/unit, notes, and submit/cancel sections. Preserve validation and create behavior.

- [ ] **Step 4: Redraw inbound, outbound, and adjustment screens**

Apply the shared form layout to transaction type, lot/material selection, quantity, reason, and note fields. Preserve available lot filtering and API submit behavior.

- [ ] **Step 5: Redraw data import and OSS config**

Use the shared utility form style for CSV import and OSS credentials. Preserve file picking, text paste, test connection, and save behavior.

- [ ] **Step 6: Correct touched visible labels**

Use clear Chinese labels for form sections, fields, file actions, submit/cancel buttons, validation alerts, loading text, and empty states touched by these files.

- [ ] **Step 7: Run parse check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: export completes without syntax errors.

- [ ] **Step 8: Commit forms and utility screens**

Run:

```bash
git add screens/CreateOrderScreen.js screens/CreateModelScreen.js screens/CreateMaterialScreen.js screens/InboundTransactionScreen.js screens/OutboundTransactionScreen.js screens/AdjustTransactionScreen.js screens/DataImportScreen.js screens/OSSConfigScreen.js
git commit -m "Redraw form and utility screens"
```

## Task 7: Final Verification

**Files:**
- Inspect: all modified frontend files

- [ ] **Step 1: Run final export check**

Run:

```bash
npx expo export --platform web --clear
```

Expected: export completes without JavaScript syntax errors.

- [ ] **Step 2: Start Expo web**

Run:

```bash
npm run web
```

Expected: Expo starts and provides a local web URL.

- [ ] **Step 3: Inspect local web UI**

Open the local web URL in the in-app browser. Verify:

```text
Login screen renders without blank screen.
Text and controls do not overlap on a mobile-width viewport.
Primary colors, cards, inputs, buttons, and badges use the new design system.
Navigation shell uses the modern header and tab bar.
```

- [ ] **Step 4: Review business logic diff**

Run:

```bash
git diff HEAD~6..HEAD -- utils backend context
git diff HEAD~6..HEAD -- screens components navigation constants
```

Expected: no backend changes; frontend changes are visual/layout focused and do not alter API endpoints or data handling intentionally.

- [ ] **Step 5: Commit any verification fixes**

If visual or syntax fixes are needed, make them and run:

```bash
git add screens components navigation constants
git commit -m "Polish modern UI redraw"
```

