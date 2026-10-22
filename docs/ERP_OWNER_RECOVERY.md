# 从部署主机恢复 Owner

关系模式下，部署主机管理员可以为**已有 Owner**设置新密码。恢复会注销该账号的全部旧登录会话；停用的 Owner 会重新启用，其他账号保持不变。恢复不会创建账号、提升 Staff/Viewer 或修改邮箱。

当前正式服务仍使用旧 JSONB 存储。本说明的关系恢复命令仅供已完成关系切换的部署使用；本轮只在隔离库验收。

## 关系模式操作顺序

在项目根目录运行。数据库连接放在部署主机已有的环境变量中，下例用 `ERP_RECOVERY_DATABASE_URL` 指向明确的目标库；不要把连接或密码写进文档、Git 或命令参数。`服务器ID` 和 `OwnerID` 使用当前部署的真实标识。

1. 用只读命令确认目标和账号版本：

   ```powershell
   node backend/scripts/erp-owner-recovery.js status --target-env ERP_RECOVERY_DATABASE_URL --server-id 服务器ID --user-id OwnerID
   node backend/scripts/erp-maintenance.js status --target-env ERP_RECOVERY_DATABASE_URL --server-id 服务器ID
   ```

   两个返回的 `version` 含义不同：第一个 `user.version` 是账号版本，第二个是维护状态版本。先核对 serverId 和账号信息。

2. 如果当前状态是 `open`，使用刚读到的维护版本进入维护：

   ```powershell
   node backend/scripts/erp-maintenance.js enter --target-env ERP_RECOVERY_DATABASE_URL --server-id 服务器ID --expected-version 维护版本 --reason "Owner 无法登录，主机恢复"
   ```

   状态已是 `maintenance` 时保留现状。恢复本身不会自动开放业务；维护期间原有会话可以读取，登录和业务保存暂停。

3. 隐藏输入新密码，并使用最新的账号版本执行恢复。密码至少 12 个字符、不超过 72 个 UTF-8 字节：

   ```powershell
   $erpRecoverySecure = Read-Host '输入新的 Owner 密码' -AsSecureString
   $erpRecoveryPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($erpRecoverySecure)
   try {
     $env:ERP_OWNER_NEW_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($erpRecoveryPointer)
     node backend/scripts/erp-owner-recovery.js reset --target-env ERP_RECOVERY_DATABASE_URL --server-id 服务器ID --user-id OwnerID --expected-version 账号版本 --reason "Owner 无法登录，主机恢复" --password-env ERP_OWNER_NEW_PASSWORD
     if ($LASTEXITCODE -ne 0) { throw '恢复未成功，请检查输出并重新读取账号状态' }
   } finally {
     Remove-Item Env:ERP_OWNER_NEW_PASSWORD -ErrorAction SilentlyContinue
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($erpRecoveryPointer)
     $erpRecoverySecure.Dispose()
   }
   ```

   成功输出只有公开账号信息和 `sessionsRevoked:true`。密码、密码哈希不进入输出或审计。版本冲突时重新读取并核对，不能重复使用旧版本覆盖新修改；审计失败时整次恢复回滚。

4. 核对恢复结果。确认该次维护可以结束后，重新读取维护版本，再退出：

   ```powershell
   node backend/scripts/erp-maintenance.js status --target-env ERP_RECOVERY_DATABASE_URL --server-id 服务器ID
   node backend/scripts/erp-maintenance.js leave --target-env ERP_RECOVERY_DATABASE_URL --server-id 服务器ID --expected-version 最新维护版本 --reason "Owner 恢复完成并核对"
   ```

   Owner 随后用原邮箱、新密码重新登录。旧密码和旧会话失效。如果服务器原本因其他任务处于维护中，继续保持维护，交由该任务的操作人按原流程结束。

## 文件和旧 JSONB 模式

沿用原部署环境中的交互式 `backend/scripts/reset-owner-password.js OWNER_ID`。此旧命令现在先只读核对 PG 模式；发现关系模式或无法确认结构时停止，并指向新命令。两套命令都不会自动迁移数据库。

关系维护屏障只控制关系业务写入；包含聊天 SQLite 和附件的完整备份仍须按停机备份流程执行。
