$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$output = Join-Path $workspace '.tmp/model-downloads'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$stage = Join-Path $output ('package-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$archive = Join-Path $output 'model-handoff-windows-source.zip'
$sources = @('Install.ps1', 'Open-Model.ps1', 'Handoff.Core.psm1', 'README.md')
try {
    $manifest = @()
    foreach ($name in $sources) {
        $source = Join-Path $workspace ('tools/model-handoff/' + $name)
        Copy-Item -LiteralPath $source -Destination (Join-Path $stage $name)
        $manifest += (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name
    }
    [IO.File]::WriteAllLines((Join-Path $stage 'SHA256SUMS'), [string[]]$manifest, [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive)
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $expected = @($sources + 'SHA256SUMS' | Sort-Object)
        $actual = @($zip.Entries.FullName | Sort-Object)
        if (Compare-Object $expected $actual) { throw 'Package contents did not match the source whitelist' }
    } finally { $zip.Dispose() }
    $sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(($archive + '.sha256'), $sha256 + '  ' + [IO.Path]::GetFileName($archive), [Text.UTF8Encoding]::new($false))
    Write-Output 'Source installer archive built and checked; no installation or protocol registration performed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($stage)
    if ([IO.Path]::GetDirectoryName($resolved) -cne $output -or [IO.Path]::GetFileName($resolved) -notlike 'package-build-*') { throw 'Package cleanup ownership mismatch' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
