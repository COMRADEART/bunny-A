import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { scopedPath } from "../paths.server.ts";
import type { ActionManifest, CapabilityResult } from "../types.ts";
import type { CapabilityAdapter, ExecutionContext } from "./bus.server.ts";
import { trackOwnedChild } from "../../bunny-host/owned-processes.server.ts";

const input = (name: string, type: ActionManifest["inputs"][number]["type"], required: boolean, description: string) => ({ name, type, required, description });
/** Applications Bunny may start by name. Anything else needs a new skill or capability, not a free-form command. */
export const APPS: Record<string, string> = { notepad: "notepad.exe", calculator: "calc.exe", paint: "mspaint.exe", explorer: "explorer.exe", terminal: "wt.exe" };
const EXECUTABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|pif|lnk|reg|hta|cpl|jar|appref-ms)$/i;

const PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:BUNNY_COMPUTER_PARAMS | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class BunnyWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@
function Find-Window($p) {
  $all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $all) {
    $c = $w.Current
    if (($p.pid -and $c.ProcessId -eq [int]$p.pid) -or ($p.title -and $c.Name -like ('*' + $p.title + '*'))) { return $w }
  }
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
`;
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
if ([BunnyWin]::IsIconic($h)) { [void][BunnyWin]::ShowWindow($h, 9) }
[void][BunnyWin]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 250
$after = [BunnyWin]::Title([BunnyWin]::GetForegroundWindow())
@{ before = $before; after = $after; target = (Describe $w); focused = ($after -eq $w.Current.Name) } | ConvertTo-Json -Depth 4 -Compress`,
  "computer.invoke_control": String.raw`
$w = Find-Window $p
$e = Find-Control $w $p
$pattern = $null; $kind = ''
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); $kind = 'invoke' }
elseif ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle(); $kind = 'toggle' }
elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); $kind = 'select' }
elseif ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) { $pattern.Expand(); $kind = 'expand' }
else { throw ('Control supports no invoke/toggle/select/expand pattern: ' + $e.Current.Name) }
@{ control = (Describe $e); windowPid = $w.Current.ProcessId; pattern = $kind } | ConvertTo-Json -Depth 4 -Compress`,
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
$before = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })
$proc = if ($p.target) { Start-Process -FilePath ([string]$p.file) -ArgumentList ('"' + [string]$p.target + '"') -PassThru } else { Start-Process -FilePath ([string]$p.file) -PassThru }
Start-Sleep -Milliseconds 800
$after = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })
@{ pid = $proc.Id; file = $p.file; newWindows = @($after | Where-Object { $before -notcontains $_ }).Count } | ConvertTo-Json -Compress`,
};

function powershell(script: string, params: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  return new Promise((resolveRun, reject) => {
    const child = trackOwnedChild(execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `${PRELUDE}\n${script}`], { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, BUNNY_COMPUTER_PARAMS: JSON.stringify(params) }, signal }, (error, stdout, stderr) => {
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
  constructor(dataDirectory: string) { this.dataDirectory = dataDirectory; }
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
    ] satisfies ActionManifest[],
  };
  async health() {
    if (process.platform !== "win32") return { availability: "unsupported" as const, detail: "The Computer Runtime is implemented for Windows only." };
    return { availability: "available" as const, detail: "Windows UI Automation and user32 via powershell.exe. Raw mouse/keyboard injection is intentionally not offered." };
  }
  async execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
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
      args.file = APPS[app];
      if (typeof params.target === "string" && params.target) {
        const target = scopedPath(context.cwd, params.target, context.roots);
        if (!existsSync(target)) throw new Error(`${target} does not exist.`);
        if (statSync(target).isFile() && EXECUTABLE.test(extname(target))) throw new Error("Executable and script files are never opened by the Computer Runtime.");
        args.target = target;
      }
    }
    const output = await powershell(script, args, context.signal, Math.min(context.timeoutMs, 60_000)) as Record<string, unknown>;
    const summaries: Record<string, () => string> = {
      "computer.list_windows": () => `${(output.windows as unknown[] | undefined)?.length ?? 0} windows; foreground "${String(output.foreground ?? "")}".`,
      "computer.read_controls": () => `${(output.controls as unknown[] | undefined)?.length ?? 0} named controls in "${String((output.window as Record<string, unknown>)?.name ?? "")}".`,
      "computer.focus_window": () => output.focused ? `Focused "${String(output.after)}".` : `Focus requested; foreground is "${String(output.after)}".`,
      "computer.invoke_control": () => `${String(output.pattern)} on "${String((output.control as Record<string, unknown>)?.name ?? "")}".`,
      "computer.type": () => output.matches ? "Value set and read back." : "Value set but the read-back differs.",
      "computer.capture": () => `Captured ${String(output.width)}×${String(output.height)} screen.`,
      "computer.open_app": () => `Started ${String(output.file)} (pid ${String(output.pid)}).`,
    };
    const verified = action === "computer.focus_window" ? output.focused === true : action === "computer.type" ? output.matches === true : true;
    const result: CapabilityResult = { ok: verified, status: verified ? "succeeded" : "failed", summary: summaries[action](), output, evidence: [`${action} via UI Automation at ${new Date().toISOString()}`], before: output.before, after: output.after, ...(verified ? {} : { errorCategory: "capability_failed" as const }) };
    if (action === "computer.capture" && typeof output.path === "string") result.artifacts = [{ type: "screenshot", title: "Screen capture", path: output.path, mediaType: "image/png" }];
    return result;
  }
}
