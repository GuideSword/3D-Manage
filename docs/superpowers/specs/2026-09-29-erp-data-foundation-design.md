# ERP 第二阶段：主数据与关系存储设计

日期：2026-09-29。2026-10-15 状态：02A、02B1、02B2 已完成；核心表 9/9、隔离导入 12/12 专项通过，正式快照副本演练对账和重复导入通过。正式库仍无 erp schema；原账号、业务及聊天数据未修改，正式客户映射未批准。02B3 Tasks 1–5 公共命令及模型/耗材、订单、库存、用户服务已完成（用户 18/18、相关领域回归通过）；SQL v5 仅在隔离库升级。Task 6 HTTP/CSV/AI 独立适配契约已完成（19/19，本轮含领域回归共 140 项通过，0 跳过）；02B3 达到约 95% 推进线，转入 02C 主数据/页面，再完成 02D 正式挂载和切换恢复。见[适配验收](../../rehearsals/2026-10-15-erp-02b3-adapters.md)。详见[02B2 验收](../../rehearsals/2026-10-15-erp-02b2-core-import.md)。

执行依据：[按优先级排序的计划](../plans/2026-09-29-erp-priority-plan.md)及用户“按执行顺序执行”的指令。阶段 01 完成实际交付后再切换关系存储；当前只准备与发布验收互不依赖的设计。

## 范围与方案

采用 PostgreSQL 独立 `erp` schema，迁移现有核心对象，增加客户、供应商及默认仓库。保持单组织、人民币、库存基本单位克，AI SQLite 继续管理 AI 会话。全部新增档案同时具备新建、详情、编辑、搜索、停用及引用保护。

对比方案：继续扩充 JSONB 改动较小，但无法建立可靠外键；拆分微服务会增加部署和跨服务事务负担。采用现有 Express 内的关系模块，保留同一数据库内的事务，迁移后只使用一套业务事实。

## 关系与字段

所有业务主键使用 text，保留旧 ID，不因已有数字 ID 而重新编号。新增对象使用服务端 UUID。每个可编辑对象具有 `version bigint > 0`、`created_at`、`updated_at`；停用使用 `active`。迁移映射记录来源集合、来源 ID 与目标表/ID，不依赖客户姓名作键。

| 表 | 核心字段与关系 | 约束 |
| --- | --- | --- |
| `installation` | 单行 ID、server_id、organization_name、initialized_at、storage_mode | server_id 唯一，沿用原服务器身份；storage_mode 为 legacy/relational |
| `users` | id、email、name、role、active、password_hash、token_version、version | email 大小写归一后唯一；role 为 owner/staff/viewer；不得删除最后有效 Owner |
| `customers` | id、code、name、contact_name、email、phone、address、notes、active、version | code 唯一；同名客户可并存；被订单引用后不能物理删除 |
| `suppliers` | id、code、name、contact_name、email、phone、address、notes、active、version | code 唯一；敏感资金资料留给采购/结算阶段 |
| `warehouses` | id、code、name、active、version | 首版只启用一条默认仓库；被批次引用后禁止删除 |
| `materials` | 原 id、code、type、brand、color、diameter、density、unit、unit_price、notes、active、version | 保留历史采购显示单位；库存服务统一克；unit_price 精确小数 |
| `models` | 原 id、name、description、source、active、version | 数字资产资料；模型版本由阶段 03 扩展 |
| `model_files` / `model_images` | 原文件/图片 ID、model_id、位置顺序、file_key、url、metadata | model_id 外键；保留所有现有文件属性，不能在迁移时丢弃未知字段 |
| `orders` | 原 id、number、customer_id、customer_snapshot、status、currency、total、notes、due_date、created_by、version | customer_id 外键；customer_snapshot 保留历史描述；状态沿用当前合法值 |
| `order_items` | order_id、原行 id、position、model_id、model_name_snapshot、quantity、unit_price、subtotal、spec_snapshot | `(order_id,id)` 主键；行顺序唯一；保留历史规格扩展字段 |
| `order_attachments` | order_id、position、file_key、original_name、metadata | order_id 外键；保留 URL/hash/大小及已有扩展字段 |
| `stock_lots` | 原 UUID、material_id、warehouse_id、lot_no、serial_no、location、notes、qty_mg、baseline_qty_mg、balance_status、state、active、version | 外键约束；新业务批次非负整数毫克；不通过编辑资料直接写余额 |
| `inventory_txns` | 原 id、lot_id、order_id、actor_id、type、qty_mg、before_qty_mg、after_qty_mg、delta_qty_mg、source、created_at、legacy_payload | 新流水外键约束且不可编辑；历史异常保留原文及异常标记 |
| `audit_logs` | 原 id、actor_id、entity、entity_id、action、diff、created_at | 历史已删除用户允许空 actor_id，同时保留原 actor ID；与新业务动作原子写入 |
| `command_receipts` | scope、actor_id、key、payload_hash、status_code、result、created_at | scope/actor_id/key 唯一；与业务、审计在同事务提交 |
| `object_uploads` | 原 ID、owner_id、file_key、metadata | 保留上传记录及生命周期状态；不移动或重命名现有文件 |
| `migration_runs` / `legacy_id_map` | 来源 hash、状态、开始/结束、报告路径、来源/目标 ID | 已完成相同来源迁移重跑返回既有结果；来源发生改变不得静默重复导入 |

正式 SQL 还需以现有实际字段和历史样本预检为依据；上述关联异常必须报告，不用虚构 ID 绕过外键。模型/材料已删除但旧订单仍保留名称的情况，保留快照并把当前档案引用置空，输出映射异常供确认；有余额批次找不到材料则阻止切换。

旧库存不能伪装成完整账本。`legacy_unverified` 批次保留余额、基线和当前版本；历史负数/非法数量进入隔离异常记录，保留原数据，禁止继续操作，修正须有受控记录。新增正常批次继续使用期初流水及毫克整数。

## 数值与金额

库存 `qty_mg` 使用 PostgreSQL bigint，向 API 输出克的十进制值。SQL 参数和 Node.js 运算先使用整数串/BigInt，不能把超出安全整数范围的值转换为 Number。库存继续遵守 P0 的三位克精度。

订单数量采用 `numeric(18,3)`，单价采用 `numeric(20,6)`，订单行/总金额采用 `numeric(20,2)`，币种首版只允许 CNY。新单据行金额按数量 × 单价四舍五入到分，总金额为已取整行金额之和。使用十进制字符串和 PostgreSQL numeric 运算；不能用浮点 `toFixed` 作为账务算法。

迁移按原记录金额逐行对账：不整分、总金额与行金额不一致、非法小数、超出范围及缺失单价都写入报告并阻止自动切换。只在负责人明确确认修正映射后转换；保留旧值、修正原因和前后差额。历史订单不能因迁移被自动重新计价。

## 事务、版本与权限

`business-db/transaction.js` 持有单个 pg client，领域服务接收同一事务上下文；完成业务、审计和幂等回执后一次 COMMIT，异常时一次 ROLLBACK。客户端不能直接决定余额、subtotal、total、created_by 或审计 actor。

更新与停用执行 `UPDATE ... WHERE id=$1 AND version=$2`，返回 0 行即 409 `VERSION_CONFLICT`。前端保存前回填 version，冲突保留未保存输入并提供重新加载；不得自动用最新版本覆盖。创建后返回 ID 与 version。

| 动作 | Owner | Staff | Viewer |
| --- | --- | --- | --- |
| 读取非敏感档案、订单、库存 | 允许 | 允许 | 允许 |
| 新建/编辑客户、供应商、模型、耗材、订单与批次资料 | 允许 | 允许 | 拒绝 |
| 档案停用与无引用删除 | 允许 | 允许 | 拒绝 |
| 入库、出库 | 允许 | 允许 | 拒绝 |
| 盘点、报废、组织和默认仓库设置 | 允许 | 拒绝 | 拒绝 |
| 用户管理、迁移及权限配置 | 允许 | 拒绝 | 拒绝 |

外键拒绝物理删除由 API 转为 409 `ENTITY_REFERENCED` 并显示“已有业务记录引用，请停用”。权限只由后端规则判断，菜单隐藏只是交互辅助。

## 客户匹配与历史快照

旧订单 customer.id 只用于建立来源映射，不能假设它已是存在的客户外键。姓名、电话和邮箱仅用于提出候选，不静默合并。迁移报告生成待确认分组；每笔旧订单始终保留原 customer_snapshot。

新订单从客户档案选择，确认时拷贝名称、联系方式、地址形成快照。修改客户档案不修改已有订单。未确认订单更换客户须显式更新关联与快照并写审计；在制或已有交付的订单只允许说明性资料编辑，不回写生产/交付事实。

## 迁移与切换

1. 只读预检：读取 file/JSONB 原始副本，计算来源 hash，检查角色、主键重复、外键候选、金额、批次余额、历史异常和文件引用；不运行现有隐式迁移来掩盖原样本。
2. dry-run：输出计数、映射建议、逐订单金额、逐批次余额和异常清单，不创建业务事实。业务数据/报告保存在受限 runtime，不提交仓库。
3. 演练：在隔离 PostgreSQL 导入，核对全部核心集合、附件引用及文件 hash、库存基线/余额、金额、审计、幂等回执和服务器身份；异常不清零、不丢弃。
4. 正式切换：停止所有业务写入及 AI 写工具，创建此次冷备份；锁定来源，重新检查 hash 与已批准映射；同一事务导入业务和映射，写迁移状态及 relational 标志。
5. HTTP、CSV、AI 同时切换至关系模块。旧 JSONB 留作只读迁移证据，不再接收写入；读取来源由单一 storage_mode 决定。
6. 首次启动与重复启动验证迁移版本、SQL hash 和 storage_mode；关系库未知高版本立即拒绝启动。
7. 开放写入前完成对账；失败恢复原备份。开放后发生的新业务不能通过恢复旧 JSONB 自动抹掉，须先再次备份并完成业务恢复/对账。

关系迁移版本与 legacy schemaVersion 分离。数据库迁移使用顺序编号、内容 hash 和执行记录，不能把已有 file→JSONB 脚本当作关系迁移完成。

## 客户端和能力契约

保持现有 API 1 的可读 DTO，增加 `capabilities.businessRulesVersion: 2` 及对象 version。关系模式下所有业务写请求必须附 `X-Business-Rules-Version: 2`，编辑还须携带对象 version；旧客户端写入返回 428 `CLIENT_UPGRADE_REQUIRED`。认证、系统发现和只读下载不受业务写版本头影响。新客户端遇到旧服务沿用阶段 01 接口，遇到关系模式使用新写规则。

客户与供应商页面包含列表搜索、新建、详情、编辑、停用/恢复；首次进入默认仓库页展示系统默认仓库，Owner 可编辑名称，其他角色只读。订单表单加入客户选择，保存快照；保留旧订单原值回填、清空字段、附件保留和失败重试行为。

现有 CSV 导入必须调用领域服务，整批成功或整批回滚；AI dbBridge 从关系模块读取；AI 工具写入仍须用户角色授权、确认和幂等。敏感金额权限在成本/结算阶段细化，不在阶段 02 提前加入资金流程。

## 验收与实施分包

- 数据库基础：空库安装、版本/hash 拒绝、同事务回滚、乐观并发、精确数值和唯一/外键验证。
- 迁移：干跑零写入、来源变动拒绝、重复导入幂等、同名不合并、非法余额保留、逐行金额与附件/审计/回执对账。
- 主数据：Owner/Staff 完整增删改查与停用，Viewer 只读；引用删除拒绝；冲突输入保留。
- 切换：HTTP/CSV/AI 同源，旧客户端读写守卫；故障恢复演练；不得双写 JSONB。

实施顺序为 02A 精度/事务/版本 → 02B 迁移预检与核心关系模块 → 02C 客户/供应商/仓库及前端 → 02D 同源切换与完整恢复。每包的可执行代码步骤在进入该包时单独制定；当前文档是设计，不计作阶段 02 已实现。
