param([string]$LedgerPath)
$ErrorActionPreference='Stop'
$ledger=Get-Content -LiteralPath $LedgerPath -Raw | ConvertFrom-Json
if(@($ledger.targets).Count -ne 1) { throw 'Restore requires one explicit owned fixture.' }
$id=$ledger.targets[0]
if(-not $id.createdByTest -or $id.ownership -ne 'test-owned' -or -not $id.provenance -or @($ledger.preexistingHandles) -contains $id.handle) { throw 'No fixture restore ownership.' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class T9RRestore {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
}
'@
$h=[IntPtr][long]$id.handle
if(-not [T9RRestore]::IsWindow($h)) { throw 'Owned fixture no longer exists.' }
[uint32]$owner=0
[void][T9RRestore]::GetWindowThreadProcessId($h,[ref]$owner)
$frame=Get-Process -Id $owner -ErrorAction Stop
if($owner -ne $id.processId -or [string]$frame.StartTime.ToUniversalTime().Ticks -ne $id.processStartedAt) { throw 'Restore frame lifetime changed.' }
$content=Get-Process -Id $id.contentProcessId -ErrorAction Stop
if([string]$content.StartTime.ToUniversalTime().Ticks -ne $id.contentStartedAt) { throw 'Restore content lifetime changed.' }
$trusted=$false
foreach($package in @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') })) { foreach($exe in @('CalculatorApp.exe','Calculator.exe')) { if([String]::Equals($content.Path,(Join-Path $package.InstallLocation $exe),[StringComparison]::OrdinalIgnoreCase)) { $trusted=$true } } }
if(-not $trusted) { throw 'Restore package changed.' }
# Restore only this owned native window. Minimized UWP may withhold its UIA subtree.
[void][T9RRestore]::ShowWindow($h,9)
$w=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$zero=$w.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'num0Button')))
if(-not $zero -or $zero.Current.ProcessId -ne $id.contentProcessId) { throw 'Restored UIA content association did not revalidate.' }
Write-Output 'Owned fixture restored; native/frame/content/package association revalidated. No launch or input.'
