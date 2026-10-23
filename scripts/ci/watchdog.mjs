#!/usr/bin/env node
// CI process watchdog: runs one command under a wall-clock budget, tees its output to a log, and on timeout records the
// process tree and listening ports, stops the tree (graceful, then forced) and exits 124 with a named failure. After the
// command ends, either way, it reports processes started during the run that are still alive (orphans) and stops them.
//
//   node scripts/ci/watchdog.mjs --label <name> --budget-s <seconds> --out <dir> -- <command> [args...]
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const windows = process.platform === "win32";

export function parseArgs(argv) {
  const split = argv.indexOf("--");
  if (split < 0 || split === argv.length - 1) throw new Error("usage: watchdog --label L --budget-s N --out DIR -- command [args...]");
  const flags = {};
  for (let i = 0; i < split; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error(`bad flag: ${argv[i]}`);
    flags[argv[i].slice(2)] = argv[i + 1];
  }
  const budget = Number(flags["budget-s"]);
  if (!flags.label || !flags.out || !(budget > 0)) throw new Error("--label, --out and a positive --budget-s are required");
  const grace = flags["grace-s"] === undefined ? 15 : Number(flags["grace-s"]);
  return { label: flags.label, out: flags.out, budgetMs: budget * 1000, graceMs: grace * 1000, command: argv.slice(split + 1) };
}

/** Every live process: pid, parent, name, start time and a command line clipped to 400 characters. */
export function snapshot() {
  if (windows) {
    const script =
      "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; started=if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }; cmd=$_.CommandLine } } | ConvertTo-Json -Compress";
    const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", maxBuffer: 64 << 20, windowsHide: true });
    const rows = JSON.parse(run.stdout || "[]");
    return (Array.isArray(rows) ? rows : [rows])
      .filter((row) => !/Get-CimInstance Win32_Process|Get-NetTCPConnection/.test(row.cmd ?? ""))
      .map((row) => ({ ...row, cmd: (row.cmd ?? "").slice(0, 400) }));
  }
  const run = spawnSync("ps", ["-eo", "pid=,ppid=,lstart=,args="], { encoding: "utf8" });
  return run.stdout.split("\n").filter(Boolean).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), name: match[4].split(" ")[0], started: new Date(match[3]).toISOString(), cmd: match[4].slice(0, 400) } : null;
  }).filter((row) => row && !/\bps -eo\b/.test(row.cmd));
}

/** The root and every process whose parent chain reaches it. */
export function descendants(rows, root) {
  const tree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) if (!tree.has(row.pid) && tree.has(row.ppid)) tree.add(row.pid), (grew = true);
  }
  return rows.filter((row) => tree.has(row.pid));
}

function listeners(pids) {
  if (!windows) return [];
  const script = "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress";
  const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  const rows = JSON.parse(run.stdout || "[]");
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => pids.has(row.OwningProcess));
}

function stop(pids, force) {
  for (const pid of pids) {
    if (windows) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true });
    else {
      try {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM");
      } catch {}
    }
  }
}

const alive = (pids) => new Set(snapshot().map((row) => row.pid).filter((pid) => pids.has(pid)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function watch({ label, out, budgetMs, graceMs, command }) {
  mkdirSync(out, { recursive: true });
  const startedAt = new Date();
  const before = new Set(snapshot().map((row) => row.pid));
  const log = createWriteStream(join(out, `${label}.log`));
  const child = spawn(command[0], command.slice(1), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: !windows });
  for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on("data", (chunk) => {
      sink.write(chunk);
      log.write(chunk);
    });
  }
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  let timer;
  const timedOut = new Promise((resolve) => (timer = setTimeout(() => resolve("timeout"), budgetMs)));
  const outcome = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  const report = { schema: "bunny-ci-watchdog/1", label, command, budgetMs, startedAt: startedAt.toISOString(), rootPid: child.pid };

  if (outcome === "timeout") {
    const rows = snapshot();
    const tree = descendants(rows, child.pid);
    const pids = new Set(tree.map((row) => row.pid));
    Object.assign(report, { result: "TIMEOUT", tree, listeners: listeners(pids) });
    stop([child.pid, ...pids], false);
    await Promise.race([exited, wait(graceMs)]);
    const stubborn = alive(pids);
    report.survivedGraceful = [...stubborn];
    stop(stubborn, true);
    await Promise.race([exited, wait(5000)]);
    report.survivedForced = [...alive(pids)];
  } else Object.assign(report, { result: "EXITED", ...outcome });

  // Anything this run started that outlived it is an orphan, whatever the outcome.
  // A new process counts when it descends from the command or lost its parent (Windows keeps the dead parent id).
  const now = snapshot();
  const live = new Set(now.map((row) => row.pid));
  const ours = new Set(descendants(now, child.pid).map((row) => row.pid));
  const orphans = now.filter(
    (row) => !before.has(row.pid) && row.pid !== process.pid && !/^(conhost|WerFault)\.exe$/i.test(row.name) && Date.parse(row.started) >= startedAt.getTime() - 1000 && (ours.has(row.pid) || !live.has(row.ppid)),
  );
  report.orphans = orphans;
  if (orphans.length) {
    stop(orphans.map((row) => row.pid), true);
    await wait(2000);
    report.orphansAfterCleanup = [...alive(new Set(orphans.map((row) => row.pid)))];
  }
  report.endedAt = new Date().toISOString();
  await new Promise((resolve) => log.end(resolve));
  writeFileSync(join(out, `${label}.watchdog.json`), `${JSON.stringify(report, null, 2)}\n`);

  if (report.result === "TIMEOUT") {
    const files = [...new Set(report.tree.flatMap((row) => row.cmd.match(/\S+\.test\.(?:ts|mjs)/g) ?? []))];
    console.error(`\n::error title=WATCHDOG TIMEOUT::${label} exceeded ${budgetMs / 1000}s; still running: ${files.join(" ") || "(no test file in the tree)"}; ${report.tree.length} processes, see ${label}.watchdog.json`);
    return 124;
  }
  if (orphans.length) console.error(`::warning title=ORPHAN PROCESSES::${label} left ${orphans.length} process(es) running: ${orphans.map((row) => `${row.name}#${row.pid}`).join(", ")}`);
  return report.code ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await watch(parseArgs(process.argv.slice(2)));
}
