# M-A-3 T13 LIVE docking hook: runs INSIDE the real Bunny Island process (SmokeTest timer tick) against a REAL disposable Host.
# Pointer input is SYNTHETIC: Invoke-BunnyDockRelease with -DevicePoint is the drag-end handler, fed device points on each edge
# band. Keyboard input is REAL Ctrl+Alt+Arrow key input (keybd_event) sent to the Island window. If the chord does not reach
# the Island, the same function the key handler calls (Set-BunnyDockEdge) runs and the receipt says so. Every value is read back
# from the Island's own state. Output: $env:T13_LIVE_OUT\$env:T13_LIVE_RUN.json and PNGs in the shots folder.
$ErrorActionPreference = 'Stop'
$liveOut = $env:T13_LIVE_OUT
$runName = $env:T13_LIVE_RUN
Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@ -Name Kb -Namespace T13

# Pumps the Island's dispatcher for a while. The hook runs on the UI thread, so a plain Start-Sleep would block the key input.
function Pump([int]$Ms) {
  $end = [DateTime]::UtcNow.AddMilliseconds($Ms)
  do { $bunnyWindow.Dispatcher.Invoke([Action] { }, [Windows.Threading.DispatcherPriority]::Background); Start-Sleep -Milliseconds 15 } while ([DateTime]::UtcNow -lt $end)
}

$script:snaps = New-Object System.Collections.ArrayList
function Snap([string]$Label) {
  Update-Bunny; Pump 300; Update-Bunny; Pump 100
  $area = Get-BunnyTargetArea
  $shot = Save-BunnyScreenshot ($runName + '-' + $Label)
  $chips = @($bunnyControls.AgentStrip.Children | ForEach-Object { [string][Windows.Automation.AutomationProperties]::GetName($_) })
  $entry = [ordered]@{
    label = $Label; edge = [string]$bunnyPreferences.edge; edgeOffset = [double]$bunnyPreferences.edgeOffset
    monitor = $bunnyPreferences.monitor; view = [string]$bunnyView; position = [string]$bunnyPreferences.position
    window = [ordered]@{ left = [double]$bunnyWindow.Left; top = [double]$bunnyWindow.Top; width = [double]$bunnyWindow.Width; height = [double]$bunnyWindow.Height }
    workArea = [ordered]@{ left = [double]$area.Left; top = [double]$area.Top; width = [double]$area.Width; height = [double]$area.Height }
    orientation = [string]$bunnyPlacement.Orientation; indicatorSide = [string]$bunnyPlacement.IndicatorSide
    expandDirection = [string](Get-BunnyExpandDirection $bunnyPreferences.edge)
    stripVisibility = [string]$bunnyControls.AgentStrip.Visibility; chipNames = $chips
    companionState = ([string]$script:bunnyCompanionKey -split '\|')[0]; online = [bool]$bunnyOnline
    lastError = [string]$bunnyLastError; screenshot = [string]$shot
  }
  [void]$script:snaps.Add($entry)
  return $entry
}

$arrowKey = @{ top = 0x26; bottom = 0x28; left = 0x25; right = 0x27 }
function Send-DockChord([string]$Edge) {
  $hwnd = [Windows.Interop.WindowInteropHelper]::new($bunnyWindow).Handle
  [void][T13.Kb]::SetForegroundWindow($hwnd)
  Pump 200
  $foreground = ([T13.Kb]::GetForegroundWindow() -eq $hwnd)
  $before = [string]$bunnyPreferences.edge
  $ctrl = [byte]0x11; $alt = [byte]0x12; $arrow = [byte]$arrowKey[$Edge]
  [T13.Kb]::keybd_event($ctrl, 0, 0, [UIntPtr]::Zero); [T13.Kb]::keybd_event($alt, 0, 0, [UIntPtr]::Zero); [T13.Kb]::keybd_event($arrow, 0, 0, [UIntPtr]::Zero)
  [T13.Kb]::keybd_event($arrow, 0, 2, [UIntPtr]::Zero); [T13.Kb]::keybd_event($alt, 0, 2, [UIntPtr]::Zero); [T13.Kb]::keybd_event($ctrl, 0, 2, [UIntPtr]::Zero)
  Pump 600
  $landed = ([string]$bunnyPreferences.edge -eq $Edge)
  $path = 'keyboard-chord'
  if (-not $landed) { Set-BunnyDockEdge $Edge; Pump 100; $path = 'fallback-Set-BunnyDockEdge' }
  return [ordered]@{ target = $Edge; edgeBefore = $before; windowForeground = [bool]$foreground; chordLanded = [bool]$landed; path = $path; edgeAfter = [string]$bunnyPreferences.edge }
}

function Get-DevicePoint([string]$Edge, [double]$F) {
  $area = Get-BunnyTargetArea
  $L = [double]$area.Left; $T = [double]$area.Top; $W = [double]$area.Width; $H = [double]$area.Height
  $p = switch ($Edge) {
    'top' { @(($L + $W * $F), ($T + 2)) }
    'bottom' { @(($L + $W * $F), ($T + $H - 2)) }
    'left' { @(($L + 2), ($T + $H * $F)) }
    default { @(($L + $W - 2), ($T + $H * $F)) }
  }
  $scale = Get-BunnyDeviceScale
  return @{ X = [int][Math]::Round($p[0] * $scale.X); Y = [int][Math]::Round($p[1] * $scale.Y) }
}
function Invoke-SyntheticDrag([string]$Edge, [double]$F) {
  $device = Get-DevicePoint $Edge $F
  Invoke-BunnyDockRelease $device
  Pump 150
  return [ordered]@{ target = $Edge; fraction = $F; devicePoint = $device; edgeAfter = [string]$bunnyPreferences.edge; offsetAfter = [double]$bunnyPreferences.edgeOffset }
}

$drags = New-Object System.Collections.ArrayList
$keys = New-Object System.Collections.ArrayList
$null = Snap '01-start-top-collapsed'
# Bottom by a synthetic drag-release (a real snap), then expanded and collapsed again.
[void]$drags.Add((Invoke-SyntheticDrag 'bottom' 0.7))
$null = Snap '02-bottom-collapsed'
Set-BunnyView 'quick'; $null = Snap '03-bottom-expanded'; Set-BunnyView 'idle'
# Left by the Ctrl+Alt+Left keyboard path.
[void]$keys.Add((Send-DockChord 'left'))
$null = Snap '04-left-collapsed'
Set-BunnyView 'quick'; $null = Snap '05-left-expanded'; Set-BunnyView 'idle'
# Offset changes along the left edge (synthetic drags).
[void]$drags.Add((Invoke-SyntheticDrag 'left' 0.2))
$null = Snap '06-left-offset-0.2'
[void]$drags.Add((Invoke-SyntheticDrag 'left' 0.8))
$null = Snap '07-left-offset-0.8'
# Right by a synthetic drag-release.
[void]$drags.Add((Invoke-SyntheticDrag 'right' 0.4))
$null = Snap '08-right-collapsed'
Set-BunnyView 'quick'; $null = Snap '09-right-expanded'; Set-BunnyView 'idle'
# Top by the Ctrl+Alt+Up keyboard path.
[void]$keys.Add((Send-DockChord 'top'))
$null = Snap '10-top-collapsed'
Set-BunnyView 'quick'; $null = Snap '11-top-expanded'; Set-BunnyView 'idle'
[void]$drags.Add((Invoke-SyntheticDrag 'top' 0.2))
$null = Snap '12-top-offset-0.2'
[void]$drags.Add((Invoke-SyntheticDrag 'top' 0.8))
$null = Snap '13-top-offset-0.8'

$receipt = [ordered]@{
  run = $runName; kind = 'dock-sequence'; scale = [double](Get-BunnyDeviceScale).X
  drags = @($drags); keys = @($keys); snaps = @($script:snaps)
  finalPreferences = [ordered]@{ edge = [string]$bunnyPreferences.edge; edgeOffset = [double]$bunnyPreferences.edgeOffset; monitor = $bunnyPreferences.monitor; position = [string]$bunnyPreferences.position }
}
[IO.File]::WriteAllText((Join-Path $liveOut ($runName + '.json')), ($receipt | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
