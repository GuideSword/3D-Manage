# P0 Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
> 当前环境无这些技能，依据路线图约定在本会话逐项执行，不派发子代理。

**Goal:** 完成可信库存写入口及客户端 P0 兼容。

**Architecture:** 库存服务在现有 withData 原子写边界内校验、写流水/审计/幂等回执；HTTP、CSV 共用领域函数，AI 共用只读摘要。schema 3 标记历史余额，不重建旧流水。

**Tech Stack:** CommonJS、Express、Node 内置测试、Expo、现有文件/JSONB store。

---

### Task 1: 冻结契约与历史升级

Files: `backend/config/runtime.js`, `backend/utils/store.js`, `backend/routes/system.js`, `backend/services/inventoryQuantity.js`。

- [x] 严格十进制转毫克，转换算法：`BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))`，超过 `Number.MAX_SAFE_INTEGER` 拒绝。
- [x] schema 升至 3，新增 `commandReceipts: []`，旧批次记录切换余额、时间、version/active 和待核对标识；不改旧 qty/txn。
- [x] `node --test tests/backend/erp-inventory.test.cjs` 验证迁移重复执行不变化、500g 历史 adjust 仍为 500g。

### Task 2: 公共服务与测试

Files: `backend/services/inventory.js`, `tests/backend/erp-inventory.test.cjs`。

- [x] 编写隔离测试，调用方式：`await inventory.executeCommand('lot.create', {materialId:'m1', qty:'1000'}, {actor:{id:'owner',role:'owner'}, idempotencyKey:'opening-1'})`。
- [x] 创建非零批次同时写 opening 流水；`await inventory.executeCommand('inventory.post', {lotId, type:'adjust',qty:'800'}, options)` 产生 before=1000、after=800、delta=-200。
- [x] 命令键按用户隔离，canonical JSON 排序后 SHA256 摘要，回执存原响应；同键同请求返回原结果，同键不同请求抛 409。
- [x] 编辑白名单、归档/恢复、引用保护；订单/材料删除保护；摘要区分现存与可操作数量，停用/异常批次不贡献可操作库存。
- [x] 注入回执 push 故障，验证库存、流水、审计、回执一起回滚；并发两次出库 80g/100g 只成功一次。

### Task 3: HTTP、CSV、AI 接入

Files: `backend/routes/stock.js`, `backend/routes/materials.js`, `backend/routes/orders.js`, `backend/services/orders.js`, `backend/agent/dbBridge.js`, `backend/agent/tools/inventory.js`, `backend/agent/tools/orders.js`, `backend/scripts/verify-api.js`, `backend/scripts/verify-self-hosted.js`。

- [x] 路由只解析 `req.get('Idempotency-Key')` 与请求数据，调用公共服务返回 `{status,body}`。CSV 整批同事务、逐行创建调用 createLotInData；导出补 before/after/delta、baseline/status/active 字段。
- [x] 服务/HTTP 双层权限验证，adjust 仅 Owner；验证 Viewer/Staff 拒绝、缺键拒绝、CSV 非法第二行无第一行残留。
- [x] AI 保持只读工具与确认订单入口；摘要改用公共库存规则，订单导入调用 createOrderInData。
- [x] 基线验证请求增加明确幂等键：`headers: {'Idempotency-Key':'verify-inbound-1'}`。

### Task 4: 客户端

Files: `utils/api.js`, `utils/inventoryCommandCore.cjs`, `utils/useInventoryCommand.js`, `screens/InboundTransactionScreen.js`, `screens/OutboundTransactionScreen.js`, `screens/AdjustTransactionScreen.js`, `screens/MaterialsScreen.js`, `screens/MaterialDetailScreen.js`, `screens/DataImportScreen.js`, `constants/index.js`, `tests/client/erp-inventory-command.test.cjs`。

- [x] 命令控制器保持 request/key 至获得明确响应，submit 中/成功后不重复执行；未知结果期间修改内容拒绝并提示先重试原请求。
- [x] 新批次发送 `stockAPI.createLot({materialId,lotNo,qty:formData.qty}, key)`，不再两次写入；盘点带 version。
- [x] 仓库批次按钮改停用/恢复，展示历史核对状态，选择器过滤 active=false；Owner 才展示盘点。
- [x] `node --test tests/client/erp-inventory-command.test.cjs` 验证超时重试复用键、重复点击只发一次、改变未确认请求内容拒绝。

### Task 5: 交付验证和文档

Files: `tests/ops/p0-inventory-postgres.verify.ps1`, `docs/UPGRADE.md`, `docs/ERP_TRANSFORMATION.md`, `docs/superpowers/plans/2026-09-27-vertical-erp-roadmap.md`, `docs/P0_INVENTORY.md`, package scripts。

- [x] 执行 `npm run verify:erp:postgres`（随机容器/端口、tmpfs，无实际数据库连接）、`npm run verify:erp`、`npm run verify:client`、`npm run verify:agent-client`、`npm run verify:backend`、`npm --prefix backend run verify:runtime`、`npm --prefix backend run verify:self-hosted`、`npm --prefix backend run test:agent`；成功预期 exit 0。
- [x] `npx expo export --platform web --output-dir .tmp/p0-web`，预期导出 Web 静态资源。
- [x] 记录实际结果、版本与备份/整体回滚口径；更新 P0 状态，P1–P6 保持未实施。用户现有修改保留，不自动发布或迁移实际业务数据。

## 交付状态

2026-09-27 已实现并通过列出的自动化命令，实际结果与限制见 `docs/P0_INVENTORY.md`。源码保持工作区变更，未 Git 提交/推送或部署；人工手机/桌面交互验收与发布由路线图独立跟踪。
