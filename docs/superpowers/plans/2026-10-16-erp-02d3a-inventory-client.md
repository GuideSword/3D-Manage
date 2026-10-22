# ERP 02D3A2：库存客户端精确读取与过账

> 按02D3客户端同源顺序实施，先处理A1实际截图暴露的数量拼接和首分页统计问题；随后用户/CSV及文件/AI仍须继续，阶段02未完成。

**Goal:** 关系模式的库存列表、耗材库存统计和入出库/盘点/资料维护均使用关系API与精确数量，重试不重复过账，分页不冒充全量。

**Architecture:** 复用现有关系领域和库存汇总，客户端新增独立关系封装及纯函数；不在旧utils/api.js中自动补最新version。列表有明确分页/继续加载，统计从完整服务端汇总读取，选中批次携带已读version，所有写入共用业务头/操作键/当前会话及维护规则。

**Tech Stack:** Expo、现有精确BigInt解析、关系inventory领域、Node/实际PG/Web/独立安卓QA。

## 已验证的问题和口径

- A1的catalog-list-delete-retry.png中，MaterialCard库存显示形如`0100.001100111…`，原因是`reduce(sum + lot.qty)`把关系DTO字符串拼接；header只展示100批次，fixture实际有108批次。不得将该截图声称为库存验收通过。
- `backend/modules/inventory/views.js`已有summary：totalQty为所有状态批次的可读取余额合计（排除legacy_invalid），availableQty为启用且在库的可读取余额；lotCount包含全部批次，balanceIncomplete/legacyUnverified标明核对状态。这与首页≤100g批次风险计数不同，不重定义库存事实。
- summary全量聚合，列表最多200/页。耗材卡片、详情和整体统计不能从当前页批次求完整余额；余额不可读取时提示待核对，不把未知显示为准确零。
- `EditStockLotScreen`、入库/出库/盘点及MaterialsScreen批次停用仍调用旧stockAPI；旧库存API写入没有关系业务头，关系读返回字符串，出库前parseFloat比较会失真。

## 文件职责

- 新增 utils/relationalInventoryCore.cjs、relationalInventoryApi.js：精确数量/版本payload、批次/流水分页和summary读取、create/update/state/archive/delete/post契约；复用createRelationalRequest，写入缺键或版本就拒绝。
- 新增或复用共享分页读取模块，明确会话作用域及过期响应丢弃；供MaterialsScreen/MaterialDetail和批次选择使用。模型/耗材主列表和选择器超过一页也须有后续加载能力，不悄悄截断。
- 修改 screens/MaterialsScreen.js、MaterialDetailScreen.js：服务端全量summary驱动统计/卡片；分页批次显示，余额状态与读取失败可见；原服务器保留原路径。
- 修改 screens/EditStockLotScreen.js、InboundTransactionScreen.js、OutboundTransactionScreen.js、AdjustTransactionScreen.js：关系封装、已读version、固定键及未知结果重试、原值锁定/返回保护，出库比较用整数毫克。
- 新增 tests/client/relational-inventory.test.cjs；增加隔离真实服务/Web/安卓验收脚本。若需扩展汇总仅做现有领域契约的必要补充并补PG测试，不绕开领域规则。
- 后续A3处理用户/本人改密，A4处理CSV；系统组织API已接好但现有资料设置UI入口须在总验收核对，不省略。

## Task1：读取和精度（先实施）

- [x] 先写失败测试：字符串数量正确展示和比较、0/三位小数/超过JS安全整数边界；大批次分页，summary total/available/lotCount及无效余额标志不丢；服务器/账号切换后旧页不混入。
- [x] 实施独立关系读取API和列表/汇总绑定，不再用一页lot数组估算材料全量。分页继续加载/重试可用；列表错误不伪装为空库存。
- [x] 真实PG和Web fixture用超过100/200批次，验证显示数值、批次数及末页记录，耗材详情与列表一致。初始有余额的批次通过真实领域入库创建，保留有效流水和审计，不使用A1统计fixture冒充库存对账通过。

## Task2：写协议与重试

- [x] 测试createLot、资料update、启停、state/archive/delete、库存post的地址/业务头/幂等/版本/克单位；不由客户端更改余额、基线、ledger或金额。
- [x] 关系模式资料编辑走version+changes；新批次和补充入库、出库、盘点保持字符串，选批次时保留version，0盘点允许；关联订单标识按领域规则传递。
- [x] 复用已验证的mutation/controller：同一未知结果保持内容、已读version及键，禁改/禁离开，409展示核对并可重新加载。Web成功有明确导航，原生Alert返回正常。
- [x] Owner可盘点，Staff仅允许入/出库与资料维护，Viewer只读；冻结/停用/报废/无效余额及不足库存均由后端拒绝，前端不擅自修正。

## Task3：集成、对账和推进

- [x] 真实server验证新批次→补充入库→出库→盘点→资料编辑/启停，余额、版本、流水前后数量、审计和回执一致。
- [x] 网络断开/丢响应重试只产生一次有效过账；并发旧版本/库存不足/维护拒写保持原事实。超过安全整数的数量不舍入。
- [x] Web及用户模拟器独立QA包验收；旧文件/JSONB模式回归，正式只读摘要核对。本子项约95%后再进入用户/CSV，Task6与整个阶段02仍保持未完成。

## 当前状态（2026-10-16）

Task1读取达到约95%推进线：客户端相关36项、PG相关44项，共80项Node检查通过、0跳过；关系Web9组、实际旧文件服务器Web3组通过。真实领域创建205批次/205入库流水、205模型、206耗材，全量9007199254945.197g和末页记录可达。正式摘要不变。

当前Task2库存写协议及选择器分页。A2完整原生验收归Task3，本轮未安装库存APK。原通用edit-forms smoke在订单点击被其它场景遮挡处失败，尚未定位，留02D3整体验收，不计通过；实际旧服务器库存专项已通过。证据见 ../../rehearsals/2026-10-16-erp-02d3a-inventory.md。

## Task2实现细化（读取完成后）

新增RelationalInventoryTransactionScreen复用三类交易表单字段；三个原页面仅按能力选择该组件，旧服务器保留原组件。Picker追加可选搜索、选中标签和分页footer参数，默认行为不改，解决批次/耗材超过一页时无法选择。纯函数inventoryTransactionPayload负责精确量、已读version和批次可用校验，先测试再接UI。EditStockLot和Materials批次启停改用关系API；pending导航保护按当前runtime判定，失效会话不能阻止退出登录。

Task2已达到推进门槛：关系Web11组、实际旧文件服务器Web4组、客户端相关50项及PG相关53项（总103项Node检查，0跳过）通过；旧Web过账成功只依赖手机Alert返回的问题已实测修复。当前Task3原生完整验收及最后对账，尚不把整个A2算完成。

## Task3最终验收（2026-10-16）

独立安卓QA包已在emulator-5558安装、验收并移除，日常应用与模拟器保留。6组原生场景通过：首批次1.001g提交后代理主动丢响应、返回保护与同键同内容重试仅一次入库；补充2.002g→出库0.001g→零盘点，四条流水逐段对账；编辑库位Native-A及停用/恢复后版本7、余额0、流水仍4条，审计7条；INV-204从9007199254740993mg精确出库1mg到9007199254740992mg。所有命令各一回执，全库余额/流水合计均9007199254945196mg。APK基于5a578ac及已有未提交修改，不是正式发布包。正式只读摘要与Task2完全一致。自有代理、API、容器、反向端口和私有配置已清理。

A2主要功能约95%，当前推进02D3A3用户/本人改密。通用旧订单UI smoke遮挡及A1延迟写入切换会话用例继续归整体验收，未计通过；文件/OSS/AI、02D4和02D2 Task6仍未完成。详见验收记录。
