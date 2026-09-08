# 自托管部署

3D Manage 由可安装客户端和客户自管后端组成。后端保存账号、业务数据、AI 设置与文件；客户端首次启动时输入后端地址。

## 前提与网络

- x86_64 Linux 主机，Docker Engine 及 Docker Compose v2；本阶段未验证 ARM64。
- 推荐先为 `app` 分配 Compose 默认的 1.5 CPU / 768 MB，并按实际 500 MB 上传与并发压力测试结果调整。这是初始限制，不是最低硬件保证。
- 局域网 HTTP 开放 `APP_PORT`（默认 TCP 5000）；公网必须使用受信任 HTTPS，并开放 TCP 80/443 与 UDP 443。
- Web 来源必须以精确的 scheme、host、port 写入 `CORS_ORIGINS`。Native 客户端没有 Origin；不要用 `*` 放宽 Web 来源。

## 快速启动

在项目根目录运行：

```powershell
node deploy/init-config.mjs
docker compose up -d --build
docker compose ps
curl.exe http://localhost:5000/api/system/info
docker compose logs -f app
```

配置生成器创建独立的数据库密码、JWT 密钥、AI 密钥加密密钥和一次性初始化令牌，并拒绝覆盖已有 `.env`。限制 `.env` 的读取权限，并将其作为独立恢复密钥包离线保存。Compose 的 `.env` 只用于变量插值；配置已逐项传入容器。

首次启动后，在客户端输入 `192.168.1.10:5000`（私网 IP 会规范化为 HTTP）或 `https://manage.example.com`。确认产品与 API 版本后，填写组织、Owner 和 `.env` 中的 `BOOTSTRAP_TOKEN`。令牌仅作为请求头发送，不保存在客户端或业务存储。Owner 登录后可在“设置 → 用户与权限”创建 Staff 与 Viewer。

数据持久化在：

- `runtime/postgres`：业务 JSONB 数据；
- `runtime/data`：AI SQLite 数据；
- `runtime/uploads`：本地上传文件。

删除 `runtime/` 会删除客户数据，升级流程绝不能删除它。

健康检查和日常命令：

```powershell
curl.exe http://localhost:5000/api/system/info
docker compose ps
docker compose logs --tail 200 app
docker compose stop
docker compose start
```

`/api/system/info` 必须返回 `product: "3D Manage"`、稳定的 `serverId` 与 `apiVersion: "1"`。服务健康同时要求 PostgreSQL、AI SQLite 及数据/上传目录可用。

## HTTPS

先让域名 A/AAAA 记录指向主机，在 `.env` 设置 `APP_DOMAIN` 与准确的 `CORS_ORIGINS=https://域名`，再运行：

```powershell
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Caddy 自动申请并续期证书、关闭 SSE 响应缓冲，并把上传上限设为 500 MB。HTTPS 模式不向主机发布 app 的 5000 端口。不要关闭证书校验；自签证书只有安装为系统受信任根证书后才能测试。HTTPS Web 页面不能请求 HTTP API，这是浏览器混合内容限制，并非 CORS 故障。

## 会话验收

- 退出删除当前服务器 token 和 App 临时文件，保留服务器地址与主题。
- 从 A 更换到不可达 B 时，A 保持选中且 token 不变。
- 从 A 更换到可达 B 时，A token 被删除，B 成为当前服务器并要求登录。
- 以后返回 A 仍需登录，不能看到之前的页面、AI 流或临时数据。
- 清理失败时客户端保持登出并显示重试；不会宣称清理成功。

Web token 位于标签页 `sessionStorage`，关闭标签页即消失；Native token 位于 SecureStore。浏览器或用户明确导出的副本不属于可安全擦除的 App 临时文件。

## 文件存储与外部服务

不配置 OSS 和外部 AI 时，订单、库存、本地文件与基础管理仍可运行。若启用 OSS，密钥只放在后端 `.env`。单实例是当前支持模式，因为 AI SQLite 位于本地持久卷。

备份与恢复见 [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)，升级见 [UPGRADE.md](./UPGRADE.md)。
