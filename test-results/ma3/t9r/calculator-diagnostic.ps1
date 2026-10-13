param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public class T9RDiagnosticWin {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
}
'@
$packages = @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Select-Object Name,Version,PublisherId,SignatureKind,PackageFullName,InstallLocation,Status)
$roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$targets = @()
foreach ($w in $roots) {
 if ($w.Current.Name -ne 'Calculator') { continue }
 $c=$w.Current; $proc=Get-Process -Id $c.ProcessId
 $elements=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $digit=$w.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'num0Button')))
 $content=$(if($digit){Get-Process -Id $digit.Current.ProcessId}else{$null})
 $verified=$false
 if($content){foreach($package in $packages){foreach($exe in @('CalculatorApp.exe','Calculator.exe')){if($package.PublisherId -eq '8wekyb3d8bbwe' -and [string]::Equals($content.Path,(Join-Path $package.InstallLocation $exe),[StringComparison]::OrdinalIgnoreCase)){$verified=$true}}}}
 $tree=@()
 foreach ($e in $elements) {
  if($tree.Count -ge 400){break}
  $n=$e.Current
  $parent=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($e)
  $modal=$null; $wp=$null
  if($e.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$wp)){$modal=$wp.Current.IsModal}
  $tree += [ordered]@{automationId=$n.AutomationId;controlType=$n.ControlType.ProgrammaticName;name=$(if($n.IsPassword){'[sensitive input omitted]'}else{$n.Name});className=$n.ClassName;processId=$n.ProcessId;enabled=$n.IsEnabled;offscreen=$n.IsOffscreen;hasKeyboardFocus=$n.HasKeyboardFocus;parentId=$parent.Current.AutomationId;parentClass=$parent.Current.ClassName;modal=$modal}
 }
 $targets += [ordered]@{handle=[string]$c.NativeWindowHandle;rootName=$c.Name;rootClass=$c.ClassName;processId=$proc.Id;processPath=$proc.Path;processStartedAt=[string]$proc.StartTime.ToUniversalTime().Ticks;contentProcessId=$(if($content){$content.Id}else{$null});contentStartedAt=$(if($content){[string]$content.StartTime.ToUniversalTime().Ticks}else{$null});verifiedMicrosoftCalculator=$verified;sessionId=$proc.SessionId;minimized=[T9RDiagnosticWin]::IsIconic([IntPtr]$c.NativeWindowHandle);visible=[T9RDiagnosticWin]::IsWindowVisible([IntPtr]$c.NativeWindowHandle);offscreen=$c.IsOffscreen;hasKeyboardFocus=$c.HasKeyboardFocus;controls=$tree;expectedControls=@('num0Button','num2Button','clearButton','CalculatorResults');presentControls=@($tree | Where-Object { $_.automationId -in @('num0Button','num2Button','clearButton','CalculatorResults') } | ForEach-Object {$_.automationId})}
}
$os=Get-CimInstance Win32_OperatingSystem
$self=Get-Process -Id $PID
$calculatorProcesses=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('CalculatorApp.exe','Calculator.exe','calc.exe')} | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,SessionId)
$result=[ordered]@{observedAt=[DateTimeOffset]::UtcNow.ToString('o');readOnly=$true;os=[ordered]@{caption=$os.Caption;version=$os.Version;build=$os.BuildNumber};diagnosticProcess=[ordered]@{pid=$PID;sessionId=$self.SessionId;userInteractive=[Environment]::UserInteractive};foregroundHandle=[string][T9RDiagnosticWin]::GetForegroundWindow();packages=$packages;calculatorProcesses=$calculatorProcesses;targets=$targets}
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output ('Read-only Calculator diagnostic: '+$targets.Count+' window(s); no focus, restore, launch or termination performed.')
