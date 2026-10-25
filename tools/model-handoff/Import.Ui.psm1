Set-StrictMode -Version Latest
function Show-ModelImportWorkbench { param([string]$Root,[int]$Concurrency=2)
 Add-Type -AssemblyName System.Windows.Forms
 $form=New-Object Windows.Forms.Form;$form.Text='模型批量导入';$form.Width=760;$form.Height=520
 $pick=New-Object Windows.Forms.Button;$pick.Text='选择文件夹';$pick.Dock='Top';$list=New-Object Windows.Forms.ListBox;$list.Dock='Fill';$start=New-Object Windows.Forms.Button;$start.Text='开始导入';$start.Dock='Bottom';$cancel=New-Object Windows.Forms.Button;$cancel.Text='取消';$cancel.Dock='Bottom';$form.Controls.Add($list);$form.Controls.Add($cancel);$form.Controls.Add($start);$form.Controls.Add($pick)
 $state=@{Root=$Root;Manifest=$null};$pick.Add_Click({$d=New-Object Windows.Forms.FolderBrowserDialog;if($d.ShowDialog() -eq 'OK'){$state.Root=$d.SelectedPath;$list.Items.Clear();Import-Module (Join-Path $PSScriptRoot 'Import.Core.psm1') -Force;Get-ModelImportFiles $state.Root|ForEach-Object{[void]$list.Items.Add($_.RelativePath)}}});$cancel.Add_Click({if($state.Manifest){Stop-ModelImportJob $state.Manifest|Out-Null}});$start.Add_Click({if(-not $state.Root){return};Import-Module (Join-Path $PSScriptRoot 'Import.Core.psm1') -Force;$fs=@(Get-ModelImportFiles $state.Root);$state.Manifest=New-ImportManifest ([IO.Path]::Combine($state.Root,'.model-import')) -Items @($fs|ForEach-Object{New-ModelImportItem $_});Start-ModelImportJob $state.Manifest -Concurrency $Concurrency|Out-Null});[void]$form.ShowDialog();return $state.Manifest
}
Export-ModuleMember -Function Show-ModelImportWorkbench
