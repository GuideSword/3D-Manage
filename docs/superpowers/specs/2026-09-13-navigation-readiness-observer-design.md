# 导航就绪事件驱动修复设计

## 目标

消除应用启动阶段的 `navigation object hasn't been initialized yet` 错误，并确保任何当前路由读取都只发生在根导航容器真正就绪之后。

这是一项可靠性与纵深防御修复，不涉及 API、认证令牌、权限模型或后端接口。

## 设计

新增一个无 UI 依赖的路由观察器，统一负责：

1. 注册导航引用的 `ready` 与 `state` 事件。
2. 订阅后立即尝试同步，但先检查 `navigationRef.isReady()`。
3. 仅在就绪时调用 `getCurrentRoute()`，并把路由名交给调用方。
4. 返回清理函数，同时注销两个事件监听器。

`AuthenticatedFab` 的初始路由保持为 `null`，代表“导航状态未知”。未知状态下不渲染全局 AI 悬浮入口，也不发起导航，属于默认关闭的 fail-closed 行为。导航进入 `ready` 状态后同步初始路由，此后由 `state` 事件持续更新。

现有悬浮按钮点击处理中的 `navigationRef.isReady()` 检查继续保留，形成读取与写入两侧的双重保护。

## 模块边界

- `utils/navigationRouteObserver.cjs`：纯 JavaScript 生命周期模块，只依赖传入的导航引用和回调，便于在 Node 环境进行确定性测试。
- `App.js`：使用观察器维护 `routeName`，不再在首次渲染期间直接读取导航引用。
- `tests/client/navigation-route-observer.test.cjs`：覆盖未就绪、就绪、路由变化和取消订阅四种状态。

## 状态流

1. 应用首次渲染：`routeName = null`，悬浮入口隐藏。
2. 观察器订阅事件：导航未就绪，不读取当前路由。
3. 导航容器触发 `ready`：安全读取初始路由并更新界面。
4. 导航容器触发 `state`：安全刷新当前路由。
5. 组件卸载：注销所有监听，避免残留回调。

如果就绪事件发生但当前路由暂时不存在，观察器返回 `null`，悬浮入口继续隐藏，不猜测目标页面。

## 验证

回归测试必须证明：

- 在未就绪状态订阅时不会调用 `getCurrentRoute()`。
- `ready` 事件只在导航就绪后读取并发布初始路由。
- `state` 事件发布后续路由变化。
- 清理后事件不再触发回调。
- 启动路径不再输出 React Navigation 的未初始化错误。

随后运行完整客户端验证和 Android Expo 打包，确认模块解析及现有界面行为不受影响。

## 非目标

- 不缓存或排队未就绪期间的导航操作。
- 不修改登录、服务器连接、AI 服务或深链逻辑。
- 不吞掉或全局屏蔽 React Navigation 错误。
