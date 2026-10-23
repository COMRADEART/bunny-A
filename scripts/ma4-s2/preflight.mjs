// MA4-S2 evaluation pre-flight (no model is involved). In the OS-enforced sandbox: every reference passes its hidden
// tests, and every debugging task's quoted buggy code FAILS them (the task is a real defect). Statically: the suites are
// disjoint from G7, the S1R4 dev set and the S1R2 benchmarks (module and function names), and the task hash is printed.
//   node --experimental-strip-types scripts/ma4-s2/preflight.mjs [--out docs/ma4-s2/evidence/preflight.json]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { S2_TASKS, S2_EVAL_VERSION } from './eval-tasks.mjs';
import { G7_TASKS } from '../ma4-s1r2/g7-tasks.mjs';
import { DEV_TASKS } from '../ma4-s1r4/dev-tasks.mjs';
import { TASKS as BENCH } from '../ma4-s1r2/bench-tasks.mjs';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const RUN = 'import sys,unittest\nsys.path.insert(0,".")\nr=unittest.TextTestRunner(verbosity=0).run(unittest.defaultTestLoader.loadTestsFromName("test_hidden"))\nsys.exit(0 if r.wasSuccessful() and r.testsRun else 1)\n';
const run = (t, source) => runSandboxed({ files: { [`${t.module}.py`]: source, 'test_hidden.py': t.hiddenTests, 'run.py': RUN }, argv: ['python3', '-I', '-S', 'run.py'], timeoutMs: 15000 });
const defs = src => [...String(src ?? '').matchAll(/^(?:def|class) (\w+)/gm)].map(m => m[1]);

const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error(`Sandbox unavailable: ${sandbox.reason}`);
const others = [...G7_TASKS, ...DEV_TASKS, ...BENCH];
const otherModules = new Set(others.map(t => t.module).filter(Boolean)), otherDefs = new Set(others.flatMap(t => defs(t.reference)));
const report = { version: S2_EVAL_VERSION, taskHash: createHash('sha256').update(JSON.stringify(S2_TASKS)).digest('hex'), sandbox, at: new Date().toISOString(),
  splits: Object.fromEntries(['train', 'qualify', 'heldout'].map(s => [s, S2_TASKS.filter(t => t.split === s).map(t => t.id)])), tasks: [] };
for (const t of S2_TASKS) {
  const ref = await run(t, t.reference);
  const bug = t.kind === 'debugging' ? t.spec.slice(t.spec.indexOf('\n') + 1) : null;
  const buggy = bug ? await run(t, bug + '\n') : null;
  const overlap = [...(otherModules.has(t.module) ? [`module ${t.module}`] : []), ...defs(t.reference).filter(d => otherDefs.has(d)).map(d => `def ${d}`)];
  report.tasks.push({ id: t.id, split: t.split, kind: t.kind, referencePasses: ref.exitCode === 0, buggyFails: buggy ? buggy.exitCode !== 0 : null, overlap });
  console.log(`${t.id}: reference ${ref.exitCode === 0 ? 'passes' : 'FAILS'}${buggy ? `, buggy ${buggy.exitCode !== 0 ? 'fails (ok)' : 'PASSES (bad task)'}` : ''}${overlap.length ? `, OVERLAP ${overlap}` : ''}`);
}
report.ok = report.tasks.every(t => t.referencePasses && t.buggyFails !== false && !t.overlap.length);
console.log(JSON.stringify({ ok: report.ok, taskHash: report.taskHash, counts: Object.fromEntries(Object.entries(report.splits).map(([k, v]) => [k, v.length])) }));
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); }
process.exitCode = report.ok ? 0 : 1;
