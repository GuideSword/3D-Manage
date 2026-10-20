# ERP 02D3A5 本地文件接入进展

## 当前结果

本地存储及真实PG/HTTP共27项通过、0跳过；启动9项、适配19项回归通过。关系runtime已接入multipart上传、PG上传事实/回执及受保护GET/HEAD/Range，当前Task4页面接线；尚非完整文件模块交付。未更新正式Docker，也未操作任何模拟器。

## 已实现与验证

显式根目录，不读取旧JSONB/AI或全局storage配置。stage用pipeline逐块hash及大小检查，成功后返回内部token；publish重新核验完整内容，以namespace/SHA256.ext硬链接原子发布，相同内容只产生一个物理文件；discard只清理本实例临时副本，不删发布字节。根路径及暂存/发布目录均核对，读取做真实路径及句柄身份核对；根内历史目录链接保留可读，越界链接拒绝。

13项检查包括：显式配置和依赖隔离；原始chunks/SHA/size正确；不同暂存的并发同内容发布仅一文件；空/超限/中断/源错误不留暂存；不能伪造token删除外部路径；旧文件及精确范围字节；已存在坏内容不覆盖；越界目录替换拒绝；多种Range和416；暂存被改动后拒绝；根内目录链接兼容；实际32MiB生成上传/发布及两端读取；超限时不读取源剩余全部内容。没有把小文件测试称为500MB完整压力验收，32MiB是本轮实际检查大小。

测试清理在fs.rm递归调用前确认随机目录为系统临时根目录的直接子目录且前缀为erp-local-files-；不碰项目数据目录或用户文件。所有Node检查使用真实fs/streams，而非mock写入。

## 证据与余项

.tmp/erp-02d3a-files/local-storage-red.log起点缺模块失败；local-storage-green.log为13/13。代码backend/modules/files/localStorage.js、测试tests/backend/erp-local-files.test.cjs。角色/维护/回执/上传关联、预览、下载HTTP头/Range、客户端重试和平台验收均尚未由本轮证明，继续实施；A5未达95%，整个阶段02未完成。

## 服务端HTTP与PG补充证据

新增modules/files/service.js与adapters/files.js；runtime显式传uploadDirectory，不加载旧auth/store/AI。POST /uploads/:namespace要求PG当前Owner/Staff、业务头2及key，流式暂存后在领域事务内重新校验身份/维护，写object_uploads、审计与回执。签名检查覆盖PNG/JPEG/WebP/PDF基本头，不代表完整格式解码。相同内容原key回放、改内容409；JSON领域登记保持已读version，模型图片源文件被引用时不能删除，移除订单附件保留原字节。

GET/HEAD /files支持真实字节、mime、长度、私有无缓存、合法单段Range206和非法416，未认证401，缺文件404，私有目录/越界链接拒绝，维护允许读取。/oss与/agent仍503。

先运行http-red.log证明确实缺路由，再运行content-red.log证明伪图片曾被接受，修正后http-green.log为27通过0跳过；runtime-regression.log为9通过，adapters-regression.log为19通过。上传中途停用账号实际HTTP请求最终401，未产生上传记录/审计/回执，暂存为空；测试仅使用自有PG验证容器和核验路径后的临时目录。

不修改既有SQL迁移，不部署正式容器。发布文件与PG不是跨系统原子提交，PG失败可留未关联内容；不误删共享发布字节。未验证页面、平台预览、完整大文件压力；A5未达95%，继续客户端，02D2 Task6/正式切换保持待办。
