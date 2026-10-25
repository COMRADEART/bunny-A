import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { HostDatabase } from "../../src/lib/bunny-host/persistence.server.ts";

const MODEL = "huihui_ai/qwen2.5-abliterate:7b";
const local = process.env.LOCALAPPDATA;
const install = join(local, "Bunny-T1R3-Install");
const release = join(install, "releases", "Bunny-A-T1R3-TEST");
const nodeExe = join(release, "runtime", "node.exe");
const license = join(release, "runtime", "LICENSE");
const state = join(install, "state");
const workspace = join(process.env.USERPROFILE, "Documents", "Bunny-T1R3-Workspace");
const port = 43761;
const evidence = join(import.meta.dirname, "../../docs/ma4-s3-t1r3/evidence");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const realStartup = join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bunny-A.lnk");
const realInstall = join(local, "Bunny-A");
const exists = (path) => { try { statSync(path); return true; } catch { return false; } };

function client(token) {
  const headers = { connection: "close", authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    command: (action, data = {}) => fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers, body: JSON.stringify({ action, data }) }).then(async (r) => ({ status: r.status, body: await r.json() })),
    state: () => fetch(`http://127.0.0.1:${port}/state`, { headers }).then((r) => r.json()),
  };
}

async function chat(api, prompt) {
  const started = performance.now();
  const created = await api.command("submit", { prompt, mode: "fast", constraints: { localOnly: true, outputTokens: 48, maxRuntimeMs: 60000, modelExact: MODEL } });
  const id = created.body?.task?.id;
  if (!id || created.status !== 200) return { ok: false, status: created.status, error: created.body?.error ?? null, plan: created.body?.task?.executionPlan ?? null };
  await api.command("approve", { id });
  let task = null;
  const deadline = performance.now() + 75000;
  while (performance.now() < deadline) {
    task = ((await api.state()).tasks ?? []).find((row) => row.id === id) ?? null;
    if (task && ["completed", "failed", "stopped"].includes(task.state)) break;
    await sleep(80);
  }
  return { ok: task?.state === "completed", state: task?.state ?? null, ms: Math.round(performance.now() - started), output: String(task?.output ?? "").slice(0, 160), plan: task?.executionPlan ?? null, servedDigest: task?.servedModel?.digest ?? null, verification: task?.verification ?? null };
}

const version = await new Promise((resolve) => execFile(nodeExe, ["-p", "process.version"], { windowsHide: true }, (e, out) => resolve(e ? String(e) : out.trim())));
const licenseText = readFileSync(license, "utf8");
const manifest = JSON.parse(readFileSync(join(release, "release-manifest.json"), "utf8"));
const report = {
  node: { version, sha256: sha256(nodeExe), bytes: statSync(nodeExe).size, licenseBytes: statSync(license).size, licenseNamesNode: licenseText.includes("Copyright Node.js contributors") },
  sourceCommit: manifest.sourceCommit,
  realInstallBefore: statSync(realInstall).mtimeMs,
  realShortcutBefore: statSync(realStartup).mtimeMs,
};
rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });
const db = new HostDatabase(join(state, "host.sqlite"));
const schema = db.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
const schemaSha = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
const versionRow = db.db.prepare("PRAGMA user_version").get();
db.close();
for (const folder of ["credentials", "settings", "runtime", "logs", "backups", "cloudflared", "sessions"]) mkdirSync(join(state, folder), { recursive: true });
writeFileSync(join(state, "settings", "remote.json"), "{}");
writeFileSync(join(state, "state-layout.json"), JSON.stringify({ schema: "bunny-state/2", stateRoot: state, databaseUserVersion: versionRow.user_version, databaseSchemaSha256: schemaSha }, null, 2));
mkdirSync(workspace, { recursive: true });
const manifestSha = sha256(join(release, "release-manifest.json"));
writeFileSync(join(install, "install.json"), JSON.stringify({
  schema: "bunny-install/2", stateLayoutVersion: 2, installRoot: install, stateRoot: state, dataDirectory: state,
  workspace, hostPort: port,
  currentRelease: { name: manifest.release, version: manifest.version, folder: release, sourceCommit: manifest.sourceCommit, toolingCommit: manifest.toolingCommit, manifestSha256: manifestSha },
}, null, 2));
const launcher = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(release, "Start-Bunny-Release.ps1"), "-InstallConfig", join(install, "install.json"), "-NoIsland", "-NoGateway", "-NoRemote"], { windowsHide: true });
let launchLog = "";
launcher.stdout.on("data", (c) => { launchLog += c; });
launcher.stderr.on("data", (c) => { launchLog += c; });
const launchDone = new Promise((resolve) => launcher.on("exit", (code) => resolve(code)));
let health = null;
for (let i = 0; i < 80 && !health; i++) {
  health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).catch(() => null);
  if (!health) await sleep(250);
}
report.launchExit = await launchDone;
report.hostReady = health?.app === "Bunny-A";
report.hostPid = health?.pid ?? null;
if (!report.hostReady) {
  report.launchLog = launchLog.slice(0, 800);
  const errLog = join(state, "logs", "host-error.log");
  report.hostError = exists(errLog) ? readFileSync(errLog, "utf8").slice(0, 800) : null;
  writeFileSync(join(evidence, "installed-smoke.json"), JSON.stringify(report, null, 2));
  process.exit(1);
}
const api = client(JSON.parse(readFileSync(join(state, "credentials", "credentials.json"), "utf8")).token);
await api.state();
let reachable = false;
for (let i = 0; i < 20 && !reachable; i++) {
  const health = await api.command("diagnostics.health");
  reachable = health.body?.data?.ollamaReachable === true;
  report.ollamaReachable = reachable;
  if (!reachable) await sleep(3000);
}
const saved = await api.command("onboarding.save", { state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL } } });
report.onboardingStatus = saved.status;
report.savedModel = saved.body?.data?.preferences?.selectedLocalModel ?? null;
await api.command("scheduler.priority", { priority: "local_only" });
const prefs = (await api.state()).settings ?? (await api.state());
report.selectedModel = prefs?.onboarding?.preferences?.selectedLocalModel ?? prefs?.preferences?.selectedLocalModel ?? null;
report.flows = {
  c0: await chat(api, "What HTTP status code means Not Found?"),
  c1: await chat(api, "Read NOTES.md and report its first line."),
  c2: await chat(api, "Inspect several files and propose a patch."),
};
const long = await api.command("submit", { prompt: "Count from 1 to 400, one number per line.", mode: "fast", constraints: { localOnly: true, outputTokens: 800, maxRuntimeMs: 120000, modelExact: MODEL } });
const longId = long.body?.task?.id;
await api.command("approve", { id: longId });
let sawRunning = false;
for (let i = 0; i < 40 && !sawRunning; i++) {
  const task = ((await api.state()).tasks ?? []).find((row) => row.id === longId);
  if (task?.state === "running") sawRunning = true; else await sleep(100);
}
const t0 = performance.now();
await api.command("stop", { id: longId });
let settled = null;
for (let i = 0; i < 50; i++) {
  settled = ((await api.state()).tasks ?? []).find((row) => row.id === longId) ?? null;
  if (settled && ["stopped", "failed", "completed"].includes(settled.state)) break;
  await sleep(100);
}
const before = String(settled?.output ?? "").length;
await sleep(800);
const after = ((await api.state()).tasks ?? []).find((row) => row.id === longId);
report.stop = { sawRunning, state: settled?.state ?? null, settleMs: Math.round(performance.now() - t0), outputGrew: String(after?.output ?? "").length > before, digest: after?.servedModel?.digest ?? null };
if (report.hostPid) process.kill(report.hostPid);
await sleep(400);
rmSync(install, { recursive: true, force: true });
rmSync(workspace, { recursive: true, force: true });
rmSync(join(local, "Bunny-T1R3-Startup"), { recursive: true, force: true });
rmSync(join(local, "Bunny-T1R3-Install-State"), { recursive: true, force: true });
report.removed = !exists(install);
report.realUntouched = statSync(realInstall).mtimeMs === report.realInstallBefore && statSync(realStartup).mtimeMs === report.realShortcutBefore;
writeFileSync(join(evidence, "installed-smoke.json"), JSON.stringify(report, null, 2));
process.stdout.write(`SMOKE ready=${report.hostReady} c0=${report.flows.c0.plan?.complexity} c1=${report.flows.c1.plan?.complexity} c2=${report.flows.c2.plan?.complexity} stop=${report.stop.state} real=${report.realUntouched}\n`);
const flowsOk = ["c0", "c1", "c2"].every((id) => report.flows[id].ok) && report.stop.state === "stopped" && report.stop.outputGrew === false;
process.exit(report.hostReady && report.realUntouched && report.removed && flowsOk ? 0 : 1);
