# M-A-3 T10 I2 live overflow check: five ACTIVE agents on a top notch. Expected: three chips and one "+2" overflow chip.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t10-overflow-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$port = 43897
$fake = Start-Process -FilePath (Get-Command node).Source -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$port, 'idle', (Join-Path $work 'commands.jsonl'), '5') -WindowStyle Hidden -PassThru
try {
  $ready = $false
  for ($i = 0; $i -lt 50 -and -not $ready; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $port + '/state') -Headers @{ Authorization = 'Bearer notch-fake-token' } -TimeoutSec 2; $ready = ($r.StatusCode -eq 200) } catch { Start-Sleep -Milliseconds 150 } }
  if (-not $ready) { throw 'fake host did not start' }
  $cred = Join-Path $work 'cred.json'
  [IO.File]::WriteAllText($cred, (@{ token = 'notch-fake-token'; port = $port } | ConvertTo-Json -Compress), $utf8)
  $pref = Join-Path $work 'pref.json'
  [IO.File]::WriteAllText($pref, (@{ edge = 'top'; position = 'center'; size = 'compact'; motion = 'reduced'; theme = 'dark' } | ConvertTo-Json -Compress), $utf8)
  $receiptPath = Join-Path $work 'overflow.receipt.json'
  $hook = @"
`$ErrorActionPreference = 'Stop'
Update-Bunny
Set-BunnyView 'idle'
Update-Bunny
Update-Bunny
`$shot = Save-BunnyScreenshot 'overflow-top-idle-5agents'
`$chips = @(`$bunnyControls.AgentStrip.Children | ForEach-Object { `$_.ToolTip })
[IO.File]::WriteAllText('$receiptPath', ([ordered]@{ activeAgents = @(Get-BunnyActiveAgents).Count; chipCount = `$bunnyControls.AgentStrip.Children.Count; chipTooltips = `$chips; overflowTooltip = (`$chips | Select-Object -Last 1); screenshot = `$shot } | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new(`$false))
"@
  $hookPath = Join-Path $work 'overflow.hook.ps1'
  [IO.File]::WriteAllText($hookPath, $hook, $utf8)
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'wrapper.ps1') -HookFile $hookPath -Pref $pref -Shots $here -Cred $cred -Deploy (Join-Path $work 'no-deploy') | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $receiptPath)) { throw ('overflow run exit ' + $LASTEXITCODE) }
  Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $here 'overflow-receipt.json') -Force
  Get-Content -LiteralPath $receiptPath -Raw
} finally {
  if ($fake -and -not $fake.HasExited) { Stop-Process -Id $fake.Id -Force }
}
