// MA4-S1R2 G7 qualification. PRE-REGISTERED before any S1R2 G7 generation (do not edit after outputs are seen):
//   * Workflow: src/lib/bunny-host/ma4/coding-workflow.server.ts (Planner → Worker ∥ Tester → static → sandboxed tests →
//     Reviewer → deterministic gate), max 2 repairs, every role pinned to PIN below through the production Ollama
//     execute() path (served-model receipt checked). Generated code runs ONLY in the OS-enforced WSL2 sandbox.
//   * Trials: the unchanged G7 v2 specification 3x (its original rule: hidden tests AND all Tester tests pass);
//     10 held-out tasks 2x each (rule: hidden tests AND >= 1 reference-validated Tester test, all of which pass).
//   * Model-quality threshold: G7 PASS iff held-out >= 14/20 trials pass AND v2 regression >= 2/3.
//   * Safety invariants (must be 100%): no pin violation or substitution; Planner precedes Worker/Tester and the
//     Reviewer runs last; acceptance equals the deterministic gate (reviewer never overrides); statuses match the gate;
//     one controlled cancellation trial ends "cancelled" with no sandbox run and no live request left.
//   * No retries of whole trials, no cherry-picking; every trial is recorded.
// MA4-S1R3 harness-only changes (tasks, trials, rules, threshold and invariants unchanged): G7_OUT selects the evidence
// file so historical S1R2 evidence is never overwritten; each run also records the S1R3 failure attributions and repairs.
// G7_RESUME=1 continues an interrupted run in the same G7_OUT (same task hash and pin required): recorded trials are kept
// unchanged and only missing ones run. The model is unloaded after every trial so Ollama's runner memory cannot accumulate.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { freemem } from 'node:os';
import { G7_TASKS, G7_VERSION } from './g7-tasks.mjs';
import { runCodingWorkflow } from '../../src/lib/bunny-host/ma4/coding-workflow.server.ts';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';
import { execute } from '../../src/lib/orch/exec.server.ts';

const PIN = process.env.G7_PIN ?? 'qwen2.5-coder:7b';
const TRIALS = { regression: 3, heldout: 2 };
const OUT = process.env.G7_OUT ?? `docs/ma4-s1r2/evidence/g7${process.env.G7_PIN ? '-' + PIN.replace(/[^a-z0-9]+/gi, '_') : ''}.json`;
const ORIGIN = 'http://127.0.0.1:11434';
const realFetch = globalThis.fetch; let refused = 0, live = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== ORIGIN) { refused++; throw new Error('G7 network allowlist refused ' + url.origin); }
  if (url.pathname !== '/api/generate') return realFetch(input, init);
  live++; try { return await realFetch(input, init); } finally { live--; }
};
const sha = v => createHash('sha256').update(v).digest('hex');
const pins = { Planner: PIN, Worker: PIN, Tester: PIN, Reviewer: PIN };
const call = async ({ model, prompt, schema, signal }) => {
  if (freemem() < 2.5 * 1024 ** 3) return { ok: false, error: 'Free memory below 2.5 GiB; refusing to load more work.', durationMs: 0 };
  const started = Date.now();
  const r = await execute({ taskId: 'g7-' + randomUUID(), provider: 'ollama', model, prompt, localOnly: true, numCtx: 8192, numPredict: 2048, format: schema }, { signal, timeoutMs: 240_000 });
  const durationMs = Date.now() - started;
  return r.ok ? { ok: true, text: r.output ?? '', servedModel: r.receipt?.model ?? '', durationMs } : { ok: false, error: r.error ?? 'failed', stopped: !!r.stopped, durationMs };
};

const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error('Sandbox unavailable: dynamic execution BLOCKED; G7 not run.');
const fresh = { version: G7_VERSION, pin: PIN, trials: TRIALS, startedAt: new Date().toISOString(), sandbox, taskHash: sha(JSON.stringify(G7_TASKS)), preflight: [], runs: [] };
const evidence = process.env.G7_RESUME === '1' && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : fresh;
if (evidence !== fresh) {
  if (evidence.taskHash !== fresh.taskHash || evidence.pin !== PIN || evidence.g7) throw new Error('Resume refused: different task set or pin, or the run is already complete.');
  (evidence.resumes ??= []).push({ at: fresh.startedAt, keptTrials: evidence.runs.length, sandbox });
}
const preflight = evidence === fresh ? evidence.preflight : (evidence.resumes.at(-1).preflight = []);
const unload = () => fetch(ORIGIN + '/api/generate', { method: 'POST', body: JSON.stringify({ model: PIN, keep_alive: 0 }) }).then(r => r.text()).catch(() => {});
const save = () => { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n'); };

// Pre-flight: each frozen reference passes its hidden tests, so a failure is never the harness's fault.
for (const t of G7_TASKS) {
  const r = await runSandboxed({ files: { [`${t.module}.py`]: t.reference, 'test_hidden.py': t.hiddenTests, 'run.py': 'import sys,unittest\nsys.path.insert(0,".")\nr=unittest.TextTestRunner(verbosity=0).run(unittest.defaultTestLoader.loadTestsFromName("test_hidden"))\nsys.exit(0 if r.wasSuccessful() and r.testsRun else 1)\n' }, argv: ['python3', '-I', '-S', 'run.py'], timeoutMs: 15000 });
  preflight.push({ task: t.id, referencePasses: r.exitCode === 0 });
  if (r.exitCode !== 0) { save(); throw new Error(`Reference for ${t.id} fails its hidden tests: ${r.stderr.slice(-300)}`); }
}
save();

const order = (calls) => {
  const p = calls.find(c => c.role === 'Planner'), rv = calls.filter(c => c.role === 'Reviewer');
  return !!p && calls.filter(c => c.role === 'Worker' || c.role === 'Tester').every(c => c.startedAt >= p.endedAt) && rv.every(r => calls.every(c => c === r || c.endedAt <= r.startedAt));
};
for (const task of G7_TASKS) {
  const n = task.kind === 'regression' ? TRIALS.regression : TRIALS.heldout;
  for (let trial = 1; trial <= n; trial++) {
    if (evidence.runs.some(r => r.task === task.id && r.trial === trial)) continue;
    const started = Date.now();
    const r = await runCodingWorkflow(task, { call, sandbox: runSandboxed, pins, maxRepairs: 2, onEvent: e => console.log(`  ${task.id}#${trial} ${e}`) });
    const final = r.attempts.at(-1);
    evidence.runs.push({ task: task.id, kind: task.kind, trial, status: r.status, reason: r.reason, repairsUsed: r.repairsUsed, durationMs: Date.now() - started,
      attempts: r.attempts, repairs: r.repairs, failures: r.failures, contractVersion: r.contractVersion, reviewer: r.reviewer, reviewerFalseApproval: r.reviewerFalseApproval, reviewerFalseRejection: r.reviewerFalseRejection, workerTesterConcurrent: r.workerTesterConcurrent,
      calls: r.calls.map(({ role, model, attempt, ok, durationMs, servedModel, startedAt, endedAt }) => ({ role, model, attempt, ok, durationMs, servedModel, startedAt, endedAt })),
      invariants: { pinsHeld: r.calls.every(c => c.model === pins[c.role] && (!c.ok || c.servedModel === pins[c.role])), ordering: r.status === 'passed' || r.status === 'failed' ? order(r.calls) : null,
        gateIsAuthority: (r.status === 'passed') === !!final?.accepted || !['passed', 'failed'].includes(r.status) },
      finalSourceSha256: r.finalSource ? sha(r.finalSource) : null, finalSource: r.finalSource?.slice(0, 2500) ?? null });
    console.log(`${task.id}#${trial}: ${r.status} (${r.reason})`);
    save();
    await unload();
  }
}

// Controlled cancellation: abort as soon as the Worker starts.
{
  const controller = new AbortController(); let sandboxRuns = 0;
  const watching = async (req) => { if (req.role === 'Worker') setTimeout(() => controller.abort(), 1000); return call(req); };
  const r = await runCodingWorkflow(G7_TASKS[1], { call: watching, sandbox: async (q, s) => { sandboxRuns++; return runSandboxed(q, s); }, pins, signal: controller.signal });
  await new Promise(res => setTimeout(res, 500));
  evidence.cancellation = { status: r.status, sandboxRuns, liveRequestsAfter: live, calls: r.calls.map(c => ({ role: c.role, ok: c.ok })) };
  console.log('cancellation:', JSON.stringify(evidence.cancellation));
}

const held = evidence.runs.filter(r => r.kind !== 'regression'), reg = evidence.runs.filter(r => r.kind === 'regression');
const inv = evidence.runs.map(r => r.invariants);
evidence.summary = {
  heldout: { passed: held.filter(r => r.status === 'passed').length, trials: held.length },
  regression: { passed: reg.filter(r => r.status === 'passed').length, trials: reg.length },
  byKind: Object.fromEntries(['simple', 'intermediate', 'debugging', 'planning'].map(k => [k, `${held.filter(r => r.kind === k && r.status === 'passed').length}/${held.filter(r => r.kind === k).length}`])),
  statuses: evidence.runs.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
  repairsUsed: evidence.runs.reduce((a, r) => a + r.repairsUsed, 0),
  repairsByTarget: evidence.runs.flatMap(r => r.repairs ?? []).reduce((a, x) => ({ ...a, [`${x.target}:${x.outcome}`]: (a[`${x.target}:${x.outcome}`] ?? 0) + 1 }), {}), passedAfterRepair: evidence.runs.filter(r => r.status === 'passed' && r.repairsUsed > 0).length,
  reviewerFalseApprovals: evidence.runs.filter(r => r.reviewerFalseApproval).length, reviewerFalseRejections: evidence.runs.filter(r => r.reviewerFalseRejection).length,
  invariants: { pinsHeld: inv.every(i => i.pinsHeld), ordering: inv.every(i => i.ordering !== false), gateIsAuthority: inv.every(i => i.gateIsAuthority), cancellation: evidence.cancellation.status === 'cancelled' && evidence.cancellation.sandboxRuns === 0 && evidence.cancellation.liveRequestsAfter === 0 },
  externalRequestsRefused: refused,
};
const s = evidence.summary;
evidence.g7 = s.heldout.passed >= 14 && s.regression.passed >= 2 && Object.values(s.invariants).every(Boolean) ? 'PASS' : 'FAIL';
evidence.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ g7: evidence.g7, ...s }, null, 1));
