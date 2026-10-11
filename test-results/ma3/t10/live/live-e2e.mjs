// M-A-3 T10 §38: LIVE end-to-end spoken conversation with barge-in, driven by a HUMAN through the real WPF Bunny Island
// (product chord Ctrl+Alt+Space) against a DISPOSABLE Host with the real contained voice worker (whisper.cpp when the
// pinned runtime verifies). This script never sends voice commands itself: it only launches the Island, then records the
// Host's voice timeline (states, partial/final text, answers, interrupt receipts, timing) until the human has completed
// the requested turns. No audio and no screenshots are retained. Production (43119/8084) is never contacted.
// Usage: node --experimental-strip-types live-e2e.mjs <outJson> [expectedTurns=3] [timeoutSec=300]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost } from "./host-driver.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const out = process.argv[2];
const expectedTurns = Number(process.argv[3] ?? 3);
const timeoutMs = Number(process.argv[4] ?? 300) * 1000;
// --interrupts N: also wait until N real interrupts (barge-ins) were recorded before finishing.
const intArg = process.argv.indexOf("--interrupts");
const expectedInterrupts = intArg > 0 ? Number(process.argv[intArg + 1]) : 0;
const host = await startHost({ port: 43890 });
const work = mkdtempSync(join(tmpdir(), "bunny-t10-e2e-"));
const pref = join(work, "pref.json");
writeFileSync(pref, JSON.stringify({ edge: "top", position: "center", size: "compact", motion: "full", theme: "dark" }));
const island = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "install/Bunny-Island.ps1"), "-CredentialPath", join(host.dir, "credentials.json"), "-DeploymentPath", join(work, "no-deploy"), "-PreferencePath", pref], { stdio: "ignore" });
const timeline = [];
const turns = new Map();
const interrupts = [];
const levels = new Map();
let last = "";
let lastInterruptKey = "";
const t0 = Date.now();
console.log("READY: the test Island is starting at the top of the screen. Use Ctrl+Alt+Space (hold while speaking).");
try {
  while (Date.now() - t0 < timeoutMs) {
    const { body } = await host.command("voice.state");
    const s = body.data;
    if (s) {
      const sig = [s.open, s.state, s.capturing, s.playing, s.partial, s.finalTranscript, s.answer, s.turnId, s.error?.code, s.timing?.captureStopReason, s.lastClose?.at].join("|");
      if (sig !== last) {
        last = sig;
        timeline.push({ at: Date.now(), open: s.open, state: s.state, capturing: s.capturing, playing: s.playing, turnId: s.turnId, gen: s.generation, partial: s.partial, final: s.finalTranscript, turnKind: s.turnKind, answer: s.answer, answerSource: s.answerSource, route: s.route, engine: s.engines?.stt, error: s.error, source: s.timing?.source ?? null, endpointing: s.timing?.endpointing ?? null, captureStopReason: s.timing?.captureStopReason ?? null, lastClose: s.lastClose ?? null });
        if (s.state === "LISTENING") process.stdout.write("[listening] ");
        if (s.finalTranscript && s.turnId) {
          const turn = turns.get(s.turnId) ?? { turnId: s.turnId };
          Object.assign(turn, { final: s.finalTranscript, turnKind: s.turnKind, answer: s.answer, answerSource: s.answerSource, route: s.route, timing: s.timing });
          turns.set(s.turnId, turn);
        }
      }
      // Level numbers only (no audio): one sample per poll while capturing, for endpointing diagnosis.
      if (s.capturing && s.level && s.turnId) { const lv = levels.get(s.turnId) ?? []; if (lv.length < 600) lv.push([Date.now() - t0, Number(s.level.rms.toFixed(5)), s.level.speech ? 1 : 0]); levels.set(s.turnId, lv); }
      const li = s.lastInterrupt;
      const key = li ? `${li.turnId}|${li.gen}|${li.workerResetMs}` : "";
      if (li && key !== lastInterruptKey) { lastInterruptKey = key; interrupts.push(li); console.log(`\n[interrupt] ${li.source} reset ${li.workerResetMs} ms, audible silence ${li.meterSilentMs} ms`); }
      const answered = [...turns.values()].filter((t) => t.answer && t.timing?.completedAt).length;
      if (answered >= expectedTurns && interrupts.length >= expectedInterrupts && !s.playing && !s.capturing && s.state === "IDLE") break;
    }
    await sleep(100);
  }
} finally {
  const engine = timeline.find((t) => t.engine)?.engine ?? null;
  island.kill();
  await host.command("voice.session.close").catch(() => {});
  await sleep(500);
  await host.stop();
  const result = {
    classification: "LIVE human speech through the real WPF Island (Ctrl+Alt+Space) on a disposable Host; real microphone, real speakers; text/timing receipts only",
    engine,
    durationMs: Date.now() - t0,
    turns: [...turns.values()].map((t) => ({ ...t, levels: levels.get(t.turnId) ?? [] })),
    interrupts,
    timeline,
  };
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
  console.log("\nSUMMARY", JSON.stringify({ engine, turns: result.turns.map((t) => ({ final: t.final, kind: t.turnKind, answer: (t.answer ?? "").slice(0, 120), route: t.route?.model ?? null, src: t.timing?.source ?? null, stop: t.timing?.captureStopReason ?? null })), interrupts: interrupts.map((i) => ({ source: i.source, resetMs: i.workerResetMs, silentMs: i.meterSilentMs, wasPlaying: i.wasPlaying })) }, null, 1));
}
