# 小鲤首页 Implementation Plan

**Goal:** 实现已确认的蓝紫小鲤首页及深紫夜间主题。

**Architecture:** 首页负责现有数据读取，展示组件负责插画、统计与导航。独立首页颜色令牌避免影响其他业务页；底栏保留原路由和安全区。

**Tech Stack:** Expo 54、React Native、React Navigation、独立 PNG 插画。

- [x] 生成主视觉和 Q 版透明插画，保存到 assets/xiaoli，检查图片。
- [x] 创建 components/home/CyberHome.js：首页主题、主视觉、双状态卡、快捷入口、最近订单。
- [x] 更新 screens/HomeScreen.js，保留数据、刷新、鉴权、导出功能，将展示委托给新组件。
- [x] 更新 navigation/TabNavigator.js：首页隐藏重复标题，胶囊底栏适配安全区，其他页面保持原结构。
- [x] 验证真实路由、状态参数和权限；运行 npm run verify:client 与 Expo 三平台导出。
- [x] 检查日夜与窄屏呈现，记录验证结果。

执行方式：当前会话内按顺序实现，用户已确认实施。

## 验证结果

- `npm run verify:client`：8 项通过。
- `npx expo export --platform all --output-dir .tmp/xiaoli-export`：Web、Android、iOS 导出通过。
- `node tests/client/home-ui.smoke.cjs`：使用单独的 Playwright 测试浏览器和拦截式示例 API。日间、夜间、390px 和 320px 截图完成，检查订单数量、生产进度筛选、全部订单重置、库存入口、部分失败不误报为零及重试恢复；无页面运行时异常。
- 角色 PNG 三张均确认包含透明通道，alpha 最小值为 0。
- 首页写操作仍由 canWrite / canExport 控制，浏览入口保留给查看者。
- 真实截图位于 `docs/ui-concepts/xiaoli-home-*-implemented.png`，使用演示数据。没有改写真实服务或用户数据。
- 浏览器插件初始化遇到 `node:process` 导入限制，因此使用独立无头 Edge 完成截图与交互验证。
- 本轮 UI 实施阶段未构建安装包、未发布，也没有进行 Android/iOS 真机视觉验收；三平台导出不等同真机测试。后续已在本地补充构建 Android 预览 APK，产物、校验值和复现方式见 `docs/handoffs/2026-09-13-xiaoli-home-redesign-handoff.md`；真机视觉验收仍未完成。

## 实现细节

- 底栏使用独立 `navigation/CyberTabBar.js`，修复默认导航样式中标签裁切的问题。
- `homeRequest` 参数确保重复从首页进入同一个筛选仍会重置列表状态。
- 统计读取 API 的 total 字段，避免仅计当前分页；请求代次防止失焦旧响应覆盖新页面。
- 首页原全局浮动助手隐藏，保留顶部铃铛与消息中心两处助手入口。
- 工坊背景为独立装饰图层；文字、统计、卡片、渐变和交互仍由组件渲染。
- 本轮同步替换首页、AI 助手及模型/耗材空状态中的“小麦”为“小鲤”。
