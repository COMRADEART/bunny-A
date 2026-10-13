# Prints JSON { idleMs, fgName, fgTitle } — combined launch gate for desktop matrix phases.
# A focus WINDOW steal fails while the last-input window (e.g. Windows Terminal) is still foreground
# even when the user has been input-idle, because foreground does not follow idle. The launch gate is:
# idleMs >= threshold AND the foreground process has LEFT the terminal.
Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;
public static class IdleFgProbeC {
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO lii);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  public static uint IdleMs() { LASTINPUTINFO l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return unchecked((uint)Environment.TickCount - l.dwTime); }
  public static string Name() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return "?"; } }
  public static string Title() { var sb = new StringBuilder(256); GetWindowText(GetForegroundWindow(), sb, 256); return sb.ToString(); } }';
$val = @{ idleMs = [IdleFgProbeC]::IdleMs(); fgName = [IdleFgProbeC]::Name(); fgTitle = [IdleFgProbeC]::Title() }.GetEnumerator() | ForEach-Object { '"{0}":"{1}"' -f $_.Key, ($_.Value -replace '"','') }
Write-Output ('{' + ($val -join ',') + '}')