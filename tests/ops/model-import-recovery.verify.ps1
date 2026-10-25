$ErrorActionPreference = 'Stop'
$module = Join-Path $PSScriptRoot '..\..\tools\model-handoff\Import.Core.psm1'
Import-Module $module -Force
$root = Join-Path ([IO.Path]::GetTempPath()) ('model-import-recovery-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
  $items = 1..5 | ForEach-Object { [pscustomobject]@{ ItemId = "item-$_"; RelativePath = "model-$_.stl"; State = 'queued' } }
  $manifest = New-ImportManifest (Join-Path $root 'job') -Items $items
  $manifestPath = Join-Path $root 'manifest.json'
  Save-ImportManifest $manifest $manifestPath | Out-Null

  foreach ($phase in @('preparing', 'uploading', 'verifying')) {
    $candidate = Read-ImportManifest $manifestPath
    $candidate.State = 'running'; $candidate.Items[2].State = $phase
    Save-ImportManifest $candidate $manifestPath | Out-Null
    $repaired = Repair-ModelImportJob (Read-ImportManifest $manifestPath)
    if ($repaired.Items[2].State -ne 'queued') { throw "Repair failed for $phase" }
    if ($repaired.Items[0].State -ne 'queued') { throw 'Repair changed an unrelated queued item' }
  }

  $completed = Read-ImportManifest $manifestPath
  $completed.Items[0].State = 'completed'; $completed.Items[1].State = 'completed'; $completed.Items[2].State = 'uploading'
  $completed.State = 'running'; Save-ImportManifest $completed $manifestPath | Out-Null
  $cancelled = Stop-ModelImportJob (Read-ImportManifest $manifestPath)
  if ($cancelled.State -ne 'cancelled') { throw 'Cancel did not mark the job cancelled' }
  if ($cancelled.Items[0].State -ne 'completed' -or $cancelled.Items[1].State -ne 'completed') { throw 'Cancel removed a completed item' }
  if (($cancelled.Items | Where-Object State -eq 'cancelled').Count -ne 3) { throw 'Cancel did not clean all pending items' }
  Write-Output 'PASS: manifest repair resumes interrupted phases and cancellation preserves completed items.'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
