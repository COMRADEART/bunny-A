param([string]$Root = (Split-Path -Parent $PSScriptRoot),[string]$DataDirectory,[int]$Port=43139)
$ErrorActionPreference = 'Stop'
if(-not $DataDirectory) {$DataDirectory=Join-Path $env:LOCALAPPDATA 'Bunny-A/development'}
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
for($bunnyParent=$DataDirectory;;$bunnyParent=Split-Path -Parent $bunnyParent) {if(Test-Path -LiteralPath (Join-Path $bunnyParent '.git')) {throw 'Development Host state must be outside Git.'};if(-not(Split-Path -Parent $bunnyParent)){break}}
if(Test-Path -LiteralPath (Join-Path $DataDirectory 'state-layout.json')) {throw 'Source development cannot use installed production state.'}
New-Item -ItemType Directory -Path (Join-Path $DataDirectory 'logs') -Force | Out-Null
$credentialsPath = Join-Path $DataDirectory 'credentials.json'
try {
  $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
  if ($health.app -eq 'Bunny-A' -and (Test-Path -LiteralPath $credentialsPath)) {
    $saved = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
    if ($saved.instanceId -eq $health.instanceId) { return }
  }
  throw 'Another service holds the Bunny-A Host address.'
} catch [System.Net.WebException] { }
$nodePath = (Get-Command node).Source
$entryPath = Join-Path $Root 'scripts/bunny-host.mjs'
$env:BUNNY_HOST_DATA_DIRECTORY=$DataDirectory
$env:BUNNY_HOST_PORT=[string]$Port
$hostProcess = Start-Process -FilePath $nodePath -ArgumentList @('--experimental-strip-types', ('"' + $entryPath + '"')) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataDirectory 'logs/host.log') -RedirectStandardError (Join-Path $DataDirectory 'logs/host-error.log') -PassThru
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 1; if ($health.app -eq 'Bunny-A' -and $health.pid -eq $hostProcess.Id) { return } } catch { }
  if ($hostProcess.HasExited) { throw 'Development Host stopped. See the separate application-data diagnostic log; no automatic restart occurs.' }
  Start-Sleep -Milliseconds 250
}
throw 'Bunny-A Host did not become reachable.'
