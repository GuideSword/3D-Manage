# ERP 02B3 关系模式业务服务计划

> **For agentic workers:** Execute sequentially in this session. Steps use checkbox (`- [ ]`) syntax. Approved stage 02 design applies; do not switch production readers/writers in this package.

**Goal:** 为现有账号、模型、耗材、订单、库存建立关系模式业务服务，保证权限、版本、审计与幂等，并为 HTTP/CSV/AI 提供同一入口。

**Architecture:** `business-db/commands.js` 管理单事务、当前账号权限、幂等、审计与数据库异常；领域模块声明可信操作与字段白名单，通过事务 client 访问关系表。SQL v1/v2 不修改；必要新约束用新编号。当前业务路由继续运行原存储，02D 才切换。

**Tech Stack:** Node.js 22、pg、PostgreSQL 16、现有 BigInt 十进制与 versioned updater、node:test。

依据：[阶段 02 设计](../specs/2026-09-29-erp-data-foundation-design.md)、[02B2 验收](../../rehearsals/2026-10-15-erp-02b2-core-import.md)。02B3 不是整个阶段 02，客户/供应商/默认仓库页面属于 02C。

## Task 1：公共命令事务、权限、审计与幂等

**Files:** create `backend/business-db/commands.js`、`tests/backend/erp-commands.test.cjs`；modify `tests/ops/erp-02a-postgres.verify.ps1` 新增 commands suite。

- [x] 先写实际数据库测试：Staff 用伪造 owner 字段仍不能执行盘点；Viewer/停用用户/旧 token 拒绝；重复键回原结果，不同内容拒绝；并发同键只改一次；审计或回执失败时业务整体回滚。
- [x] 服务端注册表契约如下，不允许来自请求注册操作：

```js
const execute = createBusinessCommands(pool, {
  'probe.update': { roles: ['owner', 'staff'], async handle(tx, { actor, payload, audit }) {
    const row = await updateVersioned(tx, {
      table: 'erp.materials', id: payload.id, expectedVersion: payload.version, changes: { notes: payload.notes },
    });
    await audit({ entity: 'materials', entityId: row.id, action: 'update', diff: { notes: payload.notes } });
    return { status: 200, body: { id: row.id, version: row.version } };
  } },
});
await execute({ operation: 'probe.update', actorId: 'u1', tokenVersion: '1', key: 'request-uuid', payload: { id: 'mat1', version: '1', notes: '' } });
```

从 users 读取并锁定当前 active/role/token_version，忽略调用方 role。幂等身份为 scope/actor/key，scope 由服务端注册表指定（默认 business，原库存沿用 inventory）；摘要沿用既有 canonical({operation,payload})，保留旧回执重试能力。事务级锁序列化同键，返回已保存结果。业务/审计/回执一次提交，至少一条审计；业务函数只能产生事务内数据库事实，文件写入/外部调用另有生命周期管理，不放在此回调中。
- [x] 验证 schema 约束错误映射为 400/409；并发冲突不给自动覆盖，不重放外部副作用。运行 `pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite commands`，无跳过后提交。

## 后续任务范围（进入前分别细化代码步骤）

以下顺序保留全部 02B3 交付范围，Task 1 完成不能据此标记本包完成。

- [ ] Task 2：`backend/modules/materials/`、`models/` 的列表/详情/创建/版本编辑/停用/引用删除保护，模型文件子记录与原 metadata 保留。沿用命令入口与服务端字段白名单；测试原值回填/清空/并发和角色。
- [ ] Task 3：`backend/modules/orders/` 的精确金额、客户 FK/历史快照、附件及规格保留、状态转换、版本编辑、删除保护；新单逐行金额取整，历史单不得在无行修改时重算。CSV 整批同事务。
- [ ] Task 4：`backend/modules/inventory/` 的锁定余额、入出库/盘点/报废、受控期初、批次资料版本编辑、流水与回执同事务；并发不同键不超扣，旧绝对盘点不累加。
- [ ] Task 5：`backend/modules/users/` 的安全账号 DTO、角色与最后有效 Owner 保护、密码/token 失效、用户姓名编辑；读取与认证适配不暴露 hash。完成用户管理并发验证。
- [ ] Task 6：领域服务实际 PG 验证及 HTTP/CSV/AI 适配契约测试，核对不导入旧 store，不把 JSONB 作为业务写入目标。正式同源接线与发布仍属于 02D。

主数据 CRUD/页面在 02C，维护停写/正式批准映射/冷备份/切换/恢复及客户端能力守卫在 02D；阶段 03–12 仍按总计划执行。每包达到约 95% 且余项不阻断才推进。

## 当前进度（2026-10-15）

Task 1 已实现，实际 PostgreSQL commands suite 9/9、0 跳过；命令权限读取数据库当前账号，Viewer 不能注册写操作，旧 token/停用用户拒绝。操作/规范 payload 摘要兼容原库存回执，同键并发与同账号编辑重试只提交一次。审计/回执失败整体回滚。下一步 Task 2 模型/耗材关系服务；Task 2–6、整个 02B3 和阶段 02 均未完成。见[Task 1 验收](../../rehearsals/2026-10-15-erp-02b3-command-boundary.md)。
