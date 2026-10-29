// MA5-S2 Phase 4 (P4-2) separately reported experiment: would a smaller dedicated local model answer spoken questions
// in time while agents keep the main model busy? Direct Ollama requests only; Bunny's routing, pins and permissions are
// not touched and nothing here is product behaviour. Background: BG lanes of agent-style generations on the main model,
// back to back. Foreground: the spoken-answer prompt on the candidate model, first on an idle GPU, then under that load.
// Usage: node scripts/ma5-s2/experiment-voice-model.mjs <candidate-model>  (main model: the router's 7B pick)
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writeEvidence } from "../evidence-guard.mjs";

const OLLAMA = "http://127.0.0.1:11434";
const MAIN = process.env.MAIN_MODEL ?? "huihui_ai/qwen2.5-abliterate:7b";
const CANDIDATE = process.argv[2];
const N = Number(process.env.N ?? 12);
const BG = Number(process.env.BG ?? 2);
if (!CANDIDATE) throw new Error("usage: experiment-voice-model.mjs <candidate-model>");
const PROMPT = "You are Bunny, a spoken assistant. Answer in one or two short sentences, plain words, no lists.\n\nIn one short sentence, what does a rabbit eat?";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gpu = () => Number(spawnSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" }).stdout) || null;
function stats(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  return v.length ? { n: v.length, p50: at(50), p95: at(95), max: v.at(-1) } : { n: 0 };
}
async function generate(model, prompt, numPredict) {
  const t0 = Date.now();
  let first = null, text = "", buffer = "";
  try {
    // A request Ollama never serves is a result (recorded as timedOut), not a crash.
    const res = await fetch(`${OLLAMA}/api/generate`, { method: "POST", signal: AbortSignal.timeout(120_000), body: JSON.stringify({ model, prompt, stream: true, options: { num_predict: numPredict } }) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) { const part = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); if (part.response) { first ??= Date.now() - t0; text += part.response; } }
    }
  } catch {
    return { firstTokenMs: first, totalMs: Date.now() - t0, text, timedOut: true };
  }
  return { firstTokenMs: first, totalMs: Date.now() - t0, text };
}
const ps = async () => ((await (await fetch(`${OLLAMA}/api/ps`)).json()).models ?? []).map((m) => ({ name: m.name, sizeVramMiB: Math.round((m.size_vram ?? 0) / 2 ** 20), sizeMiB: Math.round((m.size ?? 0) / 2 ** 20) }));

const out = { schema: "ma5-s2-p4.voice-model-experiment/1", at: new Date().toISOString(), mainModel: MAIN, candidate: CANDIDATE, backgroundLanes: BG, note: "Direct Ollama requests; not Bunny product behaviour. First token = first streamed text from Ollama (no TTS)." };
const log = (...a) => console.error(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
await generate(MAIN, "Say ok.", 4);
log("main warm", JSON.stringify(await ps()));
await generate(CANDIDATE, PROMPT, 40);
log("candidate warm", JSON.stringify(await ps()));
const idle = [];
for (let i = 0; i < 5; i++) idle.push(await generate(CANDIDATE, PROMPT, 60));
out.idle = { firstTokenMs: stats(idle.map((r) => r.firstTokenMs)), totalMs: stats(idle.map((r) => r.totalMs)), sample: idle[0].text.trim().slice(0, 200) };

let stop = false;
const bg = [];
const lane = async () => { while (!stop) { const r = await generate(MAIN, "Write a 120-word explanation of how tides work.", 200); bg.push({ ...r, doneAt: Date.now() }); } };
const lanes = Array.from({ length: BG }, lane);
await sleep(3_000);
const start = Date.now();
const load = [];
const mem = [];
let models = null;
for (let i = 0; i < N; i++) {
  const r = await generate(CANDIDATE, PROMPT, 60);
  load.push(r);
  log(`load ${i}: first ${r.firstTokenMs} ms`);
  mem.push(gpu());
  models ??= await ps();
  await sleep(3_000);
}
const end = Date.now();
stop = true;
await Promise.all(lanes);
const inWindow = bg.filter((r) => r.doneAt >= start && r.doneAt <= end);
out.underLoad = { timedOut: load.filter((r) => r.timedOut).length, firstTokenMs: stats(load.map((r) => r.firstTokenMs)), totalMs: stats(load.map((r) => r.totalMs)), gpuMemoryMiBMax: Math.max(...mem.filter(Boolean)), loadedModels: models };
out.background = { completedInWindow: inWindow.length, perMinute: Math.round((inWindow.length / ((end - start) / 60_000)) * 100) / 100, totalMs: stats(bg.map((r) => r.totalMs)) };
mkdirSync("docs/ma5-s2/evidence/voice", { recursive: true });
writeEvidence("docs/ma5-s2/evidence/voice/voice-model-experiment.json", out, []);
console.log(JSON.stringify({ idle: out.idle.firstTokenMs, load: out.underLoad.firstTokenMs, bgPerMin: out.background.perMinute, gpu: out.underLoad.gpuMemoryMiBMax, models: out.underLoad.loadedModels }));
