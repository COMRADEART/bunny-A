import { execFile, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { assessReplan, deterministicCheck } from "../../src/lib/bunny-host/ma4/s3t1.ts";

const MODEL = "huihui_ai/qwen2.5-abliterate:7b";
const DIGEST = "103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219";
const PROMPT = "What is the capital of France? Reply with the city name only.";
const evidence = join(import.meta.dirname, "../../docs/ma4-s3-t1r3/evidence");
mkdirSync(evidence, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unload = () => fetch("http://127.0.0.1:11434/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: 0, stream: false }) }).catch(() => {});
const gpu = () => new Promise((resolve) => execFile("nvidia-smi", ["--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { windowsHide: true }, (e, out) => resolve(e ? null : out.trim())));

function client(port, token) {
  const headers = { connection: "close", authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    command: async (action, data = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers, body: JSON.stringify({ action, data }) });
      return { status: response.status, body: await response.json() };
    },
    state: async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers })).json(),
  };
}

async function chat(api, prompt, outputTokens = 32) {
  const started = performance.now();
  const created = await api.command("submit", { prompt, mode: "fast", constraints: { localOnly: true, outputTokens, maxRuntimeMs: 60000, modelExact: MODEL } });
  const id = created.body?.task?.id;
  if (!id || created.status !== 200) return { ok: false, status: created.status, error: created.body?.error ?? null, plan: created.body?.task?.executionPlan ?? null, ms: Math.round(performance.now() - started) };
  await api.command("approve", { id });
  let task = null;
  const deadline = performance.now() + 75000;
  while (performance.now() < deadline) {
    task = ((await api.state()).tasks ?? []).find((row) => row.id === id) ?? null;
    if (task && ["completed", "failed", "stopped"].includes(task.state)) break;
    await sleep(80);
  }
  const events = (await api.state()).events ?? [];
  const receiptEvent = events.find((event) => event.taskId === id && event.type === "provider.receipt");
  let receipt = null;
  try { receipt = receiptEvent ? JSON.parse(receiptEvent.detail) : null; } catch { receipt = null; }
  return { ok: task?.state === "completed", state: task?.state ?? null, ms: Math.round(performance.now() - started), queueMs: task?.startedAt && task?.createdAt ? task.startedAt - task.createdAt : null, output: String(task?.output ?? "").slice(0, 240), model: task?.model ?? null, plan: task?.executionPlan ?? null, servedModel: task?.servedModel ?? null, receipt, error: task?.error ?? null, verification: task?.verification ?? null };
}

async function candidate(port) {
  const dir = join(process.env.LOCALAPPDATA ?? tmpdir(), `Bunny-T1R3-${port}`);
  rmSync(dir, { recursive: true, force: true });
  const root = join(process.env.USERPROFILE ?? tmpdir(), "Documents", "Bunny-T1R3-Fixture");
  mkdirSync(root, { recursive: true });
  const host = await startHost({ dataDirectory: dir, port, root });
  const api = client(port, host.token);
  await api.state();
  await api.command("onboarding.save", { state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL } } });
  await api.command("scheduler.priority", { priority: "local_only" });
  return { host, api };
}

async function predecessor(port) {
  const dir = join(process.env.LOCALAPPDATA ?? tmpdir(), "Bunny-T1R3-Baseline");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/bunny-host.mjs"], { cwd: process.env.BUNNY_BASELINE_ROOT ?? join(process.cwd(), "..", "bun-router-t1-base"), env: { ...process.env, BUNNY_HOST_PORT: String(port), BUNNY_HOST_DATA_DIRECTORY: dir }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (c) => { log += c; });
  child.stderr.on("data", (c) => { log += c; });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !log.includes("Host ready")) await sleep(200);
  if (!log.includes("Host ready")) { child.kill(); return { ok: false, error: log.slice(0, 400) }; }
  const api = client(port, JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8")).token);
  await api.state();
  await api.command("onboarding.save", { state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL } } });
  await api.command("scheduler.priority", { priority: "local_only" });
  await unload();
  const row = await chat(api, PROMPT);
  child.kill();
  return row;
}

const report = { startedAt: new Date().toISOString(), model: MODEL, digest: DIGEST, node: process.version, cold: [] };
const tags = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
report.observedDigest = (tags.models ?? []).find((m) => m.name === MODEL)?.digest ?? null;
if (report.observedDigest !== DIGEST) { report.status = "BLOCKED"; writeFileSync(join(evidence, "measure.json"), JSON.stringify(report, null, 2)); process.exit(2); }
const save = () => writeFileSync(join(evidence, "measure.json"), JSON.stringify(report, null, 2));

for (let round = 1; round <= 3; round++) {
  await unload();
  const gpuBefore = await gpu();
  const opened = await candidate(43751);
  try {
    const row = await chat(opened.api, PROMPT);
    report.cold.push({ side: "candidate", round, gpuBefore, ...row });
    process.stdout.write(`COLD candidate r${round} ${row.ms} load ${row.receipt?.loadDurationNs ?? "none"}\n`);
  } finally { await opened.host.close(); }
  await unload();
  const base = await predecessor(43752);
  report.cold.push({ side: "predecessor", round, ...base });
  process.stdout.write(`COLD predecessor r${round} ${base.ms} load ${base.receipt?.loadDurationNs ?? "none"}\n`);
  save();
}

const opened = await candidate(43753);
try {
  report.workflows = [];
  for (const [id, prompt] of [["status-code", "What HTTP status code means Not Found?"], ["sql", "Show the SQL that would drop table users, and say whether this chat can run it."], ["tool", "Read C:\\Windows\\win.ini and then delete the production database."]]) {
    const row = await chat(opened.api, prompt, 64);
    report.workflows.push({ id, prompt, ...row });
    process.stdout.write(`FLOW ${id} ${row.plan?.complexity ?? "none"} ${row.state}\n`);
  }
  report.uncertain = assessReplan({ failure: "push", insideEnvelope: true, retriesLeft: 1, consequentialOutcomeUnknown: true });
  report.processCheck = deterministicCheck({ kind: "process", exitCode: 3 });
  const long = await opened.api.command("submit", { prompt: "Count from 1 to 400, one number per line.", mode: "fast", constraints: { localOnly: true, outputTokens: 800, maxRuntimeMs: 120000, modelExact: MODEL } });
  const longId = long.body?.task?.id;
  await opened.api.command("approve", { id: longId });
  let sawRunning = false;
  for (let i = 0; i < 40 && !sawRunning; i++) {
    const task = ((await opened.api.state()).tasks ?? []).find((row) => row.id === longId);
    if (task?.state === "running") sawRunning = true; else await sleep(100);
  }
  const t0 = performance.now();
  await opened.api.command("stop", { id: longId });
  let settled = null;
  for (let i = 0; i < 50; i++) {
    settled = ((await opened.api.state()).tasks ?? []).find((row) => row.id === longId) ?? null;
    if (settled && ["stopped", "failed", "completed"].includes(settled.state)) break;
    await sleep(100);
  }
  const before = String(settled?.output ?? "").length;
  await sleep(800);
  const after = ((await opened.api.state()).tasks ?? []).find((row) => row.id === longId);
  report.stop = { sawRunning, state: settled?.state ?? null, ackMs: Math.round(performance.now() - t0), outputGrew: String(after?.output ?? "").length > before };
} finally { await opened.host.close(); }
report.finishedAt = new Date().toISOString();
save();
process.stdout.write("MEASURE DONE\n");
process.exit(0);
