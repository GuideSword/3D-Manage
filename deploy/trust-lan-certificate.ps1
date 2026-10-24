param(
  [string]$CertificatePath = (Join-Path $PSScriptRoot '3d-manage-rootCA.cer'),
  [Parameter(Mandatory = $true)][string]$ExpectedSha256
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath $CertificatePath).Path)
try {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($cert.RawData))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $fingerprint -ne $ExpectedSha256.ToLowerInvariant()) { throw '根证书指纹不一致，未安装信任。请向管理员核实。' }
  if ($cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { throw '根证书不在有效期内，未安装信任。' }
  Write-Host "安装当前用户根证书信任：$($cert.Subject)"
  Write-Host "SHA256: $fingerprint"
  Write-Host "Windows 确认窗口显示的 SHA1: $($cert.Thumbprint)"
  Write-Host '若弹出 Windows 根证书安全警告，请核对名称和上述 SHA1 后确认。'
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
  try {
    $store.Open('ReadWrite')
    if ($store.Certificates.Find('FindByThumbprint', $cert.Thumbprint, $false).Count -eq 0) { $store.Add($cert) }
    else { Write-Host '当前用户已经信任此证书，无需重复安装。' }
  } finally { $store.Close(); $store.Dispose() }
  Write-Host '信任已安装到当前 Windows 用户。请重新打开浏览器，再使用 HTTPS 服务器地址。'
} finally { $cert.Dispose() }
