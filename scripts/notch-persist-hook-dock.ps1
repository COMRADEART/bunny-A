# MA5-S2 Sprint 2 dock-run hook (runs inside a -SmokeTest Island). One synthetic pointer release on the
# edge named by $env:NOTCH_TARGET invokes Invoke-BunnyDockRelease with device coordinates — the same
# native snap/release path a real drag release takes. This is not a physical press-drag gesture; the
# release-point invocation is exactly the coverage contract used since the M-A-3 T13 drag receipt.
# The hook then records what the Island actually saved: edge, along-edge offset, position, monitor
# fingerprint, window rect, orientation, expansion direction and the Settings dropdown sync.
$ErrorActionPreference = 'Stop'
$target = [string]$env:NOTCH_TARGET
if (@('top', 'bottom', 'left', 'right') -notcontains $target) { throw 'NOTCH_TARGET must be top, bottom, left or right' }
$area = Get-BunnyTargetArea
$scale = Get-BunnyDeviceScale
$point = switch ($target) {
  'top' { @{ x = $area.Left + $area.Width * 0.3; y = $area.Top + 2 } }
  'bottom' { @{ x = $area.Left + $area.Width * 0.7; y = $area.Top + $area.Height - 2 } }
  'left' { @{ x = $area.Left + 2; y = $area.Top + $area.Height * 0.6 } }
  'right' { @{ x = $area.Left + $area.Width - 2; y = $area.Top + $area.Height * 0.4 } }
}
$device = @{ X = [int][Math]::Round($point.x * $scale.X); Y = [int][Math]::Round($point.y * $scale.Y) }
Invoke-BunnyDockRelease $device
$shot = Save-BunnyScreenshot ('sprint2-dock-' + $target)
$workArea = [Windows.SystemParameters]::WorkArea
$receipt = [ordered]@{
  stage = 'dock'
  target = $target
  devicePoint = [ordered]@{ x = $device.X; y = $device.Y }
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
  scale = $scale.X
  screenshot = (Split-Path -Leaf $shot)
  savedAt = (Get-Date).ToUniversalTime().ToString('o')
}
[IO.File]::WriteAllText($env:NOTCH_RECEIPT_PATH, ($receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
