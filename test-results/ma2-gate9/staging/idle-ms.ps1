# Prints system-wide idle milliseconds (GetLastInputInfo). Used by watchers to gate desktop phases on real user idle.
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class IdleProbeB {
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO lii);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static uint IdleMs() { LASTINPUTINFO l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return unchecked((uint)Environment.TickCount - l.dwTime); }
}';
[IdleProbeB]::IdleMs()