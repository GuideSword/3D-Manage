# Web 订单通信与图片缩放验证

## 原因与修复

- React Native Web 的 `Alert.alert` 为空实现，详情状态、删除、列表删除和退级确认中的按钮回调不会执行。新增平台弹窗适配，原生平台继续使用原生确认回调。
- 关系型后端写入要求 `version`、`X-Business-Rules-Version: 2`、`Idempotency-Key`；原订单列表和详情调用旧接口时缺少这些参数，APP 共用代码也会受影响。新增关系型订单状态和删除方法，复用现有命令控制器保持重试幂等键。
- 列表原来按目标状态自行拼接记录，现在重新读取后端；详情使用后端返回的完整订单。返回列表时重新加载。请求失败显示错误，冲突可重新加载，结果未知可重试原操作。
- 图片预览补上非被动滚轮监听，缩放以鼠标位置为中心，范围为 1–4 倍；关闭后解绑。修复 Web 图片尺寸事件与原生不同导致拖动范围为零的问题。

## 复现与浏览器回归

```powershell
npx expo export --platform web --output-dir .tmp/web-order-image-fixes
# Playwright 不在项目依赖中时，指定已安装的模块和浏览器绝对路径：
$env:PLAYWRIGHT_MODULE = 'D:\coder\TypeScript\3D-Manage\.tmp\browser-qa\node_modules\playwright'
$env:BROWSER_EXECUTABLE = 'C:\Users\sword\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe'
node tests/client/web-order-image.smoke.cjs
```

修复前同一浏览器操作复现：`FAIL legacy detail starts execution through API: page.waitForFunction: Timeout 5000ms exceeded`；取消、删除也超时，API 未收到请求。

修复后浏览器脚本覆盖旧后端与关系型协议，检查详情开始执行、取消/恢复、删除，列表状态/退级、删除，以及 Web 滚轮放大缩小、缩放边界、放大后拖动、关闭重开恢复初始比例。另验证关系型版本冲突保持原状态、丢失响应重试复用原键及请求体。两种模式均无浏览器运行异常。

## 真实后端联调

`tests/ops/order-api-web.verify.cjs` 不拦截 API 请求。要求 `ORDER_WEB_TEST_DATABASE_URL` 指向本机独立空库 `/erp_order_web_verify`，使用迁移初始化的 PostgreSQL、真实认证和关系型 HTTP 适配器。

本次通过临时 PostgreSQL 16 容器运行，结束后清理该容器。浏览器的 6 次状态/删除写入均被后端接收，并直接查询数据库核实状态、删除结果及审计记录。现有运行服务及业务库未参与测试。

## 其他验证

- 相关客户端回归：33 项通过，包含 Web/Android/iOS 的真实 HTTP 请求、原生确认回调、订单精度与图片缓存。
- `npm run verify:backend`：通过，包含隔离的旧后端真实 API 验证。
- `pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite orders`：15 项通过。
- Web 导出与 Android Hermes 导出：通过；Android/iOS 未做真机交互验收。
- `git diff --check`：通过。
- 完整 `npm run verify:client`：25 项通过、1 项失败。工作区原有未提交的 `server-lifecycle.test.cjs` 新增聊天草稿测试调用了尚未实现的 `sessionStorage.setAgentChatState`，与本次订单/图片修复无关，保留原文件。

本次完成源码修复和本地验证，未部署运行中的服务或发布 APP 安装包。
