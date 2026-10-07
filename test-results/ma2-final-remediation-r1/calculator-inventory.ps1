param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class T9RInventoryWin {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$packages = @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') })
$rows = @()
$roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
foreach ($window in $roots) {
  try {
    if ($window.Current.Name -ne 'Calculator') { continue }
    $frame = Get-Process -Id $window.Current.ProcessId -ErrorAction Stop
    $zero = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'num0Button')))
    $content = if ($zero) { Get-Process -Id $zero.Current.ProcessId -ErrorAction Stop } else { $null }
    $trusted = $false
    foreach ($package in $packages) {
      foreach ($exe in @('CalculatorApp.exe','Calculator.exe')) {
        if ($content -and [String]::Equals($content.Path,(Join-Path $package.InstallLocation $exe),[StringComparison]::OrdinalIgnoreCase)) { $trusted = $true }
      }
    }
    $rows += [ordered]@{
      handle = [string]$window.Current.NativeWindowHandle
      processId = $frame.Id
      processStartedAt = [string]$frame.StartTime.ToUniversalTime().Ticks
      frameExecutable = $frame.Path
      contentProcessId = $(if ($content) { $content.Id } else { $null })
      contentStartedAt = $(if ($content) { [string]$content.StartTime.ToUniversalTime().Ticks } else { $null })
      contentExecutable = $(if ($content) { $content.Path } else { $null })
      verifiedMicrosoftCalculator = $trusted
      title = $window.Current.Name
      className = $window.Current.ClassName
      visible = [T9RInventoryWin]::IsWindowVisible([IntPtr]$window.Current.NativeWindowHandle)
      foreground = ([T9RInventoryWin]::GetForegroundWindow() -eq [IntPtr]$window.Current.NativeWindowHandle)
      ownership = 'pre-existing / unknown; never cleanup-authorized by inventory alone'
    }
  } catch {
    $rows += [ordered]@{ title='Calculator'; inspectionError=$_.Exception.Message; ownership='unknown; never cleanup-authorized' }
  }
}
$record = [ordered]@{ gate='M-A-2 T9R'; recordedAt=[DateTime]::UtcNow.ToString('o'); readOnly=$true; targets=@($rows); count=$rows.Count; verifiedVisibleCount=@($rows | Where-Object { $_.verifiedMicrosoftCalculator -and $_.visible }).Count }
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "Calculator inventory saved: $($rows.Count) targets; no window modified."
