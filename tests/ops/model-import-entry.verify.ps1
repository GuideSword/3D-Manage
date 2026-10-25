$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '../../tools/model-handoff/Import-Models.ps1'
$previous = $env:MODEL_IMPORT_HEADLESS
$env:MODEL_IMPORT_HEADLESS = '1'
try {
  $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $script 2>&1 | Out-String
  if ($LASTEXITCODE -ne 1) { throw "Direct launch should exit 1, got $LASTEXITCODE" }
  if ($output -match 'serverUrl|ParentContainsErrorRecordException') { throw "Direct launch exposed raw startup error: $output" }
  if ($output -notmatch '请从 3D-Manage 模型库点击') { throw "Direct launch guidance missing: $output" }
  Write-Output 'PASS: direct double-click entry reports actionable guidance instead of flashing raw error.'
} finally {
  if ($null -eq $previous) { Remove-Item Env:MODEL_IMPORT_HEADLESS -ErrorAction SilentlyContinue }
  else { $env:MODEL_IMPORT_HEADLESS = $previous }
}
