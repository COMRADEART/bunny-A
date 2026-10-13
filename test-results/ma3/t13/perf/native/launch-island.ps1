# T13 PERF lane LIVE launch: starts the REAL install\Bunny-Island.ps1 (NOT -SmokeTest) against the disposable perf Host
# credentials, with a scratch preference file. Records the PID this launch owns. Production is never referenced.
param(
  [Parameter(Mandatory = $true)][string]$Cred,
  [Parameter(Mandatory = $true)][string]$Scratch,
  [string]$Motion = 'full',
  [string]$Edge = 'top',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\allam\Documents\new\bun-router'
$island = Join-Path $repo 'install\Bunny-Island.ps1'
if (-not (Test-Path -LiteralPath $island)) { throw 'install\Bunny-Island.ps1 missing' }
if (-not (Test-Path -LiteralPath $Cred)) { throw 'credential file missing' }
$work = Join-Path $Scratch ('island-' + $Motion + '-' + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$pref = Join-Path $work 'pref.json'
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($pref, (@{ edge = $Edge; position = 'center'; size = 'compact'; motion = $Motion; theme = 'dark'; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5; monitor = $null } | ConvertTo-Json -Compress), $utf8)
$deploy = Join-Path $work 'no-deploy'   # deliberately absent: the Island never points at an installed dashboard
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $island, '-CredentialPath', $Cred, '-DeploymentPath', $deploy, '-PreferencePath', $pref) -WindowStyle Hidden -PassThru
$record = [ordered]@{ launchedPid = $p.Id; motion = $Motion; edge = $Edge; pref = $pref; startedAt = (Get-Date).ToString('o'); note = 'real install\Bunny-Island.ps1, not -SmokeTest; PID is this launch only' }
$json = $record | ConvertTo-Json -Depth 4
if ($Out) { [IO.File]::WriteAllText($Out, $json, $utf8) }
Write-Output $json
