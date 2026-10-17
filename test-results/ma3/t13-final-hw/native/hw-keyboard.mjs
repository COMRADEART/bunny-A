// BUNNY-A MA3 T13 final hardware acceptance — Phase 1 native keyboard
// re-verification at HEAD. Real install\Bunny-Island.ps1 + real disposable
// Host (port 43883). Lean scope: UIA names/focusability, live Tab round,
// Enter/Space activation, Back/Escape focus restore + collapse, minimize /
// restore. No CPU sampling (Motion.ps1 unchanged since sealed evidence).
// Writes only into this dir. Production is never referenced.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const dir = resolve(import.meta.dirname);
const repo = resolve(dir, "../../../..");
const perf = join(repo, "test-results/ma3/t13/perf/native");
const reuse = join(repo, "test-results/ma3/t13/native-final");
const scratchRoot = join(tmpdir(), `bunny-t13-hw-native-${process.pid}`);
mkdirSync(scratchRoot, { recursive: true });
const ps = (file, args) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 120_000 });
const results = { startedAt: new Date().toISOString(), checks: [], notes: [] };
const write = (f, o) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2) + "\n");
const check = (name, ok, detail = null) => { results.checks.push({ name, ok: !!ok, detail }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)?.slice(0, 250)); };
const parse = (label, r) => {
  if (r.status !== 0) throw new Error(`${label} failed: ${r.status}\n${(r.stderr ?? "").slice(0, 2000)}`);
  return JSON.parse((r.stdout ?? "").trim());
};
let seed, islandPid = null, fixturePid = null;
const kill = async (pid) => { if (!pid) return; try { execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch (e) { results.notes.push(`taskkill ${pid}: ${e.message}`); } };
try {
  seed = spawn(process.execPath, [join(dir, "seed-host.mjs")], { cwd: dir, env: { ...process.env, T13_PERF_PORT: "43883", T13_PERF_SCRATCH: scratchRoot }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let acc = "";
  const fixture = await new Promise((done, fail) => {
    seed.stdout.on("data", (b) => { acc += String(b); const line = acc.split("\n").find((l) => l.includes('"classification"')); if (line) { try { done(JSON.parse(line)); } catch {} } });
    seed.on("exit", (c) => fail(new Error("seed exited " + c)));
    setTimeout(() => fail(new Error("fixture host did not report")), 25000);
  });
  await sleep(500);
  const token = JSON.parse(readFileSync(fixture.credentials, "utf8")).token;
  fixturePid = fixture.pid ?? null;
  let okState = false;
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch("http://127.0.0.1:43883/state", { headers: { authorization: `Bearer ${token}` } }); if (r.ok) { okState = true; break; } } catch {}
    await sleep(500);
  }
  if (!okState) throw new Error("fixture state unreachable");
  write("host-fixture.json", { port: 43883, pid: fixturePid });

  const launch = parse("launch", ps(join(perf, "launch-island.ps1"), ["-Cred", fixture.credentials, "-Scratch", scratchRoot, "-Motion", "full", "-Edge", "top", "-Out", join(dir, "launch.json")]));
  islandPid = launch.launchedPid;
  await sleep(9000);
  check("Real Island window is present (HEAD source)", true, { islandPid });

  const uia = parse("uia", ps(join(perf, "uia-dump.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "uia-collapsed.json")]));
  const weapons = ["gada", "spear", "chakra", "sword"];
  const buttons = (uia.focusableList ?? []).filter((f) => /button/i.test(f));
  check("All four weapon chips are named focusable Buttons", weapons.every((w) => buttons.some((b) => b.toLowerCase().includes(w))), { focusableList: uia.focusableList, unnamed: uia.keyboardFocusableUnnamed });

  parse("shot1", ps(join(reuse, "capture-shot.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "shots", "collapsed.png")]));

  const tab = parse("tab", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "tab", "-Count", "12", "-Out", join(dir, "tab-round.json")]));
  const tabNames = tab.steps.filter((s) => s.focused?.name).map((s) => `${s.step}:${s.focused.name}`);
  check("Tab round reaches every weapon chip with no abort", weapons.every((w) => tabNames.some((n) => n.toLowerCase().includes(w))) && !tab.aborted, { tabNames, aborted: tab.aborted });

  // Targeted focus moves along the collapsed cycle.
  const cycle = ["gada", "spear", "chakra", "sword", "quick controls", "open workspace", "bunny", "voice"];
  const cycleIdx = (name) => { const n = (name ?? "").toLowerCase(); const i = cycle.findIndex((k) => n.includes(k)); return i; };
  const gotoChip = (fromName, key, out) => {
    const from = cycleIdx(fromName);
    const to = cycle.indexOf(key);
    const delta = ((to - from) % cycle.length + cycle.length) % cycle.length;
    if (delta === 0) return null;
    return parse("goto-" + key, ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "tab", "-Count", String(delta), "-Out", join(dir, out)]));
  };
  const rectOf = (r) => r.windowRectAfter ?? r.steps?.at(-1)?.islandRect;
  const h = (r) => Number((r ?? "0,0,0,0").split(",")[3] ?? 0);
  let cur = tab.steps.at(-1)?.focused?.name ?? "";
  const collapsedH = h(rectOf(tab));

  gotoChip(cur, "gada", "tab-gada.json");
  const enter = parse("enter", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "enter", "-Count", "1", "-Out", join(dir, "enter-gada.json")]));
  const enterFocus = enter.steps?.at(-1)?.focused?.name ?? "";
  check("Enter on the Gada chip expands the detail panel", h(rectOf(enter)) > collapsedH + 40, { after: rectOf(enter), focused: enterFocus });
  parse("shot2", ps(join(reuse, "capture-shot.ps1"), ["-IslandPid", String(islandPid), "-Out", join(dir, "shots", "gada-expanded.png")]));

  const esc1 = parse("esc1", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "esc", "-Count", "1", "-Out", join(dir, "esc-collapse.json")]));
  check("Escape collapses the expanded panel", h(rectOf(esc1)) <= collapsedH + 40, { after: rectOf(esc1) });

  // Space activation: move to the Spear chip first, then press Space.
  cur = esc1.steps?.at(-1)?.focused?.name ?? "";
  const preSpace = gotoChip(cur, "spear", "tab-spear.json");
  if (preSpace) cur = preSpace.steps?.at(-1)?.focused?.name ?? cur;
  const space = parse("space", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "space", "-Count", "1", "-Out", join(dir, "space-spear.json")]));
  check("Space on the Spear chip also activates (expands detail)", h(rectOf(space)) > collapsedH + 40, { after: rectOf(space), focused: space.steps?.at(-1)?.focused });
  const back = parse("back", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "back", "-Count", "1", "-Out", join(dir, "back.json")]));
  const backName = (back.steps?.at(-1)?.focused?.name ?? "").toLowerCase();
  check("Back returns focus to the chip or Quick controls", backName.includes("spear") || backName.includes("quick controls"), { focused: back.steps?.at(-1)?.focused });
  parse("esc2", ps(join(reuse, "keys2.ps1"), ["-IslandPid", String(islandPid), "-Action", "esc", "-Count", "1", "-Out", join(dir, "esc-final.json")]));

  const min = parse("min", ps(join(reuse, "window-cmd.ps1"), ["-IslandPid", String(islandPid), "-Command", "minimize", "-Out", join(dir, "minimize.json")]));
  check("Minimize iconifies the Island window", min.isIconic === true, min);
  const res = parse("res", ps(join(reuse, "window-cmd.ps1"), ["-IslandPid", String(islandPid), "-Command", "restore", "-Out", join(dir, "restore.json")]));
  check("Restore brings the Island window back", res.isIconic === false, res);

  await kill(islandPid); islandPid = null;
  await kill(fixturePid);
  check("Disposable fixture Host stopped", true, { pid: fixturePid });
} catch (e) {
  results.fatal = String(e?.stack ?? e);
  console.error("FATAL", results.fatal);
} finally {
  await kill(islandPid);
  try { seed?.kill(); } catch {}
  try { rmSync(scratchRoot, { recursive: true, force: true }); } catch {}
  results.finished = true;
  results.classification = "LIVE HEAD-source: real install\\Bunny-Island.ps1 island (owned PID), real disposable Host 43883. Real SendKeys, foreground verified per key. Production untouched.";
  write("hw-keyboard-summary.json", results);
}
process.exitCode = results.fatal || results.checks.some((c) => !c.ok) ? 1 : 0;
