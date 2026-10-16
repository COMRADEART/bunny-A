# Visual Experience 2.0 native Notch evidence driver (adapted from test-results/ma3/t13/notch/run-notch.ps1).
# For each run it starts a DISPOSABLE fixture Host (fake-host.mjs, ports 43850-43889) that serves the real uiTheme view for one
# theme, runs the real Island in -SmokeTest against it, saves a native RenderTargetBitmap screenshot through
# Save-BunnyScreenshot, and records the window rect, work area, placement and the theme the Island actually applied.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File run-notch.ps1 -Runs <runs.json> -Out <dir>
param([Parameter(Mandatory = $true)][string]$Runs, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$shots = Join-Path $Out 'shots'
New-Item -ItemType Directory -Path $shots -Force | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-ve2-notch-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$node = (Get-Command node).Source
$utf8 = [Text.UTF8Encoding]::new($false)
$token = 'notch-fake-token'

function Test-PortFree([int]$Port) {
  try { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port); $listener.Start(); $listener.Stop(); return $true } catch { return $false }
}
# WCAG relative luminance of #RRGGBB or #AARRGGBB (alpha ignored: the body fill is at least 0xDA opaque).
function Get-BunnyLuminance([string]$Hex) {
  $h = $Hex.TrimStart('#'); if ($h.Length -eq 8) { $h = $h.Substring(2) }
  $c = @(0, 1, 2 | ForEach-Object { $v = [Convert]::ToInt32($h.Substring($_ * 2, 2), 16) / 255; if ($v -le 0.03928) { $v / 12.92 } else { [Math]::Pow(($v + 0.055) / 1.055, 2.4) } })
  return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2]
}
function Get-BunnyContrast([string]$A, [string]$B) {
  $x = Get-BunnyLuminance $A; $y = Get-BunnyLuminance $B
  return ([Math]::Max($x, $y) + 0.05) / ([Math]::Min($x, $y) + 0.05)
}
function Wait-FixtureHost([int]$Port) {
  for ($i = 0; $i -lt 80; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $Port + '/state') -Headers @{ Authorization = 'Bearer ' + $token } -TimeoutSec 2
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 150
  }
  return $false
}

$runList = Get-Content -LiteralPath $Runs -Raw | ConvertFrom-Json
$receipts = @()
$port = 43850
foreach ($run in $runList) {
  $hostOut = Join-Path $work ($run.name + '.host.log')
  $commandLog = Join-Path $work ($run.name + '.commands.jsonl')
  while (-not (Test-PortFree $port)) { $port += 1; if ($port -gt 43889) { $port = 43850 } }
  $fakeHost = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$port, 'idle', $commandLog, [string]$run.scenario, [string]$run.theme, [string]$run.variant, $(if ($run.hc) { 'hc' } else { 'no' }), $(if ($null -ne $run.revision) { [string]$run.revision } else { '1' })) -WindowStyle Hidden -PassThru -RedirectStandardError $hostOut
  try {
    if (-not (Wait-FixtureHost $port)) { throw ('fixture host did not start on ' + $port + ': ' + (Get-Content -LiteralPath $hostOut -Raw -ErrorAction SilentlyContinue)) }
    $cred = Join-Path $work 'cred.json'
    [IO.File]::WriteAllText($cred, (@{ token = $token; port = $port } | ConvertTo-Json -Compress), $utf8)
    $pref = Join-Path $work 'pref.json'
    [IO.File]::WriteAllText($pref, (@{ edge = $run.edge; position = 'center'; size = 'compact'; motion = 'full'; theme = 'dark'; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5; monitor = $null } | ConvertTo-Json -Compress), $utf8)
    $receiptPath = Join-Path $work ($run.name + '.receipt.json')
    $hookPath = Join-Path $work ($run.name + '.hook.ps1')
    $view = if ($run.view -eq 'quick') { "Set-BunnyView 'quick'" } else { "Set-BunnyView 'idle'" }
    $hook = @"
`$ErrorActionPreference = 'Stop'
Update-Bunny
$view
Update-Bunny
Update-Bunny
`$shot = Save-BunnyScreenshot '$($run.name)'
`$area = [Windows.SystemParameters]::WorkArea
`$glassBrush = `$bunnyControls.Glass.Background
`$firstStop = if (`$glassBrush -is [Windows.Media.LinearGradientBrush]) { `$glassBrush.GradientStops[0].Color.ToString() } else { [string]`$glassBrush }
`$receipt = [ordered]@{
  name = '$($run.name)'; edge = `$bunnyPreferences.edge; view = `$bunnyView; online = `$bunnyOnline
  appliedTheme = if (`$script:bunnyUiTheme) { `$script:bunnyUiTheme.Theme } else { 'default-glass' }
  appliedShape = if (`$script:bunnyUiTheme) { `$script:bunnyUiTheme.Shape } else { 'pill' }
  light = [bool]`$script:bunnyLight
  font = `$bunnyWindow.FontFamily.Source
  glassFirstStop = `$firstStop
  glassCorner = `$bunnyControls.Glass.CornerRadius.ToString()
  glassBorder = `$bunnyControls.Glass.BorderThickness.ToString()
  text = `$bunnyWindow.Resources['BunnyText'].Color.ToString()
  statusInk = `$bunnyControls.NotchStatus.Foreground.Color.ToString()
  window = [ordered]@{ left = `$bunnyWindow.Left; top = `$bunnyWindow.Top; width = `$bunnyWindow.Width; height = `$bunnyWindow.Height }
  workArea = [ordered]@{ left = `$area.Left; top = `$area.Top; width = `$area.Width; height = `$area.Height }
  orientation = `$bunnyPlacement.Orientation; indicatorSide = `$bunnyPlacement.IndicatorSide
  expandDirection = Get-BunnyExpandDirection `$bunnyPreferences.edge
  stripVisibility = `$bunnyControls.AgentStrip.Visibility.ToString(); stripGroups = `$bunnyControls.AgentStrip.Children.Count
  companionState = ([string]`$script:bunnyCompanionKey -split '\|')[0]
  screenshot = `$shot
}
`$receipt['lastError'] = [string]`$bunnyLastError
[IO.File]::WriteAllText('$receiptPath', (`$receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new(`$false))
"@
    [IO.File]::WriteAllText($hookPath, $hook, $utf8)
    $deploy = Join-Path $work 'no-deploy'
    $islandOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'wrapper.ps1') -HookFile $hookPath -Pref $pref -Shots $shots -Cred $cred -Deploy $deploy
    $exit = $LASTEXITCODE
    if ($exit -ne 0 -or -not (Test-Path -LiteralPath $receiptPath)) { throw ('island run ' + $run.name + ' exit ' + $exit + ' ' + ($islandOut | Out-String)) }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $commands = @(Get-Content -LiteralPath $commandLog -ErrorAction SilentlyContinue | ForEach-Object { ($_ | ConvertFrom-Json).action })
    $wa = $receipt.workArea; $wr = $receipt.window
    $inside = ($wr.left -ge $wa.left - 0.01) -and ($wr.top -ge $wa.top - 0.01) -and (($wr.left + $wr.width) -le ($wa.left + $wa.width + 0.01)) -and (($wr.top + $wr.height) -le ($wa.top + $wa.height + 0.01))
    $vertical = ($receipt.edge -eq 'left') -or ($receipt.edge -eq 'right')
    $expectedExpand = @{ top = 'down'; bottom = 'up'; left = 'right'; right = 'left' }[$receipt.edge]
    # Checks recomputed here from the receipt, so a claim in the Island cannot pass by itself.
    $checks = [ordered]@{
      # A run may state the appearance it must end in (revision-0 probe: the Notch's own setting, not the Host default).
      expectedLight = (($null -eq $run.expectLight) -or ([bool]$receipt.light -eq [bool]$run.expectLight))
      themeApplied = ($receipt.appliedTheme -eq $run.theme)
      insideWorkArea = [bool]$inside
      horizontalIndicatorsLeft = ($vertical -or ($receipt.orientation -eq 'horizontal' -and $receipt.indicatorSide -eq 'left'))
      verticalIndicatorsAbove = ((-not $vertical) -or ($receipt.orientation -eq 'vertical' -and $receipt.indicatorSide -eq 'top'))
      expansionAnchoredToEdge = ($receipt.expandDirection -eq $expectedExpand)
      stripShown = ($receipt.stripVisibility -eq 'Visible')
      noThemeCommandSent = (@($commands | Where-Object { $_ -like 'appearance.*' })).Count -eq 0
      noError = [string]::IsNullOrEmpty($receipt.lastError)
      # The visible status text must be readable on the body it sits on (a pixel-level claim, not just "a theme applied").
      statusReadable = ((Get-BunnyContrast $receipt.statusInk $receipt.glassFirstStop) -ge 4.5)
    }
    $receipt | Add-Member -NotePropertyName statusContrast -NotePropertyValue ([Math]::Round((Get-BunnyContrast $receipt.statusInk $receipt.glassFirstStop), 2))
    $receipt | Add-Member -NotePropertyName run -NotePropertyValue $run
    $receipt | Add-Member -NotePropertyName islandCommands -NotePropertyValue (@($commands | Group-Object | ForEach-Object { $_.Name + ' x' + $_.Count }))
    $receipt | Add-Member -NotePropertyName checks -NotePropertyValue $checks
    $receipts += $receipt
    $failed = @($checks.Keys | Where-Object { -not $checks[$_] })
    Write-Output ('{0}: theme={1} light={2} corner={3} border={4} font={5} fill={6} status={8} {7}' -f $run.name, $receipt.appliedTheme, $receipt.light, $receipt.glassCorner, $receipt.glassBorder, $receipt.font, $receipt.glassFirstStop, $(if ($failed.Count) { 'FAILED ' + ($failed -join ',') } else { 'ok' }), $receipt.statusContrast)
  } finally {
    if ($fakeHost -and -not $fakeHost.HasExited) { Stop-Process -Id $fakeHost.Id -Force }
    $port += 1
  }
}
$summary = [ordered]@{
  milestone = 'Visual Experience 2.0 Gate F'
  classification = 'LIVE native Island (install/Bunny-Island.ps1 -SmokeTest) against DISPOSABLE fixture Hosts serving the real uiTheme view'
  generatedAt = (Get-Date).ToString('o')
  runs = $receipts.Count
  allChecksPass = (@($receipts | Where-Object { @($_.checks.Values | Where-Object { -not $_ }).Count -gt 0 })).Count -eq 0
  receipts = $receipts
}
[IO.File]::WriteAllText((Join-Path $Out 'notch-receipts.json'), ($summary | ConvertTo-Json -Depth 8), $utf8)
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ('runs=' + $receipts.Count + ' allChecksPass=' + $summary.allChecksPass)
