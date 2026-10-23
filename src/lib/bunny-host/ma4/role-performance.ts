/**
 * MA4-S2 model and agent performance learning (pure). Aggregates verified workflow outcomes per model, role and task
 * kind, separating model capability (did this role's artifact hold up under deterministic checks?) from orchestration
 * (did the team reach a pass?). Every rate carries its sample size and a 95 % Wilson interval; comparisons refuse to
 * name a winner unless the intervals do not overlap. Output feeds the existing assignRole() as RoleEvidence.
 */
import { wilsonLower, type AgentRole, type RoleEvidence } from "./hybrid.ts";

export function wilsonInterval(passes: number, samples: number, z = 1.96): [number, number] {
  if (samples <= 0) return [0, 1];
  const upper = 1 - wilsonLower(samples - passes, samples, z);
  return [wilsonLower(passes, samples, z), upper];
}
export type Rate = { passes: number; samples: number; rate: number | null; interval: [number, number] };
const rate = (passes: number, samples: number): Rate => ({ passes, samples, rate: samples ? passes / samples : null, interval: wilsonInterval(passes, samples) });

/** One verified trial as the evaluation records it (only Host-observed facts). */
export type TrialFacts = {
  kind: string; status: string; repairsUsed: number;
  calls: { role: AgentRole; model: string; ok: boolean; durationMs: number }[];
  failures: { category: string; component: string }[];
  attempts: { tester: { ran: boolean; passed: boolean } }[];
  reviewer: { verdict: "approve" | "reject" } | null;
};
export type RolePerformance = {
  model: string; role: AgentRole; kind: string;
  /** Team-level, attributed to the Worker only: first-attempt and final pass. */
  firstAttempt?: Rate; final?: Rate;
  /** Role-level: calls that returned a usable artifact; artifacts never blamed by the deterministic attribution. */
  structured: Rate; held: Rate;
  latencyMs: { median: number | null; p95: number | null };
  failureCauses: Record<string, number>;
};

const COMPONENT: Record<AgentRole, string> = { Planner: "planner", Worker: "worker", Tester: "tester", Reviewer: "reviewer" };
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null; };

export function aggregate(trials: readonly TrialFacts[]): RolePerformance[] {
  const keys = new Map<string, { model: string; role: AgentRole; kind: string; trials: TrialFacts[] }>();
  for (const t of trials) for (const c of t.calls) {
    const k = `${c.model}|${c.role}|${t.kind}`;
    if (!keys.has(k)) keys.set(k, { model: c.model, role: c.role, kind: t.kind, trials: [] });
    const entry = keys.get(k)!;
    if (!entry.trials.includes(t)) entry.trials.push(t);
  }
  return [...keys.values()].map(({ model, role, kind, trials: ts }) => {
    const calls = ts.flatMap(t => t.calls.filter(c => c.model === model && c.role === role));
    const blamed = ts.filter(t => t.failures.some(f => f.component === COMPONENT[role])).length;
    const causes = ts.flatMap(t => t.failures.filter(f => f.component === COMPONENT[role]).map(f => f.category)).reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {} as Record<string, number>);
    const out: RolePerformance = { model, role, kind, structured: rate(calls.filter(c => c.ok).length, calls.length), held: rate(ts.length - blamed, ts.length),
      latencyMs: { median: pct(calls.map(c => c.durationMs), 0.5), p95: pct(calls.map(c => c.durationMs), 0.95) }, failureCauses: causes };
    if (role === "Worker") Object.assign(out, { firstAttempt: rate(ts.filter(t => t.status === "passed" && t.repairsUsed === 0).length, ts.length), final: rate(ts.filter(t => t.status === "passed").length, ts.length) });
    return out;
  });
}

/** "a" is better than "b" only when a's whole interval lies above b's. Small or noisy differences are "unresolved". */
export function compare(a: Rate, b: Rate): "a" | "b" | "unresolved" {
  if (a.samples < 3 || b.samples < 3) return "unresolved";
  return a.interval[0] > b.interval[1] ? "a" : b.interval[0] > a.interval[1] ? "b" : "unresolved";
}

/** RoleEvidence for assignRole(): a role "passes" a trial when its artifacts were never blamed by the gate. */
export function toRoleEvidence(perf: readonly RolePerformance[], evaluator: string): RoleEvidence[] {
  return perf.map(p => ({ model: p.model, role: p.role, passes: p.held.passes, samples: p.held.samples, evaluator }));
}

/** One-sided exact sign test: P(X >= wins) for X ~ Binomial(wins + losses, 1/2). Ties are ignored. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  let p = 0, c = 1;
  for (let k = 0; k <= n; k++) { if (k >= wins) p += c; c = c * (n - k) / (k + 1); }
  return Math.min(1, p / 2 ** n);
}
