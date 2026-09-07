# 猫爪工坊 UI 二次开发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 3D 打印管理 APP 改造成已确认的“猫爪工坊”软糯猫娘视觉，并支持跟随系统、日间和夜间三档主题，同时保持现有业务行为不变。

**Architecture:** 新建独立 `ThemeContext`，以语义色令牌驱动 React Navigation、共享组件和全部页面；保留 `COLORS = LIGHT_COLORS` 作为迁移兼容出口。页面按“主题基础层 → 核心标签页 → AI/入口页 → 详情/表单/交易页”迁移，各 worker 拥有互不重叠的文件，主代理负责集成与跨主题回归。

**Tech Stack:** React 19、React Native 0.81、Expo 54、React Navigation 7、Expo SecureStore、Ionicons。

---

## 文件所有权

- Theme worker：`constants/index.js`、`context/ThemeContext.js`、`App.js`、`app.json`、`navigation/AppNavigator.js`、`navigation/TabNavigator.js`、`components/{Card,Button,Input,Picker,Badge,StatusActionSheet,index}.js`，以及新建 `components/ui/*`。
- Core tabs worker：`screens/{Home,Orders,Models,Materials}Screen.js`。
- Assistant worker：`screens/{Settings,Login,AgentChat,AgentSettings,OSSConfig,DataImport}Screen.js`、`navigation/AgentStack.js`、`components/agent/*`。
- Detail/forms worker：`screens/{OrderDetail,ModelDetail,MaterialDetail,CreateOrder,CreateModel,CreateMaterial,InboundTransaction,OutboundTransaction,AdjustTransaction}Screen.js`。
- 主代理只做整合修复、构建验证与必要的小范围跨文件调整；任何所有权变更先通知对应 worker。

### Task 1: 建立日夜主题基础层

**Files:**
- Modify: `constants/index.js`
- Create: `context/ThemeContext.js`
- Modify: `App.js`
- Modify: `app.json`
- Modify: `navigation/AppNavigator.js`
- Modify: `navigation/TabNavigator.js`

- [ ] **Step 1: 定义语义主题令牌**

在 `constants/index.js` 中新增 `LIGHT_COLORS`、`DARK_COLORS`，至少提供以下同名字段，并保留兼容出口：

```js
export const LIGHT_COLORS = {
  primary: '#D98A78', primaryDark: '#B8675E', primarySoft: '#F8E7DE',
  accent: '#9A7EB9', accentSoft: '#EEE7F5', success: '#78A28D',
  successSoft: '#E7F0E9', warning: '#C98A62', warningSoft: '#FAEBDD',
  danger: '#C86565', dangerSoft: '#F8E2E1', info: '#7D8FB3', infoSoft: '#E9EDF5',
  background: '#FFFAF4', surface: '#F7ECE4', surfaceElevated: '#FFFFFF',
  surfaceMuted: '#FCF4EE', text: '#4C403B', textSecondary: '#806F66',
  textTertiary: '#A28D82', border: '#EEDFD6', borderStrong: '#DFC9BB',
  onPrimary: '#FFFFFF', onDanger: '#FFFFFF', overlay: 'rgba(45,36,49,0.42)',
};

export const DARK_COLORS = {
  primary: '#E4A19D', primaryDark: '#F0B5AE', primarySoft: '#46313C',
  accent: '#C2AAD9', accentSoft: '#3A3145', success: '#9FC8B5',
  successSoft: '#2E4038', warning: '#DDB08D', warningSoft: '#46382F',
  danger: '#E49A9A', dangerSoft: '#4A3034', info: '#A9B7D5', infoSoft: '#303745',
  background: '#201D29', surface: '#25212C', surfaceElevated: '#292530',
  surfaceMuted: '#302A39', text: '#EEE8F3', textSecondary: '#B9ADBF',
  textTertiary: '#8F8495', border: '#3E3747', borderStrong: '#51485C',
  onPrimary: '#2B2126', onDanger: '#2A1D20', overlay: 'rgba(8,6,12,0.68)',
};

export const COLORS = LIGHT_COLORS;
```

- [ ] **Step 2: 新建主题上下文并持久化三档选择**

`context/ThemeContext.js` 使用 `useColorScheme()` 和 `utils/storage.js`，公开稳定接口：

```js
const THEME_STORAGE_KEY = 'ui.themeMode';
const VALID_MODES = new Set(['system', 'light', 'dark']);

export const ThemeProvider = ({ children }) => { /* 读取存储；解析 system；写入失败不阻断 UI */ };
export const useAppTheme = () => { /* 返回 themeMode, resolvedScheme, isDark, colors, shadows, setThemeMode */ };
```

初始渲染按系统主题显示；存储值非法时回退 `system`；系统主题变化只在 `themeMode === 'system'` 时生效。

- [ ] **Step 3: 接入应用壳和导航主题**

`App.js` 用 `ThemeProvider` 包裹 `AuthProvider`，内部组件通过 `isDark` 设置：

```jsx
<StatusBar style={isDark ? 'light' : 'dark'} />
```

`AppNavigator.js` 基于 `DefaultTheme` / `DarkTheme` 扩展导航主题，不给 Navigator 增加 `key`。`TabNavigator.js` 用主题色重绘标签栏与头部。`app.json` 将 `userInterfaceStyle` 改为 `automatic`。

- [ ] **Step 4: 运行主题基础层静态检查**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/cat-workshop-theme
```

Expected: Metro bundling completes and `.tmp/cat-workshop-theme` contains `index.html` without JSX/import errors.

- [ ] **Step 5: 提交基础主题**

```powershell
git add constants/index.js context/ThemeContext.js App.js app.json navigation/AppNavigator.js navigation/TabNavigator.js
git commit -m "feat(ui): add cat workshop day and night themes"
```

### Task 2: 主题化共享组件与页面骨架

**Files:**
- Modify: `components/Card.js`
- Modify: `components/Button.js`
- Modify: `components/Input.js`
- Modify: `components/Picker.js`
- Modify: `components/Badge.js`
- Modify: `components/StatusActionSheet.js`
- Modify: `components/index.js`
- Create: `components/ui/ScreenHeader.js`
- Create: `components/ui/SearchBar.js`
- Create: `components/ui/EmptyState.js`
- Create: `components/ui/ThemeModePicker.js`

- [ ] **Step 1: 将共享原语改为动态主题样式**

每个组件调用 `useAppTheme()`，并按颜色缓存样式：

```js
const { colors, shadows } = useAppTheme();
const styles = useMemo(() => createStyles(colors, shadows), [colors, shadows]);
```

保持现有 props API；Card 大卡圆角使用 20px 左右，表单控件使用 14–16px；Button 所有尺寸最小触控高度为 44px；filled 前景色使用 `colors.onPrimary`，不再使用 `surfaceElevated`。

- [ ] **Step 2: 创建四个聚焦的 UI 组件**

```jsx
<ScreenHeader
  eyebrow="MONDAY · 运营概览"
  title="早安，店长喵～"
  actions={<Button title="导出" variant="ghost" onPress={handleExport} />}
/>
<SearchBar
  value={query}
  onChangeText={setQuery}
  placeholder="搜索…"
  onClear={() => setQuery('')}
/>
<EmptyState
  icon="paw-outline"
  title="这里还是空的喵"
  actionLabel="新建"
  onAction={() => navigation.navigate(ROUTES.CREATE_ORDER)}
/>
<ThemeModePicker value={themeMode} onChange={setThemeMode} />
```

这些组件只负责展示和事件透传，不发起 API 请求，也不持有业务状态。

- [ ] **Step 3: 主题化 ActionSheet 的模态层**

将 overlay、sheet、禁用项、危险项、选中项与 loading 状态全部改用语义令牌；保持现有权限、状态迁移、恢复、确认和不可关闭逻辑不变。

- [ ] **Step 4: 构建检查并提交**

```powershell
npx expo export --platform web --output-dir .tmp/cat-workshop-components
git add components
git commit -m "feat(ui): theme shared cat workshop components"
```

Expected: export succeeds; no shared component import or hook errors.

### Task 3: 重绘四个核心标签页

**Files:**
- Modify: `screens/HomeScreen.js`
- Modify: `screens/OrdersScreen.js`
- Modify: `screens/ModelsScreen.js`
- Modify: `screens/MaterialsScreen.js`

- [ ] **Step 1: 重绘首页但保留全部数据流**

加入日/夜问候、小麦提醒卡、三张语义统计卡、四个快捷操作和最近订单。保留四 API 并发加载、100g 阈值、focus/下拉刷新、导出逻辑、鉴权错误处理与所有导航参数。

- [ ] **Step 2: 重绘订单任务流**

使用 `ScreenHeader`、`SearchBar`、常驻状态 chips 和紧凑订单卡。保留服务端 status/search、首页 route 参数、删除确认、长按状态操作、终态恢复、busy 防重复和 camel/snake 字段兼容。

- [ ] **Step 3: 重绘模型图鉴**

保留 list/grid、source 轮换筛选、鉴权图片 headers、相对 URL 拼接、cover/auto preview 优先级和创建/详情入口；将网格卡重绘为图鉴式缩略图与柔和元数据区。

- [ ] **Step 4: 重绘耗材仓库**

保留耗材/库存 segmented、并行加载、本地过滤、activeTab 深链、三种库存交易入口、删除和字段兼容；风险同时使用文字、数量和颜色表达。

- [ ] **Step 5: 核心页双主题构建检查并提交**

```powershell
npx expo export --platform web --output-dir .tmp/cat-workshop-core
git add screens/HomeScreen.js screens/OrdersScreen.js screens/ModelsScreen.js screens/MaterialsScreen.js
git commit -m "feat(ui): redraw cat workshop core tabs"
```

Expected: export succeeds; core tabs render under both color schemes without static `COLORS` imports.

### Task 4: 重绘设置、登录和 AI 助手

**Files:**
- Modify: `screens/SettingsScreen.js`
- Modify: `screens/LoginScreen.js`
- Modify: `screens/AgentChatScreen.js`
- Modify: `screens/AgentSettingsScreen.js`
- Modify: `screens/OSSConfigScreen.js`
- Modify: `screens/DataImportScreen.js`
- Modify: `navigation/AgentStack.js`
- Modify: `components/agent/AgentBubble.js`
- Modify: `components/agent/ToolCallCard.js`
- Modify: `components/agent/DraftConfirmCard.js`
- Modify: `components/agent/ImageAttachment.js`
- Modify: `components/agent/DraggableFab.js`

- [ ] **Step 1: 在设置页加入主题三档**

使用 `ThemeModePicker` 展示“跟随系统 / 日间 / 夜间”，调用 `setThemeMode`。保留账号、权限、API 地址、OSS、CSV 和退出登录行为。

- [ ] **Step 2: 重绘登录、OSS 与导入页**

登录页加入低占比猫爪品牌区并保留登录/注册、默认账号提示和验证。OSS/导入页使用统一卡片与表单层级，CSV 示例与文件状态在夜间保持可读。

- [ ] **Step 3: 将 AI 助手作为小麦角色主场**

空状态展示原创小麦符号或低复杂度头像；聊天气泡、Markdown、代码块、工具调用、订单草稿、附件和拖动 FAB 全部使用主题令牌。保留 SSE 流、draft 确认、图片附件、设置入口和拖动吸边行为。

- [ ] **Step 4: 构建检查并提交**

```powershell
npx expo export --platform web --output-dir .tmp/cat-workshop-assistant
git add screens/SettingsScreen.js screens/LoginScreen.js screens/AgentChatScreen.js screens/AgentSettingsScreen.js screens/OSSConfigScreen.js screens/DataImportScreen.js navigation/AgentStack.js components/agent
git commit -m "feat(ui): theme settings login and assistant"
```

Expected: export succeeds; AI modal, theme picker and unauthenticated login route compile.

### Task 5: 重绘详情、创建和库存交易页面

**Files:**
- Modify: `screens/OrderDetailScreen.js`
- Modify: `screens/ModelDetailScreen.js`
- Modify: `screens/MaterialDetailScreen.js`
- Modify: `screens/CreateOrderScreen.js`
- Modify: `screens/CreateModelScreen.js`
- Modify: `screens/CreateMaterialScreen.js`
- Modify: `screens/InboundTransactionScreen.js`
- Modify: `screens/OutboundTransactionScreen.js`
- Modify: `screens/AdjustTransactionScreen.js`

- [ ] **Step 1: 统一三类详情页**

使用身份区、状态 Badge、摘要块、分组 Card、空状态和独立危险区。删除、恢复、状态流转、下载、上传、库存交易导航和所有 API 调用保持原样；危险区不使用可爱化文案或猫娘装饰。

- [ ] **Step 2: 统一三个创建表单**

使用相同的 Form header、section spacing、Input/Picker 与主次按钮。保留 CreateOrder 日期器、动态项目、金额；CreateModel 文件/图片上传与来源；CreateMaterial 规格、价格和备注。

- [ ] **Step 3: 统一三个库存交易页**

入库使用鼠尾草语义色，出库使用暖橙，盘点使用香芋紫；同时显示文字与图标。保留批次选择、数量校验、快捷数量、库存不足和提交行为。

- [ ] **Step 4: 构建检查并提交**

```powershell
npx expo export --platform web --output-dir .tmp/cat-workshop-secondary
git add screens/OrderDetailScreen.js screens/ModelDetailScreen.js screens/MaterialDetailScreen.js screens/CreateOrderScreen.js screens/CreateModelScreen.js screens/CreateMaterialScreen.js screens/InboundTransactionScreen.js screens/OutboundTransactionScreen.js screens/AdjustTransactionScreen.js
git commit -m "feat(ui): theme detail form and inventory screens"
```

Expected: export succeeds and every root-stack screen imports the dynamic theme.

### Task 6: 集成、回归与视觉核验

**Files:**
- Modify: only files required to fix integration defects found below

- [ ] **Step 1: 扫描残留硬编码和静态主题引用**

```powershell
rg -n "#[0-9A-Fa-f]{6}|rgba\(" screens components navigation App.js
rg -n "import .*COLORS|COLORS\." screens components navigation App.js
```

Expected: remaining literals are documented exceptions such as image data; migrated UI files do not depend on static `COLORS`.

- [ ] **Step 2: 执行完整 Web 构建**

```powershell
npx expo export --platform web --output-dir .tmp/cat-workshop-final
npm run verify:backend
```

Expected: frontend export succeeds; backend verification reports all checks passed.

- [ ] **Step 3: 手工回归主题和关键业务路径**

验证未登录登录页、登录后五个 tabs、详情 push、AI modal、Picker/ActionSheet overlay；分别选择 system/light/dark 并刷新确认持久化；检查 360px 窄屏、Web 宽屏、loading/empty/error、上传、删除、恢复、长按状态、三种库存交易和 AI streaming/draft。

- [ ] **Step 4: 对照概念图复核**

对照 `docs/ui-concepts/cat-workshop-day-core-screens.png` 与 `docs/ui-concepts/cat-workshop-day-night-themes.png`，确认猫娘视觉占比不超过 15%、业务名称未游戏化改写、夜间未使用纯黑背景、危险操作保持严肃清晰。

- [ ] **Step 5: 提交集成修复**

```powershell
git add App.js app.json constants context components navigation screens
git commit -m "fix(ui): complete cat workshop theme integration"
```

如果没有集成修复，不创建空提交。
