# T13 native-final LIVE keyboard check on ONE Island window. Sends real key input ONLY while this Island PID owns the
# foreground window (checked before every key). Reads the focused element back through UI Automation and records the
# island window rect after each key (expansion/collapse proof). Extends perf/native/keys.ps1 with Enter/Space/Back.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][ValidateSet('tab', 'esc', 'enter', 'space', 'back')][string]$Action,
  [int]$Count = 1,
  [string]$Out = ''
)
. (Join-Path $PSScriptRoot '../perf/native/native-common.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
if (-not ('T13Focus' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class T13Focus {
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
}
$utf8 = [Text.UTF8Encoding]::new($false)
$mainHwnd = Get-IslandMainWindow $IslandPid
$hwnd = [IntPtr]$mainHwnd
function Fg-Pid { $h = [T13Native]::GetForegroundWindow(); $p = [uint32]0; [void][T13Focus]::GetWindowThreadProcessId($h, [ref]$p); return [int]$p }
function Island-Rect {
  $rect = New-Object T13Native+RECT
  [void][T13Native]::GetWindowRect($hwnd, [ref]$rect)
  return "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
}
# Bring the Island to the foreground (only this window; the thread-attach trick is the documented way to take focus).
$fgHwnd = [T13Native]::GetForegroundWindow(); $fgp = [uint32]0; $fgThread = [T13Focus]::GetWindowThreadProcessId($fgHwnd, [ref]$fgp)
$me = [T13Focus]::GetCurrentThreadId()
[void][T13Focus]::AttachThreadInput($me, $fgThread, $true)
[void][T13Native]::SetForegroundWindow($hwnd)
[void][T13Focus]::AttachThreadInput($me, $fgThread, $false)
Start-Sleep -Milliseconds 400
$root = [Windows.Automation.AutomationElement]::FromHandle($hwnd)
function Focused {
  $f = [Windows.Automation.AutomationElement]::FocusedElement
  if (-not $f) { return $null }
  return [ordered]@{ name = $f.Current.Name; controlType = ($f.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''); automationId = $f.Current.AutomationId; inIsland = ([int]$f.Current.NativeWindowHandle -eq [int]$hwnd.ToInt64() -or $f.Current.ProcessId -eq $IslandPid) }
}
$steps = @()
$aborted = $null
$vk = @{ tab = '{TAB}'; esc = '{ESC}'; enter = '{ENTER}'; space = ' '; back = '{BACKSPACE}' }[$Action]
$steps += [ordered]@{ step = 0; note = 'start'; foregroundPid = (Fg-Pid); islandPid = $IslandPid; focused = (Focused); islandRect = (Island-Rect) }
if ((Fg-Pid) -ne $IslandPid) { $aborted = 'Island is not the foreground window; no keys sent' }
else {
  for ($i = 1; $i -le $Count; $i++) {
    if ((Fg-Pid) -ne $IslandPid) { $aborted = "foreground moved to pid $(Fg-Pid) at step $i; stopped"; break }
    [System.Windows.Forms.SendKeys]::SendWait($vk)
    Start-Sleep -Milliseconds 350
    $steps += [ordered]@{ step = $i; key = $vk; foregroundPid = (Fg-Pid); focused = (Focused); islandRect = (Island-Rect) }
  }
}
$result = [ordered]@{ label = 'LIVE (real ' + $vk + ' key input to Island PID ' + $IslandPid + ', foreground verified before each key)'; islandPid = $IslandPid; action = $Action; requested = $Count; aborted = $aborted; steps = $steps }
$rect = New-Object T13Native+RECT
[void][T13Native]::GetWindowRect($hwnd, [ref]$rect)
$result.windowRectAfter = "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
if ($Action -eq 'esc' -or $Action -eq 'back') {
  $expanded = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, 'BunnyButton')))
  $result.bunnyButtonRectAfter = if ($expanded) { $expanded.Current.BoundingRectangle.ToString() } else { $null }
}
$json = $result | ConvertTo-Json -Depth 6
if ($Out) { [IO.File]::WriteAllText($Out, $json, $utf8) }
Write-Output $json