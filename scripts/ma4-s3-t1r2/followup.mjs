/**
 * Remeasure the rows the first harness mis-stated, plus Host Stop while inference is still running,
 * a stored preference that is no longer installed, and the predecessor C0 latency set.
 * Does not edit fixtures.json.
 */
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { classifyTask } from "../../src/lib/bunny-host/ma4/s3t1.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = JSON.parse(readFileSync(join(root, "scripts/ma4-s3-t1r2/fixtures.json"), "utf8"));
const evidenceDir = join(root, "docs/ma4-s3-t1r2/evidence");
const MODEL = fixtures.model;
const PORT = 43733;
const stateDir = join(process.env.LOCALAPPDATA ?? tmpdir(), "Bunny-T1R2-Followup");
const projectDir = join(process.env.USERPROFILE ?? tmpdir(), "Documents", "Bunny-T1R2-Fixture");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

function client(token, port) {
  const headers = { connection: "close", authorization: `Bearer ${token}`, "content-type": "application/json" };
  const command = async (action, data = {}) => {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers, body: JSON.stringify({ action, data }) });
    return { status: response.status, ms: Math.round(performance.now() - started), body: await response.json() };
  };
  const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers })).json();
  return { command, state };
}

function envelope(kinds, access) {
  return {
    capabilities: kinds,
    providers: ["ollama"],
    localOnly: true,
    models: [MODEL],
    projectScopes: ["p1"],
    sideEffects: kinds.includes("file.apply"),
    background: false,
    budgets: { maxModelCalls: 0, maxWallMs: 120000 },
    expiresAt: Date.now() + 86_400_000,
    grants: { files: [{ root: "fixture", access }] },
  };
}

async function settle(state, id, timeoutMs = 20000) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeoutMs) {
    const snap = await state();
    last = snap.persistentTasks?.tasks?.find((task) => task.id === id) ?? null;
    if (last && !["QUEUED", "RUNNING", "RESUMING", "VALIDATED", "CREATED"].includes(last.state)) return last;
    await sleep(40);
  }
  return last;
}

async function runChat(api, prompt, constraints) {
  const started = performance.now();
  const created = await api.command("submit", { prompt, mode: "fast", constraints });
  const id = created.body?.task?.id;
  if (!id) return { ok: false, ms: Math.round(performance.now() - started), state: "submit-failed", model: null, output: "", queueMs: null, error: created.body?.error ?? created.body?.code ?? created.status };
  await api.command("approve", { id });
  let task = null;
  const deadline = performance.now() + (constraints.maxRuntimeMs ?? 45000) + 20000;
  while (performance.now() < deadline) {
    task = ((await api.state()).tasks ?? []).find((row) => row.id === id) ?? null;
    if (task && ["completed", "failed", "stopped"].includes(task.state)) break;
    await sleep(70);
  }
  return { ok: task?.state === "completed", id, ms: Math.round(performance.now() - started), state: task?.state ?? null, model: task?.model ?? null, output: String(task?.output ?? ""), queueMs: task?.startedAt && task?.createdAt ? task.startedAt - task.createdAt : null };
}

const report = { startedAt: new Date().toISOString() };
rmSync(stateDir, { recursive: true, force: true });
mkdirSync(projectDir, { recursive: true });
let host = await startHost({ dataDirectory: stateDir, port: PORT, root: projectDir });
let api = client(host.token, PORT);
await api.state();
await api.command("onboarding.save", { state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL } } });
await api.command("scheduler.priority", { priority: "local_only" });
await api.command("connector.roots.set", { roots: [{ id: "fixture", label: "T1R2 fixture", path: projectDir }] });

const c2 = [];
for (const task of fixtures.c2) {
  const file = join(projectDir, task.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, task.content);
  const created = await api.command("ptask.create", {
    spec: {
      title: task.id,
      projectId: "p1",
      steps: [
        { id: "read", kind: "file.read", input: { root: "fixture", path: task.path, maxChars: 2000 } },
        { id: "stat", kind: "file.stat", input: { root: "fixture", path: task.path } },
      ],
      acceptance: { requiredSteps: ["read", "stat"] },
    },
    envelope: envelope(["file.read", "file.stat"], "read"),
  });
  const id = created.body?.data?.id;
  const settled = id ? await settle(api.state, id) : null;
  const order = (settled?.evidence ?? []).map((row) => row.stepId);
  c2.push({
    id: task.id,
    state: settled?.state ?? null,
    order,
    dependencyHonored: order[0] === "read" && order[1] === "stat",
    functionalCorrect: settled?.state === "COMPLETED" && order[0] === "read" && order[1] === "stat",
    modelCalls: settled?.models?.length ?? 0,
    error: created.body?.error ?? settled?.failure ?? null,
  });
  process.stdout.write(`C2 ${task.id} ${settled?.state} ${order.join("->")}\n`);
}

const edits = [];
for (const task of fixtures.c3.filter((row) => row.kind === "approved-edit" || row.kind === "stale-hash")) {
  const file = join(projectDir, task.path);
  writeFileSync(file, task.content);
  const current = sha256(task.content);
  const expectedSha256 = task.kind === "stale-hash" ? "ab".repeat(32) : current;
  const created = await api.command("ptask.create", {
    spec: {
      title: task.id,
      projectId: "p1",
      steps: [
        { id: "read", kind: "file.read", input: { root: "fixture", path: task.path, maxChars: 2000 } },
        { id: "apply", kind: "file.apply", input: { root: "fixture", path: task.path, content: task.next ?? "SHOULD-NOT-WRITE\n", expectedSha256 } },
      ],
      acceptance: { requiredSteps: ["read", "apply"] },
    },
    envelope: envelope(["file.read", "file.apply"], "write"),
  });
  const id = created.body?.data?.id;
  let waiting = id ? await settle(api.state, id) : null;
  let taskApproval = null;
  if (waiting?.state === "AWAITING_APPROVAL" && !waiting.pendingAction) {
    taskApproval = await api.command("ptask.approve", { id });
    waiting = await settle(api.state, id);
  }
  let approved = null;
  let after = waiting;
  if (waiting?.pendingAction) {
    approved = await api.command("action.approve", { id, actionId: waiting.pendingAction.actionId, payloadSha256: waiting.pendingAction.payloadSha256 });
    after = await settle(api.state, id);
  }
  const disk = readFileSync(file, "utf8");
  edits.push({
    id: task.id,
    kind: task.kind,
    createStatus: created.status,
    taskApproval: taskApproval?.status ?? null,
    authorization: waiting?.state ?? null,
    pending: waiting?.pendingAction?.kind ?? null,
    approveStatus: approved?.status ?? null,
    finalState: after?.state ?? null,
    disk,
    functionalCorrect: task.kind === "approved-edit" ? disk === task.next && after?.state === "COMPLETED" : disk === task.content,
    error: created.body?.error ?? after?.failure ?? null,
  });
  process.stdout.write(`EDIT ${task.id} ${after?.state} disk=${JSON.stringify(disk)}\n`);
}

const psBefore = await fetch("http://127.0.0.1:11434/api/ps").then((r) => r.json());
const long = await api.command("submit", {
  prompt: "Count from 1 to 800, one number per line.",
  mode: "fast",
  constraints: { localOnly: true, outputTokens: 800, maxRuntimeMs: 180000 },
});
const longId = long.body?.task?.id;
if (longId) await api.command("approve", { id: longId });
let running = null;
for (let i = 0; i < 80; i += 1) {
  running = ((await api.state()).tasks ?? []).find((task) => task.id === longId) ?? null;
  if (running && running.state === "running") break;
  await sleep(50);
}
const psDuring = await fetch("http://127.0.0.1:11434/api/ps").then((r) => r.json());
const gpu = await new Promise((resolve) => execFile("nvidia-smi", ["--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { windowsHide: true }, (error, stdout) => resolve(error ? error.message : stdout.trim())));
const foregroundPromise = runChat(api, "Reply with the single word foreground.", { localOnly: true, outputTokens: 8, maxRuntimeMs: 120000 });
await sleep(200);
const stopStarted = performance.now();
const stopped = longId ? await api.command("stop", { id: longId }) : null;
let stopState = null;
const stopDeadline = performance.now() + 10000;
while (performance.now() < stopDeadline) {
  stopState = ((await api.state()).tasks ?? []).find((task) => task.id === longId) ?? null;
  if (stopState && ["stopped", "failed", "completed"].includes(stopState.state)) break;
  await sleep(30);
}
const outputAtStop = String(stopState?.output ?? "");
await sleep(1000);
const later = ((await api.state()).tasks ?? []).find((task) => task.id === longId);
const foreground = await foregroundPromise;
report.stop = {
  sawRunning: running?.state === "running",
  gpu,
  residentDuring: (psDuring.models ?? []).map((model) => ({ name: model.name, size: model.size, sizeVram: model.size_vram })),
  residentBefore: (psBefore.models ?? []).map((model) => model.name),
  ackMs: stopped?.ms ?? null,
  settleMs: Math.round(performance.now() - stopStarted),
  state: stopState?.state ?? null,
  stopError: stopped?.body?.error ?? null,
  outputGrewAfterStop: String(later?.output ?? "").length > outputAtStop.length,
  foreground: { state: foreground.state, ms: foreground.ms, queueMs: foreground.queueMs, model: foreground.model, output: foreground.output.slice(0, 80) },
};
process.stdout.write(`STOP ${report.stop.state} ack ${report.stop.ackMs} settle ${report.stop.settleMs} fg ${foreground.state} ${foreground.ms}\n`);

await host.close();
const db = new DatabaseSync(join(stateDir, "host.sqlite"));
const stored = db.prepare("SELECT value FROM settings WHERE key=?").get("guided_onboarding_v1");
const parsed = JSON.parse(stored.value);
parsed.state.preferences.selectedLocalModel = "not-installed:7b";
db.prepare("UPDATE settings SET value=? WHERE key=?").run(JSON.stringify(parsed), "guided_onboarding_v1");
db.close();
host = await startHost({ dataDirectory: stateDir, port: PORT, root: projectDir });
api = client(host.token, PORT);
await api.state();
const missing = await api.command("submit", {
  prompt: "What is 2 plus 2? Reply with digits only.",
  mode: "fast",
  constraints: { localOnly: true, outputTokens: 8, maxRuntimeMs: 20000 },
});
report.missingPreference = {
  status: missing.status,
  code: missing.body?.code ?? null,
  error: missing.body?.error ?? null,
  model: missing.body?.task?.model ?? null,
};
process.stdout.write(`PREF ${missing.status} ${missing.body?.code ?? ""} ${missing.body?.task?.model ?? ""}\n`);
await host.close();

const planning = JSON.parse(readFileSync(join(evidenceDir, "planning.json"), "utf8"));
for (const row of planning.rows) {
  const task = [...fixtures.c0, ...fixtures.c1, ...fixtures.c2, ...fixtures.c3].find((item) => item.id === row.id);
  const classification = classifyTask(task.prompt);
  row.classification = classification;
  row.planningValid = classification.complexity === row.expectedComplexity;
  row.modelCallsInPlan = classification.resource.modelCalls;
}
writeFileSync(join(evidenceDir, "planning.json"), JSON.stringify(planning, null, 2));
report.planning = { valid: planning.rows.filter((row) => row.planningValid).length, total: planning.rows.length, invalid: planning.rows.filter((row) => !row.planningValid).map((row) => row.id) };

writeFileSync(join(evidenceDir, "followup.json"), JSON.stringify({ ...report, c2, edits, baseline: { status: "NOT TESTED" } }, null, 2));
const baselineRoot = "C:\\Users\\allam\\Documents\\new\\bun-router-t1-base";
const baselineState = join(process.env.LOCALAPPDATA ?? tmpdir(), "Bunny-T1R2-Baseline");
const baselinePort = 43741;
rmSync(baselineState, { recursive: true, force: true });
mkdirSync(baselineState, { recursive: true });
const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/bunny-host.mjs"], {
  cwd: baselineRoot,
  env: { ...process.env, BUNNY_HOST_PORT: String(baselinePort), BUNNY_HOST_DATA_DIRECTORY: baselineState },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let baselineLog = "";
child.stdout.on("data", (chunk) => { baselineLog += chunk.toString(); });
child.stderr.on("data", (chunk) => { baselineLog += chunk.toString(); });
const readyDeadline = Date.now() + 90000;
while (Date.now() < readyDeadline && !baselineLog.includes("Host ready")) await sleep(200);
let baseline = { status: "NOT TESTED", log: baselineLog.slice(0, 500) };
if (baselineLog.includes("Host ready")) {
  const token = JSON.parse(readFileSync(join(baselineState, "credentials.json"), "utf8")).token;
  const baseApi = client(token, baselinePort);
  await baseApi.state();
  await fetch("http://127.0.0.1:11434/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: 0, stream: false }) }).catch(() => {});
  await baseApi.command("onboarding.save", { state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL } } });
  const rows = [];
  for (let trial = 1; trial <= 3; trial += 1) {
    for (const [index, task] of fixtures.c0.entries()) {
      const row = await runChat(baseApi, task.prompt, { localOnly: true, modelExact: MODEL, outputTokens: 32, maxRuntimeMs: 45000 });
      const text = String(row.output ?? "");
      rows.push({ id: task.id, trial, phase: trial === 1 && index === 0 ? "cold" : "warm", ms: row.ms, state: row.state, model: row.model, functionalCorrect: text.toLowerCase().includes(task.expectToken.toLowerCase()), output: text.slice(0, 80), error: row.error ?? null });
      process.stdout.write(`BASE ${task.id} t${trial} ${row.state} ${row.ms}\n`);
    }
  }
  const warm = rows.filter((row) => row.phase === "warm" && row.state === "completed").map((row) => row.ms);
  baseline = {
    status: "MEASURED",
    commit: "bc1c82df8f765e39b1bbb64191a08f3e09f00d95",
    functionalTrial1: rows.filter((row) => row.trial === 1 && row.functionalCorrect).length,
    completedTrial1: rows.filter((row) => row.trial === 1 && row.state === "completed").length,
    coldMs: rows.find((row) => row.phase === "cold")?.ms ?? null,
    warmMedianMs: quantile(warm, 50),
    warmP95Ms: quantile(warm, 95),
    models: [...new Set(rows.map((row) => row.model))],
    rows,
  };
}
child.kill();
await sleep(500);
report.c2 = { functional: c2.filter((row) => row.functionalCorrect).length, ordered: c2.filter((row) => row.dependencyHonored).length, total: c2.length, rows: c2 };
report.edits = edits;
report.baseline = { status: baseline.status, commit: baseline.commit, functionalTrial1: baseline.functionalTrial1, completedTrial1: baseline.completedTrial1, coldMs: baseline.coldMs, warmMedianMs: baseline.warmMedianMs, warmP95Ms: baseline.warmP95Ms, models: baseline.models, log: baseline.log };
writeFileSync(join(evidenceDir, "followup.json"), JSON.stringify({ ...report, baselineRows: baseline.rows ?? [] }, null, 2));
process.stdout.write(`DONE c2 ${report.c2.functional}/${report.c2.total} planning ${report.planning.valid}/${report.planning.total} baseline ${baseline.warmMedianMs}\n`);
process.exit(0);
