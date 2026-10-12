# T13 PERF lane native helpers (LIVE measurement tooling). Dot-source from the other scripts in this folder.
# Every probe here targets ONE process: the PID it is given (the Island this lane launched). Nothing touches production.
$ErrorActionPreference = 'Stop'
if (-not ('T13Native' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class T13Native {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hmon, int dpiType, out uint dpiX, out uint dpiY);
  [DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr hProcess, out int value);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static List<IntPtr> WindowsOfPid(int pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { int p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static int ProcessAwareness(int pid) {
    IntPtr hp = OpenProcess(0x0400 | 0x1000, false, pid);
    if (hp == IntPtr.Zero) return -1;
    try { int v; int hr = GetProcessDpiAwareness(hp, out v); return hr == 0 ? v : -2; } finally { CloseHandle(hp); }
  }
}
'@
}
# Per-monitor-aware (V2) for THIS process: coordinates and captures are then physical pixels.
[void][T13Native]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Map-Awareness([int]$v) { switch ($v) { 0 { 'unaware' } 1 { 'system-aware' } 2 { 'per-monitor-aware' } -1 { 'unknown(access denied)' } default { 'error' } } }
function Map-ContextAwareness([IntPtr]$ctx) {
  $v = [T13Native]::GetAwarenessFromDpiAwarenessContext($ctx)
  return (Map-Awareness $v)
}

# The Island's main window: the largest visible HwndWrapper owned by the PID (popups such as tooltips are smaller).
function Get-IslandMainWindow([int]$IslandPid) {
  $best = $null; $bestArea = -1
  foreach ($h in [T13Native]::WindowsOfPid($IslandPid)) {
    if (-not ([T13Native]::ClassOf($h) -like 'HwndWrapper*')) { continue }
    $r = New-Object T13Native+RECT
    [void][T13Native]::GetWindowRect($h, [ref]$r)
    $area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
    if ($area -gt $bestArea) { $best = $h; $bestArea = $area }
  }
  if (-not $best) { throw "no visible Island window for PID $IslandPid" }
  return $best
}
