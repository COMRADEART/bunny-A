$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$rec=Split-Path -Parent $PSScriptRoot
$auth=Get-Content -LiteralPath (Join-Path $rec 'authorization.json') -Raw | ConvertFrom-Json
if(-not $auth.productionActivationAuthorized) {throw 'Explicit activation authorization missing'}
$zip=Join-Path (Get-Location).Path ('releases\'+$auth.candidate.release+'.zip')
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower() -ne $auth.candidate.zipSha256) {throw 'ZIP differs from authorized bytes'}
$source=Join-Path $env:LOCALAPPDATA ('Bunny-A-R1-stage\releases\'+$auth.candidate.release)
$before=(Get-FileHash -LiteralPath (Join-Path $env:LOCALAPPDATA 'Bunny-A\install.json') -Algorithm SHA256).Hash
& (Join-Path $source 'scripts\install-bunny-release.ps1') -Package $zip -InstallRoot (Join-Path $env:LOCALAPPDATA 'Bunny-A') -StageOnly | Set-Content (Join-Path $PSScriptRoot 'code-stage.json') -Encoding utf8
if((Get-FileHash -LiteralPath (Join-Path $env:LOCALAPPDATA 'Bunny-A\install.json') -Algorithm SHA256).Hash -ne $before) {throw 'Stage-only changed release selection'}
