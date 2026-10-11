# M-A-3 T10: pure placement rules for the Island notch. No WPF objects here, so the rules are unit-tested
# through scripts/island-placement.test.mjs. Scope: the PRIMARY monitor work area only. Multi-monitor placement is
# unsupported: the Island never follows a window to a secondary display.
# Shared rule: top/bottom => horizontal notch, agent indicators LEFT of the body. left/right => vertical notch
# (narrow tall footprint, Size is swapped), agent indicators ABOVE the body. The rect is always inside the WorkArea.
$bunnyEdges = @('top', 'bottom', 'left', 'right')

function ConvertTo-BunnyEdge($Value) {
  $edge = [string]$Value
  if ($edge -in $bunnyEdges) { return $edge }
  return 'top'
}

function ConvertTo-BunnyOffset($Value) {
  if ($null -eq $Value) { return 0.5 }
  try { $number = [double]$Value } catch { return 0.5 }
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 0.5 }
  return [Math]::Min(1.0, [Math]::Max(0.0, $number))
}

function Get-BunnyPlacement {
  param(
    [string]$Edge = 'top',
    [Parameter(Mandatory = $true)]$WorkArea,
    [Parameter(Mandatory = $true)]$Size,
    $Offset = 0.5,
    [double]$Margin = 4
  )
  $edge = ConvertTo-BunnyEdge $Edge
  $position = ConvertTo-BunnyOffset $Offset
  $areaLeft = [double]$WorkArea.Left
  $areaTop = [double]$WorkArea.Top
  $areaWidth = [Math]::Max(0.0, [double]$WorkArea.Width)
  $areaHeight = [Math]::Max(0.0, [double]$WorkArea.Height)
  # The gap never exceeds a quarter of the area, so the inner box keeps at least half of the area.
  $gap = [Math]::Min([Math]::Max(0.0, $Margin), [Math]::Min($areaWidth, $areaHeight) / 4)
  $innerWidth = $areaWidth - 2 * $gap
  $innerHeight = $areaHeight - 2 * $gap
  $requestedWidth = [double]$Size.Width
  $requestedHeight = [double]$Size.Height
  if ([double]::IsNaN($requestedWidth)) { $requestedWidth = 1 }
  if ([double]::IsNaN($requestedHeight)) { $requestedHeight = 1 }
  if ($edge -in @('top', 'bottom')) {
    $width = [Math]::Min([Math]::Max(1.0, $requestedWidth), $innerWidth)
    $height = [Math]::Min([Math]::Max(1.0, $requestedHeight), $innerHeight)
    $left = $areaLeft + $gap + ($innerWidth - $width) * $position
    $top = if ($edge -eq 'top') { $areaTop + $gap } else { $areaTop + $areaHeight - $gap - $height }
    $orientation = 'horizontal'
    $indicatorSide = 'left'
  } else {
    # Vertical footprint: the bar thickness becomes the width, the notch length becomes the height.
    $width = [Math]::Min([Math]::Max(1.0, $requestedHeight), $innerWidth)
    $height = [Math]::Min([Math]::Max(1.0, $requestedWidth), $innerHeight)
    $top = $areaTop + $gap + ($innerHeight - $height) * $position
    $left = if ($edge -eq 'left') { $areaLeft + $gap } else { $areaLeft + $areaWidth - $gap - $width }
    $orientation = 'vertical'
    $indicatorSide = 'top'
  }
  return @{ Edge = $edge; Left = $left; Top = $top; Width = $width; Height = $height; Orientation = $orientation; IndicatorSide = $indicatorSide }
}

# Agent indicators: at most MaxVisible chips plus one "+N" overflow chip, so the notch never grows without bound.
function Get-BunnyIndicatorLayout {
  param(
    [Parameter(Mandatory = $true)]$Placement,
    [int]$AgentCount = 0,
    [int]$MaxVisible = 3
  )
  $cap = [Math]::Min(5, [Math]::Max(1, $MaxVisible))
  $count = [Math]::Max(0, $AgentCount)
  $visible = [Math]::Min($count, $cap)
  $overflow = $count - $visible
  $vertical = ([string]$Placement.Orientation) -eq 'vertical'
  return @{
    Side = [string]$Placement.IndicatorSide
    Axis = if ($vertical) { 'row' } else { 'column' }
    Count = $count
    Visible = $visible
    Overflow = $overflow
    Label = if ($overflow -gt 0) { '+' + $overflow } else { '' }
    Slots = $visible + [Math]::Min(1, $overflow)
  }
}
