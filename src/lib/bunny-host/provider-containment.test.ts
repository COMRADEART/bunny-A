/**
 * M-A-3 T9R-F04: provider-session Windows Job Object containment. Real native jobs, real processes and
 * independent OS observations (Win32_Process by image path); no database flag is taken as process evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawnSession, providerBase } from "./adapters.server.ts";
import type { AdapterHooks, ProviderAdapter, RunningSession } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import { OwnedProcessGroup, recoverProviderSessions, windowsOwnershipModule } from "./owned-process-group.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import type { Launchable } from "./discovery.server.ts";

const run = promisify(execFile);
const windows = process.platform === "win32";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const compiler = process.env.BUNNY_NATIVE_CC || "C:\\msys64\\ucrt64\\bin\\gcc.exe";

/** One disposable directory with the compiled process fixture and a Node provider stand-in. */
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "bunny-f04-"));
  const fixture = join(directory, "f04-fixture.exe");
  execFileSync(compiler, ["-std=c11", "-O2", "-municode", join(root, "scripts/fixtures/f04-process-fixture.c"), "-o", fixture], { windowsHide: true, stdio: "pipe" });
  const provider = join(directory, "provider.cjs");
  writeFileSync(provider, `const { spawn } = require("child_process");
let input = Buffer.alloc(0);
process.stdin.on("data", (chunk) => { input = Buffer.concat([input, chunk]); });
process.stdin.on("end", () => {
  const cfg = JSON.parse(input.toString("utf8").split("\\n")[0]);
  console.log("received " + input.length);
  for (const mode of cfg.spawn || []) spawn(cfg.fixture, mode, { stdio: "ignore", windowsHide: true, detached: !!cfg.detached }).unref();
  setTimeout(() => { console.log("provider done"); process.exit(cfg.exit ?? 0); }, cfg.live ?? 50);
});
`);
  const launch: Launchable = { command: process.execPath, args: [provider], path: provider, kind: "node-script", source: "F04 disposable fixture" };
  // MA5-S2 P4-6: a fixture exe that is still exiting cannot be deleted on Windows (EBUSY/EPERM); one try leaked the folder.
  return { directory, fixture, provider, launch, cleanup: () => { try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* still unlinking */ } } };
}
type Workspace = ReturnType<typeof workspace>;

/** Independent observation: every live process whose image is this workspace's fixture (Win32_Process). */
async function fixtureProcesses(ws: Workspace): Promise<{ pid: number; createdAt: string }[]> {
  const path = ws.fixture.replace(/'/g, "''");
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${path}' } | ForEach-Object { '{0}|{1}' -f $_.ProcessId,$_.CreationDate.ToUniversalTime().ToString('o') }`], { windowsHide: true, timeout: 30000 });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [pid, createdAt] = line.split("|"); return { pid: Number(pid), createdAt }; });
}
const until = async (check: () => boolean | Promise<boolean>, label: string, ms = 15000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const task = (ws: Workspace, prompt: object | string, extra: Partial<OrchTask> = {}) =>
  ({ id: "f04-task", provider: "claude", model: "fixture", prompt: typeof prompt === "string" ? prompt : JSON.stringify({ fixture: ws.fixture, ...prompt }), cwd: ws.directory, ...extra }) as OrchTask;
function hooks(events: [string, string][] = [], lines: string[] = [], owner?: AdapterHooks["owner"]): AdapterHooks {
  return { event: (type, detail) => { events.push([type, detail]); }, session: () => {}, output: () => {}, raw: (stream, line) => { if (stream === "stdout") lines.push(line); }, ...(owner ? { owner } : {}) };
}
/** An unrelated process with the SAME image as the fixture, started outside Bunny. */
function unrelated(ws: Workspace): ChildProcess { return spawn(ws.fixture, ["sleep", "120000"], { stdio: "ignore", windowsHide: true }); }

test("F04 J01-J04/J07: provider root is created suspended inside its job, prompt delivered exactly, record persisted", { skip: !windows, timeout: 60000 }, async () => {
  const ws = workspace(); const data = mkdtempSync(join(tmpdir(), "bunny-f04-data-"));
  try {
    const events: [string, string][] = []; const lines: string[] = [];
    const padding = "x".repeat(1024 * 1024);
    const session = spawnSession("claude", ws.launch, [], task(ws, JSON.stringify({ fixture: ws.fixture, live: 300 }) + "\n" + padding), hooks(events, lines, { dataDirectory: data, hostGeneration: "gen-1", taskId: "f04-task", missionId: "m-1", agentId: "a-1" }), "session-1");
    assert.ok(session.containment, "a Windows provider session is job-contained");
    await until(() => session.containment!().state === "running", "running");
    const running = session.containment!();
    assert.equal(running.mechanism, "windows-job-object");
    assert.ok(running.rootPid && running.rootCreatedAt && running.operationId);
    const result = await session.done;
    assert.equal(result.ok, true, JSON.stringify(result));
    const expectedBytes = Buffer.byteLength(task(ws, JSON.stringify({ fixture: ws.fixture, live: 300 }) + "\n" + padding).prompt);
    assert.ok(lines.includes(`received ${expectedBytes}`), "the whole prompt reached stdin over the unnamed pipe, then EOF");
    assert.equal(session.containment!().state, "empty");
    assert.ok(events.some(([type, detail]) => type === "agent.started" && /inside a Bunny-owned Windows job/.test(detail)));
    const record = JSON.parse(readFileSync(join(data, "runtime/provider-sessions", running.operationId + ".json"), "utf8"));
    assert.deepEqual([record.provider, record.taskId, record.missionId, record.agentId, record.hostGeneration, record.sessionId, record.killOnClose, record.breakaway, record.containment, record.closed, record.state], ["claude", "f04-task", "m-1", "a-1", "gen-1", "session-1", true, false, "empty", true, "succeeded"]);
    assert.equal(record.launcherPid, running.rootPid);
  } finally { ws.cleanup(); rmSync(data, { recursive: true, force: true }); }
});

test("F04 J11-J15/J18/J45: children, grandchildren, short-lived, detached and orphaned descendants are members and end with the session", { skip: !windows, timeout: 90000 }, async () => {
  const ws = workspace(); const other = unrelated(ws);
  try {
    await until(async () => (await fixtureProcesses(ws)).some((row) => row.pid === other.pid), "unrelated fixture");
    const session = spawnSession("claude", ws.launch, [], task(ws, { spawn: [["tree", "60000"]], live: 4000 }), hooks(), "s");
    await until(() => (session.containment!().activeProcesses ?? 0) >= 8, "tree inside the job");
    const observed = (await fixtureProcesses(ws)).filter((row) => row.pid !== other.pid);
    assert.ok(observed.length >= 6, `fixture tree observed: ${observed.length}`);
    // Every fixture process Windows reports (except the unrelated one) is in the job by its own handle.
    const result = await session.done;
    assert.equal(result.ok, true);
    const end = session.containment!();
    assert.equal(end.state, "empty");
    assert.ok((end.terminatedAtEnd ?? 0) >= 6, `descendants still running at root exit were terminated with the job (${end.terminatedAtEnd})`);
    const after = await fixtureProcesses(ws);
    assert.deepEqual(after.map((row) => row.pid), [other.pid], "no owned descendant survives; the unrelated same-image process does");
  } finally { other.kill(); ws.cleanup(); }
});

test("F04 J16/J17: explicit breakaway is refused by the kernel; a member's own permissive nested job cannot leave Bunny's job", { skip: !windows, timeout: 60000 }, async () => {
  const ws = workspace();
  try {
    for (const mode of ["breakaway", "silent"]) {
      const group = new OwnedProcessGroup(ws.fixture, ws.directory, {});
      const out: string[] = [];
      const { outputPipe } = await import("./owned-process-group.server.ts");
      const stdout = await outputPipe((chunk) => { out.push(chunk.toString()); }); const stderr = await outputPipe(() => {});
      group.spawn(ws.fixture, [mode, "20000"], ws.directory, process.env, stdout.name, stderr.name);
      await until(() => out.join("").split("\n").filter((line) => line.includes("\"start\"")).length >= (mode === "silent" ? 3 : 1) && /breakaway/.test(out.join("")), `${mode} fixture events`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const events = out.join("").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { event: string; pid: number; error: number });
      const snapshot = group.inspect();
      assert.equal(snapshot.limitFlags, 0x2000, "only KILL_ON_JOB_CLOSE: no BREAKAWAY_OK, no SILENT_BREAKAWAY_OK");
      if (mode === "breakaway") assert.deepEqual(events.filter((row) => row.event === "breakaway-attempt").map((row) => [row.pid, row.error]), [[0, 5]], "CREATE_BREAKAWAY_FROM_JOB → ERROR_ACCESS_DENIED");
      else {
        const children = events.filter((row) => /breakaway/.test(row.event)).map((row) => row.pid);
        assert.equal(children.length, 2); assert.ok(children.every(Boolean));
        for (const pid of children) assert.ok(snapshot.members.some((member) => member.pid === pid), `child ${pid} that left the member's permissive nested job is still in Bunny's job`);
      }
      group.close("stopped");
      await stdout.close(); await stderr.close();
      assert.deepEqual(await fixtureProcesses(ws), [], `${mode}: nothing survives job closure`);
    }
  } finally { ws.cleanup(); }
});

test("F04 J29-J31/J42: Stop terminates the exact job by handle; unrelated same-image process survives; result is kernel accounting", { skip: !windows, timeout: 90000 }, async () => {
  const ws = workspace(); const other = unrelated(ws);
  try {
    await until(async () => (await fixtureProcesses(ws)).some((row) => row.pid === other.pid), "unrelated fixture");
    const session = spawnSession("claude", ws.launch, [], task(ws, { spawn: [["tree", "60000"], ["orphan", "60000"]], live: 60000 }), hooks(), "s");
    await until(() => (session.containment!().activeProcesses ?? 0) >= 8, "tree inside the job");
    await session.stop();
    assert.equal(session.containment!().state, "empty");
    const result = await session.done;
    assert.equal(result.stopped, true); assert.equal(result.ok, false);
    assert.deepEqual((await fixtureProcesses(ws)).map((row) => row.pid), [other.pid]);
    assert.ok(other.exitCode === null && !other.killed, "unrelated process untouched");
  } finally { other.kill(); ws.cleanup(); }
});

test("F04 J05/J21/J44: an admission failure refuses execution and starts nothing; no fallback launcher exists", { skip: !windows, timeout: 30000 }, async () => {
  const ws = workspace();
  try {
    const events: [string, string][] = [];
    const missing = { ...ws.launch, command: join(ws.directory, "missing-provider.exe"), args: [] };
    const session = spawnSession("claude", missing, [], task(ws, {}), hooks(events), "s");
    const result = await session.done;
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /^Containment unavailable — execution refused: Windows ownership failed closed at CreateProcess in job/);
    assert.equal(session.containment!().state, "refused");
    assert.ok(events.some(([type]) => type === "provider.containment_refused"));
    // Static: the contained launcher has no spawn/execFile/taskkill fallback of any kind.
    const source = readFileSync(join(root, "src/lib/bunny-host/adapters.server.ts"), "utf8");
    const contained = source.slice(source.indexOf("function containedSession("), source.indexOf("export class CodexAdapter"));
    assert.ok(contained.length > 1000);
    // group.spawn is the native job launch itself; any bare child_process call would be an unowned fallback.
    for (const forbidden of [/(^|[^.\w])spawn\(/, /execFile\(/, /(^|[^.\w])exec\(/, /taskkill/, /spawnChild/, /trackOwnedChild/]) assert.ok(!forbidden.test(contained), `contained launcher must not use ${forbidden}`);
    assert.match(contained, /group\.spawn\(launch\.command/);
    // Production adapters never pass the legacy test-only spawn seam.
    for (const call of source.match(/spawnSession\([^)]*\)/g) ?? []) assert.ok(call.split(",").length <= 7, `production spawnSession call passes a launcher: ${call}`);
  } finally { ws.cleanup(); }
});

test("F04 J47/J48: concurrent sessions are isolated; stopping A leaves B running", { skip: !windows, timeout: 90000 }, async () => {
  const ws = workspace();
  try {
    const a = spawnSession("claude", ws.launch, [], task(ws, { spawn: [["tree", "60000"]], live: 60000 }), hooks(), "a");
    const b = spawnSession("claude", ws.launch, [], task(ws, { spawn: [["chain", "60000"]], live: 60000 }), hooks(), "b");
    await until(() => (a.containment!().activeProcesses ?? 0) >= 8 && (b.containment!().activeProcesses ?? 0) >= 3, "both trees");
    const bBefore = b.containment!().activeProcesses;
    await a.stop();
    assert.equal(a.containment!().state, "empty");
    assert.equal(b.containment!().state, "running");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(b.containment!().activeProcesses, bBefore, "B's job accounting unchanged by A's Stop");
    assert.ok((await fixtureProcesses(ws)).length >= 2, "B's fixture processes still alive");
    await b.stop();
    assert.deepEqual(await fixtureProcesses(ws), []);
    await Promise.all([a.done, b.done]);
  } finally { ws.cleanup(); }
});

test("F04 J35/J09/J46: abrupt Host death (TerminateProcess, no cleanup code) ends the whole contained tree; unrelated survives", { skip: !windows, timeout: 90000 }, async () => {
  const ws = workspace(); const other = unrelated(ws);
  const host = join(ws.directory, "host.mjs");
  writeFileSync(host, `const { spawnSession } = await import(${JSON.stringify("file:///" + join(root, "src/lib/bunny-host/adapters.server.ts").replace(/\\/g, "/"))});
const launch = ${JSON.stringify(ws.launch)};
const session = spawnSession("claude", launch, [], { id: "t", provider: "claude", model: "m", cwd: ${JSON.stringify(ws.directory)}, prompt: JSON.stringify({ fixture: ${JSON.stringify(ws.fixture)}, spawn: [["tree","60000"],["orphan","60000"]], live: 60000 }) }, { event(){}, session(){}, output(){} }, "s");
const timer = setInterval(() => { const c = session.containment(); if ((c.activeProcesses ?? 0) >= 9) { console.log("READY " + JSON.stringify(c)); clearInterval(timer); } }, 50);
setInterval(() => {}, 1000);
`);
  const child = spawn(process.execPath, ["--experimental-strip-types", host], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  try {
    let text = ""; child.stdout!.on("data", (chunk) => { text += chunk; }); child.stderr!.on("data", (chunk) => { text += chunk; });
    await until(() => /READY/.test(text), "host ready: " + text, 30000);
    const before = (await fixtureProcesses(ws)).filter((row) => row.pid !== other.pid);
    assert.ok(before.length >= 7, `contained fixture processes alive before Host death: ${before.length}`);
    // Abrupt death: kernel TerminateProcess of the Host. No JavaScript, finalizer or env-cleanup hook runs.
    await run("taskkill.exe", ["/PID", String(child.pid), "/F"], { windowsHide: true });
    await until(async () => (await fixtureProcesses(ws)).every((row) => row.pid === other.pid), "kernel kill-on-close", 10000);
    assert.deepEqual((await fixtureProcesses(ws)).map((row) => row.pid), [other.pid]);
  } finally { child.kill(); other.kill(); ws.cleanup(); }
});

/** A TaskManager whose Claude adapter launches the real contained spawnSession against the fixture provider. */
function fixtureManager(ws: Workspace, dataDirectory: string, prompt: object, db = new HostDatabase(join(dataDirectory, "host.sqlite"))) {
  const live = { ...providerBase("claude"), installed: true, authenticated: true, authenticatedState: "authenticated" as const, availability: "ready" as const, capabilities: ["text", "filesystem", "terminal"], probedAt: Date.now() };
  const sessions: RunningSession[] = [];
  const adapter: ProviderAdapter = {
    id: "claude", detect: async () => live, health: async (previous) => previous, usage: async () => null,
    launch: (orch, adapterHooks) => { const session = spawnSession("claude", ws.launch, [], { ...orch, prompt: JSON.stringify({ fixture: ws.fixture, ...prompt }), cwd: ws.directory }, adapterHooks, orch.id); sessions.push(session); return session; },
  };
  const manager = new TaskManager(db, ws.directory, [adapter], { dataDirectory, processTable: async () => [] });
  return { manager, db, sessions };
}

test("F04 J29/J43/J42: TaskManager Stop reports kernel-verified job emptiness; the job is live code until then", { skip: !windows, timeout: 90000 }, async () => {
  const ws = workspace(); const data = mkdtempSync(join(tmpdir(), "bunny-f04-data-"));
  const { manager, db, sessions } = fixtureManager(ws, data, { spawn: [["tree", "60000"]], live: 60000 });
  try {
    await manager.discover();
    const submitted = manager.submit({ prompt: "Edit files in the fixture folder", mode: "balanced", override: "claude" });
    manager.approve(submitted.id);
    await until(() => sessions.length === 1 && (sessions[0].containment!().activeProcesses ?? 0) >= 8, "contained tree under TaskManager");
    assert.ok(manager.sessions.has(submitted.id), "running contained session is live code");
    const stopped = await manager.stop(submitted.id, "F04 Stop.");
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.stopCleanup?.status, "complete");
    assert.match(stopped.latestEvent?.detail ?? "", /Windows job verified empty by kernel accounting: \d+ process\(es\)/);
    assert.deepEqual(await fixtureProcesses(ws), []);
    await until(() => [...manager.lingering.keys()].length === 0, "no lingering hold after a verified-empty job");
  } finally { db.close(); ws.cleanup(); rmSync(data, { recursive: true, force: true }); }
});

test("F04 J37-J41/J32: restart reconciles interrupted job records by full identity, kills nothing, and holds while identity is alive", { skip: !windows, timeout: 120000 }, async () => {
  const ws = workspace(); const data = mkdtempSync(join(tmpdir(), "bunny-f04-data-"));
  const other = unrelated(ws);
  try {
    await until(async () => (await fixtureProcesses(ws)).some((row) => row.pid === other.pid), "unrelated fixture");
    const [live] = await fixtureProcesses(ws);
    const folder = join(data, "runtime/provider-sessions");
    const { mkdirSync } = await import("node:fs"); mkdirSync(folder, { recursive: true });
    const base = { schema: "bunny-owned-operation/1", containerId: "x", mechanism: "windows-job-object", stepId: null, capabilityRunId: null, launcherPath: ws.fixture, endedAt: null, repo: ws.directory, cwd: ws.directory, action: "provider.claude", state: "running", exitCode: null, killOnClose: true, breakaway: false, closed: false, provider: "claude", agentId: null, sessionId: null, hostGeneration: "old-gen", activeProcesses: 3, totalProcesses: 3, terminatedAtEnd: null, containment: "running", startedAt: 1 };
    // A: same PID as a live unrelated process but a different birth time (PID reuse) → not alive, not killed.
    const reused = { ...base, operationId: "11111111-1111-4111-8111-111111111111", missionId: null, taskId: "t-reused", launcherPid: live.pid, launcherCreatedAt: 1000, members: [] };
    // B: exact identity of a live process (an escaped member) → requires review and stays live code; never killed.
    const createdAt = Number(execFileSync(process.execPath, ["-e", `console.log(Date.parse(${JSON.stringify(live.createdAt)}))`], { encoding: "utf8" }).trim());
    const escaped = { ...base, operationId: "22222222-2222-4222-8222-222222222222", missionId: "m-1", taskId: "t-escaped", launcherPid: 999999, launcherCreatedAt: 5, members: [{ pid: live.pid, createdAt, file: ws.fixture }] };
    for (const record of [reused, escaped]) writeFileSync(join(folder, record.operationId + ".json"), JSON.stringify(record));
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const manager = new TaskManager(db, ws.directory, [], { dataDirectory: data });
      assert.ok(manager.lingering.has("restart:" + reused.operationId) && manager.lingering.has("restart:" + escaped.operationId), "fail closed until the table is read");
      await until(() => !manager.lingering.has("restart:" + reused.operationId) && Array.isArray(manager.lingering.get("restart:" + escaped.operationId)), "corroboration");
      const events = db.taskEvents("t-escaped").map((event) => event.type).concat(db.taskEvents("t-reused").map((event) => event.type));
      assert.ok(events.includes("provider_session.cleanup_unconfirmed") && events.includes("provider_session.reconciled") && events.filter((type) => type === "provider_session.interrupted").length === 2);
      assert.ok(other.exitCode === null && (await fixtureProcesses(ws)).some((row) => row.pid === other.pid), "restart killed nothing, not even a PID-identical process");
      const reloaded = recoverProviderSessions(data).map((row) => row.operationId);
      assert.deepEqual(reloaded, [escaped.operationId], "a reconciled record is not reported again; an unconfirmed one is");
      manager.dispose();
      assert.ok(!readdirSync(folder).some((name) => name.endsWith(".tmp")));
    } finally { db.close(); }
  } finally { other.kill(); ws.cleanup(); rmSync(data, { recursive: true, force: true }); }
});

test("F04 J08/J10: the native job handle carries no SET_ATTRIBUTES right and the module exposes no PID/handle-based job API", { skip: !windows }, () => {
  const native = windowsOwnershipModule() as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(native).sort(), ["close", "endInput", "inspect", "launch", "terminate", "terminateVerified", "write"], "write/endInput take only an owned group external (bounded probe stdin)");
  const source = readFileSync(join(root, "native/bunny-owned-process.c"), "utf8");
  assert.match(source, /#define OWNED_JOB_ACCESS \(JOB_OBJECT_ASSIGN_PROCESS\|JOB_OBJECT_QUERY\|JOB_OBJECT_TERMINATE\)/);
  assert.match(source, /DuplicateHandle\(GetCurrentProcess\(\),job,GetCurrentProcess\(\),&reduced,OWNED_JOB_ACCESS,FALSE,0\)/, "reduced handle is non-inheritable");
  assert.match(source, /CreateJobObjectW\(NULL,NULL\)/, "unnamed job, default (non-inheritable) handle");
  assert.ok(!/BREAKAWAY_OK/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "no breakaway limit is ever set");
  assert.ok(existsSync(join(root, "native/bunny-owned-process.node.json")));
});

// ── Review round 1 regressions ───────────────────────────────────────────────────────────────────────────────

test("F04 R1-BYPASS-1: verification never runs a python.exe planted in (or on PATH inside) the task folder; the real one runs in a job", { skip: !windows, timeout: 60000 }, async () => {
  const ws = workspace();
  try {
    const { resolveInterpreter, verifySpec } = await import("./verification.server.ts");
    const { copyFileSync } = await import("node:fs");
    copyFileSync(ws.fixture, join(ws.directory, "python.exe"));
    writeFileSync(join(ws.directory, "hello.py"), 'print("BUNNY_A_OK")\n');
    const resolved = resolveInterpreter("python", ws.directory, [ws.directory, ".", "relative\\bin", process.env.PATH ?? ""].join(";"));
    assert.ok(!resolved || !resolved.toLowerCase().startsWith(ws.directory.toLowerCase()), `interpreter resolved inside the task folder: ${resolved}`);
    const before = await fixtureProcesses(ws);
    const result = await verifySpec({ cwd: ws.directory } as OrchTask, { kind: "python", name: "hello.py", expected: "BUNNY_A_OK" });
    assert.doesNotMatch(result.detail, /fixture/, "the planted executable never ran");
    if (resolved) assert.equal(result.passed, true, result.detail);
    assert.deepEqual(await fixtureProcesses(ws), before);
    const source = readFileSync(join(root, "src/lib/bunny-host/verification.server.ts"), "utf8");
    assert.match(source, /runWindowsOwnedProcess\(interpreter,args/);
  } finally { ws.cleanup(); }
});

test("F04 R1-BYPASS-2: the Codex app-server probe runs in a job with interactive stdin and leaves nothing behind", { skip: !windows, timeout: 60000 }, async () => {
  const ws = workspace();
  try {
    const server = join(ws.directory, "app-server.cjs");
    writeFileSync(server, [
      'const { spawn } = require("child_process");',
      `spawn(${JSON.stringify(ws.fixture)}, ["tree", "60000"], { stdio: "ignore", windowsHide: true }).unref();`,
      'let buffer = "";',
      'process.stdin.on("data", (chunk) => { buffer += chunk; let at; while ((at = buffer.indexOf(String.fromCharCode(10))) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); const m = JSON.parse(line); if (m.id === undefined) continue;',
      '  const result = m.method === "initialize" ? {} : m.method === "model/list" ? { data: [{ model: "fixture-model", isDefault: true }] } : { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null } }, ordinaryUsageAllowed: true };',
      '  process.stdout.write(JSON.stringify({ id: m.id, result }) + String.fromCharCode(10)); } });',
      "setInterval(() => {}, 1000);",
    ].join("\n"));
    const { probeCodexCatalog } = await import("./codex-probe.server.ts");
    const catalogue = await probeCodexCatalog(process.execPath, [server]);
    assert.equal(catalogue.model, "fixture-model"); assert.equal(catalogue.usageRead, true);
    await until(async () => (await fixtureProcesses(ws)).length === 0, "probe job terminated with its descendants");
    await assert.rejects(probeCodexCatalog(join(ws.directory, "missing-codex.exe")), /Windows ownership failed closed/);
  } finally { ws.cleanup(); }
});

test("F04 R1-STOP-3/NATIVE-1/STOP-1: Stop before admission is not admitted; native terminate does not block; done waits for accounting", { skip: !windows, timeout: 60000 }, async () => {
  const ws = workspace();
  try {
    const early = spawnSession("claude", ws.launch, [], task(ws, {}), hooks(), "early");
    await early.stop();
    const result = await early.done;
    assert.equal(result.stopped, true);
    assert.deepEqual([early.containment!().state, early.containment!().admitted], ["empty", false]);
    const session = spawnSession("claude", ws.launch, [], task(ws, { spawn: [["tree", "60000"]], live: 60000 }), hooks(), "s");
    await until(() => (session.containment!().activeProcesses ?? 0) >= 8, "tree");
    const started = performance.now();
    await session.stop();
    assert.deepEqual([session.containment!().state, session.containment!().admitted], ["empty", true]);
    assert.ok(performance.now() - started < 5000, "Stop settles by polling accounting, not by blocking waits");
    const source = readFileSync(join(root, "native/bunny-owned-process.c"), "utf8");
    assert.match(source, /DWORD active=terminate_group\(g,0\);/, "native terminate returns accounting immediately");
    const adapters = readFileSync(join(root, "src/lib/bunny-host/adapters.server.ts"), "utf8");
    assert.ok(adapters.indexOf("await emptied;") > 0 && adapters.indexOf("await emptied;") < adapters.indexOf("exitCode ??= group.inspectHistory().exitCode;"), "done settles only after kernel accounting is 0");
    await session.done;
  } finally { ws.cleanup(); }
});

test("F04 R1-RESTART-01..04/R1-startup: identity gaps fail closed, unreadable records never stop the Host, survivors block relaunch of the same work", { skip: !windows, timeout: 60000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-restart-"));
  try {
    const folder = join(data, "runtime/provider-sessions");
    const { mkdirSync } = await import("node:fs"); mkdirSync(folder, { recursive: true });
    const base = { schema: "bunny-owned-operation/1", containerId: "x", mechanism: "windows-job-object", stepId: null, capabilityRunId: null, launcherPath: "C:\\x\\provider.exe", endedAt: null, repo: data, cwd: data, action: "provider.claude", state: "running", exitCode: null, killOnClose: true, breakaway: false, closed: false, provider: "claude", agentId: null, sessionId: null, hostGeneration: "old", activeProcesses: 1, totalProcesses: 1, terminatedAtEnd: null, containment: "running", startedAt: 1 };
    const unknownBirth = { ...base, operationId: "33333333-3333-4333-8333-333333333333", missionId: "m-held", taskId: "t-held", launcherPid: 4242, launcherCreatedAt: 0, members: [{ pid: 4343, createdAt: 777, file: "C:\\x\\tool.exe" }] };
    const noIdentity = { ...base, operationId: "44444444-4444-4444-8444-444444444444", missionId: "m-none", taskId: "t-none", launcherPid: 0, launcherCreatedAt: 0, members: [] };
    writeFileSync(join(folder, unknownBirth.operationId + ".json"), JSON.stringify(unknownBirth));
    writeFileSync(join(folder, noIdentity.operationId + ".json"), JSON.stringify(noIdentity));
    writeFileSync(join(folder, "55555555-5555-4555-8555-555555555555.json"), "{ truncated");
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const table = async () => [{ pid: 4242, ppid: 1, name: "provider.exe", createdAt: 123 }, { pid: 4343, ppid: 4242, name: "tool.exe", createdAt: null }];
      const manager = new TaskManager(db, data, [], { dataDirectory: data, processTable: table });
      await until(() => Array.isArray(manager.lingering.get("restart:" + unknownBirth.operationId)), "unknown-birth identities held");
      assert.equal((manager.lingering.get("restart:" + unknownBirth.operationId) as unknown[]).length, 2, "a launcher with no recorded birth and a member with an unreadable current birth are both possibly alive");
      assert.ok(!manager.lingering.has("restart:" + noIdentity.operationId), "nothing to watch without an identity");
      assert.ok(db.taskEvents("t-none").some((e) => e.type === "provider_session.cleanup_unverifiable"), "an uncorroborated end requires review");
      assert.ok(manager.lingering.has("unreadable:55555555-5555-4555-8555-555555555555.json"), "an unreadable record is held as live code; the Host still started");
      assert.match(manager.restartSurvivorRefusal({ id: "new-task", mission: { missionId: "m-held", stepId: "s" } } as OrchTask) ?? "", /before the Host restarted/);
      assert.equal(manager.restartSurvivorRefusal({ id: "other", mission: { missionId: "m-other", stepId: "s" } } as OrchTask), null);
      assert.deepEqual(recoverProviderSessions(data).map((r) => r.operationId).sort(), [unknownBirth.operationId, noIdentity.operationId].sort(), "an unverifiable record stays listed for review on every restart (review round 3, REVIEW-3)");
      manager.dispose();
    } finally { db.close(); }
  } finally { rmSync(data, { recursive: true, force: true }); }
});

test("F04 R1-LOW-2/SHUT-1: Mission processes on Windows are always job-owned; shutdown awaits stops in flight", { skip: !windows, timeout: 60000 }, async () => {
  const { runCommand } = await import("../bunny-missions/capabilities/process.server.ts");
  const result = await runCommand("node", ["-e", "console.log('owned')"], { cwd: tmpdir(), signal: new AbortController().signal, timeoutMs: 15000 });
  assert.equal(result.stdout.trim(), "owned");
  assert.equal(result.ownership?.mechanism, "windows-job-object", "no owned flag was passed, and the run is still job-owned");
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-shut-"));
  const db = new HostDatabase(join(data, "host.sqlite"));
  try {
    const manager = new TaskManager(db, data, [], {});
    await manager.settleStops();
    const http = readFileSync(join(root, "src/lib/bunny-host/http.server.ts"), "utf8");
    assert.ok(http.indexOf("await manager.settleStops();") > 0 && http.indexOf("await manager.settleStops();") < http.indexOf("db.close();"), "shutdown awaits in-flight stops before closing the database");
  } finally { db.close(); rmSync(data, { recursive: true, force: true }); }
});

// ── Review round 2 regressions ───────────────────────────────────────────────────────────────────────────────

test("F04 R2-L1: restart absence is recorded as absent_after_restart, never kernel 'empty'; an empty table read is not absence", { skip: !windows, timeout: 60000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-r2-"));
  try {
    const folder = join(data, "runtime/provider-sessions");
    const { mkdirSync } = await import("node:fs"); mkdirSync(folder, { recursive: true });
    const record = { schema: "bunny-owned-operation/1", operationId: "66666666-6666-4666-8666-666666666666", containerId: "x", mechanism: "windows-job-object", missionId: "m", stepId: null, capabilityRunId: null, launcherPath: "C:\\x\\provider.exe", launcherPid: 5151, launcherCreatedAt: 9, members: [], startedAt: 1, endedAt: null, repo: data, cwd: data, action: "provider.claude", state: "running", exitCode: null, killOnClose: true, breakaway: false, closed: false, taskId: "t-r2", provider: "claude", agentId: null, sessionId: null, hostGeneration: "old", activeProcesses: 1, totalProcesses: 1, terminatedAtEnd: null, containment: "running" };
    writeFileSync(join(folder, record.operationId + ".json"), JSON.stringify(record));
    let table: { pid: number; ppid: number; name: string; createdAt: number | null }[] = [];
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const manager = new TaskManager(db, data, [], { dataDirectory: data, processTable: async () => table });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(manager.lingering.has("restart:" + record.operationId), "an empty process table is a failed read: still held");
      table = [{ pid: 4, ppid: 0, name: "System", createdAt: 1 }];
      const { readFileSync: read } = await import("node:fs");
      await until(() => !manager.lingering.has("restart:" + record.operationId), "reconciled", 30000);
      const stored = JSON.parse(read(join(folder, record.operationId + ".json"), "utf8"));
      assert.equal(stored.containment, "absent_after_restart");
      assert.ok(db.taskEvents("t-r2").some((e) => e.type === "provider_session.reconciled" && /not kernel-verified empty/.test(e.detail)));
    } finally { db.close(); }
  } finally { rmSync(data, { recursive: true, force: true }); }
});

test("F04 R2-L3/L4: Host verification jobs count as live code while open; a refused native launch is recorded as refused", { skip: !windows, timeout: 60000 }, async () => {
  const ws = workspace(); const data = mkdtempSync(join(tmpdir(), "bunny-f04-r2b-"));
  try {
    const { liveHostCodeRuns, outputPipe } = await import("./owned-process-group.server.ts");
    const out = await outputPipe(() => {}), err = await outputPipe(() => {});
    const group = new OwnedProcessGroup(ws.fixture, ws.directory, { action: "verification.python" });
    group.spawn(ws.fixture, ["sleep", "20000"], ws.directory, process.env, out.name, err.name);
    const probe = new OwnedProcessGroup(ws.fixture, ws.directory, { action: "provider.probe" });
    probe.spawn(ws.fixture, ["sleep", "20000"], ws.directory, process.env, out.name, err.name);
    assert.ok(liveHostCodeRuns().some((row) => row.startsWith("verification.python")), "listed as live code while the job is open");
    assert.ok(liveHostCodeRuns().some((row) => row.startsWith("provider.probe")), "a provider probe job is live code too (review round 3, COVERAGE-2)");
    group.close("stopped"); probe.close("stopped"); await out.close(); await err.close();
    assert.deepEqual(liveHostCodeRuns(), []);
    const missing = { ...ws.launch, command: join(ws.directory, "missing-provider.exe"), args: [] };
    const session = spawnSession("claude", missing, [], task(ws, {}), hooks([], [], { dataDirectory: data, hostGeneration: "g", taskId: "t", missionId: null, agentId: null }), "s");
    await session.done;
    const [file] = readdirSync(join(data, "runtime/provider-sessions"));
    const stored = JSON.parse(readFileSync(join(data, "runtime/provider-sessions", file), "utf8"));
    assert.deepEqual([stored.containment, stored.closed, session.containment!().state, session.containment!().admitted], ["refused", true, "refused", false]);
    const native = readFileSync(join(root, "native/bunny-owned-process.c"), "utf8");
    assert.ok(native.indexOf("CreateThread(NULL,0,write_input,payload,CREATE_SUSPENDED,NULL)") < native.indexOf("if(ResumeThread(pi.hThread)"), "the prompt writer exists before the root first runs");
  } finally { ws.cleanup(); rmSync(data, { recursive: true, force: true }); }
});

// ── Review round 3 regression ────────────────────────────────────────────────────────────────────────────────

test("F04 R3-BYPASS-CWD-1: Host tools are launched by absolute path; no bare system-tool name remains in Host source", { skip: !windows, timeout: 30000 }, async () => {
  const { pathTool, systemTool } = await import("./system-tools.server.ts");
  for (const tool of ["powershell.exe", "taskkill.exe"] as const) {
    const path = systemTool(tool);
    assert.ok(/^[A-Za-z]:\\/.test(path) && existsSync(path), `${tool} resolves to an existing absolute path: ${path}`);
  }
  const ws = workspace();
  try {
    const { copyFileSync } = await import("node:fs");
    copyFileSync(ws.fixture, join(ws.directory, "nvidia-smi.exe"));
    const found = pathTool("nvidia-smi", ws.directory, [ws.directory, ".", process.env.PATH ?? ""].join(";"));
    assert.ok(!found || !found.toLowerCase().startsWith(ws.directory.toLowerCase()), `PATH-only lookup never returns the working folder: ${found}`);
  } finally { ws.cleanup(); }
  const { readdirSync: list, statSync: stat } = await import("node:fs");
  const walk = (dir: string): string[] => list(dir).flatMap((name) => { const path = join(dir, name); return stat(path).isDirectory() ? (name === "vendor" ? [] : walk(path)) : [path]; });
  const offenders = walk(join(root, "src")).filter((file) => /\.server\.ts$/.test(file) && !file.endsWith("system-tools.server.ts"))
    .filter((file) => /(?:execFile|execOwnedFile|execFileAsync|spawn|exec)\(\s*["'](?:powershell|taskkill|nvidia-smi|python|cmd|wmic|where)(?:\.exe)?["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, [], "bare-name launches let the child working folder win the search");
});

test("F04 R3-HOLD-4: an unreadable record that becomes readable is reconciled before its hold is released", { skip: !windows, timeout: 60000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-r3-"));
  try {
    const folder = join(data, "runtime/provider-sessions");
    const { mkdirSync } = await import("node:fs"); mkdirSync(folder, { recursive: true });
    const id = "77777777-7777-4777-8777-777777777777";
    writeFileSync(join(folder, id + ".json"), "{ half-written");
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const manager = new TaskManager(db, data, [], { dataDirectory: data, processTable: async () => [{ pid: 4, ppid: 0, name: "System", createdAt: 1 }] });
      assert.ok(manager.lingering.has("unreadable:" + id + ".json"));
      writeFileSync(join(folder, id + ".json"), JSON.stringify({ schema: "bunny-owned-operation/1", operationId: id, containerId: "x", mechanism: "windows-job-object", missionId: null, stepId: null, capabilityRunId: null, launcherPath: "C:\\x\\provider.exe", launcherPid: 6161, launcherCreatedAt: 9, members: [], startedAt: 1, endedAt: null, repo: data, cwd: data, action: "provider.claude", state: "running", exitCode: null, killOnClose: true, breakaway: false, closed: false, taskId: "t-r3", provider: "claude", agentId: null, sessionId: null, hostGeneration: "old", activeProcesses: 1, totalProcesses: 1, terminatedAtEnd: null, containment: "running" }));
      await until(() => db.taskEvents("t-r3").some((e) => e.type === "provider_session.reconciled"), "reconciled after becoming readable", 40000);
      assert.ok(!manager.lingering.has("unreadable:" + id + ".json"));
      manager.dispose();
    } finally { db.close(); }
  } finally { rmSync(data, { recursive: true, force: true }); }
});

test("F04 R3-R2-01/R2-03: a parseable malformed record is held, never a startup failure; alias-style reparse entries resolve", { skip: !windows, timeout: 60000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-r3c-"));
  try {
    const folder = join(data, "runtime/provider-sessions");
    const { mkdirSync, symlinkSync } = await import("node:fs"); mkdirSync(folder, { recursive: true });
    const id = "88888888-8888-4888-8888-888888888888";
    writeFileSync(join(folder, id + ".json"), JSON.stringify({ schema: "bunny-owned-operation/1", operationId: id, containment: "running", closed: false }));
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const manager = new TaskManager(db, data, [], { dataDirectory: data, processTable: async () => [{ pid: 4, ppid: 0, name: "System", createdAt: 1 }] });
      assert.ok(manager.lingering.has("unreadable:" + id + ".json"), "missing launcher/members fields: held as unreadable, the Host still constructed");
      manager.dispose();
    } finally { db.close(); }
    const { resolveInterpreter } = await import("./verification.server.ts");
    const bin = join(data, "alias-bin"); mkdirSync(bin);
    let linked = true;
    try { symlinkSync(join(data, "does-not-exist.exe"), join(bin, "python.exe"), "file"); } catch { linked = false; }
    if (linked) assert.equal(resolveInterpreter("python", join(data, "task"), bin), join(bin, "python.exe"), "an entry stat cannot follow (like a WindowsApps alias) still resolves");
  } finally { rmSync(data, { recursive: true, force: true }); }
});

// ── Review round 4 regressions ───────────────────────────────────────────────────────────────────────────────

test("F04 R4-R3-1/FINAL-1: a throwing native terminate or event hook never escapes Stop and never strands accounting", { skip: !windows, timeout: 90000 }, async () => {
  const ws = workspace();
  const original = OwnedProcessGroup.prototype.terminate;
  try {
    const events: [string, string][] = [];
    const throwing: AdapterHooks = { ...hooks(events), event: (type, detail) => { events.push([type, detail]); if (type.startsWith("provider.containment")) throw new Error("event sink failed"); } };
    const session = spawnSession("claude", ws.launch, [], task(ws, { spawn: [["tree", "60000"]], live: 60000 }), throwing, "s");
    await until(() => (session.containment!().activeProcesses ?? 0) >= 8, "tree");
    let failures = 3;
    OwnedProcessGroup.prototype.terminate = function (this: OwnedProcessGroup) { if (failures-- > 0) throw new Error("native terminate failed"); return original.call(this); };
    await session.stop();
    assert.equal(failures < 0, true, "the throwing terminate was exercised and polling continued");
    assert.deepEqual([session.containment!().state, session.containment!().activeProcesses], ["empty", 0]);
    await session.done;
    await until(async () => (await fixtureProcesses(ws)).length === 0, "no fixture survives", 15000);
    const adapters = readFileSync(join(root, "src/lib/bunny-host/adapters.server.ts"), "utf8");
    const body = adapters.slice(adapters.indexOf("const terminateJob ="), adapters.indexOf("const done = (async"));
    assert.equal((body.match(/owned\.terminate\(\)/g) ?? []).length, 1, "the only native terminate call is inside the guarded sweep");
    assert.ok(!/\bhooks\.event\(/.test(body), "termination bookkeeping emits only through the guarded sink");
    assert.match(adapters, /group\.onStop\(\(\) => \{ stop\(\)\.catch\(/);
  } finally { OwnedProcessGroup.prototype.terminate = original; ws.cleanup(); }
});

test("F04 R4-R3-2: a PATH folder inside the working folder whose name starts with '..' is still inside", { skip: !windows, timeout: 30000 }, async () => {
  const ws = workspace();
  try {
    const { copyFileSync, mkdirSync } = await import("node:fs");
    const dotted = join(ws.directory, "..cache"); mkdirSync(dotted);
    copyFileSync(ws.fixture, join(dotted, "nvidia-smi.exe")); copyFileSync(ws.fixture, join(dotted, "python.exe"));
    const { pathTool } = await import("./system-tools.server.ts");
    const { resolveInterpreter } = await import("./verification.server.ts");
    assert.equal(pathTool("nvidia-smi", ws.directory, dotted), null, "system-tools refuses an in-folder '..cache' PATH entry");
    assert.equal(resolveInterpreter("python", ws.directory, dotted), null, "verification refuses an in-folder '..cache' PATH entry");
    const sibling = mkdtempSync(join(tmpdir(), "bunny-f04-sib-")); copyFileSync(ws.fixture, join(sibling, "nvidia-smi.exe"));
    try { assert.equal(pathTool("nvidia-smi", ws.directory, sibling), join(sibling, "nvidia-smi.exe"), "a genuinely outside folder still resolves"); }
    finally { rmSync(sibling, { recursive: true, force: true }); }
  } finally { ws.cleanup(); }
});

test("F04 R4-R3-3: a reconcile failure in the unreadable-record hold keeps the hold and retries", { skip: !windows, timeout: 90000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-r4-"));
  try {
    const folder = join(data, "runtime/provider-sessions");
    const { mkdirSync } = await import("node:fs"); mkdirSync(folder, { recursive: true });
    const id = "99999999-9999-4999-8999-999999999999";
    writeFileSync(join(folder, id + ".json"), "{ half-written");
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const manager = new TaskManager(db, data, [], { dataDirectory: data, processTable: async () => [{ pid: 4, ppid: 0, name: "System", createdAt: 1 }] });
      const real = manager.reconcileInterruptedProviderSessions.bind(manager);
      let thrown = 0;
      manager.reconcileInterruptedProviderSessions = (records) => { if (records.length && thrown === 0) { thrown++; throw new Error("reconcile failed"); } real(records); };
      writeFileSync(join(folder, id + ".json"), JSON.stringify({ schema: "bunny-owned-operation/1", operationId: id, containerId: "x", mechanism: "windows-job-object", missionId: null, stepId: null, capabilityRunId: null, launcherPath: "C:\\x\\provider.exe", launcherPid: 7171, launcherCreatedAt: 9, members: [], startedAt: 1, endedAt: null, repo: data, cwd: data, action: "provider.claude", state: "running", exitCode: null, killOnClose: true, breakaway: false, closed: false, taskId: "t-r4", provider: "claude", agentId: null, sessionId: null, hostGeneration: "old", activeProcesses: 1, totalProcesses: 1, terminatedAtEnd: null, containment: "running" }));
      await until(() => thrown === 1, "first reconcile attempt failed", 30000);
      assert.ok(manager.lingering.has("unreadable:" + id + ".json"), "the hold survives a reconcile failure (fail closed)");
      await until(() => db.taskEvents("t-r4").some((e) => e.type === "provider_session.reconciled"), "reconciled on retry", 40000);
      assert.ok(!manager.lingering.has("unreadable:" + id + ".json"));
      manager.dispose();
    } finally { db.close(); }
  } finally { rmSync(data, { recursive: true, force: true }); }
});

// ── Review round 5 regressions ───────────────────────────────────────────────────────────────────────────────

const r5Record = (data: string, id: string, extra: Record<string, unknown> = {}) => ({ schema: "bunny-owned-operation/1", operationId: id, containerId: "x", mechanism: "windows-job-object", missionId: null, stepId: null, capabilityRunId: null, launcherPath: join(data, "provider.exe"), launcherPid: 8181, launcherCreatedAt: 9, members: [], startedAt: 1, endedAt: null, repo: data, cwd: data, action: "provider.claude", state: "running", exitCode: null, killOnClose: true, breakaway: false, closed: false, taskId: "t-r5", provider: "claude", agentId: null, sessionId: null, hostGeneration: "old", activeProcesses: 1, totalProcesses: 1, terminatedAtEnd: null, containment: "running", ...extra });

test("F04 R5-FOLDER: a provider-sessions folder unreadable at startup is released only after every record in it is reconciled", { skip: !windows, timeout: 90000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-r5-"));
  try {
    const { mkdirSync } = await import("node:fs");
    const runtime = join(data, "runtime"); mkdirSync(runtime, { recursive: true });
    const folder = join(runtime, "provider-sessions");
    writeFileSync(folder, "not a folder");
    const db = new HostDatabase(join(data, "host.sqlite"));
    try {
      const manager = new TaskManager(db, data, [], { dataDirectory: data, processTable: async () => [{ pid: 4, ppid: 0, name: "System", createdAt: 1 }] });
      const hold = "unreadable:provider-sessions (folder unreadable)";
      assert.ok(manager.lingering.has(hold), "an unlistable folder is held as live code; the Host still started");
      rmSync(folder); mkdirSync(folder);
      const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      writeFileSync(join(folder, a + ".json"), JSON.stringify(r5Record(data, a)));
      writeFileSync(join(folder, b + ".json"), JSON.stringify(r5Record(data, b, { taskId: "t-r5b" })));
      writeFileSync(join(folder, "cccccccc-cccc-4ccc-8ccc-cccccccccccc.json"), "{ torn");
      await until(() => !manager.lingering.has(hold), "folder hold released", 40000);
      assert.ok(manager.reconciledOperations.has(a) && manager.reconciledOperations.has(b), "every record in the folder was reconciled before the folder hold was released");
      assert.ok(manager.lingering.has("unreadable:cccccccc-cccc-4ccc-8ccc-cccccccccccc.json"), "a still-unreadable file gets its own hold");
      await until(() => db.taskEvents("t-r5").some((e) => e.type === "provider_session.reconciled") && db.taskEvents("t-r5b").some((e) => e.type === "provider_session.reconciled"), "both reconciled", 30000);
      assert.equal(db.taskEvents("t-r5").filter((e) => e.type === "provider_session.interrupted").length, 1, "a record is reconciled and reported once per Host");
      manager.dispose();
    } finally { db.close(); }
  } finally { rmSync(data, { recursive: true, force: true }); }
});

test("F04 R5-GEN/SPLIT: a re-read never returns or rewrites this Host's own live records; a failed annotate never skips close", { skip: !windows, timeout: 30000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bunny-f04-r5g-"));
  try {
    const { mkdirSync } = await import("node:fs");
    const folder = join(data, "runtime/provider-sessions"); mkdirSync(folder, { recursive: true });
    const mine = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", old = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    writeFileSync(join(folder, mine + ".json"), JSON.stringify(r5Record(data, mine, { hostGeneration: "current" })));
    writeFileSync(join(folder, old + ".json"), JSON.stringify(r5Record(data, old)));
    const { readProviderSessions } = await import("./owned-process-group.server.ts");
    assert.deepEqual(readProviderSessions(data, "current").records.map((r) => r.operationId), [old]);
    const stored = JSON.parse(readFileSync(join(folder, mine + ".json"), "utf8"));
    assert.deepEqual([stored.closed, stored.state], [false, "running"], "this Host's live record is untouched by the re-read");
  } finally { rmSync(data, { recursive: true, force: true }); }
  // Behavioural (review round 6, NEW-2): a throwing annotate at the end of a session never skips the close.
  const ws = workspace(); const owner = mkdtempSync(join(tmpdir(), "bunny-f04-r5s-"));
  const original = OwnedProcessGroup.prototype.annotate;
  try {
    OwnedProcessGroup.prototype.annotate = () => { throw new Error("record write failed"); };
    const events: [string, string][] = [];
    const session = spawnSession("claude", ws.launch, [], task(ws, {}), hooks(events, [], { dataDirectory: owner, hostGeneration: "g", taskId: "t", missionId: null, agentId: null }), "s");
    await session.done;
    assert.equal(session.containment!().state, "empty");
    assert.ok(events.some(([type]) => type === "provider.containment_record_failed"), "the failed annotate is reported");
    const [file] = readdirSync(join(owner, "runtime/provider-sessions"));
    const stored = JSON.parse(readFileSync(join(owner, "runtime/provider-sessions", file), "utf8"));
    assert.deepEqual([stored.closed, stored.containment], [true, "empty"], "close still ran: handle released and record closed by kernel accounting");
  } finally { OwnedProcessGroup.prototype.annotate = original; ws.cleanup(); rmSync(owner, { recursive: true, force: true }); }
  const group = readFileSync(join(root, "src/lib/bunny-host/owned-process-group.server.ts"), "utf8");
  assert.match(group, /try \{persist\(this\.path,this\.record\);\} catch \{ \/\* close\(\) persists again and reports \*\/ \}/, "terminate returns kernel accounting even when the record write fails");
});
