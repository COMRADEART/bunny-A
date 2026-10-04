import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { trackOwnedChild } from "../../bunny-host/owned-processes.server.ts";
import { runWindowsOwnedProcess, type ProcessOwner, type OwnedProcessRecord } from "../../bunny-host/owned-process-group.server.ts";

/** How a command is actually launched: always a real executable plus argv, never a shell string. */
export type Resolved = { file: string; prefix: string[]; display: string; owned?: boolean };

function onPath(name: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".com"] : [""];
  const hasExt = extname(name) !== "";
  for (const folder of (process.env.PATH ?? process.env.Path ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of hasExt ? [""] : exts) {
      const candidate = join(folder, name + ext);
      try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { /* unreadable PATH entry */ }
    }
  }
  return null;
}

/**
 * Resolves a command name to an executable. npm/npx run through this Node's bundled npm CLI so no
 * `.cmd` shim (and therefore no cmd.exe shell) is involved. Scripts (.cmd/.bat/.ps1) are refused.
 */
export function resolveCommand(command: string, cwd = process.cwd()): Resolved | null {
  const name = command.trim();
  if (!name || /[\s|&;<>^`$]/.test(name) && !/^[A-Za-z]:[\\/]/.test(name)) return null;
  if (/\.(cmd|bat|ps1|vbs|js|mjs)$/i.test(name)) return null;
  const lower = name.toLowerCase().replace(/\.exe$/, "");
  if (lower === "node") return { file: realpathSync(process.execPath), prefix: [], display: "node" };
  if (lower === "npm" || lower === "npx") {
    const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", `${lower}-cli.js`);
    if (existsSync(cli)) return { file: realpathSync(process.execPath), prefix: [realpathSync(cli)], display: lower };
    return null;
  }
  if (/[\\/]/.test(name)) {
    const path = resolve(cwd, name);
    return existsSync(path) && statSync(path).isFile() && (process.platform !== "win32" || /\.(exe|com)$/i.test(name)) ? { file: realpathSync(path), prefix: [], display: name, owned: /[\\/]git(?:\.exe)?$/i.test(path) } : null;
  }
  const found = onPath(name);
  return found ? { file: realpathSync(lower === "git" ? realGit(found) : found), prefix: [], display: lower, owned: lower === "git" } : null;
}

/**
 * Historical M-A-1 resolution optimization, retained for compatibility.
 * T4 containment works independently for cmd/bin/worker/wrapper roots; it does
 * not depend on this launcher shortcut or on executable names.
 * Git for Windows puts a launcher (<Git>\cmd\git.exe) on PATH that re-spawns the real git outside the
 * Host's process job: Stop's tree kill still reaches it, but after a Host crash it keeps running and
 * can finish an operation Bunny recorded as interrupted. Launch the real binary next to it instead.
 */
export function realGit(found: string, platform = process.platform): string {
  if (platform !== "win32" || !/^cmd$/i.test(dirname(found).split(/[\\/]/).at(-1) ?? "")) return found;
  const root = dirname(dirname(found));
  return ["mingw64", "clangarm64", "mingw32"].map((folder) => join(root, folder, "bin", "git.exe")).find((candidate) => existsSync(candidate)) ?? found;
}

export type RunResult = { exitCode: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; aborted: boolean; ownership?: OwnedProcessRecord };
export type RunOptions = { cwd: string; signal: AbortSignal; timeoutMs: number; maxOutput?: number; env?: NodeJS.ProcessEnv; owned?: boolean; owner?: ProcessOwner };

/** Runs one owned process (argv, no shell) with bounded output; abort ends exactly that process tree. */
export function runProcess(resolved: Resolved, args: string[], options: RunOptions): Promise<RunResult> {
  if(options.owned || resolved.owned) options={...options,env:{...(options.env??process.env),GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never",GIT_EDITOR:"false",GIT_SEQUENCE_EDITOR:"false",GIT_PAGER:"cat"}};
  if(process.platform === "win32" && (options.owned || resolved.owned)) return runWindowsOwnedProcess(resolved.file,[...resolved.prefix,...args],options);
  const max = options.maxOutput ?? 200_000; const started = Date.now();
  return new Promise((resolveRun, reject) => {
    if (options.signal.aborted) { reject(new Error("Aborted before start.")); return; }
    const child = trackOwnedChild(spawn(resolved.file, [...resolved.prefix, ...args], { cwd: options.cwd, shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] }));
    let stdout = ""; let stderr = ""; let timedOut = false; let aborted = false;
    const append = (current: string, chunk: Buffer) => current.length >= max ? current : (current + chunk.toString("utf8")).slice(0, max);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const kill = () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      if (process.platform === "win32") execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      else child.kill("SIGKILL");
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    const onAbort = () => { aborted = true; kill(); };
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => { clearTimeout(timer); options.signal.removeEventListener("abort", onAbort); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer); options.signal.removeEventListener("abort", onAbort);
      resolveRun({ exitCode: code, stdout, stderr, durationMs: Date.now() - started, timedOut, aborted });
    });
  });
}

export async function runCommand(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const resolved = resolveCommand(command, options.cwd);
  if (!resolved) throw new Error(`Command "${command}" is not an executable Bunny-A can launch without a shell.`);
  return runProcess(resolved, args, options);
}

export function tail(text: string, max = 1500) { return text.length > max ? `…${text.slice(-max)}` : text; }
