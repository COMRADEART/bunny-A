param(
  [Parameter(Mandatory=$true)]
  [string]$Action,
  [int]$ProcessId = 0,
  [string]$PromptText = "",
  [string]$ExpectedEdge = "",
  [string]$ModelName = "",
  [string]$LocalOnly = "",
  [string]$TargetId = "",
  [string]$Match = "",
  [string]$ConfigPath = ""
)

# R1R2: per-monitor DPI awareness so UIA rectangles and the work area are both physical pixels.
Add-Type -Namespace R1R2 -Name Dpi -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
"@
[void][R1R2.Dpi]::SetProcessDpiAwarenessContext([IntPtr]-4)
# UI text (e.g. "ollama · model") must reach the caller intact, not in the console code page.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Get-MainWindow([int]$targetPid) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $condPid = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid
  )
  for ($i = 0; $i -lt 40; $i++) {
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
    foreach ($w in $windows) {
      if ($w.Current.Name -like "*Workstation*" -or ($w.Current.Name -like "*Bunny A*" -and $w.Current.Name -notlike "*Notch*")) {
        return $w
      }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Could not obtain MainWindow for process $targetPid"
}

function Find-Descendant([System.Windows.Automation.AutomationElement]$parent, [string]$automationId, [string]$name = "") {
  if (![string]::IsNullOrEmpty($automationId)) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId
    )
    $elem = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($null -ne $elem) { return $elem }
  }
  if (![string]::IsNullOrEmpty($name)) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $name
    )
    $elem = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($null -ne $elem) { return $elem }
  }
  return $null
}

function Invoke-Button([System.Windows.Automation.AutomationElement]$btn) {
  $inv = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
  if ($null -ne $inv) {
    $inv.Invoke()
  } else {
    throw "InvokePattern not supported on button $($btn.Current.Name)"
  }
}

switch ($Action) {
  "enter_and_send" {
    $win = Get-MainWindow $ProcessId
    $input = Find-Descendant $win "PromptInput"
    if ($null -eq $input) {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit
      )
      $input = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    }
    if ($null -eq $input) { throw "PromptInput not found" }
    
    $val = $input.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]
    if ($null -ne $val) {
      $val.SetValue($PromptText)
    } else {
      $input.SetFocus()
      [System.Windows.Forms.SendKeys]::SendWait($PromptText)
    }

    $send = Find-Descendant $win "SendButton" "Send"
    if ($null -eq $send) { throw "SendButton not found" }
    $retries = 0
    while (!$send.Current.IsEnabled -and $retries -lt 30) {
      Start-Sleep -Milliseconds 250
      $retries++
    }
    Invoke-Button $send

    [PSCustomObject]@{
      status = "sent"
      prompt = $PromptText
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
  }

  "click_stop" {
    $win = Get-MainWindow $ProcessId
    $stop = Find-Descendant $win "StopButton" "Stop"
    if ($null -eq $stop) { throw "StopButton not found" }
    $retries = 0
    while (!$stop.Current.IsEnabled -and $retries -lt 30) {
      Start-Sleep -Milliseconds 200
      $retries++
    }
    Invoke-Button $stop

    [PSCustomObject]@{
      status = "stop_clicked"
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
  }

  "read_chat_messages" {
    $win = Get-MainWindow $ProcessId
    $list = Find-Descendant $win "ChatHistoryList"
    $messages = @()
    if ($null -ne $list) {
      $items = $list.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      foreach ($item in $items) {
        $texts = $item.FindAll(
          [System.Windows.Automation.TreeScope]::Descendants,
          (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))
        )
        $msgText = ""
        foreach ($t in $texts) {
          $val = $t.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]
          if ($null -ne $val) { $msgText += $val.Current.Value }
        }
        if ($msgText) { $messages += $msgText }
      }
    }
    [PSCustomObject]@{
      count = $messages.Count
      messages = $messages
    } | ConvertTo-Json -Compress
  }

  "show_notch" {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Bunny Island Notch"))
    )
    $notch = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -eq $notch) {
      $win = Get-MainWindow $ProcessId
      $btn = Find-Descendant $win "ToggleNotchButton"
      if ($null -ne $btn) {
        Invoke-Button $btn
        Start-Sleep -Milliseconds 600
        $notch = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
      }
    }
    [PSCustomObject]@{
      notchFound = ($null -ne $notch)
      notchTitle = if ($null -ne $notch) { $notch.Current.Name } else { "" }
      bounds = if ($null -ne $notch) {
        @{
          x = $notch.Current.BoundingRectangle.X
          y = $notch.Current.BoundingRectangle.Y
          width = $notch.Current.BoundingRectangle.Width
          height = $notch.Current.BoundingRectangle.Height
        }
      } else { $null }
    } | ConvertTo-Json -Compress
  }

  "cycle_dock_edge" {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Bunny Island Notch"))
    )
    $notch = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -eq $notch) { throw "Notch window not found" }

    $dockBtn = Find-Descendant $notch "DockEdgeButton"
    if ($null -eq $dockBtn) {
      $dockBtn = Find-Descendant $notch "VDockEdgeButton"
    }
    if ($null -eq $dockBtn) {
      $condBtn = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button
      )
      $allBtns = $notch.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condBtn)
      foreach ($b in $allBtns) {
        if ($b.Current.Name -like "*Edge*" -or $b.Current.AutomationId -like "*Dock*") {
          $dockBtn = $b
          break
        }
      }
    }
    if ($null -eq $dockBtn) { throw "DockEdgeButton not found on Notch" }

    Invoke-Button $dockBtn
    Start-Sleep -Milliseconds 400

    $notch = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    $rect = $notch.Current.BoundingRectangle

    $configPath = if ($ConfigPath) { $ConfigPath } else { Join-Path $env:LOCALAPPDATA "BunnyA\config.json" }
    $persistedEdge = ""
    if (Test-Path $configPath) {
      $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
      $persistedEdge = $cfg.NotchEdge
    }

    [PSCustomObject]@{
      edge = $persistedEdge
      x = $rect.X
      y = $rect.Y
      width = $rect.Width
      height = $rect.Height
      persisted = ($persistedEdge -eq $ExpectedEdge)
    } | ConvertTo-Json -Compress
  }

  "verify_process_shutdown" {
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $childCount = 0
    $childPids = @()
    try {
      $procs = Get-CimInstance Win32_Process
      foreach ($p in $procs) {
        if ($p.ParentProcessId -eq $ProcessId) {
          $childCount++
          $childPids += $p.ProcessId
        }
      }
    } catch {}

    [PSCustomObject]@{
      mainAlive = ($null -ne $proc)
      childCount = $childCount
      childPids = $childPids
    } | ConvertTo-Json -Compress
  }
  "select_model" {
    # Explicit model + local-only selection through the real controls, then read both back from UIA.
    $win = Get-MainWindow $ProcessId
    $combo = Find-Descendant $win "ChatModelCombo"
    if ($null -eq $combo) { throw "ChatModelCombo not found" }
    $expand = $combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern) -as [System.Windows.Automation.ExpandCollapsePattern]
    $expand.Expand(); Start-Sleep -Milliseconds 300
    $item = $null
    for ($i = 0; $i -lt 20 -and $null -eq $item; $i++) {
      $item = $combo.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $ModelName)))
      if ($null -eq $item) { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $item) { $expand.Collapse(); throw "Model '$ModelName' is not offered in ChatModelCombo" }
    ($item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) -as [System.Windows.Automation.SelectionItemPattern]).Select()
    $expand.Collapse(); Start-Sleep -Milliseconds 200
    $check = Find-Descendant $win "LocalOnlyCheck"
    if ($null -eq $check) { throw "LocalOnlyCheck not found" }
    $toggle = $check.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern) -as [System.Windows.Automation.TogglePattern]
    $want = if ($LocalOnly -eq "1") { [System.Windows.Automation.ToggleState]::On } else { [System.Windows.Automation.ToggleState]::Off }
    if ($toggle.Current.ToggleState -ne $want) { $toggle.Toggle() }
    $sel = ($combo.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern) -as [System.Windows.Automation.SelectionPattern]).Current.GetSelection()
    [PSCustomObject]@{
      selectedModel = if ($sel.Count -gt 0) { $sel[0].Current.Name } else { "" }
      localOnlyChecked = ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On)
    } | ConvertTo-Json -Compress
  }

  "read_chat_items" {
    # Every visible text in each chat bubble: sender, status, provider and model, and the message body.
    $win = Get-MainWindow $ProcessId
    $list = Find-Descendant $win "ChatHistoryList"
    $out = @()
    if ($null -ne $list) {
      foreach ($item in $list.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        $labels = @()
        foreach ($t in $item.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)))) { $labels += $t.Current.Name }
        $body = ""
        foreach ($e in $item.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))) {
          $v = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]
          if ($null -ne $v) { $body += $v.Current.Value }
        }
        $out += [PSCustomObject]@{ labels = $labels; text = $body }
      }
    }
    ConvertTo-Json -Compress -Depth 4 -InputObject @($out)
  }

  "navigate" {
    $win = Get-MainWindow $ProcessId
    $btn = Find-Descendant $win $TargetId
    if ($null -eq $btn) { throw "$TargetId not found" }
    Invoke-Button $btn; Start-Sleep -Milliseconds 500
    [PSCustomObject]@{ navigated = $TargetId } | ConvertTo-Json -Compress
  }

  "read_text" {
    $win = Get-MainWindow $ProcessId
    $e = Find-Descendant $win $TargetId
    [PSCustomObject]@{ id = $TargetId; text = if ($null -ne $e) { $e.Current.Name } else { $null } } | ConvertTo-Json -Compress
  }

  "read_approvals" {
    # What the Approval Center actually shows: list rows plus the detail pane for the selected row.
    $win = Get-MainWindow $ProcessId
    $list = Find-Descendant $win "PendingApprovalsList"
    if ($null -eq $list) { throw "PendingApprovalsList not found" }
    $rows = @()
    foreach ($it in $list.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
      $sel = $it.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) -as [System.Windows.Automation.SelectionItemPattern]
      $rows += [PSCustomObject]@{ name = $it.Current.Name; selected = ($null -ne $sel -and $sel.Current.IsSelected) }
    }
    $text = { param($id) $e = Find-Descendant $win $id; if ($null -ne $e) { $e.Current.Name } else { $null } }
    [PSCustomObject]@{
      rows = @($rows)
      operation = & $text "ApprovalOpKind"
      task = & $text "ApprovalTaskTitle"
      scope = & $text "ApprovalScopeText"
      payloadSha256 = & $text "ApprovalPayloadShaText"
      effects = & $text "ApprovalEffectsText"
      approveEnabled = (Find-Descendant $win "ApproveActionButton").Current.IsEnabled
    } | ConvertTo-Json -Compress -Depth 4
  }

  "select_approval" {
    # Selects the first row whose text contains -Match.
    $win = Get-MainWindow $ProcessId
    $list = Find-Descendant $win "PendingApprovalsList"
    $hit = $null
    for ($i = 0; $i -lt 40 -and $null -eq $hit; $i++) {
      foreach ($it in $list.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        $all = ($it.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }) -join " "
        if ($all -like "*$Match*") { $hit = $it; break }
      }
      if ($null -eq $hit) { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $hit) { throw "No approval row mentions $Match" }
    ($hit.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) -as [System.Windows.Automation.SelectionItemPattern]).Select()
    Start-Sleep -Milliseconds 300
    [PSCustomObject]@{ selected = $Match } | ConvertTo-Json -Compress
  }

  "invoke_and_dialog" {
    # Clicks a real button, then reads and dismisses the modal message box it raises (if any).
    $win = Get-MainWindow $ProcessId
    $btn = Find-Descendant $win $TargetId
    if ($null -eq $btn) { throw "$TargetId not found" }
    Invoke-Button $btn
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $dlgCond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "#32770")))
    $dlg = $null
    for ($i = 0; $i -lt 40 -and $null -eq $dlg; $i++) {
      $dlg = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $dlgCond)
      if ($null -eq $dlg) { $dlg = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $dlgCond) }
      if ($null -eq $dlg) { Start-Sleep -Milliseconds 250 }
    }
    $title = $null; $message = $null
    if ($null -ne $dlg) {
      $title = $dlg.Current.Name
      $texts = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)))
      $message = ($texts | ForEach-Object { $_.Current.Name }) -join " "
      $ok = $dlg.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
      if ($null -ne $ok) { Invoke-Button $ok }
    }
    [PSCustomObject]@{ invoked = $TargetId; dialogTitle = $title; dialogText = $message } | ConvertTo-Json -Compress
  }

  "notch_layout" {
    # Observed notch geometry: window rect, which agent images are rendered and where, the work area and focus owner.
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Bunny Island Notch")))
    $notch = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -eq $notch) { throw "Notch window not found" }
    $r = $notch.Current.BoundingRectangle
    $agents = @()
    foreach ($id in @("AgentGada","AgentSpear","AgentChakra","AgentSword","VAgentGada","VAgentSpear","VAgentChakra","VAgentSword")) {
      $e = Find-Descendant $notch $id
      if ($null -ne $e -and -not $e.Current.IsOffscreen) {
        $b = $e.Current.BoundingRectangle
        $agents += [PSCustomObject]@{ id = $id; x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height }
      }
    }
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $fg = [R1R2.Dpi]::GetForegroundWindow(); $fgPid = [uint32]0; [void][R1R2.Dpi]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    $fgName = ""; try { $fgName = [System.Windows.Automation.AutomationElement]::FromHandle($fg).Current.Name } catch {}
    $persisted = ""
    if ($ConfigPath -and (Test-Path $ConfigPath)) { $persisted = (Get-Content $ConfigPath -Raw | ConvertFrom-Json).NotchEdge }
    [PSCustomObject]@{
      notch = @{ x = $r.X; y = $r.Y; width = $r.Width; height = $r.Height; offscreen = $notch.Current.IsOffscreen }
      workArea = @{ x = $wa.X; y = $wa.Y; width = $wa.Width; height = $wa.Height }
      agents = @($agents)
      foreground = @{ pid = $fgPid; name = $fgName }
      persistedEdge = $persisted
    } | ConvertTo-Json -Compress -Depth 4
  }

  "process_tree" {
    # Every live descendant of -ProcessId (recursive), with creation times so a reused PID is not miscounted.
    $all = Get-CimInstance Win32_Process
    $seen = @{}; $queue = New-Object System.Collections.Queue; $queue.Enqueue([uint32]$ProcessId); $tree = @()
    while ($queue.Count -gt 0) {
      $parent = $queue.Dequeue()
      foreach ($p in $all) {
        if ($p.ParentProcessId -eq $parent -and -not $seen.ContainsKey($p.ProcessId) -and $p.ProcessId -ne $ProcessId) {
          $seen[$p.ProcessId] = $true; $queue.Enqueue($p.ProcessId)
          $tree += [PSCustomObject]@{ pid = $p.ProcessId; name = $p.Name; created = $p.CreationDate.ToUniversalTime().ToString("o") }
        }
      }
    }
    $self = $all | Where-Object { $_.ProcessId -eq $ProcessId }
    [PSCustomObject]@{
      alive = ($null -ne $self)
      created = if ($null -ne $self) { $self.CreationDate.ToUniversalTime().ToString("o") } else { $null }
      descendants = @($tree)
    } | ConvertTo-Json -Compress -Depth 4
  }
}
