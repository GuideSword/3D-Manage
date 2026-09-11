$ErrorActionPreference = 'Stop'

try {
  $root = Split-Path -Parent $MyInvocation.MyCommand.Path
  $envFile = Join-Path $root '.env'

  if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw '未找到 .env 文件，请从部署项目根目录运行此脚本。'
  }

  $line = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match '^\s*BOOTSTRAP_TOKEN\s*=' } |
    Select-Object -First 1

  if (-not $line) {
    throw '未找到 BOOTSTRAP_TOKEN，请先完成部署配置初始化。'
  }

  $token = ($line -replace '^\s*BOOTSTRAP_TOKEN\s*=\s*', '').Trim()
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'BOOTSTRAP_TOKEN 为空，当前配置无效。'
  }

  $clipboardError = $null
  try {
    Set-Clipboard -Value $token
  } catch {
    $clipboardError = $_.Exception.Message
  }

  Write-Host ''
  Write-Host '部署初始化令牌：' -ForegroundColor Cyan
  Write-Host $token
  Write-Host ''

  if ($clipboardError) {
    Write-Host ('自动复制到剪贴板失败：' + $clipboardError) -ForegroundColor Red
    Write-Host '请手动复制上面的令牌。' -ForegroundColor Yellow
    exit 1
  }

  Write-Host '令牌已复制到剪贴板。请粘贴到客户端的“部署初始化令牌”输入框。' -ForegroundColor Green
  Write-Host '仅用于首次创建 Owner；初始化完成后服务端会拒绝再次使用。' -ForegroundColor Yellow
} catch {
  Write-Host ('错误：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
