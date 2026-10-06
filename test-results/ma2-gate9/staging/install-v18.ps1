$ErrorActionPreference = 'Stop'
$stageRoot = 'C:\Users\allam\AppData\Local\Bunny-A-T9-stage'
$stageState = Join-Path $stageRoot 'state'
$repo = 'C:\Users\allam\Documents\new\bun-router'
$package = Join-Path $repo 'releases\Bunny-A-Windows-v20-T9'
$stageCredentials = Get-Content -LiteralPath (Join-Path $stageState 'credentials\credentials.json') -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $stageCredentials.token }
$before = Invoke-RestMethod 'http://127.0.0.1:44119/health' -Headers $headers
if ($before.app -ne 'Bunny-A' -or $before.pid -ne $stageCredentials.pid -or $before.instanceId -ne $stageCredentials.instanceId) { throw 'Stage identity mismatch.' }
$snapshot = Invoke-RestMethod 'http://127.0.0.1:44119/state' -Headers $headers
foreach ($mission in @($snapshot.missions.missions | Where-Object { $_.state -notin @('completed','failed','stopped') -and $_.title.StartsWith('T9 v18') })) {
  $stopBody = @{ action = 'mission.stop'; data = @{ id = $mission.id } } | ConvertTo-Json -Depth 4 -Compress
  Invoke-RestMethod 'http://127.0.0.1:44119/command' -Method Post -Headers $headers -ContentType 'application/json' -Body $stopBody | Out-Null
}
$snapshot = Invoke-RestMethod 'http://127.0.0.1:44119/state' -Headers $headers
if (@($snapshot.missions.missions | Where-Object state -notin @('completed','failed','stopped')).Count -or @($snapshot.tasks | Where-Object state -in @('running','launching','verifying')).Count) { throw 'Stage has active work.' }
$owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $before.pid)
if (-not $owner.ExecutablePath.StartsWith($stageRoot + '\releases\') -or -not $owner.CommandLine.Contains($stageRoot + '\releases\') -or -not $owner.CommandLine.Contains('Bunny-Host.mjs')) { throw 'Stage process ownership mismatch.' }
& (Join-Path $repo 'scripts\install-bunny-release.ps1') -Package $package -InstallRoot $stageRoot -StageOnly | Out-File (Join-Path $repo 'test-results\ma2-gate9\v20-stage-only.json') -Encoding utf8
Stop-Process -Id $owner.ProcessId
Start-Sleep -Milliseconds 750
& (Join-Path $repo 'scripts\install-bunny-release.ps1') -Package $package -InstallRoot $stageRoot -DataDirectory $stageState -Workspace 'C:\Users\allam\Bunny-Workspace-T9-stage' -StartupDirectory (Join-Path $stageRoot 'startup') -HostPort 44119 | Out-File (Join-Path $repo 'test-results\ma2-gate9\v20-stage-install.json') -Encoding utf8
& (Join-Path $stageRoot 'releases\Bunny-A-Windows-v20-T9\Start-Bunny-Release.ps1') -NoIsland -NoGateway -NoRemote
$after = Invoke-RestMethod 'http://127.0.0.1:44119/health'
[ordered]@{ before = @{ pid = $before.pid; instanceId = $before.instanceId }; after = $after; processIdentityCorroborated = $true; productionTouched = $false; release = 'Bunny-A-Windows-v20-T9' } | ConvertTo-Json -Depth 5 | Out-File (Join-Path $repo 'test-results\ma2-gate9\v20-stage-boot.json') -Encoding utf8
Write-Output 'Only the corroborated disposable T9 stage was switched; production untouched.'
