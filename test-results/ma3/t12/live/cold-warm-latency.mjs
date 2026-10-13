// M-A-3 T12 D35: cold vs warm local-model voice latency on a disposable Host. A cold trial runs only when Ollama reports no
// loaded model (it is never unloaded by this script: the harness waits for Ollama's own keep-alive expiry). Each trial is a
// typed voice chat turn answered aloud on the real speakers; the microphone is not opened (push-to-talk session, no listen).
// Usage: node test-results/ma3/t12/live/cold-warm-latency.mjs <out.json> [coldTrials=2]
import { writeFileSync } from "node:fs";
import { startHost, waitFor, voiceWorkerPids } from "./lib.mjs";

const out = process.argv[2];
const coldTrials = Number(process.argv[3] ?? 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loaded = async () => ((await (await fetch("http://127.0.0.1:11434/api/ps")).json()).models ?? []).map((m) => ({ name: m.name, expiresAt: m.expires_at }));
const QUESTIONS = ["Why is the sky blue?", "What makes bread rise?", "Why do cats purr?", "How do rainbows form?", "Why is the sea salty?", "What causes thunder?"];
const trials = [];
let q = 0;

async function turn(host, label, before) {
  const text = QUESTIONS[q++ % QUESTIONS.length];
  const prev = (await host.voice())?.generation ?? 0;
  const asked = await host.command("voice.text", { text });
  if (asked.status !== 200) throw new Error(`voice.text ${asked.status} ${JSON.stringify(asked.body)}`);
  const vs = await waitFor(async () => { const s = await host.voice(); return s && s.generation > prev && s.timing?.completedAt && !s.playing ? s : null; }, 180_000, 100);
  const t = vs.timing;
  const row = { label, question: text, modelsLoadedBefore: before, route: vs.route ? { provider: vs.route.provider, model: vs.route.model } : null, answerSource: vs.answerSource, answerChars: (vs.answer ?? "").length, finalToFirstTokenMs: t.firstTokenAt && t.finalAt ? t.firstTokenAt - t.finalAt : null, finalToFirstAudioMs: t.firstPlaybackAt && t.finalAt ? t.firstPlaybackAt - t.finalAt : null, finalToCompletedMs: t.completedAt - t.finalAt };
  trials.push(row);
  console.log(JSON.stringify(row));
  return row;
}

const host = await startHost({ label: "t12-coldwarm" });
const startedAt = new Date().toISOString();
try {
  const opened = await host.command("voice.session.open", { mode: "push_to_talk" });
  if (opened.status !== 200) throw new Error("voice open " + opened.status);
  await waitFor(async () => (await host.voice())?.engines?.tts ? true : null, 30_000);
  for (let c = 0; c < coldTrials; c++) {
    // Wait for Ollama's own keep-alive to unload every model (bounded); never unload anything ourselves.
    const deadline = Date.now() + 8 * 60_000;
    let models = await loaded();
    while (models.length && Date.now() < deadline) { await sleep(5000); models = await loaded(); }
    if (models.length) { trials.push({ label: "cold", skipped: "a model stayed loaded (another client); cold trial not run", modelsLoadedBefore: models }); continue; }
    await turn(host, "cold", models);
    await turn(host, "warm", await loaded());
    await turn(host, "warm", await loaded());
  }
} finally {
  await host.stop();
}
const pick = (label, k) => trials.filter((t) => t.label === label && t[k] != null).map((t) => t[k]);
const summary = (label) => ({ n: pick(label, "finalToFirstTokenMs").length, finalToFirstTokenMs: pick(label, "finalToFirstTokenMs"), finalToFirstAudioMs: pick(label, "finalToFirstAudioMs") });
writeFileSync(out, JSON.stringify({ classification: "LIVE disposable Host, typed voice chat turns, real local Ollama route, answers played on the real speakers; cold = Ollama reported no loaded model before the turn (natural keep-alive expiry, nothing unloaded by the harness)", startedAt, finishedAt: new Date().toISOString(), cold: summary("cold"), warm: summary("warm"), trials, workersAfterClose: voiceWorkerPids().length }, null, 2) + "\n");
