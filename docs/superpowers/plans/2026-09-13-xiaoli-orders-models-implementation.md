# Xiaoli Orders and Models Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved, runnable Xiaoli-styled Orders and Models screens as the first acceptance unit of the app-wide frontend refresh.

**Architecture:** Keep API calls, permission checks, route names, and business state inside the existing screen containers. Add a small `components/cyber` presentation layer for the shared blue-purple palette, list-page header, Xiaoli assistant portrait, search field, chips, and metric strip; the two screens compose these components without moving business logic.

**Tech Stack:** Expo 54, React Native 0.81, React Navigation 7, `expo-linear-gradient`, Ionicons, Playwright smoke tests against an isolated Expo Web export.

---

## File map

- Create `components/cyber/theme.js`: app-wide Xiaoli semantic colors and gradients, derived from the approved homepage palette.
- Create `components/cyber/XiaoliAssistantButton.js`: reusable assistant entry using `assets/xiaoli/hero.png` with a small `AI` label.
- Create `components/cyber/ListPageChrome.js`: shared page header, icon button, search field, filter chip, metric strip, and section heading for data-heavy pages.
- Create `components/cyber/index.js`: public exports for the cyber presentation layer.
- Modify `components/home/theme.js`: re-export the centralized palette so the homepage and business pages cannot drift.
- Modify `screens/OrdersScreen.js`: apply the approved order-page layout while preserving fetch, delete, status-change, permissions, and navigation.
- Modify `screens/ModelsScreen.js`: apply the approved model-page layout while preserving fetch, source filter, view switch, permissions, protected images, and navigation.
- Modify `navigation/TabNavigator.js`: hide duplicated native headers on Orders and Models.
- Modify `navigation/CyberTabBar.js`: use the cyber page background behind Home, Orders, and Models.
- Modify `App.js`: suppress the old floating assistant button only on screens that provide the new header assistant entry.
- Create `tests/client/orders-models-ui.smoke.cjs`: isolated browser fixtures, interaction assertions, overflow checks, and screenshots.
- Create `docs/ui-concepts/xiaoli-orders-*.png` and `docs/ui-concepts/xiaoli-models-*.png`: generated verification screenshots.

### Task 1: Lock the approved behavior in a failing browser smoke test

**Files:**
- Create: `tests/client/orders-models-ui.smoke.cjs`

- [ ] **Step 1: Create the test fixture server and API interception**

Use the same exported-app server and login path as `tests/client/home-ui.smoke.cjs`. Define orders with total, due date, and line-item data, and models with source, description, files, and images:

```js
const orders = [
  {
    id: 'demo-001',
    customer: { name: '创意花瓶订单' },
    status: 'in_progress',
    total: 368,
    dueDate: '2026-09-18',
    createdAt: '2026-09-11T10:00:00Z',
    items: [{ modelName: '流线花瓶', materialType: 'PLA', color: '珠光白', quantity: 2 }],
  },
  {
    id: 'demo-002',
    customer: { name: '机械齿轮组件' },
    status: 'pending_review',
    total: 520,
    dueDate: '2026-09-20',
    createdAt: '2026-09-10T10:00:00Z',
    items: [{ modelName: '齿轮组', materialType: 'PETG', color: '深灰', quantity: 4 }],
  },
];

const models = [
  { id: 'model-001', name: '流线花瓶 v2', source: 'original', description: '参数化曲面花瓶', files: [{ id: 1 }], images: [], updatedAt: '2026-09-12T10:00:00Z' },
  { id: 'model-002', name: '机械齿轮组', source: 'imported', description: '高精度啮合组件', files: [{ id: 2 }, { id: 3 }], images: [], updatedAt: '2026-09-10T10:00:00Z' },
];
```

Route `/api/orders` to `{ items, total: items.length }`, route `/api/models` to `{ items: models, total: models.length }`, and retain the system/auth fixtures from the homepage smoke test.

- [ ] **Step 2: Add assertions for the Orders page**

```js
await page.getByRole('tab', { name: '订单', exact: true }).click();
await page.getByText('订单中心', { exact: true }).waitFor();
assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手' }).count(), 1);
await page.getByPlaceholder('搜索客户、订单号或备注').fill('机械');
assert.ok(requests.some(url => /orders\?.*search=.*%E6%9C%BA%E6%A2%B0/.test(url)));
await page.getByRole('button', { name: '待审核' }).click();
assert.ok(requests.some(url => /orders\?.*status=pending_review/.test(url)));
await page.getByText('机械齿轮组件', { exact: true }).click();
assert.ok(requests.some(url => url.includes('/orders/demo-002')));
```

- [ ] **Step 3: Add assertions for the Models page**

```js
await page.getByRole('tab', { name: '模型', exact: true }).click();
await page.getByText('模型图鉴', { exact: true }).waitFor();
assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手' }).count(), 1);
await page.getByPlaceholder('搜索模型名称、描述或文件名').fill('齿轮');
assert.ok(requests.some(url => /models\?.*search=.*%E9%BD%BF%E8%BD%AE/.test(url)));
await page.getByRole('button', { name: '导入' }).click();
assert.ok(requests.some(url => /models\?.*source=imported/.test(url)));
await page.getByRole('button', { name: '切换为网格视图' }).click();
await page.getByText('机械齿轮组', { exact: true }).click();
assert.ok(requests.some(url => url.includes('/models/model-002')));
```

- [ ] **Step 4: Add day/night and narrow-screen screenshots**

For `light` and `dark`, capture 390px screenshots before switching pages and then resize to 320px. Assert no horizontal overflow:

```js
await page.screenshot({ path: path.join(output, `xiaoli-orders-${mode}-implemented.png`) });
await page.setViewportSize({ width: 320, height: 740 });
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.screenshot({ path: path.join(output, `xiaoli-orders-${mode}-narrow.png`) });
```

Repeat with `xiaoli-models-${mode}-implemented.png` and `xiaoli-models-${mode}-narrow.png` after navigating to Models.

- [ ] **Step 5: Export and run the test to verify the new contract fails**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/xiaoli-export
$env:NODE_PATH='C:\Users\sword\.codex\skills\browser-cdp\node_modules'
node tests/client/orders-models-ui.smoke.cjs
```

Expected: FAIL because the current screens do not expose the persistent cyber controls or `打开小鲤 AI 助手` button.

- [ ] **Step 6: Commit the isolated failing test**

```powershell
git add tests/client/orders-models-ui.smoke.cjs
git commit -m "test(ui): specify Xiaoli orders and models experience"
```

### Task 2: Centralize the Xiaoli palette and build list-page chrome

**Files:**
- Create: `components/cyber/theme.js`
- Create: `components/cyber/XiaoliAssistantButton.js`
- Create: `components/cyber/ListPageChrome.js`
- Create: `components/cyber/index.js`
- Modify: `components/home/theme.js`

- [ ] **Step 1: Create the centralized palette**

```js
export const cyberTheme = (dark) => dark ? {
  background: '#151329', surface: '#24213E', glass: '#292443E8', surfaceMuted: '#211D38',
  border: '#4D446F', borderStrong: '#6A5C91', text: '#F1EDFF', muted: '#B6B0D4',
  primary: '#B39AFF', primarySoft: '#3A3158', pink: '#F399D7', pinkSoft: '#3B2742',
  blue: '#70D7FF', blueSoft: '#203B4D', success: '#8FD7B3', danger: '#F08F9B',
  hero: ['#292559', '#49427A', '#262343'], pinkCard: ['#392541', '#27223D'],
  blueCard: ['#20374B', '#24233F'], glow: '#8372EB', onAccent: '#FFFFFF',
} : {
  background: '#F2F1FF', surface: '#FFFFFF', glass: '#FFFFFFE8', surfaceMuted: '#F8F6FF',
  border: '#E4DEFF', borderStrong: '#CFC4F4', text: '#201A58', muted: '#62628B',
  primary: '#7351E8', primarySoft: '#EEE9FF', pink: '#D72DAC', pinkSoft: '#FFF0FC',
  blue: '#0089C9', blueSoft: '#E6F8FF', success: '#3F9B72', danger: '#C95368',
  hero: ['#969DF6', '#C2B8FF', '#E6E7FF'], pinkCard: ['#FFF0FC', '#F8F3FF'],
  blueCard: ['#E6F8FF', '#F1F2FF'], glow: '#B6A2FF', onAccent: '#FFFFFF',
};
```

Replace `components/home/theme.js` with this compatibility re-export:

```js
export { cyberTheme } from '../cyber/theme';
```

- [ ] **Step 2: Create the portrait assistant button**

`XiaoliAssistantButton` must use the same image as the homepage and expose one clear accessibility label:

```js
const xiaoliImage = require('../../assets/xiaoli/hero.png');

export default function XiaoliAssistantButton({ onPress, theme }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="打开小鲤 AI 助手" onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: theme.primarySoft, borderColor: theme.borderStrong }, pressed && styles.pressed]}>
      <View style={styles.crop}><Image source={xiaoliImage} resizeMode="cover" style={styles.image} /></View>
      <View style={[styles.badge, { backgroundColor: theme.primary, borderColor: theme.background }]}>
        <Text style={styles.badgeText}>AI</Text>
      </View>
    </Pressable>
  );
}
```

Use a 44×44 outer button, a 38×38 clipped portrait, `styles.image = { width: 54, height: 61, left: -8, top: -1 }`, and a 17×14 AI badge anchored at the lower right.

- [ ] **Step 3: Create `ListPageChrome.js`**

Create these presentation-only components in the same file:

```js
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import XiaoliAssistantButton from './XiaoliAssistantButton';
import { cyberTheme } from './theme';

const useCyberStyles = () => {
  const { isDark } = useAppTheme();
  const theme = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return { theme, styles };
};

export function CyberPageHeader({ eyebrow, title, subtitle, onAssistant, actions }) {
  const { theme, styles } = useCyberStyles();
  return <View style={styles.header}>
    <View style={styles.headerCopy}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
    <View style={styles.headerActions}>
      {actions}
      <XiaoliAssistantButton onPress={onAssistant} theme={theme} />
    </View>
  </View>;
}

export function CyberIconButton({ icon, label, active, onPress }) {
  const { theme, styles } = useCyberStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, pressed && styles.pressed]}>
    <Ionicons name={icon} size={20} color={active ? theme.primary : theme.muted} />
  </Pressable>;
}

export function CyberSearchField({ value, onChangeText, placeholder }) {
  const { theme, styles } = useCyberStyles();
  return <View style={styles.search}>
    <Ionicons name="search" size={19} color={theme.muted} />
    <TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={theme.muted}
      value={value} onChangeText={onChangeText} returnKeyType="search" style={styles.searchInput} />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="清除搜索" onPress={() => onChangeText('')} style={styles.clear}>
      <Ionicons name="close" size={17} color={theme.muted} />
    </Pressable> : null}
  </View>;
}

export function CyberChip({ label, active, color, onPress }) {
  const { theme, styles } = useCyberStyles();
  const tint = color || theme.primary;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
    style={({ pressed }) => [styles.chip, active && { backgroundColor: `${tint}18`, borderColor: tint }, pressed && styles.pressed]}>
    <Text numberOfLines={1} style={[styles.chipText, active && { color: tint }]}>{label}</Text>
  </Pressable>;
}

export function CyberMetricStrip({ metrics }) {
  const { theme, styles } = useCyberStyles();
  const tones = { primary: [theme.primary, theme.primarySoft], pink: [theme.pink, theme.pinkSoft], blue: [theme.blue, theme.blueSoft] };
  return <View style={styles.metrics}>{metrics.map((metric) => {
    const [color, backgroundColor] = tones[metric.tone] || tones.primary;
    return <View key={metric.label} style={[styles.metric, { backgroundColor, borderColor: `${color}55` }]}>
      <Text style={styles.metricLabel}>{metric.label}</Text><Text style={[styles.metricValue, { color }]}>{metric.value}</Text>
    </View>;
  })}</View>;
}

export function CyberSectionHeading({ title, hint }) {
  const { styles } = useCyberStyles();
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionHint}>{hint}</Text></View>;
}

const createStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  headerCopy: { flex: 1, minWidth: 0 }, eyebrow: { color: t.primary, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: t.text, fontSize: 27, lineHeight: 33, fontWeight: '900', letterSpacing: -0.7 }, subtitle: { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 }, iconButton: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.border },
  iconButtonActive: { backgroundColor: t.primarySoft, borderColor: t.borderStrong }, pressed: { opacity: 0.72 },
  search: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10, paddingLeft: 14, paddingRight: 4, borderWidth: 1, borderColor: t.border, borderRadius: 17, backgroundColor: t.glass },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 11, color: t.text, fontSize: 14, lineHeight: 20 }, clear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chip: { height: 34, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: t.border, borderRadius: 999, backgroundColor: t.glass }, chipText: { color: t.muted, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  metrics: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 }, metric: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 15, borderWidth: 1 },
  metricLabel: { color: t.muted, fontSize: 10, lineHeight: 14 }, metricValue: { marginTop: 1, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  sectionHeading: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }, sectionTitle: { color: t.text, fontSize: 14, lineHeight: 19, fontWeight: '900' }, sectionHint: { color: t.muted, fontSize: 10, lineHeight: 14 },
});
```

All six components receive the palette from `useAppTheme().isDark` and `cyberTheme(isDark)`. They must not import API, auth, permission, or navigation modules. `CyberPageHeader` renders actions before the assistant portrait so the right edge consistently identifies Xiaoli.

- [ ] **Step 4: Export the presentation layer**

```js
export { cyberTheme } from './theme';
export { default as XiaoliAssistantButton } from './XiaoliAssistantButton';
export {
  CyberPageHeader,
  CyberIconButton,
  CyberSearchField,
  CyberChip,
  CyberMetricStrip,
  CyberSectionHeading,
} from './ListPageChrome';
```

- [ ] **Step 5: Export the app components and verify Expo compilation**

Add to `components/index.js`:

```js
export * from './cyber';
```

Run `npx expo export --platform web --output-dir .tmp/xiaoli-export`.

Expected: PASS with no missing module, asset, or JSX errors.

- [ ] **Step 6: Commit the reusable visual foundation**

```powershell
git add components/cyber components/home/theme.js components/index.js
git commit -m "feat(ui): add shared Xiaoli list-page chrome"
```

### Task 3: Restyle Orders without changing its business flow

**Files:**
- Modify: `screens/OrdersScreen.js`

- [ ] **Step 1: Switch the screen to the cyber palette and persistent controls**

Import `useSafeAreaInsets` from `react-native-safe-area-context`, and import the new cyber components. Replace `const { colors } = useAppTheme()` with:

```js
const { isDark } = useAppTheme();
const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
const styles = React.useMemo(() => createStyles(t), [t]);
```

Remove `showSearch` and `showFilter`; the approved layout keeps search and filter controls visible. Leave `fetchOrders`, both write handlers, both effects, and `StatusActionSheet` logic unchanged.

- [ ] **Step 2: Add local, display-only metrics**

```js
const orderMetrics = React.useMemo(() => [
  { label: '当前列表', value: orders.length, tone: 'primary' },
  { label: '待审核', value: orders.filter((order) => order.status === 'pending_review').length, tone: 'pink' },
  { label: '执行中', value: orders.filter((order) => order.status === 'in_progress').length, tone: 'blue' },
], [orders]);
```

These metrics describe the currently loaded list only and must not create additional requests or claim server-wide totals.

- [ ] **Step 3: Replace the top-level JSX chrome**

```jsx
<CyberPageHeader
  eyebrow="ORDER QUEUE"
  title="订单中心"
  subtitle="今天的委托，也要稳稳送达。"
  onAssistant={() => navigation.navigate(ROUTES.AGENT)}
  actions={canWrite(user) ? (
    <CyberIconButton icon="add" label="新建订单" active onPress={() => navigation.navigate(ROUTES.CREATE_ORDER)} />
  ) : null}
/>
<CyberSearchField value={searchQuery} onChangeText={setSearchQuery} placeholder="搜索客户、订单号或备注" />
<CyberMetricStrip metrics={orderMetrics} />
<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
  <CyberChip label="全部" active={filterStatus === 'all'} onPress={() => setFilterStatus('all')} />
  {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => (
    <CyberChip key={status} label={label} active={filterStatus === status} color={getOrderStatusColor(status, t)} onPress={() => setFilterStatus(status)} />
  ))}
</ScrollView>
<CyberSectionHeading title="订单列表" hint={canWrite(user) ? '长按可更新状态' : `${orders.length} 条结果`} />
```

Replace only the existing `ScreenHeader`, optional `SearchBar`, and filter `ScrollView` block with the snippet above. Add `<View style={styles.page}>` immediately inside `SafeAreaView` and close it immediately before `</SafeAreaView>`; the existing loading branch, `FlatList`, `EmptyState`, and `StatusActionSheet` stay inside that view without callback changes. The retained branch uses `t.primary` for refresh/loading.

- [ ] **Step 4: Apply the approved order-card hierarchy**

Keep the existing values and actions. Add the status rail as the first child of `Card`:

```jsx
<View style={[styles.statusRail, { backgroundColor: statusColor }]} />
```

Apply these exact style changes while keeping the 44px delete target and busy indicators:

```js
orderCard: { position: 'relative', overflow: 'hidden', marginHorizontal: 0, marginBottom: 10, borderRadius: 20, backgroundColor: t.glass, borderColor: t.border },
statusRail: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingLeft: 6 },
metaGrid: { flexDirection: 'row', marginTop: 11, marginLeft: 6 },
metaItem: { flex: 1, minWidth: 0, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: t.border },
itemsPreview: { marginTop: 9, marginLeft: 6, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 11, backgroundColor: t.surfaceMuted },
```

Pass `last={index === 2}` from the three metadata positions and suppress `borderRightWidth` for the last item so the third column has no trailing divider.

Status mapping must be:

```js
const getOrderStatusColor = (status, t) => ({
  draft: t.muted,
  pending_review: t.pink,
  in_progress: t.blue,
  completed: t.success,
  cancelled: t.danger,
}[status] || t.muted);
```

- [ ] **Step 5: Export and verify the Orders screen compiles**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/xiaoli-export
```

Expected: PASS with no missing imports, invalid style values, asset errors, or JSX syntax errors. The complete interaction test remains red until Models is implemented in Task 4.

- [ ] **Step 6: Commit Orders after reviewing its pre-existing `homeRequest` diff**

```powershell
git diff -- screens/OrdersScreen.js
git add screens/OrdersScreen.js
git commit -m "feat(ui): restyle Xiaoli order center"
```

The commit intentionally retains the already-related `homeRequest` dependency required by the homepage handoff.

### Task 4: Restyle Models without changing its asset flow

**Files:**
- Modify: `screens/ModelsScreen.js`

- [ ] **Step 1: Switch Models to the shared palette**

Use `isDark`, `cyberTheme`, and the same memoized style pattern as Orders. Keep `getPreferredImage`, `buildImageSource`, `fetchModels`, the focus refresh, and `authToken` unchanged.

- [ ] **Step 2: Replace the cycling filter with explicit accessible chips**

Remove `cycleSourceFilter` and render explicit chips so the current backend parameter stays the same while the UI becomes discoverable:

```jsx
<View style={styles.modelTools}>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceChips}>
    {[['all', '全部'], ...Object.entries(SOURCE_LABELS)].map(([source, label]) => (
      <CyberChip key={source} label={label} active={sourceFilter === source} onPress={() => setSourceFilter(source)} />
    ))}
  </ScrollView>
  <CyberIconButton
    icon={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
    label={viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
    active
    onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
  />
</View>
```

- [ ] **Step 3: Replace the top-level JSX chrome**

Replace the current `ScreenHeader`, optional `SearchBar`, and filter hint with this block:

```jsx
<CyberPageHeader
  eyebrow="MODEL LIBRARY"
  title="模型图鉴"
  subtitle="把灵感和打印资产都收藏在这里。"
  onAssistant={() => navigation.navigate(ROUTES.AGENT)}
  actions={canWrite(user) ? (
    <CyberIconButton icon="add" label="新建模型" active onPress={() => navigation.navigate(ROUTES.CREATE_MODEL)} />
  ) : null}
/>
<CyberSearchField value={searchQuery} onChangeText={setSearchQuery} placeholder="搜索模型名称、描述或文件名" />
<View style={styles.modelTools}>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceChips}>
    {[['all', '全部'], ...Object.entries(SOURCE_LABELS)].map(([source, label]) => (
      <CyberChip key={source} label={label} active={sourceFilter === source} onPress={() => setSourceFilter(source)} />
    ))}
  </ScrollView>
  <CyberIconButton
    icon={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
    label={viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
    active
    onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
  />
</View>
<CyberSectionHeading title="模型资产" hint={`共 ${models.length} 个模型`} />
```

Keep the existing `FlatList`, view-mode `key`, refresh control, EmptyState, and detail callback immediately after this block.

- [ ] **Step 4: Apply the approved model-card hierarchy**

For grid mode, keep two columns and render a 1.22 aspect-ratio preview, source badge at the preview's upper right, name, two-line description, file/image pills, and date. For list mode, retain a 118px preview and compact horizontal card. Keep protected image URLs and cover precedence unchanged. Apply:

```js
listCard: { minHeight: 132, flexDirection: 'row', overflow: 'hidden', marginHorizontal: 0, borderRadius: 20, backgroundColor: t.glass, borderColor: t.border },
gridCard: { minHeight: 238, overflow: 'hidden', marginHorizontal: 0, borderRadius: 20, backgroundColor: t.glass, borderColor: t.border },
listPreviewBox: { width: 118, minHeight: 132, backgroundColor: t.primarySoft },
gridPreviewBox: { width: '100%', aspectRatio: 1.22, backgroundColor: t.primarySoft },
metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 26, paddingHorizontal: 8, borderRadius: 999, backgroundColor: t.surfaceMuted },
```

Set Web maximum content width on the page container:

```js
page: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center' },
gridCardContainer: { flex: 1, maxWidth: '50%', paddingHorizontal: 4, marginBottom: 12 },
```

- [ ] **Step 5: Export and run the full first-unit smoke test**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/xiaoli-export
$env:NODE_PATH='C:\Users\sword\.codex\skills\browser-cdp\node_modules'
node tests/client/orders-models-ui.smoke.cjs
```

Expected: PASS for both screens, both themes, both widths, filters, view switch, detail navigation, and no page errors.

- [ ] **Step 6: Commit Models after reviewing its pre-existing Xiaoli copy diff**

```powershell
git diff -- screens/ModelsScreen.js
git add screens/ModelsScreen.js
git commit -m "feat(ui): restyle Xiaoli model library"
```

The commit intentionally retains the existing `小麦` to `小鲤` empty-state copy update from the homepage handoff.

### Task 5: Remove duplicated navigation chrome on the two accepted screens

**Files:**
- Modify: `navigation/TabNavigator.js`
- Modify: `navigation/CyberTabBar.js`
- Modify: `App.js`

- [ ] **Step 1: Hide the native tab header on Orders and Models**

```jsx
<Tab.Screen name={ROUTES.ORDERS} component={OrdersScreen}
  options={{ title: SCREEN_TITLES[ROUTES.ORDERS], headerShown: false }} />
<Tab.Screen name={ROUTES.MODELS} component={ModelsScreen}
  options={{ title: SCREEN_TITLES[ROUTES.MODELS], headerShown: false }} />
```

- [ ] **Step 2: Match the bottom safe-area background**

In `CyberTabBar`, define:

```js
const cyberRoutes = new Set([ROUTES.HOME, ROUTES.ORDERS, ROUTES.MODELS]);
const pageBackground = cyberRoutes.has(state.routes[state.index].name) ? t.background : colors.background;
```

Use `pageBackground` for the shell so unconverted Materials and Settings retain their current background until their phase.

- [ ] **Step 3: Avoid the duplicate draggable assistant on these screens**

In `App.js`, extend the existing homepage check:

```js
const routesWithEmbeddedAssistant = new Set([ROUTES.HOME, ROUTES.ORDERS, ROUTES.MODELS]);
if (!routeName || routesWithEmbeddedAssistant.has(routeName)) return null;
```

Do not change the navigation target or authentication condition.

- [ ] **Step 4: Run the smoke test and inspect assistant counts**

Run `node tests/client/orders-models-ui.smoke.cjs` with the Playwright `NODE_PATH` set.

Expected: PASS; each converted screen exposes exactly one `打开小鲤 AI 助手` control and no old paw FAB overlays the content.

- [ ] **Step 5: Commit navigation integration after reviewing existing homepage changes**

```powershell
git diff -- App.js navigation/TabNavigator.js navigation/CyberTabBar.js
git add App.js navigation/TabNavigator.js navigation/CyberTabBar.js
git commit -m "feat(ui): integrate Xiaoli chrome with primary tabs"
```

These files already contain the uncommitted homepage tab-bar work described in the handoff; review the combined diff and do not stage unrelated self-hosted distribution files.

### Task 6: Verify and present the runnable acceptance unit

**Files:**
- Update: `docs/superpowers/plans/2026-09-13-xiaoli-orders-models-implementation.md`
- Generated: `docs/ui-concepts/xiaoli-orders-light-implemented.png`
- Generated: `docs/ui-concepts/xiaoli-orders-dark-implemented.png`
- Generated: `docs/ui-concepts/xiaoli-orders-light-narrow.png`
- Generated: `docs/ui-concepts/xiaoli-orders-dark-narrow.png`
- Generated: `docs/ui-concepts/xiaoli-models-light-implemented.png`
- Generated: `docs/ui-concepts/xiaoli-models-dark-implemented.png`
- Generated: `docs/ui-concepts/xiaoli-models-light-narrow.png`
- Generated: `docs/ui-concepts/xiaoli-models-dark-narrow.png`

- [ ] **Step 1: Run client verification**

Run `npm run verify:client`.

Expected: all current lifecycle and address checks pass.

- [ ] **Step 2: Run three-platform static export**

Run `npx expo export --platform all --output-dir .tmp/xiaoli-export`.

Expected: Android, iOS, and Web bundles complete with no Metro errors.

- [ ] **Step 3: Run both UI smoke suites**

```powershell
$env:NODE_PATH='C:\Users\sword\.codex\skills\browser-cdp\node_modules'
node tests/client/home-ui.smoke.cjs
node tests/client/orders-models-ui.smoke.cjs
```

Expected: both scripts exit 0, report no page errors, and generate all screenshots.

- [ ] **Step 4: Visually inspect the eight new screenshots**

Confirm:

- the page is recognizably from the same product as the current homepage;
- the assistant portrait is the actual Xiaoli character and not an Emoji;
- the 320px layout has no clipped title, actions, chips, cards, or bottom navigation;
- day/night layouts are identical apart from color and effect intensity;
- order delete/status and model create/view controls remain discoverable.

- [ ] **Step 5: Record exact verification results in this plan**

Append command outcomes, screenshot paths, and any accepted visual deviations under a `## Verification results` section. Do not use placeholders; record the actual pass/fail output.

- [ ] **Step 6: Commit only the completed first acceptance unit**

```powershell
git status --short
git add tests/client/orders-models-ui.smoke.cjs components/cyber components/home/theme.js components/index.js screens/OrdersScreen.js screens/ModelsScreen.js App.js navigation/TabNavigator.js navigation/CyberTabBar.js docs/ui-concepts/xiaoli-orders-*.png docs/ui-concepts/xiaoli-models-*.png docs/superpowers/plans/2026-09-13-xiaoli-orders-models-implementation.md
git commit -m "feat(ui): deliver Xiaoli orders and models refresh"
```

Before committing, inspect `git diff --cached --stat` and `git diff --cached`; unstage any self-hosted distribution documents, Android generated files, APKs, or unrelated user work.

## Verification results

- `npm run verify:client`: PASS. All eight client lifecycle tests passed, followed by the client address verification.
- `npx expo export --platform all --output-dir .tmp/xiaoli-export`: PASS. Web, Android, and iOS bundles completed without Metro errors.
- `node tests/client/home-ui.smoke.cjs`: PASS in light and dark themes. Homepage counts, production navigation, retry state, and narrow layout remained intact.
- `node tests/client/orders-models-ui.smoke.cjs`: PASS in light and dark themes. Orders and Models search/filter requests, model view switch, detail navigation, one Xiaoli assistant entry per page, and 320px overflow checks passed.
- The legacy homepage smoke server now requests an operating-system-assigned free port instead of fixed port `4179`; this removes a Windows `EACCES` test-environment failure without changing application behavior.
- All eight acceptance screenshots were regenerated under `docs/ui-concepts/`: `xiaoli-orders-{light,dark}-{implemented,narrow}.png` and `xiaoli-models-{light,dark}-{implemented,narrow}.png`.
- Visual inspection: both screens share the homepage's blue-purple palette, rounded glass surfaces, icon language, and actual Xiaoli portrait. The assistant uses the project character asset with a compact `AI` badge, not an Emoji.
- Accepted refinement: Models opens in the approved two-column illustrated catalogue view; its accessible toggle therefore reads `切换为列表视图`. Order dates use `MM-DD` in cards to prevent clipping at 320px.
- No implementation commit was created at this checkpoint because the working tree already contains related, uncommitted homepage handoff changes in shared files. Keeping this acceptance unit uncommitted avoids accidentally absorbing unrelated user work or producing an incomplete commit that omits those dependencies.
