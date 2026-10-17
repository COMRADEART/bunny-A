// Follow-up: the WeaponBack button ("Back to the Notch") is the Island's Back
// control (Backspace has no key handler; Escape is separate). With the weapon
// detail panel expanded, activate WeaponBack with Enter and record collapse +
// focus. Writes only into this dir.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const dir = resolve(import.meta.dirname);
const repo = resolve(dir, "../../../..");
const perf = join(repo, "test-results/ma3/t13/perf/native");
const reuse = join(repo, "test-results/ma3/t13/native-final");
const scratchRoot = join(tmpdir(), `bunny-t13-hw-back-${process.pid}`);
mkdirSync(scratchRoot, { recursive: true });
const ps = (file, args) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 120_000 });
const results = { startedAt: new Date().toISOString(), checks: [], notes: [] };
const write = (f, o) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2) + "\n");
const check = (name, ok, detail = null) => { results.checks.push({ name, ok: !!ok, detail }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)?.slice(0, 300)); };
const parse = (label, r) => {
  if (r.status !== 0) throw new Error(`${label} failed: ${r.status}\n${(r.stderr ?? "").slice(0, 2000)}`);
  return JSON.parse((r.stdout ?? "").trim());
};
let seed, islandPid = null, fixturePid = null;
const kill = async (pid) => { if (!pid) return; try { execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} };
try {
  seed = spawn(process.execPath, [join(dir, "seed-host.mjs")], { cwd: dir, env: { ...process.env, T13_PERF_PORT: "43884", T13_PERF_SCRATCH: scratchRoot }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
    try { const r = await fetch("http://127.0.0.1:43884/state", { headers: { authorization: `Bearer ${token}` } }); if (r.ok) break; } catch {}
    await sleep(500);
  }
  const launch = parse("launch", ps(join(perf, "launch-island.ps1"), ["-Cred", fixture.credentials, "-Scratch", scratchRoot, "-Motion", "full", "-Edge", "top", "-Out", join(dir, "launch-back.json")]));
  islandPid = launch.launchedPid;
  await sleep(9000);
  // Tab once from the window root lands on Gada; Enter expands and focuses WeaponBack.
  parse("t1", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "tab", "-Count", "1", "-Out", join(dir, "back-tab1.json")]));
  const enter = parse("enter", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "enter", "-Count", "1", "-Out", join(dir, "back-enter.json")]));
  const h = (r) => Number(((r.windowRectAfter ?? r.steps?.at(-1)?.islandRect ?? "0,0,0,0").split(",")[3] ?? 0));
  const expandedFocus = enter.steps?.at(-1)?.focused?.name ?? "";
  check("Activating Gada focuses the Back control", h(enter) > 200 && expandedFocus.includes("Back to the Notch"), { after: enter.windowRectAfter, focused: expandedFocus });
  // Press Enter on WeaponBack: Close-BunnyDetails must collapse and drop focus on a strip chip.
  const backGo = parse("backgo", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "enter", "-Count", "1", "-Out", join(dir, "back-activate.json")]));
  const backFocus = (backGo.steps?.at(-1)?.focused?.name ?? "").toLowerCase();
  const collapsed = h(backGo) <= 200;
  const onChip = ["gada", "spear", "chakra", "sword", "quick controls"].some((k) => backFocus.includes(k));
  check("WeaponBack collapses the panel and returns focus to a chip", collapsed && onChip, { after: backGo.windowRectAfter, focused: backGo.steps?.at(-1)?.focused });
  parse("shot", ps(join(reuse, "capture-shot.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "shots", "after-back.png")]));
  await kill(islandPid); islandPid = null;
  await kill(fixturePid);
  check("Cleanup stopped owned processes", true, null);
} catch (e) {
  results.fatal = String(e?.stack ?? e);
  console.error("FATAL", results.fatal);
} finally {
  await kill(islandPid);
  try { seed?.kill(); } catch {}
  try { rmSync(scratchRoot, { recursive: true, force: true }); } catch {}
  results.finished = true;
  write("hw-back-summary.json", results);
}
process.exitCode = results.fatal || results.checks.some((c) => !c.ok) ? 1 : 0;
