# T13 PERF lane LIVE UI action on ONE Island window: invokes a control by AutomationId through UI Automation's Invoke pattern.
# Only the Island window owned by IslandPid is searched. Reports the control's state before and after.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][string]$AutomationId
)
. (Join-Path $PSScriptRoot 'native-common.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$mainHwnd = Get-IslandMainWindow $IslandPid
$root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$mainHwnd)
$cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
$el = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $el) { throw "control $AutomationId not found in Island $IslandPid" }
$before = [ordered]@{ name = $el.Current.Name; enabled = $el.Current.IsEnabled; rect = $el.Current.BoundingRectangle.ToString() }
$pattern = $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
$pattern.Invoke()
Start-Sleep -Milliseconds 1500
$after = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
$out = [ordered]@{ islandPid = $IslandPid; automationId = $AutomationId; invoked = $true; before = $before; afterName = $after.Current.Name; afterRect = $after.Current.BoundingRectangle.ToString() }
Write-Output ($out | ConvertTo-Json -Depth 4)
