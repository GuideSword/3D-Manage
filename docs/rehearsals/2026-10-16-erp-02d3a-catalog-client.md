# ERP 02D3A1 模型/耗材客户端验收（2026-10-16）

当前子项主要功能达到约95%推进线，进入A2库存精确读取/过账；整个02D3、02D2 Task6及阶段02均未完成。

## 实际变更

新增独立catalog纯函数/API，不改已有未提交utils/api.js。模型/耗材关系表单复用useMasterDataMutation→useBusinessCommand，写入携带业务规则2、固定操作键和已读version；耗材单价/直径以字符串传递，不经过Number。直径可显式清为null，单价0合法，模型描述和备注可清空。校验精度/长度与领域契约一致；不自动查询最新version覆盖用户已读资料。

详情/耗材列表删除带版本和原命令重试入口；未知结果期间锁定输入/返回，系统Back也受保护。列表刷新清除普通错误后，待确认删除仍保留重试入口；另点其他删除不会改用其他对象替代原命令。Web使用确认对话框及可工作的成功返回，Viewer入口仍隐藏并依赖后端授权。文件链路未接好时，关系新建模型带已选附件先失败，不创建半成功资料；文件上传仍是发布阻断。

ModelDetailScreen已有图片预览/删除的未提交工作，本项只提取catalog独立差异提交；原工作保留。APK包含工作区已有其他改动，不能充作干净正式发布包。

## 检查结果

客户端及相关41项通过，含catalog、master-data、order、inventory-command、lifecycle和edit-form，具体分项以catalog-client-regression.log为准，无跳过。PG相关catalog12、adapters19、server-runtime9，共40项通过，无跳过。总81项Node检查。源码先记录缺模块失败，再实现与回归。没有变更SQL或正式容器。

独立无界面浏览器使用真实关系server，Web构建成功，14组通过、pageErrors为空：

- Owner模型新建丢响应后冻结内容/返回，原键重试仅一条记录。
- 模型编辑带版本并允许清空描述。
- 旧版本409不覆盖服务器，重新加载回填最新记录。
- 模型删除丢响应后保留原version/键，可从显式入口重试。
- 已被订单引用的模型拒绝删除，原记录保留。
- 耗材六位小数大单价创建/回填/保存精确，备注及直径可清空。
- 耗材允许零单价，无引用耗材详情页可确认删除并返回。
- 耗材列表删除保留已读版本，丢响应后原命令重试且只有一份删除审计。
- 文件链路尚未接好时提交带附件模型先拒绝，未创建半成功记录。
- 关系维护期间表单保存503不写入，恢复后原操作重试成功。
- Staff可创建和编辑资料，窄屏可用。
- Viewer不显示模型/耗材维护入口。
- 实际旧文件模式服务器的模型创建/编辑/删除继续原协议，未请求关系命令。
- 实际旧服务器耗材创建/编辑/清空备注及Web确认删除可用。

旧模式兼容使用独立子进程真实file-mode server，隔离DATA_DIR/UPLOAD_DIR、显式JWT/Bootstrap、实际初始化和登录，不是mock旧接口；关停返回0。早期Web脚本定位把详情页隐藏Tab当作可点击入口，以及误以为数值0一定返回固定六位小数；这两处属于验收脚本预期错误，已根据实际导航角色与数值契约修正。没有为了通过测试改业务行为。

Android用户设备emulator-5558，独立包com.anonymous.x3DManage.erp02d3a，名称“培根造物·资料验收”，版本1.0.0/code1，x86_64，SHA-256 `c40882ac69d972b5beb965923fd54ed8d19abab0ffb88efb69a9ba228d1c9108`，明确ADB安装成功。连接仅隔离API经本次自建127.0.0.1:5827故障代理及ADB reverse；原日常包未覆盖。

原生5组：全新配置/Owner登录；后端201已提交后代理断开socket，第一次显示连接失败/原操作重试，第二次相同key/body和业务头2；硬件Back被阻止且留在原表单；模型实际修改/删除；耗材大单价完整回填及保存，备注/直径清空。PG独立核对模型create/update/delete各1份审计、模型最终删除；耗材unit_price仍99999999999999.123456、notes空、diameter null、version2。截图输入框显示尾部，完整值由UI XML字段与PG共同确认。原生本轮测试Owner，Staff/Viewer实际页面权限由Web覆盖，不混称安卓三角色测试。

证据：`.tmp/erp-02d3a/catalog-red.log`、catalog-core-green.log、catalog-client-regression.log、catalog-pg-results.json、pg-*.log、web-build.log、catalog-web-final.log、catalog-web-verification.json、catalog-android-verification.json、android-proxy-commands.json、verification-apk-build.log及catalog-*.png/XML。截图已检查（重试提示、窄屏及原生精确输入）。

正式只读formal-after-catalog.json与02D2 formal-after-owner.json全部字段一致，业务/当前AI摘要保持，原始app_store SHA-256仍fdfc1fe167994afa8f06bb24df3aa11830b85686b526019e311cb9ad3634d078，正式无erp schema。

## 剩余与下一项

A1保留“延迟写响应正好遇到账号/服务器切换”的新页面实测到02D3完整集成；已有作用域/lifecycle回归通过，但没有声称本轮原生做了账号切换。该余项不阻断后续库存工作。

A1截图额外发现：耗材卡片把关系qty字符串直接相加成0100.001100…，且库存只取首100批次。A1未把库存页面列为通过，已在A2库存子计划明确优先修复，后续须用真实领域创建初始入库/流水的fixture验收完整数量和对账。用户/CSV、文件/OSS/AI仍按总计划继续，尚未正式切换。

收尾：本子项源码本地提交7cb6f0a。已仅停止命令行匹配的本次Node服务/故障代理，删除所有权标签匹配的隔离PG容器及本次凭据配置，移除本次reverse5827和独立资料验收包。原日常包路径保持相同，用户emulator-5558继续运行，截图/报告保留。未进行远程Git推送或正式部署。
