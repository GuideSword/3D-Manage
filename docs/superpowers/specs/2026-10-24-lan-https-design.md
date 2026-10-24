# 内网 HTTPS 与下载密码权限

用户已同意免费内网证书方案并授权实施。权限范围按本次明确列出的模型下载密码执行；账号自助修改登录密码单独确认，不将两种密码混用。

选择已有 Node HTTPS 直连能力，保持 APP_PORT、Web 本地部署及所有业务卷。另选 Caddy 私有 CA 需要代理信任配置，公网域名方案需要 DNS；本次不引入这两种依赖。Windows 脚本使用固定版本及 SHA256 的 mkcert，生成此部署专属 CA、含明确 IP/DNS SAN 的服务证书。不关闭客户端证书校验，不按私网 IP 豁免 HTTPS。

CA 私钥仅在 runtime/tls/ca；容器只读挂载 runtime/tls/server（服务证书、服务私钥、公开 CA）。设备安装包仅含公开根证书、指纹和信任脚本。Windows 使用当前用户根证书库，安装前核对 SHA256 指纹；Android 浏览器由用户在系统设置中安装公开 CA。Android 原生 App 是否信任用户 CA 单独验证，不宣称安装后所有 App 均可用。

配置脚本默认只准备证书和操作说明，显式 -Apply 才备份并修改 .env、重建 app；显式 -TrustCurrentUser 才安装当前用户信任。重复执行复用 CA；地址变化重签叶证书，不能静默更换 CA。签发失败不改 .env，不启动服务。保留 CORS 精确来源和现有数据；配置备份及 TLS 私钥不进 Git。

Node 容器健康检查以 CA 验证 HTTPS localhost，禁止 rejectUnauthorized:false。原 HTTP 模式保持可启动。Windows 后端启动脚本按 TLS 配置探测并显示正确地址。公网 Caddy overlay 与直接 TLS 不混用。

Owner 才能新增、修改、重置下载密码或开关下载保护；staff/viewer 只能提交密码给服务器校验。所有角色下载均需同样授权。密码不回显、不返回哈希，修改后旧授权失效。已有实现保留，补齐服务与 HTTP 回归证据。

验收：实际 Windows PowerShell 5.1 准备及信任流程；受信 HTTPS 成功、无 CA 失败、HTTP 不可用于受保护操作；角色矩阵含管理员错误密码、普通成员直接写接口和轮换失效；正式更新前后 serverId、业务计数与卷相同。不自动启动 Studio、不改模型下载密码、不操作未指定模拟器。
