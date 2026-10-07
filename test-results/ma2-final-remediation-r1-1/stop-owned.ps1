param([int]$OwnedPid,[string]$ExpectedExecutable,[string]$Entry,[string]$OutputPath)
$ErrorActionPreference='Stop'
$native=Get-CimInstance Win32_Process -Filter "ProcessId=$OwnedPid"
if(-not $native) {throw 'Owned process absent; no substitute PID is allowed.'}
if(-not [String]::Equals($native.ExecutablePath,$ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase) -or -not $native.CommandLine.Contains($Entry)) {throw 'Fresh executable and entry do not match the T10 role.'}
$handle=[Diagnostics.Process]::GetProcessById($OwnedPid)
try {
 $null=$handle.Handle
 $started=$handle.StartTime.ToUniversalTime().Ticks
 if(($started-($started%10)) -ne $native.CreationDate.ToUniversalTime().Ticks) {throw 'Process lifetime changed.'}
 $handle.Kill()
 if(-not $handle.WaitForExit(10000)) {throw 'Owned process did not exit.'}
}finally{$handle.Dispose()}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';pid=$OwnedPid;expectedExecutable=$ExpectedExecutable;entry=$Entry;startedAt=[string]$started;freshCimAndLifetime=$true;nativeHandleHeld=$true;childrenTerminatedByName=$false;stopped=$true} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding utf8
