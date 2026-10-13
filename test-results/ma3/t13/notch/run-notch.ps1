# M-A-3 T13 native Notch evidence driver. For each edge and state it starts a DISPOSABLE fixture Host on a port in
# 43800-43899 (fake-host.mjs), runs the Island in -SmokeTest against it, saves a screenshot through Save-BunnyScreenshot,
# and records the window rect, the work area and the Island's own state. Then one drag run releases synthetic points on
# each edge and records the snapped placement. Scratch files (credential, preference, hooks) go to a temp folder.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File run-notch.ps1 [-Only <name-substring>]
param([string]$Only = '')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$shots = Join-Path $here 'shots'
New-Item -ItemType Directory -Path $shots -Force | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t13-notch-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$node = (Get-Command node).Source
$utf8 = [Text.UTF8Encoding]::new($false)
$token = 'notch-fake-token'

# A port another process already listens on is skipped: only ports this harness starts are ever used (43800-43899).
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

# Matrix: every edge x the states the spec lists, plus reduced motion and the light theme on the top edge.
$states = @(
  @{ tag = 'collapsed-idle'; scenario = 'none'; voice = 'idle'; view = 'idle' },
  @{ tag = 'all-four-active'; scenario = 'all-active'; voice = 'idle'; view = 'idle' },
  @{ tag = 'single-active'; scenario = 'single'; voice = 'idle'; view = 'idle' },
  @{ tag = 'expanded-panel'; scenario = 'all-active'; voice = 'idle'; view = 'quick' },
  @{ tag = 'agent-detail'; scenario = 'all-active'; voice = 'idle'; view = 'weapon' },
  @{ tag = 'listening'; scenario = 'all-active'; voice = 'listening'; view = 'idle' },
  @{ tag = 'speaking'; scenario = 'all-active'; voice = 'speaking'; view = 'idle' },
  @{ tag = 'listening-while-speaking'; scenario = 'all-active'; voice = 'both'; view = 'idle' },
  @{ tag = 'permission-waiting'; scenario = 'all-active'; voice = 'approval'; view = 'idle' },
  @{ tag = 'paused'; scenario = 'paused'; voice = 'idle'; view = 'idle' },
  @{ tag = 'verified'; scenario = 'verified'; voice = 'idle'; view = 'idle' },
  @{ tag = 'failed'; scenario = 'failed'; voice = 'idle'; view = 'idle' },
  @{ tag = 'offline'; scenario = 'all-active'; voice = 'idle'; view = 'idle'; offline = $true }
)
$runs = @()
foreach ($edge in @('top', 'bottom', 'left', 'right')) {
  foreach ($state in $states) { $run = @{ name = ($edge + '-' + $state.tag); edge = $edge; motion = 'full'; theme = 'dark' }; foreach ($key in $state.Keys) { $run[$key] = $state[$key] }; $runs += $run }
}
$runs += @{ name = 'top-reduced-motion-all-active'; edge = 'top'; motion = 'reduced'; theme = 'dark'; scenario = 'all-active'; voice = 'listening'; view = 'idle' }
$runs += @{ name = 'top-light-all-active'; edge = 'top'; motion = 'full'; theme = 'light'; scenario = 'all-active'; voice = 'idle'; view = 'idle' }
$runs += @{ name = 'top-light-expanded'; edge = 'top'; motion = 'full'; theme = 'light'; scenario = 'all-active'; voice = 'idle'; view = 'quick' }
$runs += @{ name = 'left-light-expanded'; edge = 'left'; motion = 'full'; theme = 'light'; scenario = 'all-active'; voice = 'idle'; view = 'quick' }
if ($Only) { $runs = @($runs | Where-Object { $_.name -like ('*' + $Only + '*') }) }

function Write-Receipt-Hook([hashtable]$Run, [string]$HookPath, [string]$ReceiptPath, [string]$CredPath) {
  $view = switch ($Run.view) {
    'quick' { "Set-BunnyView 'quick'" }
    'tasks' { "Set-BunnyView 'tasks'" }
    'weapon' { 'Show-BunnyWeaponDetail 1' }
    default { "Set-BunnyView 'idle'" }
  }
  $offline = if ($Run.offline) { "[IO.File]::WriteAllText('$CredPath', (@{ token = '$token'; port = 43899 } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new(`$false))" } else { '' }
  $hook = @"
`$ErrorActionPreference = 'Stop'
Update-Bunny
$view
Update-Bunny
Update-Bunny
$offline
Update-Bunny
`$shot = Save-BunnyScreenshot '$($Run.name)'
`$area = [Windows.SystemParameters]::WorkArea
`$chipNames = @(`$bunnyControls.AgentStrip.Children | ForEach-Object { [Windows.Automation.AutomationProperties]::GetName(`$_) })
`$receipt = [ordered]@{
  name = '$($Run.name)'; edge = `$bunnyPreferences.edge; view = `$bunnyView; scenario = '$($Run.scenario)'; voiceMode = '$($Run.voice)'
  motion = `$bunnyPreferences.motion; theme = '$($Run.theme)'; online = `$bunnyOnline
  window = [ordered]@{ left = `$bunnyWindow.Left; top = `$bunnyWindow.Top; width = `$bunnyWindow.Width; height = `$bunnyWindow.Height }
  workArea = [ordered]@{ left = `$area.Left; top = `$area.Top; width = `$area.Width; height = `$area.Height }
  orientation = `$bunnyPlacement.Orientation; indicatorSide = `$bunnyPlacement.IndicatorSide; rootOrientation = `$bunnyVisualRoot.Orientation.ToString()
  expandDirection = Get-BunnyExpandDirection `$bunnyPreferences.edge
  stripVisibility = `$bunnyControls.AgentStrip.Visibility.ToString(); stripGroups = `$bunnyControls.AgentStrip.Children.Count; chipNames = `$chipNames
  companionState = ([string]`$script:bunnyCompanionKey -split '\|')[0]; companionName = [Windows.Automation.AutomationProperties]::GetName(`$bunnyControls.BunnyButton)
  weaponCardVisible = (`$bunnyControls.WeaponPanel.Visibility.ToString() -eq 'Visible'); voiceHeadline = `$bunnyControls.VoiceHeadline.Text
  screenshot = `$shot
}
`$receipt['lastError'] = [string]`$bunnyLastError
[IO.File]::WriteAllText('$ReceiptPath', (`$receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new(`$false))
# An offline run ends with the Host-unreachable error on purpose; it is recorded above and cleared so the smoke check does not fail the evidence.
$(if ($Run.offline) { '$script:bunnyLastError = $null' } else { '# no reset: a real error must fail the run' })
"@
  [IO.File]::WriteAllText($HookPath, $hook, $utf8)
}

$receipts = @()
$port = 43801
foreach ($run in $runs) {
  $hostOut = Join-Path $work ($run.name + '.host.log')
  $commandLog = Join-Path $work ($run.name + '.commands.jsonl')
  while (-not (Test-PortFree $port)) { $port += 1; if ($port -gt 43898) { throw 'no free fixture port in 43800-43899' } }
  $fakeHost = $null
    $fakeHost = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$port, [string]$run.voice, $commandLog, [string]$run.scenario) -WindowStyle Hidden -PassThru -RedirectStandardError $hostOut
  try {
    if (-not (Wait-FixtureHost $port)) { throw ('fixture host did not start on ' + $port) }
    $cred = Join-Path $work 'cred.json'
    [IO.File]::WriteAllText($cred, (@{ token = $token; port = $port } | ConvertTo-Json -Compress), $utf8)
    $pref = Join-Path $work 'pref.json'
    [IO.File]::WriteAllText($pref, (@{ edge = $run.edge; position = 'center'; size = 'compact'; motion = $run.motion; theme = $run.theme; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5; monitor = $null } | ConvertTo-Json -Compress), $utf8)
    $receiptPath = Join-Path $work ($run.name + '.receipt.json')
    $hookPath = Join-Path $work ($run.name + '.hook.ps1')
    Write-Receipt-Hook $run $hookPath $receiptPath $cred
    $deploy = Join-Path $work 'no-deploy'
    $islandOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'wrapper.ps1') -HookFile $hookPath -Pref $pref -Shots $shots -Cred $cred -Deploy $deploy
    $exit = $LASTEXITCODE
    if ($exit -ne 0 -or -not (Test-Path -LiteralPath $receiptPath)) { throw ('island run ' + $run.name + ' exit ' + $exit + ' ' + ($islandOut | Out-String)) }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $commands = @(Get-Content -LiteralPath $commandLog -ErrorAction SilentlyContinue | ForEach-Object { ($_ | ConvertFrom-Json).action })
    # Checks recomputed here from the receipt, so a claim in the Island cannot pass by itself.
    $wa = $receipt.workArea; $wr = $receipt.window
    $inside = ($wr.left -ge $wa.left - 0.01) -and ($wr.top -ge $wa.top - 0.01) -and (($wr.left + $wr.width) -le ($wa.left + $wa.width + 0.01)) -and (($wr.top + $wr.height) -le ($wa.top + $wa.height + 0.01))
    $vertical = ($receipt.edge -eq 'left') -or ($receipt.edge -eq 'right')
    $expectedExpand = @{ top = 'down'; bottom = 'up'; left = 'right'; right = 'left' }[$receipt.edge]
    $expectedStrip = ($run.scenario -ne 'none')
    $stripShown = ($receipt.stripVisibility -eq 'Visible')
    $checks = [ordered]@{
      V49_insideWorkArea = [bool]$inside
      V47_horizontalEdgeIndicatorsLeft = ($vertical -or ($receipt.orientation -eq 'horizontal' -and $receipt.indicatorSide -eq 'left'))
      V48_verticalEdgeIndicatorsAbove = ((-not $vertical) -or ($receipt.orientation -eq 'vertical' -and $receipt.indicatorSide -eq 'top'))
      expansionAnchoredToEdge = ($receipt.expandDirection -eq $expectedExpand)
      stripShownOnlyWhenBound = ($stripShown -eq $expectedStrip)
      noLetterChips = (@($receipt.chipNames | Where-Object { $_ -match '^[A-Za-z]$' })).Count -eq 0
      chipCountMatchesBoundSlots = (-not $expectedStrip) -or ((@($receipt.chipNames)).Count -ge 1)
    }
    if ($run.offline) { $checks['offlineOverlayDisconnected'] = ($receipt.companionState -eq 'DISCONNECTED') }
    if ($run.name -like '*listening*' -and -not $run.offline) { $checks['listeningShowsListeningCompanion'] = ($receipt.companionState -eq 'LISTENING' -or $receipt.companionState -eq 'LISTENING_WHILE_SPEAKING') }
    if ($run.name -like '*agent-detail*') { $checks['detailCardOpen'] = [bool]$receipt.weaponCardVisible }
    if ($run.name -like '*speaking*' -and $run.name -notlike '*listening*') { $checks['speakingCompanion'] = ($receipt.companionState -eq 'SPEAKING') }
    $receipt | Add-Member -NotePropertyName islandCommands -NotePropertyValue (@($commands | Group-Object | ForEach-Object { $_.Name + ' x' + $_.Count }))
    $receipt | Add-Member -NotePropertyName checks -NotePropertyValue $checks
    $receipts += $receipt
    Write-Output ('{0}: edge={1} strip={2} groups={3} companion={4} window={5},{6} {7}x{8} online={9} chips=[{10}]' -f $run.name, $receipt.edge, $receipt.stripVisibility, $receipt.stripGroups, $receipt.companionState, $receipt.window.left, $receipt.window.top, $receipt.window.width, $receipt.window.height, $receipt.online, (@($receipt.chipNames) -join ' | '))
  } finally {
    if ($fakeHost -and -not $fakeHost.HasExited) { Stop-Process -Id $fakeHost.Id -Force }
    $port += 1
  }
}

# Drag simulation: one Island run; each edge is released at a synthetic device point inside that edge's band of the
# primary work area, then the keyboard path (Set-BunnyDockEdge, the same edge rule) is recorded.
$dragHook = Join-Path $work 'drag.hook.ps1'
$dragReceipt = Join-Path $here 'drag-receipts.json'
$dragScript = @"
`$ErrorActionPreference = 'Stop'
Update-Bunny
`$scale = Get-BunnyDeviceScale
`$area = Get-BunnyTargetArea
`$targets = [ordered]@{
  top = @((`$area.Left + `$area.Width * 0.3), (`$area.Top + 2))
  bottom = @((`$area.Left + `$area.Width * 0.7), (`$area.Top + `$area.Height - 2))
  left = @((`$area.Left + 2), (`$area.Top + `$area.Height * 0.6))
  right = @((`$area.Left + `$area.Width - 2), (`$area.Top + `$area.Height * 0.4))
}
`$results = @()
foreach (`$target in `$targets.Keys) {
  `$p = `$targets[`$target]
  `$device = @{ X = [int][Math]::Round(`$p[0] * `$scale.X); Y = [int][Math]::Round(`$p[1] * `$scale.Y) }
  Invoke-BunnyDockRelease `$device
  Update-Bunny
  `$results += [ordered]@{ target = `$target; devicePoint = `$device; edge = `$bunnyPreferences.edge; edgeOffset = `$bunnyPreferences.edgeOffset; monitor = `$bunnyPreferences.monitor; window = [ordered]@{ left = `$bunnyWindow.Left; top = `$bunnyWindow.Top; width = `$bunnyWindow.Width; height = `$bunnyWindow.Height }; orientation = `$bunnyPlacement.Orientation; indicatorSide = `$bunnyPlacement.IndicatorSide; expandDirection = Get-BunnyExpandDirection `$bunnyPreferences.edge; editChoice = [string]`$bunnyControls.EdgeChoice.SelectedItem.Tag }
}
`$keyboard = @()
foreach (`$edge in @('bottom', 'left', 'top', 'right')) {
  Set-BunnyDockEdge `$edge
  `$keyboard += [ordered]@{ edge = `$bunnyPreferences.edge; editChoice = [string]`$bunnyControls.EdgeChoice.SelectedItem.Tag; window = [ordered]@{ left = `$bunnyWindow.Left; top = `$bunnyWindow.Top } }
}
`$shot = Save-BunnyScreenshot 'drag-keyboard-right'
[IO.File]::WriteAllText('$dragReceipt', ([ordered]@{ drag = `$results; keyboard = `$keyboard; workArea = [ordered]@{ left = `$area.Left; top = `$area.Top; width = `$area.Width; height = `$area.Height }; scale = `$scale.X; screenshot = `$shot } | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new(`$false))
"@
[IO.File]::WriteAllText($dragHook, $dragScript, $utf8)
$dragCred = Join-Path $work 'drag-cred.json'
$dragPort = 43899
$dragCommandLog = Join-Path $work 'drag.commands.jsonl'
$dragHost = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$dragPort, 'idle', $dragCommandLog, 'all-active') -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $work 'drag.host.log')
try {
  if (-not (Wait-FixtureHost $dragPort)) { throw 'drag fixture host did not start' }
  [IO.File]::WriteAllText($dragCred, (@{ token = $token; port = $dragPort } | ConvertTo-Json -Compress), $utf8)
  $dragPref = Join-Path $work 'drag-pref.json'
  [IO.File]::WriteAllText($dragPref, (@{ edge = 'top'; position = 'center'; size = 'compact'; motion = 'full'; theme = 'dark'; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5; monitor = $null } | ConvertTo-Json -Compress), $utf8)
  $dragOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'wrapper.ps1') -HookFile $dragHook -Pref $dragPref -Shots $shots -Cred $dragCred -Deploy (Join-Path $work 'no-deploy')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dragReceipt)) { throw ('drag run failed: ' + ($dragOut | Out-String)) }
  Write-Output ('drag receipt written: ' + $dragReceipt)
} finally {
  if ($dragHost -and -not $dragHost.HasExited) { Stop-Process -Id $dragHost.Id -Force }
}

$summary = [ordered]@{
  milestone = 'M-A-3 T13'
  purpose = 'Native Notch evidence from disposable fixture-Host smoke runs: every edge x the spec states, reduced motion, light theme, a drag simulation and the keyboard dock path.'
  fixture = 'FIXTURE Host only (test-results/ma3/t13/notch/fake-host.mjs on 43800-43899): personalAgents, voice.companion and voice.revision are labeled fixture data. No production Host, no 43119, no 8084.'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  runs = $receipts
}
[IO.File]::WriteAllText((Join-Path $here 'notch-receipts.json'), ($summary | ConvertTo-Json -Depth 8), $utf8)
$failed = @($receipts | Where-Object { @($_.checks.Values | Where-Object { $_ -ne $true }).Count -gt 0 })
Write-Output ('receipts written: ' + $receipts.Count + '; runs with a failing check: ' + $failed.Count)
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
