Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Extensions = @('.stl', '.obj', '.3mf', '.step', '.stp')

function Get-ModelImportFiles {
    param([Parameter(Mandatory)][string]$Root, [string[]]$Extensions = $script:Extensions)
    $base = [IO.Path]::GetFullPath($Root)
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { throw '模型目录不存在' }
    $wanted = @($Extensions | ForEach-Object { ([string]$_).ToLowerInvariant() })
    Get-ChildItem -LiteralPath $base -File -Recurse -Force | Where-Object {
        (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) -and ($wanted -contains $_.Extension.ToLowerInvariant())
    } | ForEach-Object {
        [pscustomobject]@{ Path = $_.FullName; RelativePath = [IO.Path]::GetRelativePath($base, $_.FullName).Replace('\', '/'); Name = $_.Name; Size = $_.Length; Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
}

function Expand-SafeModelArchive {
    param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)][string]$Destination, [long]$MaxBytes = 524288000, [int]$MaxEntries = 10000)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $dest = [IO.Path]::GetFullPath($Destination); [IO.Directory]::CreateDirectory($dest) | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive)); $count = 0; $total = 0L; $result = @()
    try { foreach ($entry in $zip.Entries) {
        if (++$count -gt $MaxEntries) { throw '压缩包条目数量超出限制' }
        $name = ([string]$entry.FullName).Replace('\', '/'); if ([string]::IsNullOrWhiteSpace($name) -or $name.EndsWith('/')) { continue }
        if ([IO.Path]::IsPathRooted($name) -or $name -match '(^|/)\.\.?(/|$)') { throw '压缩包包含不安全路径' }
        $target = [IO.Path]::GetFullPath((Join-Path $dest $name)); if (-not $target.StartsWith($dest.TrimEnd('\') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '压缩包包含不安全路径' }
        $total += [long]$entry.Length; if ($total -gt $MaxBytes) { throw '压缩包解压大小超出限制' }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false); $result += $target
    } } finally { $zip.Dispose() }; $result
}

function Get-ModelImportFacts { param([Parameter(Mandatory)]$File) [pscustomobject]@{ Name = [string]$File.Name; Extension = [IO.Path]::GetExtension([string]$File.Name).ToLowerInvariant(); Size = [long]$File.Size; RelativePath = [string]$File.RelativePath } }
function New-ModelImportItem { param([Parameter(Mandatory)]$File) [pscustomobject]@{ ItemId = ([guid]::NewGuid().ToString('N')); RelativePath = ([string]$File.RelativePath).Replace('\', '/'); OriginalName = [string]$File.Name; Size = [long]$File.Size; Sha256 = [string]$File.Sha256; State = 'discovered'; DescriptionFacts = (Get-ModelImportFacts $File) } }
function New-ImportManifest { param([Parameter(Mandatory)][string]$Directory, [string]$JobId = ([guid]::NewGuid().ToString('N')), [object[]]$Items = @()) [IO.Directory]::CreateDirectory($Directory) | Out-Null; [pscustomobject]@{ JobId = $JobId; State = 'draft'; Items = @($Items); UpdatedAt = [DateTime]::UtcNow.ToString('o') } }
function Save-ImportManifest { param([Parameter(Mandatory)]$Manifest, [Parameter(Mandatory)][string]$Path) $tmp = $Path + '.tmp'; $bak = $Path + '.bak'; $stream = [IO.File]::Open($tmp, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None); try { $bytes = [Text.Encoding]::UTF8.GetBytes(($Manifest | ConvertTo-Json -Depth 20)); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }; if (Test-Path -LiteralPath $Path) { Copy-Item -LiteralPath $Path -Destination $bak -Force }; Move-Item -LiteralPath $tmp -Destination $Path -Force; $Manifest }
function Read-ImportManifest { param([Parameter(Mandatory)][string]$Path) if (-not (Test-Path -LiteralPath $Path)) { throw '导入清单不存在' }; Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
function Set-ImportJobState { param([Parameter(Mandatory)]$Manifest, [Parameter(Mandatory)][string]$State) if ([string]$Manifest.State -in @('cancelled', 'completed', 'completed_with_errors') -and $State -ne [string]$Manifest.State) { throw '任务状态不可回退' }; $Manifest.State = $State; $Manifest.UpdatedAt = [DateTime]::UtcNow.ToString('o'); $Manifest }
function Set-ImportItemState { param([Parameter(Mandatory)]$Item, [Parameter(Mandatory)][string]$State) if ([string]$Item.State -in @('completed', 'duplicate', 'cancelled', 'cleaned') -and $State -ne [string]$Item.State) { throw '项目状态不可回退' }; $Item.State = $State; $Item }

function Start-ModelImportJob {
    param([Parameter(Mandatory)]$Manifest, [scriptblock]$Prepare, [scriptblock]$Upload, [int]$Concurrency = 2, [string]$ManifestPath)
    $Concurrency = [Math]::Max(1, [Math]::Min(4, $Concurrency)); $Manifest.State = 'running'; if ($ManifestPath) { Save-ImportManifest $Manifest $ManifestPath | Out-Null }
    foreach ($item in @($Manifest.Items)) {
        if ($item.State -in @('completed', 'duplicate', 'cleaned')) { continue }
        if ($Manifest.State -eq 'cancelling' -or $Manifest.State -eq 'cancelled') { $item.State = 'cancelled'; continue }
        try {
            $item.State = 'preparing'; if ($ManifestPath) { Save-ImportManifest $Manifest $ManifestPath | Out-Null }; if ($Prepare) { & $Prepare $item | Out-Null }
            if ($Manifest.State -eq 'cancelling' -or $Manifest.State -eq 'cancelled') { $item.State = 'cancelled'; continue }
            $item.State = 'uploading'; if ($ManifestPath) { Save-ImportManifest $Manifest $ManifestPath | Out-Null }; if ($Upload) { & $Upload $item | Out-Null }
            $item.State = 'completed'
        } catch { $item.Error = $_.Exception.Message; $item.State = 'failed' }
        if ($ManifestPath) { Save-ImportManifest $Manifest $ManifestPath | Out-Null }
    }
    if ($Manifest.State -ne 'cancelled') { $Manifest.State = if (@($Manifest.Items | Where-Object State -eq 'failed').Count) { 'completed_with_errors' } else { 'completed' } }; if ($ManifestPath) { Save-ImportManifest $Manifest $ManifestPath | Out-Null }; $Manifest
}
function Stop-ModelImportJob { param([Parameter(Mandatory)]$Manifest) $Manifest.State = 'cancelling'; foreach ($item in @($Manifest.Items)) { if ($item.State -notin @('completed', 'duplicate', 'failed')) { $item.State = 'cancelled' } }; $Manifest.State = 'cancelled'; $Manifest }
function Resume-ModelImportJob { param([Parameter(Mandatory)]$Manifest, [scriptblock]$Prepare, [scriptblock]$Upload, [int]$Concurrency = 2, [string]$ManifestPath) Start-ModelImportJob $Manifest $Prepare $Upload $Concurrency $ManifestPath }
function Repair-ModelImportJob { param([Parameter(Mandatory)]$Manifest) foreach ($item in @($Manifest.Items)) { if ($item.State -in @('preparing', 'uploading', 'verifying')) { $item.State = 'queued' } }; if ($Manifest.State -in @('running', 'cancelling', 'recovery_required')) { $Manifest.State = 'draft' }; $Manifest }
Export-ModuleMember -Function Get-ModelImportFiles, Expand-SafeModelArchive, Get-ModelImportFacts, New-ModelImportItem, New-ImportManifest, Save-ImportManifest, Read-ImportManifest, Set-ImportJobState, Set-ImportItemState, Start-ModelImportJob, Stop-ModelImportJob, Resume-ModelImportJob, Repair-ModelImportJob
