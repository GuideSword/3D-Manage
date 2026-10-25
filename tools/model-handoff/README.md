# Windows 模型交接助手

此目录保存助手全部源码。助手支持“打开Bambu Studio”和“批量导入模型”两种受绑定服务器控制的操作，不提供打印、自动切片或后台模型同步。

批量导入通过 `manage3d-model://import?server=<编码后的API地址>&ticket=<一次性凭据>` 启动。安装器注册统一 dispatcher，dispatcher 会校验 HTTPS、服务器身份和重复参数，再打开导入工作台；导入工作台支持 STL、OBJ、3MF、STEP、STP 的递归扫描、断点清单和取消恢复。票据只在助手进程内存中使用。

## 安装

需要Windows、Bambu Studio以及可验证证书的ERP HTTPS接口。局域网IP可以使用内部CA签发且包含该IP的证书，不要求购买域名；在浏览器及Windows中先正常验证证书，不能跳过校验。

正式用户应优先从 ERP 网页的“下载 Windows 助手”按钮或 GitHub Release 下载带版本号的 ZIP，并核对同一 Release 中的 `SHA256SUMS`。下载不会自动安装；打开 ZIP 后在 Windows PowerShell 运行安装脚本，Windows 会单独显示安装确认。

校验不要求安装包位于 C 盘或固定的“下载”目录。将 `Verify-Checksum.ps1` 与网页下载的 `SHA256SUMS` 放在同一目录，然后运行：

```powershell
.\Verify-Checksum.ps1 -ArchivePath 'D:\你的目录\3d-manage-model-handoff-windows-v1.0.0.zip' -ChecksumFile 'D:\你的目录\SHA256SUMS'
```

也可以右键 `Verify-Checksum.ps1` 选择“使用 PowerShell 运行”，或省略 `-ArchivePath`，脚本会提示输入 ZIP 路径；可以直接把 ZIP 拖进 PowerShell 窗口。此交互模式会在显示结果或错误后等待再次按回车关闭窗口。指定 `-ArchivePath` 的命令模式不会等待；自动化也可显式传入 `-NoPause`。注意：校验的是原始 ZIP，不是解压后的单个文件。缺少 `SHA256SUMS` 时仅显示本地计算值，不代表校验通过；退出码为 0 表示通过、1 表示错误、2 表示缺少发布值而尚未验证。

从同一版本仓库获取整个目录，在Windows PowerShell运行：

```powershell
.\Install.ps1 -ServerUrl 'https://你的ERP地址/api'
```

选择`bambu-studio.exe`并确认安装。普通用户不需要Git。若下载文件被Windows标记为互联网来源，请先审查源码，再按组织策略解除这些文件的来源锁定；不全局修改执行策略。更新已有安装前先人工核对协议与目录归属，安装器不会覆盖现有协议。

配置及运行脚本保存在`%LOCALAPPDATA%/3DManageModelHandoff/app`；仅写当前用户的`manage3d-model`协议，不覆盖STL/3MF文件关联。安装时通过受信HTTPS读取并绑定ERP服务器身份，之后每次交接重新核对，IP相同但服务器身份变化也会拒绝。首次只绑定一个ERP地址；绑定其他服务器需重新明确配置，不接受网页任意指定服务器。

服务器可用`TLS_CERT_FILE`和`TLS_KEY_FILE`同时配置证书与私钥的绝对路径，直接提供HTTPS；Docker内应使用已挂载的容器内路径。没有证书时原有HTTP业务仍可使用，但不能启用下载密码或执行助手交接。若使用反向代理，需另行正确配置可信代理，不能仅添加`X-Forwarded-Proto`请求头冒充HTTPS。

## 使用和本地数据

Web端先同意本地拉取并验证模型下载密码，再点击“打开Bambu Studio”。助手从绑定ERP兑换60秒内的一次性交接凭据，取得5分钟、限定文件及账号的传输授权；不会取得账号密码或登录令牌。账号停用、口令轮换会阻止新的旧授权请求；已传输数据无法收回。

助手再次显示文件名，并让用户选择仅临时使用、额外保存一份或取消。下载使用受信HTTPS、拒绝重定向、流式限制大小，校验SHA256/大小后才把临时文件交给指定Studio。支持STL/OBJ/3MF/STEP/STP，实际导入能力取决于已安装Studio；ZIP需要普通下载后手动处理。

临时文件保存在`%LOCALAPPDATA%/3DManageModelHandoff/temporary/<随机任务目录>`。首版不自动删除成功打开的文件，避免Studio尚未读完就删除。确认Studio已关闭且项目已另存后，可由用户手动删除对应任务目录；助手不会清除Studio自身的缓存、恢复文件或用户另存文件。另存使用新文件，不覆盖已有文件。

不在页面加载、安装、自动测试或后台重试时启动Studio。自动测试使用假的启动函数验证文件参数，不能据此声称本机Studio真实导入已经验收。

## 卸载

先核对`HKCU/Software/Classes/manage3d-model/shell/open/command`确实指向上述助手目录，再由用户删除该协议注册项及`app`目录。临时模型是否保留由用户自行决定，勿删除其他软件或下载目录。
