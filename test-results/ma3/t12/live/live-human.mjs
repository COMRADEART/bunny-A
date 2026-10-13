// M-A-3 T12 LIVE human acoustic sessions through the real WPF Bunny Island on a DISPOSABLE Host (real contained voice
// worker, real laptop microphone and speakers, real local Ollama). The human speaks; this script only launches the Island,
// optionally prompts Bunny with typed questions so it is speaking when the human barges in, and records the Host's own
// receipts. Records are text, timestamps and level numbers only; no audio is retained.
// Modes:
//   conversation  : free hands-free conversation; ends when the human ends the voice session in the Island (or timeout).
//   bargein       : N trials. Bunny starts a long answer (typed prompt); the human interrupts by voice at any point.
//   backchannel   : N trials. Bunny starts a long answer; the human says only "mm-hmm" / "yeah" / "okay" (should resume).
//   endurance     : >= 20 minutes of supervised conversation while a real Team Mission works in the background.
//   multi-agent   : the scripted multi-Agent voice demonstration (two real Team Missions working).
// Usage: node --experimental-strip-types live-human.mjs <mode> <outJson> [trials|minutes]
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, launchIsland, closeIsland, voiceRecorder, waitFor, stats, voiceWorkerPids, endpointState, summarize } from "./lib.mjs";
import { makeProject, startTeam, agentFacts, TEAMS } from "./team.mjs";

const mode = process.argv[2];
const out = process.argv[3];
const arg = Number(process.argv[4] ?? (mode === "endurance" ? 20 : 20));
if (!["conversation", "bargein", "backchannel", "endurance", "multi-agent"].includes(mode) || !out) throw new Error("usage: live-human.mjs <mode> <outJson> [n]");
const LONG = [
  "Explain in six full spoken sentences how a rainbow forms, step by step.",
  "Describe in six full sentences how bread rises when it is baked.",
  "In six spoken sentences, explain why the sky looks blue during the day.",
  "Tell me in six sentences how a bicycle stays upright while it moves.",
  "Explain in six full sentences how tides are caused by the moon.",
  "Describe in six sentences how a refrigerator keeps food cold.",
];
const say = (text) => console.log(`\n>>> ${text}`);
const t0 = Date.now();
const log = [];
const note = (kind, detail = {}) => { const row = { at: Date.now(), t: Math.round((Date.now() - t0) / 1000), kind, ...detail }; log.push(row); console.log(`[${row.t}s] ${kind} ${JSON.stringify(detail).slice(0, 200)}`); };

const endpoints = await endpointState();
if (endpoints?.defaultInput?.muted) { say("The Windows microphone is muted. Unmute it and run again (this harness never changes audio settings)."); process.exit(2); }
const pidsBefore = voiceWorkerPids();
const host = await startHost({ label: `t12-${mode}` });
const result = { mode, classification: "LIVE human speech, real WPF Island, real microphone and speakers, disposable Host; text/timing receipts only", startedAt: new Date(t0).toISOString(), hostPid: host.pid, port: host.port, endpoints: { input: endpoints?.defaultInput ?? null, output: endpoints?.defaultOutput ?? null }, trials: [], notes: log };
const island = launchIsland(host, { edge: "top" });
const rec = voiceRecorder(host);
const resources = [];
const sampler = setInterval(async () => {
  try {
    const { execFileSync } = await import("node:child_process");
    const ps = `@(Get-Process bunny-voice-worker -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ id=$_.Id; ws=$_.WorkingSet64; cpu=$_.CPU; handles=$_.HandleCount; threads=$_.Threads.Count } }) | ConvertTo-Json -Compress`;
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim();
    const host_ = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${host.pid} -ErrorAction SilentlyContinue).WorkingSet64`], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim();
    resources.push({ at: Date.now(), workers: raw ? [].concat(JSON.parse(raw)) : [], hostWorkingSet: Number(host_) || null });
  } catch { /* sampling is best effort */ }
}, 30_000);
let teams = [];
try {
  let teamWork = null;
  if (mode === "endurance" || mode === "multi-agent") {
    // Two real Team Missions plan and run IN PARALLEL with the voice session: conversation while Agents work.
    const project = makeProject(host.parent);
    say("Starting two real background Agent teams on the disposable Host (they plan and work while you talk)...");
    teamWork = (async () => {
      for (const spec of TEAMS) {
        try { teams.push(await startTeam(host, project, spec, note)); } catch (error) { note("team.error", { name: spec.name, message: String(error?.message ?? error).slice(0, 200) }); }
      }
      result.agentsAfterApproval = await agentFacts(host).catch(() => null);
    })();
  }
  say("The test Island is at the top of the screen. Open voice there and turn on Hands-free (Start hands-free).");
  const live = await waitFor(async () => (await host.voice())?.duplex?.active, 10 * 60_000, 250);
  if (!live) throw new Error("hands-free was not started in the Island within 10 minutes");
  note("handsfree.live", { duplex: (await host.voice()).duplex });
  if (mode === "bargein" || mode === "backchannel") {
    say(mode === "bargein"
      ? `Barge-in trials (${arg}). Each time Bunny starts a long answer, interrupt it by voice at any moment with a short question (e.g. "Wait, what's two plus two?"). Then let it answer.`
      : `Backchannel trials (${arg}). Each time Bunny starts a long answer, say only "mm-hmm", "yeah" or "okay" once while it speaks, then stay quiet.`);
    for (let i = 0; i < arg; i++) {
      const before = rec.result();
      const t = { i, prompt: LONG[i % LONG.length], startedAt: Date.now() };
      await host.command("voice.text", { text: t.prompt });
      const speaking = await waitFor(async () => { const s = await host.voice(); return s?.playing ? s : null; }, 120_000, 40);
      if (!speaking) { t.error = "Bunny never started speaking"; result.trials.push(t); continue; }
      t.outputTurnId = speaking.turnId; t.gen = speaking.generation;
      process.stdout.write(`\n[trial ${i + 1}/${arg}] Bunny is speaking now. `);
      const done = await waitFor(async () => {
        const s = await host.voice();
        const b = s?.lastBargeIn;
        if (b && b.outputTurnId === t.outputTurnId && b.outcome !== "pending") return { b };
        if (s && !s.playing && !s.outputHeld && s.state === "IDLE" && s.turnId === t.outputTurnId && s.timing?.completedAt) return { finished: true };
        return null;
      }, 90_000, 40);
      t.bargeIn = done?.b ?? null;
      t.finishedWithoutBargeIn = !!done?.finished;
      let resumed = false;
      for (const until = Date.now() + 3000; Date.now() < until; ) { const s = await host.voice(); if (t.bargeIn?.outcome === "interrupted" && s?.playing && s.turnId === t.outputTurnId && s.generation === t.gen) resumed = true; await sleep(50); }
      t.staleResumed = resumed;
      if (mode === "bargein" && t.bargeIn?.outcome === "interrupted") {
        const answered = await waitFor(async () => { const s = await host.voice(); return s?.finalTranscript && s.turnId !== t.outputTurnId && s.answer && !s.playing && !s.outputHeld && s.state === "IDLE" ? s : null; }, 60_000);
        t.newTurn = answered ? { final: answered.finalTranscript, kind: answered.turnKind, answer: answered.answer, source: answered.answerSource, timing: answered.timing } : null;
      } else {
        await waitFor(async () => { const s = await host.voice(); return s && !s.playing && !s.outputHeld && s.state === "IDLE" ? s : null; }, 90_000);
      }
      const after = rec.result();
      t.decisions = after.decisions.slice(before.decisions.length);
      t.endedAt = Date.now();
      result.trials.push(t);
      console.log(JSON.stringify({ i, outcome: t.bargeIn?.outcome ?? (t.finishedWithoutBargeIn ? "no_barge_in" : "none"), reason: t.bargeIn?.reason ?? null, detectionToSilenceMs: t.bargeIn?.detectionToSilenceMs ?? null, onsetToSilenceMs: t.bargeIn?.onsetToSilenceMs ?? null, stale: t.staleResumed, heard: t.newTurn?.final ?? null }));
      await sleep(2500);
    }
  } else {
    const minutes = mode === "endurance" ? arg : mode === "multi-agent" ? 15 : 10;
    say(mode === "multi-agent"
      ? "Multi-Agent demo: ask which Agents are active, ask about one, interrupt Bunny, ask whether verification completed, ask Bunny to pause one Agent and confirm, keep talking, then end the voice session in the Island."
      : mode === "endurance"
        ? `Endurance: talk with Bunny for at least ${minutes} minutes (aim for 30+ turns, several interruptions and pauses; ask about the background team too). End the voice session in the Island when done.`
        : "Free conversation: talk with Bunny hands-free, interrupt it a few times, then end the voice session in the Island.");
    const deadline = Date.now() + (minutes + 25) * 60_000;
    let wasOpen = true;
    while (Date.now() < deadline) {
      const s = await host.voice();
      if (s && !s.open && wasOpen && rec.elapsed() > 30_000) { note("voice.closed_by_user", { lastClose: s.lastClose }); break; }
      wasOpen = !!s?.open || wasOpen;
      if ((mode === "endurance" || mode === "multi-agent") && Math.round(rec.elapsed() / 1000) % 60 === 0) result.agentTimeline = [...(result.agentTimeline ?? []), await agentFacts(host).catch(() => null)];
      await sleep(1000);
    }
  }
  if (teamWork) await Promise.race([teamWork, sleep(1000)]);
  result.agentsAfterVoice = (mode === "endurance" || mode === "multi-agent") ? await agentFacts(host).catch(() => null) : null;
} catch (error) {
  result.error = String(error?.stack ?? error).slice(0, 2000);
  note("error", { message: result.error.slice(0, 200) });
} finally {
  clearInterval(sampler);
  await rec.stop();
  result.recording = rec.result();
  result.resources = resources;
  // Voice is closed (if the human did not) and the workers must be gone; Agents and Missions must still be there.
  await host.command("voice.session.close", { source: "harness" }).catch(() => {});
  await sleep(1500);
  result.workerPidsAfterVoiceClose = voiceWorkerPids().filter((p) => !pidsBefore.includes(p));
  if (mode === "endurance" || mode === "multi-agent") {
    result.agentsAfterClose = await agentFacts(host).catch(() => null);
    // Reopen the Agentic view's data (canonical continuity): the same Missions and Agents are listed by the Host.
    result.agenticReopen = await host.command("agent.list", {}).then((r) => ({ status: r.status, agents: (r.body?.agents?.agents ?? r.body?.snapshot?.agents?.agents ?? []).length })).catch((e) => ({ error: String(e) }));
  }
  closeIsland(island);
  await host.stop();
  await sleep(1000);
  result.workerPidsAfterHostStop = voiceWorkerPids().filter((p) => !pidsBefore.includes(p));
  const tr = result.trials.filter((t) => !t.error);
  const b = tr.map((t) => t.bargeIn).filter(Boolean);
  result.summary = summarize(result, tr, b, t0);
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log("\nSUMMARY", JSON.stringify(result.summary));
}

