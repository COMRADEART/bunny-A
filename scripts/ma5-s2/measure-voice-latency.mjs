// MA5-S2 Phase 3: software latency, barge-in and concurrency measurements of the voice pipeline on this machine.
// Disposable real Hosts (Ollama adapter only, real local model) drive the real contained voice worker with test-only
// fixture flags: --input-silence / --input-synth (no microphone is opened) and --output null (a real-time null sink;
// nothing is audible). Every number is a Host or worker receipt; none is an acoustic measurement at a speaker or microphone.
// Usage: node --experimental-strip-types scripts/ma5-s2/measure-voice-latency.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { launchVoiceWorker, selectSpeechEngine } from "../../src/lib/bunny-host/voice/voice-worker.server.ts";
import { voiceStageTrace } from "../../src/lib/bunny-host/voice/voice-stages.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43196);
const N_WARM = Number(process.env.N_WARM ?? 10);
const N_LOAD = Number(process.env.N_LOAD ?? 6);
const N_BARGE = Number(process.env.N_BARGE ?? 30);
const N_STT = Number(process.env.N_STT ?? 5);
const N_E2E = Number(process.env.N_E2E ?? 5);
const EVIDENCE = "docs/ma5-s2/evidence/voice";
const OLLAMA = "http://127.0.0.1:11434";
const Q = "In one short sentence, what does a rabbit eat?";
const OVER = ["completed", "failed", "stopped"];
mkdirSync(EVIDENCE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const tasklist = () => spawnSync("tasklist", ["/FI", "IMAGENAME eq bunny-voice-worker.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
const workerCount = () => (tasklist().match(/bunny-voice-worker\.exe/gi) ?? []).length;
const workerMemoryKb = () => { const m = tasklist().match(/"([\d,.]+) K"/); return m ? Number(m[1].replace(/[,.]/g, "")) : null; };
/** Nearest-rank percentiles; null when there is no sample. */
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: null, p95: null, min: null, max: null };
  const at = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  const r = (x) => Math.round(x * 10) / 10;
  return { n: v.length, p50: r(at(50)), p95: r(at(95)), min: r(v[0]), max: r(v.at(-1)) };
}
const gap = (a, b) => (typeof a === "number" && typeof b === "number" && b >= a ? b - a : null);
const STAGES = ["finalToAdmitted", "admittedToFirstToken", "firstTokenToFirstTts", "firstTtsToPlayback", "admittedToInferenceDone", "speechEndToFinal", "speechEndToFirstPlayback"];
const summarize = (rows) => Object.fromEntries([...STAGES.map((k) => [k, stats(rows.map((r) => r.stages[k]))]), ["admittedToFirstPlayback", stats(rows.map((r) => r.admittedToFirstPlayback))], ["receiptToFirstPlayback", stats(rows.map((r) => r.receiptToFirstPlayback))]]);

assert.equal(workerCount(), 0, "Close every running bunny-voice-worker.exe first.");
mkdirSync("test-results/ma5-s2", { recursive: true });
const project = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "voice-load-"));
mkdirSync(join(project, "data"));
writeFileSync(join(project, "data", "inventory.csv"), "name,count\nWidgets,12\nGadgets,3\nSprockets,7\n");
const dirs = [project];
const scrub = (v) => JSON.parse(JSON.stringify(v ?? null).split(JSON.stringify(project).slice(1, -1)).join("<project>"));

async function makeHost(port, workerExtraArgs) {
  const dataDirectory = mkdtempSync(join(tmpdir(), "bunny-host-ma5s2-latency-"));
  dirs.push(dataDirectory);
  const host = await startHost({ port, dataDirectory, adapters: defaultAdapters().filter((a) => a.id === "ollama"), voice: { workerExtraArgs } });
  await host.manager.discover();
  const cmd = async (action, data = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
    const body = await res.json().catch(() => ({}));
    assert.ok(res.ok, `${action}: ${body.error ?? res.status}`);
    return body;
  };
  const voice = async () => { const b = await cmd("voice.state"); return b.voice ?? b.data; };
  return { host, cmd, voice };
}
async function until(what, fn, ms = 120_000, every = 25) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}
async function unloadModels() {
  const ps = await (await fetch(`${OLLAMA}/api/ps`)).json().catch(() => ({ models: [] }));
  for (const m of ps.models ?? []) await fetch(`${OLLAMA}/api/generate`, { method: "POST", body: JSON.stringify({ model: m.name, keep_alive: 0 }) }).catch(() => {});
  await until("models unloaded", async () => ((await (await fetch(`${OLLAMA}/api/ps`)).json()).models ?? []).length === 0, 60_000, 500);
}
const settled = (s) => s.open && ["IDLE", "INTERRUPTED", "MUTED"].includes(s.state) && !s.playing;

/**
 * One turn on the real Host path (classify -> Host facts or local model -> chunker -> TTS -> null-sink playback).
 * `start` begins it (typed text, or a push-to-talk VAD capture of the synthesized fixture phrase). With `barge`, the turn is
 * interrupted as soon as the Host confirms playback; the worker's cancel receipt is read once the Host has recorded it.
 */
async function turn(h, start, { barge = false, timeoutMs = 180_000, label = "" } = {}) {
  const before = (await h.voice()).turnId;
  const sentAt = Date.now();
  await start();
  const snap = await until(`turn ${label} reached playback`, async () => {
    const s = await h.voice();
    return s.turnId !== before && s.turnId && (s.timing?.firstPlaybackAt || s.timing?.completedAt || s.state === "ERROR") ? s : null;
  }, timeoutMs);
  const row = { label, turnKind: snap.turnKind, answerSource: snap.answerSource, transcript: snap.finalTranscript, route: snap.route ? { provider: snap.route.provider, model: snap.route.model } : null };
  if (barge && snap.playing) {
    const t = performance.now();
    await h.cmd("voice.interrupt", { source: "button" });
    row.interruptHttpMs = Math.round((performance.now() - t) * 10) / 10;
    row.interrupt = (await until("cancel receipt", async () => { const s = await h.voice(); const r = s.lastInterrupt; return r?.turnId === snap.turnId && r.workerCancelWaitMs != null ? r : null; }, 10_000)) ?? null;
  }
  const done = await until("turn settled", async () => { const s = await h.voice(); return settled(s) && (barge || s.timing?.completedAt) ? s : null; }, timeoutMs, 50);
  const timing = done.timing?.turnId === snap.timing?.turnId ? done.timing : snap.timing;
  row.timing = timing;
  row.stages = Object.fromEntries(voiceStageTrace(timing).map((s) => [s.stage, s.ms]));
  row.admittedToFirstPlayback = gap(timing?.admittedAt, timing?.firstPlaybackAt);
  // A typed turn starts when the Host receives the text (activatedAt); its answer path is the same as a spoken final's.
  row.receiptToFirstPlayback = gap(timing?.activatedAt ?? sentAt, timing?.firstPlaybackAt);
  return row;
}

const results = { schema: "ma5-s2.voice-latency.v2", at: new Date().toISOString(), boundaries: {
  measured: "Host receipt stamps (VoiceTiming: Host epoch ms) and worker receipts (speak.cancelled wait). Playback start is the worker's playback.started for the null sink.",
  notMeasured: "Microphone-to-worker capture delay, speaker output latency and audible silence. The null sink has no render endpoint, so meterSilentMs is null by design. speechEndAt is the Host receipt of the VAD speech_end event, which the worker emits after its 900 ms endpoint silence.",
}, sections: {} };
let failure = null;
const hosts = [];
try {
  const a = await makeHost(PORT, ["--input-silence", "--output", "null"]);
  hosts.push(a);
  const ollama = a.host.manager.snapshot().providers.find((p) => p.id === "ollama");
  results.localModels = (ollama?.models ?? []).filter((m) => !(ollama.remoteModels ?? []).includes(m) && !/(:|-)cloud$/i.test(m));
  const sel = selectSpeechEngine();
  results.speechEngine = sel.engine === "whisper" ? { engine: "whisper" } : sel;
  await a.cmd("mission.configure", { enabled: true });
  const projectId = (await a.cmd("project.add", { path: project, name: "Voice load probe", description: "Disposable" })).data.id;

  // ── Session open: worker launch inside the F04 job, ready, device report ─────────────────────────
  log("open");
  const t0 = performance.now();
  await a.cmd("voice.session.open", { mode: "push_to_talk" });
  await until("open", async () => (await a.voice()).open);
  results.sections.open = { coldOpenMs: Math.round(performance.now() - t0), workerMemoryKb: workerMemoryKb(), workers: workerCount() };
  const typed = (text) => () => a.cmd("voice.text", { text });

  // ── Host-facts path with barge-in at playback (target: cancel acknowledgment P95 <= 200 ms) ─────
  log(`host facts + barge-in x${N_BARGE}`);
  const facts = [];
  for (let i = 0; i < N_BARGE; i++) facts.push(await turn(a, typed(i % 2 ? "What failed?" : "What are my agents working on?"), { barge: true, label: `facts-${i}` }));
  results.sections.hostFacts = { turns: facts.length, answerSources: [...new Set(facts.map((r) => r.answerSource))], modelRoutes: facts.filter((r) => r.route).length, receiptToFirstPlayback: stats(facts.map((r) => r.receiptToFirstPlayback)) };
  const barges = facts.filter((r) => r.interrupt);
  results.sections.bargeIn = {
    target: "P95 <= 200 ms, software acknowledgment in controlled tests",
    boundary: "workerCancelWaitMs: from the Host's speak.cancel to the worker playback thread's waveOutReset acknowledgment (null sink). Not proof that sound stopped at a speaker.",
    samples: barges.length,
    workerCancelAckMs: stats(barges.map((r) => r.interrupt.workerCancelWaitMs)),
    hostInterruptHttpRoundTripMs: stats(barges.map((r) => r.interruptHttpMs)),
    resetPending: barges.filter((r) => r.interrupt.workerResetPending).length,
    wasPlaying: barges.filter((r) => r.interrupt.wasPlaying).length,
    droppedChunks: stats(barges.map((r) => r.interrupt.droppedChunks)),
    meterSilentMs: barges.filter((r) => r.interrupt.meterSilentMs != null).length,
  };

  // ── Model path: cold, then warm ─────────────────────────────────────────────────────────────────
  log("cold model turn");
  await unloadModels();
  const cold = await turn(a, typed(Q), { barge: true, label: "cold" });
  log(`warm model turns x${N_WARM}`);
  const warm = [];
  for (let i = 0; i < N_WARM; i++) warm.push(await turn(a, typed(Q), { barge: true, label: `warm-${i}` }));
  results.sections.model = { question: Q, route: warm[0]?.route ?? cold.route, cold: { stages: cold.stages, receiptToFirstPlayback: cold.receiptToFirstPlayback }, warm: summarize(warm), target: "warm first audible model response P50 <= 3000 ms" };

  // ── Under agent load: team Missions on the same local model while voice keeps answering ─────────
  log("agent load");
  const missions = [];
  const startTeam = async () => {
    const created = await a.cmd("agent.create", { objective: "Build a small offline inventory page from data/inventory.csv.", projectId, team: { requirements: [{ id: "R1", text: "No internet resources", check: { kind: "no_external_resources" } }] } });
    const coordinatorId = created.agents.agents.find((x) => x.team?.role === "coordinator" && x.state === "CREATED").id;
    await a.cmd("agent.start", { id: coordinatorId });
    const review = await until("team plan review", async () => a.host.missions.snapshot().missions.find((m) => m.teamView?.coordinatorAgentId === coordinatorId && m.teamView.phase === "review"), 600_000, 1_000);
    await a.cmd("agent.team.approve", { id: coordinatorId, planReference: review.teamView.planReference });
    await until("team executing", async () => a.host.missions.snapshot().missions.find((m) => m.id === review.id)?.state === "running", 120_000, 250);
    missions.push(review.id);
    return review.id;
  };
  const stateOf = (id) => a.host.missions.snapshot().missions.find((m) => m.id === id)?.state;
  const busy = () => a.host.agents.snapshot().agents.filter((x) => ["RUNNING", "VERIFYING", "PLANNING"].includes(x.state)).length;
  let current = await startTeam();
  const loaded = [];
  let closeCheck = null;
  while (loaded.length < N_LOAD) {
    if (OVER.includes(stateOf(current))) current = await startTeam();
    const active = busy();
    const row = await turn(a, typed(Q), { barge: true, timeoutMs: 600_000, label: `load-${loaded.length}` });
    row.agentsActiveAtStart = active;
    row.missionStillRunningAfter = stateOf(current) === "running";
    loaded.push(row);
    // Once, mid-load: a voice close and reopen while the Mission runs must leave it running.
    if (!closeCheck && stateOf(current) === "running") {
      const before = stateOf(current);
      await a.cmd("voice.session.close", { source: "e2e" });
      await until("worker exited", async () => workerCount() === 0, 15_000, 100);
      closeCheck = { mission: current, before, afterClose: stateOf(current), workersAfterClose: workerCount() };
      await a.cmd("voice.session.open", { mode: "push_to_talk" });
      await until("reopened", async () => (await a.voice()).open);
    }
  }
  const factsUnderLoad = await turn(a, typed("How many agents are working?"), { barge: true, label: "load-facts" });
  const finals = [];
  for (const id of missions) finals.push(await until("team finished", async () => { const s = stateOf(id); return OVER.includes(s) ? s : null; }, 1_800_000, 2_000));
  results.sections.underLoad = {
    turns: loaded.length, agentsActiveAtStart: loaded.map((r) => r.agentsActiveAtStart), turnsWithAgentsActive: loaded.filter((r) => r.agentsActiveAtStart > 0).length,
    warm: summarize(loaded.filter((r) => r.agentsActiveAtStart > 0)),
    hostFactsTurn: { receiptToFirstPlayback: factsUnderLoad.receiptToFirstPlayback, answerSource: factsUnderLoad.answerSource, modelRoute: factsUnderLoad.route },
    voiceCloseDuringMission: closeCheck,
    missions: { count: missions.length, finalStates: finals, stoppedByVoice: finals.filter((s) => s === "stopped").length },
  };
  // Reviewed (Bunny CLI): the Mission may legitimately finish during the close; what must never happen is a stop by voice.
  assert.ok(closeCheck && closeCheck.before === "running" && closeCheck.afterClose !== "stopped", "a voice close while a Mission runs never stops it");
  assert.equal(finals.filter((s) => s === "stopped").length, 0, "voice never stops a background Mission");
  await a.cmd("voice.session.close", { source: "e2e" });
  await until("worker exited", async () => workerCount() === 0, 15_000, 100);

  // ── End to end on a second Host: synthesized speech (not a human) -> VAD -> STT -> model -> TTS -> playback start ───
  log(`end-to-end x${N_E2E}`);
  const b = await makeHost(PORT + 1, ["--input-synth", Q, "--output", "null"]);
  hosts.push(b);
  await b.cmd("voice.session.open", { mode: "push_to_talk" });
  await until("open", async () => (await b.voice()).open);
  const listen = () => b.cmd("voice.listen.start", { source: "button" });
  const e2e = [];
  for (let i = 0; i <= N_E2E; i++) e2e.push(await turn(b, listen, { barge: true, label: i ? `e2e-${i}` : "e2e-warmup" }));
  const measured = e2e.slice(1);
  results.sections.endToEnd = {
    input: "SAPI-synthesized phrase via --input-synth, VAD endpointing (half duplex), worker recognizer",
    transcripts: [...new Set(e2e.map((r) => r.transcript))], routes: [...new Set(measured.map((r) => r.route?.model ?? r.answerSource))],
    warm: summarize(measured),
    endpointSilenceMs: 900,
    note: "speechEndToFirstPlayback starts at the VAD speech_end receipt, which follows 900 ms of endpoint silence after the last word.",
  };
  await b.cmd("voice.session.close", { source: "e2e" });
  await until("worker exited", async () => workerCount() === 0, 15_000, 100);

  // ── STT on the worker clock, with the engine the launcher selects here (synthesized fixture speech) ──
  // launchVoiceWorker chooses the recognizer itself (selectSpeechEngine), so the row is named from the worker's ready event.
  log("stt");
  results.sections.stt = { fixture: "SAPI-synthesized phrase via --input-synth; not human speech", selection: results.speechEngine, engines: {} };
  {
    const args = [];
    let name = "unknown";
    const rows = [];
    for (let i = 0; i < N_STT; i++) {
      const dir = mkdtempSync(join(tmpdir(), "bunny-p3-stt-"));
      let worker = null;
      try {
        worker = await launchVoiceWorker({ dataDirectory: dir, extraArgs: [...args, "--input-synth", "what are my agents working on", "--output", "null"] });
        const events = [];
        worker.onEvent((e) => events.push(e));
        const wait = (p, ms = 30_000) => until("worker event", async () => events.find(p), ms, 10);
        // From launchVoiceWorker's return (process spawned and verified) to the worker's ready event.
        const launched = performance.now();
        const ready = await wait((e) => e.ev === "ready");
        const readyMs = Math.round(performance.now() - launched);
        name = `${ready.stt.engine}${ready.stt.recognizer ? ` (${ready.stt.recognizer})` : ""}`;
        worker.send({ op: "capture.start", turn: `stt-${i}`, gen: 1, device: -1, endpointing: "vad", maxMs: 15_000 });
        const end = await wait((e) => e.ev === "vad" && e.state === "speech_end");
        const fin = await wait((e) => e.ev === "stt.final" || e.ev === "stt.none");
        rows.push({ readyMs, speechEndToResultMs: Math.round(fin.mono - end.mono), result: fin.ev, confidence: fin.confidence ?? null, text: fin.text ?? null });
      } finally {
        // Reviewed (Bunny CLI): a failed wait must still close this worker and remove its temporary folder.
        await worker?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    results.sections.stt.engines[name] = { runs: rows, readyMs: stats(rows.map((r) => r.readyMs)), speechEndToResultMs: stats(rows.map((r) => r.speechEndToResultMs)) };
  }
  results.sections.cleanup = { voiceWorkersAfterClose: workerCount() };
} catch (e) {
  failure = String(e?.stack ?? e).slice(0, 2000);
  log(`FAILED: ${failure}`);
} finally {
  results.failure = failure;
  for (const h of hosts) { try { await h.cmd("voice.session.close", { source: "e2e" }); } catch { /* closed */ } await h.host.close().catch(() => {}); }
  await sleep(1_000);
  results.workersAfterShutdown = workerCount();
  try { writeEvidence(join(EVIDENCE, process.env.EVIDENCE_NAME ?? "voice-latency.json"), scrub(results), hosts.map((h) => h.host.token)); } catch (e) { log(`evidence not written: ${e.message}`); }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  const s = results.sections;
  log(JSON.stringify({ bargeAck: s.bargeIn?.workerCancelAckMs, warm: s.model?.warm?.receiptToFirstPlayback, load: s.underLoad?.warm?.receiptToFirstPlayback, e2e: s.endToEnd?.warm?.speechEndToFirstPlayback, workers: results.workersAfterShutdown }));
  process.exitCode = failure || results.workersAfterShutdown ? 1 : 0;
}
