import { z } from "zod";
import type { IntelligenceStore } from "./store.server.ts";

export const BENCHMARK_VERSION = "bunny-ma4-s1-synthetic-v1";
// Expectations are host-side only. The router receives aggregate evidence, never fixture answers.
const cases = [
  { id: "reasoning", prompt: "All dax are blick. All blick are wug. Are all dax wug? Reply yes or no.", valid: (s: string) => s.trim().toLowerCase() === "yes" },
  { id: "mathematics", prompt: "What is 17 * 19? Reply only the integer.", valid: (s: string) => s.trim() === "323" },
  { id: "coding", prompt: "Write a JavaScript function named add accepting a and b and returning their sum. Reply only with function source, no formatting.", valid: (s: string) => /^function\s+add\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s+a\s*\+\s*b\s*;?\s*\}$/.test(s.trim()) },
  { id: "structured", prompt: 'Return exactly one JSON object with the property "ok" set to true.', valid: (s: string) => { try { const v = JSON.parse(s); return v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && v.ok === true; } catch { return false; } } },
  { id: "tool-call-shape", prompt: 'Return JSON describing a proposed call to calculator with arguments a=2 and b=3: {"name":...,"arguments":{...}}. Do not execute anything.', valid: (s: string) => { try { const v = JSON.parse(s); return v.name === "calculator" && v.arguments?.a === 2 && v.arguments?.b === 3; } catch { return false; } } },
];
export const EvaluationSchema = z.object({
  provider: z.literal("openrouter"),
  version: z.literal(BENCHMARK_VERSION), model: z.string().min(1).max(180), at: z.number().int().positive(),
  samples: z.literal(5), passed: z.number().int().min(0).max(5), errors: z.number().int().min(0).max(5),
  timeouts: z.number().int().min(0).max(5), latencyMs: z.number().finite().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  outcomes: z.array(z.object({ id: z.string(), passed: z.boolean() }).strict()).length(5),
  source: z.literal("synthetic-benchmark"), toolExecutionMeasured: z.literal(false),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.outcomes.map(o => o.id)).size !== 5 || cases.some(c => !v.outcomes.some(o => o.id === c.id)) || v.passed !== v.outcomes.filter(o => o.passed).length || v.errors + v.passed > 5 || v.timeouts > v.errors) ctx.addIssue({ code: "custom", message: "Inconsistent benchmark evidence." });
});
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type EvaluationGateway = (prompt: string, signal: AbortSignal) => Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;

export class EvaluationEngine {
  store: IntelligenceStore;
  constructor(store: IntelligenceStore) { this.store = store; }
  async run(model: string, gateway: EvaluationGateway, signal: AbortSignal): Promise<Evaluation> {
    const config = this.store.configuration();
    if (!config.evaluationsAllowed || !config.models.includes(model)) throw new Error("Evaluation requires explicit model and evaluation permission.");
    let passed = 0, errors = 0, timeouts = 0, input: number | null = 0, output: number | null = 0;
    const outcomes: Evaluation["outcomes"] = []; const start = performance.now();
    for (const c of cases) {
      signal.throwIfAborted(); let valid = false;
      try {
        const r = await gateway(c.prompt, signal); signal.throwIfAborted(); valid = c.valid(r.text);
        input = input !== null && r.inputTokens !== null ? input + r.inputTokens : null;
        output = output !== null && r.outputTokens !== null ? output + r.outputTokens : null;
      } catch (e) {
        signal.throwIfAborted(); errors++; input = null; output = null;
        if (e instanceof Error && /timeout/i.test(e.message)) timeouts++;
      }
      if (valid) passed++; outcomes.push({ id: c.id, passed: valid });
    }
    const result = EvaluationSchema.parse({ provider: "openrouter", version: BENCHMARK_VERSION, model, at: Date.now(), samples: 5, passed, errors, timeouts,
      latencyMs: performance.now() - start, inputTokens: input, outputTokens: output, outcomes, source: "synthetic-benchmark", toolExecutionMeasured: false });
    this.store.db.db.prepare("INSERT INTO ma4_evaluations(model,record) VALUES(?,?)").run(model, JSON.stringify(result));
    return result;
  }
  /** Missing/stale/other benchmark versions are neutral. Valid evidence can only change ranking, never eligibility. */
  score(model: string, now = Date.now()): number | null {
    const rows = this.store.db.db.prepare("SELECT record FROM ma4_evaluations WHERE model=? ORDER BY id DESC LIMIT 10").all(model) as { record: string }[];
    for (const row of rows) {
      try {
        const result = EvaluationSchema.parse(JSON.parse(row.record));
        if (result.model !== model || now < result.at || now - result.at > 30 * 24 * 60 * 60_000) continue;
        return (result.passed / result.samples - 0.5) * 2;
      } catch { /* Invalid evidence never enters ranking. */ }
    }
    return null;
  }
}
