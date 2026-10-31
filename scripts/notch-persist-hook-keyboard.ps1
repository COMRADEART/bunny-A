# MA5-S2 Sprint 2 keyboard-dock hook (runs inside a -SmokeTest Island). Set-BunnyDockEdge is the body the
# real Ctrl+Alt+Arrow chords run: Test-BunnyDockKey maps every arrow key through it and the keyboard-event
# mapping itself is locked by source tests, so docking to $env:NOTCH_TARGET here exercises the keyboard
# save path in the same way a live chord does. Receipt goes to $env:NOTCH_RECEIPT_PATH.
$ErrorActionPreference = 'Stop'
$target = [string]$env:NOTCH_TARGET
if (@('top', 'bottom', 'left', 'right') -notcontains $target) { throw 'NOTCH_TARGET must be top, bottom, left or right' }
Set-BunnyDockEdge $target
$shot = Save-BunnyScreenshot ('sprint2-keyboard-' + $target)
$workArea = [Windows.SystemParameters]::WorkArea
$receipt = [ordered]@{
  stage = 'keyboard'
  target = $target
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
  savedAt = (Get-Date).ToUniversalTime().ToString('o')
}
[IO.File]::WriteAllText($env:NOTCH_RECEIPT_PATH, ($receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
