# ERP 02D3A4 CSV 导入导出实施计划

**Goal:** 使关系模式的CSV导入使用现有领域命令、同一操作键和明确结果，并让Owner从应用导出实际CSV文件。

**Architecture:** 新增独立关系CSV核心/API和关系导入导出页面，DataImportScreen按能力分支；旧服务器路径保留。复用useMasterDataMutation固定模块/CSV/key并保护未知结果，不修改脏utils/api.js。导出复用现有JSON封装端点取完整快照，新增受会话约束的文件保存/分享适配；避免误请求尚未接好的/files路由。不改变现有导入领域规则。

**Tech Stack:** Expo、DocumentPicker、expo-file-system/legacy、Sharing、Blob下载、现有CSV领域、Node/实际PG/Web/安卓QA。

## 现状与边界

- 当前DataImportScreen只有导入；orders/models/materials走旧API不带关系业务版本和固定key，lots走旧stockAPI且无业务头。处理期间模块/正文/取消仍能操作；成功返回只依赖Alert，旧Web也可能停留。
- 示例表头与关系协议不一致：库存必须qty_g，订单必须order_id（分组标识）、customer_id、quantity、unit_price；不能继续用customer_name自动匹配客户，不能把total当作随意可改字段。
- 后端已有POST /csv/:kind（JSON csv，业务头/key）、GET /csv/:kind（实际CSV下载），以及JSON导出 /orders/export、/models/export、/materials/export、/stock/export?type=lots|transactions。JSON结果为filename/contentType/count/content。
- 关系导入仅新建，最多1000行/10MiB，精确值保留文本，由领域全批事务处理；active=false、未知历史余额、附件引用等受服务端拒绝。流水只可导出，不能导入。导出为完整repeatable-read快照，无200行分页截断。
- 现有CSV页面入口为Owner，沿用该UI权限，不顺手扩大角色入口；领域自身Staff可导入的政策不在本项改变，伪造导出仍须403。
- CSV不是完整备份：不恢复原ID/历史版本、附件、账号、审计或AI；完整停写备份恢复仍归02D4。

## Task1 独立契约与模板

Files: utils/relationalCsvCore.cjs、utils/relationalCsvApi.js、tests/client/relational-csv.test.cjs。

- [x] 失败测试覆盖四类导入kind映射、严格字段、固定key/业务版本2；正文不能被自动trim改写，不导入transactions；无效模块不请求。
- [x] 与服务端定义逐项核对模板，订单显示客户ID和行分组说明、库存使用qty_g；前端不parseFloat/推断编号。导出仅search/active合法过滤，transactions禁active。
- [x] JSON导出DTO校验，数量/filename/contentType不冒充下载成功；纯client核心不引入Buffer、pg或服务器validation。专项和现有controller/精度回归通过后提交。

## Task2 关系导入导出页面

Files: screens/RelationalDataTransferScreen.js、screens/DataImportScreen.js、screens/SettingsScreen.js。

- [x] 复用现有模块选择、粘贴及文件选择；只接受csv/txt，使用legacy文件系统读取原生缓存。捕获读取开始的runtime并在读取完成核对，旧账号文件不能填入新账号页面。
- [x] 写入前验证非空CSV；mutation持有原模块/原正文/key，加载与结果未知时锁字段/选文件/切模块/返回。重试只发原命令，成功显示实际导入数量，Web能返回/刷新，原生有明确结果。
- [x] 字段/编码/引用/全批失败/维护错误显示在页面，不把Alert当作Web反馈；明确只新建及CSV备份边界。
- [x] 增加导出模式，支持订单、模型、耗材、批次、流水及search/active；设置入口在关系模式显示CSV导入导出，旧服务器标签/路径不误改。

## Task3 文件保存与会话隔离

Files: utils/csvFileExport.js、utils/csvFileExportCore.cjs、tests/client/csv-file-export.test.cjs（纯编排便于注入平台适配）。

- [x] Web以UTF-8 Blob/安全文件名下载并释放URL；原生用expo-file-system/legacy生成应用缓存文件，登记trackSessionFile再Sharing。返回成功须已完成实际下载触发/分享调用。
- [x] 导出开始捕获runtime/user作用域；请求后、写文件后、跟踪后、分享前均核对，切账号/服务器不分享旧数据；出错清理已生成缓存，不能把外部路径当作应用缓存删。
- [x] 测试不支持分享/写入失败/切换会话的明确错误和清理，不把产生CSV字符串当作手机分享验收。

## Task4 真实集成与推进

- [ ] 自有新PG容器，seed超过200条且有真实库存流水；实际Web验证四类导入、同键丢响应重试只一次、全批失败不部分创建、坏引用/精确小数/维护/401、切换scope后旧文件不回填。
- [x] 下载事件保存实际CSV，校验完整行数、UTF-8中文/逗号/引号/多行及精确金额/毫克；流水不可导入。Staff/Viewer导出API403且无下载入口。
- [x] 实际旧文件服务器导入专项（含Web成功返回）与独立安卓包文件选择/CSV分享验收，记录安装来源与事实；原生分享若需用户动作保留明确未验收，不冒称完成。
- [x] 正式摘要只读核对，清理自有容器/进程/QA包/配置，保留用户模拟器和日常app；主要功能约95%后进入本地文件/OSS/AI，02D2 Task6及阶段02保持待集成。

## 当前状态

A4主要功能已达到约95%，已完成四类导入、实际下载、原生文件选择/重试/分享及正式摘要核对，当前进入A5本地文件。Task4中延迟文件读取期间强制会话失效的完整UI场景仍待02D3总集成；纯编排切作用域/卸载拒绝回填检查已通过，不能把未做的实际UI场景算作通过。

## Tasks1–3及Web结果（2026-10-20）

关系Web13组通过并保存6个实际CSV下载，四类导入/同键丢响应重试/整批回滚/维护/401/权限/精确金额及毫克均有真实PG验证；另390px Web2组通过，验证成功返回及停用筛选、BOM文件下载。实际旧文件服务器Web3组通过。旧Web导入成功依赖原生Alert返回的问题已由红→绿修复；原生旧文件读取改用现有expo-file-system/legacy。

客户端专项及相关75项、实际PG adapters16/inventory12/maintenance9/runtime9共46项，总121项Node检查通过，0跳过。新增csvAssetCore使选择文件期间切换服务器/账号或页面失效时拒绝回填，且只删除应用缓存副本。导出纯编排同样检查作用域、生成文件/跟踪/分享失败清理，不能把CSV字符串当作原生分享已验收。

当前Task4：准备独立原生QA包，只允许emulator-5558；该实例daily package安装路径与上轮一致，未接触其他模拟器。完整平台验收与发布门槛仍保留。

## 原生最终验收与推进（2026-10-20）

发现并修复Android实际文件选择问题：系统将.csv识别为text/comma-separated-values，原筛选只有text/csv/text/plain/Excel，导致同一文件可见但变灰。已用ContentResolver gettype确认，补齐MIME类型，原CSV灰色红→可选绿，旧页面也复用此列表。最终APK来自344638c及已有未提交工作区内容，独立package com.anonymous.x3DManage.erp02d3acsv、名称“培根造物·CSV验收”、版本1.0.0/code1、ABI x86_64；已在emulator-5558覆盖独立QA包并确认Success，日常应用未覆盖。

原生6组通过：实际选择96字节中文/引号/换行CSV；导入成功丢响应、锁定/返回保护、原键及正文摘要一致重试，只一个模型/一次审计/一回执；成功数量及返回；实际系统分享Content URI送入无网络权限本地QA接收器，接收257字节与服务端导出CSV的SHA-256完全一致，解析数据与数据库一致；模型外库存与流水保持；AndroidID与日常安装路径未变。模拟器初始没有CSV接收应用，使用临时本地接收器验证实际字节，不向聊天软件/外部账号发送。接收器/独立QA包/测试Download文件/5847反向端口、自有API/代理/容器及私有配置已清理，模拟器和日常应用保留。

formal-before-native.json和formal-after-native.json全部相同，正式业务/AI未变。A4约95%后推进A5；跨会话延迟读取的实际UI场景并入02D2 Task6/02D3总验收，文件/OSS/AI、02D4与整个阶段02仍未完成。
