# Windows 本地模型助手发布与网页联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户可以从 GitHub 或 ERP 网页下载 Windows 模型交接助手，并在安装后从网页明确确认打开本地助手。

**Architecture:** 助手继续使用当前 `manage3d-model://` 协议和服务器授权交接流程。GitHub Release 提供版本化压缩包与 SHA-256 校验文件，网页显示同一 Release 下载入口；网页先检查下载/安装状态，无法确认时提供下载，用户安装后再发起协议打开。安装器只注册当前用户协议，不修改模型文件关联，也不自动启动 Bambu Studio。

**Tech Stack:** PowerShell 5/7、Windows Registry、Expo React Native Web、React Native Linking、GitHub Releases、Node test。

---

### Task 1：建立助手发布清单和安装包入口

**Files:**
- Create: `tools/model-handoff/release-manifest.json`
- Modify: `tools/model-handoff/README.md`
- Create: `tools/model-handoff/package-release.ps1`
- Test: `tests/ops/model-handoff-package.verify.ps1`

- [x] 定义版本、资产名、下载 URL、SHA-256 URL 和支持平台。
- [x] 打包脚本只允许助手白名单文件进入 ZIP，并生成 `SHA256SUMS`。
- [x] README 写清楚网页下载、Windows 安装确认和版本校验。
- [x] 验证 ZIP 白名单、清单字段、哈希可复现，禁止把密钥、运行数据或模型文件打包。

### Task 2：网页提供下载与安装状态提示

**Files:**
- Modify: `components/ModelDownloadDialog.js`
- Create: `components/ModelHandoffInstallCard.js`
- Test: `tests/client/model-handoff-install.test.cjs`

- [x] 在 Bambu Studio 交接对话框中显示助手版本和“下载助手”链接。
- [x] 下载链接指向固定 GitHub Release 资产，用户可在不阻塞当前页面的情况下下载。
- [x] 显示安装动作的边界：下载完成后需用户打开安装包并确认 Windows 权限。
- [x] 安装后提供“打开本地助手”操作，协议失败时回到下载说明。
- [x] 保持模型密码、同意提示和一次性交接令牌流程不变。

### Task 3：网页联动和协议打开

**Files:**
- Modify: `components/ModelDownloadDialog.js`
- Modify: `tools/model-handoff/Open-Model.ps1`
- Modify: `tools/model-handoff/Install.ps1`
- Test: `tests/ops/model-handoff.verify.ps1`

- [ ] 安装时写入版本信息，注册协议命令固定指向安装目录。
- [ ] 网页调用协议时只传服务器地址和一次性交接 ticket，不传密码。
- [ ] 打开动作显示等待状态，协议不可用时给出“重新下载/检查安装”的明确提示。
- [ ] 保证取消、重复点击、非 HTTPS、服务器身份变化和错误 ticket 都不会启动 Studio。

### Task 4：文档、隔离验证和交付

**Files:**
- Modify: `docs/superpowers/plans/2026-09-29-erp-priority-plan.md`
- Create: `docs/rehearsals/2026-10-22-model-handoff-installer.md`
- Modify: `README.md`

- [x] 生成本地 Release ZIP 和 SHA256SUMS。
- [x] 运行助手 PowerShell 验证、客户端契约测试和 Web 导出。
- [x] 用 Edge 验证下载提示、取消和协议失败回退，不自动打开 Bambu Studio。
- [x] 记录安装包校验值、验证范围和待用户确认的真实安装步骤。
- [x] 提交独立 Git 分支和 PR，合并前不更新正式 Docker。

