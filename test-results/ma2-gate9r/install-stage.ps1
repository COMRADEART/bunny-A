$ErrorActionPreference='Stop'
$stageRoot='C:\Users\allam\AppData\Local\Bunny-A-T9R-stage'
$repo='C:\Users\allam\Documents\new\bun-router'
$pin=Get-Content -LiteralPath (Join-Path $repo 'install\release-pin.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path (Join-Path $stageRoot 'startup') -Force | Out-Null
& (Join-Path $repo 'scripts\install-bunny-release.ps1') -Package (Join-Path $repo ('releases\'+$pin.release)) -InstallRoot $stageRoot -DataDirectory (Join-Path $stageRoot 'state') -Workspace 'C:\Users\allam\Bunny-Workspace-T9R-stage' -StartupDirectory (Join-Path $stageRoot 'startup') -HostPort 45119 | Out-File -LiteralPath (Join-Path $PSScriptRoot 'stage-install.json') -Encoding utf8
$env:BUNNY_MISSIONS='1'
& (Join-Path $stageRoot ('releases\'+$pin.release+'\Start-Bunny-Release.ps1')) -NoIsland -NoGateway -NoRemote
$health=Invoke-RestMethod 'http://127.0.0.1:45119/health'
if($health.operationalState -ne 'healthy') { throw 'Staged Host is not healthy.' }
$health | ConvertTo-Json -Depth 4 | Out-File -LiteralPath (Join-Path $PSScriptRoot 'stage-health.json') -Encoding utf8
Write-Output 'Exact T9R candidate installed only in the isolated staged root; production untouched.'
