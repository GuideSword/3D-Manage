# 自托管首版发布检查清单

只有全部必需项完成后才能标记阶段交付。外部条件缺失时保留未勾选状态。

## 自动与源码检查

- [x] `npm run verify:release` 本地通过（2026-09-08）。
- [x] 运行时地址规范化和客户端会话竞态测试通过。
- [x] 后端 runtime、API、自托管验证通过。
- [x] Web 独立导出通过。
- [x] 生产默认凭据与客户端对象存储密钥扫描已人工检查匹配项。
- [x] 发布归档生成器排除 `.env`、客户 runtime、签名私钥、依赖目录和日志。

## Compose 与恢复证据

- [ ] Linux x86_64 干净环境 Compose 构建并记录 app 镜像 digest。
- [ ] 全新 runtime 初始化 Owner，记录 serverId；初始化接口第二次调用失败。
- [ ] 创建订单和上传文件后重启，登录、serverId、订单和文件 hash 保持。
- [ ] PostgreSQL 事务/并发验证在专用测试数据库通过。
- [ ] PowerShell 与 Linux 冷备份均生成有效 dump、文件归档和 manifest。
- [ ] 删除测试数据后完整恢复订单、文件、AI 会话和加密凭据。
- [ ] 错误密钥、损坏 dump、错误 hash、路径穿越在目标变更前失败。
- [ ] HTTPS 域名证书、SSE、500 MB 上传限制和精确 CORS 验证通过。

## 角色与客户端真机

- [x] 自动化验证 Staff 可创建订单，Viewer 不能通过普通或 Agent API 写入。
- [ ] 独立签名 preview APK 已在物理 Android 设备安装，Metro 与开发前端均关闭。
- [ ] 局域网 HTTP 地址运行时连接通过。
- [ ] 受信任 HTTPS 域名连接通过；未关闭证书校验。
- [ ] 从上一测试 APK 覆盖安装后，服务器设置保留且账号隔离正确。
- [ ] Native 文件读取、鉴权下载/分享、断网取消和退出临时文件清理通过。

## 发布记录

- 客户端版本：`1.0.0`
- Android package ID：`com.anonymous.x3DManage`（沿用现有 ID，首次外发前由发布方确认所有权）
- Android build number：由 EAS production profile 自动递增，尚未生成
- EAS project owner：`guidesword`；签名密钥由发布方 EAS 账户托管
- APK 构建 URL：尚未生成（外部 EAS 凭据前提）
- APK SHA-256：尚未生成
- 后端镜像 tag：`3d-manage-backend:1.0.0`（源码构建标识，尚未发布）
- 后端镜像 digest：尚未生成
- API / store schema / PostgreSQL：`1 / 2 / 16`
- 测试 serverVersion：`1.0.0`
- Git 提交：发布时以 `git rev-parse HEAD` 和 `release-manifest.json` 为准
- 检查日期：2026-09-08

当前发布状态：未完成。阻断项是 Docker/Linux 恢复演练、受信任 HTTPS、EAS 签名 APK 与物理设备验收。
