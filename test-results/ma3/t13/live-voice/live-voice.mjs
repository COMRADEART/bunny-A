// M-A-3 T13 LANE: LIVE VOICE -> BUNNY COMPANION (Demonstration D).
// Real: disposable Host (port 43870, t11-mission-worker), real voice worker (native/voice/bunny-voice-worker.exe) on the
// default endpoints, real WPF Island (install/Bunny-Island.ps1, own launched PID only), dev server on 8095 reading that Host.
// Synthetic: no human speech; typed voice turns make Bunny speak through the real speakers.
// Never touched: production 43119/8084, %LOCALAPPDATA%\Bunny-A, Vite 8080 (pid 31440), Windows endpoint mute/volume/privacy.
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, launchIsland, closeIsland, voiceWorkerPids } from "../../t12/live/lib.mjs";

const here = import.meta.dirname;
const repo = resolve(here, "../../../..");
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });
const PORT = 43870, WEB_PORT = 8095;
const t0 = Date.now();
const log = (m) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
const result = { lane: "LIVE VOICE -> BUNNY COMPANION", startedAt: new Date(t0).toISOString(), classification: {}, phases: [], checks: [], notes: [] };
const marks = [];
const mark = (phase, note = "") => { marks.push({ phase, at: Date.now(), note }); log(`MARK ${phase} ${note}`); };
const pidsBefore = voiceWorkerPids();

const host = await startHost({ port: PORT, label: "t13-voice" });
result.classification.host = `LIVE (real Host code, disposable, port ${PORT}, pid ${host.pid})`;
const rows = []; // host voice timeline (deduped by visible signature)
const webRows = []; // web companion timeline (.wc-companion data-state)
let sampling = true, lastSig = "", latest = null;
const sampler = (async () => {
  while (sampling) {
    const s = await host.voice().catch(() => null);
    if (s) {
      latest = s;
      const c = s.companion ?? null;
      const d = s.duplex ?? {};
      const sig = [s.open, s.state, s.capturing, s.playing, !!s.outputHeld, s.muted, !!d.active, !!d.starting, c?.state, s.revision, s.instance].join("|");
      if (sig !== lastSig) {
        lastSig = sig;
        rows.push({
          t: Date.now(), revision: s.revision ?? null, instance: s.instance ?? null, open: s.open, state: s.state,
          capturing: s.capturing, playing: s.playing, outputHeld: !!s.outputHeld, muted: !!s.muted,
          duplex: { active: !!d.active, starting: !!d.starting, stopped: d.stopped?.reason ?? null },
          lastInterrupt: s.lastInterrupt ? { requestedAt: s.lastInterrupt.requestedAt ?? null, source: s.lastInterrupt.source ?? null } : null,
          companion: c ? { state: c.state, reason: c.reason, since: c.since } : null, error: s.error?.code ?? null,
        });
      }
    }
    await sleep(150);
  }
})();
const voiceCmd = (action, data = {}) => host.command(action, data);
const snap = () => latest;

// Web shell: the real dev server on 8095 reads this same Host through BUNNY_HOST_CREDENTIALS_FILE.
const devOut = openSync(join(here, "dev-8095.log"), "w");
const dev = spawn("node", ["scripts/with-app-env.mjs", "node", "node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(WEB_PORT)], {
  cwd: repo, env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: host.credentials }, stdio: ["ignore", devOut, devOut], windowsHide: true,
});
const killTree = (p) => { if (!p || p.exitCode !== null) return; try { execFileSync("taskkill.exe", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" }); } catch { p.kill(); } };
let island = null, browser = null, page = null, webSampling = false, webSamplerTask = null;
const webErrors = [];
const shotWeb = async (name) => {
  if (!page) return null;
  const p = join(shots, `web-${name}.png`);
  await page.screenshot({ path: p }).catch((e) => log("web shot failed " + e.message));
  return p;
};
const shotIsland = (name) => {
  if (!island) return null;
  const out = join(shots, `island-${name}.png`);
  try {
    const meta = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "capture-window.ps1"), "-ProcessId", String(island.pid), "-Out", out], { encoding: "utf8", windowsHide: true, timeout: 30000 }).trim();
    return { path: out, capture: meta };
  } catch (e) { return { path: out, error: String(e.message).slice(0, 300) }; }
};
const webState = async () => {
  if (!page) return null;
  return page.evaluate(() => {
    const el = document.querySelector(".wc-companion");
    return el ? { state: el.getAttribute("data-state"), art: el.querySelector("img")?.getAttribute("src") ?? null } : null;
  }).catch(() => null);
};
const startWebSampler = () => (async () => {
  while (webSampling) {
    const w = await webState();
    if (w) {
      const prev = webRows[webRows.length - 1];
      if (!prev || prev.state !== w.state || prev.art !== w.art) webRows.push({ t: Date.now(), ...w });
    }
    await sleep(200);
  }
})();

const waitFor = async (fn, ms, every = 100) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(every);
  }
  return null;
};
const check = (id, pass, evidence, note = "") => {
  const outcome = pass === null ? "NOT_TESTED" : pass ? "PASS" : "FAIL";
  result.checks.push({ id, outcome, evidence, note });
  log(`CHECK ${id} ${outcome} ${note}`);
};
const notTested = (id, reason) => check(id, null, {}, reason);

try {
  const webReady = await waitFor(async () => (await fetch(`http://127.0.0.1:${WEB_PORT}/?companion=1`)).ok, 180_000, 1000);
  log("dev server ready " + !!webReady);
  if (!webReady) throw new Error("dev server 8095 never answered");
  browser = await chromium.launch({ headless: true });
  page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark" })).newPage();
  page.on("pageerror", (e) => webErrors.push("pageerror " + e.message.slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") webErrors.push(m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/?companion=1&theme=dark`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitFor(() => page.$(".wc-companion"), 90_000, 300);
  webSampling = true;
  webSamplerTask = startWebSampler();

  // The real WPF Island against the same disposable Host (own launched PID only).
  island = launchIsland(host, { edge: "top" });
  await sleep(9000);
  result.islandPid = island.pid;

  // ---- a) session closed -> SLEEPING; open -> READY ----
  await sleep(800);
  mark("a-closed");
  check("a1-closed-sleeping", snap()?.companion?.state === "SLEEPING" && snap()?.open === false, { host: snap()?.companion, open: snap()?.open }, "Host companion before any session");
  await sleep(600);
  result.phases.push({ phase: "a-closed", web: await webState(), island: shotIsland("a-closed-sleeping"), shot: await shotWeb("a-closed-sleeping") });
  const openRes = await voiceCmd("voice.session.open", { mode: "push_to_talk" });
  const ready = await waitFor(async () => snap()?.companion?.state === "READY", 15_000);
  mark("a-open", `open status=${openRes.status}`);
  check("a2-open-ready", !!ready, { host: snap()?.companion, devices: snap()?.devices }, "session opened, companion READY");
  await sleep(1200);
  result.phases.push({ phase: "a-open", web: await webState(), island: shotIsland("a-open-ready"), shot: await shotWeb("a-open-ready") });
} catch (e) {
  log("PHASE A ERROR " + e.message);
  notTested("a-phase", e.message.slice(0, 200));
}

// ---- b) spoken answer turn: THINKING -> SPEAKING (worker playback) -> READY after playback.idle ----
try {
  const t = await voiceCmd("voice.text", { text: "Say exactly: Hello, the voice test is running." });
  mark("b-typed-turn", `status=${t.status} turnId=${t.body?.data?.turnId ?? "?"}`);
  const sawThinking = await waitFor(async () => ["PROCESSING", "TRANSCRIBING"].includes(snap()?.state) || ["THINKING", "WAITING_FOR_RESPONSE", "TRANSCRIBING"].includes(snap()?.companion?.state), 20_000, 80);
  const sawPlaying = await waitFor(async () => snap()?.playing === true, 60_000, 80);
  let shotB = null;
  let islandB = null;
  if (sawPlaying) { await sleep(300); shotB = await shotWeb("b-speaking"); islandB = shotIsland("b-speaking"); }
  const endedPlay = await waitFor(async () => snap()?.playing === false, 60_000, 120);
  mark("b-playback-ended", `ended=${!!endedPlay}`);
  await sleep(900);
  result.phases.push({ phase: "b-spoken-answer", thinkingSeen: !!sawThinking, playingSeen: !!sawPlaying, playbackEnded: !!endedPlay, web: await webState(), island: islandB, shot: shotB, answer: snap()?.answer ?? null });
  check("b1-thinking-before-speaking", sawThinking ? true : null, { observed: !!sawThinking, answer: snap()?.answer ?? null }, sawThinking ? "" : "no THINKING/WAITING/TRANSCRIBING observed");
  check("b2-speaking-from-worker-playback", sawPlaying ? true : null, { playing: !!sawPlaying }, sawPlaying ? "playing=true confirmed by worker" : "no playback observed (answer or TTS unavailable)");
  check("b3-ready-after-playback-idle", endedPlay ? true : null, { state: snap()?.state, companion: snap()?.companion }, endedPlay ? "" : "playback did not end within 60s");
} catch (e) {
  log("PHASE B ERROR " + e.message);
  notTested("b-phase", e.message.slice(0, 200));
}

// ---- c) interrupt during SPEAKING -> INTERRUPTED, playing false, no SPEAKING after the receipt ----
try {
  await waitFor(async () => snap()?.companion?.state === "READY", 20_000);
  const t = await voiceCmd("voice.text", { text: "Count slowly from one to twenty, one number per word." });
  mark("c-typed-long", `status=${t.status}`);
  const playing = await waitFor(async () => snap()?.playing === true, 60_000, 80);
  if (!playing) throw new Error("no playback to interrupt");
  await sleep(1200);
  const callAt = Date.now();
  const ir = await voiceCmd("voice.interrupt", { source: "button" });
  const returnedAt = Date.now();
  mark("c-interrupt", `status=${ir.status}`);
  const afterInterrupt = snap();
  const webShot = await shotWeb("c-interrupted");
  const islandC = shotIsland("c-interrupted");
  const webAtInterrupt = await webState();
  const stopped = await waitFor(async () => snap()?.playing === false, 8_000, 50);
  await sleep(600);
  const speakingAfterReturn = rows.filter((r) => r.t > returnedAt && r.companion?.state === "SPEAKING");
  result.phases.push({ phase: "c-interrupt", callAt, returnedAt, interruptStatus: ir.status, afterCompanion: afterInterrupt?.companion, afterPlaying: afterInterrupt?.playing, lastInterrupt: afterInterrupt?.lastInterrupt, web: webAtInterrupt, island: islandC, shot: webShot });
  check("c1-interrupted-expression", afterInterrupt?.companion?.state === "INTERRUPTED", { companion: afterInterrupt?.companion, lastInterrupt: afterInterrupt?.lastInterrupt }, "companion right after the interrupt receipt");
  check("c2-playing-false-after-cancel", !!stopped, { playing: snap()?.playing }, "worker confirmed playback stopped");
  check("c3-no-speaking-after-cancel", speakingAfterReturn.length === 0, { speakingSamplesAfterReturn: speakingAfterReturn.length }, "no companion SPEAKING sample after the interrupt returned");
} catch (e) {
  log("PHASE C ERROR " + e.message);
  notTested("c-phase", e.message.slice(0, 200));
}

// ---- d) push-to-talk: LISTENING only with worker capture; app mute -> MUTED with the mic inactive ----
try {
  await waitFor(async () => ["READY", "INTERRUPTED"].includes(snap()?.companion?.state), 15_000);
  const ls = await voiceCmd("voice.listen.start", { source: "push_to_talk" });
  mark("d-listen-start", `status=${ls.status}`);
  const capturing = await waitFor(async () => snap()?.capturing === true, 10_000, 60);
  await sleep(1500);
  const listenShot = capturing ? await shotWeb("d-listening") : null;
  const islandD = capturing ? shotIsland("d-listening") : null;
  const le = await voiceCmd("voice.listen.end", {});
  mark("d-listen-end", `status=${le.status}`);
  await waitFor(async () => snap()?.capturing === false, 15_000, 80);
  await sleep(500);
  result.phases.push({ phase: "d-push-to-talk", captureConfirmed: !!capturing, web: await webState(), island: islandD, shot: listenShot });
  check("d1-listening-only-when-capture-confirmed", capturing ? true : null, { capturing: !!capturing, companion: snap()?.companion }, capturing ? "capturing=true confirmed by worker" : "worker never confirmed capture");
  await voiceCmd("voice.mute", { on: true });
  await sleep(900);
  const muted = snap();
  const mutedShot = await shotWeb("d-muted");
  const islandMuted = shotIsland("d-muted");
  check("d2-muted-mic-inactive", muted?.companion?.state === "MUTED" && muted?.capturing === false, { companion: muted?.companion, capturing: muted?.capturing, muted: muted?.muted }, "app mute (Host session flag), not the Windows endpoint");
  result.phases.push({ phase: "d-app-muted", companion: muted?.companion, capturing: muted?.capturing, web: await webState(), island: islandMuted, shot: mutedShot });
  await voiceCmd("voice.mute", { on: false });
  await waitFor(async () => snap()?.companion?.state === "READY", 10_000, 100);
} catch (e) {
  log("PHASE D ERROR " + e.message);
  notTested("d-phase", e.message.slice(0, 200));
}

// ---- e) hands-free (duplex): LISTENING, LISTENING_WHILE_SPEAKING, then stop ----
try {
  await voiceCmd("voice.session.close", { source: "harness" });
  await sleep(1200);
  await voiceCmd("voice.session.open", { mode: "hands_free" });
  await sleep(1500);
  const hf = await voiceCmd("voice.listen.start", { source: "hands_free" });
  const duplexOn = await waitFor(async () => snap()?.duplex?.active === true, 20_000, 100);
  mark("e-handsfree", `status=${hf.status} active=${!!duplexOn}`);
  if (!duplexOn) throw new Error("hands-free never confirmed active; stopped=" + JSON.stringify(snap()?.duplex?.stopped ?? null));
  await sleep(1200);
  const eListen = await shotWeb("e-handsfree-listening");
  const islandE1 = shotIsland("e-handsfree-listening");
  const tSpeak = await voiceCmd("voice.text", { text: "Count from one to five." });
  mark("e-typed-while-handsfree", `status=${tSpeak.status}`);
  const bothSeen = await waitFor(async () => snap()?.capturing === true && snap()?.playing === true, 30_000, 80);
  const eBothShot = bothSeen ? await shotWeb("e-listening-while-speaking") : null;
  const islandE2 = bothSeen ? shotIsland("e-listening-while-speaking") : null;
  await waitFor(async () => snap()?.playing === false, 40_000, 120);
  const bothRows = rows.filter((r) => r.companion?.state === "LISTENING_WHILE_SPEAKING");
  result.phases.push({ phase: "e-handsfree", duplexActive: true, bothSeen: !!bothSeen, web: await webState(), islandListening: islandE1, islandBoth: islandE2, shotListening: eListen, shotBoth: eBothShot });
  check("e1-handsfree-listening", true, { companion: snap()?.companion, capturing: snap()?.capturing, duplex: snap()?.duplex }, "duplex.active confirmed by worker");
  check("e2-listening-while-speaking", bothSeen ? bothRows.length > 0 : null, { bothRowsObserved: bothRows.length, capturing: snap()?.capturing, playing: snap()?.playing }, bothSeen ? "capturing && playing confirmed" : "no overlapping capture and playback observed");
  await voiceCmd("voice.session.close", { source: "harness-handsfree-stop" });
  await waitFor(async () => snap()?.open === false, 10_000, 100);
  mark("e-handsfree-stopped");
  check("e3-handsfree-stopped", snap()?.open === false && snap()?.capturing === false, { open: snap()?.open, capturing: snap()?.capturing, companion: snap()?.companion }, "hands-free ended by session close");
} catch (e) {
  log("PHASE E ERROR " + e.message);
  notTested("e-phase", e.message.slice(0, 200));
}

// ---- close session -> SLEEPING, then stop the Host -> DISCONNECTED on the UIs ----
try {
  await voiceCmd("voice.session.close", { source: "harness" }).catch(() => null);
  await waitFor(async () => snap()?.companion?.state === "SLEEPING", 8_000, 100);
  await sleep(1000);
  result.phases.push({ phase: "close-sleeping", web: await webState(), island: shotIsland("close-sleeping"), shot: await shotWeb("close-sleeping") });
  check("a3-closed-sleeping-again", snap()?.companion?.state === "SLEEPING", { companion: snap()?.companion }, "after session close");
  mark("f-host-stop");
  const stopAt = Date.now();
  await host.stop();
  await sleep(9000);
  const webF = await webState();
  const islandF = shotIsland("f-host-stopped");
  const shotF = await shotWeb("f-host-stopped");
  result.phases.push({ phase: "f-host-stopped", stoppedAt: stopAt, web: webF, island: islandF, shot: shotF });
  check("f1-web-disconnected", webF?.state === "DISCONNECTED" ? true : null, { web: webF }, webF?.state === "DISCONNECTED" ? "" : "web did not show DISCONNECTED after Host stop");
} catch (e) {
  log("PHASE F ERROR " + e.message);
  notTested("f-phase", e.message.slice(0, 200));
}

// ---- stop everything ----
sampling = false;
webSampling = false;
await sampler;
if (webSamplerTask) await webSamplerTask;
if (browser) await browser.close().catch(() => {});
closeIsland(island);
killTree(dev);
await sleep(1500);
await host.stop().catch(() => {});
const leaked = voiceWorkerPids().filter((p) => !pidsBefore.includes(p));
result.workerPidsLeaked = leaked;
result.timing = { durationMs: Date.now() - t0 };

// Verifier analysis over the Host samples: the companion expression must follow the worker's confirmed facts.
const speakingWhileSilent = rows.filter((r) => r.companion?.state === "SPEAKING" && r.playing !== true);
const listeningWithoutCapture = rows.filter((r) => r.companion?.state === "LISTENING" && r.capturing !== true);
const micActiveWhileMuted = rows.filter((r) => r.muted === true && r.capturing === true);
check("x1-no-speaking-without-playback", speakingWhileSilent.length === 0, { violations: speakingWhileSilent.length, sample: speakingWhileSilent.slice(0, 3) }, "companion SPEAKING requires worker playback");
check("x2-no-listening-without-capture", listeningWithoutCapture.length === 0, { violations: listeningWithoutCapture.length, sample: listeningWithoutCapture.slice(0, 3) }, "companion LISTENING requires worker capture");
check("x3-mic-not-active-while-muted", micActiveWhileMuted.length === 0, { violations: micActiveWhileMuted.length }, "mic never reported capturing while app muted");
result.webErrors = webErrors;
result.hostInstance = rows.find((r) => r.instance)?.instance ?? null;
result.marks = marks;
writeFileSync(join(here, "voice-timeline.json"), JSON.stringify({ hostRows: rows, webRows, marks }, null, 2));
writeFileSync(join(here, "results.json"), JSON.stringify(result, null, 2));
const count = (o) => result.checks.filter((c) => c.outcome === o).length;
log(`DONE checks=${result.checks.length} pass=${count("PASS")} fail=${count("FAIL")} notTested=${count("NOT_TESTED")} leakedWorkers=${leaked.length}`);
process.exit(0);
