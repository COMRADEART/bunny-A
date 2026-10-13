param([string]$IdentityPath,[switch]$Minimize)
$ErrorActionPreference='Stop'
$id=Get-Content -LiteralPath $IdentityPath -Raw | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$w=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$id.handle)
$proc=Get-Process -Id $w.Current.ProcessId -ErrorAction Stop
if($proc.Id -ne $id.processId -or [string]$proc.StartTime.ToUniversalTime().Ticks -ne $id.processStartedAt) { throw 'Foreground fixture native identity changed.' }
$zero=$w.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'num0Button')))
if(-not $zero) { throw 'Foreground fixture has no Calculator surface.' }
$content=Get-Process -Id $zero.Current.ProcessId -ErrorAction Stop
if($content.Id -ne $id.contentProcessId -or [string]$content.StartTime.ToUniversalTime().Ticks -ne $id.contentStartedAt) { throw 'Foreground fixture content identity changed.' }
$trusted=$false
foreach($package in @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') })) { foreach($exe in @('CalculatorApp.exe','Calculator.exe')) { if([String]::Equals($content.Path,(Join-Path $package.InstallLocation $exe),[StringComparison]::OrdinalIgnoreCase)) { $trusted=$true } } }
if(-not $trusted) { throw 'Foreground fixture package identity changed.' }
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class T9RForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, out uint p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool c);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$h=[IntPtr][long]$id.handle
if($Minimize) {
  [void][T9RForeground]::ShowWindow($h,6)
  if([T9RForeground]::GetForegroundWindow() -eq $h) { throw 'Fixture minimization did not remove Calculator foreground.' }
  Write-Output 'Verified Calculator fixture minimized to produce focus loss; no app launched and no input performed.'
  exit 0
}
$fg=[T9RForeground]::GetForegroundWindow()
[uint32]$fgPid=0
$thread=[T9RForeground]::GetWindowThreadProcessId($fg,[ref]$fgPid)
$own=[T9RForeground]::GetCurrentThreadId()
$attached=[T9RForeground]::AttachThreadInput($own,$thread,$true)
try { [void][T9RForeground]::ShowWindow($h,9);[void][T9RForeground]::SetForegroundWindow($h) }
finally { if($attached) { [void][T9RForeground]::AttachThreadInput($own,$thread,$false) } }
if([T9RForeground]::GetForegroundWindow() -ne $h) { throw 'Windows refused explicit test-fixture foreground activation.' }
Write-Output 'Verified intended Calculator foreground activated for controlled fixture; no app launched and no input performed.'
