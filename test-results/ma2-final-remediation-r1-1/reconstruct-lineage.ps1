$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
New-Item -ItemType Directory -Path $PSScriptRoot -Force | Out-Null
$prior=Join-Path (Split-Path -Parent $PSScriptRoot) 'ma2-final-remediation-r1'
$refusal=Get-Content -LiteralPath (Join-Path $prior 'production/preflight-refusal.json') -Raw | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class R11ConsoleObservation {
 [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr process, int info, out UIntPtr value, int size, out uint returned);
 public static long ConsoleHost(IntPtr handle) { UIntPtr value; uint returned; int status=NtQueryInformationProcess(handle,49,out value,IntPtr.Size,out returned); if(status!=0 || returned!=IntPtr.Size)throw new InvalidOperationException("Console association unavailable: "+status);return (long)(value.ToUInt64() & ~3UL); }
}
'@
$all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
$lineage=@()
foreach($old in $refusal.unexpectedImmediateDescendants) {
 $child=$all | Where-Object ProcessId -eq $old.ProcessId
 $parent=$all | Where-Object ProcessId -eq $old.ParentProcessId
 $anchor=$refusal.roles | Where-Object ProcessId -eq $old.ParentProcessId
 if(-not $child -or -not $parent -or $child.CreationDate.ToUniversalTime().ToString('o') -ne $old.createdAt -or $parent.CreationDate.ToUniversalTime().ToString('o') -ne $anchor.createdAt) {throw 'Historical lifetime no longer current; cannot reconstruct as live authority'}
 $cp=[Diagnostics.Process]::GetProcessById($child.ProcessId);$pp=[Diagnostics.Process]::GetProcessById($parent.ProcessId)
 try {
  $null=$cp.Handle;$null=$pp.Handle
  $childOwner=Invoke-CimMethod -InputObject $child -MethodName GetOwnerSid -ErrorAction Stop
  $parentOwner=Invoke-CimMethod -InputObject $parent -MethodName GetOwnerSid -ErrorAction Stop
  if($childOwner.ReturnValue -ne 0 -or $parentOwner.ReturnValue -ne 0) {throw 'Owner SID unavailable'}
  $sig=Get-AuthenticodeSignature -LiteralPath $child.ExecutablePath
  $consoleHost=[R11ConsoleObservation]::ConsoleHost($pp.Handle)
  $grandparent=$all | Where-Object ProcessId -eq $parent.ParentProcessId
  $lineage+=@{pid=$child.ProcessId;creationTime=$child.CreationDate.ToUniversalTime().ToString('o');executable=$child.ExecutablePath;signer=$sig.SignerCertificate.Subject;signatureStatus=[string]$sig.Status;fileSha256=(Get-FileHash -LiteralPath $child.ExecutablePath -Algorithm SHA256).Hash.ToLower();parentPid=$parent.ProcessId;parentCreationTime=$parent.CreationDate.ToUniversalTime().ToString('o');parentExecutable=$parent.ExecutablePath;parentCommandLine=$parent.CommandLine;commandLine=$child.CommandLine;sessionId=$cp.SessionId;parentSessionId=$pp.SessionId;ownerSid=$childOwner.Sid;parentOwnerSid=$parentOwner.Sid;grandparent=if($grandparent){@{pid=$grandparent.ProcessId;createdAt=$grandparent.CreationDate.ToUniversalTime().ToString('o');executable=$grandparent.ExecutablePath}}else{$null};parentBunnyRole=if($parent.CommandLine.Contains('Bunny-Host.mjs')){'host'}elseif($parent.CommandLine.Contains('Bunny-Server.mjs')){'gateway'}elseif($parent.CommandLine.Contains('bunny-tunnel.mjs')){'tunnel-worker'}else{'cloudflared'};historicalParentIdentityReconfirmed=$true;freshParentIdentityCorroborated=$true;childExistedBeforeParent=($child.CreationDate -lt $parent.CreationDate);millisecondsAfterParent=($child.CreationDate-$parent.CreationDate).TotalMilliseconds;parentConsoleHostPid=$consoleHost;consoleAssociationMatches=($consoleHost -eq $child.ProcessId);heldChildImageMatches=($cp.MainModule.FileName -eq $child.ExecutablePath);heldParentImageMatches=($pp.MainModule.FileName -eq $parent.ExecutablePath);childCreationTicks=[string]$cp.StartTime.ToUniversalTime().Ticks;parentCreationTicks=[string]$pp.StartTime.ToUniversalTime().Ticks;killAuthority=$false}
 } finally {$cp.Dispose();$pp.Dispose()}
}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED read-only reconstruction before controller modification';priorEvidence='ma2-final-remediation-r1/production/preflight-refusal.json';lineage=$lineage;associationApi='NtQueryInformationProcess ProcessConsoleHostProcess (49), current held parent handle; low two flag bits masked';noProcessStopped=$true} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'conhost-lineage.json') -Encoding utf8
$files=@('production/preflight-refusal.json','production/refusal-diagnosis.json','production/ownership-inspect.log','final-verdict.json')
$refs=@($files | ForEach-Object { $path=Join-Path $prior $_;@{path=('test-results/ma2-final-remediation-r1/'+$_);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()} })
$refs+=@{path='MA2_FINAL_REMEDIATION_R1.md';sha256=(Get-FileHash -LiteralPath 'MA2_FINAL_REMEDIATION_R1.md' -Algorithm SHA256).Hash.ToLower()}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='STATIC VERIFIED immutable prior failure reference';commit='4a4f41010828d0f1feca4aad40c2b8bc1b0ded65';files=$refs;priorAttemptRemainsFailedClosed=$true} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'previous-refusal-reference.json') -Encoding utf8
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED baseline';head=(git rev-parse HEAD);production=(Invoke-RestMethod http://127.0.0.1:43119/health -TimeoutSec 5);gateway=(Invoke-RestMethod http://127.0.0.1:8084/bunny-health -TimeoutSec 5);development=(Invoke-RestMethod http://127.0.0.1:43139/health -TimeoutSec 5);controllerChanged=$false;candidateChanged=$false;authorizationContinues=$true} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'baseline.json') -Encoding utf8
$lineage | Select-Object pid,parentPid,parentBunnyRole,sessionId,parentSessionId,parentConsoleHostPid,consoleAssociationMatches,signatureStatus,millisecondsAfterParent | ConvertTo-Json
