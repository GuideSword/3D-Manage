# 小鲤桌面工作台修正

用户反馈桌面侧栏占用近半屏，右侧仍像手机页面，留空过多。本次沿用已确认的小鲤品牌风格，修正桌面布局；手机端恢复原有完整布局。

## 原因与修正

`CyberTabBar` 的 rail 同时设置 `width: 236` 与 `flex: 1`，横向导航容器中发生增长。浏览器对旧导出产物的回归检查记录：1440px 窗口，rail 实际宽度 734.5px。改为固定 216px、禁止增长和收缩后，同一检查读到 216px。

新增 `components/home/DesktopHome.js`，在 Web 宽度 >=768px 时从 `CyberHome` 进入。桌面首页结构：顶部面包屑和真实可用操作、紧凑小鲤渐变欢迎区、三项实时指标、主要订单表、较窄的待办与常用操作栏。空间不足时指标和主副栏自动换行。指标只使用已存在的待审核订单数、执行中订单数、低库存批次数，最近订单表使用原有接口返回记录；不生成营收、趋势或机器进度等未提供的数据。

桌面和手机共用原有数据加载、权限、主题与导航回调。`CyberHome` 移除上次添加的桌面样式和包裹层，使手机视图保持原有样式。深色模式沿用 `cyberTheme`。

## 验证

- `npx expo export --platform web --output-dir .tmp/responsive-web` 成功。
- `node --test tests/client/responsive-layout.test.cjs`：4 项通过。
- `tests/ops/responsive-desktop-web.verify.cjs` 使用隔离浏览器上下文和拦截的 API 测试数据，通过界面设置服务器并登录；验证侧栏 <=240px、768/1024/1440/390px 无页面溢出、手机底部导航、深色主题、订单跳转和无运行异常。旧版产物在侧栏检查失败，修正版通过。
- 脚本读取 `RESPONSIVE_PLAYWRIGHT_MODULE`（Playwright 安装路径）与可选 `RESPONSIVE_BROWSER_EXECUTABLE`，默认检查 `.tmp/responsive-web` 导出目录；也可通过 `RESPONSIVE_WEB_DIR` 指定目录。截图输出 `.tmp/responsive-web-qa/desktop.png`、`mobile.png` 和 `desktop-dark.png`。
- 已目视检查实际渲染的桌面浅色、深色及手机截图。截图中的记录为验收 fixture；生产界面读取真实服务数据。
