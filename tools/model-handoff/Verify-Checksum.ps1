param(
  [string]$ArchivePath,
  [string]$ChecksumFile = (Join-Path $PSScriptRoot 'SHA256SUMS')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ArchivePath) {
  $ArchivePath = Read-Host '请输入 ZIP 安装包的完整路径（可直接拖入此窗口）'
}
$ArchivePath = $ArchivePath.Trim().Trim('"')
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw "找不到安装包：$ArchivePath"
}

$actual = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = $null
if (Test-Path -LiteralPath $ChecksumFile -PathType Leaf) {
  $archiveName = [IO.Path]::GetFileName($ArchivePath)
  $line = Get-Content -LiteralPath $ChecksumFile | Where-Object { $_ -match [regex]::Escape($archiveName) } | Select-Object -First 1
  if ($line) { $expected = (($line -split '\s+')[0]).ToLowerInvariant() }
}

Write-Output "文件：$([IO.Path]::GetFileName($ArchivePath))"
Write-Output "SHA-256：$actual"
if ($expected) {
  if ($actual -eq $expected) {
    Write-Output '结果：校验通过，可以继续安装。'
    exit 0
  }
  Write-Output "发布值：$expected"
  throw '结果：校验失败，请删除安装包并重新下载。'
}
Write-Output '未找到对应的 SHA256SUMS；请将网页下载的 SHA256SUMS 放到本脚本同目录，或手工比较上面的值。'
