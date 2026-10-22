# ERP 02D1：只读存储模式与启动前核验实施计划

> 按已批准阶段02设计逐项实施。沿用总计划：缺少执行类子技能时使用现有工具执行，不派发子代理。本包是02D第一项，不直接发布或迁移正式数据。

**Goal:** 从同一 PostgreSQL 只读判断 legacy/relational；关系结构异常、版本过高、迁移文件变化或服务器身份不符时明确拒绝，不能自动退回旧JSONB。

**Architecture:** 将迁移记录的纯校验从现有 migrator 抽出供迁移器和新 inspector 共用。inspector 使用一个 repeatable-read/read-only 事务，仅接收显式 pool，不读取环境变量、不初始化旧 store、不执行DDL或补写。后续运行入口接线单独实施。

**Tech Stack:** Node.js、pg、PostgreSQL16、Node test、现有隔离Docker验证脚本。

**前置证据:** [02C完成评估](../../rehearsals/2026-10-15-erp-02c-master-data.md)。用户已确认模拟器已启动；ADB识别 emulator-5558，后续设备操作指定该序列号，不能将它当成本包已停止的专用AVD。

## 02D 内部执行顺序

1. **02D1（本文）**：只读模式/版本/身份核验；不挂载正式入口。
2. **02D2**：同一模式启动和请求分派、维护停写、组织/统计/认证/主机Owner恢复；避免初始化旧store或AI桥时意外写旧事实源。
3. **02D3**：其余客户端模型/耗材/库存/用户/订单状态/CSV写操作统一版本和幂等；multipart、本地及OSS文件生命周期、受控下载；真实HTTP/CSV/AI业务同源，保留聊天SQLite。
4. **02D4**：完整关系备份清单及隔离恢复、具体历史映射复核、切换命令与演练；具备可审阅证据后才进行正式维护冷备/导入/开写。切换后新业务不得用恢复旧JSONB抹掉。

上述后三包进入时细化代码步骤；现有已批准设计仍约束全部范围，不能用本包完成替代整个02D完成。正式客户映射尚未批准，原账号、订单、文件与AI数据不得因本包改变。

## 文件与职责

| 文件 | 动作与责任 |
| --- | --- |
| `backend/business-db/migrator.js` | 抽出并导出 assertMigrationHistory，原迁移器复用，默认仍允许补齐未执行版本 |
| `backend/business-db/storageMode.js` | 新增 inspectBusinessStorage；只读核验并返回稳定模式描述 |
| `tests/backend/erp-storage-mode.test.cjs` | 隔离PG实际验证，拒绝非专用测试库；错误不会改数据或回退 |
| `tests/ops/erp-02a-postgres.verify.ps1` | 新增storage-mode suite选择；沿用临时容器、凭据和退出清理 |
| `docs/rehearsals/2026-10-16-erp-02d1-storage-mode.md` | 实际测试、边界和下一项证据 |

## Task 1：先锁定只读模式契约

- [x] 新建测试文件，限定 `ERP_BUSINESS_TEST_DATABASE_URL` 的 loopback `/erp_02a_verify`，不读正式DATABASE_URL。测试空库、已有legacy JSONB、只有半个erp schema、完整关系库、身份不符、未知mode、缺/篡改/未来迁移以及并发重复读取。完整初始化使用现有 migrateBusinessDatabase，测试后直接读取业务及迁移记录对比。
- [x] 在隔离数据库先建旧store并断言 inspector 不执行迁移或补写：

```js
await pool.query('CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL)');
await pool.query("INSERT INTO public.app_store VALUES('default','{\"proof\":9007199254740993.01}')");
const before = (await pool.query('SELECT data::text AS raw FROM public.app_store')).rows;
assert.deepEqual(await inspectBusinessStorage(pool), { mode: 'legacy', schemaVersion: 0, installation: null });
assert.equal((await pool.query("SELECT to_regnamespace('erp') AS name")).rows[0].name, null);
assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
```

- [x] 增加 suite 的实际选择代码，运行 `pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite storage-mode`；首次应因 inspector 尚不存在失败，保留 `.tmp/erp-02d1/storage-mode-red.log`。

```powershell
# ValidateSet 增加 storage-mode；测试选择分支增加：
} elseif ($Suite -eq 'storage-mode') { @('tests/backend/erp-storage-mode.test.cjs')
```

## Task 2：共用迁移历史校验

- [x] 将 migrator 现有逐行检查移至以下函数，迁移器在加载记录后调用默认选项；inspector 传 requireCurrent:true。原错误码保持稳定。

```js
function assertMigrationHistory(rows, migrations, { requireCurrent = false } = {}) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index], source = migrations[row.version - 1];
    if (!source) throw migrationError('ERP_MIGRATION_FUTURE', '数据库迁移版本高于当前程序，请先升级');
    if (row.version !== index + 1) throw migrationError('ERP_MIGRATION_HISTORY_INVALID', '数据库迁移登记不连续');
    if (row.filename !== source.filename || row.sha256 !== source.sha256) {
      throw migrationError('ERP_MIGRATION_CHANGED', '已执行的迁移文件被修改，拒绝继续迁移');
    }
  }
  if (requireCurrent && rows.length !== migrations.length) {
    throw migrationError('ERP_MIGRATION_PENDING', '数据库结构尚未升级完成，请先完成维护迁移');
  }
  return migrations.at(-1).version;
}
```

- [x] 用 `-Suite foundation` 与 `-Suite core` 复验空库并发迁移、失败回滚、旧版本升级、hash/未来版本拒绝；全部无跳过后再继续。不得修改v1–v5 SQL。

## Task 3：实现只读 inspector 并验证

- [x] 新文件只依赖 migrator/transaction/connection；不import legacy store、用户服务或AI DB。暴露接口如下，数据库连接失败直接抛出，不加legacy兜底catch：

```js
const path = require('node:path');
const { loadMigrations, assertMigrationHistory } = require('./migrator');
const { withBusinessTransaction } = require('./transaction');
const { assertBusinessDatabaseVersion } = require('./connection');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
async function inspectBusinessStorage(pool, { expectedServerId, migrationsDirectory } = {}) {
  const migrations = await loadMigrations(migrationsDirectory || path.join(__dirname, 'migrations'));
  return withBusinessTransaction(pool, async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assertBusinessDatabaseVersion(tx);
    const schema = (await tx.query("SELECT to_regnamespace('erp') AS name")).rows[0].name;
    if (!schema) return { mode: 'legacy', schemaVersion: 0, installation: null };
    const tables = (await tx.query("SELECT to_regclass('erp.schema_migrations') AS history_table, to_regclass('erp.installation') AS installation_table")).rows[0];
    if (!tables.history_table || !tables.installation_table) fail('ERP_STORAGE_INCOMPLETE', '关系数据结构不完整，请先完成维护核对');
    const history = (await tx.query('SELECT version,filename,sha256 FROM erp.schema_migrations ORDER BY version')).rows;
    const schemaVersion = assertMigrationHistory(history, migrations, { requireCurrent: true });
    const rows = (await tx.query('SELECT id,server_id,organization_name,initialized_at,storage_mode FROM erp.installation')).rows;
    if (rows.length !== 1 || rows[0].id !== 'default') fail('ERP_STORAGE_INCOMPLETE', '缺少唯一安装记录，请先完成维护核对');
    const row = rows[0];
    if (!['legacy', 'relational'].includes(row.storage_mode)) fail('ERP_STORAGE_MODE_INVALID', '无法识别业务存储模式，拒绝启动');
    if (typeof row.server_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.server_id)
      || typeof row.organization_name !== 'string' || !(row.initialized_at instanceof Date) || !Number.isFinite(row.initialized_at.getTime())) {
      fail('ERP_STORAGE_INCOMPLETE', '安装记录无效，请先完成维护核对');
    }
    if (expectedServerId !== undefined && (typeof expectedServerId !== 'string' || expectedServerId.toLowerCase() !== row.server_id.toLowerCase())) {
      fail('ERP_STORAGE_IDENTITY_MISMATCH', '关系数据库与当前服务器身份不一致，拒绝切换');
    }
    const installation = { serverId: row.server_id, organizationName: row.organization_name, initializedAt: row.initialized_at.toISOString() };
    return { mode: rows[0].storage_mode, schemaVersion, installation };
  });
}
module.exports = { inspectBusinessStorage };
```

- [x] 将上述边界检查写为实际分支：缺少/多条/非default/非法mode或身份/空初始化记录分别拒绝；expectedServerId仅在提供时比较。对缺少安装记录的已建erp库拒绝，而不是自动bootstrap。只读函数不能创建schema/角色/安装记录或更改storage_mode。
- [x] 为相同版本正确hash的两个mode分别断言；先故意破坏历史，再检查对应拒绝码，并在隔离测试中恢复fixture。数据库超版本、缺迁移、错误hash、空安装及身份不符，均保留原JSONB、所有关系数据和迁移记录。
- [x] 包装真实PG连接观察事务read_only为on、无INSERT/UPDATE/DELETE/DDL，异常也释放连接；并发重复读取结果一致。完成storage-mode、foundation、core专项且无跳过后记录结果并提交。

## Task 4：推进记录

- [x] 更新本文、总计划和验收记录，记录02C临时服务/容器/专用AVD已核对归属并停止、临时测试凭据已删除、证据保留。
- [x] 本包达到95%后开始02D2详细计划；正式路由仍未接线，不能把只读核验测试当作维护冷备、完整恢复或正式迁移完成。

## 当前状态

2026-10-16：Tasks1–4已完成范围内实施和记录，storage-mode15/15、foundation17/17、core9/9，无跳过；02D1达到约95%推进线，开始02D2运行入口详细规划。正式存储保持旧JSONB，本包未挂载正式启动；整个阶段02仍进行中。验收见 ../../rehearsals/2026-10-16-erp-02d1-storage-mode.md。
