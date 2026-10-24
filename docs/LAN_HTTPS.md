# 免费内网 HTTPS（Windows + Docker）

使用部署专属的内网 CA，支持直接通过 IP 连接，不需要购买域名。Web 继续在员工自己的电脑运行，例如 http://localhost:8081；API 改成 https://服务器IP:5800/api。CORS 仍填写 Web 页面地址，不能填 API 地址替代。

## 服务器电脑：一次配置

1. 保持 Docker Desktop 和已安装的后端可用，在项目根目录双击 `配置内网HTTPS.bat`。
2. 填写服务器的固定局域网 IP，例如 `192.168.0.33`。多个实际使用地址用英文逗号分隔；不要输入协议、端口或路径。路由器建议为该电脑设置固定 DHCP 租约。
3. 脚本首次从 mkcert 官方 GitHub 下载固定版本 v1.4.4（Windows amd64），核对固定 SHA256 后执行。它生成证书、安装当前 Windows 用户的信任、备份 `.env`，使用原有业务卷重建 app。不会更改账号密码或模型下载密码，不会删除数据库。
4. 等待 `docker compose ps` 显示 app 健康；浏览器打开 `https://服务器IP:5800/api/system/info`，应能直接显示 JSON，且不出现证书警告。
5. ERP 的服务器设置改用 `https://服务器IP:5800/api`。协议变化可能要求重新登录，使用原账号。管理员可到“设置 → 模型下载保护”修改下载密码。

端口沿用 `.env` 中的 APP_PORT。切换后此端口提供 HTTPS，不再接受原来的 HTTP 请求。原有后台启动脚本和登录自启任务自动识别 TLS 配置；在新 IP 上使用前须重新签发证书，不能忽略浏览器警告。

命令行等效操作（从项目根目录运行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\setup-lan-https.ps1 -ServerNames '192.168.0.33' -TrustCurrentUser -Apply
```

省略 `-Apply` 只准备证书，省略 `-TrustCurrentUser` 不安装本机信任。已有离线工具可以用 `-MkcertPath 'D:\工具\mkcert-v1.4.4-windows-amd64.exe'`，仍会验证同一 SHA256。

## 其他 Windows 设备

管理员只分发 `runtime/tls/clients` 整个目录。用户与管理员通过已确认的渠道核对其中 `ROOT-CA-SHA256.txt` 的指纹，再双击 `Install-Trust.bat`。它仅安装当前用户的根信任，不需要修改所有用户证书库。关闭并重新打开 Edge/Chrome，填写同一个 HTTPS API 地址。

不要从一个尚未验证的 HTTP 网页随意安装根证书。请通过管理员分发的文件或其他可信渠道取得，并核对指纹。卸载时可在 Windows 的“管理用户证书 → 受信任的根证书颁发机构”按 `runtime/tls/installation.json` 的 rootCaThumbprint 精确找到此 CA 并移除，不删除其他证书。

## 安卓设备

将公开的 `3d-manage-rootCA.cer` 传到设备，在系统“安全/凭据 → 安装证书 → CA 证书”（不同系统名称可能不同）中安装，并通过管理员核对指纹。Android 浏览器可验证后再使用 HTTPS API。

原生 Android App 对用户 CA 的信任取决于应用配置。安装 CA 后浏览器可用，不代表原生 App 一定可用；若原生 App 仍拒绝证书，保留错误提示并单独验收，不开启“忽略证书错误”。当前方案首先交付 Windows Web 与 Windows 助手。

## 证书位置、续期和恢复

- `runtime/tls/ca`：CA 证书及私钥，限制为部署用户和 SYSTEM 读取。严禁分发、上传 Git 或挂进应用容器。
- `runtime/tls/server`：服务证书、服务私钥与公开 CA；容器仅只读挂载此目录。
- `runtime/tls/clients`：可分发的公开根证书、指纹、信任脚本，不含私钥。
- `runtime/tls/installation.json`：签发的地址和根证书指纹。

重新运行脚本会沿用 CA，并为所填地址重新签发服务证书；设备通常无需重新安装根信任。签发工具会显示服务证书有效期，到期前重新运行。CA 文件不完整时脚本拒绝重建；请保留 CA 和服务证书的私有离线备份，与 `.env` 的恢复密钥一起保管。现有业务备份不会自动包含 TLS 目录。

需要回退时，恢复 `.env.lan-https-日期时间.local` 为 `.env` 后执行 `docker compose up -d --no-deps app`，然后将客户端地址改回原 HTTP 地址。业务卷保留；已开启的模型下载保护仍要求 HTTPS，回退不会绕过此保护。

此内网直连模式不能和 `compose.https.yaml` 公网 Caddy 模式叠加。未来改用域名时，改为公开 CA 或反向代理证书，保留同一账号/下载授权接口；不要把内网 CA 私钥交给公网服务。

来源：[mkcert 官方说明](https://github.com/FiloSottile/mkcert)，含 CA 私钥保护和设备信任要求。
