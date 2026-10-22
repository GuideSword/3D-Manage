param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$qaBase = Join-Path $projectRoot '.tmp'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $qaBase 'erp-02d3a-files/receiver' }
$targetDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $targetDirectory.StartsWith($qaBase.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Receiver output must stay under this project .tmp directory' }
$javaDirectory = (Get-Content (Join-Path $qaBase 'toolchains/jdk17-install.json') -Raw | ConvertFrom-Json).javaHome
$env:JAVA_HOME = $javaDirectory
$env:PATH = $javaDirectory + '\bin;' + $env:PATH
$sdkDirectory = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$buildTools = Join-Path $sdkDirectory 'build-tools/36.0.0'
$androidJar = Join-Path $sdkDirectory 'platforms/android-36/android.jar'
$sourceDirectory = Join-Path $projectRoot 'tests/fixtures/android-file-receiver'
$classesDirectory = Join-Path $targetDirectory 'classes'
$dexDirectory = Join-Path $targetDirectory 'dex'
New-Item -ItemType Directory -Force -Path @($classesDirectory,$dexDirectory) | Out-Null
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('Receiver build failed: ' + [System.IO.Path]::GetFileName($Executable)) }
}
Invoke-Checked (Join-Path $javaDirectory 'bin/javac.exe') @('-encoding','UTF-8','-source','8','-target','8','-classpath',$androidJar,'-d',$classesDirectory,(Join-Path $sourceDirectory 'FileReceiverActivity.java'),(Join-Path $sourceDirectory 'GestureInstrumentation.java'))
Invoke-Checked (Join-Path $buildTools 'd8.bat') @('--release','--min-api','24','--lib',$androidJar,'--output',$dexDirectory,(Join-Path $classesDirectory 'com/manage3d/filereceiver/qa/FileReceiverActivity.class'),(Join-Path $classesDirectory 'com/manage3d/filereceiver/qa/GestureInstrumentation.class'))
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('link','-I',$androidJar,'--manifest',(Join-Path $sourceDirectory 'AndroidManifest.xml'),'-o',(Join-Path $targetDirectory 'base.apk'))
Invoke-Checked (Join-Path $javaDirectory 'bin/jar.exe') @('uf',(Join-Path $targetDirectory 'base.apk'),'-C',$dexDirectory,'classes.dex')
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-f','4',(Join-Path $targetDirectory 'base.apk'),(Join-Path $targetDirectory 'aligned.apk'))
Invoke-Checked (Join-Path $buildTools 'apksigner.bat') @('sign','--ks',(Join-Path $projectRoot 'android/app/debug.keystore'),'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',(Join-Path $targetDirectory 'receiver.apk'),(Join-Path $targetDirectory 'aligned.apk'))
$permissionOutput = & (Join-Path $buildTools 'aapt.exe') dump permissions (Join-Path $targetDirectory 'receiver.apk')
if ($LASTEXITCODE -ne 0 -or ($permissionOutput -match 'android.permission.INTERNET')) { throw 'Receiver permission verification failed' }
Write-Output 'Local file receiver built without network permission; this script installs nothing.'
