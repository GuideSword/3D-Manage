# 业务表单编辑 Implementation Plan

**Goal:** 补齐现有订单、模型、耗材、批次和普通用户姓名的修改流程。

**Architecture:** 复用新建表单与现有 PATCH API；通过公共加载 hook 获取原记录，订单行转换保留历史字段；库存沿用版本检查与幂等命令。保留工作区已有库存改造。

**Tech Stack:** Expo、React Native、Express、Node.js test runner。

用户已于 2026-09-29 确认实施设计范围。本会话直接实施，无需额外派发代理。配套设计：../specs/2026-09-29-edit-forms-design.md。

## Task 1：数据与表单公共支持

- [x] 修改 backend/services/orders.js、backend/routes/materials.js，区分省略与显式空值；订单客户合并保留 ID，数字采用完整解析。
- [x] 新建 utils/editFormCore.cjs，提供订单回填及保存转换，并新建 tests/client/edit-form-core.test.cjs 验证历史模型、自定义颜色、附件和扩展字段保留。
- [x] 新建 utils/useEditRecord.js，负责加载原记录、失败重试和导航标题；提交前使用引用锁防止同一帧重复点击。

核心清空规则：`notes: payload.notes === undefined ? existing?.notes || '' : String(payload.notes ?? '')`。交期：存在 dueDate 或 due_date 时以提交值（含 null）为准，否则沿用旧值。客户：`{ ...existing?.customer, ...payload.customer }`。单价与数量校验：`Number.isFinite(Number(value)) && Number(value) > 0`。

运行：`node --test tests/client/edit-form-core.test.cjs`，预期全部通过；随后在隔离后端数据中验证 PATCH 清空和权限。

## Task 2：现有实体编辑

- [x] 修改 screens/CreateOrderScreen.js、CreateModelScreen.js、CreateMaterialScreen.js，接收 route.params 的实体 ID，加载与回填、区分 create/update，保存成功 goBack。Web 直接跳转。
- [x] 修改 screens/OrderDetailScreen.js、ModelDetailScreen.js、MaterialDetailScreen.js，增加受 canWrite 控制的编辑按钮及 focus 刷新。
- [x] 修改 navigation/AppNavigator.js，按是否传入实体 ID 显示编辑标题。

接口选择：`const saved = recordId ? await api.update(recordId, payload) : await api.create(payload)`。模型编辑仅提交基础字段，保留文件/图片；订单保存以 `{ ...item, quantity, unitPrice, subtotal: quantity * unitPrice }` 保留历史字段并更新金额。

## Task 3：批次、用户与验收

- [x] 新建 screens/EditStockLotScreen.js，修改 constants/index.js、navigation/AppNavigator.js、screens/MaterialsScreen.js、MaterialDetailScreen.js，接入库存资料编辑。
- [x] 修改 screens/UsersScreen.js，新增普通用户姓名弹窗，调用 usersAPI.update；保留角色、启停和密码重置行为。
- [x] 新增 tests/backend/edit-forms.test.cjs，在临时数据目录启动后端，验证订单与耗材编辑、模型附件保留、审计、Viewer 拒绝和不可改库存余额。
- [x] 运行 `npm run verify:erp`、`npm run verify:client`、`npm run verify:backend` 和 `npx expo export --platform web --output-dir .tmp/edit-forms-web`。预期各项通过；记录无法验证的实际界面操作。

批次保存：`submitCommand('lot.update', { id: lotId, changes: { lotNo, serialNo, location, notes, version } }, (body, key) => stockAPI.updateLot(body.id, body.changes, key))`。409 重新加载原记录，不自动重试覆盖；未知结果保持原幂等请求。
