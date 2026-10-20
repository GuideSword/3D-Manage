# ERP 02D3A5 本地文件接入进展

## 当前结果

独立物理存储层已实现，真实文件系统13项通过、0跳过；当前仍在Task1，不是完整上传下载功能交付。关系runtime的/files占位503未解除，PG上传记录、multipart入口及页面继续待接；未更新正式Docker，也未操作任何模拟器。

## 已实现与验证

显式根目录，不读取旧JSONB/AI或全局storage配置。stage用pipeline逐块hash及大小检查，成功后返回内部token；publish重新核验完整内容，以namespace/SHA256.ext硬链接原子发布，相同内容只产生一个物理文件；discard只清理本实例临时副本，不删发布字节。根路径及暂存/发布目录均核对，读取做真实路径及句柄身份核对；根内历史目录链接保留可读，越界链接拒绝。

13项检查包括：显式配置和依赖隔离；原始chunks/SHA/size正确；不同暂存的并发同内容发布仅一文件；空/超限/中断/源错误不留暂存；不能伪造token删除外部路径；旧文件及精确范围字节；已存在坏内容不覆盖；越界目录替换拒绝；多种Range和416；暂存被改动后拒绝；根内目录链接兼容；实际32MiB生成上传/发布及两端读取；超限时不读取源剩余全部内容。没有把小文件测试称为500MB完整压力验收，32MiB是本轮实际检查大小。

测试清理在fs.rm递归调用前确认随机目录为系统临时根目录的直接子目录且前缀为erp-local-files-；不碰项目数据目录或用户文件。所有Node检查使用真实fs/streams，而非mock写入。

## 证据与余项

.tmp/erp-02d3a-files/local-storage-red.log起点缺模块失败；local-storage-green.log为13/13。代码backend/modules/files/localStorage.js、测试tests/backend/erp-local-files.test.cjs。角色/维护/回执/上传关联、预览、下载HTTP头/Range、客户端重试和平台验收均尚未由本轮证明，继续实施；A5未达95%，整个阶段02未完成。
