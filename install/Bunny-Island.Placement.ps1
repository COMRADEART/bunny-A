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
# Axis is the single row of chips beside a horizontal notch (row) or the single column above a vertical notch (column).
function Get-BunnyIndicatorLayout {
  param(
    [Parameter(Mandatory = $true)]$Placement,
    [int]$AgentCount = 0,
    [int]$MaxVisible = 4
  )
  $cap = [Math]::Min(5, [Math]::Max(1, $MaxVisible))
  $count = [Math]::Max(0, $AgentCount)
  $visible = [Math]::Min($count, $cap)
  $overflow = $count - $visible
  $vertical = ([string]$Placement.Orientation) -eq 'vertical'
  return @{
    Side = [string]$Placement.IndicatorSide
    Axis = if ($vertical) { 'column' } else { 'row' }
    Count = $count
    Visible = $visible
    Overflow = $overflow
    Label = if ($overflow -gt 0) { '+' + $overflow } else { '' }
    Slots = $visible + [Math]::Min(1, $overflow)
  }
}

# M-A-3 T11, revised by T13: the facts one agent entry shows in the Notch tooltip and automation name. T13 forbids letter
# placeholders and internal team members as weapons, so no letter is produced: a team member keeps its role and its own
# current task in the tooltip, and the strip counts such agents as a neutral number. Pure: snapshot in, facts out.
$script:BunnyRoleName = @{ coordinator = 'Coordinator'; planner = 'Planner'; researcher = 'Researcher'; implementer = 'Implementer'; documenter = 'Documenter'; reviewer = 'Reviewer'; tester = 'Tester' }
$script:BunnyKindName = @{ plan = 'planning'; observe = 'reading a project file'; generate_json = 'building the dataset'; generate_markdown = 'writing Markdown'; generate_html = 'building the page'; review = 'reviewing (advisory)'; write_file = 'saving a file'; verify_output = 'Bunny checking requirements' }
function Get-BunnyAgentChipFacts($Agent) {
  $name = [string]$Agent.name
  $state = ([string]$Agent.state).Replace('_', ' ').ToLower()
  $role = if ($Agent.team) { [string]$Agent.team.role } else { '' }
  $parts = @($name)
  if ($role -and $script:BunnyRoleName.ContainsKey($role)) { $parts += ($script:BunnyRoleName[$role] + ' agent') }
  $parts += $state
  if ($Agent.current -and $Agent.current.kind -and $script:BunnyKindName.ContainsKey([string]$Agent.current.kind)) { $parts += $script:BunnyKindName[[string]$Agent.current.kind] }
  return @{ ToolTip = ($parts -join ' - '); Role = $role; MissionId = [string]$Agent.missionId }
}

# MA4-S2-T1: persistent task facts for the Notch. Pure: the Host's persistentTasks snapshot in, display facts out. One
# entry per task id (a recovered task never gets a second badge); only open tasks count; the most urgent state leads.
# Offline, the Island never presents a cached state as current: the headline says it is the last known state.
$script:BunnyTaskOrder = @('Needs attention', 'Waiting for approval', 'Recovering', 'Working', 'Paused', 'Queued')
$script:BunnyTaskTone = @{ 'Needs attention' = 'BunnyWarning'; 'Waiting for approval' = 'BunnyWarning'; 'Recovering' = 'BunnyAccent'; 'Working' = 'BunnyAccent'; 'Paused' = 'BunnyMuted'; 'Queued' = 'BunnyMuted' }
function Get-BunnyTaskStrip($Snapshot, [bool]$Online = $true) {
  $none = @{ Count = 0; Lead = ''; Headline = ''; Tone = 'BunnyMuted'; ToolTip = ''; Ids = @() }
  if (-not $Snapshot) { return $none }
  $seen = @{}; $open = @()
  foreach ($task in @($Snapshot.tasks)) {
    if (-not $task -or -not $task.id -or $seen.ContainsKey([string]$task.id)) { continue }
    $seen[[string]$task.id] = $true
    if ([string]$task.display -in $script:BunnyTaskOrder) { $open += $task }
  }
  if ($open.Count -eq 0) { return $none }
  $lead = ($script:BunnyTaskOrder | Where-Object { $state = $_; @($open | Where-Object { [string]$_.display -eq $state }).Count } | Select-Object -First 1)
  $leadCount = @($open | Where-Object { [string]$_.display -eq $lead }).Count
  $headline = switch ($lead) {
    'Working' { [string]$leadCount + ' working' }
    'Queued' { [string]$leadCount + ' queued' }
    default { $lead }
  }
  $lines = foreach ($task in $open) {
    $line = [string]$task.title + ' - ' + [string]$task.display
    if ($task.progress -and [int]$task.progress.total -gt 0) { $line += ' - step ' + [string]([int]$task.progress.done + [int]($task.display -eq 'Working')) + ' of ' + [string]$task.progress.total }
    $line
  }
  $tone = $script:BunnyTaskTone[$lead]
  if (-not $Online) { $headline = 'Tasks: last known'; $tone = 'BunnyMuted'; $lines = @('Host unavailable. Last known task states:') + @($lines) }
  return @{ Count = $open.Count; Lead = $lead; Headline = $headline; Tone = $tone; ToolTip = (@($lines) -join "`n"); Ids = @($open | ForEach-Object { [string]$_.id }) }
}

# M-A-3 T13: pure geometry for drag-to-dock. Device pixels are converted to DIPs by the caller's scale (the monitor's
# DPI), so every rule here is in the same logical units as Get-BunnyPlacement. No WPF or Win32 objects in this section.
function Convert-BunnyDeviceRect {
  param([Parameter(Mandatory = $true)]$Rect, [double]$ScaleX = 1.0, [double]$ScaleY = 1.0)
  $sx = if ($ScaleX -gt 0) { $ScaleX } else { 1.0 }
  $sy = if ($ScaleY -gt 0) { $ScaleY } else { 1.0 }
  return @{ Left = [double]$Rect.Left / $sx; Top = [double]$Rect.Top / $sy; Width = [double]$Rect.Width / $sx; Height = [double]$Rect.Height / $sy }
}

# A stable text key for a work area in DIPs: a saved monitor only matches again when its geometry is unchanged.
function Get-BunnyWorkAreaFingerprint($WorkArea) {
  return ('{0},{1},{2},{3}' -f [Math]::Round([double]$WorkArea.Left), [Math]::Round([double]$WorkArea.Top), [Math]::Round([double]$WorkArea.Width), [Math]::Round([double]$WorkArea.Height))
}

# Restore rule: the saved monitor must still exist with the same device name AND the same work-area fingerprint. Otherwise
# the primary monitor (or the first one, if none claims to be primary) is used. Never returns a monitor that is not listed.
function Select-BunnyMonitor {
  param($Saved, [object[]]$Monitors)
  $list = @($Monitors | Where-Object { $null -ne $_ })
  if ($list.Count -eq 0) { return $null }
  $primary = @($list | Where-Object { $_.Primary }) | Select-Object -First 1
  if (-not $primary) { $primary = $list[0] }
  if ($null -eq $Saved -or -not $Saved.device) { return $primary }
  $savedPrint = [string]$Saved.fingerprint
  $match = @($list | Where-Object { [string]$_.Device -eq [string]$Saved.device -and (Get-BunnyWorkAreaFingerprint $_.WorkArea) -eq $savedPrint }) | Select-Object -First 1
  if ($match) { return $match }
  return $primary
}

# The edge nearest to a point (the pointer at release, in DIPs) on the monitor's work area, plus the notch's position along
# that edge as an offset 0..1. The offset centres the notch on the pointer's position along the edge, clamped so the notch
# stays inside the inner box that Get-BunnyPlacement uses (the same gap rule). Ties resolve top, bottom, left, right.
function Get-BunnyNearestEdge {
  param([Parameter(Mandatory = $true)]$Point, [Parameter(Mandatory = $true)]$WorkArea, $Size = @{ Width = 1; Height = 1 }, [double]$Margin = 4)
  $left = [double]$WorkArea.Left
  $top = [double]$WorkArea.Top
  $width = [Math]::Max(0.0, [double]$WorkArea.Width)
  $height = [Math]::Max(0.0, [double]$WorkArea.Height)
  $x = [double]$Point.X
  $y = [double]$Point.Y
  $distances = [ordered]@{ top = $y - $top; bottom = ($top + $height) - $y; left = $x - $left; right = ($left + $width) - $x }
  $edge = 'top'
  $best = [double]::PositiveInfinity
  foreach ($name in @('top', 'bottom', 'left', 'right')) {
    $distance = [double]$distances[$name]
    if ($distance -lt $best) { $best = $distance; $edge = $name }
  }
  $gap = [Math]::Min([Math]::Max(0.0, $Margin), [Math]::Min($width, $height) / 4)
  # The notch length is always Size.Width (Get-BunnyPlacement's convention), along whichever edge it sits on.
  $length = [Math]::Max(1.0, [double]$Size.Width)
  if ($edge -in @('top', 'bottom')) {
    $innerStart = $left + $gap
    $innerRange = ($width - 2 * $gap) - $length
    $pointer = $x
  } else {
    $innerStart = $top + $gap
    $innerRange = ($height - 2 * $gap) - $length
    $pointer = $y
  }
  $offset = if ($innerRange -le 0) { 0.5 } else { ($pointer - $length / 2 - $innerStart) / $innerRange }
  return @{ Edge = $edge; Offset = [Math]::Min(1.0, [Math]::Max(0.0, $offset)) }
}

# Expansion direction of the detail panels, anchored to the dock edge: TOP expands down, BOTTOM up, LEFT right, RIGHT left.
function Get-BunnyExpandDirection([string]$Edge) {
  switch (ConvertTo-BunnyEdge $Edge) {
    'top' { return 'down' }
    'bottom' { return 'up' }
    'left' { return 'right' }
    default { return 'left' }
  }
}

# A rect is on-screen when it lies wholly inside the work area (negative coordinates are fine for a secondary monitor).
function Test-BunnyRectInside($Rect, $WorkArea) {
  $eps = 0.01
  return ([double]$Rect.Left -ge [double]$WorkArea.Left - $eps) -and ([double]$Rect.Top -ge [double]$WorkArea.Top - $eps) -and
    (([double]$Rect.Left + [double]$Rect.Width) -le ([double]$WorkArea.Left + [double]$WorkArea.Width + $eps)) -and
    (([double]$Rect.Top + [double]$Rect.Height) -le ([double]$WorkArea.Top + [double]$WorkArea.Height + $eps))
}
