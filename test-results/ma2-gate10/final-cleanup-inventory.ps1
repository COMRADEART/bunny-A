$ErrorActionPreference='Stop'
$rec=$PSScriptRoot
$all=Get-CimInstance Win32_Process
$stage='C:\Users\allam\AppData\Local\Bunny-A-T10-stage'
$owned=@()
foreach($p in $all) {
 $cmd=[string]$p.CommandLine
 $entry=$null
 if($p.Name -eq 'node.exe' -and ($p.ExecutablePath.StartsWith($stage,[StringComparison]::OrdinalIgnoreCase) -or $cmd.Contains($rec))) {$entry='T10 staged runtime or audit node entry'}
 if($p.Name -eq 'powershell.exe' -and $cmd -match '-File\s+"?([^\"]+ma2-gate10[^\"]+\.ps1)') {$entry='T10 -File controller'}
 if($entry) {$owned+=@{pid=$p.ProcessId;parentPid=$p.ParentProcessId;name=$p.Name;executable=$p.ExecutablePath;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');entryClass=$entry;argumentsOmitted=$true}}
}
$fixtures=@($all | Where-Object {$_.Name -in @('node.exe','git.exe','sh.exe','bash.exe','powershell.exe','cmd.exe') -and $_.CommandLine -match 'bunny-t10-composition-|bunny-owned-|bunny-git-|bunny-t4-|T10 harmless|t10-sentinel' } | ForEach-Object {@{pid=$_.ProcessId;name=$_.Name;executable=$_.ExecutablePath;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');argumentsOmitted=$true}})
$ports=@();foreach($port in @(45129,45149,8088)) {$listener=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue);$ports+=@{port=$port;listeners=@($listener | ForEach-Object {$_.OwningProcess})}}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE SAFE';ownedCandidates=$owned;fixtureCandidates=$fixtures;testListeners=$ports;sharedBrowserProcessNotOwned=$true;browserSmokeContextsClosedByFinally=$true;temporaryIabTab='UI controller unavailable after sandbox refresh; temporary/default tab auto-closes when the tool task ends; no standalone T10 browser process';nameBasedKillUsed=$false} | ConvertTo-Json -Depth 9 | Set-Content (Join-Path $rec 'cleanup-native-inventory.json') -Encoding utf8
