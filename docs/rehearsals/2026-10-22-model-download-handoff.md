# 模型下载保护与 Studio 交接验收记录

日期：2026-10-22。结论：主体开发及隔离自动验收完成；正式发布、助手注册和用户手动触发的Studio实际导入未完成，不将这些剩余事项算作通过。

## 本次交付

- 旧JSON/JSONB和关系PostgreSQL使用同一下载授权规则。Owner设置/轮换独立资源密码；Owner本人也验证。保护开启后，普通下载、安卓分享、直接文件API、旧链接及助手交接不能绕过检查。旧公开路径不提供源文件；CSV元数据导出不包含可下载的授权凭据。
- 源文件以资源登记为准，不能把源文件放到图片目录就获得预览豁免；已登记普通预览仍能显示。外部模型地址需先迁入受保护文件服务，旧OSS模型上传记录也阻止直接开启保护；开启后不签发OSS直链或继续登记外部上传。
- 下载前明确同意本地拉取；密码错误不下载。授权限定账号和文件，普通传输5分钟有效以支持Range；助手凭据60秒且只能兑换一次。错误口令5次/60秒限速，账号停用、会话及口令版本变化阻止后续旧授权。
- Windows Web增加明确点击的Studio入口。源码助手绑定HTTPS服务器地址和身份，核对文件大小/SHA后才调用固定Studio程序；可选择另存，默认临时副本；没有切片或打印调用。
- `TLS_CERT_FILE`及`TLS_KEY_FILE`提供直接HTTPS接入。上线时Web页面与API均需受信HTTPS，不能只加密API而通过局域网HTTP加载网页。测试证书未加入系统信任，正式证书尚未部署。

## 实际验证

| 范围 | 实际结果 |
| --- | --- |
| 下载保护核心、真实关系PG/HTTP和旧PG JSONB/HTTP | 8项通过、0跳过；覆盖角色、失败限速、过期/轮换/停用、跨账号/文件、并发一次兑换、真实下载与范围读取、HTTPS要求、源/图分类及OSS签发拒绝 |
| 旧文件JSON模式 | 单独运行旧接口测试通过，原订单/模型/耗材样例保持一致 |
| 本地文件/3MF回归 | 44项通过、0跳过 |
| 数据库基础回归 | 17项通过、0跳过 |
| 服务器运行隔离回归 | 9项通过、0跳过 |
| 客户端基础回归 | 26项通过、0跳过 |
| 原生文件下载及授权边界 | 9项通过、0跳过 |
| 中文错误、运行配置 | 中文6项及runtime验证通过 |
| Edge实际页面 | 7组通过：未同意/取消、保护关闭兼容、Owner设置、错误密码拒绝、真实下载字节、Studio安装/交接等待明确点击、窄屏Viewer权限；无pageerror |
| 指定雷电原生 | 只使用emulator-5558，AndroidID核对一致；独立QA包验证同意/取消/错误口令与正确下载分享，实际接收46字节，SHA256为`f521f3ea5f6859244155ce407072ffae2498ed131535a4f612e8a59024fcc05b` |
| Windows PowerShell 5助手 | 校验URI/绑定地址和服务器身份、相同大小但SHA不符、取消、已有文件拒绝覆盖及脚本解析通过；启动函数全部替身，没有执行真实Studio |

Edge使用独立headless会话，按用户要求首先尝试Edge且成功，未使用Chrome或内置浏览器，没有修改用户浏览器会话。自签名证书仅在临时浏览器上下文接受。安卓通过专用ADB反向转发连接隔离环回HTTP测试口；此测试口的显式注入选项不进入正式启动配置，不代表正式加密传输已验收。

APK为独立`com.anonymous.x3DManage.modeldownloadsqa`，未覆盖日常包。APK构建包含工作区原有未提交修改，仅为QA产物，不作为纯Git提交的正式发行包。原生操作完成后按包路径、安装字节hash及设备身份核对，已卸载本任务QA应用、移除本任务5853转发，并恢复此前验收接收器。日常App路径前后相同，没有操作其他模拟器。

## 可复现入口

```powershell
pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite model-downloads
pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite local-files
node --test tests/backend/model-downloads-legacy.test.cjs
node --test tests/client/native-file-download.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/model-handoff.verify.ps1
pwsh -NoProfile -File tests/ops/package-model-handoff.ps1
```

Web：先导出到`.tmp/model-downloads/web`，运行`pwsh -NoProfile -File tests/ops/model-downloads-ui.ps1`建立自己的临时PG/HTTPS服务，再运行`node tests/ops/model-downloads-web.verify.cjs`，最后用启动脚本的`-Stop`核对归属并清理。测试脚本需要已安装的Playwright模块；可通过`ERP_02C_PLAYWRIGHT_MODULE`指定。它读取的账号仅为生成的隔离样例账号，不输出密码。

本地证据在忽略目录`.tmp/model-downloads/`：`backend-verification.log`、`local-files-verification.log`、`web-verification.json`、`native-verification.json`、截图和实际接收字节。两次Web复核和原生验收使用不同的隔离runId，分别记录；不与正式服务器混用。完成后专属Node/数据库已清理，私有配置已删除；保留可审查证据和源码安装ZIP。

## 版本、数据及剩余边界

代码提交：后端`b3941d5`、客户端/助手`ad54f58`、验收工具`44a353d`；后续安全与兼容修复为`a81dabd`、`8ece915`、`d612937`。仅提交本地Git，未推送GitHub或发布Release。源码安装包由固定四个助手源文件及SHA256SUMS组成，不包含账号、模型、私钥或运行配置；尚未提供签名EXE/MSI安装程序。

未更新正式Docker容器、未迁移正式业务存储、未改写正式订单/模型/耗材，未安装系统证书或注册自定义协议。正式接入需先备份并配置受信HTTPS、验证客户端兼容，再由Owner启用保护；旧客户端届时会被服务器拒绝下载源文件。启用后不能直接回退不认识下载保护的旧服务并继续开放文件入口，需先进入维护/关闭下载入口后制定回退方案。

实际Studio导入须用户手动触发，当前未验收；不能把函数替身和浏览器跳转准备当作真实导入通过。临时副本与Studio自身缓存可能留存，用户确认Studio已关闭后自行清理专用任务目录；已授权下载的数据无法收回，也不能承诺阻止有权限成员主动复制。

补充回归：旧文件大小保存为精确数字字符串时，助手兑换原先返回409；修复后真实旧接口及PG/HTTP均通过。未启用保护时，旧接口下载及查询保护状态的完整数据快照前后一致。配置过下载口令的旧源在迁移预检中被明确阻断，阻断报告不包含密码hash；普通导入12项通过。该阻断需在02D4切换前通过显式保护设置迁移设计解除，不能清空保护设置来绕过。
