# M-A-3 T10 notch evidence driver. For each edge and voice state it starts a DISPOSABLE fake Host on a port in
# 43800-43899, runs the Island in -SmokeTest against it, saves a screenshot, and records the window rect and work area.
# Scratch files (credential, preference, hook, logs of the Island's commands) go to a temp directory, never production.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File run-notch.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$shots = $here
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t10-notch-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$node = (Get-Command node).Source
$utf8 = [Text.UTF8Encoding]::new($false)

function Wait-FakeHost([int]$Port) {
  for ($i = 0; $i -lt 50; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $Port + '/state') -Headers @{ Authorization = 'Bearer notch-fake-token' } -TimeoutSec 2
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 150
  }
  return $false
}

# Each run: name, edge, Island view (idle = collapsed notch, voice = voice panel open), voice mode, motion.
$runs = @()
foreach ($edge in @('top', 'bottom', 'left', 'right')) {
  $runs += @{ name = "$edge-idle"; edge = $edge; view = 'idle'; voice = 'idle'; motion = 'full' }
  $runs += @{ name = "$edge-voice-idle"; edge = $edge; view = 'voice'; voice = 'idle'; motion = 'full' }
  $runs += @{ name = "$edge-listening"; edge = $edge; view = 'voice'; voice = 'listening'; motion = 'full' }
  $runs += @{ name = "$edge-speaking"; edge = $edge; view = 'voice'; voice = 'speaking'; motion = 'full' }
}
$runs += @{ name = 'reduced-motion-top-idle'; edge = 'top'; view = 'idle'; voice = 'listening'; motion = 'reduced' }

$receipts = @()
$port = 43801
foreach ($run in $runs) {
  $logPath = Join-Path $work ($run.name + '.commands.jsonl')
  $hostOut = Join-Path $work ($run.name + '.host.log')
  $fakeHost = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$port, $run.voice, $logPath) -WindowStyle Hidden -PassThru -RedirectStandardError $hostOut
  try {
    if (-not (Wait-FakeHost $port)) { throw ('fake host did not start on ' + $port) }
    $cred = Join-Path $work 'cred.json'
    [IO.File]::WriteAllText($cred, (@{ token = 'notch-fake-token'; port = $port } | ConvertTo-Json -Compress), $utf8)
    $pref = Join-Path $work 'pref.json'
    [IO.File]::WriteAllText($pref, (@{ edge = $run.edge; position = 'center'; size = 'compact'; motion = $run.motion; theme = 'dark'; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5 } | ConvertTo-Json -Compress), $utf8)
    $receiptPath = Join-Path $work ($run.name + '.receipt.json')
    $view = if ($run.view -eq 'voice') { "Set-BunnyView 'voice'" } else { "Set-BunnyView 'idle'" }
    $hook = @"
`$ErrorActionPreference = 'Stop'
Update-Bunny
$view
Update-Bunny
Update-Bunny
`$shot = Save-BunnyScreenshot '$($run.name)'
`$area = [Windows.SystemParameters]::WorkArea
`$receipt = [ordered]@{
  name = '$($run.name)'; edge = `$bunnyPreferences.edge; view = `$bunnyView; voiceFake = '$($run.voice)'; motion = `$bunnyPreferences.motion
  window = [ordered]@{ left = `$bunnyWindow.Left; top = `$bunnyWindow.Top; width = `$bunnyWindow.Width; height = `$bunnyWindow.Height }
  workArea = [ordered]@{ left = `$area.Left; top = `$area.Top; width = `$area.Width; height = `$area.Height }
  orientation = `$bunnyPlacement.Orientation; indicatorSide = `$bunnyPlacement.IndicatorSide; rootOrientation = `$bunnyVisualRoot.Orientation.ToString()
  agentCount = @(Get-BunnyActiveAgents).Count; indicatorChips = `$bunnyControls.AgentStrip.Children.Count; indicatorVisibility = `$bunnyControls.AgentStrip.Visibility.ToString()
  voiceHeadline = `$bunnyControls.VoiceHeadline.Text; screenshot = `$shot
}
[IO.File]::WriteAllText('$receiptPath', (`$receipt | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new(`$false))
"@
    $hookPath = Join-Path $work ($run.name + '.hook.ps1')
    [IO.File]::WriteAllText($hookPath, $hook, $utf8)
    $deploy = Join-Path $work 'no-deploy'
    $prefRun = powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'wrapper.ps1') -HookFile $hookPath -Pref $pref -Shots $shots -Cred $cred -Deploy $deploy
    $exit = $LASTEXITCODE
    if ($exit -ne 0 -or -not (Test-Path -LiteralPath $receiptPath)) { throw ('island run ' + $run.name + ' exit ' + $exit + ' ' + ($prefRun | Out-String)) }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $commands = @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue | ForEach-Object { ($_ | ConvertFrom-Json).action })
    $receipt | Add-Member -NotePropertyName islandCommands -NotePropertyValue (@($commands | Group-Object | ForEach-Object { $_.Name + ' x' + $_.Count }))
    # Computed checks for the V-ids. V49: the window rect is inside the primary work area. V47/V48: orientation and
    # indicator side follow the edge through the one shared rule (top/bottom horizontal + indicators left; left/right vertical + indicators above).
    $wa = $receipt.workArea; $wr = $receipt.window
    $inside = ($wr.left -ge $wa.left - 0.01) -and ($wr.top -ge $wa.top - 0.01) -and (($wr.left + $wr.width) -le ($wa.left + $wa.width + 0.01)) -and (($wr.top + $wr.height) -le ($wa.top + $wa.height + 0.01))
    $vertical = ($receipt.edge -eq 'left') -or ($receipt.edge -eq 'right')
    $checks = [ordered]@{
      V49_insideWorkArea = [bool]$inside
      V47_horizontalWithIndicatorsLeft = ((-not $vertical) -and $receipt.orientation -eq 'horizontal' -and $receipt.indicatorSide -eq 'left')
      V48_verticalWithIndicatorsAbove = ($vertical -and $receipt.orientation -eq 'vertical' -and $receipt.indicatorSide -eq 'top')
    }
    $receipt | Add-Member -NotePropertyName checks -NotePropertyValue $checks
    $receipts += $receipt
    Write-Output ('{0}: edge={1} window={2},{3} {4}x{5} workArea={6},{7} {8}x{9} orientation={10} chips={11} voice="{12}"' -f $run.name, $receipt.edge, $receipt.window.left, $receipt.window.top, $receipt.window.width, $receipt.window.height, $receipt.workArea.left, $receipt.workArea.top, $receipt.workArea.width, $receipt.workArea.height, $receipt.orientation, $receipt.indicatorChips, $receipt.voiceHeadline)
  } finally {
    if ($fakeHost -and -not $fakeHost.HasExited) { Stop-Process -Id $fakeHost.Id -Force }
    $port += 1
  }
}
$summary = [ordered]@{
  milestone = 'M-A-3 T10'; purpose = 'Island notch placement receipts from disposable fake-Host smoke runs. V47: top/bottom notch is horizontal with indicators on the left. V48: left/right notch is vertical with indicators above. V49: every notch rect is inside the primary WorkArea.'
  fixture = 'fake Host: two RUNNING agents (Builder, Reviewer) and one WAITING_FOR_USER agent (Deployer); no real Host, no production port'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o'); runs = $receipts
}
[IO.File]::WriteAllText((Join-Path $here 'placement-receipts.json'), ($summary | ConvertTo-Json -Depth 8), $utf8)
Write-Output ('receipts written: ' + $receipts.Count)
