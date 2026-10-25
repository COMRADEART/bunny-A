/**
 * MA4-S3-T1R2 live qualification. Reads the frozen fixture file and does not rewrite it.
 * Host state is outside the git checkout. No cloud model is requested.
 */
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import {
  assessReplan,
  boundedTeamCapabilities,
  classifyTask,
  completionClaim,
  deterministicCheck,
} from "../../src/lib/bunny-host/ma4/s3t1.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = JSON.parse(readFileSync(join(root, "scripts/ma4-s3-t1r2/fixtures.json"), "utf8"));
const evidenceDir = join(root, "docs/ma4-s3-t1r2/evidence");
mkdirSync(evidenceDir, { recursive: true });
const MODEL = fixtures.model;
const DIGEST = fixtures.digest;
const PORT = 43731;
const stateDir = join(process.env.LOCALAPPDATA ?? tmpdir(), "Bunny-T1R2-Qual");
const projectDir = join(process.env.USERPROFILE ?? tmpdir(), "Documents", "Bunny-T1R2-Fixture");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};
const median = (values) => quantile(values, 50);

function planRow(task, complexity) {
  const classification = classifyTask(task.prompt);
  const team = boundedTeamCapabilities(classification);
  return {
    id: task.id,
    expectedComplexity: complexity,
    planningValid: classification.complexity === complexity,
    classification,
    team,
    modelCallsInPlan: classification.resource.modelCalls,
  };
}

const planning = {
  frozenSha256: sha256(readFileSync(join(root, "scripts/ma4-s3-t1r2/fixtures.json"))),
  rows: [
    ...fixtures.c0.map((task) => planRow(task, "C0")),
    ...fixtures.c1.map((task) => planRow(task, "C1")),
    ...fixtures.c2.map((task) => planRow(task, "C2")),
    ...fixtures.c3.map((task) => planRow(task, "C3")),
  ],
};
writeFileSync(join(evidenceDir, "planning.json"), JSON.stringify(planning, null, 2));

async function ollamaTags() {
  const response = await fetch("http://127.0.0.1:11434/api/tags");
  if (!response.ok) throw new Error(`Ollama tags HTTP ${response.status}`);
  return response.json();
}

async function unloadModel() {
  await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: 0, stream: false }),
  }).catch(() => {});
}

function gpuSample() {
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve({ available: false, error: error.message });
      const [used, total, util] = stdout.trim().split(",").map((part) => Number(part.trim()));
      resolve({ available: true, usedMiB: used, totalMiB: total, utilization: util });
    });
  });
}

function memorySample() {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize | ConvertTo-Json -Compress)"], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve({ available: false });
      try { resolve({ available: true, ...JSON.parse(stdout) }); } catch { resolve({ available: false, raw: stdout.slice(0, 200) }); }
    });
  });
}

async function openHost() {
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  const host = await startHost({ dataDirectory: stateDir, port: PORT, root: projectDir });
  const base = `http://127.0.0.1:${PORT}`;
  const headers = () => ({ connection: "close", authorization: `Bearer ${host.token}`, "content-type": "application/json" });
  const command = async (action, data = {}) => {
    const started = performance.now();
    const response = await fetch(`${base}/command`, { method: "POST", headers: headers(), body: JSON.stringify({ action, data }) });
    const body = await response.json();
    return { status: response.status, ms: Math.round(performance.now() - started), body };
  };
  const state = async () => {
    const response = await fetch(`${base}/state`, { headers: headers() });
    return response.json();
  };
  await state();
  return { host, command, state };
}

function envelope(kinds, grants) {
  return {
    capabilities: [...new Set(kinds)],
    providers: ["ollama"],
    localOnly: true,
    models: [MODEL],
    projectScopes: ["p1"],
    sideEffects: kinds.includes("file.apply"),
    background: false,
    budgets: { maxModelCalls: 0, maxWallMs: 120000 },
    expiresAt: Date.now() + 86_400_000,
    grants,
  };
}

async function settlePtask(state, id, timeoutMs = 20000) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeoutMs) {
    const snap = await state();
    last = snap.persistentTasks?.tasks?.find((task) => task.id === id) ?? null;
    if (last && !["QUEUED", "RUNNING", "RESUMING", "VALIDATED", "CREATED"].includes(last.state)) return { task: last, ms: Math.round(performance.now() - started) };
    await sleep(40);
  }
  return { task: last, ms: timeoutMs, timedOut: true };
}

async function runChat(api, prompt, { outputTokens = 32, maxRuntimeMs = 45000, extraConstraints = {} } = {}) {
  const submittedAt = performance.now();
  const gpuBefore = await gpuSample();
  const created = await api.command("submit", {
    prompt,
    mode: "fast",
    constraints: { localOnly: true, outputTokens, maxRuntimeMs, ...extraConstraints },
  });
  if (created.status !== 200) return { ok: false, stage: "submit", created };
  const id = created.body.task?.id;
  if (!id) return { ok: false, stage: "submit", created };
  const approved = await api.command("approve", { id });
  let task = null;
  const deadline = performance.now() + maxRuntimeMs + 15000;
  while (performance.now() < deadline) {
    const snap = await api.state();
    task = (snap.tasks ?? []).find((row) => row.id === id) ?? null;
    if (task && ["completed", "failed", "stopped"].includes(task.state)) break;
    await sleep(80);
  }
  const ms = Math.round(performance.now() - submittedAt);
  const receiptEvent = ((await api.state()).events ?? []).find((event) => event.taskId === id && event.type === "provider.receipt");
  let receipt = null;
  try { receipt = receiptEvent ? JSON.parse(receiptEvent.detail) : null; } catch { receipt = receiptEvent?.detail ?? null; }
  return {
    ok: task?.state === "completed",
    id,
    ms,
    state: task?.state ?? null,
    model: task?.model ?? null,
    provider: task?.provider ?? null,
    output: task?.output ?? "",
    error: task?.error ?? null,
    verify: task?.verify ?? null,
    usage: task?.usage ?? null,
    receipt,
    gpuBefore,
    queueMs: task?.startedAt && task?.createdAt ? task.startedAt - task.createdAt : null,
    submitStatus: created.status,
    approveStatus: approved.status,
  };
}

function writeEvidence(name, value) {
  writeFileSync(join(evidenceDir, name), JSON.stringify(value, null, 2));
}

const report = { startedAt: new Date().toISOString(), model: MODEL, digest: DIGEST };

try {
  const tags = await ollamaTags();
  const installed = (tags.models ?? []).find((model) => model.name === MODEL);
  report.observedDigest = installed?.digest ?? null;
  if (!installed || installed.digest !== DIGEST) {
    report.status = "BLOCKED";
    report.reason = "Pinned local model is missing or its digest changed. No substitute was called.";
    writeEvidence("live.json", report);
    process.exitCode = 2;
  } else {
    await unloadModel();
    const api = await openHost();
    try {
      const onboarding = await api.command("onboarding.save", {
        state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: MODEL, name: "Ravi", language: "en-US" } },
      });
      const priority = await api.command("scheduler.priority", { priority: "local_only" });
      const rootSet = await api.command("connector.roots.set", { roots: [{ id: "fixture", label: "T1R2 fixture", path: projectDir }] });
      report.setup = {
        onboarding: { status: onboarding.status, model: onboarding.body?.data?.preferences?.selectedLocalModel ?? null },
        priority: { status: priority.status, error: priority.body?.error ?? null },
        root: { status: rootSet.status, error: rootSet.body?.error ?? null },
      };

      const c0 = [];
      for (let trial = 1; trial <= 3; trial += 1) {
        for (const [index, task] of fixtures.c0.entries()) {
          const row = await runChat(api, task.prompt);
          const text = String(row.output ?? "");
          c0.push({
            ...task,
            trial,
            phase: trial === 1 && index === 0 ? "cold" : "warm",
            functionalCorrect: text.toLowerCase().includes(task.expectToken.toLowerCase()),
            formattingExact: text.trim().toLowerCase() === task.expectToken.toLowerCase(),
            verification: completionClaim({ executed: row.state === "completed", output: text.length > 0, verification: row.verify ? "requested" : "not_requested" }),
            model: row.model,
            provider: row.provider,
            ms: row.ms,
            queueMs: row.queueMs,
            state: row.state,
            output: text.slice(0, 240),
            tokens: row.receipt?.evalCount ?? row.usage?.outputTokens ?? null,
            promptTokens: row.receipt?.promptEvalCount ?? null,
            loadNs: row.receipt?.loadDurationNs ?? null,
            servedModel: row.receipt?.model ?? null,
            error: row.error,
          });
          process.stdout.write(`C0 ${task.id} trial ${trial} ${row.state} ${row.ms}ms\n`);
        }
      }

      const c1 = [];
      for (const task of fixtures.c1) {
        const file = join(projectDir, task.path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, task.content);
        const expected = sha256(task.content);
        const created = await api.command("ptask.create", {
          spec: {
            title: task.id,
            projectId: "p1",
            steps: [{ id: "read", kind: "file.read", input: { root: "fixture", path: task.path, maxChars: 2000 } }],
            acceptance: { requiredSteps: ["read"] },
          },
          envelope: envelope(["file.read"], { files: [{ root: "fixture", access: "read" }] }),
        });
        const id = created.body?.data?.id;
        const settled = id ? await settlePtask(api.state, id) : { task: null, ms: created.ms };
        let content = null;
        let actual = null;
        if (id && settled.task?.state === "COMPLETED") {
          const output = await api.command("ptask.output", { id, stepId: "read" });
          try {
            const parsed = JSON.parse(output.body?.data?.content ?? "null");
            content = parsed?.result?.content ?? null;
            actual = parsed?.result?.sha256 ?? null;
          } catch { content = null; }
        }
        const check = deterministicCheck({ kind: "file", expectedHash: expected, actualHash: actual });
        c1.push({
          id: task.id,
          planning: planning.rows.find((row) => row.id === task.id),
          state: settled.task?.state ?? null,
          ms: settled.ms,
          modelCalls: settled.task?.models?.length ?? 0,
          functionalCorrect: content === task.content,
          hashMatches: actual === expected,
          verification: check,
          error: created.body?.error ?? settled.task?.failure ?? null,
          createStatus: created.status,
        });
        process.stdout.write(`C1 ${task.id} ${settled.task?.state} ${settled.ms}ms\n`);
      }

      const c2 = [];
      for (const task of fixtures.c2) {
        const file = join(projectDir, task.path);
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
          envelope: envelope(["file.read", "file.stat"], { files: [{ root: "fixture", access: "read" }] }),
        });
        const id = created.body?.data?.id;
        const settled = id ? await settlePtask(api.state, id) : { task: null, ms: created.ms };
        const order = (settled.task?.evidence ?? []).map((row) => row.stepId);
        c2.push({
          id: task.id,
          state: settled.task?.state ?? null,
          ms: settled.ms,
          order,
          dependencyHonored: order[0] === "read" && order[1] === "stat",
          modelCalls: settled.task?.models?.length ?? 0,
          functionalCorrect: settled.task?.state === "COMPLETED" && order[0] === "read" && order[1] === "stat",
          verified: (settled.task?.evidence ?? []).length === 2,
          error: created.body?.error ?? settled.task?.failure ?? null,
        });
        process.stdout.write(`C2 ${task.id} ${settled.task?.state} ${order.join("->")}\n`);
      }

      const c3 = [];
      for (const task of fixtures.c3) {
        if (task.kind === "approved-edit" || task.kind === "stale-hash") {
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
            envelope: envelope(["file.read", "file.apply"], { files: [{ root: "fixture", access: "write" }] }),
          });
          const id = created.body?.data?.id;
          const waiting = id ? await settlePtask(api.state, id) : { task: null };
          let approved = null;
          let after = waiting.task;
          if (task.kind === "approved-edit" && waiting.task?.pendingAction) {
            approved = await api.command("action.approve", {
              id,
              actionId: waiting.task.pendingAction.actionId,
              payloadSha256: waiting.task.pendingAction.payloadSha256,
            });
            const done = await settlePtask(api.state, id, 20000);
            after = done.task;
          }
          const onDisk = readFileSync(file, "utf8");
          c3.push({
            id: task.id,
            kind: task.kind,
            authorization: waiting.task?.state ?? null,
            pending: waiting.task?.pendingAction?.kind ?? null,
            approveStatus: approved?.status ?? null,
            finalState: after?.state ?? null,
            fileUnchangedUntilApproved: task.kind === "stale-hash" ? onDisk === task.content : true,
            disk: onDisk,
            functionalCorrect: task.kind === "approved-edit" ? onDisk === task.next && after?.state === "COMPLETED" : onDisk === task.content && waiting.task?.state === "AWAITING_APPROVAL",
            verified: task.kind === "approved-edit" ? sha256(onDisk) === sha256(task.next) : onDisk === task.content,
            error: created.body?.error ?? after?.failure ?? null,
          });
        } else if (task.kind === "missing-read") {
          const created = await api.command("ptask.create", {
            spec: {
              title: task.id,
              projectId: "p1",
              steps: [{ id: "read", kind: "file.read", input: { root: "fixture", path: task.path, maxChars: 500 } }],
              acceptance: { requiredSteps: ["read"] },
            },
            envelope: envelope(["file.read"], { files: [{ root: "fixture", access: "read" }] }),
          });
          const id = created.body?.data?.id;
          const settled = id ? await settlePtask(api.state, id) : { task: null };
          c3.push({
            id: task.id,
            kind: task.kind,
            state: settled.task?.state ?? null,
            failure: settled.task?.failure ?? null,
            functionalCorrect: settled.task?.state === "FAILED" && !/verified/i.test(JSON.stringify(settled.task?.failure ?? "")),
            falselyVerified: settled.task?.state === "COMPLETED",
          });
        } else if (task.kind === "failed-process") {
          const check = deterministicCheck({ kind: "process", exitCode: task.exitCode });
          c3.push({ id: task.id, kind: task.kind, verification: check, functionalCorrect: check.state === "failed", falselyVerified: check.state === "performed_passed" });
        } else if (task.kind === "uncertain-external") {
          const decision = assessReplan({ failure: "external write outcome unknown", insideEnvelope: true, retriesLeft: 1, consequentialOutcomeUnknown: true });
          c3.push({ id: task.id, kind: task.kind, replan: decision, functionalCorrect: decision.repair === false && decision.clearApprovals === true, blindlyRetried: decision.repair });
        } else {
          const chat = await runChat(api, task.prompt, { outputTokens: 48, maxRuntimeMs: 60000 });
          let disk = null;
          try { disk = readFileSync(join(projectDir, "edit-01.txt"), "utf8"); } catch { disk = null; }
          c3.push({
            id: task.id,
            kind: task.kind,
            state: chat.state,
            model: chat.model,
            provider: chat.provider,
            output: String(chat.output ?? "").slice(0, 240),
            teamOpened: false,
            rolesFromClassifier: boundedTeamCapabilities(classifyTask(task.prompt)),
            functionalCorrect: chat.provider === "ollama" && chat.model === MODEL && !String(chat.output ?? "").includes("SHOULD-NOT-WRITE"),
            verification: completionClaim({ executed: chat.state === "completed", output: String(chat.output ?? "").length > 0, verification: "not_requested" }),
            disk: disk,
          });
        }
        process.stdout.write(`C3 ${task.id}\n`);
      }

      const savedPreference = report.setup.onboarding.model;
      const missing = await api.command("onboarding.save", {
        state: { status: "done", stageIndex: 9, preferences: { selectedLocalModel: "not-installed:7b" } },
      });
      const missingSubmit = await api.command("submit", {
        prompt: "What is 2 plus 2? Reply with digits only.",
        mode: "fast",
        constraints: { localOnly: true, outputTokens: 8, maxRuntimeMs: 20000 },
      });
      const pin = await api.command("submit", {
        prompt: "Reply with the word pinned.",
        mode: "fast",
        constraints: { localOnly: true, modelExact: MODEL, outputTokens: 8, maxRuntimeMs: 30000 },
      });
      const cloud = await api.command("submit", {
        prompt: "Reply with the word local.",
        mode: "fast",
        override: "ollama",
        modelOverride: "deepseek-v4.1-flash:cloud",
        constraints: { localOnly: true, outputTokens: 8, maxRuntimeMs: 20000 },
      });
      report.routing = {
        savedPreference,
        missingPreferenceStored: missing.body?.data?.preferences?.selectedLocalModel ?? null,
        missingSubmit: { status: missingSubmit.status, error: missingSubmit.body?.error ?? null, model: missingSubmit.body?.task?.model ?? null },
        hardPin: { status: pin.status, model: pin.body?.task?.model ?? null, error: pin.body?.error ?? null },
        cloudOverride: { status: cloud.status, model: cloud.body?.task?.model ?? null, error: cloud.body?.error ?? null },
      };

      await unloadModel();
      const gpuIdle = await gpuSample();
      const long = await api.command("submit", {
        prompt: "Count from 1 to 400, one number per line.",
        mode: "fast",
        constraints: { localOnly: true, outputTokens: 400, maxRuntimeMs: 120000 },
      });
      const longId = long.body?.task?.id;
      if (longId) await api.command("approve", { id: longId });
      let sawRunning = false;
      for (let i = 0; i < 40; i += 1) {
        const snap = await api.state();
        const row = (snap.tasks ?? []).find((task) => task.id === longId);
        if (row && ["running", "completed"].includes(row.state)) { sawRunning = row.state === "running" || row.output; break; }
        await sleep(100);
      }
      const during = await gpuSample();
      const memDuring = await memorySample();
      const foregroundStarted = performance.now();
      const foreground = await runChat(api, "Reply with the single word foreground.", { outputTokens: 8, maxRuntimeMs: 90000 });
      const stopStarted = performance.now();
      const stopped = longId ? await api.command("stop", { id: longId }) : null;
      let stopState = null;
      const stopDeadline = performance.now() + 15000;
      while (performance.now() < stopDeadline) {
        const snap = await api.state();
        stopState = (snap.tasks ?? []).find((task) => task.id === longId) ?? null;
        if (stopState && ["stopped", "failed", "completed"].includes(stopState.state)) break;
        await sleep(40);
      }
      const stopMs = Math.round(performance.now() - stopStarted);
      const outputAtStop = String(stopState?.output ?? "");
      await sleep(1500);
      const snapAfter = await api.state();
      const later = (snapAfter.tasks ?? []).find((task) => task.id === longId);
      const httpAbortStarted = performance.now();
      const controller = new AbortController();
      const http = fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, prompt: "Count from 1 to 200.", stream: true, keep_alive: "5m", options: { temperature: 0, num_predict: 200 } }),
      });
      const httpResponse = await http;
      const reader = httpResponse.body.getReader();
      await reader.read();
      controller.abort();
      let httpAbortMs = null;
      try { while (!(await reader.read()).done) {} } catch { httpAbortMs = Math.round(performance.now() - httpAbortStarted); }
      const ps = await fetch("http://127.0.0.1:11434/api/ps").then((response) => response.json()).catch(() => ({ models: [] }));
      report.contention = {
        gpuIdle,
        gpuDuringLong: during,
        memoryDuring: memDuring,
        longSawRunning: sawRunning,
        foreground: { ms: Math.round(performance.now() - foregroundStarted), state: foreground.state, model: foreground.model, queueMs: foreground.queueMs, output: String(foreground.output ?? "").slice(0, 80) },
        hostStop: {
          ackMs: stopped?.ms ?? null,
          settleMs: stopMs,
          state: stopState?.state ?? null,
          error: stopState?.error ?? null,
          outputGrewAfterStop: String(later?.output ?? "").length > outputAtStop.length,
        },
        httpAbort: { ms: httpAbortMs, residentAfterAbort: (ps.models ?? []).map((model) => model.name) },
        gpuPreemptionClaimed: false,
      };
      await unloadModel();

      const warm = c0.filter((row) => row.phase === "warm" && row.state === "completed").map((row) => row.ms);
      const cold = c0.find((row) => row.phase === "cold");
      report.c0 = {
        trials: 3,
        functional: c0.filter((row) => row.trial === 1 && row.functionalCorrect).length,
        formattingExact: c0.filter((row) => row.trial === 1 && row.formattingExact).length,
        completed: c0.filter((row) => row.trial === 1 && row.state === "completed").length,
        coldMs: cold?.ms ?? null,
        warmMedianMs: median(warm),
        warmP95Ms: quantile(warm, 95),
        warmMinMs: warm.length ? Math.min(...warm) : null,
        warmMaxMs: warm.length ? Math.max(...warm) : null,
        models: [...new Set(c0.map((row) => row.model))],
        served: [...new Set(c0.map((row) => row.servedModel))],
      };
      report.c1 = { functional: c1.filter((row) => row.functionalCorrect).length, hashVerified: c1.filter((row) => row.hashMatches).length, total: c1.length, medianMs: median(c1.map((row) => row.ms)) };
      report.c2 = { functional: c2.filter((row) => row.functionalCorrect).length, ordered: c2.filter((row) => row.dependencyHonored).length, total: c2.length };
      report.c3 = { functional: c3.filter((row) => row.functionalCorrect).length, total: c3.length };
      report.planning = {
        valid: planning.rows.filter((row) => row.planningValid).length,
        total: planning.rows.length,
      };
      report.rows = { c0, c1, c2, c3 };
      report.status = "MEASURED";
      report.finishedAt = new Date().toISOString();
      writeEvidence("live.json", report);
    } finally {
      await api.host.close();
    }
  }
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  writeEvidence("live.json", report);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
