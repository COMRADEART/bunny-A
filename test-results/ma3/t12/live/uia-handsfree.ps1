# M-A-3 T12: drives the real WPF test Island with UI Automation the way a user would, to find why "Start hands-free" did
# not start listening live. Steps: tap the mic (opens voice), tick Hands-free (a real mouse click: a UIA Toggle does not
# raise the WPF Click the Island listens to), then press Start hands-free. Each step's UI state is printed; the Host's
# voice.state is recorded separately by uia-host.mjs. Only the Island process this script started is touched.
param([Parameter(Mandatory)] [string]$CredentialPath, [Parameter(Mandatory)] [string]$Repo, [string]$Out = '', [ValidateSet('mouse','keyboard')] [string]$TickWith = 'mouse', [ValidateSet('top','left','right','bottom')] [string]$Edge = 'top')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class BunnyUiaMouse {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int X; public int Y; }
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
}
'@
[void][BunnyUiaMouse]::SetProcessDPIAware()
$log = [Collections.Generic.List[string]]::new()
function Note([string]$m) { $line = ('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $m); $log.Add($line); Write-Output $line }

$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t12-uia-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
('{"edge":"' + $Edge + '","position":"center","size":"compact","motion":"reduced","theme":"dark"}') | Set-Content -Path (Join-Path $work 'pref.json') -Encoding ascii
$islandLog = Join-Path $work 'island.log'
$island = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Repo 'install\Bunny-Island.ps1'), '-CredentialPath', $CredentialPath, '-DeploymentPath', (Join-Path $work 'no-deploy'), '-PreferencePath', (Join-Path $work 'pref.json')) -PassThru -RedirectStandardError $islandLog -RedirectStandardOutput (Join-Path $work 'island.out')
Note "island pid $($island.Id)"
$root = [Windows.Automation.AutomationElement]::RootElement
$win = $null
for ($i = 0; $i -lt 80 -and -not $win; $i++) {
  Start-Sleep -Milliseconds 250
  $cond = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $island.Id)
  $win = $root.FindFirst([Windows.Automation.TreeScope]::Children, $cond)
  if ($island.HasExited) { break }
}
if (-not $win) { Note "NO WINDOW (exited=$($island.HasExited)) stderr: $((Get-Content $islandLog -Raw -ErrorAction SilentlyContinue))"; exit 2 }
Note "window '$($win.Current.Name)'"

function Find([string]$name) {
  $c = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $name)
  return $win.FindFirst([Windows.Automation.TreeScope]::Descendants, $c)
}
function Describe([string]$name) {
  $e = Find $name
  if (-not $e) { return "$name=<absent>" }
  $r = $e.Current.BoundingRectangle
  $rect = if ($r.IsEmpty -or [double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Width)) { 'none' } else { "$([int]$r.X),$([int]$r.Y),$([int]$r.Width)x$([int]$r.Height)" }
  $toggle = ''
  try { $toggle = ' toggle:' + $e.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState } catch { }
  return "$name=enabled:$($e.Current.IsEnabled) offscreen:$($e.Current.IsOffscreen) rect:$rect$toggle"
}
function Snapshot([string]$label) {
  Note ("[$label] " + ((@('Voice input', 'Hands-free listening, explicit opt-in', 'Start hands-free listening', 'Finish my turn', 'End voice session') | ForEach-Object { Describe $_ }) -join ' | '))
}
function ClickCenter($e) {
  $r = $e.Current.BoundingRectangle
  $pt = [Windows.Point]::new($r.X + $r.Width / 2, $r.Y + $r.Height / 2)
  $hit = [Windows.Automation.AutomationElement]::FromPoint($pt)
  $w = $hit; $chain = @(); for ($k = 0; $k -lt 4 -and $w; $k++) { $chain += ($w.Current.ControlType.ProgrammaticName + ":" + $w.Current.Name + ":pid" + $w.Current.ProcessId); $w = [Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($w) }
  Note ("hit-test at " + [int]$pt.X + "," + [int]$pt.Y + " -> " + ($chain -join " < "))
  [BunnyUiaMouse]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
}

$saved = New-Object BunnyUiaMouse+POINT
[void][BunnyUiaMouse]::GetCursorPos([ref]$saved)
try {
  Start-Sleep -Seconds 2
  Snapshot 'start'
  $mic = Find 'Voice input'
  if (-not $mic) { Note 'no Voice input button'; exit 3 }
  # Step 1: the mic, as a keyboard-style activation (Invoke raises Click: Start-BunnyVoiceListen 'button').
  $mic.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Seconds 3
  Snapshot 'after mic'
  # Step 2: tick Hands-free with a real mouse click.
  $hf = Find 'Hands-free listening, explicit opt-in'
  if (-not $hf) { Note 'Hands-free checkbox not found'; exit 4 }
  if ($hf.Current.IsOffscreen) { Note 'Hands-free checkbox is offscreen; scrolling it into view'; try { $hf.GetCurrentPattern([Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch { Note "scroll failed: $_" } }
  if ($TickWith -eq "keyboard") { Add-Type -AssemblyName System.Windows.Forms; $hf.SetFocus(); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait(" "); Note "ticked with focus + Space" } else { ClickCenter $hf; Note "ticked with mouse" }
  Start-Sleep -Milliseconds 400
  Snapshot "just after tick"
  Start-Sleep -Seconds 3
  Snapshot 'after hands-free tick'
  # Step 3: Start hands-free, by Invoke (the button's own Click) and, if nothing happened, by a real mouse click.
  $start = Find 'Start hands-free listening'
  if (-not $start) { Note 'Start hands-free not found'; exit 5 }
  if (-not $start.Current.IsEnabled) { Note 'Start hands-free is DISABLED' }
  $start.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Seconds 4
  Snapshot 'after start (invoke)'
  # Step 4: end voice through the Island's own control.
  $end = Find 'End voice session'
  if ($end) { $end.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Seconds 2; Snapshot 'after end voice' }
} finally {
  [void][BunnyUiaMouse]::SetCursorPos($saved.X, $saved.Y)
  if (-not $island.HasExited) { & taskkill.exe /PID $island.Id /T /F | Out-Null }
  Note "island stderr: $((Get-Content $islandLog -Raw -ErrorAction SilentlyContinue))"
  if ($Out) { $log | Set-Content -Path $Out -Encoding utf8 }
}
