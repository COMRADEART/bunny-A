param([int]$ProcessId, [string]$Out)
# Captures ONE window owned by the given process id (the Island this run launched) with PrintWindow, so an overlapping
# window of another process is not included. Read-only: no input is sent to any window.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class T13Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint nFlags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> ForProcess(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
"@
$handles = [T13Win]::ForProcess([uint32]$ProcessId)
if ($handles.Count -eq 0) { throw "No visible window for process $ProcessId" }
$best = $null; $bestArea = 0
foreach ($h in $handles) {
  $r = New-Object T13Win+RECT
  [void][T13Win]::GetWindowRect($h, [ref]$r)
  $w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
  if ($w * $hgt -gt $bestArea) { $bestArea = $w * $hgt; $best = @{ h = $h; w = $w; h2 = $hgt } }
}
if (-not $best -or $best.w -le 0) { throw "No sized window for process $ProcessId" }
$bmp = New-Object System.Drawing.Bitmap $best.w, $best.h2
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [T13Win]::PrintWindow($best.h, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "captured pid=$ProcessId size=$($best.w)x$($best.h2) printWindow=$ok file=$Out"
