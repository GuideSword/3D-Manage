# 初始化令牌一键获取工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a double-clickable Windows helper that reads `BOOTSTRAP_TOKEN` from the deployment `.env`, displays it, and copies it to the clipboard.

**Architecture:** Keep a thin `获取初始化令牌.bat` entry point and a same-directory `获取初始化令牌.ps1` implementation in the repository root. The batch file invokes the PowerShell script using a path derived from `%~dp0`, so it works when launched by double-click. PowerShell validates `.env`, extracts only the exact `BOOTSTRAP_TOKEN=` setting, displays the token, and uses `Set-Clipboard`; it never writes the token to a file or log.

**Tech Stack:** Windows Batch, Windows PowerShell 5.1+.

---

### Task 1: Add the one-click token helper

**Files:**
- Create: `获取初始化令牌.bat`
- Create: `获取初始化令牌.ps1`
- Test: temporary PowerShell test harness outside the repository; no committed test fixture containing a real token

- [ ] **Step 1: Write the helper entry point**

Create `获取初始化令牌.bat` with `@echo off`, derive `%~dp0`, invoke `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` on `获取初始化令牌.ps1`, and pause before exit. Create the UTF-8 BOM encoded `获取初始化令牌.ps1`; its PowerShell code must:

```powershell
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $args[0]
$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw '未找到 .env 文件，请从部署项目根目录运行此脚本。' }
$line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*BOOTSTRAP_TOKEN\s*=' } | Select-Object -First 1
if (-not $line) { throw '未找到 BOOTSTRAP_TOKEN，请先完成部署配置初始化。' }
$token = ($line -replace '^\s*BOOTSTRAP_TOKEN\s*=\s*', '').Trim()
if ([string]::IsNullOrWhiteSpace($token)) { throw 'BOOTSTRAP_TOKEN 为空，当前配置无效。' }
Set-Clipboard -Value $token
Write-Host ''
Write-Host '部署初始化令牌：' -ForegroundColor Cyan
Write-Host $token
Write-Host ''
Write-Host '令牌已复制到剪贴板。请粘贴到客户端的“部署初始化令牌”输入框。' -ForegroundColor Green
Write-Host '仅用于首次创建 Owner；初始化完成后服务端会拒绝再次使用。' -ForegroundColor Yellow
```

Pass the batch file directory as the first PowerShell argument, use `try/catch` to print a concise Chinese error, and exit with code `1` on failure. Do not add a command that writes the token to a file or clears unrelated clipboard contents.

- [ ] **Step 2: Verify valid configuration without exposing a real secret**

Create a temporary directory, write a temporary `.env` containing `BOOTSTRAP_TOKEN=test-token-only`, run the batch helper from a different working directory, and verify that output contains `test-token-only`, the process exits successfully, and `Get-Clipboard` equals `test-token-only`. Remove the temporary directory after the check.

Expected: PASS; the helper resolves `.env` relative to its own location rather than the caller's working directory.

- [ ] **Step 3: Verify missing and empty configuration failures**

Run the helper against temporary directories with no `.env`, with no `BOOTSTRAP_TOKEN` line, and with `BOOTSTRAP_TOKEN=`. Verify each case prints its corresponding Chinese error and exits with code `1`.

Expected: PASS; no invalid token is copied.

- [ ] **Step 4: Run repository verification**

Run:

```powershell
npm run verify:client
npm run verify:backend
git diff --check
```

Expected: all existing verification commands pass and the diff has no whitespace errors.

- [ ] **Step 5: Review the final diff**

Run `git status --short` and `git diff -- 获取初始化令牌.bat 获取初始化令牌.ps1`. Confirm only the new helper is included in the implementation commit and unrelated existing worktree changes remain untouched.

- [ ] **Step 6: Commit**

```powershell
git add -- '获取初始化令牌.bat' '获取初始化令牌.ps1'
git commit -m "feat: add bootstrap token helper"
```
