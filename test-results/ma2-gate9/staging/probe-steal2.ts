// Ad-hoc diagnostic (outside all missions): does a SECOND foreground change (Calculator → Notepad)
// succeed after a long settle? Replicates phase C's sequence with no mission involved.
import { execSync } from "node:child_process";
import { wait } from "./live-shared.ts";
import { directRun, directOutcome } from "./live-shared.ts";

const start = (exe: string, settleMs: number) =>
  { execSync(`powershell.exe -NoProfile -NonInteractive -Command "Start-Process ${exe}"`, { stdio: "ignore", timeout: 15_000 }); };

const focus = async (title: string) => {
  const o = directOutcome(await directRun("computer.focus_window", { title }));
  console.log(JSON.stringify({ ask: title, focused: o?.output?.focused ?? null, before: String(o?.output?.before ?? "").slice(0, 50), after: String(o?.output?.after ?? "").slice(0, 50) }));
};

start("c:\\Windows\\System32\\calc.exe", 0);
await wait(3_000);
await focus("Calculator"); // first steal: expected to succeed (window was just launched)
start("notepad.exe", 0);
await wait(15_000);
await focus("Notepad");    // second steal: the question of this probe

const ps = String.raw`
Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public static class Wcprobe9s {
  public delegate bool Ep(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Ep cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int CloseByTitle(string like){int n=0; EnumWindows((h,l)=>{var sb=new StringBuilder(256); GetWindowText(h,sb,256); if(sb.ToString().IndexOf(like,StringComparison.OrdinalIgnoreCase)>=0 && IsWindowVisible(h)){PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero); n++;} return true;}, IntPtr.Zero); return n;}
}';
$n1 = [Wcprobe9s]::CloseByTitle('Calculator')
Start-Sleep -Milliseconds 700
$n2 = [Wcprobe9s]::CloseByTitle('Notepad')
Start-Sleep -Milliseconds 700
$n3 = [Wcprobe9s]::CloseByTitle('Notepad')
Write-Output ("calc-posted=$n1 notepad-posted=$n2 notepad-remaining=$n3")`;
const out = execSync(
  `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`,
  { stdio: "pipe", timeout: 30_000 },
).toString().trim();
console.log(out);