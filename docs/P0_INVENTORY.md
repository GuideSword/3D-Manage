# P0 库存一致性：操作、API 与交付记录

交付日期：2026-09-27。范围为路线图 P0，实现及自动化验收完成；未发布到工作室环境。P1–P6 尚未实施。详细契约见 [P0 设计](superpowers/specs/2026-09-27-p0-inventory-design.md) 和 [执行计划](superpowers/plans/2026-09-27-p0-inventory-implementation.md)。

## 使用方式

1. 入库选择新批次时，一次提交创建批次及其期初库存；现有批次入库仅增加该批次余额。
2. 出库、入库数量为正克数，最多三位小数；盘点为实际库存量，允许零值。后端以整数毫克计算，不采用 parseFloat 部分解析或四舍五入。
3. 盘点仅 Owner 可用，带读取时的批次 version；并发修改后提示刷新。流水保存账面数量、实盘数量和差额，旧 adjust.qty 仍表示调整后的数量。
4. 仓库批次提供停用/恢复，停用保留余额及流水并禁止过账。冻结/报废批次也不可过账。删除耗材不再级联删除批次；有流水或订单引用的批次、有关联库存流水的订单不能物理删除。
5. 超时或网络异常后保持原内容重试，页面会复用幂等键。新批次不会因重试创建两份，库存不会因重试重复扣减。批次停用/恢复结果未知时，原批次显示重试提示，刷新后仍重试原操作。
6. 若关闭页面或重启客户端导致原请求键丢失，先查询批次/流水核对原操作结果，再明确创建新的操作。当前客户端命令键仅在页面生命周期保存，服务端回执持久保存。

历史批次显示“历史余额待核对”；这表示现有余额作为切换基线保留，不能用旧流水重算。无效、负值或超过三位小数的历史余额显示异常并阻止过账，需在正式迁移前人工核对数据；系统不静默取整或修正。盘点不会替代对历史流水的核对。

## 版本与 API

业务 schema 2 → 3，API 主版本仍为 1；`GET /api/system/info` 返回 `capabilities.inventoryRulesVersion: 1`。P0 沿用文件/单行 JSONB；ERP 关系表、成本、预留、生产和结算仍需后续阶段。AI SQLite 迁移未改动。

以下库存写接口必须传 `Idempotency-Key` 请求头；也可传 `body.idempotencyKey`。同用户同键同请求返回首次状态和响应，同键不同内容/操作返回 409。键长 1–128，允许 ASCII 字母数字及 `._:-`。明确失败不占用键；Actor 始终取认证用户，不信任 body.actorId。

| 接口 | 输入与权限 |
| --- | --- |
| `POST /api/stock/lots` | `{materialId, lotNo, qty, location, notes}`，Owner/Staff；省略 qty 为零，显式空值拒绝 |
| `POST /api/stock/import` | `{csv}` 或 `{lots:[...]}`，Owner/Staff，整批原子提交，非零数量写 opening 流水 |
| `POST /api/stock/inventory/txns` | `{lotId,type,qty,notes,orderId?,version?}`；in/out/scrap 为 Owner/Staff，adjust 为 Owner，scrap 必填原因 |
| `PATCH /api/stock/lots/:id` | lotNo、serialNo、location、notes、photoKey、active、version；Owner/Staff，拒绝 qty/qtyMg、物料、状态、ID 等内部字段 |
| `POST /api/stock/lots/:id/archive` | `{version?}`，Owner/Staff，停用；恢复使用 PATCH active=true |
| `DELETE /api/stock/lots/:id` | Owner/Staff，仅允许无余额/无流水/无引用的新空批次 |

查询批次与库存流水允许 Owner/Staff/Viewer；导出及审计仍为 Owner。数量字段兼容 `qty_g`、`material_id`、`lot_id`；显式单位只允许 `g`。客户端传递数量原始十进制字符串，服务端响应兼容 qty 克数并补充 qtyMg。

示例（1000g 批次出库 200g）：

```http
POST /api/stock/inventory/txns
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: sample-out-200-1

{"lotId":"<批次ID>","type":"out","qty":"200","notes":"样例领料"}
```

返回 HTTP 201，流水 `qty=200`、`deltaQty=-200`、`beforeQty=1000`、`afterQty=800`，内部对应整数毫克。重试返回同一流水 ID。盘点至 700g 时流水 `qty=700`、`beforeQty=800`、`afterQty=700`、`deltaQty=-100`。全量耗材报废需单独说明原料报废原因；此接口不代表打印产品报废。

错误格式 `{code,error}`：无效数量/单位/保护字段/缺幂等键 400；权限 403；缺批次/物料/订单 404；余额不足、历史异常、版本/幂等冲突、引用保护 409；内部故障 500 中文兜底。

导出的新流水含前后数量、差额、毫克字段及 ledger_version/source；旧流水这些字段为空，必须按旧语义解释。批次导出含 active、balance_status、ledger_baseline_qty_mg、ledger_started_at。

## 文件与责任

| 文件 | 交付变化 |
| --- | --- |
| backend/services/inventoryQuantity.js、inventory.js | 数量解析、创建/过账/资料/停用/引用保护/摘要、原子幂等命令 |
| backend/utils/store.js、config/runtime.js、routes/system.js | schema 3、历史基线、持久回执、库存规则能力声明 |
| backend/routes/stock.js | HTTP/CSV 共用服务，导出对账字段 |
| backend/services/orders.js、routes/orders.js、routes/materials.js | 创建共用、删除引用与编辑 ID 保护 |
| backend/agent/dbBridge.js、tools/inventory.js、tools/orders.js | AI 共用库存摘要，保留只读权限，兼容旧订单 ID |
| utils/api.js、inventoryCommandCore.cjs、useInventoryCommand.js | 幂等头、中文错误码、页面命令重试及防重复提交 |
| screens/InboundTransactionScreen.js、OutboundTransactionScreen.js、AdjustTransactionScreen.js | 一次创建期初、精度校验、超时原键重试、盘点版本与权限 |
| screens/MaterialsScreen.js、MaterialDetailScreen.js、HomeScreen.js、DataImportScreen.js | 停用/恢复、历史提示、Owner 盘点、导入重试 |
| tests/backend/erp-inventory.test.cjs、tests/client/erp-inventory-command.test.cjs、tests/ops/p0-inventory-postgres.verify.ps1 | 文件/JSONB 验收、跨进程锁验证、客户端命令测试、隔离容器 |
| backend/scripts/verify-api.js、verify-self-hosted.js、package.json | 基线库存请求带键，ERP 验证命令 |

## 实际验证结果

2026-09-27 执行，均 exit 0：

| 命令 | 结果 |
| --- | --- |
| `npm run verify:erp` | 16/16：12 后端与 4 客户端；期初、盘点、报废、严格输入、并发、重试、跨进程读取回执、整批导入回滚、引用、权限、故障回滚、AI 摘要 |
| `npm run verify:erp:postgres` | PostgreSQL 16 临时容器，12/12；包含两个独立 Node 进程争抢 100g 批次，各领 80g，仅一个成功、最终 20g |
| `npm run verify:client` | 25/25，地址验证通过 |
| `npm run verify:agent-client` | 19/19 |
| `npm run verify:backend` | 中文错误测试 3/3，API 验证通过 |
| `npm --prefix backend run verify:runtime` | 通过 |
| `npm --prefix backend run verify:self-hosted` | 通过，Owner/Staff/Viewer、附件及 AI 草稿兼容 |
| `npm --prefix backend run test:agent` | 33/33 |
| `npx expo export --platform web --output-dir .tmp/p0-web` | 成功导出 1191 模块 |
| `git diff --check` | 通过 |

文件测试只使用 `os.tmpdir()` 中本次生成的目录，结束删除；PostgreSQL 验证脚本创建随机名容器、随机本机端口、tmpfs 数据目录，结束停止本次容器并自动移除，不读取 .env，不连接工作室数据库。直接使用 `ERP_TEST_DATABASE_URL` 时必须指定一次性测试数据库，测试会创建并清理随机 `erp_inventory_test_*` 表。

## 升级、限制及下一步

升级步骤及整体回滚见 [UPGRADE.md](UPGRADE.md)。首次启动自动保存 schema 3 历史标记，不改变旧余额；发布必须客户端和后端一起升级。旧客户端缺键写操作或直接编辑余额会明确拒绝。无新增依赖，未改真实工作室数据、部署配置和用户现有 README 修改。

本次源码保留为工作区独立变更，未 Git 提交/推送、未部署。手机窄屏/桌面交互、真实网络超时及服务器切换尚未进行人工验收；Web 已完成构建验证。文件模式仍只支持单后端进程，生产多实例应使用 PostgreSQL；JSONB 仍锁整行而非每批次。回执暂不自动清理，P1 应设计关系表与保留策略。

下一阶段 P1 需先设计关系表/客户/供应商/仓库以及只读预检和迁移对账；不能把本次 JSONB schema 3 当作已完成关系库迁移。涉及历史余额异常时应先停止写入，备份并核对，再执行已审核的迁移流程。
