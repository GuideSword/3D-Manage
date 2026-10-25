param(
  [string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$manifest = Get-Content (Join-Path $PSScriptRoot 'release-manifest.json') -Raw | ConvertFrom-Json
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $root '.tmp/model-handoff-release' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$stage = Join-Path $output 'stage'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$appBuild = Join-Path $output 'app-build'
& (Join-Path $PSScriptRoot 'Build-ModelImportApp.ps1') -OutputDirectory $appBuild
$appBinary = Join-Path $appBuild 'model-import.exe'
if (-not (Test-Path -LiteralPath $appBinary -PathType Leaf)) { throw 'model-import.exe 构建失败' }
$files = @('Install.ps1','Dispatch-ModelHandoff.ps1','Import-Models.ps1','Open-Model.ps1','Verify-Checksum.ps1','Handoff.Core.psm1','Import.Core.psm1','Import.Ui.psm1','README.md','release-manifest.json')
foreach ($name in $files) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage $name)
}
Copy-Item -LiteralPath $appBinary -Destination (Join-Path $stage 'model-import.exe')
$zip = Join-Path $output $manifest.asset
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($manifest.asset)" | Set-Content -LiteralPath (Join-Path $output $manifest.checksumAsset) -Encoding utf8
Write-Output "Created $zip"
Write-Output "SHA256 $hash"
