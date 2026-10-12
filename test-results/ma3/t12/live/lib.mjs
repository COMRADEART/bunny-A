// M-A-3 T12 live harness library. Every run uses a DISPOSABLE Host: the real Host code (scripts/fixtures/
// t11-mission-worker.mjs, real provider adapters, real local Ollama) with temp state on a 438xx port. Production
// (43119/8084), its state, credentials, Startup entries and Windows audio settings are never touched. Records keep text,
// timestamps and level numbers only: no audio is ever written.
import { fork, spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const repo = resolve(import.meta.dirname, "../../../..");

export async function startHost({ port = 43840 + Math.floor(Math.random() * 40), label = "t12" } = {}) {
  if (port === 43119 || !/^438\d\d$/.test(String(port))) throw new Error("refusing a non-disposable port");
  const parent = mkdtempSync(join(tmpdir(), `bunny-${label}-`));
  const data = join(parent, "state"), workspace = join(parent, "workspace");
  for (const p of [data, workspace]) mkdirSync(p, { recursive: true });
  const faults = join(parent, "faults.json");
  writeFileSync(faults, JSON.stringify({ seed: [] }));
  const log = [];
  const child = fork(join(repo, "scripts/fixtures/t11-mission-worker.mjs"), [data, workspace, String(port), faults], { cwd: repo, execArgv: ["--experimental-strip-types"], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  child.stderr.on("data", (d) => { log.push(String(d).slice(0, 2000)); if (log.length > 400) log.shift(); });
  child.stdout.on("data", () => {});
  const ready = await new Promise((done, reject) => { child.once("message", done); child.once("exit", (code) => reject(Error(`Host exited ${code}: ${log.join("").slice(-1500)}`))); });
  // The test Island reads {token, port} from this file only; it is a disposable credential for this Host.
  const credentials = join(parent, "island-credentials.json");
  writeFileSync(credentials, JSON.stringify({ token: ready.token, port }));
  const base = `http://127.0.0.1:${port}`;
  const command = async (action, data = {}) => {
    const res = await fetch(base + "/command", { method: "POST", headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
  const state = async () => (await fetch(base + "/state", { headers: { authorization: `Bearer ${ready.token}` } })).json();
  const voice = async () => (await command("voice.state")).body.data ?? null;
  const stop = async () => {
    try { await command("voice.session.close", { source: "harness" }); } catch { /* host gone */ }
    if (child.exitCode === null) {
      child.send("close");
      for (let i = 0; i < 100 && child.exitCode === null; i++) await sleep(100);
      if (child.exitCode === null) child.kill();
    }
  };
  return { child, pid: ready.pid, epoch: ready.generation, token: ready.token, port, parent, data, workspace, credentials, command, state, voice, stop, log: () => log.join("") };
}

/** Launches the real WPF Bunny Island against the disposable Host (its own credential and preference files). */
export function launchIsland(host, { edge = "top" } = {}) {
  const work = mkdtempSync(join(tmpdir(), "bunny-t12-island-"));
  const pref = join(work, "pref.json");
  writeFileSync(pref, JSON.stringify({ edge, position: "center", size: "compact", motion: "full", theme: "dark" }));
  const island = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "install/Bunny-Island.ps1"), "-CredentialPath", host.credentials, "-DeploymentPath", join(work, "no-deploy"), "-PreferencePath", pref], { stdio: "ignore", windowsHide: false });
  return island;
}

/** Closes an Island process tree this harness started (exact pid only). */
export function closeIsland(island) {
  if (!island || island.exitCode !== null) return;
  try { execFileSync("taskkill.exe", ["/PID", String(island.pid), "/T", "/F"], { stdio: "ignore" }); } catch { island.kill(); }
}

/**
 * Records the Host voice snapshot stream: state changes, hands-free (duplex) truth, controller decisions, acoustic
 * barge-in receipts, interrupt receipts and per-turn finals/answers. Text and numbers only.
 */
export function voiceRecorder(host, { everyMs = 60 } = {}) {
  const timeline = [], decisions = [], bargeIns = [], interrupts = [], turns = new Map(), inputTurns = new Set();
  let last = "", lastDecision = "", lastBarge = "", lastInterrupt = "", running = true, latest = null;
  const t0 = Date.now();
  const loop = (async () => {
    while (running) {
      let s = null;
      try { s = await host.voice(); } catch { s = null; }
      if (s) {
        latest = s;
        const d = s.duplex ?? {};
        const sig = [s.open, s.mode, s.state, s.capturing, s.playing, s.outputHeld, d.active, d.starting, d.releasing, d.stopped?.reason, s.inputTurnId, s.partial, s.finalTranscript, s.answer, s.turnId, s.generation, s.error?.code].join("|");
        if (sig !== last) {
          last = sig;
          timeline.push({ at: Date.now(), state: s.state, mode: s.mode, capturing: s.capturing, playing: s.playing, held: !!s.outputHeld, duplex: { active: !!d.active, starting: !!d.starting, releasing: !!d.releasing, stopped: d.stopped ?? null, grantExpiresAt: d.grantExpiresAt ?? null, aec: d.aec ?? null }, inputTurnId: s.inputTurnId ?? null, turnId: s.turnId, gen: s.generation, partial: s.partial, final: s.finalTranscript, turnKind: s.turnKind, answer: s.answer, answerSource: s.answerSource, route: s.route, error: s.error });
        }
        if (s.inputTurnId) inputTurns.add(s.inputTurnId);
        const td = s.turnDecision;
        const tdKey = td ? `${td.at}|${td.action}|${td.reason}` : "";
        if (td && tdKey !== lastDecision) { lastDecision = tdKey; decisions.push({ ...td, inputTurnId: s.inputTurnId ?? null, outputTurnId: s.turnId }); }
        const b = s.lastBargeIn;
        const bKey = b ? JSON.stringify(b) : "";
        if (b && bKey !== lastBarge) {
          lastBarge = bKey;
          const i = bargeIns.findIndex((x) => x.inputTurnId === b.inputTurnId && x.gen === b.gen);
          if (i >= 0) bargeIns[i] = { ...b, seenAt: bargeIns[i].seenAt, updatedAt: Date.now() }; else bargeIns.push({ ...b, seenAt: Date.now() });
        }
        const li = s.lastInterrupt;
        const liKey = li ? JSON.stringify(li) : "";
        if (li && liKey !== lastInterrupt) {
          lastInterrupt = liKey;
          const i = interrupts.findIndex((x) => x.turnId === li.turnId && x.gen === li.gen);
          if (i >= 0) interrupts[i] = li; else interrupts.push(li);
        }
        if (s.finalTranscript && s.turnId) {
          const turn = turns.get(s.turnId) ?? { turnId: s.turnId, firstSeen: Date.now() };
          Object.assign(turn, { final: s.finalTranscript, turnKind: s.turnKind, answer: s.answer, answerSource: s.answerSource, route: s.route, timing: s.timing });
          turns.set(s.turnId, turn);
        }
      }
      await sleep(everyMs);
    }
  })();
  return {
    latest: () => latest,
    elapsed: () => Date.now() - t0,
    stop: async () => { running = false; await loop; },
    result: () => ({ startedAt: t0, durationMs: Date.now() - t0, timeline, decisions, bargeIns, interrupts, turns: [...turns.values()], inputTurns: inputTurns.size }),
  };
}

export async function waitFor(fn, timeoutMs = 60_000, everyMs = 80) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let v;
    try { v = await fn(); } catch { v = undefined; }
    if (v) return v;
    await sleep(everyMs);
  }
  return null;
}

export function percentile(values, p) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

export function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  return { n: v.length, p50: percentile(v, 50), p95: percentile(v, 95), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
}

/** Bunny voice worker processes alive right now (for leak checks around a run). */
export function voiceWorkerPids() {
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process bunny-voice-worker -ErrorAction SilentlyContinue | ForEach-Object Id) -join ','"], { encoding: "utf8", windowsHide: true }).trim();
    return out ? out.split(",").map(Number) : [];
  } catch { return []; }
}

/** Read-only endpoint observation (mute/volume) through a short-lived worker `devices` report. Never changes settings. */
export async function endpointState() {
  const { launchVoiceWorker } = await import("../../../../src/lib/bunny-host/voice/voice-worker.server.ts");
  const dir = mkdtempSync(join(tmpdir(), "bunny-t12-dev-"));
  const worker = await launchVoiceWorker({ dataDirectory: dir });
  let devices = null;
  worker.onEvent((e) => { if (e.ev === "devices") devices = e; });
  await sleep(800);
  worker.send({ op: "devices" });
  for (let i = 0; i < 40 && !devices; i++) await sleep(100);
  await worker.close();
  return devices;
}

// One receipt per acoustic onset (a pending receipt is superseded by its decision). Latency is only a perceived latency
// when Bunny was audible at the pause; a pause applied before any sound played (wasAudible false) is a pre-audio hold.
export function summarize(result, tr, b, t0) {
  const byOnset = new Map();
  for (const x of result.recording.bargeIns) byOnset.set(x.onsetMono ?? x.inputTurnId, x);
  const all = [...byOnset.values()];
  const audible = all.filter((x) => x.wasAudible === true);
  return {
    durationMin: Math.round(((t0 == null ? result.recording.durationMs : Date.now() - t0)) / 6000) / 10,
    userTurns: result.recording.turns.filter((x) => x.timing?.source && x.timing.source !== "typed").length,
    typedPrompts: result.recording.turns.filter((x) => x.timing?.source === "typed").length,
    bargeIns: all.length,
    interrupted: all.filter((x) => x.outcome === "interrupted").length,
    resumed: all.filter((x) => x.outcome === "resumed").length,
    audibleBargeIns: audible.length,
    preAudioHolds: all.filter((x) => x.wasAudible === false).length,
    unmeasured: all.filter((x) => x.wasAudible == null).length,
    detectionToSilenceMs: stats(audible.map((x) => x.detectionToSilenceMs)),
    onsetToSilenceMs: stats(audible.map((x) => x.onsetToSilenceMs)),
    preAudioPauseAppliedMs: stats(all.filter((x) => x.wasAudible === false).map((x) => x.detectionToSilenceMs)),
    trials: tr.length,
    trialOutcomes: tr.map((t) => t.bargeIn?.outcome ?? (t.finishedWithoutBargeIn ? "no_barge_in" : "none")),
    staleResumed: tr.filter((t) => t.staleResumed).length,
    echoRejected: all.reduce((s, x) => s + (x.echoRejected ?? 0), 0),
    trialDetectionToSilenceMs: stats(b.filter((x) => x.wasAudible === true).map((x) => x.detectionToSilenceMs)),
    trialOnsetToSilenceMs: stats(b.filter((x) => x.wasAudible === true).map((x) => x.onsetToSilenceMs)),
  };
}
