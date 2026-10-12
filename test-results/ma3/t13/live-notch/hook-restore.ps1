# M-A-3 T13 LIVE relaunch hook: a second Island process started with the SAME preference file as the dock run. It reads back the
# restored edge, offset and monitor and the placed window, changes nothing, and writes $env:T13_LIVE_OUT\$env:T13_LIVE_RUN.json.
$ErrorActionPreference = 'Stop'
$liveOut = $env:T13_LIVE_OUT
$runName = $env:T13_LIVE_RUN
Update-Bunny
Start-Sleep -Milliseconds 400
Update-Bunny
$area = Get-BunnyTargetArea
$shot = Save-BunnyScreenshot ($runName + '-restored-start')
$chips = @($bunnyControls.AgentStrip.Children | ForEach-Object { [string][Windows.Automation.AutomationProperties]::GetName($_) })
$receipt = [ordered]@{
  run = $runName; kind = 'relaunch'; scale = [double](Get-BunnyDeviceScale).X
  restoredPreferences = [ordered]@{ edge = [string]$bunnyPreferences.edge; edgeOffset = [double]$bunnyPreferences.edgeOffset; monitor = $bunnyPreferences.monitor; position = [string]$bunnyPreferences.position }
  window = [ordered]@{ left = [double]$bunnyWindow.Left; top = [double]$bunnyWindow.Top; width = [double]$bunnyWindow.Width; height = [double]$bunnyWindow.Height }
  workArea = [ordered]@{ left = [double]$area.Left; top = [double]$area.Top; width = [double]$area.Width; height = [double]$area.Height }
  orientation = [string]$bunnyPlacement.Orientation; indicatorSide = [string]$bunnyPlacement.IndicatorSide
  expandDirection = [string](Get-BunnyExpandDirection $bunnyPreferences.edge); chipNames = $chips
  companionState = ([string]$script:bunnyCompanionKey -split '\|')[0]; online = [bool]$bunnyOnline
  lastError = [string]$bunnyLastError; screenshot = [string]$shot
}
[IO.File]::WriteAllText((Join-Path $liveOut ($runName + '.json')), ($receipt | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
