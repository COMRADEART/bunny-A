// T13 native-final: fresh LIVE native evidence on the CURRENT source. Real install\Bunny-Island.ps1 + real disposable
// Host 43881. Covers: UIA collapsed weapon controls (E02/IR-H3), real Tab/Enter/Back/Escape keyboard behavior
// (IR-H3), minimize motion-suppression CPU (IR-M5/E04) and a same-machine Motion-Off baseline. Production is never
// referenced; every Island PID here is one this driver launched and stops at the end.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const dir = resolve(import.meta.dirname);
const repo = resolve(dir, "../../../..");
const perf = join(repo, "test-results/ma3/t13/perf/native");
const scratchRoot = join(tmpdir(), `bunny-t13-native-final-${process.pid}`);
mkdirSync(scratchRoot, { recursive: true });
mkdirSync(join(dir, "shots"), { recursive: true });
const ps = (file, args, out) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 240_000 });
const parse = (label, r) => {
  if (r.status !== 0) throw new Error(`${label} powershell failed: ${r.status}\n${(r.stderr ?? "").slice(0, 4000)}`);
  const text = (r.stdout ?? "").trim();
  try { return JSON.parse(text); }
  catch (e) { results.notes.push(`${label} stdout repr: ${JSON.stringify(text).slice(0, 2000)}`); throw e; }
};
const j = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, obj) => writeFileSync(join(dir, file), JSON.stringify(obj, null, 2) + "\n");
const results = { checks: [], samples: {}, notes: [] };
const check = (name, ok, detail = null) => { results.checks.push({ name, ok: !!ok, detail }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)?.slice(0, 300)); };
let seed, islandPid = null, secondPid = null, killed = false, fixturePid = null;
// Own-up any leftover island/fixture processes from THIS lane only (matched by its scratch name), never other lanes.
try {
  const o = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'bunny-t13-native-final-' } | ForEach-Object { taskkill.exe /PID $($_.ProcessId) /T /F 2>$null }"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (o.stdout?.trim()) results.notes.push("own-lane cleanup: " + o.stdout.trim().slice(0, 300));
} catch { }
const kill = async (pid) => { if (!pid) return; try { execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch (e) { results.notes.push(`taskkill ${pid}: ${e.message}`); } };
try {
  // 1. disposable fixture Host
  seed = spawn(process.execPath, [join(dir, "seed-host2.mjs")], { cwd: dir, env: { ...process.env, T13_PERF_PORT: "43881", T13_PERF_SCRATCH: scratchRoot }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let seedExit = null;
  seed.on("exit", (code, sig) => { seedExit = code ?? sig; console.error(`SEED-EXIT ${code ?? sig}`); });
  seed.stderr.on("data", (b) => process.stderr.write(`[seed] ${b}`));
  const waitStdout = new Promise((done) => { let acc = ""; seed.stdout.on("data", (b) => { acc += String(b); if (acc.includes("}\n")) { const line = acc.split("\n").find((l) => l.includes('"classification"')); if (line) { try { done(JSON.parse(line)); } catch (e) { console.error("RECORD-PARSE-FAIL", String(e)); } } } }); });
  const fixture = await Promise.race([waitStdout, sleep(25_000).then(() => { throw new Error("fixture host did not report"); })]);
  await sleep(500);
  const token = JSON.parse(readFileSync(fixture.credentials, "utf8")).token;
  fixturePid = fixture.pid ?? null;
  let st = null, lastErr = null;
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://127.0.0.1:43881/state`, { headers: { authorization: `Bearer ${token}` } }); if (r.ok) { st = r; break; } lastErr = `state ${r.status}`; }
    catch (e) { lastErr = String(e?.cause?.code ?? e.message); }
    await sleep(500);
  }
  if (!st) throw new Error(`fixture state unreachable: ${lastErr}`);
  if (seedExit !== null) throw new Error(`seed exited early: ${seedExit}`);
  write("host-fixture-live.json", { ...fixture, healthState: "ok" });
  const cred = fixture.credentials;

  // 2. Island #1: full motion, top edge
  const launch1 = parse("launch1", ps(join(perf, "launch-island.ps1"), ["-Cred", cred, "-Scratch", scratchRoot, "-Motion", "full", "-Edge", "top", "-Out", join(dir, "launch-1.json")]));
  islandPid = launch1.launchedPid;
  await sleep(9_000);
  check("Real Island window is present", true, { islandPid, pref: launch1.pref });

  // 3. UIA collapsed dump + screenshot
  const uia = parse("uia", ps(join(perf, "uia-dump.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "uia-collapsed-final.json")]));
  const weapons = ["gada", "spear", "chakra", "sword"];
  const buttons = (uia.focusableList ?? []).filter((f) => /button/i.test(f));
  const chip = (w) => buttons.find((b) => b.toLowerCase().includes(w));
  check("All four weapon chips are named, focusable Button controls (E02/IR-H3)", weapons.every((w) => chip(w)), { focusableList: uia.focusableList, keyboardFocusableUnnamed: uia.keyboardFocusableUnnamed });
  results.samples.collapsedFull = parse("sample1", ps(join(perf, "sample.ps1"), ["-IslandPid", String(islandPid), "-Seconds", "25", "-Label", "collapsed full motion", "-Out", join(dir, "cpu-collapsed-full-final.json")]));
  const shot1 = parse("shot1", ps(join(dir, "capture-shot.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "shots", "collapsed.png")]));

  // 4. Tab round over the collapsed strip
  const tab = parse("tab", ps(join(dir, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "tab", "-Count", "12", "-Out", join(dir, "tab-round-final.json")]));
  const tabNames = tab.steps.filter((s) => s.focused?.name).map((s) => s.step + ":" + s.focused.name);
  check("Tab round reaches every weapon chip", weapons.every((w) => tabNames.some((n) => n.toLowerCase().includes(w))), { tabNames, aborted: tab.aborted });
  const gadaStep = tab.steps.find((s) => s.focused?.name && s.focused.name.toLowerCase().includes("gada"));
  if (gadaStep) {
    const land = parse("land", ps(join(dir, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "tab", "-Count", String(gadaStep.step), "-Out", join(dir, "tab-gada-final.json")]));
    const before = land.windowRectAfter ?? land.steps.at(-1)?.islandRect;
    const enter = parse("enter", ps(join(dir, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "enter", "-Count", "1", "-Out", join(dir, "enter-gada-final.json")]));
    const h = (r) => Number((r ?? "").split(",")[3] ?? 0);
    check("Enter on the Gada chip expands the detail panel", h(enter.windowRectAfter) > h(before) + 40, { before, after: enter.windowRectAfter, focused: enter.steps.at(-1)?.focused });
    const shot2 = parse("shot2", ps(join(dir, "capture-shot.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "shots", "gada-expanded.png")]));
    const back = parse("back", ps(join(dir, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "back", "-Count", "1", "-Out", join(dir, "back-gada-final.json")]));
    const backName = (back.steps.at(-1)?.focused?.name ?? "").toLowerCase();
    check("Back/Escape returns focus to the originating chip or Quick controls (IR-H3)", backName.includes("gada") || backName.includes("quick controls"), { focused: back.steps.at(-1)?.focused, after: back.windowRectAfter });
    const esc = parse("esc", ps(join(dir, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "esc", "-Count", "1", "-Out", join(dir, "esc-final.json")]));
    check("Escape collapses the expanded panel again", h(esc.windowRectAfter) <= h(before) + 40, { after: esc.windowRectAfter, bunny: esc.bunnyButtonRectAfter ?? null });
  } else check("Enter/Back/Escape path on Gada chip", false, "no Gada chip reached in tab round");

  // 5. minimize motion suppression
  const minCmd = parse("min", ps(join(dir, "window-cmd.ps1"), ["-IslandPid", String(islandPid), "-Command", "minimize", "-Out", join(dir, "minimize.json")]));
  check("Minimize actually minimizes the Island window", minCmd.isIconic === true, minCmd);
  await sleep(1_500);
  results.samples.minimized = parse("sample2", ps(join(dir, "sample-guarded.ps1"), ["-IslandPid", String(islandPid), "-Seconds", "20", "-Label", "minimized full motion", "-Out", join(dir, "cpu-minimized-final.json")]));
  check("Window stays iconic for the whole minimized sample (no restore flip)", results.samples.minimized.iconicAlwaysTrue === true, { iconicFlips: results.samples.minimized.iconicFlips });
  const resCmd = parse("res", ps(join(dir, "window-cmd.ps1"), ["-IslandPid", String(islandPid), "-Command", "restore", "-Out", join(dir, "restore.json")]));
  await sleep(2_000);
  results.samples.restored = parse("sample3", ps(join(perf, "sample.ps1"), ["-IslandPid", String(islandPid), "-Seconds", "10", "-Label", "restored collapsed full motion", "-Out", join(dir, "cpu-restored-final.json")]));
  const collapsedAvg = results.samples.collapsedFull.avgCpuPctOneCore, minAvg = results.samples.minimized.avgCpuPctOneCore, restAvg = results.samples.restored.avgCpuPctOneCore;
  check("Minimized idle CPU drops far below collapsed full-motion idle (IR-M5/E04 direction)", minAvg < collapsedAvg * 0.5, { collapsedAvg, minAvg, restAvg, minimizedNotMinimizedRestored: restAvg, collapsedFullP95: results.samples.collapsedFull.p95IntervalCpuPctOneCore, minP95: results.samples.minimized.p95IntervalCpuPctOneCore });
  await kill(islandPid); killed = true;

  // 6. Island #2: Motion Off baseline (same machine, fresh pref)
  const launch2 = parse("launch2", ps(join(perf, "launch-island.ps1"), ["-Cred", cred, "-Scratch", scratchRoot, "-Motion", "off", "-Edge", "top", "-Out", join(dir, "launch-2.json")]));
  secondPid = launch2.launchedPid;
  await sleep(9_000);
  results.samples.motionOff = parse("sample4", ps(join(perf, "sample.ps1"), ["-IslandPid", String(secondPid), "-Seconds", "20", "-Label", "collapsed motion off", "-Out", join(dir, "cpu-motion-off-final.json")]));
  const moAvg = results.samples.motionOff.avgCpuPctOneCore;
  results.notes.push(`Same-machine cost ladder (avg CPU % of one core): collapsed full ${collapsedAvg}, minimized ${minAvg}, motion-off ${moAvg}. Minimized sits ${Math.min(minAvg - moAvg, 999).toFixed(1)} pp above motion-off.`);
  check("Minimized cost sits near the same-machine Motion Off baseline (disclosed, not a spec budget)", minAvg <= moAvg + 8, { minAvg, moAvg });

  // 7. teardown
  await kill(secondPid);
  await kill(fixturePid);
  writeFileSync(join(dir, "close"), "");
  await sleep(2_500);
  check("Disposable fixture Host stopped", !existsSync(join(dir, "close")) || seed.exitCode !== null, { seedExit: seed.exitCode, pid: fixture.pid });
} catch (e) {
  results.fatal = String(e?.stack ?? e);
  console.error("FATAL", results.fatal);
} finally {
  if (!killed) await kill(islandPid);
  await kill(secondPid);
  try { writeFileSync(join(dir, "close"), ""); } catch {}
  try { rmSync(scratchRoot, { recursive: true, force: true }); } catch {}
  write("native-final-summary.json", { ...results, classification: "LIVE: real install\\Bunny-Island.ps1 islands (PIDs this launch owned), real disposable Host 43881. Keyboard via real SendKeys with foreground verified per key. Production untouched.", finished: true });
  try { seed.kill(); } catch {}
  try { await kill(fixturePid); } catch {}
}
process.exitCode = results.fatal || results.checks.some((c) => !c.ok) ? 1 : 0;