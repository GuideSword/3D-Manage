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

## Task 2 执行步骤：模型与耗材

**Files:** create `backend/business-db/reads.js`、`backend/modules/catalog/validation.js`、`backend/modules/materials/service.js`、`backend/modules/models/service.js`、`tests/backend/erp-catalog.test.cjs`；extend `business-db/versioned.js` 的受信删除与更新时间选项、隔离 runner 的 catalog suite。

- [x] 写实际 PG 用例，确认模块尚不存在导致失败。断言新建返回服务端 UUID/version；Viewer 可读不可写；原备注清空、未传字段保留、非法字段/精度拒绝；同版本并发只有一个成功；stock_lots/order_items 引用阻止删除。
- [x] 实现只读一致快照与会话核验，列表按搜索/active/分页过滤；ID/version/精确小数字符串和 ISO 时间输出。读取 legacy JSON 使用数值原文，旧扩展字段不被新编辑重写。
- [x] 耗材注册 `material.create/update/setActive/delete/import`。创建验证 type/brand/color/unitPrice，原采购单位保留；数量/价格不用浮点转换。编辑契约 `{id,version,changes:{notes:''}}`，只允许资料字段；停用单独用 `{id,version,active:false}`。
- [x] 模型注册 `model.create/update/setActive/delete/import` 和 `model.file.add/remove`、`model.image.add/remove`。普通编辑不能覆盖文件/图片数组。子记录变更先锁定父模型并校验版本；文件必须在上传根目录通过实际 hash/大小/路径检查，新增子 ID 由服务端生成，位置按现有最大位置递增。已有未知 metadata 不重写。
- [x] 删除 unused 模型时在父锁下删除其子引用，再删除父对象；若订单仍引用模型则整笔回滚。仅解除资料引用，不删除物理文件，后续 02D 文件生命周期处理共享引用/孤儿清理。
- [x] 验证模型原始文件、图片与扩展字段保留，添加/移除图片、错误 hash/路径与旧版本拒绝；文件变化与父版本/审计/回执整体回滚。测试同键重试与批量导入第二项非法时整批撤销。
- [x] 执行 `pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite catalog`、commands 回归；其他受影响版本/迁移用例通过后提交。来源库仍不接线。

调用契约：

```js
const materials = createMaterialService(pool);
const created = await materials.execute({operation:'material.create',actorId:'owner',tokenVersion:'1',key:'uuid',payload:{type:'PLA',brand:'品牌',color:'白色',unitPrice:'25.000001',unit:'kg'}});
await materials.execute({operation:'material.update',actorId:'owner',tokenVersion:'1',key:'next-uuid',payload:{id:created.body.id,version:created.body.version,changes:{notes:''}}});
const models = createModelService(pool, {uploadDirectory});
await models.list({actorId:'viewer',tokenVersion:'1'},{search:'模型',active:'all',limit:50,offset:0});
```

## Task 3 执行步骤：订单关系服务

**Files:** create `backend/modules/orders/lines.js`、`repository.js`、`service.js`、`attachments.js`、`tests/backend/erp-relational-orders.test.cjs`、`business-db/migrations/0003_order_editing.sql`；提取 `modules/catalog/files.js` 共用本地文件验证；extend import、core suite 与隔离 runner。

- [x] 写实际 PG 验收用例，确认缺少订单模块时失败：精确逐行取整和总额、超过 2^53、客户改名不覆盖快照、行说明/备注不重计价、在制商业修改拒绝、并发版本、附件/未知 JSON 保留、引用删除保护、批量失败全回滚。
- [x] SQL v3 增加 status_reason 并从原快照补齐；行位置唯一约束改为事务末检查以支持交换顺序。v1/v2 不改；导入器显式复制历史 statusReason，core 验证随最新迁移升级。
- [x] 行契约只允许 id（仅已有行）、modelId/modelName、quantity/unitPrice、materialType/color/layerHeightMm/externalFileUrl/notes。新行 ID 由服务端生成，subtotal/total 不接受客户端决定。数量三位、单价六位，调用 multiplyToCents/sumCents；未改价格或数量时保留原行金额，未改金融事实时保留原 total。
- [x] 资料修改先锁父订单并校验 version；行保留原 ID，原位更新并以 JSONB 合并已允许字段，未知快照数字不经过 JS 浮点重写；仅删除实际移除行。关联模型未变时保留原名称，历史已失效模型引用允许沿用原快照，新选模型须有效且启用。
- [x] 新订单绑定有效客户并复制姓名/联系/地址；已有单修改客户档案不回写订单。更换客户或显式刷新快照只允许 draft/pending_review 且没有关联库存事实；in_progress/completed/cancelled 只允许说明性资料编辑。状态变更使用原 allowedTransitions 独立命令并审计原因。
- [x] 注册 order.create/update/transition/delete/import、order.refreshCustomer、order.attachment.add/remove。附件验证实际路径/hash/大小，与父版本/审计/回执原子提交，普通编辑不得覆盖附件数组；解除引用和删除订单不删除物理文件。库存事实及后续 FK 拒绝删除并完整回滚子清理。
- [x] 只读列表/详情输出精确字符串、客户/行/附件快照，支持搜索、状态、客户、日期与分页。批量导入复用同一创建服务，第二条无效则第一条也回滚。HTTP/CSV/AI 接线仍属于 02D。
- [x] 执行 orders、catalog、commands、core、import 必要回归及既有库存/编辑/备份；保存正式只读 hash/结构证据、更新计划并提交。本项达门槛后进入 Task 4 库存关系服务，不能标记阶段 02 完成。

调用契约：

```js
const orders = createOrderService(pool, {uploadDirectory});
const {body: order} = await orders.execute({operation:'order.create',actorId:'owner',tokenVersion:'1',key:'request-id',payload:{customerId:'c1',items:[{modelId:'m1',quantity:'0.333',unitPrice:'3.000001'}]}});
await orders.execute({operation:'order.update',actorId:'owner',tokenVersion:'1',key:'next-id',payload:{id:order.id,version:order.version,changes:{notes:''}}});
```

## Task 4 执行步骤：库存关系服务

**Files:** create `backend/modules/inventory/quantity.js`、`repository.js`、`movements.js`、`service.js`、`tests/backend/erp-relational-inventory.test.cjs`、`business-db/migrations/0004_inventory_posting_order.sql`；extend 隔离 runner 的 inventory suite。

- [x] 写实际 PG 验收：期初/入出库/盘点/报废 before/after/delta，重复键及并发同键一次记账，不同键争抢不超扣；资料编辑不改余额；非法批量第二项全回滚；旧绝对 adjust 不累加，legacy_invalid 不可操作。
- [x] 数量以十进制克字符串解析成 BigInt 毫克，单批余额受 PostgreSQL int64 上限约束；拒绝负数/指数/多余精度/部分解析/不安全 Number，输出克和毫克字符串，不做浮点累计。
- [x] 注册原库存命令名与 inventory scope，保持旧回执摘要重放：lot.create、lots.import、inventory.post、lot.update、lot.archive、lot.delete；增加受控 lot.setState（只在 in_stock/frozen 之间切换，不能恢复已报废批次）。资料编辑/停用/删除必须 version，普通过账可携带快照版本，绝对盘点必须 version。来源、actor、余额和 ledger 字段由服务器决定。
- [x] 库存使用默认启用仓库；新批次须有效启用耗材。正期初生成唯一 opening 入库事实，基线为 0；0 期初不伪造数量流水。post 先锁关联订单，再锁批次，检查启用/冻结/报废/历史余额与可用量后一次写余额、流水、审计、回执；盘点与报废只允许 Owner（按阶段 02 设计，比原 P0 Staff 报废权限收紧）。
- [x] SQL v4 增加内部 posting_seq，保证同批流水稳定顺序，不依赖并发事务开始时间或 UUID 排序。旧 v3 已有行保持 NULL，不伪造先后；新插入/隔离导入按实际插入顺序分配。v1–v3 不修改，库存事实不可编辑。
- [x] 批次资料采用白名单，不接受数量、物料、仓库、账本字段。photoKey 替换验证本地文件，清空不删除物理内容。删除须 tracked/零余额/无流水/无旧订单快照或 FK 引用，失败完整回滚，删除审计保留原资料。
- [x] 只读提供批次列表/详情、流水列表/详情、当前账号回执和库存摘要；均复核账号、同一只读一致快照。摘要使用当前余额/可操作余额，单独暴露历史未核验和非法余额；不靠求和旧流水推断余额。数量总和使用 PG numeric/BigInt，即使多批总量超过单 bigint 仍精确。
- [x] 实际 PG 验证 Owner/Staff/Viewer、失效 token、超界余额、冻结/停用/报废、订单锁协作、批次资料版本与库存竞争、审计/回执故障回滚、正常及旧流水可读、无跳过。完成库存/订单/公共命令/core/import必要回归与既有库存/编辑/备份，记录正式只读数据未改变；达到约 95% 后进入 Task 5 用户服务。

调用契约：

```js
const inventory = createInventoryService(pool, {uploadDirectory});
const {body: lot} = await inventory.execute({operation:'lot.create',actorId:'owner',tokenVersion:'1',key:'create-id',payload:{materialId:'mat1',qty:'500',unit:'g'}});
await inventory.execute({operation:'inventory.post',actorId:'staff',tokenVersion:'1',key:'out-id',payload:{lotId:lot.id,type:'out',qty:'100',orderId:'o1'}});
await inventory.execute({operation:'lot.update',actorId:'owner',tokenVersion:'1',key:'edit-id',payload:{id:lot.id,version:'2',changes:{location:'A-01',notes:''}}});
```

## Task 5 执行步骤：用户与认证关系服务

**Files:** create `backend/modules/users/{validation,repository,service,authentication}.js`、`business-db/userGuard.js`、`business-db/migrations/0005_user_protection.sql`、`tests/backend/erp-relational-users.test.cjs`；extend `business-db/commands.js`、import/core 必要验证和 runner 的 users suite。

- [x] 写实际 PG 用例确认模块缺失：Owner 用户 CRUD/姓名编辑，Staff/Viewer 管理拒绝，公开 DTO 无 hash，重复邮箱，旧版本，最后有效 Owner 及两 Owner 并发保护；密码重置/本人修改、旧 token 失效、失败回滚和秘密不进入审计/回执。
- [x] SQL v5 增加 last_login_at 并保留旧值；user_write_guard 单行在用户 UPDATE/DELETE 前锁定并翻转，用于并发与 RR 写冲突；延迟约束拒绝移除最后有效 Owner。空库初始化允许尚无用户，已存在 Owner 不得失去最后一位。v1–v4 不修改，导入复制原 hash/tokenVersion/lastLoginAt。
- [x] 公共命令增加服务端声明 lockUsers，在任何账号共享锁前取得 guard，避免两个 Owner 交叉管理互锁；增加服务器自定义 payloadDigest。凭据操作采用 JWT 密钥经用途隔离派生的 HMAC 摘要，禁止用包含密码的普通 SHA-256 充当可离线猜测的密码验证器。只保存摘要，不保存命令 payload。
- [x] user.create/update/delete/resetPassword 仅 Owner；ID 由服务器生成，email 创建时归一且编辑不可变，name/role/active 白名单、编辑与删除须 version。角色或启用状态变化递增 token_version，姓名变化不注销会话；删除受 FK 与自删/最后 Owner 保护，删除前审计仅使用公开 DTO。Owner 密码沿用本人修改或主机恢复，不由普通重置入口覆盖。
- [x] 新增单独 account.changePassword 入口，允许 Owner/Staff/Viewer 维护本人密码，目标只来自当前已核验账号，不能提交他人 ID。复用事务/审计/回执与 guard；普通业务命令仍不能注册 Viewer 写权限。需当前密码、version 和新密码，成功递增版本及 token_version，全部旧登录失效。
- [x] 密码设置沿用现有 12 字符/72 UTF-8 字节上限、bcrypt 12；密码与 hash 不出现在 DTO、日志、审计或回执结果中。新工厂必须显式传入足够长度 JWT 密钥，不读取日常业务连接或自行生成替代凭据；任何正式账号不修改。
- [x] 认证服务从 installation 读取服务器身份，保持 HS256 issuer/audience 与旧令牌兼容；ver 同时接受旧安全整数和新字符串。登录用旧 hash 校验，不自动改密码；成功更新登录时间并写不含密码的审计。密码校验后在 guard 下重新读取，防止重置竞争。缺失账号使用 dummy bcrypt 比较，失败提示一致；鉴权不取密码 hash，DB 故障不得伪装成账号失效。HTTP 登录限流复用与路由接线属于 Task 6/02D。
- [x] 实际 PG 验证两个 Owner 并发自停用至少保留一位、直接 RR 更新不会写偏、延迟约束及 FK、并发版本、凭据故障回滚、JWT 过期/错误签名/错服务器/旧 ver。运行 users、commands/core/import 与相关领域回归；核对正式数据只读前后一致并更新计划，达到约 95% 后进入 Task 6 适配契约。

调用契约：

```js
const users = createUserService(pool, {jwtSecret});
const created = await users.execute({operation:'user.create',actorId:'owner',tokenVersion:'1',key:'create-id',payload:{email:'staff@example.test',name:'员工',role:'staff',password:'A-long-password'}});
await users.execute({operation:'user.update',actorId:'owner',tokenVersion:'1',key:'edit-id',payload:{id:created.body.id,version:created.body.version,changes:{name:'新姓名'}}});
const authentication = createUserAuthentication(pool, {jwtSecret});
const login = await authentication.login({email,password});
const session = await authentication.authenticate(login.token);
await users.changeOwnPassword({...session,key:'password-id',payload:{version:session.user.version,currentPassword,newPassword}});
```

## 后续任务范围（进入前分别细化代码步骤）

以下顺序保留全部 02B3 交付范围，Task 1 完成不能据此标记本包完成。

- [x] Task 2：`backend/modules/materials/`、`models/` 的列表/详情/创建/版本编辑/停用/引用删除保护，模型文件子记录与原 metadata 保留。沿用命令入口与服务端字段白名单；测试原值回填/清空/并发和角色。
- [x] Task 3：`backend/modules/orders/` 的精确金额、客户 FK/历史快照、附件及规格保留、状态转换、版本编辑、删除保护；新单逐行金额取整，历史单不得在无行修改时重算。CSV 整批同事务。
- [x] Task 4：`backend/modules/inventory/` 的锁定余额、入出库/盘点/报废、受控期初、批次资料版本编辑、流水与回执同事务；并发不同键不超扣，旧绝对盘点不累加。
- [x] Task 5：`backend/modules/users/` 的安全账号 DTO、角色与最后有效 Owner 保护、密码/token 失效、用户姓名编辑；读取与认证适配不暴露 hash。完成用户管理并发验证。
- [ ] Task 6：领域服务实际 PG 验证及 HTTP/CSV/AI 适配契约测试，核对不导入旧 store，不把 JSONB 作为业务写入目标。正式同源接线与发布仍属于 02D。

主数据 CRUD/页面在 02C，维护停写/正式批准映射/冷备份/切换/恢复及客户端能力守卫在 02D；阶段 03–12 仍按总计划执行。每包达到约 95% 且余项不阻断才推进。

## 当前进度（2026-10-15）

Tasks 1–5 已完成并达到推进门槛。用户 18/18、库存 16/16、订单 15/15、catalog 12/12、commands 9/9、core 9/9、import 12/12 及既有库存/编辑/备份 30/30 通过，均无跳过。v5 隔离升级和正式快照副本导入/重跑通过；正式来源 hash、账号凭据与业务/AI 摘要未变化，正式库仍无 erp schema。下一步 Task 6 HTTP/CSV/AI 适配契约；整个 02B3、02C/02D 和阶段 02 尚未完成。证据见 [Task 1](../../rehearsals/2026-10-15-erp-02b3-command-boundary.md)、[Task 2](../../rehearsals/2026-10-15-erp-02b3-catalog.md)、[Task 3](../../rehearsals/2026-10-15-erp-02b3-orders.md)、[Task 4](../../rehearsals/2026-10-15-erp-02b3-inventory.md)、[Task 5](../../rehearsals/2026-10-15-erp-02b3-users.md)。
