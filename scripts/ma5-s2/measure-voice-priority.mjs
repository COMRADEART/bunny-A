// MA5-S2 Phase 4 (P4-2): spoken-question latency under a fixed background agent workload, and that workload's throughput
// and fairness. The same file runs against the previous code (main, Ollama's own FIFO) and the Phase 4 code (Bunny's
// class-aware local queue), so the two passes see the same workload. A disposable real Host (Ollama adapter only, the
// router's local model) and the real contained voice worker with test-only fixture flags (--input-silence,
// --output null): no microphone or speaker is opened. Every number is a Host or provider receipt, not an acoustic one.
// Background load: BG_INFLIGHT agent-style generations kept in flight at all times through the canonical manager task
// path (submit -> approve -> Ollama adapter -> execute), the path agent steps use. Voice: N_TURNS typed questions on a
// fixed schedule, each allowed to finish (no barge-in).
// Usage: EVIDENCE_NAME=voice-priority-<label>.json node --experimental-strip-types scripts/ma5-s2/measure-voice-priority.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43206);
const N_TURNS = Number(process.env.N_TURNS ?? 12);
const BG_INFLIGHT = Number(process.env.BG_INFLIGHT ?? 2);
const BG_TOKENS = Number(process.env.BG_TOKENS ?? 200);
const GAP_MS = Number(process.env.GAP_MS ?? 3_000);
const Q = "In one short sentence, what does a rabbit eat?";
// Neutral prose: the router must not infer filesystem or tool needs, so every request stays a plain local generation.
const TOPICS = ["how tides work", "why leaves change colour", "how bees make honey", "how a lighthouse works", "why the sky is blue", "how bridges carry load", "the water cycle", "how owls hunt at night"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const workerCount = () => (spawnSync("tasklist", ["/FI", "IMAGENAME eq bunny-voice-worker.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout.match(/bunny-voice-worker\.exe/gi) ?? []).length;
const gpuMiB = () => { const r = spawnSync("nvidia-smi", ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8" }); const [u, t] = (r.stdout ?? "").split(",").map((x) => Number(x)); return Number.isFinite(u) ? { used: u, total: t } : null; };
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: null, p95: null, min: null, max: null, mean: null };
  const at = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  return { n: v.length, p50: at(50), p95: at(95), min: v[0], max: v.at(-1), mean: Math.round(v.reduce((s, x) => s + x, 0) / v.length) };
}
const gap = (a, b) => (typeof a === "number" && typeof b === "number" && b >= a ? b - a : null);
async function until(what, fn, ms = 300_000, every = 25) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}

assert.equal(workerCount(), 0, "Close every running bunny-voice-worker.exe first.");
const queue = await import("../../src/lib/orch/local-inference.ts").then((m) => m.localInference).catch(() => null);
const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-p4-priority-"));
const results = {
  schema: "ma5-s2-p4.voice-priority/1", at: new Date().toISOString(),
  scheduling: queue ? "Phase 4: Bunny local queue (1 slot, voice first, no pre-emption, starvation bound 3)" : "previous: no Bunny queue; Ollama FIFO",
  workload: { voiceTurns: N_TURNS, question: Q, backgroundInFlight: BG_INFLIGHT, backgroundOutputTokens: BG_TOKENS, gapAfterTurnMs: GAP_MS, path: "manager.submit -> approve -> Ollama adapter -> execute (local-only)" },
  boundaries: "Turn clock starts at the Host's receipt of the typed question (activatedAt). firstAudible = first playback.started of any chunk (the delay acknowledgment counts); firstAnswerAudio = the answer's own first chunk. Null sink: no device latency.",
};
let failure = null;
let host = null;
let stopLoad = false;
const bg = [];
const gpu = [];
try {
  host = await startHost({ port: PORT, dataDirectory, adapters: defaultAdapters().filter((a) => a.id === "ollama"), voice: { workerExtraArgs: ["--input-silence", "--output", "null"] } });
  await host.manager.discover();
  const cmd = async (action, data = {}) => {
    const res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
    const body = await res.json().catch(() => ({}));
    assert.ok(res.ok, `${action}: ${body.error ?? res.status}`);
    return body;
  };
  const voice = async () => { const b = await cmd("voice.state"); return b.voice ?? b.data; };

  // One background "agent step": a bounded local generation on the canonical task path.
  let n = 0;
  const runBackground = () => new Promise((resolve, reject) => {
    const i = n++;
    const row = { i, submittedAt: Date.now(), firstOutputAt: null, doneAt: null, state: null, model: null };
    bg.push(row);
    let task;
    try {
      task = host.manager.submit({ prompt: `Write a ${Math.round(BG_TOKENS * 0.6)}-word explanation of ${TOPICS[i % TOPICS.length]}.`, mode: "fast", override: "auto", constraints: { localOnly: true, offlineOnly: true, outputTokens: BG_TOKENS } });
    } catch (e) { reject(e); return; }
    row.model = task.model;
    host.manager.onTaskOutput(task.id, (e) => {
      if ("text" in e) row.firstOutputAt ??= Date.now();
      else { row.doneAt = Date.now(); row.state = e.state; resolve(row); }
    });
    if (task.state === "waiting_for_approval") host.manager.approve(task.id);
  });
  const lane = async () => { while (!stopLoad) await runBackground(); };

  await cmd("voice.session.open", { mode: "push_to_talk" });
  await until("voice open", async () => (await voice()).open);
  const ask = async (label) => {
    const before = (await voice()).turnId;
    await cmd("voice.text", { text: Q });
    const s = await until(`turn ${label} complete`, async () => { const v = await voice(); return v.turnId !== before && v.timing?.completedAt && ["IDLE", "INTERRUPTED"].includes(v.state) ? v : null; }, 300_000, 25);
    const t = s.timing;
    const audible = [t.firstPlaybackAt, t.delayAckPlaybackAt].filter((x) => typeof x === "number");
    return {
      label, answerSource: s.answerSource, route: s.route ? { provider: s.route.provider, model: s.route.model } : null,
      firstTokenMs: gap(t.activatedAt, t.firstTokenAt), firstAudibleMs: gap(t.activatedAt, audible.length ? Math.min(...audible) : null),
      firstAnswerAudioMs: gap(t.activatedAt, t.firstPlaybackAt), completedMs: gap(t.activatedAt, t.completedAt),
      delayAck: t.delayAckAt ? { sentMs: gap(t.activatedAt, t.delayAckAt), audibleMs: gap(t.activatedAt, t.delayAckPlaybackAt) } : null,
      answer: s.answer ?? null,
    };
  };

  log("warm-up (model load, idle Host)");
  results.idle = await ask("idle-warm");
  results.idleSecond = await ask("idle");

  log(`background load x${BG_INFLIGHT}`);
  let laneError = null;
  const lanes = Array.from({ length: BG_INFLIGHT }, () => lane().catch((e) => { laneError = e; stopLoad = true; }));
  const gpuTimer = setInterval(() => { const g = gpuMiB(); if (g) gpu.push(g.used); }, 2_000);
  await until("background generating", async () => bg.some((r) => r.firstOutputAt), 120_000, 100);
  const loadStart = Date.now();
  const turns = [];
  for (let i = 0; i < N_TURNS; i++) {
    if (laneError) throw laneError;
    turns.push(await ask(`load-${i}`));
    log(`turn ${i}: firstAudible ${turns.at(-1).firstAudibleMs} answer ${turns.at(-1).firstAnswerAudioMs} done ${turns.at(-1).completedMs}`);
    await sleep(GAP_MS);
  }
  const loadEnd = Date.now();
  stopLoad = true;
  await Promise.all(lanes);
  clearInterval(gpuTimer);
  if (laneError) throw laneError;

  const inWindow = bg.filter((r) => r.doneAt && r.doneAt >= loadStart && r.doneAt <= loadEnd);
  results.underLoad = {
    turns, modelRoutedTurns: turns.filter((t) => t.route).length,
    firstTokenMs: stats(turns.map((t) => t.firstTokenMs)), firstAudibleMs: stats(turns.map((t) => t.firstAudibleMs)),
    firstAnswerAudioMs: stats(turns.map((t) => t.firstAnswerAudioMs)), completedMs: stats(turns.map((t) => t.completedMs)),
    delayAcks: turns.filter((t) => t.delayAck).length,
  };
  results.background = {
    submitted: bg.length, completed: bg.filter((r) => r.state === "completed").length, notCompleted: bg.filter((r) => r.state !== "completed").map((r) => ({ i: r.i, state: r.state })),
    windowMs: loadEnd - loadStart, completedInWindow: inWindow.length, perMinute: Math.round((inWindow.length / ((loadEnd - loadStart) / 60_000)) * 100) / 100,
    submitToFirstOutputMs: stats(bg.map((r) => gap(r.submittedAt, r.firstOutputAt))), submitToDoneMs: stats(bg.map((r) => gap(r.submittedAt, r.doneAt))),
  };
  results.gpuMemoryMiB = { samples: gpu.length, max: gpu.length ? Math.max(...gpu) : null, total: gpuMiB()?.total ?? null };
  if (queue) {
    const recent = queue.recent();
    results.queue = { stats: queue.stats(), interactiveAdmissions: recent.filter((a) => a.cls === "interactive").map((a) => ({ aheadAtEnqueue: a.aheadAtEnqueue, queuedMs: a.queuedMs })), backgroundQueuedMs: stats(recent.filter((a) => a.cls === "background").map((a) => a.queuedMs)), starvationOverrides: queue.stats().admitted.starvationOverrides };
  }
  assert.equal(results.background.notCompleted.length, 0, "every background generation completes; voice never cancels one");
  await cmd("voice.session.close", { source: "e2e" });
  await until("worker exited", async () => workerCount() === 0, 15_000, 100);
} catch (e) {
  failure = String(e?.stack ?? e).slice(0, 2000);
  log(`FAILED: ${failure}`);
} finally {
  stopLoad = true;
  results.failure = failure;
  if (host) { try { await host.close(); } catch { /* closed */ } }
  await sleep(1_000);
  results.workersAfterShutdown = workerCount();
  try { mkdirSync("docs/ma5-s2/evidence/voice", { recursive: true }); writeEvidence(join(process.env.EVIDENCE_DIR ?? "docs/ma5-s2/evidence/voice", process.env.EVIDENCE_NAME ?? "voice-priority.json"), results, host ? [host.token] : []); } catch (e) { log(`evidence not written: ${e.message}`); }
  rmSync(dataDirectory, { recursive: true, force: true });
  const u = results.underLoad;
  log(JSON.stringify({ scheduling: results.scheduling, firstAudible: u?.firstAudibleMs, answer: u?.firstAnswerAudioMs, completed: u?.completedMs, bgPerMin: results.background?.perMinute, bgWait: results.background?.submitToFirstOutputMs, workers: results.workersAfterShutdown }));
  process.exit(failure ? 1 : 0);
}
