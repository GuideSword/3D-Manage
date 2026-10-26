param(
  [string[]]$ServerNames,
  [string]$MkcertPath,
  [string]$DeploymentDirectory = (Split-Path -Parent $PSScriptRoot),
  [switch]$TrustCurrentUser,
  [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ServerNames) { $ServerNames = @(Read-Host '请输入服务器 IP 或主机名（多个地址用英文逗号分隔）') }
$root = (Resolve-Path -LiteralPath $DeploymentDirectory).Path
$names = @(@($ServerNames | ForEach-Object { $_.Split(',') } | ForEach-Object { $_.Trim() }) + @('localhost', '127.0.0.1', '::1') | Sort-Object -Unique)
foreach ($name in $names) {
  $address = $null
  if (-not $name -or $name.StartsWith('-') -or $name.Contains('*') -or (-not [Net.IPAddress]::TryParse($name, [ref]$address) -and [Uri]::CheckHostName($name) -ne 'Dns')) {
    throw "请输入明确的 IP 或主机名，不包含协议、端口、路径或通配符：$name"
  }
}
$envPath = Join-Path $root '.env'
if ($Apply -and -not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw '未找到现有 .env，请先安装后端。' }
if ($Apply -and -not $TrustCurrentUser) { throw '-Apply 需要同时指定 -TrustCurrentUser，先使本机能验证证书。' }
if ($Apply -and (Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*APP_DOMAIN\s*=\s*[^\s#]+' })) { throw '已有 APP_DOMAIN 公网代理配置，不能与内网直连 TLS 混用。' }

$tlsRoot = Join-Path $root 'runtime/tls'
$caDirectory = Join-Path $tlsRoot 'ca'
$serverDirectory = Join-Path $tlsRoot 'server'
$clientDirectory = Join-Path $tlsRoot 'clients'
foreach ($dir in @($caDirectory, $serverDirectory, $clientDirectory)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
# The CA private key never enters the container or the device distribution directory.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($privateDirectory in @($caDirectory, $serverDirectory)) {
  & icacls.exe $privateDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "无法限制私钥目录权限：$privateDirectory" }
}
$expectedToolHash = 'd2660b50a9ed59eada480750561c96abc2ed4c9a38c6a24d93e30e0977631398'
if (-not $MkcertPath) {
  $toolDirectory = Join-Path $root 'runtime/tools'
  New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
  $MkcertPath = Join-Path $toolDirectory 'mkcert-v1.4.4-windows-amd64.exe'
  if (-not (Test-Path -LiteralPath $MkcertPath -PathType Leaf)) {
    Write-Host '正在从 mkcert 官方 GitHub 下载固定版本工具（仅首次需要）...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-windows-amd64.exe' -OutFile $MkcertPath
  }
}
$MkcertPath = (Resolve-Path -LiteralPath $MkcertPath).Path
if ((Get-FileHash -LiteralPath $MkcertPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedToolHash) { throw 'mkcert 工具校验失败，未执行。请从官方仓库重新获取 v1.4.4 Windows amd64。' }
$caKey = Join-Path $caDirectory 'rootCA-key.pem'
$caCert = Join-Path $caDirectory 'rootCA.pem'
if ((Test-Path -LiteralPath $caKey) -xor (Test-Path -LiteralPath $caCert)) { throw 'CA 文件不完整，拒绝静默更换 CA。请从备份恢复。' }
$manifestPath = Join-Path $tlsRoot 'installation.json'
if ((Test-Path -LiteralPath $manifestPath) -and -not (Test-Path -LiteralPath $caKey)) { throw '已有证书配置但 CA 私钥缺失，请从备份恢复，不能重新生成根信任。' }
$serverCert = Join-Path $serverDirectory 'server.crt'
$serverKey = Join-Path $serverDirectory 'server.key'
$stagedCert = Join-Path $serverDirectory 'next.crt'
$stagedKey = Join-Path $serverDirectory 'next.key'
$priorCaRoot = $env:CAROOT
try {
  $env:CAROOT = $caDirectory
  & $MkcertPath -cert-file $stagedCert -key-file $stagedKey @names
  if ($LASTEXITCODE -ne 0) { throw '内网证书签发失败，未修改后端配置。' }
} finally { $env:CAROOT = $priorCaRoot }
Copy-Item -LiteralPath $stagedCert -Destination $serverCert -Force
Copy-Item -LiteralPath $stagedKey -Destination $serverKey -Force
Remove-Item -LiteralPath $stagedCert, $stagedKey
Copy-Item -LiteralPath $caCert -Destination (Join-Path $serverDirectory 'rootCA.crt') -Force
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCert)
try {
  $publicBytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($publicBytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  [IO.File]::WriteAllBytes((Join-Path $clientDirectory '3d-manage-rootCA.cer'), $publicBytes)
  $thumbprint = $certificate.Thumbprint
} finally { $certificate.Dispose() }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'trust-lan-certificate.ps1') -Destination $clientDirectory -Force
$publicManifest = @{ serverNames = $names; rootCaSha256 = $fingerprint; rootCaThumbprint = $thumbprint }
$publicManifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$fingerprint | Set-Content -LiteralPath (Join-Path $clientDirectory 'ROOT-CA-SHA256.txt') -Encoding UTF8
$trustBat = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0trust-lan-certificate.ps1`" -ExpectedSha256 $fingerprint`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $clientDirectory 'Install-Trust.bat'), $trustBat, [Text.Encoding]::ASCII)
if ($TrustCurrentUser) { & (Join-Path $PSScriptRoot 'trust-lan-certificate.ps1') -CertificatePath (Join-Path $clientDirectory '3d-manage-rootCA.cer') -ExpectedSha256 $fingerprint }

if ($Apply) {
  $oldEnv = [IO.File]::ReadAllText($envPath)
  $newEnv = $oldEnv
  $values = @{ TLS_CERT_FILE = '/app/tls/server.crt'; TLS_KEY_FILE = '/app/tls/server.key'; TLS_CA_FILE = '/app/tls/rootCA.crt' }
  foreach ($key in $values.Keys) {
    if ($newEnv -match "(?m)^$key=.*$") { $newEnv = [regex]::Replace($newEnv, "(?m)^$key=.*$", "$key=$($values[$key])") }
    else { $newEnv = $newEnv.TrimEnd() + "`r`n$key=$($values[$key])`r`n" }
  }
  $backupPath = Join-Path $root ('.env.lan-https-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.local')
  [IO.File]::WriteAllText($backupPath, $oldEnv, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($envPath, $newEnv, [Text.UTF8Encoding]::new($false))
  Write-Host "原配置已备份：$backupPath"
  & docker compose --project-directory $root --env-file $envPath -f (Join-Path $root 'compose.yaml') up -d --build --no-deps --force-recreate app
  if ($LASTEXITCODE -ne 0) { throw "后端更新失败。配置备份：$backupPath；数据卷未删除。请查看 docker compose logs app。" }
  Write-Host '正在等待 HTTPS 容器健康检查...'
  $containerId = (& docker compose --project-directory $root --env-file $envPath -f (Join-Path $root 'compose.yaml') ps -q app | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw '无法确定更新后的 app 容器，请查看 docker compose ps。' }
  $healthy = $false
  $deadline = (Get-Date).AddSeconds(180)
  do {
    $health = (& docker inspect --format '{{.State.Health.Status}}' $containerId | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法读取容器健康状态。' }
    if ($health -eq 'healthy') { $healthy = $true; break }
    if ($health -eq 'unhealthy') { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  if (-not $healthy) { throw "HTTPS 容器未健康，请查看 docker compose logs app。配置备份：$backupPath" }
}
$port = '5800'
if (Test-Path -LiteralPath $envPath) {
  $portLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^APP_PORT=\d+\s*$' } | Select-Object -First 1
  if ($portLine) { $port = ($portLine -split '=', 2)[1].Trim() }
}
Write-Host "根证书 SHA256：$fingerprint"
Write-Host "可分发给设备的目录（不含私钥）：$clientDirectory"
foreach ($name in $names) { if ($name -notmatch ':') { Write-Host "HTTPS API：https://${name}:$port/api" } }
if (-not $Apply) { Write-Host '证书已准备；尚未切换容器。确认后加 -TrustCurrentUser -Apply 执行。' }
