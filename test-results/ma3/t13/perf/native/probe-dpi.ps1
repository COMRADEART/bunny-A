# T13 PERF lane LIVE DPI probe for ONE Island PID (launched by launch-island.ps1). Read-only except the screen capture PNG.
# This helper is per-monitor-aware (V2) so GetWindowRect and CopyFromScreen use PHYSICAL pixels.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][string]$Shot,
  [string]$Out = ''
)
. (Join-Path $PSScriptRoot 'native-common.ps1')
$utf8 = [Text.UTF8Encoding]::new($false)
$result = [ordered]@{ label = 'LIVE (real Island PID ' + $IslandPid + ' on this display)'; generatedAt = (Get-Date).ToString('o') }
$proc = Get-Process -Id $IslandPid
$result.islandProcess = [ordered]@{ pid = $proc.Id; name = $proc.ProcessName; startTime = $proc.StartTime.ToString('o'); processDpiAwareness = (Map-Awareness ([T13Native]::ProcessAwareness($IslandPid))) }
$result.helperDpiAwarenessContext = 'per-monitor-aware-v2 (SetProcessDpiAwarenessContext -4 in this helper)'
$result.systemDpi = [T13Native]::GetDpiForSystem()
$result.systemScale = [Math]::Round([T13Native]::GetDpiForSystem() / 96.0, 3)
$screens = @()
foreach ($s in [Windows.Forms.Screen]::AllScreens) { $screens += [ordered]@{ device = $s.DeviceName; primary = $s.Primary; boundsPhysical = [ordered]@{ x = $s.Bounds.X; y = $s.Bounds.Y; w = $s.Bounds.Width; h = $s.Bounds.Height }; workAreaPhysical = [ordered]@{ x = $s.WorkingArea.X; y = $s.WorkingArea.Y; w = $s.WorkingArea.Width; h = $s.WorkingArea.Height } } }
$result.screens = $screens
$windows = @()
foreach ($h in [T13Native]::WindowsOfPid($IslandPid)) {
  $rect = New-Object T13Native+RECT
  [void][T13Native]::GetWindowRect($h, [ref]$rect)
  $ctx = [T13Native]::GetWindowDpiAwarenessContext($h)
  $mon = [T13Native]::MonitorFromWindow($h, 2)
  $mdx = [uint32]0; $mdy = [uint32]0
  [void][T13Native]::GetDpiForMonitor($mon, 0, [ref]$mdx, [ref]$mdy)
  $windows += [ordered]@{ hwnd = $h.ToInt64(); class = [T13Native]::ClassOf($h); rectPhysical = [ordered]@{ left = $rect.Left; top = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }; windowDpi = [T13Native]::GetDpiForWindow($h); windowScale = [Math]::Round([T13Native]::GetDpiForWindow($h) / 96.0, 3); windowAwareness = (Map-ContextAwareness $ctx); monitorDpiEffective = [int]$mdx; monitorScale = [Math]::Round($mdx / 96.0, 3) }
}
$result.islandWindows = $windows
# Capture the real on-screen pixels of the Island's largest visible window (physical coordinates).
$main = $windows | Sort-Object { $_.rectPhysical.width * $_.rectPhysical.height } -Descending | Select-Object -First 1
if ($main) {
  $r = $main.rectPhysical
  $bmp = New-Object Drawing.Bitmap $r.width, $r.height
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.left, $r.top, 0, 0, $bmp.Size)
  $g.Dispose()
  $bmp.Save($Shot, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $result.capture = [ordered]@{ file = $Shot; physicalWidth = $r.width; physicalHeight = $r.height; method = 'Graphics.CopyFromScreen at physical coordinates from a per-monitor-aware process (real composited screen pixels)' }
} else { $result.capture = $null }
$json = $result | ConvertTo-Json -Depth 6
if ($Out) { [IO.File]::WriteAllText($Out, $json, $utf8) }
Write-Output $json
