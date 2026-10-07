$ErrorActionPreference='Stop'
$env:BUNNY_MISSIONS='1'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$stage=Join-Path $env:LOCALAPPDATA 'Bunny-A-R1-stage'
$config=Get-Content -LiteralPath (Join-Path $stage 'install.json') -Raw | ConvertFrom-Json
if($config.currentRelease.name -ne 'Bunny-A-Windows-v26-MA2-R1') {throw 'Unexpected stage release'}
& (Join-Path $config.currentRelease.folder 'Start-Bunny-Release.ps1') -NoIsland -NoGateway -NoRemote
Invoke-RestMethod 'http://127.0.0.1:46129/health' | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'stage-health.json') -Encoding utf8
