# MA5-S2 Sprint 2 restore-run hook (runs inside a fresh -SmokeTest Island). No input is applied: the hook
# records exactly what a cold start restored from the preference file alone. One Island run per saved
# edge; $env:NOTCH_EXPECT is the edge the preceding dock or keyboard run saved. Save-BunnyScreenshot
# runs first because it settles through Resize-Bunny, so the screenshot documents the restored placement
# and the receipt reads a fully applied state. Receipt goes to $env:NOTCH_RECEIPT_PATH.
$ErrorActionPreference = 'Stop'
$expect = [string]$env:NOTCH_EXPECT
if (@('top', 'bottom', 'left', 'right') -notcontains $expect) { throw 'NOTCH_EXPECT must be top, bottom, left or right' }
$shot = Save-BunnyScreenshot ('sprint2-restore-' + $expect)
$workArea = [Windows.SystemParameters]::WorkArea
$receipt = [ordered]@{
  stage = 'restore'
  expectedEdge = $expect
  edge = [string]$bunnyPreferences.edge
  edgeOffset = [double]$bunnyPreferences.edgeOffset
  position = [string]$bunnyPreferences.position
  monitor = $bunnyPreferences.monitor
  window = [ordered]@{
    left = [double]$bunnyWindow.Left
    top = [double]$bunnyWindow.Top
    width = [double]$bunnyWindow.Width
    height = [double]$bunnyWindow.Height
  }
  orientation = [string]$bunnyPlacement.Orientation
  indicatorSide = [string]$bunnyPlacement.IndicatorSide
  expandDirection = [string](Get-BunnyExpandDirection ([string]$bunnyPreferences.edge))
  editChoice = [string]$bunnyControls.EdgeChoice.SelectedItem.Tag
  positionChoice = [string]$bunnyControls.PositionChoice.SelectedItem.Tag
  workArea = [ordered]@{
    left = $workArea.Left
    top = $workArea.Top
    width = $workArea.Width
    height = $workArea.Height
  }
  scale = (Get-BunnyDeviceScale).X
  screenshot = (Split-Path -Leaf $shot)
  restoredAt = (Get-Date).ToUniversalTime().ToString('o')
}
[IO.File]::WriteAllText($env:NOTCH_RECEIPT_PATH, ($receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
