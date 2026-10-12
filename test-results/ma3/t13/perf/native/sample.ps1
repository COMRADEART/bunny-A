# T13 PERF lane LIVE CPU/memory sampler for ONE Island PID: once per second, CPU time delta and working set.
# CPU % is of ONE logical core (delta TotalProcessorTime / delta wall time). Read-only.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][int]$Seconds,
  [Parameter(Mandatory = $true)][string]$Label,
  [Parameter(Mandatory = $true)][string]$Out
)
$utf8 = [Text.UTF8Encoding]::new($false)
$p = Get-Process -Id $IslandPid
$samples = New-Object System.Collections.ArrayList
$prevCpu = $p.TotalProcessorTime.TotalSeconds
$prevT = [Diagnostics.Stopwatch]::StartNew()
$startCpu = $prevCpu
$peakWs = $p.WorkingSet64
$peakPrivate = $p.PrivateMemorySize64
for ($i = 0; $i -lt $Seconds; $i++) {
  Start-Sleep -Milliseconds 1000
  $p.Refresh()
  $cpu = $p.TotalProcessorTime.TotalSeconds
  $dt = $prevT.Elapsed.TotalSeconds
  $prevT.Restart()
  $pct = [Math]::Round((($cpu - $prevCpu) / $dt) * 100, 2)
  $prevCpu = $cpu
  if ($p.WorkingSet64 -gt $peakWs) { $peakWs = $p.WorkingSet64 }
  if ($p.PrivateMemorySize64 -gt $peakPrivate) { $peakPrivate = $p.PrivateMemorySize64 }
  [void]$samples.Add([ordered]@{ t = $i + 1; cpuPctOneCore = $pct; workingSetMB = [Math]::Round($p.WorkingSet64 / 1MB, 1); privateMB = [Math]::Round($p.PrivateMemorySize64 / 1MB, 1); threads = $p.Threads.Count; handles = $p.HandleCount })
}
$totalCpu = $prevCpu - $startCpu
$wall = [Math]::Max(1, $Seconds)
$pcts = @($samples | ForEach-Object { $_.cpuPctOneCore })
$sorted = @($pcts | Sort-Object)
$summary = [ordered]@{
  label = 'LIVE ' + $Label + ' (Island PID ' + $IslandPid + ', real install\Bunny-Island.ps1, not -SmokeTest)'
  seconds = $Seconds
  avgCpuPctOneCore = [Math]::Round(($totalCpu / $wall) * 100, 2)
  p95IntervalCpuPctOneCore = $sorted[[Math]::Min($sorted.Count - 1, [Math]::Floor(0.95 * $sorted.Count))]
  maxIntervalCpuPctOneCore = ($pcts | Measure-Object -Maximum).Maximum
  peakWorkingSetMB = [Math]::Round($peakWs / 1MB, 1)
  peakPrivateMB = [Math]::Round($peakPrivate / 1MB, 1)
  finalWorkingSetMB = $samples[$samples.Count - 1].workingSetMB
  finalThreads = $samples[$samples.Count - 1].threads
  finalHandles = $samples[$samples.Count - 1].handles
  logicalProcessors = [Environment]::ProcessorCount
}
$json = [ordered]@{ summary = $summary; samples = $samples } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($Out, $json, $utf8)
Write-Output ($summary | ConvertTo-Json -Depth 4)
