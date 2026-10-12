# T13 native-final guarded CPU sampler for ONE Island PID: per-second CPU deltas PLUS a per-second iconic/window-rect
# probe so a restore flip during the window cannot hide inside an average. Read-only.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][int]$Seconds,
  [Parameter(Mandatory = $true)][string]$Label,
  [Parameter(Mandatory = $true)][string]$Out
)
. (Join-Path $PSScriptRoot '../perf/native/native-common.ps1')
$utf8 = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class W4 { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }'
$p = Get-Process -Id $IslandPid
$mainHwnd = Get-IslandMainWindow $IslandPid
$hwnd = [IntPtr]$mainHwnd
$prevCpu = $p.TotalProcessorTime.TotalSeconds
$prevT = [Diagnostics.Stopwatch]::StartNew()
$startCpu = $prevCpu
$samples = New-Object System.Collections.ArrayList
$flips = 0
for ($i = 0; $i -lt $Seconds; $i++) {
  Start-Sleep -Milliseconds 1000
  $p.Refresh()
  $cpu = $p.TotalProcessorTime.TotalSeconds
  $dt = $prevT.Elapsed.TotalSeconds
  $prevT.Restart()
  $pct = [Math]::Round((($cpu - $prevCpu) / $dt) * 100, 2)
  $prevCpu = $cpu
  $iconic = [W4]::IsIconic($hwnd)
  if (-not $iconic) { $flips++ }
  $rect = New-Object T13Native+RECT
  [void][T13Native]::GetWindowRect($hwnd, [ref]$rect)
  [void]$samples.Add([ordered]@{ t = $i + 1; cpuPctOneCore = $pct; iconic = $iconic; workingSetMB = [Math]::Round($p.WorkingSet64 / 1MB, 1); rect = "$($rect.Left),$($rect.Top)," + ($rect.Right - $rect.Left) + "x" + ($rect.Bottom - $rect.Top) })
}
$pcts = @($samples | ForEach-Object { $_.cpuPctOneCore })
$sorted = @($pcts | Sort-Object)
$peakWs = [Math]::Round((($samples | ForEach-Object { [double]$_.workingSetMB }) | Measure-Object -Maximum).Maximum, 1)
$summary = [ordered]@{
  label = 'LIVE guarded (Island PID ' + $IslandPid + '): ' + $Label
  seconds = $Seconds
  avgCpuPctOneCore = [Math]::Round((($prevCpu - $startCpu) / [Math]::Max(1, $Seconds)) * 100, 2)
  p95IntervalCpuPctOneCore = $sorted[[Math]::Min($sorted.Count - 1, [Math]::Floor(0.95 * $sorted.Count))]
  iconicFlips = $flips
  iconicAlwaysTrue = ($flips -eq 0)
  peakWorkingSetMB = $peakWs
  samples = $samples
}
$json = $summary | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($Out, $json, $utf8)
Write-Output $json