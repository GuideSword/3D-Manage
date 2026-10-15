# ERP 02C：主数据维护与订单客户选择实施计划

> 按既有批准设计顺序执行；每个子任务达到约 95% 且余项不阻断后推进。前置 02B3 已完成；正式发布与唯一事实源切换归 02D。

**Goal:** 提供客户、供应商完整资料维护和默认仓库设置，在订单中明确选择客户并保留历史快照，完成 Android 模拟器与 Web 验收。

**Architecture:** 延用现有 `erp.customers/suppliers/warehouses` 表和公共命令事务；不创建 JSONB 平行资料。客户与供应商复用受信类型白名单的服务，仓库设置单独限制 Owner。新增页面沿用现有 Card/Input/列表样式，置于设置中的资料维护入口。旧服务器不显示关系模式专属操作，原表单保持可用；关系模式按 version 与幂等键提交，不按姓名猜配客户。未挂载正式后台前使用隔离测试服务和测试账号，不在正式环境制造验收订单。

**依据:** [阶段 02 已批准设计](../specs/2026-09-29-erp-data-foundation-design.md)、[优先级计划](2026-09-29-erp-priority-plan.md)、[02B3 验收](../../rehearsals/2026-10-15-erp-02b3-adapters.md)。本计划细化既有范围，没有增加资金、采购单、多仓或认证方案。

## Task 1：主数据领域服务与接口

**Files:** create `backend/modules/partners/service.js`、`backend/modules/warehouses/service.js`、`tests/backend/erp-master-data.test.cjs`；modify `backend/modules/adapters/services.js`、`http.js`、`tests/ops/erp-02a-postgres.verify.ps1`。

- [x] 先写实际 PG16 验证。客户/供应商 code 唯一、同名可并存；姓名和编号必填，联系人/邮箱/电话/地址/备注可清空。未知字段、伪造版本或 actor 拒绝。
- [x] 注册 `customer|supplier.create/update/setActive/delete`。Owner/Staff 可写，Viewer 可读；ID 服务端生成。创建默认 active，更新携带 version，停用单独命令；未传值保留，未知旧 JSON 数字不重写。无引用删除，有引用返回 409，不级联删业务。
- [x] 仓库只提供默认仓库查询和 Owner 名称编辑；不能通过本包增删仓库或修改 code/is_default/active，缺少默认仓库时明确报错，不能隐式创建/迁移。初始化由 02D 统一处理。
- [x] 独立关系 Router 接 `/customers`、`/suppliers` CRUD/active、`/warehouses/default` 查询/编辑。复用业务版本头、JWT 当前角色、回执与错误处理；保留正式 server 未挂载状态。
- [x] 验证同版本并发只有一次成功、同键重试、唯一/外键保护、审计或回执失败整体回滚；改客户资料不回写旧订单快照，停用客户不能用于新订单但旧订单仍可读。通过 master-data、adapters 和关联领域回归后提交。

## Task 2：客户端能力与可靠提交

**Files:** create `utils/masterDataApi.js`、`utils/masterDataCore.cjs`、`tests/client/master-data.test.cjs`；按需要新增通用业务提交 hook，复用 `inventoryCommandCore.cjs` 的会话/重试边界；modify `context/ServerConfigContext.js` 或现有能力数据出口，不修改其他会话草稿工作。

- [x] 确认系统发现能力在当前服务器会话中可读取，缓存不能跨服务器/账号复用。旧服务隐藏资料维护和客户选择，关系服务显示；请求 503 保留输入，401 才走原登出逻辑。
- [x] 新 API 显式 `X-Business-Rules-Version:2` 和幂等键，编辑带读取时的 version。一次结果未知保留原键/原内容，冲突保留输入并让用户重新加载；并发点击只提交一次。
- [x] 表单纯映射覆盖原值回填、空值清除、字段长度/必填、停用状态和版本。资料金额不经过本模块处理。新增针对实际映射/重试风险的客户端测试，通过后提交。

## Task 3：客户、供应商与仓库页面

**Files:** create `screens/PartnersScreen.js`、`screens/PartnerDetailScreen.js`、`screens/EditPartnerScreen.js`、`screens/WarehouseSettingsScreen.js`；modify `screens/SettingsScreen.js`、`navigation/AppNavigator.js`、`constants/index.js` 中实际路由定义（实施前确认目录结构）。

- [ ] 复用一个客户/供应商页面组合，类型只能来自已注册路由参数；列表搜索、启用状态筛选、新建、详情、编辑、停用/恢复与无引用删除同时交付。
- [ ] 编辑和新建使用同一表单；读取失败不给空表单保存，保存成功返回并刷新，失败保留输入。删除遇引用引导停用，不能自动改变操作。
- [ ] Viewer 只显示读取操作；默认仓库页所有角色可见当前名称，只有 Owner 可保存名称。界面说明采用用户语言，不显示数据库或迁移术语。
- [ ] 设置页增加资料维护入口，导航按能力与角色控制；保留其他并行工作与原聊天入口。无键盘和桌面焦点依赖。
- [ ] 验证窄屏滚动、长名称、多行备注、空列表、失败与重试、保存返回刷新及停用恢复。

## Task 4：订单客户选择与历史快照

**Files:** modify `screens/CreateOrderScreen.js`、`utils/editFormCore.cjs` 或新增独立关系订单映射模块、相关订单 API 适配；extend `tests/client/edit-form-core.test.cjs` 或新增关系模式专项。

- [ ] 关系模式下新订单先搜索并选择启用客户，提交 customerId；姓名、电话、邮箱从选择结果展示，不接受用输入姓名自动建档/匹配。
- [ ] 编辑保留旧客户 ID 与原快照，客户改名不能自动刷新历史订单。显式换客户或刷新快照调用原订单服务，仍受未确认/库存引用约束。
- [ ] 保持订单行精确字符串、现有行 ID、文件/附件、说明清空和失败保留；不通过客户端 total/subtotal 决定服务端计价。订单写加版本/幂等，旧服务器继续沿用现有接口。
- [ ] 测试同名客户、停用旧客户、无客户禁止保存、显式换客户、在制单禁止商业修改、版本冲突、原文件保留；通过相关订单/编辑专项后提交。

## Task 5：隔离 UI 验收、完成评估与 02D 准备

**Files:** create `tests/ops/erp-02c-acceptance-server.cjs`（仅显式隔离数据库/测试身份）、`docs/rehearsals/2026-10-15-erp-02c-master-data.md`；update 本计划、总计划及阶段 02 设计的执行状态。

- [ ] 先确认用户已开的 Android 模拟器；只用 ADB 与浏览器调试协议/内置浏览器，不使用 Computer Use，不占用用户桌面。中文字段优先通过复制/粘贴或测试 fixture，避免输入法注入造成错字。
- [ ] 使用隔离关系后台分别完成 Owner/Staff/Viewer 的关键路径，安卓窄屏与 Web 均验收；测试用户不得重置正式账号或覆盖正式数据。必要 APK 记录版本、安装结果和实际界面证据。
- [ ] 后端/客户端关键测试无跳过，生产快照前后只读核对，检查本包提交范围。未完成设备专项列明，不以静态代码替代 UI 验收。
- [ ] 达到约 95% 且主流程完整后记录推进依据，再进入 02D 的正式挂载、系统/统计/下载入口补齐、维护停写、批准映射、冷备份、切换与恢复专项设计/实现；整个阶段 02 到正式验收前不打完成勾。

## 当前状态

2026-10-15：Task 1 已完成。主数据实际 PG/HTTP 10/10，adapters 19/19、orders 15/15 复验通过，无跳过。Task 2 已完成：主数据客户端 6 项、库存提交 4 项、现有会话 14 项共 24/24 通过；当前进入 Task 3 页面，再完成订单客户选择及模拟器与 Web 验收；02C 整体尚未到推进门槛。正式存储和原账号未变。见[实施记录](../../rehearsals/2026-10-15-erp-02c-master-data.md)。
