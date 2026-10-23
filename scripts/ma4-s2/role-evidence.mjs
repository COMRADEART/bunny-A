// MA4-S2 role evidence: aggregates the recorded held-out trials per model, role, arm and kind (no model runs).
// Usage: node --experimental-strip-types scripts/ma4-s2/role-evidence.mjs > docs/ma4-s2/evidence/role-evidence.json
import { readFileSync } from 'node:fs';
import { aggregate, compare } from '../../src/lib/bunny-host/ma4/role-performance.ts';

const runs = JSON.parse(readFileSync(new URL('../../docs/ma4-s2/evidence/heldout.json', import.meta.url), 'utf8')).runs;
const byArm = Object.fromEntries(['A', 'B', 'C'].map(arm => [arm, aggregate(runs.filter(r => r.arm === arm).map(r => ({ ...r, kind: 'all' })))]));
const byKind = aggregate(runs.filter(r => r.arm === 'A'));
const worker = arm => byArm[arm].find(p => p.role === 'Worker');
const comparisons = Object.fromEntries([['A', 'B'], ['A', 'C'], ['B', 'C']].map(([a, b]) => [`${a}vs${b}`, {
  final: compare(worker(a).final, worker(b).final), firstAttempt: compare(worker(a).firstAttempt, worker(b).firstAttempt) }]));
console.log(JSON.stringify({ source: 'docs/ma4-s2/evidence/heldout.json', byArm, baselineByKind: byKind, comparisons }, null, 1));
