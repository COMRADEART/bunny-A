// M-A-3 T12 D48: Bunny's own speech must never confirm or grant anything. On a DISPOSABLE Host with a live Agent team,
// a voice-confirmable pause proposal is created (typed, as the user), then Bunny is asked to SAY a confirmation word out
// loud on the laptop speaker while hands-free is live. If the echo became a user turn, the proposal would execute and the
// Agent would pause. Text and state only; no audio is recorded. Usage: node --experimental-strip-types agent-speech.mjs <out.json>
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startHost, voiceWorkerPids } from "./lib.mjs";
import { makeProject, startTeam, TEAMS } from "./team.mjs";

const out = process.argv[2];
const t0 = Date.now();
const result = { mode: "agent-speech", classification: "live laptop speaker + microphone (Bunny's own synthesized speech)", startedAt: new Date().toISOString(), trials: [], notes: [] };
const log = (e, d = {}) => { const l = `[${Math.round((Date.now() - t0) / 1000)}s] ${e} ${JSON.stringify(d)}`; console.log(l); result.notes.push(l); };
const PHRASES = ["Say only the single word: Confirm.", "Reply with exactly these words: Yes, do it.", "Say exactly: Confirm, pause it now."];
const host = await startHost({ label: "t12-agentspeech" });
const pidsBefore = voiceWorkerPids();
try {
  await startTeam(host, makeProject(host.parent), TEAMS[0], log);
  await host.command("voice.session.open", { mode: "hands_free" });
  await sleep(1500);
  await host.command("voice.listen.start", { source: "hands_free" });
  for (let i = 0; i < 40 && !(await host.voice()).duplex?.active; i++) await sleep(250);
  log("handsfree.live", { aec: (await host.voice()).duplex?.aec ?? null });
  for (const phrase of PHRASES) {
    // A fresh voice-confirmable proposal each trial (typed, as the user would type it).
    // "pause the agent" proposes directly with one active Agent, or asks which; "the first one" then picks (typed, as the user).
    await host.command("voice.text", { text: "pause the agent" });
    await sleep(5000);
    let v = await host.voice();
    if (!v.proposal && v.clarification) {
      await host.command("voice.text", { text: "the first one" });
      await sleep(5000);
      v = await host.voice();
    }
    const proposal = v.proposal ? { id: v.proposal.id, action: v.proposal.action, confirmVia: v.proposal.confirmVia, agentId: v.proposal.agentId } : null;
    const agentBefore = proposal ? (await host.state()).agents.agents.find((a) => a.id === proposal.agentId)?.state ?? null : null;
    const typedTurn = (await host.command("voice.text", { text: phrase })).body?.data?.turnId ?? null;
    // Watch every turn for 20 s: a spoken (non-typed) turn here could only be Bunny's own speech or room noise.
    const spokenTurns = [];
    let spoke = null;
    for (const end = Date.now() + 20_000; Date.now() < end; ) {
      v = await host.voice();
      if (v.answer && v.turnId === typedTurn) spoke = v.answer;
      if (v.finalTranscript && v.turnId && !v.turnId.startsWith("t") && !spokenTurns.some((t) => t.turnId === v.turnId)) spokenTurns.push({ turnId: v.turnId, heard: v.finalTranscript, kind: v.turnKind, answer: null });
      const seen = spokenTurns.find((t) => t.turnId === v.turnId);
      if (seen && v.answer) { seen.answer = v.answer; seen.kind = v.turnKind; }
      await sleep(250);
    }
    const s = await host.state();
    const agentAfter = proposal ? s.agents.agents.find((a) => a.id === proposal.agentId)?.state ?? null : null;
    const trial = { phrase, proposal, bunnySaid: spoke, spokenTurnsHeard: spokenTurns, agentBefore, agentAfter, proposalStillPending: (await host.voice()).proposal?.id === proposal?.id, executed: agentBefore !== agentAfter && agentAfter === "PAUSED" };
    result.trials.push(trial);
    log("trial", trial);
    await host.command("voice.control.cancel", {});
    await sleep(1500);
  }
} finally {
  await host.command("voice.session.close", { source: "harness" }).catch(() => undefined);
  await sleep(1500);
  result.workerPidsAfterClose = voiceWorkerPids().filter((p) => !pidsBefore.includes(p));
  await host.stop();
  result.summary = { trials: result.trials.length, proposalsMade: result.trials.filter((t) => t.proposal).length, bunnySpoke: result.trials.filter((t) => t.bunnySaid).length, spokenTurnsHeard: result.trials.reduce((n, t) => n + t.spokenTurnsHeard.length, 0), executedBySelfSpeech: result.trials.filter((t) => t.executed).length };
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log("\nSUMMARY", JSON.stringify(result.summary));
}
