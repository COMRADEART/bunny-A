// MA4-S1R4 role qualification (Phase B4): turn development-set runs into per-model, per-role verified outcomes and
// let the routing policy assign each role. Uses development evidence only (never G7).
//   node --experimental-strip-types scripts/ma4-s1r4/role-evidence.mjs <dev-evidence.json> [...] > role-evidence.json
// Role outcome per trial (deterministic, from the recorded gate evidence):
//   Worker   — the final implementation passed the independent acceptance tests.
//   Tester   — no Tester fault was attributed in any attempt and its tests ran against the implementation.
//   Planner  — no Planner fault (schema or contract) was attributed.
//   Reviewer — its verdict agreed with the deterministic gate (no false approval, no false rejection).
import { readFileSync } from 'node:fs';
import { assignRole } from '../../src/lib/bunny-host/ma4/hybrid.ts';

const files = process.argv.slice(2);
const rows = new Map();
const add = (model, role, ok, evaluator) => {
  const k = `${model}|${role}|${evaluator}`;
  const r = rows.get(k) ?? { model, role, passes: 0, samples: 0, evaluator };
  r.passes += ok ? 1 : 0; r.samples += 1; rows.set(k, r);
};
for (const f of files) {
  const e = JSON.parse(readFileSync(f, 'utf8'));
  const evaluator = `${e.version}/${e.strategy.id}`;
  for (const r of e.runs) {
    if (!['passed', 'failed', 'malformed_artifact'].includes(r.status)) continue; // infrastructure outcomes say nothing about a role
    const last = r.attempts.at(-1);
    const faults = new Set(r.failures.map(x => x.component));
    if (last) add(e.pins.Worker, 'Worker', !!last.hidden, evaluator);
    if (last?.tester?.ran) add(e.pins.Tester, 'Tester', !faults.has('tester'), evaluator);
    add(e.pins.Planner, 'Planner', !faults.has('planner'), evaluator);
    if (r.reviewer) add(e.pins.Reviewer, 'Reviewer', !r.reviewerFalseApproval && !(r.reviewer.verdict === 'reject' && r.status === 'passed'), evaluator);
  }
}
const evidence = [...rows.values()];
const candidates = ['qwen2.5-coder:7b', 'huihui_ai/qwen2.5-abliterate:7b'].map(model => ({ model, exclusion: null }));
const assignments = ['Planner', 'Worker', 'Tester', 'Reviewer'].map(role => assignRole(role, candidates, evidence));
console.log(JSON.stringify({ sources: files, evidence, assignments }, null, 2));
