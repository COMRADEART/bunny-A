import { execOwnedFile } from "./owned-processes.server.ts";
import type { ProcessInfo } from "../orch/types.ts";

const exec = execOwnedFile;

/** One snapshot of the OS process table: PID, parent PID, image name and creation time. */
export async function processTable(): Promise<ProcessInfo[]> {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.Name,$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }) }";
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [pid, ppid, name, created] = line.split("|");
      return { pid: Number(pid), ppid: Number(ppid), name, createdAt: created ? Date.parse(created) : null };
    }).filter((row) => Number.isInteger(row.pid));
  }
  const { stdout } = await exec("ps", ["-A", "-o", "pid=,ppid=,comm="], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length >= 3).map(([pid, ppid, ...name]) => ({ pid: Number(pid), ppid: Number(ppid), name: name.join(" "), createdAt: null }));
}

/**
 * The root and every process descended from it, root first. A child only counts when it was created
 * after its parent, which rules out a reused PID being mistaken for a descendant.
 */
export function descendants(rows: ProcessInfo[], rootPid: number): ProcessInfo[] {
  const root = rows.find((row) => row.pid === rootPid);
  if (!root) return [];
  const tree = [root];
  for (let index = 0; index < tree.length; index++) {
    const parent = tree[index];
    for (const row of rows) {
      if (row.ppid !== parent.pid || row.pid === parent.pid || tree.some((known) => known.pid === row.pid)) continue;
      if (parent.createdAt !== null && row.createdAt !== null && row.createdAt < parent.createdAt) continue;
      tree.push(row);
    }
  }
  return tree;
}

/** Processes from an earlier snapshot that are still alive as the same process (same PID and creation time). */
export function survivors(before: ProcessInfo[], after: ProcessInfo[]): ProcessInfo[] {
  return before.filter((old) => after.some((row) => row.pid === old.pid && (old.createdAt === null || row.createdAt === old.createdAt)));
}

export function describeTree(tree: ProcessInfo[]): string {
  return tree.map((row) => `${row.name} ${row.pid}`).join(" → ") || "no processes";
}

/** Ends one specific process that a snapshot proved belongs to an owned session. */
export async function killProcess(pid: number): Promise<void> {
  if (process.platform === "win32") await exec("taskkill.exe", ["/PID", String(pid), "/F"], { windowsHide: true, timeout: 5000 });
  else process.kill(pid, "SIGKILL");
}
