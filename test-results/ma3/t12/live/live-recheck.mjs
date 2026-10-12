// M-A-3 T12: short live human re-check of the post-endurance and review-round-3 fixes, on a DISPOSABLE Host, hands-free on
// the real microphone and speakers. The human says the scripted phrases; every spoken turn (heard text, kind, answer) is
// recorded. Text and state only; no audio is written. Ends when the human's spoken "end voice" closes the session, or after
// <minutes>. Usage: node --experimental-strip-types live-recheck.mjs <out.json> [minutes]
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, voiceWorkerPids } from "./lib.mjs";
import { makeProject, startTeam, TEAMS } from "./team.mjs";

const out = process.argv[2];
const minutes = Number(process.argv[3] ?? 6);
const t0 = Date.now();
const result = { mode: "live-recheck", classification: "LIVE human speech, real microphone/speakers, hands-free, disposable Host", sourceCommit: null, startedAt: new Date().toISOString(), script: [], turns: [], notes: [] };
const log = (e, d = {}) => { const l = `[${Math.round((Date.now() - t0) / 1000)}s] ${e} ${JSON.stringify(d)}`; console.log(l); result.notes.push(l); };
result.script = [
  { say: "Prepare a … (pause for a second) … plan for the dashboard project.", expect: "one mission_draft turn (not split)" },
  { say: "Is any task running?", expect: "agent_status" },
  { say: "Open notes and save it on the desktop.", expect: "device_action_unsupported" },
  { say: "Are you running any tasks?", expect: "agent_status" },
  { say: "End voice, please.", expect: "voice_close (the session ends)" },
];
const host = await startHost({ label: "t12-recheck" });
const pidsBefore = voiceWorkerPids();
try {
  result.sourceCommit = (await host.state()).release?.sourceCommit ?? null;
  await startTeam(host, makeProject(host.parent), TEAMS[0], log);
  await host.command("voice.session.open", { mode: "hands_free" });
  await sleep(1500);
  // The harness stands in for the user's explicit Start hands-free (the only path that creates the hands-free grant).
  await host.command("voice.listen.start", { source: "hands_free" });
  for (let i = 0; i < 40 && !(await host.voice()).duplex?.active; i++) await sleep(250);
  log("handsfree.live", { aec: (await host.voice()).duplex?.aec ?? null });
  console.log("\n>>> SPEAK NOW. Say each line, waiting for Bunny's answer in between:\n" + result.script.map((s, i) => `  ${i + 1}. ${s.say}`).join("\n") + "\n");
  let wasOpen = true;
  for (const end = Date.now() + minutes * 60_000; Date.now() < end; ) {
    const v = await host.voice().catch(() => null);
    if (!v) { await sleep(500); continue; }
    if (v.turnId && v.finalTranscript && !v.turnId.startsWith("t")) {
      let row = result.turns.find((t) => t.turnId === v.turnId);
      if (!row) { row = { turnId: v.turnId, heard: v.finalTranscript, kind: v.turnKind, answer: null, answerSource: null, overlapped: null }; result.turns.push(row); log("turn", { heard: row.heard, kind: row.kind }); }
      if (v.answer && v.answer !== row.answer) { row.answer = v.answer; row.answerSource = v.answerSource; row.kind = v.turnKind; log("answer", { heard: row.heard, kind: row.kind, answer: v.answer.slice(0, 140) }); }
    }
    if (wasOpen && !v.open) { log("voice.closed", { lastClose: v.lastClose }); result.closedBy = v.lastClose; break; }
    wasOpen = v.open;
    await sleep(300);
  }
  await sleep(1500);
  result.workerPidsAfterClose = voiceWorkerPids().filter((p) => !pidsBefore.includes(p));
  const s = await host.state();
  result.voiceMissions = s.missions.missions.filter((m) => m.origin === "voice:workstation").map((m) => ({ title: m.title, state: m.state, authorizationId: m.authorizationId ?? null }));
} finally {
  await host.command("voice.session.close", { source: "harness" }).catch(() => undefined);
  await host.stop();
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log("\nSUMMARY", JSON.stringify({ turns: result.turns.map((t) => `${t.kind}: ${t.heard}`), closedBy: result.closedBy?.source ?? null, voiceMissions: result.voiceMissions, workersAfterClose: result.workerPidsAfterClose }));
}
