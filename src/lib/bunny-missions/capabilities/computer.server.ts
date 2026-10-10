import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { scopedPath } from "../paths.server.ts";
import type { ActionManifest, ApprovalBatch, CapabilityResult } from "../types.ts";
import { calculatorOperation } from "../batches.server.ts";
import type { CapabilityAdapter, ExecutionContext } from "./bus.server.ts";
import { trackOwnedChild } from "../../bunny-host/owned-processes.server.ts";
import { CalculatorTargets, type CalculatorIdentity, type CalculatorAcquisition, type CalculatorTargetStorage } from "./calculator-targets.server.ts";
import { systemTool } from "../../bunny-host/system-tools.server.ts";

const input = (name: string, type: ActionManifest["inputs"][number]["type"], required: boolean, description: string) => ({ name, type, required, description });
/** Applications Bunny may start by name. Anything else needs a new skill or capability, not a free-form command. */
export const APPS: Record<string, string> = { notepad: "notepad.exe", calculator: "calc.exe", paint: "mspaint.exe", explorer: "explorer.exe", terminal: "wt.exe" };
const EXECUTABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|pif|lnk|reg|hta|cpl|jar|appref-ms)$/i;

const PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:BUNNY_COMPUTER_PARAMS | ConvertFrom-Json
$batch = if ($env:BUNNY_COMPUTER_BATCH) { $env:BUNNY_COMPUTER_BATCH | ConvertFrom-Json } else { $null }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
[StructLayout(LayoutKind.Sequential)] public struct BunnyPropertyKey { public Guid format; public uint id; }
[StructLayout(LayoutKind.Explicit)] public struct BunnyPropertyVariant {
  [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr value; [FieldOffset(16)] public IntPtr extra;
}
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface BunnyPropertyStore {
  [PreserveSig] int GetCount(out uint count); [PreserveSig] int GetAt(uint index, out BunnyPropertyKey key);
  [PreserveSig] int GetValue(ref BunnyPropertyKey key, out BunnyPropertyVariant value);
  [PreserveSig] int SetValue(ref BunnyPropertyKey key, ref BunnyPropertyVariant value); [PreserveSig] int Commit();
}
public static class BunnyWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, out BunnyPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref BunnyPropertyVariant value);
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string AppId(IntPtr h) {
    var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); BunnyPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(h, ref iid, out store));
    try {
      var key = new BunnyPropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = 5 };
      BunnyPropertyVariant value; Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.type == 31 ? Marshal.PtrToStringUni(value.value) : null; } finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
"@
function Find-Window($p) {
  if ($batch.windowIdentity) {
    $w = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$batch.windowIdentity.handle)
    Assert-BatchWindow $w
    return $w
  }
  $all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $matches = @()
  foreach ($w in $all) {
    $c = $w.Current
    if ($batch) {
      if ($p.pid -and $c.ProcessId -ne [int]$p.pid) { continue }
      if ($p.title -and $c.Name -ne [string]$p.title) { continue }
      if (-not $p.pid -and -not $p.title) { continue }
      Assert-BatchWindow $w
      $matches += ,$w
      continue
    }
    # M-A-3 T9R-F01: the reviewed "Calculator" target is the window named exactly Calculator, never a title containing it.
    # With a pid as well, both must identify the same window (a recycled pid never redirects a Calculator operation).
    if ([string]$p.title -eq 'Calculator') {
      if ($c.Name -eq 'Calculator' -and (-not $p.pid -or $c.ProcessId -eq [int]$p.pid)) { return $w }
      continue
    }
    if (($p.pid -and $c.ProcessId -eq [int]$p.pid) -or ($p.title -and $c.Name -like ('*' + $p.title + '*'))) { return $w }
  }
  if ($batch -and $matches.Count -eq 1) { return $matches[0] }
  if ($batch -and $matches.Count -gt 1) { throw 'Several verified Calculator windows match; an exact intended target is required.' }
  throw ('No top-level window matches ' + ($(if ($p.pid) { 'pid ' + $p.pid } else { 'title "' + $p.title + '"' })))
}
function Find-Control($w, $p) {
  $conds = @()
  if ($p.automationId) { $conds += New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$p.automationId) }
  if ($p.name) { $conds += New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, [string]$p.name) }
  if ($conds.Count -eq 0) { throw 'Provide name or automationId for the control.' }
  $cond = if ($conds.Count -eq 1) { $conds[0] } else { New-Object System.Windows.Automation.AndCondition($conds) }
  $e = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if (-not $e) { throw ('Control not found: ' + $(if ($p.name) { 'name "' + $p.name + '"' } else { 'automationId ' + $p.automationId })) }
  return $e
}
function Describe($e) { $c = $e.Current; [ordered]@{ name = $c.Name; controlType = $c.ControlType.ProgrammaticName; automationId = $c.AutomationId; className = $c.ClassName; processId = $c.ProcessId; enabled = $c.IsEnabled } }
function Assert-BatchClock {
  if ($batch -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$batch.expiresAt) { throw 'Bounded approval expired before the desktop operation.' }
}
function Calculator-Packages {
  if (-not $script:BunnyCalculatorPackages) {
    $script:BunnyCalculatorPackages = @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') })
  }
  if ($script:BunnyCalculatorPackages.Count -eq 0) { throw 'Verified installed Microsoft Calculator package unavailable.' }
  return $script:BunnyCalculatorPackages
}
function Assert-CalculatorProcess($proc) {
  if ($proc.SessionId -ne (Get-Process -Id $PID).SessionId) { throw 'Calculator belongs to another Windows session.' }
  foreach ($package in @(Calculator-Packages)) {
    foreach ($exe in @('CalculatorApp.exe','Calculator.exe')) {
      if ([string]::Equals($proc.Path, (Join-Path $package.InstallLocation $exe), [StringComparison]::OrdinalIgnoreCase)) { return }
    }
  }
  throw 'The target is outside the verified Calculator application.'
}
# A minimized UWP frame can detach its XAML content and expose no arithmetic UIA elements.
# This is a native identity probe only, never a claim that a control is ready or permission to invoke it.
function Native-CalculatorFrame($w) {
  Assert-BatchClock
  if (-not [Environment]::UserInteractive -or -not $w -or $w.Current.Name -ne 'Calculator') { throw 'Interactive Calculator window unavailable.' }
  $h = [IntPtr]$w.Current.NativeWindowHandle
  if (-not [BunnyWin]::IsWindow($h)) { throw 'Calculator native window unavailable.' }
  [uint32]$owner = 0; [void][BunnyWin]::GetWindowThreadProcessId($h, [ref]$owner)
  if ($owner -ne $w.Current.ProcessId) { throw 'Calculator UIA/native owner mismatch.' }
  $proc = Get-Process -Id $owner -ErrorAction Stop
  if ($proc.SessionId -ne (Get-Process -Id $PID).SessionId) { throw 'Calculator belongs to another Windows session.' }
  $frame = [ordered]@{ handle = [string]$h; processId = $proc.Id; processStartedAt = [string]$proc.StartTime.ToUniversalTime().Ticks }
  if ([string]::Equals($proc.Path, (Join-Path $env:WINDIR 'System32\ApplicationFrameHost.exe'), [StringComparison]::OrdinalIgnoreCase)) {
    if ([BunnyWin]::Class($h) -ne 'ApplicationFrameWindow') { throw 'Unexpected Calculator native frame class.' }
    $appId = [BunnyWin]::AppId($h); $trustedFrame = $false
    foreach ($package in @(Calculator-Packages)) {
      [xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
      foreach ($app in @($manifest.Package.Applications.Application)) {
        if ($appId -eq ($package.PackageFamilyName + '!' + $app.Id)) { $trustedFrame = $true }
      }
    }
    if (-not $trustedFrame) { throw 'Native frame does not identify the installed Calculator application.' }
  } else { Assert-CalculatorProcess $proc }
  if ($batch.windowIdentity) {
    $expected = $batch.windowIdentity
    if ($frame.handle -ne $expected.handle -or $frame.processId -ne $expected.processId -or $frame.processStartedAt -ne $expected.processStartedAt) { throw 'The approved window or process lifetime changed.' }
    if ($expected.contentProcessId) {
      $content = Get-Process -Id $expected.contentProcessId -ErrorAction Stop
      Assert-CalculatorProcess $content
      if ([string]$content.StartTime.ToUniversalTime().Ticks -ne $expected.contentStartedAt) { throw 'The approved Calculator content process lifetime changed.' }
    }
  }
  return $frame
}
function Calculator-Frames {
  $all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $all) { if ($w.Current.Name -eq 'Calculator') { [void](Native-CalculatorFrame $w); $w } }
}
function Ready-CalculatorWindow($w) {
  $initial = Native-CalculatorFrame $w
  $h = [IntPtr][long]$initial.handle
  $started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $deadline = [Math]::Min($started + 8000, [long]$batch.expiresAt)
  $restored = [BunnyWin]::IsIconic($h); $attempts = 0
  # Only called in an admitted open/focus operation. Pure target probes never restore a window.
  if ($restored) { Assert-BatchClock; [void](Native-CalculatorFrame $w); [void][BunnyWin]::ShowWindow($h, 9) }
  do {
    Assert-BatchClock; $attempts++
    $fresh = [System.Windows.Automation.AutomationElement]::FromHandle($h)
    $current = Native-CalculatorFrame $fresh
    if ($current.processId -ne $initial.processId -or $current.processStartedAt -ne $initial.processStartedAt) { throw 'Calculator lifetime changed during readiness; no automatic relaunch.' }
    $ready = $true; $contentPid = $null
    foreach ($id in @('num0Button','num2Button','clearButton','CalculatorResults')) {
      $control = $fresh.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)))
      if (-not $control) { $ready = $false; break }
      $c = $control.Current
      if (-not $c.IsEnabled -or $c.IsPassword) { $ready = $false; break }
      if ($contentPid -and $contentPid -ne $c.ProcessId) { throw 'Calculator readiness controls have different native owners.' }
      $contentPid = $c.ProcessId
      if ($id -ne 'CalculatorResults') {
        $pattern = $null
        if ($c.ControlType -ne [System.Windows.Automation.ControlType]::Button -or -not $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { throw 'Calculator arithmetic control is not a semantic invokable button.' }
      }
    }
    if ($ready) {
      if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $deadline) { throw 'Calculator arithmetic readiness exceeded the bounded deadline; no automatic relaunch.' }
      Assert-BatchWindow $fresh
      return @{ identity = (Batch-Identity $fresh); readiness = @{ restored = $restored; attempts = $attempts; elapsedMs = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $started); controls = @('num0Button','num2Button','clearButton','CalculatorResults') } }
    }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline) { Start-Sleep -Milliseconds 100 }
  } while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline)
  throw 'Calculator arithmetic readiness unavailable within the bounded deadline; no automatic relaunch.'
}
function Batch-Identity($w) {
  $proc = Get-Process -Id $w.Current.ProcessId -ErrorAction Stop
  $zero = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'num0Button')))
  if (-not $zero) { throw 'Calculator arithmetic identity unavailable.' }
  $content = Get-Process -Id $zero.Current.ProcessId -ErrorAction Stop
  [ordered]@{ handle = [string]$w.Current.NativeWindowHandle; processId = $w.Current.ProcessId; processStartedAt = [string]$proc.StartTime.ToUniversalTime().Ticks; contentProcessId = $content.Id; contentStartedAt = [string]$content.StartTime.ToUniversalTime().Ticks }
}
function Assert-BatchWindow($w) {
  if (-not $batch) { return }
  Assert-BatchClock
  [void](Native-CalculatorFrame $w)
  if (-not $w -or $w.Current.Name -ne 'Calculator') { throw 'The approved Calculator window is unavailable.' }
  $identity = Batch-Identity $w
  if ($batch.windowIdentity -and ($identity.handle -ne $batch.windowIdentity.handle -or $identity.processId -ne $batch.windowIdentity.processId -or $identity.processStartedAt -ne $batch.windowIdentity.processStartedAt)) { throw 'The approved window or process lifetime changed.' }
  if ($batch.windowIdentity.contentProcessId -and ($identity.contentProcessId -ne $batch.windowIdentity.contentProcessId -or $identity.contentStartedAt -ne $batch.windowIdentity.contentStartedAt)) { throw 'The approved Calculator content process lifetime changed.' }
  # A UWP frame pid alone can host several apps. Require the arithmetic control to belong to
  # the installed Microsoft Calculator package, rather than trusting a title or frame process.
  $digit = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'num0Button')))
  if (-not $digit) { throw 'No verified Calculator arithmetic surface.' }
  $content = Get-Process -Id $digit.Current.ProcessId -ErrorAction Stop
  $packages = @(Get-AppxPackage -Name Microsoft.WindowsCalculator | Where-Object { $_.PublisherId -eq '8wekyb3d8bbwe' -and $_.SignatureKind -in @('Store','System') })
  $trusted = $false
  foreach ($package in $packages) {
    foreach ($exe in @('CalculatorApp.exe','Calculator.exe')) {
      if ([string]::Equals($content.Path, (Join-Path $package.InstallLocation $exe), [StringComparison]::OrdinalIgnoreCase)) { $trusted = $true }
    }
  }
  if (-not $trusted) { throw 'The target is outside the verified Calculator application.' }
  $elements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($e in $elements) {
    if ($e.Current.IsPassword) { throw 'A dialog or sensitive input requires a fresh decision.' }
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) {
      $wp = $null
      if ($e.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$wp) -and $wp.Current.IsModal) { throw 'A modal dialog requires a fresh decision.' }
      $knownFrame = $e.Current.ProcessId -eq $w.Current.ProcessId -and $e.Current.ClassName -eq 'ApplicationFrameTitleBarWindow'
      $knownContent = $e.Current.ProcessId -eq $digit.Current.ProcessId -and $e.Current.ClassName -eq 'Windows.UI.Core.CoreWindow'
      if (-not $knownFrame -and -not $knownContent) { throw 'An unexpected window requires a fresh decision.' }
    }
  }
}
function Assert-BatchControl($w, $e) {
  if (-not $batch) { return }
  Assert-BatchWindow $w
  $zero = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'num0Button')))
  if (-not $e.Current.IsEnabled -or $e.Current.IsPassword -or $e.Current.ProcessId -ne $zero.Current.ProcessId -or $e.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { throw 'An unexpected control requires a fresh decision.' }
  if ([BunnyWin]::GetForegroundWindow() -ne [IntPtr]$w.Current.NativeWindowHandle) { throw 'Foreground drift requires a fresh decision.' }
}
function Calculator-Windows {
  $all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $windows = @()
  foreach ($w in $all) {
    if ($w.Current.Name -eq 'Calculator') { Assert-BatchWindow $w; $windows += ,$w }
  }
  return $windows
}
`;

export const CALCULATOR_SCRIPTS = {
  existing: String.raw`
$windows = @(Calculator-Frames)
if ($windows.Count -gt 1) { throw 'Several verified Calculator windows exist; no arbitrary target or additional launch selected.' }
$identity = $null
if ($windows.Count -eq 1 -and -not [BunnyWin]::IsIconic([IntPtr]$windows[0].Current.NativeWindowHandle)) {
  try { Assert-BatchWindow $windows[0]; $identity = Batch-Identity $windows[0] }
  catch { if ($_.Exception.Message -ne 'Calculator arithmetic identity unavailable.' -and $_.Exception.Message -ne 'No verified Calculator arithmetic surface.') { throw } }
}
@{ identity = $identity; awaitingReadiness = ($windows.Count -eq 1 -and -not $identity) } | ConvertTo-Json -Depth 4 -Compress`,
  valid: String.raw`
$id = $batch.windowIdentity
$h = [IntPtr][long]$id.handle
$valid = [BunnyWin]::IsWindow($h)
if ($valid) {
  [uint32]$owner = 0
  [void][BunnyWin]::GetWindowThreadProcessId($h, [ref]$owner)
  $proc = Get-Process -Id $owner -ErrorAction Stop
  $valid = $owner -eq $id.processId -and [string]$proc.StartTime.ToUniversalTime().Ticks -eq $id.processStartedAt
  if ($valid) {
    $w = [System.Windows.Automation.AutomationElement]::FromHandle($h); [void](Native-CalculatorFrame $w)
    if ($p.prepareReadiness) { $prepared = Ready-CalculatorWindow $w }
    elseif (-not [BunnyWin]::IsIconic($h)) {
      try { Assert-BatchWindow $w }
      catch { if ($_.Exception.Message -ne 'Calculator arithmetic identity unavailable.' -and $_.Exception.Message -ne 'No verified Calculator arithmetic surface.') { throw }; $needsReadiness = $true }
    }
  }
}
@{ valid = $valid; needsReadiness = ($valid -and ($needsReadiness -or [BunnyWin]::IsIconic($h))); readiness = $prepared.readiness } | ConvertTo-Json -Depth 4 -Compress`,
  acquire: String.raw`
Assert-BatchClock
$windows = @(Calculator-Frames)
if ($windows.Count -gt 1) { throw 'Several verified Calculator windows exist; no additional launch selected.' }
if ($windows.Count -eq 1) {
  $prepared = Ready-CalculatorWindow $windows[0]
  @{ decision = 'reuse_existing'; identity = $prepared.identity; readiness = $prepared.readiness; newWindows = 0 } | ConvertTo-Json -Depth 5 -Compress
} else {
  Assert-BatchClock
  $proc = Start-Process -FilePath ([string]$p.file) -PassThru
  $deadline = [Math]::Min([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 8000, [long]$batch.expiresAt)
  do {
    Assert-BatchClock
    try { $windows = @(Calculator-Frames) }
    catch {
      if ($_.Exception.Message -ne 'No verified Calculator arithmetic surface.' -and $_.Exception.Message -ne 'Calculator arithmetic identity unavailable.') { throw }
      $windows = @()
    }
    if ($windows.Count -gt 1) { throw 'Acquisition produced ambiguous windows; no automatic relaunch.' }
    if ($windows.Count -eq 1) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline)
  if ($windows.Count -ne 1) { throw 'Calculator launch outcome uncertain; no automatic relaunch.' }
  $prepared = Ready-CalculatorWindow $windows[0]
  @{ decision = 'launched'; launcherPid = $proc.Id; identity = $prepared.identity; readiness = $prepared.readiness; newWindows = 1 } | ConvertTo-Json -Depth 5 -Compress
}`,
};
const SCRIPTS: Record<string, string> = {
  "computer.list_windows": String.raw`
$fg = [BunnyWin]::GetForegroundWindow()
$rows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 200 | ForEach-Object { [ordered]@{ pid = $_.Id; process = $_.ProcessName; title = $_.MainWindowTitle; foreground = ($_.MainWindowHandle -eq $fg) } }
@{ windows = @($rows); foreground = [BunnyWin]::Title($fg) } | ConvertTo-Json -Depth 4 -Compress`,
  "computer.read_controls": String.raw`
$w = Find-Window $p
$max = [Math]::Min([int]$(if ($p.limit) { $p.limit } else { 150 }), 400)
$items = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @(); foreach ($e in $items) { if ($out.Count -ge $max) { break }; $d = Describe $e; if ($d.name -or $d.automationId) { $out += $d } }
@{ window = (Describe $w); controls = $out } | ConvertTo-Json -Depth 4 -Compress`,
  "computer.focus_window": String.raw`
$before = [BunnyWin]::Title([BunnyWin]::GetForegroundWindow())
$w = Find-Window $p
$h = [IntPtr]$w.Current.NativeWindowHandle
Assert-BatchWindow $w
if ([BunnyWin]::IsIconic($h)) { [void][BunnyWin]::ShowWindow($h, 9) }
if ($batch) {
  $focusStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $focusDeadline = [Math]::Min($focusStarted + 2000, [long]$batch.expiresAt)
  do {
    Assert-BatchClock
    $w = [System.Windows.Automation.AutomationElement]::FromHandle($h); Assert-BatchWindow $w
    # Use the verified application's semantic focus provider; never attach to another
    # process's input queue, synthesize keys, change foreground-lock policy or invoke a control.
    $focusTarget = $w
    if (-not $w.Current.IsKeyboardFocusable) {
      $focusTarget = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'num0Button')))
    }
    if ($focusTarget -and $focusTarget.Current.IsKeyboardFocusable) {
      try { $focusTarget.SetFocus() } catch [InvalidOperationException] { $focusProviderUnavailable = $true }
    }
    [void][BunnyWin]::SetForegroundWindow($h)
    if ([BunnyWin]::GetForegroundWindow() -eq $h) { break }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $focusDeadline) { Start-Sleep -Milliseconds 100 }
  } while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $focusDeadline)
  Assert-BatchClock; Assert-BatchWindow $w
} else { [void][BunnyWin]::SetForegroundWindow($h); Start-Sleep -Milliseconds 250 }
$after = [BunnyWin]::Title([BunnyWin]::GetForegroundWindow())
@{ before = $before; after = $after; target = (Describe $w); windowIdentity = $(if ($batch) { Batch-Identity $w } else { $null }); focusElapsedMs = $(if ($batch) { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $focusStarted } else { $null }); focused = ([BunnyWin]::GetForegroundWindow() -eq $h) } | ConvertTo-Json -Depth 4 -Compress`,
  "computer.invoke_control": String.raw`
$w = Find-Window $p
$e = Find-Control $w $p
Assert-BatchControl $w $e
$pattern = $null; $kind = ''
if ($batch -and -not $e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw 'The approved arithmetic control no longer supports invocation.' }
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); $kind = 'invoke' }
elseif ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle(); $kind = 'toggle' }
elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); $kind = 'select' }
elseif ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) { $pattern.Expand(); $kind = 'expand' }
else { throw ('Control supports no invoke/toggle/select/expand pattern: ' + $e.Current.Name) }
@{ control = (Describe $e); windowPid = $w.Current.ProcessId; windowIdentity = $(if ($batch) { Batch-Identity $w } else { $null }); pattern = $kind } | ConvertTo-Json -Depth 4 -Compress`,
  "computer.type": String.raw`
$w = Find-Window $p
$e = Find-Control $w $p
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { throw ('Control has no editable value: ' + $e.Current.Name) }
if ($pattern.Current.IsReadOnly) { throw 'Control is read-only.' }
$before = $pattern.Current.Value.Length
$pattern.SetValue([string]$p.text)
$after = $pattern.Current.Value
@{ control = (Describe $e); windowPid = $w.Current.ProcessId; beforeLength = $before; afterLength = $after.Length; matches = ($after -eq [string]$p.text) } | ConvertTo-Json -Depth 4 -Compress`,
  "computer.capture": String.raw`
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save([string]$p.path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
@{ path = $p.path; width = $b.Width; height = $b.Height } | ConvertTo-Json -Compress`,
  "computer.open_app": String.raw`
Assert-BatchClock
$before = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })
$proc = if ($p.target) { Start-Process -FilePath ([string]$p.file) -ArgumentList ('"' + [string]$p.target + '"') -PassThru } else { Start-Process -FilePath ([string]$p.file) -PassThru }
Start-Sleep -Milliseconds 800
$after = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })
@{ pid = $proc.Id; file = $p.file; newWindows = @($after | Where-Object { $before -notcontains $_ }).Count } | ConvertTo-Json -Compress`,
  "computer.read_calculator": String.raw`
$w = Find-Window $p
Assert-BatchWindow $w
$result = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CalculatorResults')))
if (-not $result) { throw 'Calculator result unavailable.' }
$zero = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'num0Button')))
if ($result.Current.IsPassword -or $result.Current.ProcessId -ne $zero.Current.ProcessId) { throw 'Calculator result identity changed.' }
@{ windowPid = $w.Current.ProcessId; windowIdentity = (Batch-Identity $w); result = $result.Current.Name } | ConvertTo-Json -Depth 4 -Compress`,
};

function powershell(script: string, params: Record<string, unknown>, signal: AbortSignal, timeoutMs: number, batch?: ExecutionContext["desktopBatch"]): Promise<unknown> {
  return new Promise((resolveRun, reject) => {
    const child = trackOwnedChild(execFile(systemTool("powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `${PRELUDE}\n${script}`], { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, BUNNY_COMPUTER_PARAMS: JSON.stringify(params), BUNNY_COMPUTER_BATCH: batch ? JSON.stringify(batch) : "" }, signal }, (error, stdout, stderr) => {
      if (error) { reject(new Error(((stderr || error.message).split(/\r?\n/).filter(Boolean)[0] ?? "UI Automation failed.").replace(/\s+At line:\d+.*$/, "").slice(0, 600))); return; }
      try { resolveRun(JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "null")); } catch { reject(new Error(`Unreadable automation result: ${stdout.slice(0, 200)}`)); }
    }));
    child.stdin?.end();
  });
}

/**
 * Bunny Computer Runtime on Windows. Structured, semantic operations only: window enumeration and
 * focus through user32, controls through UI Automation patterns (Invoke/Toggle/Select/Value), an
 * allowlisted app launcher and screen capture. No raw mouse coordinates and no synthetic keystrokes.
 */
export class ComputerCapability implements CapabilityAdapter {
  dataDirectory: string;
  targets: CalculatorTargets;
  automate: typeof powershell;
  constructor(dataDirectory: string, storage?: CalculatorTargetStorage, automate = powershell) {
    this.dataDirectory = dataDirectory; this.targets = new CalculatorTargets(storage); this.automate = automate;
  }
  targetOwner(context: Pick<ExecutionContext, "missionId" | "stepId" | "capabilityRunId">) {
    return context.missionId ? `mission:${context.missionId}` : context.stepId ? `step:${context.stepId}` : `direct:${context.capabilityRunId ?? crypto.randomUUID()}`;
  }
  manifest = {
    id: "computer", version: "1.0.0", description: "Windows desktop control through UI Automation and user32 (semantic controls, no coordinates).", locality: "local" as const, platforms: ["win32"] as NodeJS.Platform[],
    events: ["capability.completed", "capability.failed"], cost: { kind: "local_compute" as const, note: "Local PowerShell/UI Automation; no model tokens." }, adapter: "powershell.exe + System.Windows.Automation",
    actions: [
      { id: "computer.list_windows", description: "List top-level windows (pid, process, title, foreground).", risk: "READ", inputs: [], outputs: "{ windows, foreground }", evidence: "Window list at the time of the call.", timeoutMs: 20_000, implemented: true },
      { id: "computer.read_controls", description: "Semantic control tree of one window (name, type, automation id).", risk: "READ", sensitive: true, inputs: [input("title", "string", false, "Window title contains."), input("pid", "number", false, "Process id."), input("limit", "number", false, "Max controls (150).")], outputs: "{ window, controls }", evidence: "Window identity and control count.", timeoutMs: 30_000, implemented: true },
      { id: "computer.focus_window", description: "Bring a window to the foreground.", risk: "EXECUTE", inputs: [input("title", "string", false, "Window title contains."), input("pid", "number", false, "Process id.")], outputs: "{ before, after, focused }", evidence: "Foreground window before and after.", timeoutMs: 20_000, implemented: true },
      { id: "computer.invoke_control", description: "Invoke/toggle/select/expand a named control via UI Automation.", risk: "EXECUTE", inputs: [input("title", "string", false, "Window title contains."), input("pid", "number", false, "Process id."), input("name", "string", false, "Control name."), input("automationId", "string", false, "Automation id.")], outputs: "{ control, windowPid, pattern }", evidence: "Control identity, the matched top-level window's owning pid and the pattern used.", timeoutMs: 30_000, implemented: true },
      { id: "computer.type", description: "Set the value of an editable control via the UI Automation ValuePattern (not keystrokes).", risk: "EXECUTE", inputs: [input("title", "string", false, "Window title contains."), input("pid", "number", false, "Process id."), input("name", "string", false, "Control name."), input("automationId", "string", false, "Automation id."), input("text", "string", true, "Value to set.")], outputs: "{ control, windowPid, matches }", evidence: "The matched top-level window's owning pid, value length before/after and whether it matches.", timeoutMs: 30_000, implemented: true },
      { id: "computer.capture", description: "Capture the whole virtual screen to a PNG artifact.", risk: "READ", sensitive: true, inputs: [], outputs: "{ path, width, height }", evidence: "PNG artifact with SHA-256.", timeoutMs: 30_000, implemented: true },
      { id: "computer.open_app", description: `Start an allowlisted application (${Object.keys(APPS).join(", ")}), optionally on a non-executable file inside an approved root.`, risk: "EXECUTE", inputs: [input("app", "string", true, "Allowlisted app name."), input("target", "string", false, "File or folder inside an approved root.")], outputs: "{ pid, newWindows }", evidence: "Started process id and new window count.", timeoutMs: 20_000, implemented: true },
      { id: "computer.read_calculator", description: "Read only the arithmetic result of the verified Microsoft Calculator application.", risk: "READ", inputs: [input("title", "string", false, "Calculator window."), input("pid", "number", false, "Window owner.")], outputs: "{ windowPid, result }", evidence: "Verified Calculator result, no other controls.", timeoutMs: 30_000, implemented: true },
    ] satisfies ActionManifest[],
  };
  async health() {
    if (process.platform !== "win32") return { availability: "unsupported" as const, detail: "The Computer Runtime is implemented for Windows only." };
    return { availability: "available" as const, detail: "Windows UI Automation and user32 via powershell.exe. Raw mouse/keyboard injection is intentionally not offered." };
  }
  private desktopTail: Promise<void> = Promise.resolve();
  private desktopLease: { missionId: string; expiresAt: number; active: () => boolean } | null = null;
  applicationRegistry() {
    return [{ id: "calculator", platforms: ["win32"], operations: ["computer.open_app", "computer.focus_window", "computer.invoke_control", "computer.read_calculator"], detection: "Native package/lifetime probe at acquisition", selectors: "Calculator T9R arithmetic AutomationId allowlist", focus: "Foreground required before invoke", recovery: "Revalidate native lifetime; uncertain effects require review", granted: false }, { id: "other", operations: [], detection: "Unsupported by this reviewed integration", granted: false }];
  }
  async execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    if (!context.crossApp) return this.perform(action, params, context);
    const previous = this.desktopTail; let release!: () => void; this.desktopTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      context.signal.throwIfAborted(); const denied = context.revalidate?.(); if (denied) throw new Error(denied);
      if (!context.missionId || !context.revalidate || !context.desktopBatch) throw new Error("Current Mission desktop authority is unavailable.");
      const lease = this.desktopLease;
      if (lease && lease.missionId !== context.missionId && lease.expiresAt > Date.now() && lease.active()) throw new Error("Calculator target is busy in another Mission; no competing mutation admitted.");
      this.desktopLease = { missionId: context.missionId, expiresAt: context.desktopBatch.expiresAt, active: context.missionActive ?? (() => true) };
      return await this.perform(action, params, context);
    } finally { release(); }
  }
  private async perform(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    if (context.desktopBatch && !calculatorOperation(action, params)) throw new Error("Operation outside the Calculator batch policy.");
    const script = SCRIPTS[action];
    if (!script) return { ok: false, status: "unsupported", summary: `${action} is not supported.`, output: null, evidence: [] };
    const args: Record<string, unknown> = {};
    for (const key of ["title", "name", "automationId", "text"]) if (typeof params[key] === "string") args[key] = params[key];
    if (params.pid !== undefined) { const pid = Number(params.pid); if (!Number.isInteger(pid) || pid <= 0) throw new Error("pid must be a positive integer."); args.pid = pid; }
    if (params.limit !== undefined) args.limit = Number(params.limit);
    if (["computer.read_controls", "computer.focus_window", "computer.invoke_control", "computer.type"].includes(action) && !args.title && !args.pid) throw new Error("Identify the window by title or pid.");
    if (action === "computer.capture") {
      const folder = join(this.dataDirectory, "artifacts", context.missionId ?? "direct"); mkdirSync(folder, { recursive: true });
      args.path = join(folder, `screen-${Date.now()}.png`);
    }
    if (action === "computer.open_app") {
      const app = String(params.app ?? "").toLowerCase();
      if (!APPS[app]) return { ok: false, status: "failed", summary: `"${app}" is not an allowlisted application (${Object.keys(APPS).join(", ")}).`, output: null, evidence: [], errorCategory: "permission_denied" };
      args.file = app === "calculator" ? join(process.env.WINDIR ?? "C:/Windows", "System32", "calc.exe") : APPS[app];
      if (typeof params.target === "string" && params.target) {
        const target = scopedPath(context.cwd, params.target, context.roots);
        if (!existsSync(target)) throw new Error(`${target} does not exist.`);
        if (statSync(target).isFile() && EXECUTABLE.test(extname(target))) throw new Error("Executable and script files are never opened by the Computer Runtime.");
        args.target = target;
      }
    }
    const owner = this.targetOwner(context);
    const calculator = calculatorOperation(action, params) && (action === "computer.open_app" || action === "computer.read_calculator" || params.title === "Calculator" || !!context.desktopBatch);
    const saved = calculator ? this.targets.storage.load(owner) : null;
    const batch = context.desktopBatch ?? (calculator && action !== "computer.open_app" ? { expiresAt: Date.now() + context.timeoutMs, ...(saved?.identity ? { windowIdentity: saved.identity } : {}) } : undefined);
    const timeout = Math.min(context.timeoutMs, 60_000);
    let output: Record<string, unknown>;
    if (action === "computer.open_app" && String(params.app ?? "").toLowerCase() === "calculator" && !args.target) {
      const scope = { expiresAt: context.desktopBatch?.expiresAt ?? Date.now() + timeout };
      const admittedIdentity = context.desktopBatch?.windowIdentity;
      let readiness: unknown;
      const acquired = await this.targets.acquire(owner, context.capabilityRunId ?? null, {
        valid: async identity => {
          if (admittedIdentity && JSON.stringify(admittedIdentity) !== JSON.stringify(identity)) throw new Error("Canonical target differs from the admitted batch identity.");
          const probe = await this.automate(CALCULATOR_SCRIPTS.valid, { prepareReadiness: true }, context.signal, timeout, { ...scope, windowIdentity: identity }) as { valid: boolean; readiness?: unknown };
          readiness = probe.readiness;
          return probe.valid;
        },
        existing: async () => {
          if (admittedIdentity) {
            const probe = await this.automate(CALCULATOR_SCRIPTS.valid, { prepareReadiness: true }, context.signal, timeout, { ...scope, windowIdentity: admittedIdentity }) as { valid: boolean; readiness?: unknown };
            readiness = probe.readiness;
            if (!probe.valid) throw new Error("Admitted Calculator target changed; fresh approval required before reacquisition.");
            return admittedIdentity;
          }
          return (await this.automate(CALCULATOR_SCRIPTS.existing, {}, context.signal, timeout, scope) as { identity: CalculatorIdentity | null }).identity;
        },
        launch: async () => {
          if (admittedIdentity) throw new Error("A bound batch cannot launch a replacement target; fresh approval required.");
          context.signal.throwIfAborted();
          const denied = context.revalidate?.(); if (denied) throw new Error(denied);
          if (Date.now() >= scope.expiresAt) throw new Error("Approval expired before Calculator acquisition.");
          return await this.automate(CALCULATOR_SCRIPTS.acquire, args, context.signal, timeout, scope) as CalculatorAcquisition;
        },
      }, context.signal);
      if (context.desktopBatch?.windowIdentity && JSON.stringify(context.desktopBatch.windowIdentity) !== JSON.stringify(acquired.identity)) throw new Error("Acquired target differs from the admitted batch identity.");
      output = { ...acquired, ...(readiness && !("readiness" in acquired) ? { readiness } : {}), file: args.file, pid: acquired.identity.processId, windowPid: acquired.identity.processId, windowIdentity: acquired.identity, newWindows: acquired.decision === "launched" ? 1 : 0 };
    } else {
      const denied = context.revalidate?.(); if (denied) throw new Error(denied);
      output = await this.automate(script, args, context.signal, timeout, batch) as Record<string, unknown>;
      if (calculator && output.windowIdentity) this.targets.storage.save(owner, { phase: "bound", identity: output.windowIdentity as CalculatorIdentity, acquiredAt: saved?.acquiredAt ?? Date.now(), createdByBunny: saved?.createdByBunny ?? false, runId: saved?.runId ?? context.capabilityRunId ?? null });
    }
    const summaries: Record<string, () => string> = {
      "computer.list_windows": () => `${(output.windows as unknown[] | undefined)?.length ?? 0} windows; foreground "${String(output.foreground ?? "")}".`,
      "computer.read_controls": () => `${(output.controls as unknown[] | undefined)?.length ?? 0} named controls in "${String((output.window as Record<string, unknown>)?.name ?? "")}".`,
      "computer.focus_window": () => output.focused ? `Focused "${String(output.after)}".` : `Focus requested; foreground is "${String(output.after)}".`,
      "computer.invoke_control": () => `${String(output.pattern)} on "${String((output.control as Record<string, unknown>)?.name ?? "")}".`,
      "computer.type": () => output.matches ? "Value set and read back." : "Value set but the read-back differs.",
      "computer.capture": () => `Captured ${String(output.width)}×${String(output.height)} screen.`,
      "computer.open_app": () => output.decision ? output.decision === "launched" ? "Opened one verified Calculator target." : "Reused the verified Calculator target." : `Started ${String(output.file)} (pid ${String(output.pid)}).`,
      "computer.read_calculator": () => `Calculator result: ${String(output.result)}.`,
    };
    const verified = action === "computer.focus_window" ? output.focused === true : action === "computer.type" ? output.matches === true : true;
    const result: CapabilityResult = { ok: verified, status: verified ? "succeeded" : "failed", summary: summaries[action](), output, evidence: [`${action} via UI Automation at ${new Date().toISOString()}`], before: output.before, after: output.after, ...(verified ? {} : { errorCategory: "capability_failed" as const }) };
    if (output.windowIdentity) result.evidence.push(`Calculator target ${String(output.decision ?? "reused")}: ${JSON.stringify(output.windowIdentity)}`);
    if (output.readiness) result.evidence.push(`Calculator readiness: ${JSON.stringify(output.readiness)}`);
    if (action === "computer.capture" && typeof output.path === "string") result.artifacts = [{ type: "screenshot", title: "Screen capture", path: output.path, mediaType: "image/png" }];
    return result;
  }
  async prepareBatchAction(action: string, params: Record<string, unknown>, batch: ApprovalBatch) {
    if (!calculatorOperation(action, params)) throw new Error("Operation outside the Calculator batch policy.");
    const saved = this.targets.storage.load(`mission:${batch.missionId}`);
    const identity = batch.windowIdentity ?? saved?.identity ?? undefined;
    const scope = { expiresAt: batch.expiresAt, ...(identity ? { windowIdentity: identity } : {}) };
    if (action === "computer.open_app") {
      if (identity) {
        const probe = await this.automate(CALCULATOR_SCRIPTS.valid, {}, new AbortController().signal, 20_000, scope) as { valid: boolean };
        if (probe.valid) return identity;
        if (batch.windowIdentity) throw new Error("Previously approved native Calculator target is stale; fresh approval required.");
      }
      return (await this.automate(CALCULATOR_SCRIPTS.existing, {}, new AbortController().signal, 20_000, { expiresAt: batch.expiresAt }) as { identity: CalculatorIdentity | null }).identity;
    }
    const output = await this.automate("$w = Find-Window $p; Batch-Identity $w | ConvertTo-Json -Compress", params, new AbortController().signal, 20_000, scope) as NonNullable<ApprovalBatch["windowIdentity"]>;
    if (!output || !/^\d+$/.test(output.handle) || output.processId <= 0 || !/^\d+$/.test(output.processStartedAt)) throw new Error("Window identity unavailable.");
    return output;
  }
}
