# M-A-3 T12: names the top-level window under a screen point (physical pixels) and its owning process. Read-only.
param([int]$X, [int]$Y)
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class BunnyWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
}
'@
[void][BunnyWin]::SetProcessDPIAware()
$p = New-Object BunnyWin+POINT; $p.X = $X; $p.Y = $Y
$h = [BunnyWin]::WindowFromPoint($p)
$top = [BunnyWin]::GetAncestor($h, 2)
foreach ($w in @($h, $top)) {
  $pid0 = 0; [void][BunnyWin]::GetWindowThreadProcessId($w, [ref]$pid0)
  $t = New-Object Text.StringBuilder 256; [void][BunnyWin]::GetWindowText($w, $t, 256)
  $c = New-Object Text.StringBuilder 256; [void][BunnyWin]::GetClassName($w, $c, 256)
  $proc = Get-Process -Id $pid0 -ErrorAction SilentlyContinue
  $ex = [BunnyWin]::GetWindowLong($w, -20)
  '{0} hwnd={1} pid={2} proc={3} class={4} title="{5}" exstyle=0x{6:X8}' -f ($(if ($w -eq $h) { 'hit' } else { 'top' })), $w, $pid0, $proc.ProcessName, $c, $t, $ex
}
