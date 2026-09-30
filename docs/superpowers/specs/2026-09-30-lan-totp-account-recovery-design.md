# 局域网 TOTP 登录与账号恢复设计

日期：2026-09-30。状态：待用户审阅。用户选择先在局域网 IP 部署 TOTP，并要求将来改为域名或公网时保留现有账号绑定。此设计是 ERP 优先级计划的独立安全工作项，安排在 01 交付之后、02 关系存储切换之前。通行密钥留作取得稳定 HTTPS 域名后的专项，不纳入本次实施。

## 目标与方案

已启用 TOTP 的账号每次新登录均需密码和认证器生成的 6 位动态码；已登录时修改密码需重新验证当前密码和动态码。忘记密码或丢失认证器时，使用预先离线保存的一次性高熵恢复码进入限时恢复流程，重设密码或重新绑定认证器。三道安全问题不作为恢复凭据。Owner 创建新用户、重置 Staff/Viewer 密码的现有职责保留，并增加受控的 MFA 故障处理。

比较方案：仅增加恢复码容易交付，却不保护普通登录；仅凭 TOTP 允许重置密码会把短数字码变成单独的账号入口；选用密码加 TOTP 与独立恢复码，在不依赖域名、短信或邮件服务的情况下兼顾日常登录和设备丢失恢复。TOTP 不具备通行密钥的抗钓鱼能力，不声称是最高安全级别。

本次不开发认证器 App，也不依赖某一家认证器的云服务。验收基准选择 **Microsoft Authenticator 的“其他账号”**，兼容性再用 **Google Authenticator** 验证；两者均有官方说明支持为第三方账号扫描二维码生成动态码。用户可以选用其他支持同样参数的 TOTP 应用，但不能把仅支持短信验证码、厂商推送批准、HOTP 计数器码或专有企业令牌的应用视为兼容。

具体互操作参数固定为 RFC 6238 TOTP、HMAC-SHA1、6 位、30 秒、每账号独立随机密钥、Base32 无填充编码。绑定二维码采用通行的 `otpauth://totp/` URI，带 URL 编码的稳定服务标识、账号标签，以及 `issuer`、`secret`、`algorithm=SHA1`、`digits=6`、`period=30`；同时显示手动输入密钥，解决认证器与本项目运行在同一部手机上无法互扫屏幕的问题。服务标识须能区分不同 3D Manage 安装，展示标签可随域名/IP 变化，但密钥和验证码算法不变。服务器只容忍有限时钟偏差，成功使用的时间步不可重放；绑定必须输入认证器实际生成的验证码并由服务端校验，不能只凭“扫码成功”启用。

## 局域网 HTTPS 与迁移准备

正式启用 TOTP 前，先固定或保留本机局域网 IP，为该 IP 配置 TLS 反向代理和含 IP SAN 的证书。可使用 Caddy 内部 CA，但其根证书必须由每台获准设备明确安装并信任；CA 私钥不进入 Git、APK 或公开下载。手机、桌面 Web 和正式 APK 分别验证证书链、主机名/IP 匹配和连接成功，绝不关闭证书校验。Android 正式版须验证对所选私有 CA 的信任配置，避免为所有主机无条件放宽信任。切换时移除 app 对局域网公开的 HTTP 端口映射，仅让反向代理访问容器内 HTTP；不能依靠 POST 重定向来保护已经发送到明文端口的凭据。未完成这些检查时，可在隔离环境开发和测试，但不得让正式账号通过原 HTTP 地址绑定 TOTP 或提交恢复码。

现有 `http://192.168.0.32:5800/api` 仅作为升级过渡入口。切到 HTTPS 时，客户端可能因 URL 变化清除本地 JWT；这不删除服务器上的账号和 TOTP 绑定，用户重新登录即可。服务器身份沿用 `serverId`；TOTP 密钥和恢复码关联用户 ID 与该服务器身份，不关联 IP、端口、协议或将来的域名。未来改为受信任域名证书时，沿用同一用户表、TOTP 密钥和恢复码；只替换传输入口并做客户端连通/登录验收。

## 绑定、登录和敏感操作

1. Owner 和已有用户先通过现有方式登录。在可信 HTTPS 下进入“账号安全”，提交当前密码后请求绑定。服务端生成随机密钥并保存待确认状态，返回只在此次绑定流程显示的 `otpauth://` 信息；二维码不写入日志或持久客户端缓存。
2. 用户用认证器扫描，输入当前 6 位码。服务端验证后原子启用 TOTP，生成 10 个独立随机恢复码，只显示一次并要求用户确认已离线保存。若绑定未确认或超时，旧登录方式保持可用；不为尚未绑定的旧账号突然强制动态码。
3. 已启用账号提交正确邮箱/密码后，仅得到短时、单用途的 MFA challenge，不发 JWT、不更新成功登录审计。提交有效 TOTP 后才发 JWT。错误邮箱、密码或验证码使用不泄露账号存在性的响应，并按账号/IP 做失败限流；challenge 过期、重复使用或切换服务器均拒绝。
4. 修改密码、关闭/更换 TOTP、再生成恢复码均要求重新认证。修改密码验证当前密码加 TOTP；成功后增加 `tokenVersion`，使旧 JWT 失效，并写审计。更换认证器先确认新码，成功后才替换旧密钥；旧设备失效。恢复码再生成使旧恢复码全部失效。
5. 忘记密码使用邮箱加一条未使用恢复码换取短时、单用途恢复会话。用户可设置新密码；若认证器丢失，可在同一恢复会话重绑新 TOTP 并确认新码，之后重新生成恢复码。恢复操作增加 `tokenVersion`，撤销旧会话，并留下不含密钥、恢复码或密码的审计。若恢复码和认证器均丢失，Staff/Viewer 由 Owner 经重新认证后执行受审计的人工恢复；Owner 使用现有本机受控 CLI 恢复，不能通过公开接口绕过验证。

新用户首次启用 MFA 前，可由 Owner 发放初始密码并通过旧登录流程进入绑定；是否对全组织强制启用需在所有活跃用户成功绑定并留存恢复码后由 Owner 开启，不能在发布时自动锁定既有账号。Viewer 的自助账号安全操作不受其业务只读角色限制。

## 数据、接口与恢复

新增独立的 MFA 领域模块，集中处理密钥生成/验证、challenge、恢复码消耗和审计。账号持久字段包括启用状态、加密后的 TOTP 密钥、最近已使用时间步、恢复码哈希与绑定时间；这些字段永不进入 `publicUser`、CSV、AI、普通用户列表或审计 diff。临时 challenge 仅保存哈希、用途、用户、过期时间和尝试次数；在当前单副本架构可先使用受保护的服务端存储，但后续关系迁移必须保证原子消耗，不依赖进程内状态。

使用现有 `AGENT_KEY_ENC_SECRET` 以固定 MFA 用途标签派生独立加密子密钥，对 TOTP 密钥进行认证加密；不直接复用 AI 密文格式。高熵恢复码只保存不可逆校验值，使用时原子标记消耗。备份现有数据库和 `.env` 必须继续成套保存；恢复演练增加“原认证器可登录、恢复码只能用一次、密钥不匹配时拒绝恢复”的检查。将来轮换根加密密钥先迁移 MFA 密文，不能静默使所有用户失去认证器。

API 分为绑定开始/确认、MFA 登录完成、修改密码、恢复开始/完成、关闭/更换认证器与恢复码再生成；所有返回 `Cache-Control: no-store`。明确区分正常登录、MFA challenge、恢复会话和已认证 JWT；客户端只在拿到 JWT 后调用已登录接口。API 不接受任意客户端声称的服务器身份或用户 ID，审计由服务端当前身份产生。

## 异常、验收与发布

- 错误码覆盖密码错误、TOTP 错误/已使用/过期、challenge 过期、恢复码已用/无效、MFA 未绑定、传输不安全；对未认证请求保持统一外部文案，避免账号枚举。
- 验证时钟前后偏差、边界 30 秒、并发提交同一码、暴力猜测限流、请求重放、断网重试和服务器切换；失败不消耗有效恢复码、不改变原密码或绑定状态。
- 隔离环境完成后，在正式 Docker 升级前做全量备份和恢复演练。先用测试账号在 Android 真机及桌面 Web 验证 IP HTTPS、扫码、登录、修改密码、恢复码、退出与重新登录；确认原账号及业务数据不变，再让 Owner 自行绑定。
- 阶段 02 关系存储迁移须原样迁移 MFA 状态和挑战/恢复码消费语义；未来域名切换验证无需重绑。公网开放之前另行检查证书、网络暴露和限流，不把局域网 CA 当作公网信任方案。

依据：[RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238)、[Google Authenticator 的通用二维码格式](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)、[Microsoft Authenticator 添加其他账号](https://support.microsoft.com/en-us/authenticator/how-to-add-your-accounts-to-microsoft-authenticator)、[Google Authenticator 帮助](https://support.google.com/accounts/answer/1066447)、[OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)、[OWASP 认证传输](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Caddy 本地 HTTPS](https://caddyserver.com/docs/automatic-https)、[Android 网络安全配置](https://developer.android.com/privacy-and-security/security-config)、[Apple 局域网 TLS](https://developer.apple.com/documentation/network/creating-an-identity-for-local-network-tls)。
