// MA5-S2 Phase 3: the compiled WPF app's voice surfaces against an isolated real Host (Ollama adapter only, real local
// model). The voice worker is the real contained exe with test-only fixture flags: --input-silence (no microphone is
// opened) and --output null (a real-time null sink; nothing is audible). Everything the notch and Voice Studio show is
// read through UI Automation; Host voice facts come from the Host. This is not acoustic evidence.
// Usage: node --experimental-strip-types scripts/ma5-s2/verify-voice-windows.mjs
import { spawn, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.BUNNY_E2E_PORT ?? 43195);
const exePath = process.env.BUNNY_EXE ?? join(process.cwd(), "native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");
const helper = join(process.cwd(), "scripts/ui-automation-helper.ps1");
const EVIDENCE = "docs/ma5-s2/evidence/voice";
const ONLY = process.env.VOICE_STAGES ? new Set(process.env.VOICE_STAGES.split(",")) : null;
const FIXTURE = ["--input-silence", "--output", "null"];
mkdirSync(EVIDENCE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const workers = () => (spawnSync("tasklist", ["/FI", "IMAGENAME eq bunny-voice-worker.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout.match(/bunny-voice-worker\.exe/gi) ?? []).length;

assert.ok(!/BunnyA\.exe/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq BunnyA.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout), "Close the running BunnyA.exe first.");
assert.equal(workers(), 0, "Close every running bunny-voice-worker.exe first.");
const hostDir = mkdtempSync(join(tmpdir(), "bunny-host-ma5s2-voice-"));
const configDir = mkdtempSync(join(tmpdir(), "bunny-config-ma5s2-voice-"));
const configPath = join(configDir, "config.json");
const writeConfig = (patch) => writeFileSync(configPath, JSON.stringify({ NotchEdge: "Top", NotchOffsetRatio: 0.5, ...patch }));
writeConfig({});

let host = await startHost({ port: PORT, dataDirectory: hostDir, adapters: defaultAdapters().filter((a) => a.id === "ollama"), voice: { workerExtraArgs: FIXTURE } });
const credPath = join(hostDir, "client-credentials.json");
writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));

async function ui(action, args = {}) {
  const ps = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Action", action];
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== "") ps.push(`-${k}`, String(v));
  const run = execFileAsync("powershell.exe", ps, { encoding: "utf8", timeout: 60_000 });
  run.child.stdin.end();
  return JSON.parse((await run).stdout.trim());
}
async function cmd(action, data = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data, operationId: crypto.randomUUID() }) });
  const body = await res.json().catch(() => ({}));
  assert.ok(res.ok, `${action}: ${body.error ?? res.status}`);
  return body;
}
const voice = async () => (await cmd("voice.state")).data;
async function until(what, fn, ms = 30_000, every = 300) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`); await sleep(every); }
}
let app;
function launch() {
  app = spawn(exePath, [], { env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: credPath, BUNNY_CONFIG_DIRECTORY: configDir }, stdio: "ignore" });
  return until("notch window", () => ui("notch_tree", { ProcessId: app.pid }), 30_000);
}
const tree = () => ui("notch_tree", { ProcessId: app.pid });
const item = (t, id) => t.items.find((i) => i.id === id);
const pill = async (id = "VoicePill") => { const t = await tree(); const p = item(t, id); return { status: p?.status ?? null, help: p?.help ?? null, text: item(t, "VoiceStatusText")?.name ?? null, level: item(t, "VoiceLevelTrack") ?? null, glyph: item(t, "VVoiceGlyph")?.name ?? null }; };
const pillIs = (status, id) => until(`pill ${status}`, async () => { const p = await pill(id); return p.status === status ? p : null; }, 30_000, 200);
const press = (id) => ui("navigate", { ProcessId: app.pid, TargetId: id });
const ask = async (text) => { await ui("set_text", { ProcessId: app.pid, TargetId: "VoiceTextBox", PromptText: text }); await press("VoiceTextSend"); };
/** Polls the notch until `done` holds, recording each distinct pill state in order (the observed timeline). */
async function timeline(done, ms = 120_000) {
  const seen = []; const start = Date.now();
  for (;;) {
    const p = await pill(); if (seen.at(-1) !== p.status) seen.push(p.status);
    if (await done(p)) return seen;
    if (Date.now() - start > ms) throw Object.assign(new Error(`timeline timed out: ${seen.join(" > ")}`), { detail: { seen } });
  }
}

const results = { schema: "ma5-s2.windows-voice.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", worker: { flags: FIXTURE, note: "fixture input and null sink; no microphone or speaker was opened" }, stages: {} };
const verdicts = {};
async function stage(name, fn) {
  if (ONLY && !ONLY.has(name)) return;
  log(`── ${name}`);
  try { const r = await fn(); results.stages[name] = { ok: true, ...r }; verdicts[name] = "PASS"; }
  catch (e) { results.stages[name] = { ok: false, error: String(e?.message ?? e).slice(0, 2000), ...(e?.detail ?? {}) }; verdicts[name] = "FAIL"; log(`FAILED ${name}: ${e.message}`); }
}

try {
  await host.manager.discover();
  const ollama = host.manager.snapshot().providers.find((p) => p.id === "ollama");
  results.model = (ollama?.models ?? []).find((m) => !(ollama.remoteModels ?? []).includes(m) && !/(:|-)cloud$/i.test(m)) ?? null;
  assert.ok(results.model, "a local Ollama model must be installed");
  await launch();

  await stage("v1-start-is-private", async () => {
    await sleep(3_000);
    const p = await pillIs("OFF");
    const snap = await voice();
    assert.equal(snap.open, false); assert.equal(snap.capturing, false); assert.equal(snap.playing, false);
    assert.equal(workers(), 0, "app start launches no voice worker");
    return { pill: p, hostOpen: snap.open, voiceWorkers: workers() };
  });

  await stage("v2-open-push-to-talk", async () => {
    await press("NavVoice");
    await press("VoiceSessionButton");
    const p = await pillIs("ON");
    const snap = await voice();
    assert.equal(snap.open, true); assert.equal(snap.mode, "push_to_talk"); assert.equal(snap.capturing, false, "opening a session does not open the microphone");
    return { pill: p, mode: snap.mode, capturing: snap.capturing, voiceWorkers: workers(), stt: snap.engines?.stt ?? null };
  });

  await stage("v3-host-facts-turn", async () => {
    await ask("What failed?");
    const seen = await timeline(async (p) => p.status === "ON" && (await voice()).answer);
    const snap = await voice();
    assert.equal(snap.answerSource, "host_facts"); assert.equal(snap.route, null, "no model route for a Host-facts answer");
    return { seen, answerSource: snap.answerSource, turnKind: snap.turnKind, answer: snap.answer, timing: snap.timing };
  });

  await stage("v4-model-turn-and-barge-in", async () => {
    await ask("Tell me a three sentence story about a careful rabbit.");
    const seen = await timeline(async (p) => p.status === "SPEAKING");
    const speaking = await pill();
    await press("VoiceBargeInButton");
    seen.push(...(await timeline(async (p) => p.status === "INTERRUPTED" || p.status === "ON")).filter((s, i, _a) => i > 0 || s !== seen.at(-1)));
    const snap = await voice();
    // Each UIA read costs about a second, so a warm model's short PROCESSING phase may fall between samples; it is recorded,
    // not asserted (the PROCESSING -> THINKING mapping is a unit check in BunnyA.Tests).
    results.thinkingObserved = seen.includes("THINKING");
    assert.ok(seen.includes("SPEAKING"), `speaking shown: ${seen.join(" > ")}`);
    assert.ok(snap.lastInterrupt, "the Host recorded an interrupt receipt");
    assert.equal(snap.lastInterrupt.source, "button");
    return { seen, speakingPill: speaking, route: snap.route, interrupt: snap.lastInterrupt, timing: snap.timing };
  });

  // MA5-S2 P4-2/P4-5: an agent generation holds the local model, so the question waits in Bunny's local queue. The notch
  // shows THINKING for seconds (long enough for UIA sampling), then the Host's delay acknowledgment, then the answer; the
  // agent generation is never cancelled.
  await stage("v11-thinking-while-queued", async () => {
    let bgState = null;
    let bgStreaming = false;
    const bgTask = host.manager.submit({ prompt: "Write a 250-word explanation of how tides work.", mode: "fast", override: "auto", constraints: { localOnly: true, offlineOnly: true, outputTokens: 400 } });
    host.manager.onTaskOutput(bgTask.id, (e) => { if ("text" in e) bgStreaming = true; else bgState = e.state; });
    if (bgTask.state === "waiting_for_approval") host.manager.approve(bgTask.id);
    await until("agent generation streaming", async () => bgStreaming || bgState, 120_000, 100);
    assert.ok(bgStreaming, `the agent generation started (${bgState})`);
    const before = (await voice()).turnId;
    await ask("In one short sentence, what does a rabbit eat?");
    const seen = await timeline(async () => { const s = await voice(); return s.turnId !== before && s.timing?.firstPlaybackAt; }, 180_000);
    const snap = await voice();
    assert.ok(seen.includes("THINKING"), `THINKING shown while the question waited: ${seen.join(" > ")}`);
    assert.ok(snap.timing?.delayAckAt, "the Host spoke the delay acknowledgment");
    await until("answer finished", async () => { const s = await voice(); return s.timing?.completedAt && !s.playing; }, 120_000);
    await until("agent generation finished", async () => bgState, 300_000, 500);
    assert.equal(bgState, "completed", "the agent generation was not cancelled by the voice turn");
    return { seen, delayAckSentMs: snap.timing.delayAckAt - snap.timing.activatedAt, answerAudioMs: snap.timing.firstPlaybackAt - snap.timing.activatedAt, agentGeneration: bgState };
  });

  // MA5-S2 P4-5: every Voice Studio control that is enabled takes keyboard focus and has an accessible name, and a question
  // can be asked with the keyboard alone (focus the box, type, Enter).
  await stage("v12-keyboard", async () => {
    const ids = ["VoiceSessionButton", "HandsFreeButton", "ListenStartButton", "ListenEndButton", "VoiceBargeInButton", "VoiceMuteButton", "VoiceTextBox", "VoiceTextSend"];
    const controls = [];
    for (const id of ids) controls.push(await ui("focus_main", { ProcessId: app.pid, TargetId: id }));
    const enabled = controls.filter((c) => c.enabled);
    assert.ok(enabled.length >= 5, `voice controls enabled with a session open: ${enabled.map((c) => c.id).join(", ")}`);
    for (const c of enabled) { assert.ok(c.focused, `${c.id} takes keyboard focus`); assert.ok(c.name, `${c.id} has an accessible name`); }
    const before = (await voice()).turnId;
    await ui("focus_main", { ProcessId: app.pid, TargetId: "VoiceTextBox", PromptText: "What failed?" });
    const snap = await until("keyboard-only turn answered", async () => { const s = await voice(); return s.turnId !== before && s.answer ? s : null; });
    assert.equal(snap.answerSource, "host_facts");
    await pillIs("ON");
    return { controls, keyboardTurn: { transcript: snap.finalTranscript, answerSource: snap.answerSource } };
  });

  await stage("v5-hands-free", async () => {
    await press("HandsFreeButton");
    await pillIs("LISTENING");
    const p = await until("measured level track shown while capture is confirmed", async () => { const q = await pill(); return q.status === "LISTENING" && q.level && !q.level.offscreen ? q : null; }, 10_000, 200);
    const snap = await voice();
    assert.equal(snap.mode, "hands_free"); assert.equal(snap.duplex?.active, true); assert.equal(snap.duplex?.fixture, true, "fixture lane, never a microphone");
    const button = await ui("read_state", { ProcessId: app.pid, TargetId: "HandsFreeButton" });
    const state = await ui("read_text", { ProcessId: app.pid, TargetId: "VoiceStateText" });
    assert.match(state.text ?? "", /hands-free microphone on/);
    await ask("What are my agents working on?");
    const seen = await timeline(async (q) => q.status === "SPEAKING" || ((await voice()).answer && q.status === "LISTENING"), 60_000);
    return { pill: p, button: button.name, stateText: state.text, duplex: snap.duplex, seenDuringTypedTurn: seen };
  });

  await stage("v6-mute-releases-capture", async () => {
    await until("hands-free listening again", async () => (await pill()).status === "LISTENING", 30_000);
    await press("VoiceMuteButton");
    const p = await pillIs("MUTED");
    const snap = await until("duplex released", async () => { const s = await voice(); return s.muted && !s.capturing && !s.duplex?.active ? s : null; }, 15_000);
    assert.equal(p.level, null, "no level is shown while muted");
    await press("VoiceMuteButton");
    await until("unmuted", async () => !(await voice()).muted, 10_000);
    return { pill: p, capturing: snap.capturing, duplexActive: snap.duplex?.active, stopped: snap.duplex?.stopped ?? null };
  });

  await stage("v7-stop-hands-free", async () => {
    // After a mute the grant is revoked; an explicit start is needed again, then Stop releases it.
    await press("HandsFreeButton");
    await pillIs("LISTENING");
    await press("HandsFreeButton");
    const snap = await until("hands-free stopped", async () => { const s = await voice(); return s.mode === "push_to_talk" && !s.capturing && !s.duplex?.active ? s : null; }, 15_000);
    const p = await pillIs("ON");
    return { pill: p, mode: snap.mode, capturing: snap.capturing, grantExpiresAt: snap.duplex?.grantExpiresAt ?? null };
  });

  await stage("v8-close-releases-worker", async () => {
    await press("VoiceSessionButton");
    const p = await pillIs("OFF");
    await until("worker exited", async () => workers() === 0, 15_000);
    const snap = await voice();
    assert.equal(snap.open, false); assert.equal(snap.capturing, false); assert.equal(snap.playing, false);
    return { pill: p, voiceWorkers: workers(), lastClose: snap.lastClose };
  });

  await stage("v9-vertical-edge", async () => {
    writeConfig({ NotchEdge: "Left" });
    app.kill(); await sleep(1_500); await launch();
    const off = await pillIs("OFF", "VVoicePill");
    await cmd("voice.session.open", { mode: "push_to_talk" });
    const on = await pillIs("ON", "VVoicePill");
    await cmd("voice.session.close", { source: "e2e" });
    await pillIs("OFF", "VVoicePill");
    writeConfig({});
    return { off: { status: off.status, glyph: off.glyph, help: off.help }, on: { status: on.status, glyph: on.glyph, help: on.help } };
  });

  await stage("v10-host-disconnect", async () => {
    app.kill(); await sleep(1_500); await launch();
    await pillIs("OFF");
    await host.close();
    const p = await pillIs("DISCONNECTED");
    host = await startHost({ port: PORT, dataDirectory: hostDir, adapters: defaultAdapters().filter((a) => a.id === "ollama"), voice: { workerExtraArgs: FIXTURE } });
    writeFileSync(credPath, JSON.stringify({ port: PORT, token: host.token }));
    const back = await pillIs("OFF");
    assert.equal(workers(), 0, "a Host restart reopens nothing");
    return { disconnected: p, afterRestart: back, voiceWorkers: workers(), hostVoiceOpenAfterRestart: (await voice()).open };
  });
} finally {
  results.verdicts = verdicts;
  const evidenceFile = join(EVIDENCE, "windows-voice.json");
  if (ONLY && existsSync(evidenceFile)) {
    const prior = JSON.parse(readFileSync(evidenceFile, "utf8"));
    results.stages = { ...prior.stages, ...results.stages };
    results.verdicts = { ...prior.verdicts, ...verdicts };
  }
  try { writeEvidence(evidenceFile, results, [host.token]); } catch (e) { log(`evidence not written: ${e.message}`); }
  try { app?.kill(); } catch { /* gone */ }
  await sleep(1_000);
  await host.close().catch(() => {});
  results.workersAfterShutdown = workers();
  for (const d of [hostDir, configDir]) rmSync(d, { recursive: true, force: true });
  log(JSON.stringify(verdicts), `voice workers after shutdown: ${results.workersAfterShutdown}`);
  process.exitCode = Object.values(verdicts).includes("FAIL") || results.workersAfterShutdown ? 1 : 0;
}
