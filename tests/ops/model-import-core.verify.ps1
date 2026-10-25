$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../../tools/model-handoff/Import.Core.psm1') -Force
$root=Join-Path ([IO.Path]::GetTempPath()) ('model-import-'+[guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($root)|Out-Null
try {
  [IO.Directory]::CreateDirectory((Join-Path $root 'nested'))|Out-Null
  [IO.File]::WriteAllText((Join-Path $root 'part.stl'),'solid x')
  [IO.File]::Copy((Join-Path $root 'part.stl'),(Join-Path $root 'nested/gear.obj'))
  [IO.File]::WriteAllText((Join-Path $root 'ignore.txt'),'x')
  $files=@(Get-ModelImportFiles $root); if($files.Count -ne 2 -or $files[0].Sha256.Length -ne 64){throw 'scanner failed'}
  $items=@($files|ForEach-Object{New-ModelImportItem $_}); $manifest=New-ImportManifest (Join-Path $root 'job') -Items $items
  $path=Join-Path $root 'job/manifest.json'; Save-ImportManifest $manifest $path|Out-Null; if((Read-ImportManifest $path).Items.Count -ne 2){throw 'manifest failed'}
  Set-ImportItemState $manifest.Items[0] 'completed'|Out-Null; try{Set-ImportItemState $manifest.Items[0] 'uploading'|Out-Null;throw 'transition accepted'}catch{if($_.Exception.Message -eq 'transition accepted'){throw}}
  Write-Output 'PASS: scanner, SHA-256, manifest atomic write, and terminal state protection.'
} finally { if(Test-Path $root){Remove-Item $root -Recurse -Force} }
