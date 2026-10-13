$ErrorActionPreference='Stop'
$rec=$PSScriptRoot
$baseline=Get-Content -LiteralPath (Join-Path $rec 'current-system-ledger.json') -Raw | ConvertFrom-Json
$processes=@()
foreach($prior in $baseline.nativeProcesses) {
 $live=Get-CimInstance Win32_Process -Filter "ProcessId=$($prior.pid)"
 if(-not $live) {$processes += @{role=$prior.role;pid=$prior.pid;present=$false};continue}
 $processes += [ordered]@{role=$prior.role;pid=$live.ProcessId;parentPid=$live.ParentProcessId;executable=$live.ExecutablePath;createdAt=$live.CreationDate.ToUniversalTime().ToString('o');commandArgumentsOmitted=$true}
}
$path=$baseline.production.shortcut.path
$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($path)
$transport=Get-Content -LiteralPath (Join-Path $baseline.production.stateRoot 'runtime\tunnel-process.json') -Raw | ConvertFrom-Json
$child=Get-CimInstance Win32_Process -Filter "ProcessId=$($transport.childPid)"
if(-not $child -or $child.ParentProcessId -ne $transport.pid) {throw 'Live tunnel child must belong to recorded worker'}
$currentChild=@{role='cloudflared';pid=$child.ProcessId;parentPid=$child.ParentProcessId;executable=$child.ExecutablePath;createdAt=$child.CreationDate.ToUniversalTime().ToString('o')}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE SAFE';processes=$processes;currentTunnelChild=$currentChild;transportRecord=@{pid=$transport.pid;childPid=$transport.childPid;startedAt=$transport.startedAt;mode=$transport.mode;target=$transport.target};shortcut=@{path=$path;target=$shortcut.TargetPath;arguments=$shortcut.Arguments;workingDirectory=$shortcut.WorkingDirectory;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()};readOnly=$true} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $rec 'production-native-final.json') -Encoding utf8
