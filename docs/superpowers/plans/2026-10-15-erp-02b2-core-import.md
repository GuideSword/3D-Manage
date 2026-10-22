# ERP 02B2 核心关系表与隔离导入计划

> **For agentic workers:** Execute sequentially in this session under the approved stage 02 design. Steps use checkbox (`- [ ]`) syntax. No production cutover or automatic approval of customer mappings.

**Goal:** 建立核心关系约束，并把已绑定来源 hash 的快照完整导入隔离 PostgreSQL，验证精度、关联、幂等和失败回滚。

**Architecture:** 沿用 `erp` schema、02A 迁移登记和事务。新增 SQL v2，不修改已执行 v1。预检来源与明确的映射决策控制导入；完整原文和每条原始 JSON 保留，业务列使用精确十进制字符串。导入只接受显式目标连接，不接入正式启动、HTTP、CSV 或 AI；正式切换属于 02D。

**Tech Stack:** Node.js 22、pg、PostgreSQL 16、BigInt、node:test、一次性 Docker 测试容器。

依据：[阶段 02 设计](../specs/2026-09-29-erp-data-foundation-design.md)、[02B1 验收](../../rehearsals/2026-10-15-erp-02b1-preflight.md)。用户已授权顺序实施，延续本会话内执行。

## 文件责任

| 文件 | 内容 |
| --- | --- |
| `backend/business-db/migrations/0002_core.sql` | 主数据、用户、模型子表、订单子表、库存、审计、回执、上传及来源映射表；FK、唯一、精度与状态约束 |
| `backend/business-db/import/decisions.js` | 来源 hash、逐条 review 决策及独立客户映射验证；不得自动批准 |
| `backend/business-db/import/legacy.js` | 在同一事务校验空目标、导入、对账、登记映射；重复相同来源幂等，变更来源拒绝 |
| `backend/scripts/erp-import-rehearsal.js` | 显式隔离目标与来源/决策文件，输出摘要；无正式切换入口 |
| `tests/backend/erp-core-schema.test.cjs` | 实际 PostgreSQL 约束、引用保护、精度拒绝、库存语义与原始 payload |
| `tests/backend/erp-import.test.cjs` | 映射、金额/库存/未知字段、审计缺失用户、重复来源及失败回滚 |
| `tests/ops/erp-02a-postgres.verify.ps1` | 新 core/import suite 复用已有隔离、密钥和容器清理保护 |

## Task 1：核心关系表

- [x] 编写实际数据库用例，先确认 v2 表尚不存在导致失败。关键验证：

```js
await assert.rejects(pool.query("INSERT INTO erp.customers(id,code,name) VALUES('c2','C1','同名客户')"), {code:'23505'});
await assert.rejects(pool.query("DELETE FROM erp.customers WHERE id='c1'"), {code:'23503'});
await assert.rejects(pool.query("INSERT INTO erp.order_items(order_id,id,position,quantity,unit_price,subtotal) VALUES('o1','bad',1,0.3333,1,0.33)"), {code:'23514'});
```

- [x] 新建 SQL v2。数量、单价、金额采用无隐式取整的 numeric domain：例如 `CHECK(VALUE >= 0 AND VALUE < 1e18 AND VALUE = round(VALUE,2))`；禁止靠 numeric(p,s) 静默截断。所有可编辑表有正 bigint version、时间和 active；原 ID 为 text，订单内行主键 `(order_id,id)`，位置唯一，FK 默认 RESTRICT。jsonb snapshot 保留扩展字段；库存新账本校验 before/after/delta 和操作语义，旧流水单独标记。
- [x] 核心 SQL 不插入业务数据或改变 installation.storage_mode；历史审计 actor 可空且原始 actor ID 保留。新用户密码与 token_version 原样保留。文件位置不移动。
- [x] 扩展隔离 runner 的 core suite，运行 `pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite core`；foundation 用例明确冻结 v1 fixture，继续验证原有契约，再单独验证 v1→v2 升级。提交 SQL 与测试。

## Task 2：来源与决策控制的导入

- [x] 编写 fixture：同名客户两订单、精确金额、原始数值大于 2^53、未知扩展字段、缺失历史审计用户、旧绝对盘点及新流水；来源树和原文字节不得修改。
- [x] 决策格式固定为 `{sourceSha256, approved:true, reviews:[{code,collection,entityId,field,action}], customers:[{orderId,targetId,action:'create_separate_customer'}]}`。所有 review 逐条匹配；不接受漏项、额外项、错误 hash 或同一 targetId 合并客户；人工决策只允许既定保留策略，不可绕过 blocker。
- [x] `importLegacySnapshot(pool, {source, decisions, uploadDirectory})` 重跑预检及 hash；使用 advisory lock 和单个事务，要求空业务目标；保存原文并从 PostgreSQL jsonb 提取每条原始 payload，禁止把预检树的数值字符串当原始 JSON 重写。逐集合/子记录写入及 id_map；原密码 hash/token/version/文件/审计保留，金额仅复制已核对原值；不新增库存事实。
- [x] 写入结束核对集合数量、逐订单原金额/行、逐批次余额、子记录和映射数量；同来源且同决策重复导入返回既有结果，来源或决策变化拒绝。注入中途失败确认所有业务表/映射/迁移记录整体回滚，来源不变。`storage_mode` 仍为 legacy。
- [x] 执行 import suite，实际 PostgreSQL 无跳过后提交。

## Task 3：只在隔离库演练与交接

- [x] CLI 必须要求显式隔离目标环境变量，不使用默认 DATABASE_URL；校验专用数据库名称与 loopback/受控容器，不能传正式目标。fixture 自动决策只用于测试；真实快照演练使用独立 rehearsal 决策文件并标明不构成正式批准。
- [x] 在一次性 PG16 载入正式原文副本，对每个 review 使用明确保留策略，导入后核对原始 JSON、集合、金额、文件引用/实际 hash、身份、审计与回执；不得接触 AI SQLite 或正式关系结构。
- [x] 运行 core/import、foundation/preflight 及库存/编辑/备份回归；`git diff --check`，记录真实证据。本包达到约 95% 后进入 02B 领域服务，再进入 02C 主数据页面和 02D 切换；不能把本包记作整个阶段 02 完成。

## 执行结果（2026-10-15）

Tasks 1–3 已完成。核心表 9/9、导入 12/12、foundation 17/17、preflight 12/12、库存/编辑/备份 30/30 通过，无跳过。正式快照在一次性 PG16 导入并重复执行对账通过；正式库无 erp schema，来源及 AI 摘要未变化。SQL/导入分别提交 `47b2d0f`、`e721eb7`。详见[验收记录](../../rehearsals/2026-10-15-erp-02b2-core-import.md)。下一位置 02B3：关系模式的核心业务服务（不提前切换正式读写）。客户正式迁移批准及阶段 02 整体交付仍未完成。
