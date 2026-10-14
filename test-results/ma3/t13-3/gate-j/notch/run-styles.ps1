# M-A-3 T13.3 Gate J: copied unchanged from gate-h/notch so the re-run writes its receipts and shots here, not over Gate H.
# M-A-3 T13.3 Gate H native Notch evidence driver (character styles, active speaker, measured cost).
# For each run it starts a DISPOSABLE fixture Host on a port in 43920-43959 (fake-host-styles.mjs), runs the Island in
# -SmokeTest against it and records, per weapon chip, what WPF actually holds: the effect, the bitmap scaling mode, the
# decoded width, the outline / speaker / working marks, the automation name and whether a transform is animating.
# Motion: -SmokeTest switches animation off. The hook stops the Island's poll timer and shadows $SmokeTest with $false, then
# calls the Island's own Set-BunnyMotionMode, so the installed rule (motion preference, system animation setting, high
# contrast, window visible) decides whether chips animate. Perf runs then measure process CPU time over a fixed window
# (no frame callback attached) and frame timing over a second window (CompositionTarget.Rendering). The runner samples the
# Island process's GPU engine utilization counters during the run. Expected values below are an independent copy, so a
# wrong value in the Island cannot pass its own check.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File run-styles.ps1 [-Only <name-substring>]
param([string]$Only = '')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$shots = Join-Path $here 'shots'
New-Item -ItemType Directory -Path $shots -Force | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t13-3-gate-h-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$node = (Get-Command node).Source
$utf8 = [Text.UTF8Encoding]::new($false)
$token = 'gate-h-fake-token'

function Test-PortFree([int]$Port) {
  try { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port); $listener.Start(); $listener.Stop(); return $true } catch { return $false }
}
function Wait-FixtureHost([int]$Port) {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $Port + '/state') -Headers @{ Authorization = 'Bearer ' + $token } -TimeoutSec 2
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 150
  }
  return $false
}

$weapons = @('gada', 'spear', 'chakra', 'sword')
$signature = @{ gada = 'glossy'; spear = 'cel'; chakra = 'arcade'; sword = 'comic' }
$expectedEffect = @{
  glossy = @{ color = '#FFFFD27A'; blur = 8; depth = 0 }
  cel = @{ color = '#FF05060A'; blur = 0; depth = 1.2 }
  arcade = @{ color = '#FF2EF2FF'; blur = 10; depth = 0 }
  comic = @{ color = '#FF000000'; blur = 2.5; depth = 0 }
}
# Material styles decode the compact art at no more than 96 px wide; pixel art fits the longest side to 24 px. Neither
# upscales. Sizes come from the PNG headers of the art the Island loads (public\bunny-a\characters), read here independently.
$artRoot = (Resolve-Path -LiteralPath (Join-Path $here '..\..\..\..\..\public\bunny-a\characters')).Path
$nativeWidth = @{}; $nativeHeight = @{}; $pixelWidth = @{}
foreach ($weapon in $weapons) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $artRoot ($weapon + '.compact.png')))
  $nativeWidth[$weapon] = ($bytes[16] -shl 24) -bor ($bytes[17] -shl 16) -bor ($bytes[18] -shl 8) -bor $bytes[19]
  $nativeHeight[$weapon] = ($bytes[20] -shl 24) -bor ($bytes[21] -shl 16) -bor ($bytes[22] -shl 8) -bor $bytes[23]
  $pixelWidth[$weapon] = [int][Math]::Max(1, [Math]::Round($nativeWidth[$weapon] * [Math]::Min(1.0, 24.0 / [Math]::Max($nativeWidth[$weapon], $nativeHeight[$weapon])), [MidpointRounding]::AwayFromZero))
}
# WPF reports BitmapScalingMode.HighQuality by its enum alias Fant (both are value 2).
$highQuality = @('HighQuality', 'Fant')
function Same([string]$Style, [string]$Intensity, [bool]$Contrast) { return @(1..4 | ForEach-Object { [ordered]@{ style = $(if ($Style) { $Style } else { $null }); intensity = $Intensity; highContrast = $Contrast } }) }

$runs = @()
foreach ($edge in @('top', 'bottom', 'left', 'right')) {
  $runs += @{ name = "edge-$edge-gada-speaking"; edge = $edge; motion = 'full'; scenario = 'speaker'; foreground = '1'; appearance = 'signature'; styles = $signature }
}
foreach ($style in @('glossy', 'cel', 'arcade', 'comic', 'pixel')) {
  $runs += @{ name = "style-$style-all-agents"; edge = 'top'; motion = 'full'; scenario = 'speaker'; foreground = '1'; appearance = (Same $style 'full' $false); style = $style }
}
$runs += @{ name = 'contrast-high-all-agents'; edge = 'top'; motion = 'full'; scenario = 'speaker'; foreground = '1'; appearance = (Same '' 'full' $true); contrast = $true; styles = $signature }
$runs += @{ name = 'intensity-off-all-agents'; edge = 'top'; motion = 'full'; scenario = 'speaker'; foreground = '1'; appearance = (Same '' 'off' $false); intensity = 'off'; styles = $signature }
$runs += @{ name = 'intensity-subtle-all-agents'; edge = 'top'; motion = 'full'; scenario = 'speaker'; foreground = '1'; appearance = (Same '' 'subtle' $false); intensity = 'subtle'; styles = $signature }
$runs += @{ name = 'reduced-motion-preference'; edge = 'top'; motion = 'reduced'; scenario = 'speaker'; foreground = '1'; appearance = 'signature'; styles = $signature; reduced = $true }
$runs += @{ name = 'bunny-speaking-no-agent-marked'; edge = 'left'; motion = 'full'; scenario = 'speaker'; foreground = 'bunny'; appearance = 'signature'; styles = $signature }
# Measured cost: the Island static (reduced motion), animated with chips held still (intensity off), then each style.
$runs += @{ name = 'perf-island-static'; edge = 'top'; motion = 'reduced'; scenario = 'all-working'; foreground = 'bunny'; appearance = 'signature'; styles = $signature; perf = $true; reduced = $true }
$runs += @{ name = 'perf-chips-still'; edge = 'top'; motion = 'full'; scenario = 'all-working'; foreground = 'bunny'; appearance = (Same '' 'off' $false); styles = $signature; perf = $true; intensity = 'off' }
# The T13 chip as it was before Gate H: the same motion with no effect and no cache (the hook strips both after the update).
$runs += @{ name = 'perf-t13-chip-no-effect'; edge = 'top'; motion = 'full'; scenario = 'all-working'; foreground = 'bunny'; appearance = 'signature'; styles = $signature; perf = $true; noEffect = $true }
$runs += @{ name = 'perf-signature'; edge = 'top'; motion = 'full'; scenario = 'all-working'; foreground = 'bunny'; appearance = 'signature'; styles = $signature; perf = $true }
foreach ($style in @('glossy', 'cel', 'arcade', 'comic', 'pixel')) {
  $runs += @{ name = "perf-$style"; edge = 'top'; motion = 'full'; scenario = 'all-working'; foreground = 'bunny'; appearance = (Same $style 'full' $false); style = $style; perf = $true }
}
if ($Only) { $runs = @($runs | Where-Object { $_.name -like ('*' + $Only + '*') }) }

$hookTemplate = @'
$ErrorActionPreference = 'Stop'
$bunnyTimer.Stop()
function Wait-GateH([int]$Ms) {
  $frame = [Windows.Threading.DispatcherFrame]::new()
  $timer = [Windows.Threading.DispatcherTimer]::new(); $timer.Interval = [TimeSpan]::FromMilliseconds($Ms)
  $timer.Add_Tick({ $timer.Stop(); $frame.Continue = $false }.GetNewClosure()); $timer.Start()
  [Windows.Threading.Dispatcher]::PushFrame($frame)
}
Set-BunnyView 'idle'
$SmokeTest = $false
Update-Bunny
Set-BunnyMotionMode
Update-BunnyAgentStrip
if ('__NOEFFECT__' -eq '1') { foreach ($c in @($script:bunnyWeaponChips.Values)) { $c.Tag.Image.Effect = $null; $c.Tag.Art.CacheMode = $null } }
Wait-GateH 700
$chips = @(foreach ($id in @(1, 2, 3, 4)) {
  if (-not $script:bunnyWeaponChips.ContainsKey($id)) { continue }
  $chip = $script:bunnyWeaponChips[$id]; $t = $chip.Tag; $effect = $t.Image.Effect
  [ordered]@{
    slot = $id; name = [Windows.Automation.AutomationProperties]::GetName($chip); inStrip = $bunnyControls.AgentStrip.Children.Contains($chip)
    skinKey = [string]$t.Skin; motionKey = [string]$t.Key
    effect = $(if ($effect) { [ordered]@{ color = $effect.Color.ToString(); blur = $effect.BlurRadius; depth = $effect.ShadowDepth; opacity = $effect.Opacity } } else { $null })
    cache = $(if ($t.Art.CacheMode) { [ordered]@{ type = $t.Art.CacheMode.GetType().Name; renderAtScale = $t.Art.CacheMode.RenderAtScale } } else { $null })
    scaling = [string][Windows.Media.RenderOptions]::GetBitmapScalingMode($t.Image)
    sourcePixelWidth = $(if ($t.Image.Source) { $t.Image.Source.PixelWidth } else { $null })
    outline = $t.Outline.Visibility.ToString(); speaker = $t.Speaker.Visibility.ToString(); working = $t.Working.Visibility.ToString()
    moving = [bool]($t.Move.HasAnimatedProperties -or $t.Rotate.HasAnimatedProperties); haloAnimated = [bool]$t.Halo.HasAnimatedProperties
  }
})
$shot = Save-BunnyScreenshot '__NAME__'
$receipt = [ordered]@{
  name = '__NAME__'; pid = $PID; edge = $bunnyPreferences.edge; motion = $bunnyPreferences.motion; animate = [bool]$bunnyAnimate; online = $bunnyOnline
  systemHighContrast = [bool][Windows.SystemParameters]::HighContrast; clientAreaAnimation = [bool][Windows.SystemParameters]::ClientAreaAnimation
  orientation = $bunnyPlacement.Orientation; indicatorSide = $bunnyPlacement.IndicatorSide; stripOrientation = [string]$bunnyControls.AgentStrip.Orientation
  chips = $chips; screenshot = $shot
}
if ('__PERF__' -eq '1') {
  $proc = [Diagnostics.Process]::GetCurrentProcess()
  Wait-GateH 1500
  $proc.Refresh(); $cpu0 = $proc.TotalProcessorTime.TotalMilliseconds; $start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $sw = [Diagnostics.Stopwatch]::StartNew()
  Wait-GateH 8000
  $proc.Refresh(); $cpu1 = $proc.TotalProcessorTime.TotalMilliseconds; $wall = $sw.Elapsed.TotalMilliseconds; $end = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $times = [Collections.Generic.List[double]]::new()
  $onFrame = [EventHandler]({ param($s, $e) $times.Add($e.RenderingTime.TotalMilliseconds) }.GetNewClosure())
  [Windows.Media.CompositionTarget]::add_Rendering($onFrame)
  Wait-GateH 4000
  [Windows.Media.CompositionTarget]::remove_Rendering($onFrame)
  $frames = @($times | Select-Object -Unique)
  $intervals = @(@(for ($i = 1; $i -lt $frames.Count; $i++) { $frames[$i] - $frames[$i - 1] }) | Sort-Object)
  function Pct($List, [double]$P) { if (-not $List.Count) { return $null }; return [Math]::Round($List[[Math]::Min($List.Count - 1, [int][Math]::Floor($P * ($List.Count - 1)))], 2) }
  $span = if ($frames.Count -gt 1) { $frames[-1] - $frames[0] } else { 0 }
  $receipt['perf'] = [ordered]@{
    cpuWindowMs = [Math]::Round($wall, 1); cpuMs = [Math]::Round($cpu1 - $cpu0, 1); cpuPercentOneCore = [Math]::Round(100 * ($cpu1 - $cpu0) / $wall, 2)
    logicalProcessors = [Environment]::ProcessorCount; cpuWindowStartUnixMs = $start; cpuWindowEndUnixMs = $end
    movingChips = @($chips | Where-Object { $_.moving }).Count
    frames = [ordered]@{ count = $frames.Count; fps = $(if ($span -gt 0) { [Math]::Round(1000 * ($frames.Count - 1) / $span, 1) } else { $null }); p50Ms = (Pct $intervals 0.5); p95Ms = (Pct $intervals 0.95); p99Ms = (Pct $intervals 0.99); maxMs = $(if ($intervals.Count) { [Math]::Round($intervals[-1], 2) } else { $null }); over25Ms = @($intervals | Where-Object { $_ -gt 25 }).Count; over50Ms = @($intervals | Where-Object { $_ -gt 50 }).Count }
  }
}
$receipt['lastError'] = [string]$bunnyLastError
[IO.File]::WriteAllText('__RECEIPT__', ($receipt | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
'@

function Get-GpuSample([int]$ProcessId) {
  try {
    $set = Get-Counter -Counter ("\GPU Engine(pid_{0}_*)\Utilization Percentage" -f $ProcessId) -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop
    $values = @($set.CounterSamples)
    return [pscustomobject]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); total = [Math]::Round([double](($values | Measure-Object CookedValue -Sum).Sum), 3); engine3d = [Math]::Round([double](($values | Where-Object { $_.InstanceName -like '*engtype_3d*' } | Measure-Object CookedValue -Sum).Sum), 3); instances = $values.Count; error = $null }
  } catch { return [pscustomobject]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); total = $null; engine3d = $null; instances = 0; error = $_.Exception.Message } }
}

$receipts = @()
$port = 43920
foreach ($run in $runs) {
  $commandLog = Join-Path $work ($run.name + '.commands.jsonl')
  while (-not (Test-PortFree $port)) { $port += 1; if ($port -gt 43959) { throw 'no free fixture port in 43920-43959' } }
  $appearanceArg = 'signature'
  if ($run.appearance -isnot [string]) {
    $appearanceArg = Join-Path $work ($run.name + '.appearance.json')
    [IO.File]::WriteAllText($appearanceArg, (ConvertTo-Json -InputObject @($run.appearance) -Compress -Depth 4), $utf8)
  }
  $fakeHost = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'fake-host-styles.mjs'), [string]$port, $run.scenario, $appearanceArg, $run.foreground, $commandLog) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $work ($run.name + '.host.log'))
  try {
    if (-not (Wait-FixtureHost $port)) { throw ('fixture host did not start on ' + $port + ': ' + (Get-Content -Raw -LiteralPath (Join-Path $work ($run.name + '.host.log')) -ErrorAction SilentlyContinue)) }
    $cred = Join-Path $work 'cred.json'
    [IO.File]::WriteAllText($cred, (@{ token = $token; port = $port } | ConvertTo-Json -Compress), $utf8)
    $pref = Join-Path $work 'pref.json'
    [IO.File]::WriteAllText($pref, (@{ edge = $run.edge; position = 'center'; size = 'compact'; motion = $run.motion; theme = 'dark'; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5; monitor = $null } | ConvertTo-Json -Compress), $utf8)
    $receiptPath = Join-Path $work ($run.name + '.receipt.json')
    $hookPath = Join-Path $work ($run.name + '.hook.ps1')
    $hook = $hookTemplate.Replace('__NAME__', $run.name).Replace('__RECEIPT__', $receiptPath).Replace('__PERF__', $(if ($run.perf) { '1' } else { '0' })).Replace('__NOEFFECT__', $(if ($run.noEffect) { '1' } else { '0' }))
    [IO.File]::WriteAllText($hookPath, $hook, $utf8)
    $islandLog = Join-Path $work ($run.name + '.island.log')
    $island = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'wrapper.ps1'), '-HookFile', $hookPath, '-Pref', $pref, '-Shots', $shots, '-Cred', $cred, '-Deploy', (Join-Path $work 'no-deploy')) -WindowStyle Hidden -PassThru -RedirectStandardError $islandLog -RedirectStandardOutput (Join-Path $work ($run.name + '.island.out'))
    $null = $island.Handle
    $gpu = @()
    while (-not $island.HasExited) {
      if ($run.perf) { $gpu += Get-GpuSample $island.Id } else { Start-Sleep -Milliseconds 250 }
    }
    $island.WaitForExit()
    $exit = $island.ExitCode
    if ($exit -ne 0 -or -not (Test-Path -LiteralPath $receiptPath)) { throw ('island run ' + $run.name + ' exit ' + $exit + ' ' + (Get-Content -Raw -LiteralPath $islandLog -ErrorAction SilentlyContinue)) }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $commands = @(Get-Content -LiteralPath $commandLog -ErrorAction SilentlyContinue | ForEach-Object { ($_ | ConvertFrom-Json).action })
    $chips = @($receipt.chips)
    $bySlot = @{}; foreach ($chip in $chips) { $bySlot[[int]$chip.slot] = $chip }
    $states = if ($run.scenario -eq 'all-working') { @{ 1 = 'CODING'; 2 = 'RESEARCHING'; 3 = 'TESTING'; 4 = 'FILE_WORK' } } else { @{ 1 = 'IDLE'; 2 = 'RESEARCHING'; 3 = 'TESTING'; 4 = 'WAITING_FOR_USER' } }
    $working = @('PLANNING', 'RESEARCHING', 'CODING', 'TESTING', 'FILE_WORK', 'ACTIVE', 'VERIFYING')
    $vertical = ($receipt.edge -eq 'left') -or ($receipt.edge -eq 'right')
    $checks = [ordered]@{
      fourChipsInStrip = ($chips.Count -eq 4) -and (@($chips | Where-Object { $_.inStrip }).Count -eq 4)
      placementRule = $(if ($vertical) { $receipt.orientation -eq 'vertical' -and $receipt.indicatorSide -eq 'top' } else { $receipt.orientation -eq 'horizontal' -and $receipt.indicatorSide -eq 'left' })
      noIslandError = [string]::IsNullOrEmpty([string]$receipt.lastError)
      onlyVoiceCommandsSent = (@($commands | Where-Object { $_ -and -not ([string]$_).StartsWith('voice.') }).Count -eq 0)
    }
    $speakerSlot = if ($run.foreground -eq 'bunny') { $null } else { [int]$run.foreground }
    $checks['speakerMarkOnlyOnForeground'] = (@($chips | Where-Object { ($_.speaker -eq 'Visible') -ne ($speakerSlot -eq [int]$_.slot) }).Count -eq 0)
    $checks['speakerNamedInAutomation'] = (@($chips | Where-Object { ($_.name -like '*speaking now*') -ne ($speakerSlot -eq [int]$_.slot) }).Count -eq 0)
    $checks['workingDotFromHostState'] = (@($chips | Where-Object { ($_.working -eq 'Visible') -ne ($working -contains $states[[int]$_.slot]) }).Count -eq 0)
    foreach ($chip in $chips) {
      $slotId = [int]$chip.slot; $weapon = $weapons[$slotId - 1]
      $style = if ($run.style) { $run.style } else { $run.styles[$weapon] }
      $contrast = [bool]$run.contrast -or [bool]$receipt.systemHighContrast
      if ($run.noEffect) { $ok = ($null -eq $chip.effect) -and ($null -eq $chip.cache) }
      elseif ($contrast) { $ok = ($null -eq $chip.effect) -and ($null -eq $chip.cache) -and $chip.outline -eq 'Visible' }
      elseif ($style -eq 'pixel') { $ok = ($null -eq $chip.effect) -and $chip.scaling -eq 'NearestNeighbor' -and [int]$chip.sourcePixelWidth -eq $pixelWidth[$weapon] -and ($null -eq $chip.cache) -and $chip.outline -eq 'Collapsed' }
      else { $e = $expectedEffect[$style]; $ok = $chip.effect -and $chip.effect.color -eq $e.color -and [double]$chip.effect.blur -eq [double]$e.blur -and [double]$chip.effect.depth -eq [double]$e.depth -and ($highQuality -contains $chip.scaling) -and [int]$chip.sourcePixelWidth -eq [Math]::Min(96, $nativeWidth[$weapon]) -and $chip.cache -and $chip.cache.type -eq 'BitmapCache' -and [double]$chip.cache.renderAtScale -ge 1 -and $chip.outline -eq 'Collapsed' }
      $checks["slot$($slotId)_${weapon}_skin_$style"] = [bool]$ok
      # Motion: a chip moves only if the Island animates, the Host state runs the base loop and the intensity is not off.
      $baseLoop = ($working + @('IDLE', 'WAITING')) -contains $states[$slotId]
      $shouldMove = [bool]$receipt.animate -and $baseLoop -and $run.intensity -ne 'off'
      $checks["slot$($slotId)_motionFromHostState"] = ([bool]$chip.moving -eq $shouldMove)
    }
    if ($run.reduced) { $checks['reducedMotionNoAnimation'] = (-not [bool]$receipt.animate) -and (@($chips | Where-Object { $_.moving -or $_.haloAnimated }).Count -eq 0) }
    if ($run.motion -eq 'full' -and -not $receipt.systemHighContrast -and $receipt.clientAreaAnimation) { $checks['islandAnimatesWhenAllowed'] = [bool]$receipt.animate }
    if ($run.perf) {
      $window = @($gpu | Where-Object { $_.at -ge [double]$receipt.perf.cpuWindowStartUnixMs -and $_.at -le [double]$receipt.perf.cpuWindowEndUnixMs + 1000 -and $null -ne $_.total })
      $receipt.perf | Add-Member -NotePropertyName gpu -NotePropertyValue ([ordered]@{
        samplesInCpuWindow = $window.Count
        meanUtilizationPercentAllEngines = $(if ($window.Count) { [Math]::Round((($window | Measure-Object total -Average).Average), 3) } else { $null })
        meanUtilizationPercent3d = $(if ($window.Count) { [Math]::Round((($window | Measure-Object engine3d -Average).Average), 3) } else { $null })
        maxUtilizationPercent3d = $(if ($window.Count) { [Math]::Round((($window | Measure-Object engine3d -Maximum).Maximum), 3) } else { $null })
        errors = @($gpu | Where-Object { $_.error } | ForEach-Object { $_.error } | Select-Object -Unique)
      })
      $checks['perfMeasured'] = ([double]$receipt.perf.cpuWindowMs -gt 7000) -and ([int]$receipt.perf.frames.count -gt 10)
    }
    $receipt | Add-Member -NotePropertyName islandCommands -NotePropertyValue (@($commands | Group-Object | ForEach-Object { $_.Name + ' x' + $_.Count }))
    $receipt | Add-Member -NotePropertyName checks -NotePropertyValue $checks
    $receipts += $receipt
    $failing = @($checks.Keys | Where-Object { $checks[$_] -ne $true })
    $perfText = if ($run.perf) { (' cpu={0}%core fps={1} p95={2}ms gpu3d={3}%' -f $receipt.perf.cpuPercentOneCore, $receipt.perf.frames.fps, $receipt.perf.frames.p95Ms, $receipt.perf.gpu.meanUtilizationPercent3d) } else { '' }
    Write-Output ('{0}: edge={1} animate={2} chips={3}{4} failing=[{5}]' -f $run.name, $receipt.edge, $receipt.animate, $chips.Count, $perfText, ($failing -join ','))
  } finally {
    if ($fakeHost -and -not $fakeHost.HasExited) { Stop-Process -Id $fakeHost.Id -Force }
    $port += 1
  }
}

$battery = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1)
$display = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.CurrentRefreshRate } | ForEach-Object { [ordered]@{ name = $_.Name; refreshHz = $_.CurrentRefreshRate } })
$summary = [ordered]@{
  milestone = 'M-A-3 T13.3 Gate H'
  purpose = 'Native Notch evidence: per-chip character skins (all five styles), the four edge placements with Gada as the active speaker and the others marked working, high contrast, intensity off/subtle, reduced motion, and measured CPU / frame timing / GPU cost per style.'
  fixture = 'FIXTURE Host only (test-results/ma3/t13-3/gate-h/notch/fake-host-styles.mjs on 43920-43959): personalAgents, characterAppearance and personalAgentContext are labeled fixture data. No production Host.'
  method = 'Island -SmokeTest with a hook that stops the poll timer, shadows $SmokeTest and calls the Island''s own Set-BunnyMotionMode. CPU: process TotalProcessorTime over 8 s with no frame callback. Frames: CompositionTarget.Rendering timestamps over 4 s (subscribing drives a callback every vsync, so this measures UI-thread frame cadence under the animation, not idle cost). GPU: Windows GPU Engine utilization counters for the Island process, sampled once a second by this runner.'
  battery = [ordered]@{ present = ($battery.Count -gt 0); status = $(if ($battery.Count) { [int]$battery[0].BatteryStatus } else { $null }); measured = $false; reason = 'NOT MEASURED: per-process energy is not exposed without SRUM/administrator tooling, the runs are seconds long and the laptop reports AC power (BatteryStatus 2). CPU and GPU utilization above are the proxies.' }
  displays = $display
  compactArt = [ordered]@{ nativeWidth = $nativeWidth; nativeHeight = $nativeHeight; pixelDecodeWidth = $pixelWidth }
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  runs = $receipts
}
[IO.File]::WriteAllText((Join-Path $here 'style-receipts.json'), ($summary | ConvertTo-Json -Depth 10), $utf8)
$failed = @($receipts | Where-Object { @($_.checks.Values | Where-Object { $_ -ne $true }).Count -gt 0 })
Write-Output ('receipts written: ' + $receipts.Count + '; runs with a failing check: ' + $failed.Count)
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
