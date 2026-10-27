param(
  [Parameter(Mandatory=$true)]
  [string]$Action,
  [int]$ProcessId = 0,
  [string]$PromptText = "",
  [string]$ExpectedEdge = ""
)

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

    $configPath = Join-Path $env:LOCALAPPDATA "BunnyA\config.json"
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
}
