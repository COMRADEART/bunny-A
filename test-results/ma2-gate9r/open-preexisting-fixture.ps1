$ErrorActionPreference = 'Stop'
# Explicit QA preparation before the tested Bunny workflow. Never a product launch.
$launcher = Join-Path $env:SystemRoot 'System32\calc.exe'
$started = Start-Process -FilePath $launcher -PassThru
[ordered]@{gate='M-A-2 T9R';recordedAt=[DateTime]::UtcNow.ToString('o');launcher=$launcher;launcherPid=$started.Id;decision='Explicit manual QA fixture launch outside Bunny Runtime';intentionallyRetained=$true;processIsNotWindowAuthority=$true} | ConvertTo-Json | Set-Content -LiteralPath 'test-results/ma2-gate9r/preexisting-fixture-launch.json' -Encoding utf8
