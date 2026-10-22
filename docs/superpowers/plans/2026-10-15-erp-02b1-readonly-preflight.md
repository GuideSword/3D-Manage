# ERP 02B1 只读迁移预检实施计划

> **For agentic workers:** Execute sequentially in this session. Steps use checkbox (`- [ ]`) syntax. The existing stage 02 design and the user's instruction to continue authorize this package; no production migration is included.

**Goal:** 为原业务数据生成保留精度的来源快照、金额/余额/关联/文件检查和客户映射建议，不修改来源。

**Architecture:** 独立读取 file 或 PostgreSQL JSONB 原文，不导入现有 store.js，避免触发隐式升级。原文与 SHA-256 为来源凭据；计算使用 02A 的 BigInt 十进制模块。异常报告和待确认映射写到运行目录，导入及核心关系表属于 02B 后续包。

**Tech Stack:** Node.js 22、原生 JSON reviver source、pg、Node test、PostgreSQL 16、Docker Compose。

---

依据：[已确定的数据基础设计](../specs/2026-09-29-erp-data-foundation-design.md)。本机 Node 22 已实测支持 reviver 的 context.source；不支持的运行时必须拒绝，禁止退回浮点解析。

## 文件与契约

| 文件 | 责任与入口 |
| --- | --- |
| `backend/business-db/preflight/source.js` | `parseSource(raw)` 保留数值原文；`readFileSource(path)`；`readPostgresSource({connectionString,table,storeId})` 使用 REPEATABLE READ READ ONLY，只查询 data::text；`assertSourceHash` 拒绝来源改变 |
| `backend/business-db/preflight/report.js` | `buildPreflightReport(source,{uploadDirectory})`；集合/ID/角色/版本、精确订单金额、关联和客户建议；不创建客户 |
| `backend/business-db/preflight/inventory.js` | 按来源流水顺序校验 baseline 与 ledgerVersion=1 的新流水；保留旧流水，不把旧 adjust.qty 当差额 |
| `backend/business-db/preflight/files.js` | 文件引用归一、目录/真实路径约束、流式 hash、大小与已登记 hash 核对；外链不联网 |
| `backend/business-db/preflight/runner.js` | `writePreflightArtifacts` 用新目录发布 snapshot/report/mappings/manifest；拒绝覆盖，日志只显示摘要 |
| `backend/scripts/erp-preflight.js` | 明确选择 --source-file 或 --postgres-env，加 --output、--upload-dir；无业务写入命令 |
| `tests/backend/erp-preflight.test.cjs` | 原数值、金额、库存、客户建议、文件安全、CLI 原样保存和来源 hash 变化 |
| `tests/backend/erp-preflight-postgres.test.cjs` | 专用空测试库的来源读取、READ ONLY 拒写及前后原文一致 |

报告包含 sourceSha256、serverId、schemaVersion、counts、issues、orders、stockLots、files 和 customerMappings。issues 分 blocker 与 review。状态依次为 blocked / review_required / ready；无论何种状态均不自动导入。CLI 状态码：0 ready、2 blocked、3 review_required、1 执行错误。

客户建议为每笔订单保留独立目标键，同名或相同来源 customer.id 只提出候选，不合并；保留旧客户快照。原值可无损转成指定精度时只在计算副本去掉尾部零；非零超精度、缺价及总额不一致阻止切换，原文不改。

### Task 1：只读来源与精度

- [x] 写测试并确认模块缺失导致失败。关键断言：

```js
const source = parseSource('{"total":9007199254740993.01}');
assert.equal(source.data.total, '9007199254740993.01');
assertSourceHash(source, source.sha256);
assert.throws(() => assertSourceHash(source, '0'.repeat(64)));
```

- [x] 实现原文 hash、UTF-8 校验、原生 reviver 数值原文保存；PostgreSQL 读操作显式只读事务、参数化 storeId、严格表标识符。所有异常均关闭连接，配置不自动读取默认业务连接。
- [x] 执行 `node --test tests/backend/erp-preflight.test.cjs`，来源用例通过后提交独立文件。

### Task 2：金额、关联与库存报告

- [x] 测试订单 `0.333 × 3.000001 = 1.00`、两行分别半分取整后合计 0.02、总额或原 subtotal 不一致、缺价、负数、重复 ID、失去 Owner、悬空物料和独立客户建议。
- [x] 复用 parseScaled/multiplyToCents/sumCents，保留原金额并输出逐行计算值。库存从明确 baseline 开始，只校验新账本；每笔 before/after/delta 与操作语义一致，最终余额对账；legacy_unverified 要求人工复核，legacy_invalid 阻断。
- [x] 使用只读 fixture 校验原对象及原始文本没有被修改。执行相同专项测试，提交报告模块与测试。

### Task 3：文件与产物

- [x] 临时上传根目录测试已知 hash、内容篡改、缺失文件、路径穿越、外部 symlink、Windows 分隔符和外链不联网。
- [x] 文件 hash 流式计算；真实路径必须留在上传根内。保存原文 snapshot.json、report.json、mappings.json、report.md 和 manifest.json；新目录创建失败时拒绝覆盖，文件按 Unix 0600、目录 0700 创建，Windows 沿用宿主目录权限。
- [x] CLI 使用参数数组调用，测试状态码与文件 hash；原 store.json 字节完全相同，不加载服务器或业务初始化。执行专项测试并提交。

### Task 4：真实 PostgreSQL 来源与正式只读演练

- [x] 在一次性 PostgreSQL 16 内建立独立 JSONB 来源，原金额以 data::text 读取。验证来源事务只读、写入被 PostgreSQL 拒绝，读取前后文本/hash 一致。
- [x] 扩展已有隔离验证工具选择 preflight suite，保留 foundation 默认行为；执行实际数据库用例，不把 skip 算通过。
- [x] 对正式来源只读运行预检，将原文与报告保存到忽略的 runtime/migration-preflight 目录；不输出完整客户资料、密码 hash 或连接串。核对正式业务与 AI 数据前后摘要和数据库结构。
- [x] 修复代码缺陷；真实业务异常保留报告，不能自动修正金额、余额或合并客户。写回总计划及执行记录并提交。

### Task 5：02B1 结束与 02B 后续边界

- [x] 运行 preflight 专项、02A foundation、库存/编辑/备份必要回归及 git diff --check。
- [x] 只有实现与验收达到约 95% 才结束本包；真实数据需要复核时保留阻断项，不标记可自动迁移。
- [x] 记录下一步为核心关系表、来源映射确认及隔离导入演练；02B/02C/02D 和整个阶段 02 均不能因此标记完成。

## 执行结果（2026-10-15）

Tasks 1–5 已完成，02B1 主功能与验证达到推进门槛。专项 12/12、02A 17/17、库存/编辑/备份 30/30 通过，均无跳过。正式只读预检 0 blocker、2 review；原文、业务及 AI 摘要一致，正式库没有 erp schema。客户映射仍为未批准，不允许自动迁移。下一包为 02B2 核心关系表与隔离导入演练。详见[执行记录](../../rehearsals/2026-10-15-erp-02b1-preflight.md)。
