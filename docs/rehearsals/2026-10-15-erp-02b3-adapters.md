# 02B3 Task 6：HTTP、CSV 与 AI 适配验收

2026-10-15。本包提供独立关系服务适配器，未挂载正式 server.js，未迁移正式存储。02B3 六项核心工作均已交付，按约 95% 门槛转入 02C；不代表整个阶段 02 或正式切换完成。

## 本包行为

`backend/modules/adapters/services.js` 显式装配 pool、JWT 密钥和上传目录；HTTP Router 不加载旧 JSONB store 或 AI SQLite。`installation.storage_mode` 未设为 relational 时业务返回 503，不能回退写旧存储。系统发现保持 API 1 元数据，提供 businessRulesVersion=2。业务写必须带 `X-Business-Rules-Version: 2` 与 `Idempotency-Key`；缺少版本头返回 428 CLIENT_UPGRADE_REQUIRED。JWT 查询当前数据库角色、启用和 token 版本，不能由请求 actor 字段代替。

覆盖模型、耗材、订单、批次、流水、用户读写，状态、停用、文件引用注册、当前账号回执和 Owner 审计查询。列表保留 items/total/page/pageSize；旧 `/stock/lots`、`/stock/inventory/txns` 查询与新版库存入口共用关系服务。资料编辑接受带 version 的平铺字段或 changes 对象；金额/余额等只读字段仍由领域白名单拒绝。认证、本人改密不要求业务版本头；本人改密未提供 version 时使用此次认证读取的用户版本，缺少幂等键时仅此账号维护入口生成键。登录和当前密码失败分开限流。数据库故障保留为服务错误，不清除客户端登录；响应不包含 SQL 或密码细节。

`csvCodec.js` 处理 BOM、CRLF/LF、多行引号、转义引号，拒绝重复/空表头、错误列数、非法引号、不支持列及超限内容。数量和价格不转成 JS 浮点。CSV 只创建新资料，来源 ID 不覆盖服务端 ID；客户必须提供明确 customer_id，同名不推断合并。订单逐行金额和总额列如填写，必须与领域精确算法相符。四类资料整批调用既有 import 命令，失败时业务、审计及回执全部回滚。历史库存余额异常与停用资料不能静默当作正常期初导入，历史流水只读导出。

导出 Owner 专用，在同一次认证/只读 REPEATABLE READ 快照读取全部匹配记录，超过 200 条也不截断。提供 `/csv/:kind` 下载和原 `/materials|models|orders/export` JSON 文件包装；普通 CSV 不替代包含文件和 AI 数据的完整备份。

`agent.js` 工具上下文仅暴露读取和 prepareRecordUpdate。语义向量 lookup 可显式注入，索引元数据始终由当前关系模型覆盖，删除的模型跳过，账号不得跨用索引。提案绑定账号、服务器、记录版本、原值、内容和 15 分钟有效期，使用独立用途 HMAC；确认函数独立于工具上下文，要求 confirmed=true 和幂等键。模型/耗材直接调用原领域 handler，订单说明与状态通过同一事务内的原 handlers 顺序执行，第二步失败时第一步和版本一起撤销。重复确认读取同一回执；过期后不再执行，可通过回执查询核对结果。新订单确认要求显式 customerId 并由原服务计价。没有增加自动猜客户、自动写库或第二套计算规则。

## 实际验证

| 专项 | 通过 / 跳过 |
| --- | --- |
| adapters：实际 PG16、loopback HTTP、CSV、AI | 19 / 0 |
| catalog | 12 / 0 |
| orders | 15 / 0 |
| commands | 9 / 0 |
| users | 18 / 0 |
| inventory | 16 / 0 |
| core | 9 / 0 |
| import | 12 / 0 |
| 原编辑、库存命令及备份契约 | 30 / 0 |

合计 140 项。实际覆盖四种批量导入第二条失败回滚、超安全整数精度、逐行取整、205 行导出、权限撤销、旧客户端写守卫、版本冲突、幂等重试、HTTP 回执写失败回滚、文件引用保留实物、登录/改密失败限流、密码变更后旧 token 拒绝、提案篡改/账号/服务器/过期拒绝、AI 只提议不写入及订单混合操作回滚。独立模块加载测试确认未导入旧 store、旧 AI bridge 或 SQLite。

执行入口：`pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite adapters`。各 suite 的摘要和日志位于忽略目录 `.tmp/erp-02a/`；一次性 PG 容器使用随机凭据并已清理。未使用正式账号进行业务写验收。

## 正式数据核对

`.tmp/erp-02a/02b3-adapters-before.json` 与 after 完全一致，包含原账号、业务集合及当前 AI 表摘要；原始 app_store SHA-256 仍为 `fdfc1fe167994afa8f06bb24df3aa11830b85686b526019e311cb9ad3634d078`，正式 erp schema 不存在。原账号密码、模型文件及订单没有被适配验收修改。此处比较的是本包开始/结束的实际快照，不以历史发布文档中的集合数量代替当前核对结果。

## 下一包与发布边界

02C 实现客户、供应商、默认仓库维护及订单选客户，补齐能力判断和窄屏/Web 交互；02D 统一挂载正式 HTTP/AI、multipart 与对象存储生命周期、其余既有系统/统计/下载入口、主机 Owner 恢复、维护停写、批准映射、完整备份、切换及恢复验收。正式安装仍使用原入口，因此本次无需覆盖安装 APK，模拟器验收安排在页面完成后。

如需撤回本包，撤回新增模块和未发布适配调用即可，无正式数据库或文件恢复动作。SQL v1–v5 均未改动。代码提交到本地 Git；本记录不声明已推送远程或已上线。
