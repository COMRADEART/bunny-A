# Captures ONLY top-level WPF windows owned by the given process id (PrintWindow, no screen grab of other windows).
param([int]$ProcessId, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class CapW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Found(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
"@
$hwnds = [CapW]::Found([uint32]$ProcessId)
$best = $null; $bestArea = 0; $bestClass = ""
foreach ($h in $hwnds) {
  $sb = New-Object System.Text.StringBuilder 256; [void][CapW]::GetClassName($h, $sb, 256)
  $cls = $sb.ToString()
  $r = New-Object CapW+RECT; [void][CapW]::GetWindowRect($h, [ref]$r)
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($cls -like "HwndWrapper*" -and $w * $hh -gt $bestArea) { $best = $h; $bestArea = $w * $hh; $bestClass = $cls }
}
if ($best -eq $null) { @{ ok = $false; reason = "no visible WPF window for pid $ProcessId"; windows = $hwnds.Count } | ConvertTo-Json -Compress; exit 0 }
$r = New-Object CapW+RECT; [void][CapW]::GetWindowRect($best, [ref]$r)
$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [CapW]::PrintWindow($best, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
@{ ok = $ok; pid = $ProcessId; hwnd = $best.ToInt64(); cls = $bestClass; rect = @($r.Left, $r.Top, $r.Right, $r.Bottom); out = $Out } | ConvertTo-Json -Compress
