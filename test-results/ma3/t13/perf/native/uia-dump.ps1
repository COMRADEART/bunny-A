# T13 PERF lane LIVE UI Automation dump of ONE Island window (the HWND owned by IslandPid). Read-only.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [string]$Out = '',
  [int]$MaxDepth = 14,
  [int]$MaxNodes = 900
)
. (Join-Path $PSScriptRoot 'native-common.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$utf8 = [Text.UTF8Encoding]::new($false)
$mainHwnd = Get-IslandMainWindow $IslandPid
$root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$mainHwnd)
$walker = [Windows.Automation.TreeWalker]::ControlViewWalker
$rows = New-Object System.Collections.ArrayList
$script:count = 0
function Walk($el, [int]$depth) {
  if ($script:count -ge $MaxNodes -or $depth -gt $MaxDepth) { return }
  $script:count++
  $ct = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  $rect = $el.Current.BoundingRectangle
  $row = [ordered]@{
    depth = $depth; controlType = $ct; name = $el.Current.Name; automationId = $el.Current.AutomationId
    keyboardFocusable = $el.Current.IsKeyboardFocusable; enabled = $el.Current.IsEnabled; offscreen = $el.Current.IsOffscreen
    helpText = $el.Current.HelpText; className = $el.Current.ClassName
    rectUia = if ($rect.IsEmpty) { $null } else { [ordered]@{ x = [int]$rect.X; y = [int]$rect.Y; w = [int]$rect.Width; h = [int]$rect.Height } }
  }
  [void]$rows.Add($row)
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null) { Walk $child ($depth + 1); $child = $walker.GetNextSibling($child) }
}
Walk $root 0
$focusable = @($rows | Where-Object { $_.keyboardFocusable })
$unnamedInteractive = @($rows | Where-Object { $_.keyboardFocusable -and -not $_.name })
$summary = [ordered]@{
  label = 'LIVE (UIA tree of Island PID ' + $IslandPid + ', HWND ' + $mainHwnd.ToInt64() + ')'
  nodesWalked = $rows.Count; nodeCap = $MaxNodes; depthCap = $MaxDepth
  keyboardFocusableNodes = $focusable.Count
  keyboardFocusableUnnamed = $unnamedInteractive.Count
  unnamedFocusableSample = @($unnamedInteractive | Select-Object -First 12 | ForEach-Object { $_.controlType + ' @' + ($_.rectUia | ConvertTo-Json -Compress) })
  focusableList = @($focusable | ForEach-Object { $_.controlType + ' | ' + $_.name + ' | ' + $_.automationId })
  rootName = $root.Current.Name
}
$json = [ordered]@{ summary = $summary; tree = $rows } | ConvertTo-Json -Depth 8
if ($Out) { [IO.File]::WriteAllText($Out, $json, $utf8) }
Write-Output ($summary | ConvertTo-Json -Depth 6)
