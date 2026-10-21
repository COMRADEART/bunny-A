/**
 * MA4-S1R2 qualification sandbox: runs untrusted generated programs only behind Linux kernel isolation
 * (WSL2 user/mount/pid/net namespaces, pivot_root, cgroup v2 limits, dropped capabilities).
 * Import allowlists elsewhere are defense in depth only. When the backend is not proven available,
 * callers must report dynamic execution as BLOCKED and never fall back to a plain subprocess.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const SANDBOX_BACKEND = "wsl2-userns-pivot_root-cgroupv2";
const launcherWindowsPath = fileURLToPath(new URL("./sandbox-launcher.py", import.meta.url));

export const SandboxRequestSchema = z.object({
  files: z.record(z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/), z.string()).refine(f => { const n = Object.keys(f).length; return n >= 1 && n <= 32; }),
  argv: z.array(z.string().max(255)).min(1).max(32).refine(a => a[0] === "python3", "Only python3 is allowlisted."),
  timeoutMs: z.number().int().min(100).max(120_000).default(20_000),
  memoryMb: z.number().int().min(32).max(1024).default(256),
  pids: z.number().int().min(1).max(64).default(16),
  outputBytes: z.number().int().min(1024).max(1_048_576).default(65_536),
  diskMb: z.number().int().min(1).max(256).default(16),
}).strict();
export type SandboxRequest = z.input<typeof SandboxRequestSchema>;

export const SandboxResultSchema = z.object({
  ok: z.literal(true), backend: z.literal(SANDBOX_BACKEND), unit: z.string(),
  exitCode: z.number().int().nullable(), signal: z.number().int().nullable(),
  oomKilled: z.boolean(), memoryPeakBytes: z.number().int().nullable(),
  timedOut: z.boolean(), cancelled: z.boolean(), outputTruncated: z.boolean(), outerDeadline: z.boolean().optional(),
  stdout: z.string(), stderr: z.string(), durationMs: z.number().int(),
  remainingProcesses: z.number().int().nullable(), workspaceRemoved: z.boolean(),
});
export type SandboxResult = z.infer<typeof SandboxResultSchema>;
export type SandboxAvailability = { available: true; backend: string; kernel: string } | { available: false; reason: string; checks?: Record<string, boolean> };

/** C:\x\y → /mnt/c/x/y (WSL default automount root). Any other shape is refused rather than guessed. */
export function wslPath(windowsPath: string): string {
  const m = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (!m || /[\0\n]/.test(windowsPath)) throw new Error("Sandbox launcher path is not a local drive path.");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

type Runner = (args: string[], input: string | null, signal?: AbortSignal, hardKillMs?: number) => Promise<{ code: number | null; stdout: string }>;
const wsl: Runner = (args, input, signal, hardKillMs = 30_000) => new Promise((resolve, reject) => {
  const child = spawn("wsl.exe", ["--exec", "/usr/bin/python3", "-I", wslPath(launcherWindowsPath), ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => { if (stdout.length < 4_000_000) stdout += d; });
  child.stderr.resume();
  child.on("error", reject);
  // The Linux side cancels on any further stdin line or EOF; the hard kill only bounds a wedged wsl.exe.
  const cancel = () => { try { child.stdin.end("cancel\n"); } catch { /* already closed */ } };
  signal?.addEventListener("abort", cancel, { once: true });
  const hard = setTimeout(() => { cancel(); child.kill(); }, hardKillMs);
  child.on("close", code => { clearTimeout(hard); signal?.removeEventListener("abort", cancel); resolve({ code, stdout }); });
  child.stdin.on("error", () => undefined);
  if (input !== null) child.stdin.write(input + "\n"); else child.stdin.end();
});

let cached: Promise<SandboxAvailability> | null = null;
/** Proves (not assumes) the kernel features the isolation relies on. Fails closed. */
export function sandboxAvailability(run: Runner = wsl): Promise<SandboxAvailability> {
  if (run === wsl && cached) return cached;
  const result = (async (): Promise<SandboxAvailability> => {
    if (process.platform !== "win32") return { available: false, reason: "The qualification sandbox backend is implemented for Windows hosts with WSL2." };
    try {
      const { code, stdout } = await run(["--probe"], null, undefined, 60_000);
      const probe = z.object({ ok: z.boolean(), checks: z.record(z.string(), z.boolean()), kernel: z.string() }).parse(JSON.parse(stdout.trim().split("\n").pop() ?? ""));
      return code === 0 && probe.ok ? { available: true, backend: SANDBOX_BACKEND, kernel: probe.kernel } : { available: false, reason: "WSL2 sandbox prerequisites are missing.", checks: probe.checks };
    } catch (e) {
      return { available: false, reason: `WSL2 sandbox probe failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  if (run === wsl) cached = result;
  return result;
}

export class SandboxBlocked extends Error { readonly code = "SANDBOX_BLOCKED"; }

/** Runs one request in a fresh sandbox. Throws SandboxBlocked when isolation is not proven; never runs unsandboxed. */
export async function runSandboxed(raw: SandboxRequest, signal?: AbortSignal, run: Runner = wsl): Promise<SandboxResult> {
  const request = SandboxRequestSchema.parse(raw);
  const availability = await sandboxAvailability(run);
  if (!availability.available) throw new SandboxBlocked(availability.reason);
  signal?.throwIfAborted();
  const { stdout } = await run([], JSON.stringify(request), signal, request.timeoutMs + 30_000);
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim().split("\n").pop() ?? ""); } catch { throw new Error("Sandbox returned no result; the run is treated as failed."); }
  const failure = z.object({ ok: z.literal(false), error: z.string() }).safeParse(parsed);
  if (failure.success) throw new Error(`Sandbox refused the request: ${failure.data.error}`);
  return SandboxResultSchema.parse(parsed);
}
