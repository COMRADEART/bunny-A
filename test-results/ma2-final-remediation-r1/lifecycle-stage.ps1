param([ValidateSet('guard','crash')][string]$Phase)
$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$stage=Join-Path $env:LOCALAPPDATA 'Bunny-A-R1-stage'
$config=Get-Content -LiteralPath (Join-Path $stage 'install.json') -Raw | ConvertFrom-Json
if($config.currentRelease.name -ne 'Bunny-A-Windows-v26-MA2-R1') {throw 'Unexpected candidate'}
$health=Invoke-RestMethod 'http://127.0.0.1:46129/health'
if($Phase -eq 'guard') {
  $fixture=Join-Path $stage 'rollback\r1-no-mutation-fixture'
  New-Item -ItemType Directory -Path $fixture -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $stage 'install.json') -Destination (Join-Path $fixture 'install.json') -Force
  @{arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $config.currentRelease.folder 'Start-Bunny-Release.ps1')+'"';workingDirectory=$config.currentRelease.folder} | ConvertTo-Json | Set-Content (Join-Path $fixture 'shortcut.json') -Encoding utf8
  @{deploymentPath=$null} | ConvertTo-Json | Set-Content (Join-Path $fixture 'rollback.json') -Encoding utf8
  $beforeHash=(Get-FileHash (Join-Path $stage 'install.json') -Algorithm SHA256).Hash
  $refused=$false
  try {& (Join-Path $config.currentRelease.folder 'scripts\install-bunny-release.ps1') -InstallRoot $stage -StartupDirectory (Join-Path $stage 'startup') -Rollback -RollbackDirectory $fixture}
  catch {if($_.Exception.Message -notmatch 'quiescent') {throw};$refused=$true}
  if(-not $refused) {throw 'Active authority rollback did not refuse'}
  $after=Invoke-RestMethod 'http://127.0.0.1:46129/health'
  $afterHash=(Get-FileHash (Join-Path $stage 'install.json') -Algorithm SHA256).Hash
  if($beforeHash -ne $afterHash -or $health.instanceId -ne $after.instanceId) {throw 'Refused rollback mutated selection or stopped Host'}
  @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';exactInstalledTooling=$true;refused=$true;installConfigUnchanged=$true;hostUnchanged=$true;before=$health;after=$after;beforeHash=$beforeHash;afterHash=$afterHash;fixture=$fixture} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'rollback-guard-stage.json') -Encoding utf8
} else {
  $credential=Get-Content -LiteralPath (Join-Path $stage 'state\credentials\credentials.json') -Raw | ConvertFrom-Json
  if($health.pid -ne $credential.pid -or $health.instanceId -ne $credential.instanceId) {throw 'Fresh credential/health mismatch'}
  & (Join-Path $PSScriptRoot 'stop-owned.ps1') -OwnedPid $health.pid -ExpectedExecutable (Join-Path $config.currentRelease.folder 'runtime\node.exe') -Entry 'Bunny-Host.mjs' -OutputPath (Join-Path $PSScriptRoot 'stage-crash.json')
}
