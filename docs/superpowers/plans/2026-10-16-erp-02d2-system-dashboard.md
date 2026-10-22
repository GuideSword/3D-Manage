# ERP 02D2 Task4：关系系统资料与首页统计

> 延用已批准阶段02设计，不增加采购、财务或认证方案。02D2 Tasks1–3已过推进线，当前仅隔离实施，不更新正式Docker。

**Goal:** 组织资料按Owner/版本/幂等维护，首页从关系库完整聚合读取，不依靠一页库存或多个时点的列表估算。

**Architecture:** 新增system领域服务，组织编辑走公共维护屏障和审计回执，dashboard在同一只读快照统计全量记录并读取最近4单。客户端仅在新dashboard能力存在时使用它，旧服务器保持原首页请求。

**Tech Stack:** PostgreSQL精确聚合、Express、Expo/React Native/Web、Node test、隔离无界面浏览器及ADB。

## 已确认契约

- 当前首页实际以三个订单列表及一个库存列表计算，不存在旧orders/stats接口。关系分页会使超过100批次的库存提示漏计，改用 `/system/dashboard`，移除未发布的stats占位。
- 首页lowStock保留已有“启用、在库、非legacy_invalid、余额≤100g的批次个数”口径；不是按材料汇总的availableQty<100g提示。用SQL整数毫克比较，不重新计价或改库存规则。订单统计及最近订单只包含启用记录。
- 组织API延续旧organizationName字段，新增关系版version与幂等；仅Owner写，所有已鉴权角色读取。没有新增组织UI需求，先保持已有系统API能力。
- dashboard金额和数量来自既有精确DTO，最近4条不改变历史价格。维护期间允许读取，组织编辑503；系统发现公开只给维护状态/可写布尔值，不暴露维护原因、账号或凭据。

## 文件职责

- 新增 `backend/business-db/migrations/0007_installation_version.sql`，为installation追加version，v1–v6不改；既有fixture位置INSERT改显式五列，恢复记录时明确包含原version。
- 新增 `backend/modules/system/service.js`；修改 `adapters/services.js`、`http.js`、`application/relationalRuntime.js`。
- 新增 `utils/relationalSystemApi.js`、`utils/systemDashboardCore.cjs`、`tests/client/system-dashboard.test.cjs`；修改 `screens/HomeScreen.js`。
- 新增 `tests/backend/erp-system.test.cjs`、system suite，扩展实际server-runtime发现/dashboard与维护验证；隔离UI脚本/证据按验收实际落盘。

## Task1：失败测试与精确协议

- [x] 先写PG与HTTP测试：Owner组织改名带version/原键重试、Staff/Viewer403、冲突保留原值、未知字段拒绝、维护拒写、审计/回执失败回滚。发现与组织读取反映同一serverId/名称/version。
- [x] dashboard用超过100条合格批次、恰100g/100.001g、冻结/报废/停用/无效余额及启用/停用各状态订单验证全量口径；最近4单金额保留大数字字符串。同一只读事务读取，跨角色一致且维护可读。
- [x] 先增加suite并运行失败；再实施。客户端先测试能力缺失回退、非法计数拒绝、最近订单大金额保留和行数限制。

## Task2：组织版本与领域服务

- [x] 新SQL只追加：

```sql
ALTER TABLE erp.installation ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0);
```

- [x] 全仓库定位INSERT installation无列名的fixture，仅改显式原五列；不修改导入器既有保留原身份的逻辑。更新缺安装测试的恢复INSERT为六列并恢复原version。
- [x] 新服务公开organization(session)、dashboard(session)及execute；组织命令注册为 `organization.update`，roles为owner。payload仅version/organizationName，名称trim后1–120字符，使用固定注册表更新器及公共commands，不允许写serverId/mode/初始化时间。

```js
await update(tx, { table:'erp.installation', id:'default', expectedVersion: payload.version,
  changes:{organization_name: name} });
await audit({ entity:'system', entityId:before.serverId, action:'organization.update',
  diff:{before:before.organizationName,after:name} });
return {status:200,body:await organizationInTransaction(tx)};
```

- [x] dashboard通过withAuthenticatedRead的同一repeatable-read/read-only事务，分别聚合状态及批次，再按created_at/id倒序取启用订单4条，复用orders.repository.detail，不走另一个连接或读旧store：

```sql
SELECT count(*) FILTER(WHERE status='pending_review')::int AS pending_review,
       count(*) FILTER(WHERE status='in_progress')::int AS in_progress
FROM erp.orders WHERE active;
SELECT count(*)::int AS low_stock FROM erp.stock_lots
WHERE active AND state='in_stock' AND balance_status<>'legacy_invalid' AND qty_mg<=100000;
```

返回`{stats:{pendingReview,inProgress,lowStock},recentOrders}`，金额保持字符串。只读端不增加审计。

## Task3：HTTP与系统发现

- [x] 在动态id路由前注册GET `/system/organization`、PATCH同路径、GET `/system/dashboard`。修改要求业务版本2、JWT当前Owner、幂等键和version；GET全部鉴权但不要求写头。
- [x] 发现接口加入organizationVersion、selfHosted、dashboardRulesVersion:1及当前businessWritable/maintenance布尔值，关系文件/AI未接好前不能宣称可用。Cache-Control:no-store。不存在安装记录时仍报告未初始化，不自动bootstrap或造Owner。
- [x] 剥离合法单一数字`_`缓存参数为共用传输处理，列表/库存summary/CSV导出均调用；拒绝非法/重复`_`及未知业务筛选。保持严格领域白名单。补充实际HTTP回归，不能只改首页逃过安卓问题。
- [x] 移除关系factory组织/统计占位，保留未交付files/oss/agent的503。更新实际server测试，dashboard正常而不是假装stats已实现。

## Task4：客户端与Web/安卓验收

- [x] 能力必须同时满足当前关系服务及dashboardRulesVersion=1；无此字段时用原首页逻辑。新增GET封装复用scoped关系请求，不改已有未提交utils/api.js工作。
- [x] 纯函数校验三个计数为非负安全整数、recentOrders最多4条有效id；不转换订单金额或数量。HomeScreen新分支从单份snapshot更新统计和最近订单，仍用现有焦点/请求序号与401处理；失败清除当前统计并提示刷新，旧服务器分支不改。
- [x] 构建Web并以隔离真实后台验证三角色首页、超过一页库存准确计数、维护读取、401/失败重试、旧能力回退及窄屏。使用无界面测试浏览器，不占桌面。
- [x] Android先核对用户设备emulator-5558及ABI。若已有日常应用，优先生成独立验收applicationId的测试APK，保留原应用/服务器/会话；记录包标识/版本/hash/安装结果，实测新首页计数和刷新。只能ADB，不使用Computer Use或电脑输入法。
- [x] 运行system、server-runtime、adapters、maintenance和相关客户端测试，SQL/公共接口变化所需领域回归无跳过；正式只读摘要核对、更新计划和提交。本项达到95%后进入Task5主机Owner恢复，整个阶段02仍不标完成。

## 完成记录（2026-10-16）

本包达到约95%推进线。后端9组97项、客户端3项均通过且无跳过；真实Web7组通过，pageErrors为空；独立安卓包在emulator-5558实际安装并验证5组场景。正式数据/AI只读摘要与维护包收尾完全一致，原应用未覆盖，阶段02未正式切换。继续02D2 Task5主机Owner恢复。详细证据见 ../../rehearsals/2026-10-16-erp-02d2-runtime.md。
