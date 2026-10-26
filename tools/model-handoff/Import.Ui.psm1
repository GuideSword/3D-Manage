Set-StrictMode -Version Latest

function New-UiLabel {
    param([string]$Text, [int]$Left, [int]$Top, [int]$Width = 120)
    $label = [Windows.Forms.Label]::new()
    $label.Text = $Text
    $label.Left = $Left
    $label.Top = $Top
    $label.Width = $Width
    $label.AutoSize = $false
    return $label
}

function Show-StandaloneImportSetup {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = [Windows.Forms.Form]::new()
    $form.Text = 'model-import'; $form.StartPosition = 'CenterScreen'; $form.Width = 660; $form.Height = 520
    $form.MinimumSize = [Drawing.Size]::new(660, 520); $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false
    $title = [Windows.Forms.Label]::new(); $title.Text = '批量导入模型'; $title.Font = [Drawing.Font]::new('Microsoft YaHei UI', 16, [Drawing.FontStyle]::Bold); $title.Left = 28; $title.Top = 20; $title.Width = 560; $form.Controls.Add($title)
    $hint = New-UiLabel '连接 3D-Manage 后扫描本地模型文件夹，并自动创建导入任务。' 30 55 580; $hint.ForeColor = [Drawing.Color]::DimGray; $form.Controls.Add($hint)
    $form.Controls.Add((New-UiLabel '登录邮箱' 30 92 100)); $email = [Windows.Forms.TextBox]::new(); $email.Left = 140; $email.Top = 88; $email.Width = 470; $form.Controls.Add($email)
    $form.Controls.Add((New-UiLabel '登录密码' 30 130 100)); $password = [Windows.Forms.TextBox]::new(); $password.Left = 140; $password.Top = 126; $password.Width = 470; $password.UseSystemPasswordChar = $true; $form.Controls.Add($password)
    $form.Controls.Add((New-UiLabel '模型目录' 30 168 100)); $folder = [Windows.Forms.TextBox]::new(); $folder.Left = 140; $folder.Top = 164; $folder.Width = 370; $folder.ReadOnly = $true; $form.Controls.Add($folder)
    $browse = [Windows.Forms.Button]::new(); $browse.Text = '选择文件夹…'; $browse.Left = 520; $browse.Top = 162; $browse.Width = 90; $form.Controls.Add($browse)
    $form.Controls.Add((New-UiLabel '扫描格式' 30 208 100))
    $formats = [Windows.Forms.CheckedListBox]::new(); $formats.Left = 140; $formats.Top = 204; $formats.Width = 470; $formats.Height = 120; $formats.CheckOnClick = $true
    @('STL（3D 打印模型）','OBJ（通用网格模型）','3MF（3D 打印工程）','STEP / STP（CAD 模型）') | ForEach-Object { [void]$formats.Items.Add($_, $true) }
    $formats.Tag = @(@('.stl'), @('.obj'), @('.3mf'), @('.step', '.stp')); $form.Controls.Add($formats)
    $form.Controls.Add((New-UiLabel '并发传输' 30 344 100)); $concurrency = [Windows.Forms.NumericUpDown]::new(); $concurrency.Left = 140; $concurrency.Top = 340; $concurrency.Width = 80; $concurrency.Minimum = 1; $concurrency.Maximum = 4; $concurrency.Value = 2; $form.Controls.Add($concurrency)
    $concurrencyHint = New-UiLabel '同时上传的模型数量（资源紧张时建议设为 1）' 235 344 375; $concurrencyHint.ForeColor = [Drawing.Color]::DimGray; $form.Controls.Add($concurrencyHint)
    $status = New-UiLabel '' 30 385 580; $status.ForeColor = [Drawing.Color]::Firebrick; $form.Controls.Add($status)
    $ok = [Windows.Forms.Button]::new(); $ok.Text = '开始扫描并导入'; $ok.Left = 390; $ok.Top = 425; $ok.Width = 140; $ok.DialogResult = [Windows.Forms.DialogResult]::None; $form.Controls.Add($ok)
    $cancel = [Windows.Forms.Button]::new(); $cancel.Text = '取消'; $cancel.Left = 540; $cancel.Top = 425; $cancel.Width = 70; $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel; $form.Controls.Add($cancel); $form.AcceptButton = $ok; $form.CancelButton = $cancel
    $state = [ordered]@{ Cancelled = $true; Root = $null; Email = $null; Password = $null; Concurrency = 2; Extensions = @() }
    $browse.Add_Click({ $dialog = [Windows.Forms.FolderBrowserDialog]::new(); try { $dialog.Description = '请选择需要扫描的模型文件夹'; if ($dialog.ShowDialog($form) -eq [Windows.Forms.DialogResult]::OK) { $folder.Text = $dialog.SelectedPath } } finally { $dialog.Dispose() } })
    $ok.Add_Click({
        $status.Text = ''
        if ([string]::IsNullOrWhiteSpace($email.Text) -or $email.Text -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { $status.Text = '请输入有效的登录邮箱。'; return }
        if ([string]::IsNullOrWhiteSpace($password.Text)) { $status.Text = '请输入登录密码。'; return }
        if ([string]::IsNullOrWhiteSpace($folder.Text) -or -not (Test-Path -LiteralPath $folder.Text -PathType Container)) { $status.Text = '请选择存在的模型文件夹。'; return }
        $selected = @(); for ($i = 0; $i -lt $formats.Items.Count; $i++) { if ($formats.GetItemChecked($i)) { $selected += @($formats.Tag[$i]) } }
        if ($selected.Count -eq 0) { $status.Text = '请至少选择一种模型格式。'; return }
        $state.Cancelled = $false; $state.Root = $folder.Text; $state.Email = $email.Text.Trim(); $state.Password = $password.Text; $state.Concurrency = [int]$concurrency.Value; $state.Extensions = @($selected | ForEach-Object { $_ } | Select-Object -Unique); $form.Close()
    })
    $cancel.Add_Click({ $state.Cancelled = $true; $form.Close() })
    [void]$form.ShowDialog(); $form.Dispose(); return [pscustomobject]$state
}

function Show-ModelImportWorkbench {
    param([string]$Root, [int]$Concurrency = 2, [string[]]$Extensions = @('.stl', '.obj', '.3mf', '.step', '.stp'), [scriptblock]$Prepare, [scriptblock]$Upload, [string]$ManifestPath, [object]$Context)
    Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; Import-Module (Join-Path $PSScriptRoot 'Import.Core.psm1') -Force
    $form = [Windows.Forms.Form]::new(); $form.Text = 'model-import · 导入进度'; $form.StartPosition = 'CenterScreen'; $form.Width = 800; $form.Height = 560; $form.MinimumSize = [Drawing.Size]::new(800, 560)
    $title = [Windows.Forms.Label]::new(); $title.Text = '正在导入模型'; $title.Font = [Drawing.Font]::new('Microsoft YaHei UI', 15, [Drawing.FontStyle]::Bold); $title.Left = 24; $title.Top = 18; $title.Width = 700; $form.Controls.Add($title)
    $path = New-UiLabel ('目录：' + $Root) 25 52 735; $path.ForeColor = [Drawing.Color]::DimGray; $form.Controls.Add($path)
    $list = [Windows.Forms.ListView]::new(); $list.Left = 24; $list.Top = 84; $list.Width = 735; $list.Height = 350; $list.View = [Windows.Forms.View]::Details; $list.FullRowSelect = $true; [void]$list.Columns.Add('文件名', 300); [void]$list.Columns.Add('大小', 100); [void]$list.Columns.Add('状态', 130); [void]$list.Columns.Add('说明', 180); $form.Controls.Add($list)
    $status = New-UiLabel '准备扫描…' 25 450 735; $form.Controls.Add($status); $cancel = [Windows.Forms.Button]::new(); $cancel.Text = '取消任务'; $cancel.Left = 650; $cancel.Top = 480; $cancel.Width = 110; $form.Controls.Add($cancel)
    $state = @{ Root = $Root; Manifest = $null; Cancelled = $false }
    $cancel.Add_Click({ if ($state.Manifest -and [Windows.Forms.MessageBox]::Show('当前传输会被中断，未完成的缓存和空记录会清理；已完成模型会保留。确认取消任务？', '确认取消任务', 'YesNo', 'Warning') -eq 'Yes') { Stop-ModelImportJob $state.Manifest | Out-Null; $state.Cancelled = $true; $cancel.Enabled = $false; $status.Text = '任务已取消，正在清理未完成记录…' } })
    $form.Add_Shown({
        try {
            $files = @(Get-ModelImportFiles -Root $state.Root -Extensions $Extensions)
            if ($files.Count -eq 0) { $status.Text = '没有找到所选格式的模型文件。'; return }
            foreach ($file in $files) { $row = [Windows.Forms.ListViewItem]::new($file.RelativePath); [void]$row.SubItems.Add(('{0:N0} KB' -f ([double]$file.Size / 1KB))); [void]$row.SubItems.Add('待导入'); [void]$row.SubItems.Add('等待服务器分析模型特征'); [void]$list.Items.Add($row) }
            $items = @($files | ForEach-Object { $item = New-ModelImportItem $_; Add-Member -InputObject $item -NotePropertyName SourcePath -NotePropertyValue $state.Root -Force; $item })
            $state.Manifest = New-ImportManifest -Directory ([IO.Path]::GetDirectoryName($ManifestPath)) -JobId ([IO.Path]::GetFileName($ManifestPath)) -Items $items
            $status.Text = "已发现 $($items.Count) 个模型，开始传输…"; [void](Start-ModelImportJob -Manifest $state.Manifest -Concurrency $Concurrency -Prepare $Prepare -Upload $Upload -ManifestPath (Join-Path $ManifestPath 'manifest.json') -Context $Context)
            for ($i = 0; $i -lt $list.Items.Count; $i++) { $item = $state.Manifest.Items[$i]; $list.Items[$i].SubItems[2].Text = [string]$item.State; if ($item.PSObject.Properties['Error'] -and $item.Error) { $list.Items[$i].SubItems[3].Text = [string]$item.Error } elseif ($item.State -eq 'completed') { $list.Items[$i].SubItems[3].Text = '已确认可用' } }
            if ($state.Manifest.State -eq 'completed') { $status.Text = '导入完成，所有模型均已确认可用。' } elseif ($state.Manifest.State -eq 'cancelled') { $status.Text = '任务已取消，已完成模型已保留。' } else { $status.Text = '导入完成，但有模型失败，请查看清单。' }
        } catch { $status.Text = '导入失败：' + $_.Exception.Message }
        $cancel.Text = '关闭'
    })
    [void]$form.ShowDialog(); $form.Dispose(); return $state.Manifest
}

Export-ModuleMember -Function Show-StandaloneImportSetup, Show-ModelImportWorkbench
