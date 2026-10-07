$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$stage=Join-Path $env:LOCALAPPDATA 'Bunny-A-R1-stage'
$pin=Get-Content 'install/release-pin.json' -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path (Join-Path $stage 'startup') -Force | Out-Null
& ./scripts/install-bunny-release.ps1 -Package (Join-Path $repo ('releases/'+$pin.release+'.zip')) -InstallRoot $stage -DataDirectory (Join-Path $stage 'state') -Workspace (Join-Path $env:USERPROFILE 'Bunny-Workspace-R1-stage') -StartupDirectory (Join-Path $stage 'startup') -HostPort 46129 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'stage-install.json') -Encoding utf8
$env:BUNNY_MISSIONS='1'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
& (Join-Path $stage ('releases/'+$pin.release+'/Start-Bunny-Release.ps1')) -NoIsland -NoGateway -NoRemote
Invoke-RestMethod 'http://127.0.0.1:46129/health' | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'stage-health.json') -Encoding utf8
'Only the isolated R1 staged Host was installed and started.'
