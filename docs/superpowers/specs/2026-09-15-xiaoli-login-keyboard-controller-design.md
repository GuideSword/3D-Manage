# 小鲤与登录页键盘控制器修复设计

## 背景与复现证据

用户提供的 Android 录屏显示：小鲤聊天页唤起虚拟键盘后，图片附件栏位于键盘上方，但真正的文字输入栏仍被压在键盘下方。登录页截图显示：键盘升起后，表单下半部分被遮挡，页面不会主动把当前编辑区域滚入可视范围。

现有实现分别使用 React Native 内置 `KeyboardAvoidingView`：

- 小鲤聊天页在 Android 使用 `height`，但实机仍发生底部子视图遮挡。
- 登录页在 Android 不设置 `behavior`，内部普通 `ScrollView` 也不感知当前聚焦输入框。

因此本轮不再继续微调同一套内置避让参数，改用能直接跟踪原生 IME 位置和聚焦输入框的 Keyboard Controller。

## 目标

- Android 和 iOS 键盘升起、收起或切换高度时，小鲤文字输入栏始终完整可见。
- 小鲤图片附件栏和文字输入栏作为一个底部编辑区域共同避让键盘。
- 保留输入框最多 5 行、超过后内部滚动的现有行为。
- 登录页聚焦邮箱或密码时，当前输入框自动滚动到键盘上方，并保留适当间距。
- 键盘关闭后，登录页仍保持当前居中的视觉布局。
- 不改变登录校验、认证、聊天消息、图片附件和发送流程。
- 首轮验证可直接在 Expo SDK 54 对应版本的 Expo Go 中完成；正式 APK 在全部交互确认后再构建。

## 依赖与兼容性

通过 Expo 安装器添加以下依赖，由 Expo SDK 54 选择兼容版本：

- `react-native-keyboard-controller`，项目本地 Expo 兼容清单为 `1.18.5`。
- `react-native-reanimated`，项目本地 Expo 兼容清单为 `~4.1.1`。

这两个原生模块已包含在 Expo SDK 54 对应的 Expo Go 客户端中，因此安装匹配版本后可以直接连接 Metro 验证。若以后升级依赖到 Expo Go 未内置的版本，或改变原生配置，则需要重新构建 Development Build 或 APK。

## 架构

### 根节点键盘上下文

在应用根节点外层增加一个 `KeyboardProvider`，为登录页和小鲤聊天页提供同一份原生键盘动画与位置数据。

不主动设置 `statusBarTranslucent` 或 `navigationBarTranslucent`，避免重复覆盖 Expo SDK 54 已启用的 edge-to-edge 行为。验收时额外检查登录页、小鲤原生导航标题以及系统状态栏是否保持原位置，防止 Provider 引入新的系统栏偏移。

### 小鲤聊天页

将 React Native 内置 `KeyboardAvoidingView` 替换为 Keyboard Controller 提供的同名组件，使用适合聊天与弹性布局的 `translate-with-padding` 行为。

通过 React Navigation 的 `useHeaderHeight()` 获取真实标题栏高度，不再依赖固定的 `88` 偏移。消息列表、附件栏和输入栏继续保持当前兄弟结构，由控制器在键盘移动时统一调整可用空间。这样既避免 `height` 模式在录屏设备上裁切底部子视图，也不会拆散附件栏与文字输入栏。

现有五行布局策略继续负责文字输入框自身高度：默认字号最多显示 5 行，超出后在输入框内部滚动；系统大字体可以显示少于 5 行，但全部文字仍可访问。

### 登录页

移除登录页外层 React Native `KeyboardAvoidingView`，将普通 `ScrollView` 替换为 Keyboard Controller 的 `KeyboardAwareScrollView`。

它继续使用现有 `contentContainerStyle`、`keyboardShouldPersistTaps` 和表单结构，并设置小幅 `bottomOffset`，保证邮箱或密码输入框与键盘顶部之间留有可见间距。组件根据焦点变化自动滚动，无需为两个字段分别维护坐标或编写延时逻辑。

页面内容不超过屏幕时仍由 `flexGrow: 1` 与 `justifyContent: 'center'` 居中；键盘出现且空间不足时，滚动容器负责移动聚焦字段。

## 数据与状态流

键盘控制器只影响布局，不进入业务状态：

1. `KeyboardProvider` 从原生 IME 接收位置和动画进度。
2. 小鲤的控制器避让容器根据键盘高度调整聊天布局。
3. 登录页的感知滚动容器根据键盘位置和当前焦点调整滚动偏移。
4. 原有输入值仍分别由 `input` 和 `formData` 控制；发送、登录、失败恢复逻辑保持不变。

## 异常与降级

- Web 平台仍可加载组件，但没有移动端 IME 时不发生位移。
- 如果 Expo Go 版本与项目 SDK 54 不匹配，应先更新到支持 SDK 54 的 Expo Go，而不是通过代码回退到已证实不可靠的内置 Android 避让。
- 如果 Provider 导致系统栏位置变化，优先校正 Provider 与 edge-to-edge 的配置，并用登录页和小鲤标题栏进行回归验证。
- 不修改 Android `adjustResize` 配置；Keyboard Controller 在 edge-to-edge 下负责消费 IME 信息并调整 React Native 布局。

## 验证

### 自动检查

- 验证 Expo 安装器选择的依赖版本与 SDK 54 兼容。
- 验证应用根节点存在唯一 `KeyboardProvider`。
- 验证小鲤使用 Keyboard Controller 的避让容器、`translate-with-padding` 和动态标题栏偏移。
- 验证登录页使用 `KeyboardAwareScrollView`，保留点击与居中布局契约。
- 运行现有小鲤图片、发送、登录错误和应用 UI 冒烟测试。
- 完成 Expo Web 导出，确认新增依赖不会破坏 Web 打包。

### Expo Go 真机验收

使用用户录屏中的同一台 Android 设备和输入法：

1. 打开小鲤，聚焦文字输入框，确认附件栏、文字输入框和发送按钮全部位于键盘上方。
2. 在普通字母键盘、输入法工具面板、表情面板之间切换，确认输入栏持续跟随键盘高度。
3. 输入 1 至 6 行文字，确认输入框最多占五行高度且内部可以上下滑动。
4. 收起并重新打开键盘，确认输入栏恢复和跟随位置均正确。
5. 进入登录页，分别聚焦邮箱和密码，确认当前字段自动滚动到键盘上方。
6. 保持键盘打开并在两个字段间切换，确认滚动方向和间距正确。
7. 收起键盘，确认登录卡片恢复正常居中，状态栏、导航标题和底部安全区没有新增偏移。

## 完成标准

用户提供的两个遮挡场景在 Expo Go 真机复测中均不再出现；小鲤五行编辑与内部滚动保持可用；登录和聊天业务测试通过；系统栏、导航、Web 构建没有新增回归。
