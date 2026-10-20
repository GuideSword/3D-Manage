# ERP 02D3A5 本地文件上传下载接入计划

**Goal:** 将关系模式的模型文件、图片和订单附件上传、登记、读取与下载接入同一PG身份及领域，不再落到旧JSONB或503文件占位。

**Architecture:** 新增关系文件HTTP适配和显式uploadDirectory的本地存储适配，复用已有models/files、orders/attachments领域的version/key/审计/回执。物理文件写入与数据库关联分开管理重试结果，不在删除关联时直接删可能被历史或其他模型引用的字节。客户端新增独立关系文件封装，旧服务器路径保留；已有ModelDetail图片预览等未提交工作先审阅后衔接，不覆盖或一并擅自提交。

**Tech Stack:** Express、流式临时文件、Node fs/crypto、现有上传并发限制、关系身份/维护屏障/领域命令、Expo DocumentPicker/文件分享、实际PG/Web/指定安卓。

## 当前证据与边界

- 接入前relationalRuntime将/files、/oss、/agent置为503；本轮/files已接入新身份，/oss和/agent仍为503；model/:id/files/add、images/add和order/:id/attachments/add为JSON登记命令，已有版本、审计、回执及物理校验，但没有对应关系multipart入口。
- utils/api.js的uploadModelFile/uploadImage/uploadAttachment仍为旧multipart地址且无关系业务头/已读版本；CreateModel关系分支在选择附件时先拒绝，避免创建模型后才发现附件失败。不能只移除拒绝就算完成文件接入。
- 旧routes/models直接加载utils/store和旧AI索引桥，旧files路由使用旧auth，不能整体挂回关系runtime。
- verifyUploadedFile现用uploadDirectory核实真实文件、路径、size和SHA；文件id由服务器生成，模型源文件存在图片引用时不能先删除。移除关联保留物理字节的规则不改。
- object_uploads已有owner/file_key/metadata，可记录上传事实；若确需新约束只追加新迁移，不修改既有1–7迁移或哈希。云OSS和AI分别后续接入，本项不把它们误标可用。
- 共享业务资料继续按现有组织角色读取；agent目录、路径穿越、越出根目录的符号链接和任意外部路径不可读取。不得新增未经设计的跨组织/个人私有文件策略。

## Task1 契约与实际失败用例

Files: backend/modules/adapters/files.js、backend/modules/files/service.js、backend/modules/files/localStorage.js；tests/backend/erp-local-files.test.cjs。

- [x] 核对现有file/image/attachment字段、预览生成、上传大小和并发限制，明确multipart→上传结果→领域关联的DTO，记录实体已读version和原key。先运行关系实际HTTP上传/下载失败用例，证明当前503/缺路由。
- [x] 设计单一显式存储接口：流式暂存、校验/hash、发布已验证字节、读取/Range、清理本任务暂存；不靠全局UPLOAD_DIR猜测测试根目录，不读取旧store/SQLite或启动AI桥。
- [x] 确定丢响应、重复上传、实体版本冲突和登记失败时的结果：重试复用原key，不重复关联/回执；已确认模型/订单不能重复新建；无法安全认定无人引用的正式字节不删，暂存单独清理。记录剩余可回收上传，不以静默丢文件补偿。

## Task2 服务端上传与登记

Files: 上述modules，backend/application/relationalRuntime.js、backend/modules/adapters/http.js；必要时新增业务SQL迁移。

- [x] 每次使用PG当前用户/tokenVersion，Owner/Staff可上传，Viewer拒绝；业务版本2/key缺失拒绝。读取已有认证代码并复用，不加载旧auth/store。
- [x] 分配独立临时目录，流式处理500MB默认模型上限及配置并发；在字节和数据库命令边界核对维护状态，维护拒写不新增业务关联/审计/回执。文件扩展名、size/hash和PNG/JPEG/WebP/PDF基本签名错误有明确反馈（不是完整解码/几何校验）。
- [x] 上传模型文件/图片与订单附件使用现有领域version/key，源预览引用关系保留；同键同内容重复结果一致，不同内容409。后端服务抛错时不残留本任务暂存，不误删共享/历史物理文件。
- [x] 通过真实PG及文件系统断言保存、重复、坏文件、冲突、维护、403/401和回滚；检查未加载旧JSONB/AI存储。

## Task3 受保护读取/下载

Files: backend/modules/adapters/files.js、localStorage.js及对应tests。

- [x] 只移除/files占位，使用新身份读取；/oss和/agent继续明确503。支持文件GET/HEAD和合法单段Range，非法Range416，未认证401、缺文件404，私有无缓存，真实size/mime一致。
- [x] 验证编码/反斜杠/agent目录/绝对路径/穿越及符号链接越界，不能读uploadDirectory外文件。只从已配置本地存储读取，不跟随未知外部URL或降级旧路由。
- [x] 模型/图片/订单附件实际字节下载及大文件范围请求通过；停用或改密旧token不能继续新下载，维护允许既有身份只读。

## Task4 客户端接线

Files: utils/relationalFilesCore.cjs、relationalFilesApi.js；screens/CreateModelScreen.js、ModelDetailScreen.js、CreateOrderScreen.js、OrderDetailScreen.js；相关文件/图片组件。

- [ ] 独立关系API携带业务头、固定key、已读version，multipart不强制JSON Content-Type；FilePicker补齐平台MIME并按扩展名/作用域/文件大小验证。旧服务器走原路径，不编辑既有脏utils/api.js来隐式补最新版本。
- [ ] 新建主体→上传→登记的每一步保存明确结果；附件失败时展示主体已创建和剩余附件，重试不重复创建主体或已经成功的文件。冲突明确重载核对；未知结果锁定原文件/类型/版本/key及返回，401/换会话可退出。
- [ ] 模型详情真实上传、图片类型/源文件/预览、删除关联和刷新；订单附件新建/编辑/移除/下载可用，保持现有编辑草稿，不把本地uri或附件名当已上传。
- [ ] 下载/分享沿用已核实服务器作用域，失效作用域不能分享旧缓存；有实际文件才显示成功。检查既有ModelDetail未提交图片工作，分离本项改动进行提交。

## Task5 真实集成与推进

- [ ] 自有新PG及临时文件根目录，实际源服务器Web/HTTP、旧文件服务器回归；Owner/Staff/Viewer、上传/预览/下载、冲突/丢响应重试、维护/失效会话与路径防护有业务及物理证据。
- [ ] 只在已批准emulator-5558安装独立QA包；用真实选择器和本地无网络接收器核对下载字节，明确APK来源。其他模拟器、日常应用、正式Docker与数据不改。
- [ ] 正式摘要只读核对，清理自有进程/容器/文件/QA包/私有配置；约95%且余项不阻断后进入OSS/AI。A1延迟写切会话、A4延迟文件读取强制失效、通用旧订单UI smoke遮挡继续归02D3总集成，不冒称整个02完成。

## 当前状态（2026-10-20）

A4 CSV已达到约95%，当前A5 Task4客户端接线。物理存储及真实PG/HTTP共27项通过，启动9项和适配19项回归通过；上传、PG事实/回执、JSON关联和受保护下载已接入。页面、预览和Web/安卓验收仍待完成，本项未达95%，02D2 Task6和02D4不能关闭。

## Task1物理存储结果（2026-10-20）

新增backend/modules/files/localStorage.js，不加载全局config/storage、旧store或AI。显式绝对uploadDirectory，先固定其真实根目录；下属暂存/发布目录不允许符号链接替换。

接口已经实际实现：

- stage(readable,{namespace,originalName,maxBytes,signal})返回只用于服务端内部的token、size字符串、SHA-256和原名；流式hash/计数，超限413、空文件/读失败/中断只清理本次暂存，不将500MB整块读入内存。
- publish(token)校验暂存完整内容后，以namespace/SHA256.ext原子硬链接发布；并发相同内容只保留一个物理文件，已存在内容不一致409且不覆盖。每次关联仍应由领域生成独立业务文件ID，不将内容键当成模型/附件身份。
- discard(token)只接受本实例创建的内部token，清理相应暂存并释放登记；已发布字节不删，避免其他关联/历史被误删。成功publish后及业务回执重放的请求finally均应discard自己的暂存副本。
- open(relativeKey)返回size、modifiedAt、一次性createReadStream(range)和close，支持旧相对键及解析后仍在根目录内的历史目录链接；禁止agent、暂存、编码路径、绝对路径、穿越、越界链接。HTTP调用者负责每次PG身份检查及关闭句柄，不在本层伪造认证。
- parseByteRange支持完整/起止/开放结束/后缀/越大结束截断，无效单段、多段或空文件Range返回416；HTTP头/状态仍待下一步接线。

从缺模块失败到13项真实文件系统检查通过、0跳过：完整chunk/hash/发布、并发去重、空/超限/中断/源错误清理、无效token和类型、真实旧文件与范围字节、已存在坏内容保护、越界目录链接保护、合法根内链接兼容、暂存被改动拒绝、32MiB实际生成/发布/两端范围读取、超限时提前停止源读取。测试清理只针对已核验在系统临时根目录下的本次随机前缀目录。

证据.tmp/erp-02d3a-files/local-storage-red.log、local-storage-green.log。本结果没有PG/HTTP/Web或安卓验收，不可冒称文件模块已可用。当前继续Task1明确上传→PG上传事实→领域关联的DTO和实际HTTP失败测试，然后Task2接入；正式环境未变。

## Task2–3 服务端结果（2026-10-20）

POST /api/uploads/models、images、attachments只接受一个file字段，使用当前PG身份、业务版本2和Idempotency-Key。模型上限默认500MiB，图片25MiB，附件50MiB；网络暂存不长占业务事务，提交时再校验账号和维护状态。稳定摘要仅包含namespace/originalName/size/sha256，内部暂存token不入摘要。回执返回uploadId/fileKey/fileUrl/name/originalName/size/sha256/fileType/mimeType，不返回业务文件id或createdAt。

上传与登记分开：客户端取得上传结果后，使用页面已读version及另一个固定key调用现有模型files/add、images/add或订单attachments/add；关联id由领域生成。相同上传键及内容回放原结果；内容不同409。关联失败保留已知上传结果，不能重新创建已确认主体。删除关联保留物理字节；物理发布与PG提交不是同一原子事务，PG失败可能留下未关联内容，后续回收前必须核对引用，当前不自动删除。

GET/HEAD /api/files/*已接新PG身份、私有无缓存及单段Range；合法206、无效416，维护仍可读。没有挂回旧store/auth/AI。原有迁移1–7未修改；object_uploads沿用既有结构，无新迁移。

真实PG/HTTP与物理文件共27项通过、0跳过，涵盖三类上传、模型文件/图片引用保护、订单附件登记移除且字节保留、回执重复/冲突、请求字段/超限/坏签名、维护拒写可读、私有目录和越界路径、上传中途停用账号后401且无上传业务事实/残留暂存。启动9项、现有适配19项回归通过。证据http-red.log、content-red.log、http-green.log、runtime-regression.log、adapters-regression.log均在.tmp/erp-02d3a-files。

27项不证明页面可用、完整图片/PDF解码、自动3D预览、500MiB完整压力或安卓选择器；这些仍需Task4–5。正式Docker和所有模拟器未操作。
