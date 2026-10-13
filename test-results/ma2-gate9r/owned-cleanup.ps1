param([string]$LedgerPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ledger=Get-Content -LiteralPath $LedgerPath -Raw | ConvertFrom-Json
$packages=@(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') })
$out=@()
foreach($target in $ledger.targets) {
  if($target.ownership -ne 'test-owned' -or -not $target.provenance -or -not $target.createdByTest) { throw 'Cleanup requires explicit test-created provenance.' }
  if(@($ledger.preexistingHandles) -contains $target.handle) { throw 'Pre-existing window cannot be cleaned up.' }
  try {
    $window=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$target.handle)
    $frame=Get-Process -Id $window.Current.ProcessId -ErrorAction Stop
    if($window.Current.NativeWindowHandle -ne [long]$target.handle -or $frame.Id -ne $target.processId -or [string]$frame.StartTime.ToUniversalTime().Ticks -ne $target.processStartedAt) { throw 'Native identity/lifetime changed; refusing cleanup.' }
    $zero=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'num0Button')))
    if(-not $zero) { throw 'Calculator arithmetic identity unavailable.' }
    $content=Get-Process -Id $zero.Current.ProcessId -ErrorAction Stop
    if($content.Id -ne $target.contentProcessId -or [string]$content.StartTime.ToUniversalTime().Ticks -ne $target.contentStartedAt) { throw 'Content identity/lifetime changed; refusing cleanup.' }
    $trusted=$false
    foreach($package in $packages) { foreach($exe in @('CalculatorApp.exe','Calculator.exe')) { if([String]::Equals($content.Path,(Join-Path $package.InstallLocation $exe),[StringComparison]::OrdinalIgnoreCase)) { $trusted=$true } } }
    if(-not $trusted) { throw 'Package identity mismatch.' }
    $pattern=$null
    if(-not $window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)) { throw 'Owned target has no window close pattern.' }
    $pattern.Close()
    $out += @{handle=$target.handle;freshFrameAndContentLifetime=$true;packageVerified=$true;closed=$true;provenance=$target.provenance}
  } catch { $out += @{handle=$target.handle;closed=$false;reason=$_.Exception.Message} }
}
@{gate='M-A-2 T9R';recordedAt=[DateTime]::UtcNow.ToString('o');targets=$out;nameOnlyTermination=$false;preexistingPreserved=$true} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding utf8
if(@($out | Where-Object { -not $_.closed }).Count) { throw 'One or more owned targets could not be closed safely.' }
Write-Output "Closed $($out.Count) freshly verified test-owned windows only."
