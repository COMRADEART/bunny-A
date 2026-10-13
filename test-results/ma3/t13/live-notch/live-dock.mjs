// M-A-3 T13 LIVE docking evidence driver. LIVE = the real install\Bunny-Island.ps1 against a REAL disposable Host
// (t11-mission-worker from the T12 harness, port 43870). Pointer release points are SYNTHETIC; the keyboard chord is real
// Ctrl+Alt+Arrow input. Production (43119, gateway 8084, %LOCALAPPDATA%\Bunny-A) is never touched. Writes:
//   test-results/ma3/t13/live-notch/live-dock-receipts.json  (receipts and checks)
//   test-results/ma3/t13/live-notch/shots/run-*.png          (screenshots of every snapshot)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../../t12/live/lib.mjs";

const here = import.meta.dirname;
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "bunny-t13-live-"));
const pref = join(work, "pref.json");
const deploy = join(work, "no-deploy");
const PORT = 43870;
const RUN_A = "run-a-dock", RUN_B = "run-b-relaunch";

const prefFor = (edge) => ({ edge, position: "center", size: "compact", motion: "full", theme: "dark", glass: "medium", idle: "providers", collapse: 10, primary: ["codex", "claude", "ollama"], edgeOffset: 0.5, monitor: null });

function runIsland(hookName, runName, host) {
  return new Promise((done) => {
    const env = { ...process.env, T13_LIVE_OUT: here, T13_LIVE_RUN: runName, T13_LIVE_PORT: String(PORT) };
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "live-wrapper.ps1"), "-HookFile", join(here, hookName), "-Pref", pref, "-Shots", shots, "-Cred", host.credentials, "-Deploy", deploy], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "", out = "";
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ } }, 240_000);
    child.on("exit", (code) => { clearTimeout(timer); done({ code, stderr: err.slice(-2000), stdout: out.slice(-1000) }); });
  });
}

const expandDir = { top: "down", bottom: "up", left: "right", right: "left" };
const horizontal = (edge) => edge === "top" || edge === "bottom";
const inside = (w, a) => w.left >= a.left - 0.01 && w.top >= a.top - 0.01 && w.left + w.width <= a.left + a.width + 0.01 && w.top + w.height <= a.top + a.height + 0.01;

const host = await startHost({ port: PORT, label: "t13-live" });
const receipt = { label: "LIVE", realHost: true, hostPort: PORT, hostPid: host.pid, pointerInput: "synthetic release points (Invoke-BunnyDockRelease -DevicePoint) on each edge band", keyboardInput: "real Ctrl+Alt+Arrow key input (keybd_event) to the Island window; a landed chord is recorded as keyboard-chord, a miss as fallback-Set-BunnyDockEdge", generatedAt: new Date().toISOString() };
const checks = {};
try {
  // Missions are off by default on a fresh Host; the disposable Host is switched on through its own workstation command.
  const missionsOn = await host.command("mission.configure", { enabled: true });
  if (missionsOn.status !== 200) throw new Error("mission.configure refused: " + JSON.stringify(missionsOn.body).slice(0, 400));
  // Two real user-facing Agents on the disposable Host, bound to slots 1 and 2 (the workstation credential).
  const first = await host.command("agent.create", { objective: "T13 live docking demo: research the release notes" });
  const second = await host.command("agent.create", { objective: "T13 live docking demo: write the release summary" });
  if (first.status !== 200 || second.status !== 200) throw new Error("agent.create refused: " + JSON.stringify([first.body, second.body]).slice(0, 600));
  const ids = second.body.snapshot.personalAgents.bindable.map((a) => a.id);
  if (ids.length < 2) throw new Error("expected two bindable Agents, got " + ids.length);
  const slots = [1, 2, 3, 4].map((slot, i) => ({ slot, weapon: ["gada", "spear", "chakra", "sword"][i], displayName: slot === 1 ? "Research Gada" : slot === 2 ? "Summary Spear" : "", description: "", purpose: "", style: "concise", responsibilities: [], agentId: slot === 1 ? ids[0] : slot === 2 ? ids[1] : null, active: true }));
  const configured = await host.command("personal_agents.configure", { slots, expectRevision: 0 });
  checks.hostConfiguredSlots = configured.status === 200;
  receipt.host = { agents: ids.slice(0, 2), configureStatus: configured.status, revision: configured.body?.snapshot?.personalAgents?.revision ?? null };
  writeFileSync(pref, JSON.stringify(prefFor("top")), "utf8");

  // Display observation (read-only): monitor count, bounds, work areas, system DPI.
  receipt.display = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "observe-display.ps1")], { encoding: "utf8", windowsHide: true }).trim());

  // Run A: the dock sequence in one Island process.
  const a = await runIsland("hook-dock.ps1", RUN_A, host);
  receipt.runA = { exitCode: a.code, stderr: a.stderr };
  const runA = JSON.parse(readFileSync(join(here, RUN_A + ".json"), "utf8"));
  const prefAfterA = JSON.parse(readFileSync(pref, "utf8"));

  // Run B: close and relaunch with the same preference file; the restored placement is read back, nothing is changed.
  const b = await runIsland("hook-restore.ps1", RUN_B, host);
  receipt.runB = { exitCode: b.code, stderr: b.stderr };
  const runB = JSON.parse(readFileSync(join(here, RUN_B + ".json"), "utf8"));

  const snaps = runA.snaps;
  const chipsFirst = JSON.stringify(snaps[0].chipNames);
  receipt.perSnapshot = snaps.map((s) => ({
    label: s.label, edge: s.edge, view: s.view, window: s.window, workArea: s.workArea, orientation: s.orientation, indicatorSide: s.indicatorSide, expandDirection: s.expandDirection, chipNames: s.chipNames, companionState: s.companionState, online: s.online, lastError: s.lastError, screenshot: s.screenshot,
    insideWorkArea: inside(s.window, s.workArea),
    expandDirectionOk: s.expandDirection === expandDir[s.edge],
    stripSideOk: horizontal(s.edge) ? s.indicatorSide === "left" : s.indicatorSide === "top",
    orientationOk: s.orientation === (horizontal(s.edge) ? "horizontal" : "vertical"),
    chipOrderUnchanged: JSON.stringify(s.chipNames) === chipsFirst,
  }));
  const every = (f) => receipt.perSnapshot.every(f);
  checks.allSnapshotsInsideWorkArea = every((s) => s.insideWorkArea);
  checks.expansionAnchoredToEdge = every((s) => s.expandDirectionOk);
  checks.stripOnSideForOrientation = every((s) => s.stripSideOk);
  checks.orientationMatchesEdge = every((s) => s.orientationOk);
  checks.slotOrderUnchangedAcrossOrientations = every((s) => s.chipOrderUnchanged) && JSON.stringify(runB.chipNames) === chipsFirst;
  checks.twoBoundChipsEveryEdge = every((s) => s.chipNames.length === 2);
  checks.liveHostEveryEdge = every((s) => s.online === true && s.companionState !== "DISCONNECTED");
  checks.noIslandErrors = every((s) => !s.lastError) && !runB.lastError;
  checks.dragReleasesSnapToTarget = runA.drags.every((d) => d.edgeAfter === d.target && d.offsetAfter >= 0 && d.offsetAfter <= 1);
  checks.dragAlongEdgeChangesOffsetInOrder = (() => {
    const left = runA.drags.filter((d) => d.target === "left" && d.fraction !== 0.7 && d.fraction !== 0.4);
    const top = runA.drags.filter((d) => d.target === "top");
    return left.length === 2 && top.length === 2 && left[0].offsetAfter < left[1].offsetAfter && top[0].offsetAfter < top[1].offsetAfter;
  })();
  checks.keyboardChordReachesEdge = runA.keys.every((k) => k.edgeAfter === k.target);
  receipt.keyboard = { chordLanded: runA.keys.map((k) => ({ target: k.target, chordLanded: k.chordLanded, path: k.path, windowForeground: k.windowForeground })) };
  receipt.drags = runA.drags;
  const lastCollapsed = snaps.find((s) => s.label === "13-top-offset-0.8");
  receipt.restore = {
    restoredEdge: runB.restoredPreferences.edge, expectedEdge: prefAfterA.edge, restoredOffset: runB.restoredPreferences.edgeOffset, savedOffset: prefAfterA.edgeOffset,
    restoredMonitor: runB.restoredPreferences.monitor, savedMonitor: prefAfterA.monitor, runAFinalWindow: lastCollapsed.window, runBWindow: runB.window,
  };
  checks.relaunchRestoresEdge = runB.restoredPreferences.edge === prefAfterA.edge && runB.restoredPreferences.edge === runA.finalPreferences.edge;
  checks.relaunchRestoresOffset = Math.abs(runB.restoredPreferences.edgeOffset - prefAfterA.edgeOffset) < 1e-6;
  checks.relaunchRestoresMonitor = JSON.stringify(runB.restoredPreferences.monitor) === JSON.stringify(prefAfterA.monitor);
  checks.relaunchRestoresWindow = Math.abs(runB.window.left - lastCollapsed.window.left) <= 1 && Math.abs(runB.window.top - lastCollapsed.window.top) <= 1 && Math.abs(runB.window.width - lastCollapsed.window.width) < 0.5 && Math.abs(runB.window.height - lastCollapsed.window.height) < 0.5;
  checks.relaunchStripSideOk = runB.expandDirection === expandDir[runB.restoredPreferences.edge] && (horizontal(runB.restoredPreferences.edge) ? runB.indicatorSide === "left" : runB.indicatorSide === "top");
  checks.islandExitedCleanly = a.code === 0 && b.code === 0;
  receipt.hostAfter = await host.state().then((st) => ({ personalAgentSlots: (st.personalAgents?.slots ?? []).filter((x) => x && x.agentId).map((x) => ({ slot: x.slot, agentId: x.agentId })) })).catch((e) => ({ error: String(e.message ?? e) }));
} catch (error) {
  receipt.failure = String(error?.stack ?? error).slice(0, 2000);
} finally {
  await host.stop();
  rmSync(work, { recursive: true, force: true });
}
receipt.checks = checks;
const values = Object.values(checks);
receipt.summary = { checks: values.length, passed: values.filter(Boolean).length, failed: values.filter((v) => !v).length, failure: receipt.failure ?? null };
writeFileSync(join(here, "live-dock-receipts.json"), JSON.stringify(receipt, null, 2), "utf8");
console.log(JSON.stringify({ summary: receipt.summary, checks }, null, 2));
