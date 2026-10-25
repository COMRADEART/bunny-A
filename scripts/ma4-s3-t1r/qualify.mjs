/**
 * Live C0 answers and a routing comparison. Direct Ollama only, one pinned local model.
 * Does not touch the reliability soak directory or its port.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { providerBase } from "../../src/lib/bunny-host/adapters.server.ts";
import { bunnyRoute, preferenceUnavailable } from "../../src/lib/bunny-host/router.ts";
import { loadSet, runOffline } from "./evaluate.mjs";

const MODEL = "huihui_ai/qwen2.5-abliterate:7b";
const DIGEST = "103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219";
const root = dirname(fileURLToPath(import.meta.url));
const evidence = join(root, "../../docs/ma4-s3-t1r/evidence");
mkdirSync(evidence, { recursive: true });
const offline = await runOffline();
writeFileSync(join(evidence, "offline.json"), JSON.stringify({
  classificationCountedAsSuccess: offline.classificationCountedAsSuccess,
  counts: offline.counts,
  verifiedCompletion: offline.verifiedCompletion,
  preferenceOfferedChoice: offline.preferenceOfferedChoice,
  outcomes: offline.rows.reduce((acc, row) => {
    const key = `${row.set}:${row.outcome}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}),
}, null, 2));

const tags = await fetch("http://127.0.0.1:11434/api/tags").then((response) => response.json());
const installed = (tags.models ?? []).find((model) => model.name === MODEL);
if (!installed || installed.digest !== DIGEST) {
  writeFileSync(join(evidence, "live.json"), JSON.stringify({
    status: "BLOCKED",
    reason: "Pinned local model is missing or its digest does not match. No substitute was called.",
    observed: installed?.digest ?? null,
  }, null, 2));
  process.exit(2);
}
const ps = await fetch("http://127.0.0.1:11434/api/ps").then((response) => response.json());
if ((ps.models ?? []).some((model) => model.name !== MODEL && model.size > 0)) {
  writeFileSync(join(evidence, "live.json"), JSON.stringify({
    status: "BLOCKED",
    reason: "Another model is resident. Live qualification was not started.",
    resident: ps.models.map((model) => model.name),
  }, null, 2));
  process.exit(2);
}

async function generate(prompt, keepAlive) {
  const started = performance.now();
  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      keep_alive: keepAlive,
      options: { temperature: 0, num_predict: 24 },
    }),
  });
  const body = await response.json();
  return {
    ms: Math.round(performance.now() - started),
    text: String(body.response ?? ""),
    tokens: body.eval_count ?? null,
    loadNs: body.load_duration ?? null,
    evalNs: body.eval_duration ?? null,
  };
}

const prompts = loadSet("holdout.json").tasks.filter((task) => task.complexity === "C0");
const cold = await generate(prompts[0].prompt, "10m");
const trials = [cold];
for (let i = 0; i < 2; i++) trials.push(await generate(prompts[0].prompt, "10m"));
const rest = [];
for (const task of prompts.slice(1)) rest.push({ id: task.id, expectToken: task.expectToken, ...(await generate(task.prompt, "10m")) });
const rows = [
  { id: prompts[0].id, expectToken: prompts[0].expectToken, phase: "cold", ...cold },
  ...trials.slice(1).map((row, index) => ({ id: prompts[0].id, expectToken: prompts[0].expectToken, phase: `warm-${index + 1}`, ...row })),
  ...rest.map((row) => ({ ...row, phase: "warm" })),
].map((row) => ({
  ...row,
  functionalCorrect: row.text.toLowerCase().includes(String(row.expectToken).toLowerCase()),
  verification: "harness-token",
  model: MODEL,
  digest: DIGEST,
}));

const controller = new AbortController();
const cancelStarted = performance.now();
const stream = await fetch("http://127.0.0.1:11434/api/generate", {
  method: "POST",
  signal: controller.signal,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, prompt: "Count from 1 to 400, one number per line.", stream: true, keep_alive: "10m", options: { temperature: 0, num_predict: 400 } }),
});
const reader = stream.body.getReader();
await reader.read();
controller.abort();
let cancelMs = null;
let cancelError = null;
try {
  while (true) {
    const step = await reader.read();
    if (step.done) break;
  }
} catch (error) {
  cancelError = error.name;
  cancelMs = Math.round(performance.now() - cancelStarted);
}
if (cancelMs == null) cancelMs = Math.round(performance.now() - cancelStarted);
const after = await fetch("http://127.0.0.1:11434/api/ps").then((response) => response.json());
await generate("Reply with the word done.", 0);

const baselineRoot = process.env.BUNNY_BASELINE;
let baseline = { status: "NOT TESTED", reason: "BUNNY_BASELINE was not set." };
if (baselineRoot) {
  const imported = await import(pathToFileURL(join(baselineRoot, "src/lib/bunny-host/router.ts")).href);
  const localNames = (tags.models ?? []).filter((model) => !model.remote_host && !/:cloud$/i.test(model.name)).map((model) => model.name);
  const provider = { ...providerBase("ollama"), installed: true, authenticated: true, authenticatedState: "not_required", availability: "ready", capabilities: ["text"], local_or_cloud: "local", current_model: MODEL, models: localNames, remoteModels: (tags.models ?? []).filter((model) => model.remote_host || /:cloud$/i.test(model.name)).map((model) => model.name) };
  const run = (route, preference) => {
    try {
      const decision = route({ prompt: prompts[0].prompt, mode: "fast", providers: [provider], constraints: { localOnly: true, preferredLocalModel: preference } });
      return { model: decision.recommended_model, provider: decision.recommended_provider };
    } catch (error) {
      return { error: error.message };
    }
  };
  const sample = [
    { id: "installed-preference", preference: MODEL, t1: run(bunnyRoute, MODEL), baseline: run(imported.bunnyRoute, MODEL) },
    { id: "other-installed-preference", preference: "qwen2.5-coder:7b", t1: run(bunnyRoute, "qwen2.5-coder:7b"), baseline: run(imported.bunnyRoute, "qwen2.5-coder:7b") },
    { id: "missing-preference", preference: "not-installed:7b", t1: run(bunnyRoute, "not-installed:7b"), baseline: run(imported.bunnyRoute, "not-installed:7b") },
  ];
  baseline = {
    commit: spawnSync("git", ["-C", baselineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    preferenceMessage: preferenceUnavailable("missing:7b", [provider]),
    localModels: localNames,
    sample,
  };
}

const warm = rows.filter((row) => row.phase !== "cold").map((row) => row.ms).sort((a, b) => a - b);
const median = warm[Math.floor(warm.length / 2)] ?? null;
const correct = rows.filter((row) => row.functionalCorrect).length;
writeFileSync(join(evidence, "live.json"), JSON.stringify({
  status: "MEASURED",
  model: MODEL,
  digest: DIGEST,
  ollama: "0.40.9",
  quantization: "Q4_K_M",
  trials: rows,
  summary: {
    coldMs: cold.ms,
    warmMedianMs: median,
    warmMinMs: warm[0] ?? null,
    warmMaxMs: warm.at(-1) ?? null,
    correct,
    answered: rows.length,
    cancelled: cancelError === "AbortError",
    cancelMs,
    cancelError,
    residentAfterCancel: (after.models ?? []).map((model) => ({ name: model.name, size: model.size ?? null })),
  },
  note: "Answers were generated on the pinned installed model. They are not a product speed-up and not a claim that every preference routes here.",
}, null, 2));
writeFileSync(join(evidence, "routing-compare.json"), JSON.stringify(baseline, null, 2));
console.log(JSON.stringify({ correct, answered: rows.length, coldMs: cold.ms, warmMedianMs: median, cancelMs, cancelError }));
