param([Parameter(Mandatory=$true)][string]$Uri)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($args.Count -gt 0) { throw '只允许传入一个协议地址' }
$root=$PSScriptRoot
$configPath=Join-Path $env:LOCALAPPDATA '3DManageModelHandoff/app/config.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw '助手尚未安装或缺少绑定配置' }
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$u=[Uri]$Uri
if ($u.Scheme -cne 'manage3d-model' -or $u.Host -notin @('open','import') -or $u.UserInfo -or $u.Fragment) { throw '模型助手协议地址无效' }
if ($u.Host -eq 'open') { & (Join-Path $root 'Open-Model.ps1') -Uri $Uri; exit $LASTEXITCODE }
& (Join-Path $root 'Import-Models.ps1') -Uri $Uri -Config $config
