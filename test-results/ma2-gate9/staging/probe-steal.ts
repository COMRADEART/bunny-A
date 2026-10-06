// Ad-hoc diagnostic (outside all missions): does a plain focus steal succeed right now?
// Starts Calculator, asks the staged Host's focus_window via a direct capability run (READ-adjacent
// probe, never a mission), then closes the created window with a per-handle WM_CLOSE sweep.
import { execSync } from "node:child_process";
import { directRun, directOutcome } from "./live-shared.ts";

const start = execSync(
  `powershell.exe -NoProfile -NonInteractive -Command "Start-Process c:\\\\Windows\\\\System32\\\\calc.exe; Start-Sleep -Milliseconds 2500"`,
  { stdio: "ignore", timeout: 15_000 },
);
const o = directOutcome(await directRun("computer.focus_window", { title: "Calculator" }));
console.log(JSON.stringify({
  focused: o?.output?.focused ?? null,
  before: String(o?.output?.before ?? "").slice(0, 60),
  after: String(o?.output?.after ?? "").slice(0, 60),
}));

// Sweep the probe window the matrix way: title-matched WM_CLOSE, never a pid kill.
const ps = String.raw`
Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public static class StealProbeClose {
  public delegate bool Ep(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Ep cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int CloseByTitle(string like) { int n = 0; EnumWindows((h, l) => { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().IndexOf(like, StringComparison.OrdinalIgnoreCase) >= 0 && IsWindowVisible(h)) { PostMessage(h, 0x10, IntPtr.Zero, IntPtr.Zero); n++; } return true; }, IntPtr.Zero); return n; }
}';
[Wcp3.CloseByTitle('Calculator')]
$n = 0
for ($i = 0; $i -lt 6; $i++) { Start-Sleep -Milliseconds 300; $remain = [Wcp3]::CloseByTitle('Calculator'); if ($remain -eq 0) { break }; $n += $remain }
Write-Output ("swept-handles=" + $n)`.replace(/Wcp3/g, "Wcprobe" + Math.floor(Math.random() * 10000));
const out = execSync(
  `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`,
  { stdio: "pipe", timeout: 30_000 },
).toString().trim();
console.log(out);