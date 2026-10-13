param([string]$LedgerPath,[ValidateSet('Minimize','Restore','Close')][string]$Action)
$ErrorActionPreference='Stop'
$ledger=Get-Content -LiteralPath $LedgerPath -Raw | ConvertFrom-Json
if($ledger.targets.Count -ne 1){throw 'Exactly one owned target required.'}
$target=$ledger.targets[0]
if(!$target.createdByTest -or $target.ownership -ne 'test-owned' -or !$target.provenance.missionId -or !$target.provenance.capabilityRunId -or $ledger.preexistingHandles -contains $target.handle){throw 'No cleanup/manipulation authority for pre-existing/user target.'}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class T9ROwnedWin {
 public delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback callback,IntPtr p);
 public static uint[] ChildProcesses(IntPtr h){var ids=new List<uint>(); EnumChildWindows(h,(c,l)=>{uint p;GetWindowThreadProcessId(c,out p);if(!ids.Contains(p))ids.Add(p);return true;},IntPtr.Zero);return ids.ToArray();}
}
'@
$h=[IntPtr][long]$target.handle
if(![T9ROwnedWin]::IsWindow($h)){throw 'Owned native target no longer exists.'}
[uint32]$owner=0;[void][T9ROwnedWin]::GetWindowThreadProcessId($h,[ref]$owner)
$frame=Get-Process -Id $owner
if($owner -ne $target.processId -or [string]$frame.StartTime.ToUniversalTime().Ticks -ne $target.processStartedAt){throw 'Frame/native handle lifetime changed.'}
$content=Get-Process -Id $target.contentProcessId
if([string]$content.StartTime.ToUniversalTime().Ticks -ne $target.contentStartedAt){throw 'Content lifetime changed.'}
$children=@([T9ROwnedWin]::ChildProcesses($h))
if($owner -ne $content.Id -and $children -notcontains $content.Id){throw 'Content is not currently attached to exact owned window.'}
$trusted=$false
foreach($package in @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object {$_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System')})){
 foreach($exe in @('CalculatorApp.exe','Calculator.exe')){if([string]::Equals($content.Path,(Join-Path $package.InstallLocation $exe),[StringComparison]::OrdinalIgnoreCase)){$trusted=$true}}
}
if(!$trusted){throw 'Verified installed Microsoft Calculator required.'}
$w=[System.Windows.Automation.AutomationElement]::FromHandle($h)
if($w.Current.Name -ne 'Calculator'){throw 'Owned window identity changed.'}
$before=[T9ROwnedWin]::IsIconic($h)
if($Action -eq 'Minimize'){[void][T9ROwnedWin]::ShowWindow($h,6)}
elseif($Action -eq 'Restore'){[void][T9ROwnedWin]::ShowWindow($h,9)}
else{$pattern=$null;if(!$w.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'No semantic window-close pattern; no process termination fallback.'};$pattern.Close()}
[ordered]@{action=$Action;targetIdentity=$target;beforeMinimized=$before;operation='Exact owned native window only; no process termination';verifiedPackage=$trusted} | ConvertTo-Json -Depth 8 -Compress
