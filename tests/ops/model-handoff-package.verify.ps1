param([string]$PackageDirectory = (Join-Path $PSScriptRoot '../../.tmp/model-handoff-release'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$manifest = Get-Content (Join-Path $PSScriptRoot '../../tools/model-handoff/release-manifest.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $PackageDirectory $manifest.asset
$sumPath = Join-Path $PackageDirectory $manifest.checksumAsset
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "Missing package: $zipPath" }
if (-not (Test-Path -LiteralPath $sumPath -PathType Leaf)) { throw "Missing checksum file: $sumPath" }
$expected = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$actual = ((Get-Content -LiteralPath $sumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($expected -ne $actual) { throw "Checksum mismatch: expected $expected, got $actual" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $allowed = @('Install.ps1', 'Open-Model.ps1', 'Verify-Checksum.ps1', 'Handoff.Core.psm1', 'README.md', 'release-manifest.json')
  $entries = @($archive.Entries | ForEach-Object FullName | Sort-Object)
  if (-not (@($entries | Where-Object { $_ -notin $allowed }).Count -eq 0)) { throw "Package contains an unexpected file: $($entries -join ', ')" }
  if (@($entries).Count -ne $allowed.Count) { throw "Package entry count mismatch: $($entries -join ', ')" }
} finally { $archive.Dispose() }
Write-Output "PASS package=$($manifest.version) files=$($entries.Count) sha256=$actual"
