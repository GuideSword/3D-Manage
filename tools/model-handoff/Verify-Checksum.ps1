param(
  [string]$ArchivePath,
  [string]$ChecksumFile = (Join-Path $PSScriptRoot 'SHA256SUMS'),
  [switch]$NoPause
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$interactive = [string]::IsNullOrWhiteSpace($ArchivePath) -and -not $NoPause
$resultCode = 0
try {
  if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    $ArchivePath = Read-Host '请输入 ZIP 安装包的完整路径（可直接拖入此窗口）'
  }
  $ArchivePath = $ArchivePath.Trim().Trim('"').Trim("'")
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
    if ($actual -ne $expected) {
      Write-Output "发布值：$expected"
      throw '结果：校验失败，请删除安装包并重新下载。'
    }
    Write-Output '结果：校验通过，可以继续安装。'
  } else {
    Write-Output '尚未验证：未找到对应的 SHA256SUMS。请将网页下载的 SHA256SUMS 放到本脚本同目录，再次校验；或手工比较上面的值。'
    $resultCode = 2
  }
} catch {
  Write-Output "错误：$($_.Exception.Message)"
  $resultCode = 1
} finally {
  if ($interactive) {
    Write-Output '按回车关闭窗口。'
    Read-Host | Out-Null
  }
}
exit $resultCode
