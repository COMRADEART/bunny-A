param([string]$LedgerPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ledger=Get-Content -LiteralPath $LedgerPath -Raw | ConvertFrom-Json
$package=Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') }
$records=@()
foreach($target in $ledger.targets) {
 if($target.ownership -ne 'test-owned' -or -not $target.createdByTest -or -not $target.provenance) {throw 'Explicit launch provenance required'}
 if(@($ledger.preexistingHandles) -contains $target.handle) {throw 'Original window cannot be closed'}
 $frameCim=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.processId)"
 $contentCim=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.contentProcessId)"
 if(-not $frameCim -or -not $contentCim) {throw 'Fresh native identities required'}
 $frame=[Diagnostics.Process]::GetProcessById($target.processId);$content=[Diagnostics.Process]::GetProcessById($target.contentProcessId)
 try {
  $null=$frame.Handle;$null=$content.Handle
  if([string]$frame.StartTime.ToUniversalTime().Ticks -ne $target.processStartedAt -or [string]$content.StartTime.ToUniversalTime().Ticks -ne $target.contentStartedAt) {throw 'Lifetime changed'}
  if($contentCim.CreationDate.ToUniversalTime().Ticks -ne ($content.StartTime.ToUniversalTime().Ticks-($content.StartTime.ToUniversalTime().Ticks%10))) {throw 'CIM lifetime changed'}
  $trusted=$false;foreach($p in $package){foreach($name in @('CalculatorApp.exe','Calculator.exe')){if([String]::Equals($contentCim.ExecutablePath,(Join-Path $p.InstallLocation $name),[StringComparison]::OrdinalIgnoreCase)){$trusted=$true}}}
  if(-not $trusted) {throw 'Trusted Microsoft package required'}
  $window=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$target.handle)
  if($window.Current.NativeWindowHandle -ne [long]$target.handle -or $window.Current.ProcessId -ne $target.processId) {throw 'Window identity changed'}
  $zero=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'num0Button')))
  if(-not $zero -or $zero.Current.ProcessId -ne $target.contentProcessId) {throw 'Content ownership changed'}
  $pattern=$null;if(-not $window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)) {throw 'Exact owned window cannot close'}
  $pattern.Close()
  $naturalExit=$content.WaitForExit(5000)
  if(-not $naturalExit) {
   $remaining=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$target.contentProcessId)))
   if($remaining) {throw 'Content still exposes UI; refusing process termination'}
   $content.Kill();if(-not $content.WaitForExit(5000)) {throw 'Owned content did not exit'}
  }
  if($frame.HasExited) {throw 'Shared frame must survive'}
  $records+=@{handle=$target.handle;contentPid=$target.contentProcessId;freshCim=$true;handlesHeld=$true;packageVerified=$true;exactWindowClosed=$true;contentExited=$true;naturalExit=$naturalExit;sharedFramePreserved=$true;provenance=$target.provenance}
 }finally{$frame.Dispose();$content.Dispose()}
}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';attackId='T10-T9R-05';targets=$records;nameOnlyTermination=$false;originalHandleNotTargeted=$true} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
