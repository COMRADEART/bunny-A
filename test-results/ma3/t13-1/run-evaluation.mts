// M-A-3 T13.1 reproducible routing evaluation (§15). Run from the repo root:
//   node --experimental-strip-types test-results/ma3/t13-1/run-evaluation.mts
// Writes test-results/ma3/t13-1/eval/evaluation.json and evaluation.md.
//
// Evidence categories are explicit per component:
//   LIVE VERIFIED  the real local runtime answered (Ollama on this PC)
//   SIMULATED      injected advice/protocol fixtures (no TypeSafe network access)
//   NOT TESTED     the runtime, model or credential does not exist here
// The labelled set is author-labelled (not an independent benchmark); it measures agreement with those labels only.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRequirements } from "../../../src/lib/orch/router-requirements.ts";
import { applyDecisionAdvice, evaluateDecisions, percentile, type DecisionAdvice } from "../../../src/lib/bunny-host/intelligence.ts";
import { HostDatabase } from "../../../src/lib/bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../../../src/lib/bunny-host/model-capability.server.ts";
import { LayaRegistry, LAYA_BENCHMARKS, OLLAMA_LAYA_RUNTIME } from "../../../src/lib/bunny-host/laya.server.ts";

const out = join(import.meta.dirname, "eval");
mkdirSync(out, { recursive: true });
const STAND_IN = process.env.T131_STAND_IN ?? "qwen2.5-coder:7b";

const LABELLED: { prompt: string; expected: string }[] = [
  { prompt: "Say hello in one short sentence.", expected: "general" },
  { prompt: "Write a two-line friendly greeting for a team chat.", expected: "general" },
  { prompt: "What does a dock icon usually indicate?", expected: "general" },
  { prompt: "Give me a nickname for a cat named Pixel.", expected: "general" },
  { prompt: "Summarize the tradeoffs of two approaches", expected: "research" },
  { prompt: "Research the history of the QWERTY layout and cite sources.", expected: "research" },
  { prompt: "Investigate which open standards exist for calendar sync.", expected: "research" },
  { prompt: "Compare three message queues and recommend one with sources.", expected: "research" },
  { prompt: "Extract the invoice number from: Invoice 4471 was paid.", expected: "extraction" },
  { prompt: "Extract all email addresses from this text: ana@x.io, bo@y.org", expected: "extraction" },
  { prompt: "Pull the dates out of: Met 2026-03-14, shipped 2026-04-02.", expected: "extraction" },
  { prompt: "Extract the city names from: Paris, then Lyon, finally Nice.", expected: "extraction" },
  { prompt: "Solve 3x + 7 = 22 for x.", expected: "math" },
  { prompt: "Compute the integral of x^2 from 0 to 3.", expected: "math" },
  { prompt: "What is the derivative of sin(x) * x?", expected: "math" },
  { prompt: "Calculate 15% compound interest over 4 years on 1000.", expected: "math" },
  { prompt: "Prove that the square root of 2 is irrational.", expected: "reasoning" },
  { prompt: "If all bloops are razzies and some razzies are lazzies, are some bloops lazzies? Explain the logic.", expected: "reasoning" },
  { prompt: "Analyze the logical flaw in this argument step by step.", expected: "reasoning" },
  { prompt: "Work through this puzzle: three boxes, one label is true; deduce which box holds the prize.", expected: "reasoning" },
  { prompt: "Write a Python function that reverses a linked list.", expected: "coding" },
  { prompt: "Implement a debounce helper in TypeScript.", expected: "coding" },
  { prompt: 'Create hello.py containing print("BUNNY_ROUTE_OK"). Run the script and verify stdout.', expected: "coding" },
  { prompt: "Write a SQL query that returns the top five customers by revenue.", expected: "coding" },
  { prompt: "Debug the failing test in src/lib/bunny-host and fix it.", expected: "repository_coding" },
  { prompt: "Refactor the routing module in this repository and update its tests.", expected: "repository_coding" },
  { prompt: "Find where the repo registers HTTP routes and add a health endpoint.", expected: "repository_coding" },
  { prompt: "Fix the lint errors across this codebase and commit the change.", expected: "repository_coding" },
  { prompt: "Return a JSON object with fields name, age and city for a sample person.", expected: "structured_generation" },
  { prompt: "Produce a YAML config with three services and their ports.", expected: "structured_generation" },
  { prompt: "Generate a CSV table of five planets and their diameters.", expected: "structured_generation" },
  { prompt: "Output a JSON schema for a todo item.", expected: "structured_generation" },
];
const CLASSES = [...new Set(LABELLED.map((row) => row.expected))];

type Row = { expected: string; chosen: string; confidence: number | null; latencyMs: number };
function summarize(rows: Row[]) {
  const evaluation = evaluateDecisions(rows);
  const latencies = rows.map((row) => row.latencyMs);
  return { ...evaluation, latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) } };
}

// ---- A. BunnyRouter deterministic classifier (the authoritative router; no confidence output) ----
const router: Row[] = LABELLED.map(({ prompt, expected }) => {
  const started = performance.now();
  const chosen = classifyRequirements({ prompt, mode: "balanced", constraints: {} }).task_class;
  return { expected, chosen, confidence: null, latencyMs: Math.round((performance.now() - started) * 1000) / 1000 };
});

// ---- B. Local model (Ollama) as a classifier: LIVE when the runtime is up ----
async function ollamaUp() {
  try { return (await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
const up = await ollamaUp();
let local: { status: string; model: string; rows: Row[]; coldMs: number | null; unparsed: number } = { status: "NOT TESTED", model: STAND_IN, rows: [], coldMs: null, unparsed: 0 };
if (up) {
  const ask = async (prompt: string) => {
    const started = performance.now();
    const result = await OLLAMA_LAYA_RUNTIME.generate(STAND_IN, `Classify the request into exactly one label from: ${CLASSES.join(", ")}.\nReply with only the label.\nRequest: ${prompt}`, AbortSignal.timeout(180_000));
    return { result, ms: Math.round(performance.now() - started) };
  };
  const warm = await ask("Say hello.");
  local = { status: warm.result.ok ? "LIVE VERIFIED" : "NOT TESTED", model: STAND_IN, rows: [], coldMs: warm.ms, unparsed: 0 };
  if (warm.result.ok)
    for (const { prompt, expected } of LABELLED) {
      const { result, ms } = await ask(prompt);
      const text = result.output.toLowerCase();
      const chosen = CLASSES.find((label) => new RegExp(`\\b${label}\\b`).test(text)) ?? "unparsed";
      if (chosen === "unparsed") local.unparsed++;
      local.rows.push({ expected, chosen, confidence: null, latencyMs: ms });
    }
}

// ---- C. Laya: real discovery through the existing capability registry, then the benchmark pipeline ----
const directory = mkdtempSync(join(tmpdir(), "bunny-t131-eval-"));
const db = new HostDatabase(join(directory, "host.sqlite"));
let laya: Record<string, unknown>;
try {
  const registry = new ModelCapabilityRegistry(db, { availableProviders: () => ["ollama"] });
  await registry.refresh({ force: true });
  const snapshot = new LayaRegistry(db).snapshot(registry.snapshot(), up);
  const installed = registry.list("ollama").map((record) => record.model);
  // The Laya benchmark set run against a non-Laya stand-in, to exercise the real local inference path.
  // This is NOT a Laya result; it proves the pipeline only.
  // Scored like LayaRegistry: a class passes only when every one of its checks matches.
  const standIn: { taskClass: string; passed: boolean; matched: number; checks: number; latencyMs: number; outputs: string[] }[] = [];
  if (up)
    for (const taskClass of [...new Set(LAYA_BENCHMARKS.map((task) => task.taskClass))]) {
      const row = { taskClass, passed: false, matched: 0, checks: 0, latencyMs: 0, outputs: [] as string[] };
      for (const task of LAYA_BENCHMARKS.filter((check) => check.taskClass === taskClass)) {
        const started = performance.now();
        const result = await OLLAMA_LAYA_RUNTIME.generate(STAND_IN, task.prompt, AbortSignal.timeout(180_000));
        row.latencyMs += performance.now() - started;
        row.checks++;
        if (result.ok && task.expect.test(result.output.trim())) row.matched++;
        row.outputs.push(result.output.trim().slice(0, 40));
      }
      row.passed = row.matched === row.checks;
      row.latencyMs = Math.round(row.latencyMs / row.checks);
      standIn.push(row);
    }
  const loadedBytes = up ? await OLLAMA_LAYA_RUNTIME.loadedBytes(STAND_IN) : null;
  const digest = up ? ((await OLLAMA_LAYA_RUNTIME.digests())?.get(STAND_IN) ?? null) : null;
  laya = {
    discovery: up ? "LIVE VERIFIED" : "NOT TESTED",
    runtime: up ? "Ollama on 127.0.0.1:11434" : "offline",
    installedModels: installed,
    status: snapshot.status,
    layaModels: snapshot.models.length,
    detail: snapshot.detail,
    layaInference: "NOT TESTED (no Laya model is installed on this Host)",
    pipelineStandIn: { model: STAND_IN, digest, category: up ? "LIVE VERIFIED (pipeline only, not Laya)" : "NOT TESTED", results: standIn, loadedBytes },
  };
} finally {
  db.close();
  rmSync(directory, { recursive: true, force: true });
}

// ---- D. Hosted advice safety under injected advice (SIMULATED; not a TypeSafe quality claim) ----
const keys = ["claude::default", "codex::gpt-5.3", "ollama::qwen2.5-coder:7b", "ollama::laya:7b"];
const traits = { "claude::default": { local: false, tools: true }, "codex::gpt-5.3": { local: false, tools: true }, "ollama::qwen2.5-coder:7b": { local: true, tools: false }, "ollama::laya:7b": { local: true, tools: false } } as Record<string, { local: boolean; tools: boolean }>;
let seed = 1311;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const outcomes: Record<string, number> = { accept: 0, fallback: 0, clarify: 0, rejected: 0, router: 0 };
let falseEligibility = 0;
let widened = 0;
const trials = 5000;
const started = performance.now();
for (let i = 0; i < trials; i++) {
  const eligibleKeys = keys.filter(() => random() < 0.7);
  if (eligibleKeys.length === 0) eligibleKeys.push(keys[2]);
  const eligible = eligibleKeys.map((key) => ({ key, ...traits[key] }));
  const routerKey = eligibleKeys[Math.floor(random() * eligibleKeys.length)];
  const pool = [...keys, "cursor::default", "ollama::not-installed", "", "claude::default; rm -rf /"];
  const now = 1_000_000;
  const advice: DecisionAdvice | null = random() < 0.1 ? null : {
    source: "jev", recommendedKey: pool[Math.floor(random() * pool.length)] || null, confidence: random() < 0.1 ? null : random(),
    needsClarification: random() < 0.08, clarifyProbability: null, taskClass: null,
    generation: random() < 0.05 ? 0 : 1, issuedAt: random() < 0.05 ? now - 60_000 : now, answeredBy: "fixture",
  };
  const outcome = applyDecisionAdvice({ routerKey, eligible, advice, currentGeneration: 1, now });
  outcomes[outcome.action]++;
  if (!eligibleKeys.includes(outcome.finalKey)) falseEligibility++;
  const from = traits[routerKey], to = traits[outcome.finalKey];
  if (to && ((from.local && !to.local) || (!from.tools && to.tools))) widened++;
}
const adviceMs = performance.now() - started;
const simulated = {
  category: "SIMULATED",
  trials,
  outcomes,
  falseEligibility,
  widenedLocalityOrTools: widened,
  fallbackRate: (outcomes.fallback + outcomes.rejected + outcomes.router + outcomes.clarify) / trials,
  meanDecisionValidationUs: Math.round((adviceMs / trials) * 1000 * 100) / 100,
};

const result = {
  generatedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  labelledSet: { size: LABELLED.length, classes: CLASSES, note: "Author-labelled; measures agreement with these labels only." },
  router: { category: "LIVE VERIFIED (deterministic code)", ...summarize(router), confidence: "BunnyRouter emits no probability; calibration not applicable." },
  localModel: { category: local.status, model: local.model, coldStartMs: local.coldMs, unparsed: local.unparsed, ...(local.rows.length ? summarize(local.rows) : {}) },
  laya,
  typesafeJev: { live: "NOT TESTED (no authorized TypeSafe credential was provided)", accuracy: null, latencyMs: null, calibration: null },
  combined: { live: "NOT TESTED (requires hosted advice)", note: "With no advice the combined pipeline is BunnyRouter's choice by construction (Local Decision Policy)." },
  adviceSafety: simulated,
};
writeFileSync(join(out, "evaluation.json"), JSON.stringify(result, null, 2) + "\n");

const pct = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`);
const ms = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${value} ms`);
const md = `# M-A-3 T13.1 routing evaluation

Generated ${result.generatedAt} at source \`${result.sourceCommit}\`. Labelled set: ${LABELLED.length} author-labelled prompts across ${CLASSES.length} task classes (agreement with these labels only).

| System | Category | Task-class accuracy | Latency P50 | Latency P95 | Calibration (ECE) |
| --- | --- | --- | --- | --- | --- |
| BunnyRouter (deterministic) | LIVE VERIFIED (code) | ${pct(result.router.accuracy)} (${result.router.correct}/${result.router.total}) | ${result.router.latencyMs.p50} ms | ${result.router.latencyMs.p95} ms | not applicable (no probabilities) |
| Local model ${local.model} | ${local.status} | ${local.rows.length ? `${pct(result.localModel.accuracy)} (${result.localModel.correct}/${result.localModel.total})` : "n/a"} | ${ms(result.localModel.latencyMs?.p50)} | ${ms(result.localModel.latencyMs?.p95)} | not applicable (no probabilities) |
| Laya | NOT TESTED | n/a | n/a | n/a | n/a |
| TypeSafe Jev | NOT TESTED | n/a | n/a | n/a | n/a |
| Router + hosted advice | NOT TESTED live | n/a | n/a | n/a | n/a |

Local model cold start: ${ms(local.coldMs)}; unparsed answers: ${local.unparsed}.

## Laya

- Discovery: ${laya.discovery} against ${laya.runtime}. Installed models: ${(laya.installedModels as string[]).join(", ") || "none"}.
- Laya status: **${laya.status}**. ${laya.detail}
- Laya inference: ${laya.layaInference}.
- Benchmark pipeline exercised against stand-in \`${STAND_IN}\` (${(laya.pipelineStandIn as { category: string }).category}); runtime-reported digest \`${(laya.pipelineStandIn as { digest: string | null }).digest ?? "not reported"}\`. A class passes only when every check matches:
${((laya.pipelineStandIn as { results: { taskClass: string; passed: boolean; matched: number; checks: number; latencyMs: number }[] }).results).map((row) => `  - ${row.taskClass}: ${row.passed ? "passed" : "failed"} (${row.matched} of ${row.checks} checks), mean ${row.latencyMs} ms per check`).join("\n") || "  - not run"}

## Hosted advice safety (SIMULATED)

${trials} injected recommendations (random keys including out-of-set and injection strings, random confidence, stale generations and ages):

- Outcomes: ${Object.entries(outcomes).map(([key, value]) => `${key} ${value}`).join(", ")}.
- False eligibility (final route outside the eligible set): **${falseEligibility}**.
- Routes widened to hosted or tool-capable: **${widened}**.
- Fallback to BunnyRouter's choice: ${pct(simulated.fallbackRate)}.
- Mean validation cost: ${simulated.meanDecisionValidationUs} µs per decision.

These numbers check BunnyRouter's guard, not TypeSafe's decision quality.
`;
writeFileSync(join(out, "evaluation.md"), md);
console.log(JSON.stringify({ router: result.router.accuracy, local: result.localModel.accuracy ?? null, laya: laya.status, falseEligibility, widened }));
