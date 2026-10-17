// Phase 1 Narrator session: Narrator runs while real Island keyboard input is
// sent. Records Narrator PID/lifetime, UIA focus names per Tab (the strings
// Narrator announces), and clean Narrator shutdown. No transcript API exists;
// speech content is the UIA names already captured. Writes only into this dir.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const dir = resolve(import.meta.dirname);
const repo = resolve(dir, "../../../..");
const perf = join(repo, "test-results/ma3/t13/perf/native");
const reuse = join(repo, "test-results/ma3/t13/native-final");
const scratchRoot = join(tmpdir(), `bunny-t13-hw-narr-${process.pid}`);
mkdirSync(scratchRoot, { recursive: true });
const ps = (file, args) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 120_000 });
const results = { startedAt: new Date().toISOString(), checks: [], notes: [] };
const write = (f, o) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2) + "\n");
const check = (name, ok, detail = null) => { results.checks.push({ name, ok: !!ok, detail }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)?.slice(0, 300)); };
const parse = (label, r) => {
  if (r.status !== 0) throw new Error(`${label} failed: ${r.status}\n${(r.stderr ?? "").slice(0, 2000)}`);
  return JSON.parse((r.stdout ?? "").trim());
};
const psOut = (cmd) => spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8", windowsHide: true, timeout: 30000 }).stdout.trim();
let seed, islandPid = null, fixturePid = null;
const kill = async (pid) => { if (!pid) return; try { execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} };
try {
  seed = spawn(process.execPath, [join(dir, "seed-host.mjs")], { cwd: dir, env: { ...process.env, T13_PERF_PORT: "43886", T13_PERF_SCRATCH: scratchRoot }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const fixture = await new Promise((done, fail) => {
    let acc = "";
    seed.stdout.on("data", (b) => { acc += String(b); const line = acc.split("\n").find((l) => l.includes('"classification"')); if (line) { try { done(JSON.parse(line)); } catch {} } });
    seed.on("exit", (c) => fail(new Error("seed exited " + c)));
    setTimeout(() => fail(new Error("fixture host did not report")), 25000);
  });
  await sleep(500);
  const token = JSON.parse(readFileSync(fixture.credentials, "utf8")).token;
  fixturePid = fixture.pid ?? null;
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch("http://127.0.0.1:43886/state", { headers: { authorization: `Bearer ${token}` } }); if (r.ok) break; } catch {}
    await sleep(500);
  }
  const launch = parse("launch", ps(join(perf, "launch-island.ps1"), ["-Cred", fixture.credentials, "-Scratch", scratchRoot, "-Motion", "full", "-Edge", "top", "-Out", join(dir, "launch-narrator.json")]));
  islandPid = launch.launchedPid;
  await sleep(9000);

  const before = psOut("Get-Process Narrator -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id");
  check("Narrator was not already running (clean session start)", before === "", { before });

  // Start Narrator: the actual assistive technology, not a simulation.
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "Start-Process Narrator.exe"], { windowsHide: true, stdio: "ignore" });
  await sleep(6000);
  const narrPid = psOut("Get-Process Narrator -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id");
  check("Narrator is running during the walkthrough", /^\d+$/.test(narrPid), { narrPid });
  results.narratorPid = narrPid;

  // Real Tab input while Narrator tracks focus. Announced strings == UIA names.
  const tab = parse("tab", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "tab", "-Count", "4", "-Out", join(dir, "narrator-tab.json")]));
  const names = tab.steps.filter((s) => s.focused?.name).map((s) => `${s.step}:${s.focused.controlType}:${s.focused.name}`);
  const allNamed = tab.steps.filter((s) => s.focused).every((s) => (s.focused.name ?? "").length > 0);
  check("Narrator-tracked Tab stops are all named controls", !tab.aborted && allNamed, { names, aborted: tab.aborted });

  // Narrator still healthy afterwards (no crash of the AT itself).
  const still = psOut("Get-Process Narrator -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id");
  check("Narrator stayed alive through Island keyboard use", still === narrPid, { still });

  try { execFileSync("taskkill.exe", ["/IM", "Narrator.exe", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  await sleep(2000);
  const gone = psOut("Get-Process Narrator -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id");
  check("Narrator stopped cleanly after the session", gone === "", { gone });
  await kill(islandPid); islandPid = null;
  await kill(fixturePid);
  check("Cleanup stopped owned processes", true, null);
} catch (e) {
  results.fatal = String(e?.stack ?? e);
  console.error("FATAL", results.fatal);
} finally {
  try { execFileSync("taskkill.exe", ["/IM", "Narrator.exe", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  await kill(islandPid);
  try { seed?.kill(); } catch {}
  try { rmSync(scratchRoot, { recursive: true, force: true }); } catch {}
  results.finished = true;
  results.limitation = "Narrator exposes no speech transcript API; announcement content is proven by the UIA names/roles/live-regions it consumes (this run + web probe). Human-ear review of prosody/verbosity was not performed.";
  write("hw-narrator-summary.json", results);
}
process.exitCode = results.fatal || results.checks.some((c) => !c.ok) ? 1 : 0;
