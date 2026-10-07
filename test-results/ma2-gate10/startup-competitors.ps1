$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$credential=Get-Content -LiteralPath (Join-Path $root 'state\credentials\credentials.json') -Raw | ConvertFrom-Json
$before=Invoke-RestMethod 'http://127.0.0.1:43119/health'
$config=Get-Content -LiteralPath (Join-Path $root 'install.json') -Raw | ConvertFrom-Json
$rows=@()
for($i=0;$i -lt 3;$i++) {
 $p=Start-Process -FilePath (Join-Path $root 'Bunny-A.exe') -WorkingDirectory $root -WindowStyle Hidden -PassThru
 $exited=$p.WaitForExit(12000)
 $rows+=@{attempt=$i+1;competitorPid=$p.Id;exited=$exited}
 $p.Dispose()
}
$after=Invoke-RestMethod 'http://127.0.0.1:43119/health'
if($before.pid -ne $after.pid -or $before.instanceId -ne $after.instanceId -or $after.pid -ne $credential.pid) {throw 'Production instance changed unexpectedly.'}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';attackIds=@('T10-T7-01','T10-T7-02');release=$config.currentRelease.name;before=@{pid=$before.pid;instanceId=$before.instanceId};after=@{pid=$after.pid;instanceId=$after.instanceId};competitors=$rows;productionRestarted=$false} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'startup-competitors.json') -Encoding utf8
Write-Output 'Three installed startup competitors preserved the current production Host identity.'
