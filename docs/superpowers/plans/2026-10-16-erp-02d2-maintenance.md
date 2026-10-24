# ERP 02D2 Task3：关系业务事务维护屏障实施计划

> 细化已批准的停写/切换设计；不增加用户登录方式。不执行正式维护命令，不迁移正式数据。当前正式服务仍为旧JSONB，冷备时仍须停止应用进程。

**Goal:** 关系模式进入维护时先等待已有写事务提交或回滚，随后拒绝新业务写入，读取和诊断继续可用，重启不自动开写。

**Architecture:** 新增SQL v6单行runtime_control，使用共享/排他事务级advisory锁。所有公共业务/账号命令及登录审计先持共享锁并核对状态；主机维护命令持排他锁改变状态，与审计同事务。锁顺序固定为维护锁→幂等键→用户管理锁→用户/业务行，主机维护操作不持业务行锁再等维护锁。

**Tech Stack:** PostgreSQL16 advisory transaction locks、现有事务/版本更新器、Node test与隔离Docker。

## 边界

- 维护屏障保护关系库业务事实，包括账号/密码、登录审计、CSV导入、AI确认和文件登记。已有鉴权会话可以读取，维护期间登录因要写审计而返回503；不返回401清理本地会话。
- 这不是全量在线备份：聊天SQLite与文件完整冷备仍必须排空并停止应用。关系文件上传/OSS目前关闭，后续02D3开放前必须接同一维护规则；不能先写物理文件再发现登记被拒绝。
- 主机CLI只接受显式目标环境变量、预期serverId、版本和原因；不提供公开HTTP开关，不隐式迁移。当前legacy正式库不满足关系模式前提，不能误以为该命令已拦住旧JSONB写入。
- v1–v5 SQL不改。v6迁移初始化open供现有领域契约使用；正式离线切换流程必须在开放关系入口之前显式设maintenance并对账，02D4不得直接把默认open当作开放批准。

## 文件与责任

| 文件 | 职责 |
| --- | --- |
| `backend/business-db/migrations/0006_runtime_control.sql` | 单行持久维护状态、原因、version和更新时间 |
| `backend/business-db/maintenance.js` | 共享写屏障、只读状态、排他状态变更与审计 |
| `backend/business-db/versioned.js` | 导出现有versionString供主机状态服务复用，不改版本校验算法 |
| `backend/business-db/commands.js` | 在幂等键锁之前调用共享屏障，覆盖业务及账号命令 |
| `backend/modules/users/authentication.js` | 登录写事务在用户管理锁之前调用屏障；鉴权读取不加写锁 |
| `backend/modules/adapters/http.js` | 将已知维护503安全透传，不伪装成500或401 |
| `backend/scripts/erp-maintenance.js` | 显式主机status/enter/leave命令，错误不输出连接凭据 |
| `tests/backend/erp-maintenance.test.cjs` | 实际并发排空、阻写、重启、回滚及HTTP/CSV/AI验证 |
| `tests/ops/erp-02a-postgres.verify.ps1` | maintenance suite和既有领域回归 |

## Task1：先写实际PG失败用例

- [x] 测试限定loopback `/erp_02a_verify`，先migrate再seed安装/Owner/Staff/Viewer。新增maintenance suite，第一次因模块或v6不存在失败，日志保存 `.tmp/erp-02d2/maintenance-red.log`。
- [x] 覆盖：默认open、维护状态及版本持久化、错误serverId/mode/version拒绝、无原因/未知字段拒绝、审计失败回滚；读取不变、维护期间业务/账号/登录/CSV/AI确认无新事实、审计、回执或余额变化；开写后原键可正常完成。
- [x] 使用真实PG锁等待证明排空：旧命令进入handler后阻塞其提交，发起enter并在pg_stat_activity观察Lock，再发新命令；释放旧事务，确认旧事实完整提交、维护成功、新命令503且零副作用。不得用固定sleep代替已进入等待的证据。

```js
const inflight = commands({ operation: 'probe.write', actorId: 'owner', tokenVersion: '1', key: 'old', payload: {} });
await handlerEntered;
const entering = maintenance.setState({ expectedServerId, expectedVersion: '1', state: 'maintenance', reason: '隔离维护验收' });
await observeExclusiveLockWaiting();
const incoming = commands({ operation: 'probe.write', actorId: 'owner', tokenVersion: '1', key: 'new', payload: {} });
releaseHandler();
await inflight; await entering;
await assert.rejects(incoming, { code: 'BUSINESS_MAINTENANCE', status: 503 });
```

## Task2：SQL与共享屏障

- [x] 新SQL只包含以下维护表和初始行，不修改既有业务记录：

```sql
CREATE TABLE erp.runtime_control (
  id text PRIMARY KEY CHECK(id='default'),
  state text NOT NULL CHECK(state IN ('open','maintenance')),
  reason text NOT NULL DEFAULT '' CHECK(length(reason)<=1000),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO erp.runtime_control(id,state) VALUES('default','open');
```

- [x] maintenance.js实现共享屏障，不读取环境、补写缺行或吞掉错误：

```js
const MAINTENANCE_LOCK = [17042026, 3];
async function assertBusinessWritesAllowed(tx) {
  await tx.query('SELECT pg_advisory_xact_lock_shared($1,$2)', MAINTENANCE_LOCK);
  const row = (await tx.query("SELECT state FROM erp.runtime_control WHERE id='default'")).rows[0];
  if (!row || !['open','maintenance'].includes(row.state)) throw Object.assign(new Error('服务器维护状态不可用，请稍后重试'), { code: 'MAINTENANCE_STATE_INVALID', status: 503 });
  if (row.state === 'maintenance') throw Object.assign(new Error('服务器正在维护，暂时不能保存修改'), { code: 'BUSINESS_MAINTENANCE', status: 503 });
}
```

- [x] 公共命令withBusinessTransaction的第一步调用屏障，再执行原幂等键/角色/用户锁和业务流程。登录bcrypt仍在事务外，进入写事务后先屏障再lockUserWrites。鉴权及领域读取保持只读。

## Task3：主机状态服务与CLI

- [x] 暴露 `createMaintenanceService(pool).status({expectedServerId})` 和 `setState({expectedServerId,expectedVersion,state,reason})`。两个方法先用inspectBusinessStorage核对完整已知结构、身份及relational模式；无目标身份拒绝，不能隐式选择当前服务器。
- [x] status使用repeatable-read/read-only事务，读单行，返回serverId/state/reason/version/updatedAt；缺行或非法状态明确拒绝。setState参数严格白名单，reason为1–1000字符，状态仅open/maintenance，版本按已有更新器验证。
- [x] setState在单个事务先取排他锁，重读安装身份及状态，按version更新state/reason并递增version、更新时间，同事务写一条actor_id为null、来源host的system维护审计。错误版本409；状态已相同且版本匹配时返回原记录，不重复记审计。审计失败必须回滚状态和版本。

```js
await tx.query('SELECT pg_advisory_xact_lock($1,$2)', MAINTENANCE_LOCK);
const before = await readStatus(tx, expectedServerId);
// 固定注册erp.runtime_control的state/reason，禁止调用者选择表或列。
const after = await updateVersioned(tx, { table: 'erp.runtime_control', id: 'default', expectedVersion,
  changes: { state, reason } });
await tx.query("INSERT INTO erp.audit_logs(id,actor_id,entity,entity_id,action,diff) VALUES($1,NULL,'system',$2,$3,$4)",
  [randomUUID(), expectedServerId, state === 'maintenance' ? 'maintenance.enter' : 'maintenance.leave',
   JSON.stringify({ source: 'host', from: before.state, to: state, reason })]);
```

- [x] CLI严格解析action status/enter/leave与`--target-env --server-id --expected-version --reason`，拒绝重复、未知或缺值参数。目标变量名只能大写环境标识，status拒绝多余写参数，enter/leave必需版本和原因。CLI不自动dotenv或migrate；只用显式目标变量创建pool，finally关闭，输出公开状态JSON，失败仅输出code和中文错误。

```text
node backend/scripts/erp-maintenance.js status --target-env ERP_BUSINESS_TEST_DATABASE_URL --server-id <fixture UUID>
node backend/scripts/erp-maintenance.js enter --target-env ERP_BUSINESS_TEST_DATABASE_URL --server-id <fixture UUID> --expected-version 1 --reason 隔离维护验收
```

以上仅作隔离验收；本轮不能对正式DATABASE_URL执行enter/leave。需要正式维护时，先完成02D4可审核冷备与切换方案。

## Task4：接线及回归

- [x] HTTP仅将BUSINESS_MAINTENANCE、MAINTENANCE_STATE_INVALID等已知503透传中文消息；不暴露数据库原错误。验证原token读取仍200，登录维护503，重复键维护期间冻结、开放后重试无重复事实。
- [x] 库存/模型/耗材/订单/用户、CSV和AI确认都走公共屏障；用实际服务验证拒绝，不根据路由按钮是否隐藏来判定成功。
- [x] 执行maintenance、commands、catalog、orders、inventory、users、adapters、master-data、storage-mode、runtime、server-runtime及core/foundation/import有关回归，均零跳过；根据实际变化排查失败，禁止放宽维护规则让旧测试通过。
- [x] 记录v6hash及正式未变证据、更新计划并提交。Task3达到95%后进入Task4关系系统/统计；完整备份恢复和正式开写仍未完成，不提前推进阶段03。

## 当前状态

2026-10-16：Tasks1–4已完成，maintenance9项、实际server-runtime9项、12组相关回归161项，共179项通过，0跳过。正式未执行维护或迁移。推进02D2 Task4系统/统计，证据见 ../../rehearsals/2026-10-16-erp-02d2-runtime.md。
