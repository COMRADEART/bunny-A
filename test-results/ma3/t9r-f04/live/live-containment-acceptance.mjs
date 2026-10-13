/**
 * M-A-3 T9R-F04 §24/§25/§26 live acceptance on disposable Hosts.
 *
 * Each Host is a real `startHost` in its own child process (host-process.mjs): loopback HTTP on an ephemeral port,
 * real SQLite in a disposable directory, real Missions and Agents, real bearer authentication. The only fixture is
 * the provider executable: a Node stand-in launched through the production contained `spawnSession`. It reads its
 * behaviour from config.json beside it, appends one line per launch to effects.log (duplicate-execution evidence)
 * and starts the compiled process fixture (children, grandchildren, short-lived burst, orphan chain, breakaway
 * attempt). All process evidence is an independent Win32_Process read by image path; database rows are never taken
 * as proof that a process ended.
 *
 * Run from the repository root:  node test-results/ma3/t9r-f04/live/live-containment-acceptance.mjs [rounds]
 * Writes test-results/ma3/t9r-f04/live-containment-acceptance.json (no credentials; tokens are never written).
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const out = join(here, "..", process.env.F04_LIVE_OUT ?? "live-containment-acceptance.json");
const compiler = process.env.BUNNY_NATIVE_CC || "C:\\msys64\\ucrt64\\bin\\gcc.exe";
const rounds = Number(process.argv[2] ?? 1);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, ms = 30000) {
  const deadline = Date.now() + ms;
  do { const value = await check(); if (value) return value; await sleep(100); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  if ([8084, 43119, 43139].includes(port)) return freePort();
  return port;
}
/** Independent OS observation: processes whose image is exactly `image`, with birth time. */
async function processesOf(image) {
  const path = image.replace(/'/g, "''");
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${path}' } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToUniversalTime().ToString('o') }`], { windowsHide: true, timeout: 60000 });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [pid, ppid, createdAt] = line.split("|"); return { pid: Number(pid), ppid: Number(ppid), createdAt }; });
}
async function nodeProcessesRunning(script) {
  const needle = script.replace(/'/g, "''");
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { $_.ProcessId }`], { windowsHide: true, timeout: 60000 });
  return stdout.split(/\r?\n/).filter(Boolean).map(Number);
}
const alive = async (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "bunny-f04-live-"));
  const bin = join(directory, "bin"); mkdirSync(bin);
  const fixture = join(bin, "f04-live-fixture.exe");
  execFileSync(compiler, ["-std=c11", "-O2", "-municode", join(repo, "scripts/fixtures/f04-process-fixture.c"), "-o", fixture], { windowsHide: true, stdio: "pipe" });
  const provider = join(bin, "provider.cjs");
  writeFileSync(provider, `const { spawn } = require("child_process"); const fs = require("fs"); const path = require("path");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
let bytes = 0; process.stdin.on("data", (c) => { bytes += c.length; });
process.stdin.on("end", () => {
  fs.appendFileSync(path.join(__dirname, "effects.log"), JSON.stringify({ pid: process.pid, at: Date.now(), promptBytes: bytes }) + "\\n");
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "f04" }));
  for (const [i, mode] of (cfg.spawn || []).entries()) {
    const log = fs.openSync(path.join(__dirname, "fixture-" + process.pid + "-" + i + ".log"), "w");
    spawn(cfg.fixture, mode, { stdio: ["ignore", log, "ignore"], windowsHide: true }).unref();
  }
  setTimeout(() => process.exit(0), cfg.live ?? 120000);
});
`);
  const project = join(directory, "project"); mkdirSync(project); writeFileSync(join(project, "seed.txt"), "seed");
  const workspaces = join(directory, "agent-workspaces"); mkdirSync(workspaces);
  // Unrelated user-owned processes: same fixture image, and a provider-like Node process with the same script name.
  const userBin = join(directory, "user"); mkdirSync(userBin);
  const userProvider = join(userBin, "provider.cjs"); writeFileSync(userProvider, "setInterval(() => {}, 1000);\n");
  return { directory, bin, fixture, provider, project, workspaces, userProvider, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

async function startHostProcess(ws, data) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--experimental-strip-types", join(here, "host-process.mjs"), data, ws.project, ws.workspaces, String(port), ws.provider], { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let text = ""; child.stdout.on("data", (c) => { text += c; }); child.stderr.on("data", (c) => { text += c; });
  const ready = await until(() => /READY (\{.*\})/.exec(text)?.[1], `Host ready (${text.slice(-400)})`, 60000);
  const info = JSON.parse(ready);
  const base = `http://127.0.0.1:${info.port}`;
  const api = async (action, data = {}) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    return { status: response.status, body: await response.json() };
  };
  const state = async () => (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${info.token}` } })).json();
  // The disposable owner token never leaves this process: logs are redacted before any evidence use.
  return { child, info: { port: info.port, pid: info.pid, instanceId: info.instanceId }, api, state, log: () => text.replace(/READY {.*}/g, "READY {redacted}").split(info.token).join("[redacted]") };
}
async function stopHostProcess(host) {
  try { await host.api("operation.status"); } catch { /* already gone */ }
  host.child.kill();
  await until(async () => !(await alive(host.info.pid)), "Host exit", 15000).catch(() => {});
}

/**
 * Workstation setup: (1) an Agent with Host consent (persistence identity; its delegated provider step is refused by T5
 * because workspace provider tools cannot enforce an Agent resource scope, recorded as authorization evidence), and
 * (2) a workstation Mission whose provider write step runs only after an exact workstation approval.
 */
async function startProviderAgent(host, ws, name) {
  const must = (r, what) => { if (r.status !== 200) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  must(await host.api("mission.configure", { enabled: true }), "mission.configure");
  const projectId = must(await host.api("project.add", { name: `F04 ${name}`, path: ws.project }), "project.add").data.id;
  const created = must(await host.api("agent.create", { projectId, name, objective: `F04 live ${name}`, steps: [{ role: "Coder", objective: "Edit seed.txt in the project", access: "write", executor: { kind: "model" }, dependsOn: [], maxRetries: 0 }] }), "agent.create");
  const agent = created.agents.agents.find((a) => a.name === name);
  const offer = must(await host.api("agent.authorization.propose", { id: agent.id }), "propose").agents.agents.find((a) => a.id === agent.id).authorization;
  must(await host.api("agent.authorization.approve", { id: agent.id, revision: offer.revision }), "approve");
  const agentRefusal = await until(async () => {
    const view = (await host.api("mission.get", { id: agent.missionId })).body.data;
    return (view?.events ?? []).map((e) => String(e.detail)).find((d) => /Workspace provider tools cannot enforce this exact Agent/.test(d)) ?? null;
  }, "Agent provider refusal", 30000);
  const mission = must(await host.api("mission.create", { objective: `F04 provider session ${name}`, mode: "fast", projectId, steps: [{ role: "Coder", objective: "Edit seed.txt in the project", access: "write", executor: { kind: "model" }, dependsOn: [], maxRetries: 0 }] }), "mission.create").mission;
  must(await host.api("mission.approve", { id: mission.id, start: true }), "mission.approve");
  return { agentId: agent.id, agentMissionId: agent.missionId, agentProviderRefusal: agentRefusal.slice(0, 200), missionId: mission.id, projectId };
}
/** Answers, as the workstation, exactly the provider requests of this Mission until a provider task runs. */
async function admitProvider(host, missionId) {
  let last = null;
  return until(async () => {
    const view = (await host.api("mission.get", { id: missionId })).body.data;
    const mission = view?.mission ?? {};
    last = { state: mission.state, requests: (mission.requests ?? []).map((r) => ({ action: r.action, resolvedAt: r.resolvedAt, resolution: r.resolution })), events: (view?.events ?? []).slice(-6).map((e) => [e.type, String(e.detail).slice(0, 160)]) };
    for (const request of mission.requests ?? []) if (!request.resolvedAt) await host.api("mission.respond", { requestId: request.id, decision: "allow_once" });
    const tasks = (await host.state()).tasks ?? [];
    return tasks.find((t) => t.mission?.missionId === missionId && t.state === "running" && t.pid) ?? null;
  }, "provider task running", 60000).catch((error) => { throw new Error(error.message + " " + JSON.stringify(last).slice(0, 1500)); });
}
const effects = (ws) => existsSync(join(ws.bin, "effects.log")) ? readFileSync(join(ws.bin, "effects.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const fixtureLogs = (ws) => readdirSync(ws.bin).filter((n) => /^fixture-\d+-\d+\.log$/.test(n)).flatMap((n) => readFileSync(join(ws.bin, n), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }));
function providerRecords(data) {
  const folder = join(data, "runtime/provider-sessions");
  return existsSync(folder) ? readdirSync(folder).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(folder, n), "utf8"))) : [];
}
function startUnrelated(ws) {
  const same = spawn(ws.fixture, ["sleep", "600000"], { stdio: "ignore", windowsHide: true });
  const providerLike = spawn(process.execPath, [ws.userProvider], { stdio: "ignore", windowsHide: true });
  return { same, providerLike, pids: [same.pid, providerLike.pid] };
}
const CONFIG = (ws) => ({ fixture: ws.fixture, live: 120000, spawn: [["tree", "120000"], ["orphan", "120000"], ["breakaway", "120000"], ["silent", "120000"], ["burst", "40"]] });

async function scenarioStop(round) {
  const ws = workspace(); const data = join(ws.directory, "state"); mkdirSync(data);
  writeFileSync(join(ws.bin, "config.json"), JSON.stringify(CONFIG(ws)));
  const unrelated = startUnrelated(ws);
  const steps = []; const step = (title, observed) => steps.push({ step: steps.length + 1, title, ...observed });
  let host;
  try {
    host = await startHostProcess(ws, data);
    step("disposable Host started", { port: host.info.port, hostPid: host.info.pid, hostGeneration: host.info.instanceId });
    const ids = await startProviderAgent(host, ws, `stop-${round}`);
    step("Agent created, Mission authorized by the workstation and started", ids);
    const task = await admitProvider(host, ids.missionId);
    step("provider task admitted and running", { taskId: task.id, rootPid: task.pid, provider: task.provider });
    await until(async () => fixtureLogs(ws).filter((e) => e.event === "start").length >= 12, "fixture tree started", 30000);
    await sleep(1500);
    const before = await processesOf(ws.fixture);
    const owned = before.filter((p) => p.pid !== unrelated.same.pid);
    const record = await until(() => providerRecords(data).find((r) => r.taskId === task.id && r.state === "running"), "job record");
    const memberPids = new Set(record.members.map((m) => m.pid));
    const fixtureEvents = fixtureLogs(ws);
    // CREATE_BREAKAWAY_FROM_JOB either fails (5) when Bunny's job is the immediate job, or, when a permissive nested job
    // (libuv's) is immediate, leaves only that job and stops at Bunny's job. Either way the child must be a member.
    const breakawayRows = fixtureEvents.filter((e) => e.event === "breakaway-attempt");
    const breakaway = breakawayRows.map((e) => ({ error: e.error, pid: e.pid, memberOfBunnyJob: e.pid ? memberPids.has(e.pid) : null }));
    const silentChildren = fixtureEvents.filter((e) => /^(silent-breakaway-child|explicit-breakaway-from-nested)$/.test(e.event)).map((e) => e.pid);
    step("contained tree observed independently", { fixtureProcessesOwned: owned.length, unrelatedPresent: before.some((p) => p.pid === unrelated.same.pid), jobRecord: { operationId: record.operationId, limitFlagsKillOnClose: record.killOnClose, breakaway: record.breakaway, activeProcesses: record.activeProcesses, recordedMembers: record.members.length }, ownedAreRecordedMembers: owned.filter((p) => memberPids.has(p.pid)).length, breakawayAttempts: breakaway, silentBreakawayChildren: silentChildren, silentChildrenRecordedInJob: silentChildren.filter((pid) => memberPids.has(pid)).length });
    if (owned.length < 10) throw new Error(`expected ≥10 owned fixture processes, saw ${owned.length}`);
    if (!breakaway.length || breakaway.some((row) => row.error !== 5 && row.memberOfBunnyJob !== true)) throw new Error("a breakaway child escaped Bunny's job: " + JSON.stringify(breakaway));
    const stopped = await host.api("stop", { id: task.id });
    step("authenticated Stop of the provider task", { status: stopped.status });
    await until(async () => (await processesOf(ws.fixture)).every((p) => p.pid === unrelated.same.pid), "owned tree terminated", 15000);
    const after = await processesOf(ws.fixture);
    const finalTask = await until(async () => ((await host.state()).tasks ?? []).find((t) => t.id === task.id && ["stopped", "failed"].includes(t.state)), "task terminal", 15000);
    const finalRecord = providerRecords(data).find((r) => r.operationId === record.operationId);
    const unrelatedAlive = { same: await alive(unrelated.same.pid), providerLike: await alive(unrelated.providerLike.pid), providerLikeStillListed: (await nodeProcessesRunning(ws.userProvider)).includes(unrelated.providerLike.pid) };
    const agent = (await host.api("agent.get", { id: ids.agentId })).body;
    step("after Stop", { ownedRemaining: after.filter((p) => p.pid !== unrelated.same.pid).length, rootAlive: await alive(task.pid), taskState: finalTask.state, stopCleanup: finalTask.stopCleanup ?? null, cleanupText: finalTask.latestEvent?.detail ?? null, jobRecord: { containment: finalRecord.containment, activeProcesses: finalRecord.activeProcesses, closed: finalRecord.closed, state: finalRecord.state, terminatedAtEnd: finalRecord.terminatedAtEnd }, unrelatedAlive, agentState: agent?.agent?.state ?? agent?.agents?.agents?.find?.((a) => a.id === ids.agentId)?.state ?? null, providerLaunches: effects(ws).length });
    const pass = after.every((p) => p.pid === unrelated.same.pid) && !(await alive(task.pid)) && finalRecord.containment === "empty" && finalRecord.activeProcesses === 0 && finalRecord.state === "stopped" && finalTask.state === "stopped" && finalTask.stopCleanup?.status === "complete" && unrelatedAlive.same && unrelatedAlive.providerLike && effects(ws).length === 1;
    return { scenario: "stop", round, result: pass ? "PASS" : "FAIL", steps };
  } catch (error) {
    step("error", { error: String(error?.stack ?? error).slice(0, 1500), hostLog: host?.log().slice(-1500) });
    return { scenario: "stop", round, result: "FAIL", steps };
  } finally {
    if (host) await stopHostProcess(host);
    unrelated.same.kill(); unrelated.providerLike.kill();
    await sleep(300); try { ws.cleanup(); } catch { /* busy */ }
  }
}

async function scenarioAbrupt(round) {
  const ws = workspace(); const data = join(ws.directory, "state"); mkdirSync(data);
  writeFileSync(join(ws.bin, "config.json"), JSON.stringify(CONFIG(ws)));
  const unrelated = startUnrelated(ws);
  const steps = []; const step = (title, observed) => steps.push({ step: steps.length + 1, title, ...observed });
  let host, restarted;
  try {
    host = await startHostProcess(ws, data);
    step("disposable Host A started", { port: host.info.port, hostPid: host.info.pid, hostGeneration: host.info.instanceId });
    const ids = await startProviderAgent(host, ws, `abrupt-${round}`);
    const task = await admitProvider(host, ids.missionId);
    step("Agent/Mission authorized and provider admitted", { ...ids, taskId: task.id, rootPid: task.pid });
    await until(async () => fixtureLogs(ws).filter((e) => e.event === "start").length >= 12, "fixture tree started", 30000);
    await sleep(1500);
    const before = (await processesOf(ws.fixture)).filter((p) => p.pid !== unrelated.same.pid);
    const record = await until(() => providerRecords(data).find((r) => r.taskId === task.id && r.state === "running"), "job record");
    const agentBefore = (await host.api("agent.get", { id: ids.agentId })).body;
    step("contained tree running before Host death", { ownedFixtureProcesses: before.map((p) => ({ pid: p.pid, createdAt: p.createdAt })), providerRoot: { pid: task.pid, alive: await alive(task.pid) }, jobRecord: { operationId: record.operationId, recordedMembers: record.members.length, activeProcesses: record.activeProcesses } });
    if (before.length < 10) throw new Error(`expected ≥10 owned fixture processes, saw ${before.length}`);
    // Abrupt death: kernel TerminateProcess of the Host. No Bunny shutdown, finalizer or env-cleanup code runs.
    // Even rounds: the Host dies while an authenticated Stop is being processed (restart during cleanup).
    const duringStop = round % 2 === 0;
    // Rounds 2, 6, 10 start the kill and the Stop together (death usually lands mid-cleanup); rounds 4, 8 send Stop
    // first (Stop usually completes before death). Both outcomes are recorded per round in "restart outcome".
    const concurrent = duringStop && round % 4 === 2;
    if (duringStop && !concurrent) { void host.api("stop", { id: task.id }).catch(() => null); await sleep(5); }
    const killedAt = Date.now();
    const kill = run("taskkill.exe", ["/PID", String(host.info.pid), "/F"], { windowsHide: true });
    if (concurrent) void host.api("stop", { id: task.id }).catch(() => null);
    await kill;
    await until(async () => !(await alive(host.info.pid)), "Host gone", 10000);
    await until(async () => (await processesOf(ws.fixture)).every((p) => p.pid === unrelated.same.pid) && !(await alive(task.pid)), "kernel kill-on-close", 15000);
    const after = await processesOf(ws.fixture);
    step("Host terminated abruptly (taskkill /F); OS observation", { killedDuringStop: duringStop, cleanupObservedMs: Date.now() - killedAt, ownedRemaining: after.filter((p) => p.pid !== unrelated.same.pid).length, providerRootAlive: await alive(task.pid), unrelatedAlive: { same: await alive(unrelated.same.pid), providerLike: await alive(unrelated.providerLike.pid) }, recordStateOnDisk: providerRecords(data).find((r) => r.operationId === record.operationId)?.state });
    const launchesBefore = effects(ws).length;
    restarted = await startHostProcess(ws, data);
    step("Host B started on the same SQLite state", { hostPid: restarted.info.pid, hostGeneration: restarted.info.instanceId, newGeneration: restarted.info.instanceId !== host.info.instanceId });
    // Two truthful outcomes when Stop races Host death (final-run diagnosis, review/final-live-attempt1.json):
    // Stop finished first — kernel accounting reached 0 and Host A closed the record "stopped"/"empty" (nothing to
    // reconcile); or Host A died during cleanup — Host B reconciles the record to absent_after_restart/interrupted.
    // Any other end state (an open record, "terminating", "unconfirmed") still fails the round.
    const stored = providerRecords(data).find((r) => r.operationId === record.operationId);
    const stopCompletedBeforeDeath = duringStop && !!stored && stored.closed === true && stored.state === "stopped" && stored.containment === "empty" && stored.activeProcesses === 0;
    const recoveredRecord = stopCompletedBeforeDeath ? stored : await until(() => providerRecords(data).find((r) => r.operationId === record.operationId && r.containment === "absent_after_restart" && r.state === "interrupted"), "record reconciled", 60000);
    steps.push({ step: steps.length + 1, title: "restart outcome", stopCompletedBeforeDeath, recordAfter: { state: recoveredRecord.state, closed: recoveredRecord.closed, containment: recoveredRecord.containment, activeProcesses: recoveredRecord.activeProcesses, terminatedAtEnd: recoveredRecord.terminatedAtEnd } });
    const s = await restarted.state();
    const recoveredTask = (s.tasks ?? []).find((t) => t.id === task.id);
    const agentAfter = (await restarted.api("agent.get", { id: ids.agentId })).body;
    const missionAfter = (await restarted.api("mission.get", { id: ids.missionId })).body.data;
    await sleep(5000);
    const launchesAfter = effects(ws).length;
    const events = (s.events ?? []).filter((e) => /^provider_session\./.test(e.type)).map((e) => ({ type: e.type, detail: e.detail }));
    const authorization = agentAfter?.agent?.authorization ?? agentAfter?.agents?.agents?.find?.((a) => a.id === ids.agentId)?.authorization ?? null;
    step("recovery on Host B", { agentPersisted: JSON.stringify(agentAfter).includes(ids.agentId), missionPersisted: missionAfter?.mission?.id === ids.missionId, missionState: missionAfter?.mission?.state, agentMissionPersisted: (await restarted.api("mission.get", { id: ids.agentMissionId })).body.data?.mission?.id === ids.agentMissionId, taskState: recoveredTask?.state, taskError: recoveredTask?.error, providerSessionEvents: events, recordReconciled: { state: recoveredRecord.state, containment: recoveredRecord.containment }, staleAuthorization: { state: authorization?.state ?? authorization?.current_state ?? null, revision: authorization?.revision ?? null }, providerLaunchesBeforeRestart: launchesBefore, providerLaunchesAfterRestart: launchesAfter, ownedProcessesAfterRestart: (await processesOf(ws.fixture)).filter((p) => p.pid !== unrelated.same.pid).length });
    const authState = String(authorization?.state ?? authorization?.current_state ?? "");
    // A Stop that reached the Host before its death may have recorded "stopped"; otherwise restart records "failed".
    const pass = missionAfter?.mission?.id === ids.missionId && JSON.stringify(agentAfter).includes(ids.agentId) && after.every((p) => p.pid === unrelated.same.pid) && launchesAfter === launchesBefore && (recoveredTask?.state === "failed" || (duringStop && recoveredTask?.state === "stopped")) && !/^ACTIVE$/.test(authState) && (await alive(unrelated.same.pid)) && (await alive(unrelated.providerLike.pid));
    void agentBefore;
    return { scenario: "abrupt-host-exit", round, result: pass ? "PASS" : "FAIL", steps };
  } catch (error) {
    // Diagnostic: the job records as stored (no credentials live in them), so a failed expectation can be explained.
    let records = null; try { records = providerRecords(data).map((r) => ({ operationId: r.operationId, state: r.state, closed: r.closed, containment: r.containment, activeProcesses: r.activeProcesses, terminatedAtEnd: r.terminatedAtEnd, hostGeneration: r.hostGeneration, reviewRequired: r.reviewRequired ?? false, members: r.members?.length })); } catch { records = "unreadable"; }
    step("error", { error: String(error?.stack ?? error).slice(0, 1500), hostLog: (restarted ?? host)?.log().slice(-1500), records });
    return { scenario: "abrupt-host-exit", round, result: "FAIL", steps };
  } finally {
    if (restarted) await stopHostProcess(restarted);
    if (host) host.child.kill();
    unrelated.same.kill(); unrelated.providerLike.kill();
    await sleep(300); try { ws.cleanup(); } catch { /* busy */ }
  }
}

async function scenarioGraceful(round) {
  const ws = workspace(); const data = join(ws.directory, "state"); mkdirSync(data);
  writeFileSync(join(ws.bin, "config.json"), JSON.stringify(CONFIG(ws)));
  const unrelated = startUnrelated(ws);
  const steps = []; const step = (title, observed) => steps.push({ step: steps.length + 1, title, ...observed });
  let host, reader;
  try {
    host = await startHostProcess(ws, data);
    const ids = await startProviderAgent(host, ws, `graceful-${round}`);
    const task = await admitProvider(host, ids.missionId);
    await until(async () => fixtureLogs(ws).filter((e) => e.event === "start").length >= 12, "fixture tree started", 30000);
    await sleep(1500);
    const before = (await processesOf(ws.fixture)).filter((p) => p.pid !== unrelated.same.pid);
    step("contained tree running before graceful shutdown", { taskId: task.id, rootPid: task.pid, ownedFixtureProcesses: before.length });
    if (before.length < 10) throw new Error(`expected ≥10 owned fixture processes, saw ${before.length}`);
    host.child.send("close");
    const exitCode = await new Promise((resolve) => host.child.once("exit", resolve));
    const after = (await processesOf(ws.fixture)).filter((p) => p.pid !== unrelated.same.pid);
    const record = providerRecords(data).find((r) => r.taskId === task.id);
    step("graceful Host close (production close path)", { exitCode, printedClosed: /CLOSED/.test(host.log()), ownedRemaining: after.length, providerRootAlive: await alive(task.pid), jobRecord: record ? { state: record.state, containment: record.containment, activeProcesses: record.activeProcesses, closed: record.closed, terminatedAtEnd: record.terminatedAtEnd } : null, unrelatedAlive: { same: await alive(unrelated.same.pid), providerLike: await alive(unrelated.providerLike.pid) } });
    reader = await startHostProcess(ws, data);
    const recorded = ((await reader.state()).tasks ?? []).find((t) => t.id === task.id);
    step("task record after graceful shutdown (read by a new Host)", { taskState: recorded?.state, stopReason: recorded?.stopReason ?? null, stopCleanup: recorded?.stopCleanup ?? null, detail: recorded?.latestEvent?.detail ?? null });
    const pass = exitCode === 0 && after.length === 0 && record?.containment === "empty" && record?.activeProcesses === 0 && recorded?.state === "stopped" && recorded?.stopCleanup?.status === "complete" && (await alive(unrelated.same.pid)) && (await alive(unrelated.providerLike.pid)) && effects(ws).length === 1;
    return { scenario: "graceful-shutdown", round, result: pass ? "PASS" : "FAIL", steps };
  } catch (error) {
    step("error", { error: String(error?.stack ?? error).slice(0, 1500), hostLog: (reader ?? host)?.log().slice(-1500) });
    return { scenario: "graceful-shutdown", round, result: "FAIL", steps };
  } finally {
    if (reader) await stopHostProcess(reader);
    if (host && host.child.exitCode === null) host.child.kill();
    unrelated.same.kill(); unrelated.providerLike.kill();
    await sleep(300); try { ws.cleanup(); } catch { /* busy */ }
  }
}

const results = [];
const startedAt = new Date().toISOString();
const only = process.env.F04_LIVE_ONLY;
for (let round = 1; round <= rounds; round++) {
  if (!only || only === "stop") { const r = await scenarioStop(round); results.push(r); console.log(`stop round ${round}: ${r.result}`); }
  if (!only || only === "abrupt") { const r = await scenarioAbrupt(round); results.push(r); console.log(`abrupt round ${round}: ${r.result}`); }
  if (!only || only === "graceful") { const r = await scenarioGraceful(round); results.push(r); console.log(`graceful round ${round}: ${r.result}`); }
}
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "native", "scripts"], { cwd: repo, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const summary = { gate: "M-A-3 T9R-F04", classification: "LIVE", startedAt, finishedAt: new Date().toISOString(), headCommit: source, workingTreeChanges: dirty, rounds, passed: results.filter((r) => r.result === "PASS").length, failed: results.filter((r) => r.result !== "PASS").length, results };
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, out }));
process.exit(summary.failed ? 1 : 0);
