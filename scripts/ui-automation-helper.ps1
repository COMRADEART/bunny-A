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
  [string]$ConfigPath = "",
  [int]$TargetX = 0,
  [int]$TargetY = 0
)

# R1R2: per-monitor DPI awareness so UIA rectangles and the work area are both physical pixels.
Add-Type -Namespace R1R2 -Name Dpi -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
public struct POINT { public int X; public int Y; }
public struct RECT { public int Left, Top, Right, Bottom; }
public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
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

function Get-Notch([int]$targetPid) {
  $cond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Bunny Island Notch")))
  return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}

# Work area (physical px) of the monitor containing a point; the notch may be on any monitor.
function Get-WorkAreaAt([int]$x, [int]$y) {
  $pt = New-Object R1R2.Dpi+POINT; $pt.X = $x; $pt.Y = $y
  $info = New-Object R1R2.Dpi+MONITORINFO; $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
  [void][R1R2.Dpi]::GetMonitorInfo([R1R2.Dpi]::MonitorFromPoint($pt, 2), [ref]$info)
  $w = $info.rcWork; $m = $info.rcMonitor
  return @{ x = $w.Left; y = $w.Top; width = $w.Right - $w.Left; height = $w.Bottom - $w.Top; monitor = @{ x = $m.Left; y = $m.Top; width = $m.Right - $m.Left; height = $m.Bottom - $m.Top } }
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

  "read_state" {
    # MA5-S2: any element's accessible name, enabled state and whether it is on screen (collapsed elements are absent).
    $win = Get-MainWindow $ProcessId
    $e = Find-Descendant $win $TargetId
    [PSCustomObject]@{ id = $TargetId; present = ($null -ne $e); name = if ($null -ne $e) { $e.Current.Name } else { $null }; enabled = ($null -ne $e -and $e.Current.IsEnabled); offscreen = ($null -ne $e -and $e.Current.IsOffscreen) } | ConvertTo-Json -Compress
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
      context = & $text "ApprovalContextText"
      plan = & $text "ApprovalDiffText"
      receipts = & $text "ApprovalReceiptText"
      approveEnabled = (Find-Descendant $win "ApproveActionButton").Current.IsEnabled
      denyEnabled = (Find-Descendant $win "DenyActionButton").Current.IsEnabled
    } | ConvertTo-Json -Compress -Depth 4
  }

  "read_list" {
    # Rows of any ListBox (-TargetId) as their accessible names, plus which is selected.
    $win = Get-MainWindow $ProcessId
    $list = Find-Descendant $win $TargetId
    if ($null -eq $list) { throw "$TargetId not found" }
    $rows = @()
    foreach ($it in $list.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
      $sel = $it.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) -as [System.Windows.Automation.SelectionItemPattern]
      $rows += [PSCustomObject]@{ name = $it.Current.Name; selected = ($null -ne $sel -and $sel.Current.IsSelected) }
    }
    ConvertTo-Json -Compress -Depth 4 -InputObject @($rows)
  }

  "select_list_item" {
    $win = Get-MainWindow $ProcessId
    $list = Find-Descendant $win $TargetId
    if ($null -eq $list) { throw "$TargetId not found" }
    $hit = $null
    for ($i = 0; $i -lt 40 -and $null -eq $hit; $i++) {
      foreach ($it in $list.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($it.Current.Name -like "*$Match*") { $hit = $it; break }
      }
      if ($null -eq $hit) { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $hit) { throw "No row of $TargetId mentions $Match" }
    ($hit.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) -as [System.Windows.Automation.SelectionItemPattern]).Select()
    Start-Sleep -Milliseconds 300
    [PSCustomObject]@{ selected = $hit.Current.Name } | ConvertTo-Json -Compress
  }

  "read_toggle" {
    $win = Get-MainWindow $ProcessId
    $e = Find-Descendant $win $TargetId
    if ($null -eq $e) { throw "$TargetId not found" }
    $t = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern) -as [System.Windows.Automation.TogglePattern]
    [PSCustomObject]@{ id = $TargetId; enabled = $e.Current.IsEnabled; on = ($t.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) } | ConvertTo-Json -Compress
  }

  "click_toggle" {
    # The screen-reader path: TogglePattern.Toggle(), which raises Checked/Unchecked but not Click.
    $win = Get-MainWindow $ProcessId
    $e = Find-Descendant $win $TargetId
    if ($null -eq $e) { throw "$TargetId not found" }
    ($e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern) -as [System.Windows.Automation.TogglePattern]).Toggle()
    Start-Sleep -Milliseconds 500
    [PSCustomObject]@{ toggled = $TargetId } | ConvertTo-Json -Compress
  }

  "set_text" {
    $win = Get-MainWindow $ProcessId
    $e = Find-Descendant $win $TargetId
    if ($null -eq $e) { throw "$TargetId not found" }
    ($e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]).SetValue($PromptText)
    [PSCustomObject]@{ set = $TargetId } | ConvertTo-Json -Compress
  }

  "invoke_notch" {
    # Invokes a notch control by AutomationId (keyboard/UIA path, no mouse), then reports the foreground owner.
    $notch = Get-Notch $ProcessId
    if ($null -eq $notch) { throw "Notch window not found" }
    $btn = Find-Descendant $notch $TargetId
    if ($null -eq $btn) { throw "$TargetId not found on the notch" }
    Invoke-Button $btn; Start-Sleep -Milliseconds 500
    $fg = [R1R2.Dpi]::GetForegroundWindow(); $fgPid = [uint32]0; [void][R1R2.Dpi]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    [PSCustomObject]@{ invoked = $TargetId; foregroundPid = $fgPid } | ConvertTo-Json -Compress
  }

  "close_main_window" {
    # The title-bar close (WindowPattern.Close), which Bunny A turns into hide-to-notch.
    $win = Get-MainWindow $ProcessId
    ($win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern) -as [System.Windows.Automation.WindowPattern]).Close()
    Start-Sleep -Milliseconds 800
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $names = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond) | ForEach-Object { $_.Current.Name })
    [PSCustomObject]@{ processAlive = ($null -ne $proc); visibleWindows = $names } | ConvertTo-Json -Compress
  }

  "drag_notch" {
    # A real mouse drag (physical px) from the notch's first agent icon to -TargetX/-TargetY, then release.
    $notch = Get-Notch $ProcessId
    if ($null -eq $notch) { throw "Notch window not found" }
    $grip = $null
    foreach ($id in @("AgentGada","VAgentGada")) { $e = Find-Descendant $notch $id; if ($null -ne $e -and -not $e.Current.IsOffscreen) { $grip = $e; break } }
    if ($null -eq $grip) { throw "No visible agent icon to grab" }
    $g = $grip.Current.BoundingRectangle
    $sx = [int]($g.X + $g.Width / 2); $sy = [int]($g.Y + $g.Height / 2)
    $saved = New-Object R1R2.Dpi+POINT; [void][R1R2.Dpi]::GetCursorPos([ref]$saved)
    [void][R1R2.Dpi]::SetCursorPos($sx, $sy); Start-Sleep -Milliseconds 120
    [R1R2.Dpi]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # LEFTDOWN
    # Let the window enter its move loop before the pointer travels; otherwise the first part of the path is lost.
    Start-Sleep -Milliseconds 600
    for ($i = 1; $i -le 40; $i++) {
      [void][R1R2.Dpi]::SetCursorPos([int]($sx + ($TargetX - $sx) * $i / 40), [int]($sy + ($TargetY - $sy) * $i / 40))
      Start-Sleep -Milliseconds 30
    }
    Start-Sleep -Milliseconds 200
    $held = $notch.Current.BoundingRectangle
    [R1R2.Dpi]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # LEFTUP
    Start-Sleep -Milliseconds 700
    [void][R1R2.Dpi]::SetCursorPos($saved.X, $saved.Y)
    [PSCustomObject]@{ from = @{ x = $sx; y = $sy }; to = @{ x = $TargetX; y = $TargetY }; whileHeld = @{ x = $held.X; y = $held.Y; width = $held.Width; height = $held.Height } } | ConvertTo-Json -Compress
  }

  "monitors" {
    $all = @()
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
      $b = $s.Bounds
      $wa = Get-WorkAreaAt ([int]($b.X + 1)) ([int]($b.Y + 1))
      $all += [PSCustomObject]@{ device = $s.DeviceName; primary = $s.Primary; monitor = $wa.monitor; workArea = @{ x = $wa.x; y = $wa.y; width = $wa.width; height = $wa.height } }
    }
    ConvertTo-Json -Compress -Depth 4 -InputObject @($all)
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
    # MA5-S1: the work area of the monitor holding the notch's centre (equals the primary one on a single monitor).
    $wa = Get-WorkAreaAt ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2))
    $fg = [R1R2.Dpi]::GetForegroundWindow(); $fgPid = [uint32]0; [void][R1R2.Dpi]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    $fgName = ""; try { $fgName = [System.Windows.Automation.AutomationElement]::FromHandle($fg).Current.Name } catch {}
    $persisted = ""
    if ($ConfigPath -and (Test-Path $ConfigPath)) { $persisted = (Get-Content $ConfigPath -Raw | ConvertFrom-Json).NotchEdge }
    $badges = @()
    foreach ($id in @("ApprovalBadge","VApprovalBadge","QuickStopButton","VQuickStopButton","CollapseButton","VCollapseButton")) {
      $e = Find-Descendant $notch $id
      if ($null -ne $e -and -not $e.Current.IsOffscreen) { $badges += $id }
    }
    $title = Find-Descendant $notch "NotchTitle"; $subtitle = Find-Descendant $notch "NotchSubtitle"
    [PSCustomObject]@{
      notch = @{ x = $r.X; y = $r.Y; width = $r.Width; height = $r.Height; offscreen = $notch.Current.IsOffscreen }
      workArea = @{ x = $wa.x; y = $wa.y; width = $wa.width; height = $wa.height }
      monitor = $wa.monitor
      visibleControls = @($badges)
      title = if ($null -ne $title) { $title.Current.Name } else { $null }
      subtitle = if ($null -ne $subtitle) { $subtitle.Current.Name } else { $null }
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
