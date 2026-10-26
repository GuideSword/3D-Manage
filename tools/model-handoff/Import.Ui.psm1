Set-StrictMode -Version Latest

function New-UiLabel {
    param([string]$Text, [int]$Left, [int]$Top, [int]$Width = 120)
    $label = [Windows.Forms.Label]::new()
    $label.Text = $Text; $label.Left = $Left; $label.Top = $Top; $label.Width = $Width; $label.AutoSize = $false
    return $label
}

function Show-StandaloneImportSetup {
    param(
        [string[]]$ServerOptions = @(),
        [string]$DefaultServer,
        [object]$Initial
    )
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = [Windows.Forms.Form]::new()
    $form.Text = 'model-import'; $form.StartPosition = 'CenterScreen'; $form.Width = 700; $form.Height = 590
    $form.MinimumSize = [Drawing.Size]::new(700, 590); $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false
    $title = [Windows.Forms.Label]::new(); $title.Text = '批量导入模型'; $title.Font = [Drawing.Font]::new('Microsoft YaHei UI', 16, [Drawing.FontStyle]::Bold); $title.Left = 28; $title.Top = 20; $title.Width = 600; $form.Controls.Add($title)
    $hint = New-UiLabel '选择服务器并扫描本地模型文件夹，系统会自动创建导入任务。' 30 55 620; $hint.ForeColor = [Drawing.Color]::DimGray; $form.Controls.Add($hint)

    $form.Controls.Add((New-UiLabel '服务器地址' 30 92 110))
    $server = [Windows.Forms.ComboBox]::new(); $server.Left = 150; $server.Top = 88; $server.Width = 500; $server.DropDownStyle = [Windows.Forms.ComboBoxStyle]::DropDown
    $serverValues = @($ServerOptions + $DefaultServer | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    foreach ($value in $serverValues) { [void]$server.Items.Add([string]$value) }
    if ($Initial -and $Initial.Server) { $server.Text = [string]$Initial.Server } elseif ($DefaultServer) { $server.Text = [string]$DefaultServer } elseif ($server.Items.Count -gt 0) { $server.SelectedIndex = 0 }
    $form.Controls.Add($server)

    $form.Controls.Add((New-UiLabel '登录邮箱' 30 130 110)); $email = [Windows.Forms.TextBox]::new(); $email.Left = 150; $email.Top = 126; $email.Width = 500; if ($Initial) { $email.Text = [string]$Initial.Email }; $form.Controls.Add($email)
    $form.Controls.Add((New-UiLabel '登录密码' 30 168 110)); $password = [Windows.Forms.TextBox]::new(); $password.Left = 150; $password.Top = 164; $password.Width = 500; $password.UseSystemPasswordChar = $true; if ($Initial) { $password.Text = [string]$Initial.Password }; $form.Controls.Add($password)
    $form.Controls.Add((New-UiLabel '模型目录' 30 206 110)); $folder = [Windows.Forms.TextBox]::new(); $folder.Left = 150; $folder.Top = 202; $folder.Width = 390; $folder.ReadOnly = $true; if ($Initial) { $folder.Text = [string]$Initial.Root }; $form.Controls.Add($folder)
    $browse = [Windows.Forms.Button]::new(); $browse.Text = '选择文件夹…'; $browse.Left = 550; $browse.Top = 200; $browse.Width = 100; $form.Controls.Add($browse)

    $form.Controls.Add((New-UiLabel '扫描格式' 30 246 110)); $formats = [Windows.Forms.CheckedListBox]::new(); $formats.Left = 150; $formats.Top = 242; $formats.Width = 500; $formats.Height = 130; $formats.CheckOnClick = $true
    @('STL（3D 打印模型）','OBJ（通用网格模型）','3MF（3D 打印工程）','STEP / STP（CAD 模型）') | ForEach-Object { [void]$formats.Items.Add($_, $true) }
    $formats.Tag = @(@('.stl'), @('.obj'), @('.3mf'), @('.step', '.stp'))
    if ($Initial -and $Initial.Extensions) { for ($i = 0; $i -lt $formats.Items.Count; $i++) { $formats.SetItemChecked($i, (@($Initial.Extensions) | Where-Object { $formats.Tag[$i] -contains $_ }).Count -gt 0) } }
    $form.Controls.Add($formats)

    $form.Controls.Add((New-UiLabel '并发传输' 30 392 110)); $concurrency = [Windows.Forms.NumericUpDown]::new(); $concurrency.Left = 150; $concurrency.Top = 388; $concurrency.Width = 90; $concurrency.Minimum = 1; $concurrency.Maximum = 4; $concurrency.Value = if ($Initial -and $Initial.Concurrency) { [decimal]$Initial.Concurrency } else { 2 }; $form.Controls.Add($concurrency)
    $concurrencyHint = New-UiLabel '同时上传的模型数量（资源紧张时建议设为 1）' 260 392 390; $concurrencyHint.ForeColor = [Drawing.Color]::DimGray; $form.Controls.Add($concurrencyHint)
    $status = New-UiLabel '' 30 435 620; $status.ForeColor = [Drawing.Color]::Firebrick; $form.Controls.Add($status)
    $ok = [Windows.Forms.Button]::new(); $ok.Text = '开始扫描并导入'; $ok.Left = 430; $ok.Top = 480; $ok.Width = 145; $ok.DialogResult = [Windows.Forms.DialogResult]::None; $form.Controls.Add($ok)
    $cancel = [Windows.Forms.Button]::new(); $cancel.Text = '取消'; $cancel.Left = 585; $cancel.Top = 480; $cancel.Width = 65; $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel; $form.Controls.Add($cancel); $form.AcceptButton = $ok; $form.CancelButton = $cancel

    $state = [ordered]@{ Cancelled = $true; Server = $null; Root = $null; Email = $null; Password = $null; Concurrency = 2; Extensions = @() }
    $browse.Add_Click({ $dialog = [Windows.Forms.FolderBrowserDialog]::new(); try { $dialog.Description = '请选择需要扫描的模型文件夹'; if ($dialog.ShowDialog($form) -eq [Windows.Forms.DialogResult]::OK) { $folder.Text = $dialog.SelectedPath } } finally { $dialog.Dispose() } })
    $ok.Add_Click({
        $status.Text = ''
        if ([string]::IsNullOrWhiteSpace($server.Text)) { $status.Text = '请选择或输入服务器地址。'; return }
        if ($server.Text -notmatch '^https://[^/]+/api/?$') { $status.Text = '服务器地址必须是 HTTPS 地址，并以 /api 结尾。'; return }
        if ([string]::IsNullOrWhiteSpace($email.Text) -or $email.Text -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { $status.Text = '请输入有效的登录邮箱。'; return }
        if ([string]::IsNullOrWhiteSpace($password.Text)) { $status.Text = '请输入登录密码。'; return }
        if ([string]::IsNullOrWhiteSpace($folder.Text) -or -not (Test-Path -LiteralPath $folder.Text -PathType Container)) { $status.Text = '请选择存在的模型文件夹。'; return }
        $selected = @(); for ($i = 0; $i -lt $formats.Items.Count; $i++) { if ($formats.GetItemChecked($i)) { $selected += @($formats.Tag[$i]) } }
        if ($selected.Count -eq 0) { $status.Text = '请至少选择一种模型格式。'; return }
        $state.Cancelled = $false; $state.Server = $server.Text.TrimEnd('/'); $state.Root = $folder.Text; $state.Email = $email.Text.Trim(); $state.Password = $password.Text; $state.Concurrency = [int]$concurrency.Value; $state.Extensions = @($selected | Select-Object -Unique); $form.Close()
    })
    $cancel.Add_Click({ $state.Cancelled = $true; $form.Close() })
    [void]$form.ShowDialog(); $form.Dispose(); return [pscustomobject]$state
}

function Show-ModelImportWorkbench {
    param([string]$Root, [int]$Concurrency = 2, [string[]]$Extensions = @('.stl', '.obj', '.3mf', '.step', '.stp'), [scriptblock]$Prepare, [scriptblock]$Upload, [string]$ManifestPath, [object]$Context)
    Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
    $moduleRoot = if($PSScriptRoot){$PSScriptRoot}else{[AppDomain]::CurrentDomain.BaseDirectory}; Import-Module (Join-Path $moduleRoot 'Import.Core.psm1') -Force
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
