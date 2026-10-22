# ERP 02D3A1：模型和耗材客户端写协议

> 延用已批准阶段02及02D2发布检查的同源设计，逐项实施；本子项不代表全部客户端或阶段02完成。

**Goal:** 关系模式中的模型/耗材新建、编辑、删除携带正确版本和幂等键，精确单价不经Number，超时重试不重复保存；原服务器继续原流程。

**Architecture:** 独立catalog纯函数/API封装，复用createRelationalRequest和useBusinessCommand。在现有表单与删除入口按服务器能力分支，保持原字段与页面。上传登记随后按02D3文件子项实现，此时选择附件的关系模型提交须在创建资料前明确拒绝，避免半成功后重复新建。

**Tech Stack:** Expo、React Native/Web、共享精确十进制解析、Node test、隔离实际PG、无界面浏览器。

## 文件职责

- 新增 utils/relationalCatalogCore.cjs：模型/耗材表单校验与精确payload、已读version的update/delete envelope、API工厂；禁止自动抓取最新version覆盖用户已读版本。
- 新增 utils/relationalCatalogApi.js：注入apiRequest/getServerRuntime，导出两种领域API，不修改已有未提交utils/api.js。
- 修改 screens/CreateModelScreen.js、CreateMaterialScreen.js：能力分支、字符串精度、版本/固定操作键、失败原值保留、空文本清除；现有useEditRecord回填。
- 修改 screens/ModelDetailScreen.js、MaterialDetailScreen.js、MaterialsScreen.js：已读version删除及未知结果原命令重试；web使用可工作的确认/导航。ModelDetail含已有未提交图片工作，仅提交本项独立改动。
- 新增 components/CatalogMutationFeedback.js、utils/confirmAction.js：共享删除错误/原命令重试及Web/native确认；复用已有useMasterDataMutation的未知结果和返回保护。
- 新增 tests/client/relational-catalog.test.cjs；隔离真实后端和Web验收脚本/记录。更新相关计划和证据。

## Task1：协议与失败测试

- [x] 先测试精确大单价、六位小数、0、空直径null、文本清空及非法精度/非安全Number/未知字段拒绝；create/update/delete的地址、版本、业务头、幂等键及能力缺失拒绝。
- [x] 测试同一操作超时重试保留键/内容/已读version，换内容或会话拒绝，409允许用户重新加载后新操作；读取响应不改变精确值。
- [x] 记录失败后实现纯函数和API，运行专项及master-data/order/command相关回归。

## Task2：实际表单与删除入口

- [x] 接现有模型/耗材新建/编辑表单，能力分支明确，旧服务器流程保留；pending期间禁止变更内容另发新命令，成功只导航一次。
- [x] 删除带已读version及固定键，不自动查最新version；Web确认和成功返回可用，Viewer沿用只读入口及后端403。
- [x] 上传尚未接好时选附件的关系提交先失败、不创建模型；不能把资料保存完成称为文件功能已交付。

## Task3：集成和收尾

- [x] 构建Web，真实隔离server验证Owner/Staff保存和Viewer只读，精确单价回填/清空、旧版本409、未知结果重试只有一条、删除有引用拒绝及无引用成功；实际旧能力路径回归。
- [ ] 延迟保存响应恰逢账号/服务器切换的页面场景留至02D3完整集成复验；当前沿用apiRequest作用域及lifecycle测试，未把它声称为新的Web/安卓切换实测。该余项不阻断库存子项。
- [x] 模拟器独立QA包或后续客户端合包验收；若本子项先通过Web/实际PG，不虚称已完成安卓，并保留原生复验至02D3总验收。
- [x] 更新正式只读摘要、计划与本地提交，达到约95%且剩余原生复验不阻断后继续02D3A2用户/库存/CSV；Task6/阶段02继续未完成。

## 完成记录（2026-10-16）

本子项达到约95%推进线，主要新建/编辑/删除已实际交付并隔离验收。客户端及相关41项、PG相关40项共81项Node检查通过，0跳过；真实Web14组（含实际旧文件服务器模型/耗材流程）通过，pageErrors为空；独立安卓5组通过。正式业务/AI摘要不变。原生丢已提交响应、硬件返回保护、精确值与审计已实际核对。

A1截图额外暴露库存字符串相加及只计前100批次的问题，已在下一子计划 2026-10-16-erp-02d3a-inventory-client.md 明确登记并优先实施；本项不声称库存页已接完。当前进入02D3A2库存精确读取及过账，整个02D3/02D2 Task6/阶段02均未完成。
