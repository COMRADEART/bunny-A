$ErrorActionPreference='Stop'
if(-not ('R11ConsoleNative' -as [type])) {Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class R11ConsoleNative {
 [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process,int info,out UIntPtr value,int size,out uint returned);
 public static long ConsoleHost(IntPtr handle) {UIntPtr value;uint returned;int status=NtQueryInformationProcess(handle,49,out value,IntPtr.Size,out returned);if(status!=0 || returned!=IntPtr.Size)throw new InvalidOperationException("Fresh kernel console association unavailable: "+status);return (long)(value.ToUInt64() & ~3UL);}
}
'@}
function Assert-R11HeldIdentity($Item,$Current) {
 if(-not $Current -or $Item.process.HasExited -or $Current.ProcessId -ne $Item.pid -or $Current.CreationDate.ToUniversalTime().ToString('o') -ne $Item.createdAt -or -not [String]::Equals($Current.ExecutablePath,$Item.executable,[StringComparison]::OrdinalIgnoreCase) -or [string]$Item.process.StartTime.ToUniversalTime().Ticks -ne $Item.ticks -or -not [String]::Equals($Item.process.MainModule.FileName,$Item.executable,[StringComparison]::OrdinalIgnoreCase)) {throw 'Fresh/held process lifetime unavailable or changed'}
}
function Hold-R11Process([string]$Role,[int]$RolePid,[string]$Executable,[string]$Entry) {
 $native=Get-CimInstance Win32_Process -Filter "ProcessId=$RolePid" -ErrorAction Stop
 if(-not $native -or -not [String]::Equals($native.ExecutablePath,$Executable,[StringComparison]::OrdinalIgnoreCase) -or (-not [string]::IsNullOrEmpty($Entry) -and -not $native.CommandLine.Contains($Entry))) {throw ('Fresh role identity unavailable: '+$Role)}
 $process=[Diagnostics.Process]::GetProcessById($RolePid)
 try {
  $null=$process.Handle;$ticks=$process.StartTime.ToUniversalTime().Ticks
  if(($ticks-($ticks%10)) -ne $native.CreationDate.ToUniversalTime().Ticks -or -not [String]::Equals($process.MainModule.FileName,$Executable,[StringComparison]::OrdinalIgnoreCase)) {throw 'CIM/held process lifetime or image mismatch'}
  $owner=Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid -ErrorAction Stop
  if($owner.ReturnValue -ne 0 -or -not $owner.Sid) {throw 'Fresh owner unavailable'}
  $item=[pscustomobject]@{role=$Role;process=$process;pid=$RolePid;parentPid=$native.ParentProcessId;createdAt=$native.CreationDate.ToUniversalTime().ToString('o');ticks=[string]$ticks;executable=$Executable;entry=$Entry;commandLine=$native.CommandLine;sessionId=$process.SessionId;ownerSid=$owner.Sid}
  Assert-R11HeldIdentity $item (Get-CimInstance Win32_Process -Filter "ProcessId=$RolePid" -ErrorAction Stop)
  return $item
 } catch {$process.Dispose();throw}
}
function Test-R11ConsoleSupportFacts($Facts) {
 # Pure invariant shared by live inspection and faithful adversarial tests. No termination.
 $f=$Facts
 if(-not $f.freshInspection -or -not $f.parentOwned -or -not $f.parentHeldAlive -or -not $f.childHeldAlive) {return $false}
 if($f.parentRole -notin @('host','gateway','tunnel-worker','cloudflared')) {return $false}
 if([long]$f.parentPid -le 0 -or [long]$f.childPid -le 0 -or $f.parentPid -eq $f.childPid -or $f.actualParentPid -ne $f.parentPid) {return $false}
 if([decimal]$f.parentBirth -le 0 -or [decimal]$f.childBirth -le 0 -or $f.parentBirth -ne $f.freshParentBirth -or $f.childBirth -ne $f.freshChildBirth -or ([decimal]$f.childBirth -le [decimal]$f.parentBirth) -or (([decimal]$f.childBirth-[decimal]$f.parentBirth) -gt 50000000)) {return $false}
 if(-not $f.parentImageMatches -or -not $f.childImageMatches -or -not $f.ownerSid -or $f.ownerSid -ne $f.parentOwnerSid -or $f.sessionId -ne $f.parentSessionId) {return $false}
 if(-not [String]::Equals($f.executable,$f.expectedSystemConsole,[StringComparison]::OrdinalIgnoreCase) -or $f.signatureStatus -ne 'Valid' -or $f.signer -ne 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US') {return $false}
 if(-not $f.consoleQuerySucceeded -or $f.parentConsoleHostPid -ne $f.childPid) {return $false}
 return $true
}
function Get-R11ConsoleSupport($Child,$Parent) {
 $expected=Join-Path $env:WINDIR 'System32\conhost.exe'
 if(-not [String]::Equals($Child.ExecutablePath,$expected,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unmodelled descendant image; no support or kill authority'}
 $support=Hold-R11Process 'os-console-support' $Child.ProcessId $expected ''
 try {
  $freshParent=Get-CimInstance Win32_Process -Filter "ProcessId=$($Parent.pid)" -ErrorAction Stop
  $freshChild=Get-CimInstance Win32_Process -Filter "ProcessId=$($support.pid)" -ErrorAction Stop
  Assert-R11HeldIdentity $Parent $freshParent;Assert-R11HeldIdentity $support $freshChild
  $signature=Get-AuthenticodeSignature -LiteralPath $expected
  $association=[R11ConsoleNative]::ConsoleHost($Parent.process.Handle)
  $facts=[pscustomobject]@{freshInspection=$true;parentOwned=$true;parentHeldAlive=(-not $Parent.process.HasExited);childHeldAlive=(-not $support.process.HasExited);parentRole=$Parent.role;parentPid=$Parent.pid;childPid=$support.pid;actualParentPid=$freshChild.ParentProcessId;parentBirth=$Parent.ticks;childBirth=$support.ticks;freshParentBirth=[string]$Parent.process.StartTime.ToUniversalTime().Ticks;freshChildBirth=[string]$support.process.StartTime.ToUniversalTime().Ticks;parentImageMatches=[String]::Equals($Parent.process.MainModule.FileName,$Parent.executable,[StringComparison]::OrdinalIgnoreCase);childImageMatches=[String]::Equals($support.process.MainModule.FileName,$expected,[StringComparison]::OrdinalIgnoreCase);ownerSid=$support.ownerSid;parentOwnerSid=$Parent.ownerSid;sessionId=$support.sessionId;parentSessionId=$Parent.sessionId;executable=$freshChild.ExecutablePath;expectedSystemConsole=$expected;signatureStatus=[string]$signature.Status;signer=$signature.SignerCertificate.Subject;consoleQuerySucceeded=$true;parentConsoleHostPid=$association}
  if(-not (Test-R11ConsoleSupportFacts $facts)) {throw 'Console support relation ambiguous; no authority inferred'}
  Assert-R11HeldIdentity $Parent (Get-CimInstance Win32_Process -Filter "ProcessId=$($Parent.pid)" -ErrorAction Stop)
  Assert-R11HeldIdentity $support (Get-CimInstance Win32_Process -Filter "ProcessId=$($support.pid)" -ErrorAction Stop)
  # Birth in the first enumeration must also match the held child, rejecting PID replacement.
  if($Child.CreationDate.ToUniversalTime().ToString('o') -ne $support.createdAt) {throw 'Child lifetime changed during console inspection'}
  $support | Add-Member -MemberType NoteProperty -Name facts -Value $facts
  $support | Add-Member -MemberType NoteProperty -Name directKillAuthority -Value $false
  return $support
 } catch {$support.process.Dispose();throw}
}
function Assert-R11Topology([array]$Roles) {
 $support=@()
 try {
  $all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$known=@($Roles | ForEach-Object pid)
  foreach($role in $Roles) {Assert-R11HeldIdentity $role ($all | Where-Object ProcessId -eq $role.pid)}
  foreach($child in @($all | Where-Object { $_.ParentProcessId -in $known -and $_.ProcessId -notin $known })) {
   $parent=$Roles | Where-Object pid -eq $child.ParentProcessId
   $support+=Get-R11ConsoleSupport $child $parent
  }
  $supportPids=@($support | ForEach-Object pid)
  # Inspect descendants of support too; never silently skip deeper unknown descendants.
  if(@($all | Where-Object { $_.ParentProcessId -in $supportPids }).Count) {throw 'Unmodelled descendant below console support'}
  $again=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  foreach($item in @($Roles)+@($support)) {Assert-R11HeldIdentity $item ($again | Where-Object ProcessId -eq $item.pid)}
  $descendants=@($again | Where-Object { $_.ParentProcessId -in @($known+$supportPids) -and $_.ProcessId -notin $known })
  if($descendants.Count -ne $support.Count -or @($descendants | Where-Object ProcessId -notin $supportPids).Count) {throw 'Fresh descendant topology changed; fail closed'}
  foreach($item in $support) {if([R11ConsoleNative]::ConsoleHost(($Roles | Where-Object pid -eq $item.parentPid).process.Handle) -ne $item.pid) {throw 'Console association changed before completion'}}
  return $support
 } catch {foreach($item in $support){$item.process.Dispose()};throw}
}
