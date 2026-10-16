# ERP 02D3A2 库存客户端实施/验收（2026-10-16）

## Task1 读取

MaterialsScreen及MaterialDetailScreen改用关系summary的全量整数毫克汇总，不用当前页批次数量估算。totalQty/availableQty保持已有领域口径，null或读取失败不当准确零；历史无效余额显示待核对。窄屏数字可换行完整显示。

scopedPagerCore/useRelationalPage及PaginationControls明确100条一页、已加载/总数、继续加载及失败重试。下一页错误保留已有行并重试原offset；初页错误不当空仓库。重复/无效页或分页总数变化要求刷新。旧筛选/旧账号响应不混入当前页；epoch失效只清理旧页，不隐式发新账号请求。useInventorySummary复用此生命周期读取单份聚合。模型/耗材主列表均可继续加载；写入表单和下拉选择器仍待Task2。

新增关系库存API及纯函数，支持完整bigint毫克和精确比较，写封装已定义业务头、键、已读版本和克单位。没有修改SQL或旧utils/api.js，UI写入尚未全接。

## 检查结果

先记录缺模块失败，再实施。客户端及相关36项通过（scoped-pager6、inventory4及catalog/master-data/lifecycle）；PG inventory16、adapters19、server-runtime9，共44项。总80项Node检查通过，0跳过。

独立库erp_02d3a_inventory、身份02d3a200-0000-4000-8000-000000000001，仅loopback映射。205批次经真实lot.create初始入库，每批保留流水、审计、回执；205模型/206耗材也经领域创建。库存毫克和流水增量合计均9007199254945197，即9007199254945.197g。

关系Web9组，pageErrors为空：

- 耗材分页可达第206条，全量205批次及大数量汇总精确，未按当前页统计。
- 耗材详情使用同一全量汇总，205条批次逐页可达最早批次。
- 批次下一页503保留已读100条，原offset重试后完整加载205条。
- 汇总失败显示暂不可用和重试，未伪装零库存，恢复后精确合计返回。
- 慢旧筛选响应晚于新筛选时不会覆盖当前耗材结果。
- 模型列表也能访问200条以后的记录，不再静默截断。
- Owner读取未返回时退出并登录Staff，旧账号响应不能覆盖新账号页面。
- 隔离历史无效余额故障注入显示待核对，未把null余额显示为0g。
- 205个初始余额均有真实入库流水，库存毫克合计与流水增量一致。

无效历史余额测试明确为隔离故障注入：先经领域创建零余额批次，暂设legacy_invalid/null/停用，验证待核对显示，finally恢复并经领域删除。最终库存205/流水205及合计保持，没有将注入当正常入库或迁移验证。

实际旧文件服务器由独立子进程启动，专用DATA_DIR/UPLOAD_DIR、显式凭据，真实初始化/登录/HTTP创建耗材和入库；390宽度3组验证500.001g读取、耗材编辑/清空备注及模型新建/列表，pageErrors为空，关停返回0。不是mock旧接口。

早期脚本未持续滚动至虚拟列表未测量的末行，以及仍在库存子页却等待耗材子页页脚，均按实际滚动/子页修正，没有关闭虚拟化或一次渲染全部数据。原通用tests/client/edit-forms-ui.smoke.cjs在订单点击被遮挡处失败（legacy-ui-regression.log），尚未定位，未计通过，留完整集成跟踪。

证据在.tmp/erp-02d3a-inventory：client-red.log、client-core-green.log、client-read-regression.log、pg-read-results.json、pg-*.log、web-build.log、inventory-read-web-verification.json、read-web-final.log、inventory-legacy-web-verification.json、legacy-actual-web.log、inventory-fixture.json及inventory-*.png。窄屏完整数量截图已检查。

formal-after-read.json与A1 formal-after-catalog.json全部字段一致，业务/当前AI保持；原始app_store SHA-256为fdfc1fe167994afa8f06bb24df3aa11830b85686b526019e311cb9ad3634d078，正式无erp schema。未部署正式Docker或覆盖日常手机应用。

## 下一步

Task1达到约95%，当前Task2库存写协议及选择器分页。Task3再做Web/安卓完整过账和对账；本轮未安装库存APK，不声称原生验收。用户/CSV/文件/OSS/AI未接完，02D2 Task6及阶段02仍未完成。

## Task2 关系过账与选择器（后续）

新增RelationalInventoryTransactionScreen，三个旧交易页面按能力选择新组件；新组件复用既有字段，精确数量/版本由inventoryTransactionPayload生成。不自动取最新version覆盖已读资料，出库前精确比较、盘点可为0。Picker支持可选搜索/选中标签和分页footer，默认旧选项不变；批次跨200条可达末页，耗材可搜索到初页以外的资料。资料编辑/启停接关系协议，不改余额；未知结果保留原payload/version/key并有返回保护和原命令重试。失效runtime不阻止退出登录。

关系Web11组通过、pageErrors为空：

- 新批次精确入库已提交丢响应后冻结/返回保护，原键重试仅一条批次和一次入库。
- 已有批次入库→出库→零盘点保持精确毫克与已读版本，正常返回刷新。
- 批次资料修改只更新资料/version，余额与四条流水不变。
- Web停用/恢复可确认，停用丢响应原命令重试且不改余额。
- 旧版本过账409无扣减，重载最新批次后原数量可重新提交。
- 批次选择器跨200条可达末页，精确不足库存校验不发扣减。
- Staff实际入/出库可用、无盘点入口，伪造盘点请求403且不改余额/version。
- Viewer仅显示库存读取，伪造出库403且无事实变更。
- 真实维护屏障503无入库，开放后原命令重试只过账一次。
- 保存中401按失效会话退出，pending返回保护不阻挡登录页且无入库。
- 真实四步流水前后量及增量逐条对账，全库库存毫克与流水合计一致。

新批次1.001g→补充2.002g→出库0.001g→实盘0g对应四条真实流水；每条before/after/delta连贯，资料编辑及启停不新增流水。旧版本409不扣减，重载后按新version提交；Staff实际入/出库可用、无盘点入口且伪造盘点403；Viewer无写入口、伪造出库403。真实维护503不写入、开放后原命令重试；模拟401时返回登录页，没有被pending导航保护阻止，也没有过账。

客户端相关50项、PG inventory16/adapters19/maintenance9/server-runtime9共53项，总103项Node检查通过、无跳过。证据write-client-red.log、write-client-green.log、write-client-regression.log、write-pg-results.json和write-pg-*.log、write-web-final.log、inventory-write-web-verification.json及inventory-write-owner.png。

额外实测旧Web发现：入库已成功提交500.002g/2条流水，但只用Alert按钮返回，Web停在已完成表单。已为三个旧交易页面增加Web成功直接返回，原生保留原Alert。legacy-write-red.log到legacy-write-green.log验证实际旧文件server的入库/出库/零盘点正常返回，最终余额0、流水4条；兼容专项4组、pageErrors为空，不是mock接口。原通用smoke的订单点击遮挡问题仍单独跟踪，未冒称已修复。

formal-after-write.json与formal-after-read.json全部字段一致。Task2约95%后进入Task3原生和最终对账；不宣称库存整体或阶段02完成。
