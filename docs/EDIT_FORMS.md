# 表单编辑操作与验证

更新日期：2026-09-29。源码已实现；Web 自动化与 Web/Android 资源构建通过。尚未部署或重新生成 APK，Android/iOS 真机交互待验收。

## 修改入口

| 数据 | 入口 | 可修改内容 |
| --- | --- | --- |
| 订单 | 订单详情 → 编辑订单 | 客户、交期、备注、项目、数量、单价；可追加附件 |
| 模型 | 模型详情 → 编辑模型 | 名称、描述、来源；图片/文件仍在详情页管理 |
| 耗材 | 耗材详情 → 编辑耗材 | 材质、品牌、直径、颜色、单价、单位、备注 |
| 库存批次 | 耗材详情的批次或库存列表 → 编辑批次 | 批次号、序列号、库位、备注 |
| 用户 | 设置 → 用户与权限 → 编辑姓名 | 普通用户姓名；仅 Owner 可操作 |

编辑自动回填原值。保存后返回详情并刷新，取消不提交修改；保存失败保留输入并显示错误。订单备注、客户邮箱/电话、交期和耗材备注可清空。订单的原附件、明细规格、创建信息和状态不会因普通编辑丢失；状态继续通过状态操作修改。

库存数量通过入库、出库或盘点修正，以保留流水。已过账流水不直接编辑。批次有版本保护，发生冲突时核对输入后重新加载最新资料；请求结果未知时使用原请求重试。Owner/Staff 可编辑业务资料，Viewer 只读，盘点仍仅 Owner。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| npm run verify:edit | 新增编辑接口及表单转换测试，9/9 通过 |
| npm run verify:erp | 库存一致性与重试回归，16/16 通过 |
| npm run verify:client | 客户端回归 25/25，服务器地址验证通过 |
| npm run verify:backend | 后端错误文案 3/3，隔离 API 验证通过 |
| Web 界面自动化 | 390px / 1280px 的订单、模型、耗材、批次、用户编辑通过；取消、保存失败、版本冲突、重新加载、无横向溢出通过 |
| Expo Web / Android export | 资源构建通过；不等同于签名 APK 或真机验收 |
| 2026-09-29 物理 Android | 最终同签名 APK 覆盖安装并拉取 hash 核对；原生订单、模型、耗材、批次和姓名编辑通过，批次版本冲突及资料保存断网重试通过；库存页缺少 Button 导入已修复 |

接口测试使用临时数据目录，不接触工作室实际数据。界面测试使用隔离 API fixture，验证实际页面与提交内容；不将 fixture 成功视作真实后端部署验收。

## 重跑界面自动化

沿用项目现有 Playwright smoke 测试方式。测试依赖仅安装到忽略的 .tmp 目录，不修改业务依赖或锁文件：

```powershell
npx expo export --platform web --output-dir .tmp/edit-forms-web
npm --prefix .tmp/edit-ui-test install playwright --no-save --package-lock=false --ignore-scripts
$env:PLAYWRIGHT_MODULE = (Resolve-Path .tmp/edit-ui-test/node_modules/playwright).Path
node tests/client/edit-forms-ui.smoke.cjs
```

该测试需要已安装 Microsoft Edge；启动独立无界面实例，退出时关闭。不使用用户已有登录会话。

设计与计划：[编辑设计](superpowers/specs/2026-09-29-edit-forms-design.md)、[实施计划](superpowers/plans/2026-09-29-edit-forms-implementation.md)。后续模块评估见 [ERP 差距复核](ERP_GAP_REVIEW_2026-09-29.md)。
