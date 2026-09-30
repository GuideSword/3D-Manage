# ERP 02A 精确数值与关系库基础实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不切换现有业务读写的前提下，建立可测试的精确金额计算、独立关系库迁移执行器、单事务边界及乐观版本更新原语。

**Architecture:** 新代码放在 `backend/business-db/`，只连接专用 PostgreSQL 数据库，不修改当前 `app_store` JSONB 或 AI SQLite。02A 只交付基础设施和隔离测试；02B 完成迁移预检与核心业务表，02C 接主数据页面，02D 完成单一事实源切换。

**Tech Stack:** CommonJS、Node.js 内置测试、`pg`、PostgreSQL 16、Docker Compose 隔离测试。

---

依据：[阶段 02 设计](../specs/2026-09-29-erp-data-foundation-design.md)。执行前置：阶段 01 客户端代码基线已固定；**生产 `manage3d` 的 schema 2 → 3 发布目标与验收仍待明确，02A 只能在隔离数据库执行，不向日常库建表或切换路由。** 02A 期间 `backend/utils/store.js`、现有 HTTP 路由和客户端 DTO 保持当前运行路径。

## 文件边界

| 文件 | 单一责任 |
| --- | --- |
| `backend/business-db/decimal.js` | 严格十进制输入、范围检查、整数缩放与分位舍入；不接数据库 |
| `backend/business-db/connection.js` | 创建/关闭专用 `pg.Pool`，拒绝非 PostgreSQL 16 的测试配置和不合法连接参数 |
| `backend/business-db/transaction.js` | 向调用方交付同一 `pg` client，统一 COMMIT/ROLLBACK；不含业务规则 |
| `backend/business-db/migrator.js` | 读取按序 SQL 文件、校验 SHA-256、拒绝未知/篡改版本，在数据库锁内执行 |
| `backend/business-db/migrations/0001_foundation.sql` | 创建 `erp.installation` 的稳定身份与模式字段；迁移登记由执行器在加锁后自举 |
| `backend/business-db/versioned.js` | 生成带版本条件的更新语句，将旧版本和缺失对象区分为 409/404 |
| `tests/backend/erp-decimal.test.cjs` | 分位、范围、拒绝浮点污染的纯函数测试 |
| `tests/backend/erp-postgres.test.cjs` | 迁移、锁、事务回滚、并发版本更新的专用数据库测试 |
| `tests/ops/erp-02a-postgres.verify.ps1` | 启动/清理独立 PostgreSQL 16 容器，向测试传入一次性连接串 |

本包不创建客户/订单/库存正式关系表，也不写新 HTTP 接口。测试用 `erp.transaction_probe` 只在一次性测试数据库中创建并清理；02B 第一批业务表独立编号，避免把未核对的字段提前固化。

### Task 1：冻结数值契约

**Files:** Create `backend/business-db/decimal.js`; create `tests/backend/erp-decimal.test.cjs`。

- [ ] 写失败测试：`parseScaled('1.235', 3)` 为 `1235n`；`multiplyToCents('0.333','3.000001')` 按数量三位、单价六位算出 `1.00`；`multiplyToCents('2.000','0.005000')` 为 `0.01`；`sumCents(['0.01','0.02'])` 为 `0.03`。拒绝指数、负数、空串、前后空格以外的非数字内容、超过指定小数位和超过 PostgreSQL `numeric` 范围的值。
- [ ] 运行 `node --test tests/backend/erp-decimal.test.cjs`，确认因模块或导出缺失失败。
- [ ] 实现 `parseScaled(value, scale, maxIntegerDigits)`：只接受字符串或安全整数，正则验证完整十进制文本，拆分整数/小数，返回 `BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale,'0'))`；范围依据原文本整数位数检查，不经 `Number()`。
- [ ] 实现 `multiplyToCents(quantity, unitPrice)`：数量 scale 3、整数位最多 15；单价 scale 6、整数位最多 14；相乘所得 scale 9 的整数用 `(product + 5_000_000n) / 10_000_000n` 四舍五入到分；结果须容纳 `numeric(20,2)`。`sumCents` 解析每行已取整分金额并累加，不对总额再次舍入。
- [ ] 再运行测试；补充 `0.001 × 0.000001`、边界值、超界值和接近 IEEE-754 误差的案例。对外返回固定两位十进制字符串，绝不返回浮点 Number。
- [ ] 仅提交这两个文件，提交信息 `feat: add exact ERP decimal arithmetic`。

### Task 2：独立连接与迁移登记

**Files:** Create `backend/business-db/connection.js`, `backend/business-db/migrator.js`, `backend/business-db/migrations/0001_foundation.sql`; add `tests/backend/erp-postgres.test.cjs`。

- [ ] 在测试中先断言：缺少 `ERP_BUSINESS_DATABASE_URL` 时拒绝连接；仅凭现有 `DATABASE_URL` 不能误连日常 `app_store`；首次迁移后 `erp.schema_migrations` 有版本 `1` 与 SQL hash；重跑不重复应用。
- [ ] 运行 `node --test tests/backend/erp-postgres.test.cjs`，确认缺少连接模块而失败。测试通过 `ERP_BUSINESS_TEST_DATABASE_URL` 指向专用数据库，若未设置则跳过真实数据库用例，不能回退到日常数据库。
- [ ] `connection.js` 接收显式连接串并创建 Pool，不读取 `STORE_DRIVER`、`STORE_TABLE`、`DATA_DIR` 或默认 `DATABASE_URL`；暴露 `createBusinessPool({connectionString})` 与 `closeBusinessPool(pool)`。测试以 `SELECT current_setting('server_version_num')` 核对主版本 16。
- [ ] `migrator.js` 在取得事务级 advisory lock 后先用 `CREATE SCHEMA IF NOT EXISTS erp` 和 `CREATE TABLE IF NOT EXISTS erp.schema_migrations(version integer PRIMARY KEY, filename text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())` 自举登记表。`0001_foundation.sql` 创建 `erp.installation(id text PRIMARY KEY, server_id uuid NOT NULL UNIQUE, organization_name text NOT NULL, initialized_at timestamptz NOT NULL, storage_mode text NOT NULL CHECK(storage_mode IN ('legacy','relational')))`，只建结构，不导入日常安装信息。
- [ ] 按文件名升序读取 `/^\d{4}_[a-z0-9_]+\.sql$/`，计算文件 SHA-256；在同一 client 中 `BEGIN`、`SELECT pg_advisory_xact_lock(...)`、自举登记、校验登记、执行未应用 SQL、插入登记、`COMMIT`。已登记版本 hash 不同、数据库版本高于本代码、序号缺口、重复版本都拒绝启动，不试图自动修复。
- [ ] 加入两个 migrator 并发运行和修改历史 SQL 的测试：并发最终只登记一次；篡改版本拒绝且业务探针不变。运行专用测试。
- [ ] 提交这四个文件，提交信息 `feat: add isolated ERP migration registry`。

### Task 3：单事务边界

**Files:** Create `backend/business-db/transaction.js`; modify `tests/backend/erp-postgres.test.cjs`。

- [ ] 测试套件先在专用数据库创建 `erp.transaction_probe(id text PRIMARY KEY, value text NOT NULL, version bigint NOT NULL CHECK(version > 0))`，结束时清理；再写失败测试：`withBusinessTransaction(pool, async tx => { await tx.query('INSERT INTO erp.transaction_probe ...'); throw Error('abort') })` 后数据库无该行；成功回调只提交一次；嵌套业务函数接收同一 `tx` 时观察同一未提交写入。
- [ ] 实现 `withBusinessTransaction(pool, callback)`：`pool.connect()` 后 `BEGIN`，把唯一的 client 传给 callback，成功 `COMMIT` 返回值，失败 `ROLLBACK` 并保留原异常，最后 `release()`；不在服务内部另取 client。ROLLBACK 本身异常须保留原异常和回滚异常供日志诊断。
- [ ] 测试业务、审计、幂等回执三次写入的故障注入：第三次失败后三张测试表均无新记录；成功则三者同一次提交。02A 的探针表可用三个不同 ID 模拟该边界，正式表由 02B 提供。
- [ ] 运行 `node --test tests/backend/erp-postgres.test.cjs` 并提交，信息 `feat: add shared ERP transaction boundary`。

### Task 4：版本条件更新

**Files:** Create `backend/business-db/versioned.js`; modify `tests/backend/erp-postgres.test.cjs`。

- [ ] 写失败测试：同一探针 `version=1`，两个并发 `UPDATE ... WHERE version=1` 只有一个成功，结果 version=2；另一请求返回 `409 VERSION_CONFLICT`；目标不存在返回 404；非法 version（浮点、零、负数、缺失）返回 400。
- [ ] `updateVersioned(tx,{table,id,expectedVersion,changes})` 只允许注册过的目标表与列名，动态标识符不得来自请求体；SQL 必须形如 `UPDATE erp.transaction_probe SET value=$2, version=version+1 WHERE id=$1 AND version=$3 RETURNING *`。0 行时按 id 再查存在性，区分 404/409；不接受客户端覆盖 version、创建时间和服务器计算字段。
- [ ] 加测试证明同一事务内审计失败时版本变化回滚；再运行全部专用测试并提交，信息 `feat: add optimistic ERP update primitive`。

### Task 5：隔离 PostgreSQL 16 验证脚本

**Files:** Create `tests/ops/erp-02a-postgres.verify.ps1`; modify `backend/package.json`、`package.json` 增加 `verify:erp:foundation` 脚本。

- [ ] 脚本使用项目专属名称 `manage3d-erp-02a-verify` 启动一次性 PostgreSQL 16，随机高强度口令、随机可用本地端口、专用数据库；检测同名容器已存在时直接拒绝，不能清理用户已有容器。
- [ ] 设置 `ERP_BUSINESS_TEST_DATABASE_URL` 仅供子进程，运行 `node --test tests/backend/erp-decimal.test.cjs tests/backend/erp-postgres.test.cjs`；`finally` 只停止并删除脚本本次创建的容器。日志不输出 URL 或密码。
- [ ] 运行 `npm run verify:erp:foundation`；预期数值、迁移、事务与并发测试全部通过，并核对 `docker ps -a` 中不留本次测试容器。脚本失败时也执行同一清理逻辑。
- [ ] 提交脚本与 package 脚本，信息 `test: verify ERP foundation on isolated PostgreSQL`。

### Task 6：边界验收和阶段记录

**Files:** Modify `docs/superpowers/plans/2026-09-29-erp-priority-plan.md`, `docs/superpowers/specs/2026-09-29-erp-data-foundation-design.md`, `docs/RELEASE_CHECKLIST.md`；create `docs/rehearsals/2026-09-30-erp-02a-foundation.md`。

- [ ] 运行 `npm run verify:erp:foundation`、`npm run verify:erp`、`npm run verify:edit`、`npm run verify:backup` 和 `git diff --check`；任何失败先修复后记录。
- [ ] 读取日常服务的 serverId、schema 与 `app_store` 集合计数；运行 02A 隔离测试后再次只读核对，证明未触及日常数据。记录测试数据库身份、SQL hash、通过数、失败回滚和并发结果，不记录密钥。
- [ ] 在优先级计划中只勾选 02A 对应的精度/事务/版本基础，不勾选 02 的整体完成项；写明 02B/02C/02D 尚未接入，业务金额仍走现有 JSONB 算法。
- [ ] 提交记录，信息 `docs: record ERP 02A foundation verification`。

## 计划自检

02A 覆盖设计中的精确数值、迁移登记、事务与版本原语；客户匹配、核心关系表、迁移对账、主数据 CRUD、HTTP/CSV/AI 切换和旧客户端写守卫分别属于 02B–02D。02A 的产物不应被标记为关系存储已上线。所有测试必须使用明确的一次性数据库连接串；日常 `DATABASE_URL` 不能作为回退值。
