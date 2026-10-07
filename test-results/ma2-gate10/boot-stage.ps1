$ErrorActionPreference='Stop'
$stage='C:\Users\allam\AppData\Local\Bunny-A-T10-stage'
$config=Get-Content -LiteralPath (Join-Path $stage 'install.json') -Raw | ConvertFrom-Json
$markerPath=Join-Path $stage 'state\state-layout.json'
$marker=Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
$marker.stateRoot=$config.stateRoot
$marker | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $markerPath -Encoding ascii
$env:BUNNY_MISSIONS='1'
& (Join-Path $config.currentRelease.folder 'Start-Bunny-Release.ps1') -NoIsland -NoGateway -NoRemote
Invoke-RestMethod 'http://127.0.0.1:45129/health' | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'stage-health.json') -Encoding utf8
