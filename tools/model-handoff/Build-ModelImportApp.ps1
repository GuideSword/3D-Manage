param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../.tmp/model-import-app')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue)) {
  throw '缺少 ps2exe 构建模块。请先执行：Install-Module ps2exe -Scope CurrentUser'
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$exe = Join-Path $output 'model-import.exe'
$embed = @{}
foreach ($name in @('Open-Model.ps1','Import-Models.ps1','Handoff.Core.psm1','Import.Core.psm1','Import.Ui.psm1')) {
  $embed[('.\' + $name)] = Join-Path $PSScriptRoot $name
}

Invoke-ps2exe -inputFile (Join-Path $PSScriptRoot 'Dispatch-ModelHandoff.ps1') -outputFile $exe -x64 -STA -noConsole -winFormsDPIAware -supportOS -title 'model-import' -description '3D-Manage Windows model importer' -company '3D-Manage' -product 'model-import' -version '1.1.0.0' -embedFiles $embed
Write-Output "Created $exe"
