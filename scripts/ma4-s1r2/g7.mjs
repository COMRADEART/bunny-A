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
// MA4-S1R4 harness-only changes (tasks, trials, rules, threshold and invariants unchanged): G7_STRATEGY=s1r4 selects the
// S1R4 workflow strategy (default: the S1R3 workflow, byte-identical requests); G7_PINS=Role=model,... overrides single
// roles (the router's role assignment); the per-role sampling the strategy requests is forwarded to Ollama; each run
// also records Worker samples, tool receipts and per-call token receipts.
// MA4-S1R4-G7C harness-only change (tasks, hidden tests, references, rules, threshold and repairs unchanged): G7_CLOUD=groq
// runs ONLY the 3 v2 trials with Worker and Tester on the owner-approved groq/openai/gpt-oss-120b (scripts/ma4-s1r4/
// g7c-cloud.mjs: <= 4 requests per trial, a refused 5th call ends the trial, <= 12 total), Planner/Reviewer local. The
// cancellation trial is not rerun (it would spend cloud budget; the local result stands). The approval is revoked after.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { freemem } from 'node:os';
import { G7_TASKS, G7_VERSION } from './g7-tasks.mjs';
import { runCodingWorkflow, STRATEGY_S1R3, STRATEGY_S1R4 } from '../../src/lib/bunny-host/ma4/coding-workflow.server.ts';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';
import { execute } from '../../src/lib/orch/exec.server.ts';

const PIN = process.env.G7_PIN ?? 'qwen2.5-coder:7b';
const TRIALS = { regression: 3, heldout: 2 };
const OUT = process.env.G7_OUT ?? `docs/ma4-s1r2/evidence/g7${process.env.G7_PIN ? '-' + PIN.replace(/[^a-z0-9]+/gi, '_') : ''}.json`;
const ORIGIN = 'http://127.0.0.1:11434';
const CLOUD = process.env.G7_CLOUD === 'groq' ? await import('../ma4-s1r4/g7c-cloud.mjs') : null;
if (process.env.G7_CLOUD && !CLOUD) throw new Error('Only G7_CLOUD=groq is approved.');
if (CLOUD && process.env.G7_RESUME === '1') throw new Error('Cloud runs cannot resume: the request caps are per run.');
const realFetch = globalThis.fetch; let refused = 0, live = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)), cloudUrl = !!CLOUD && url.origin === CLOUD.ORIGIN && url.pathname === CLOUD.PATH;
  if (url.origin !== ORIGIN && !cloudUrl) { refused++; throw new Error('G7 network allowlist refused ' + url.origin); }
  if (!cloudUrl && url.pathname !== '/api/generate') return realFetch(input, init);
  live++; try { return await realFetch(input, init); } finally { live--; }
};
const sha = v => createHash('sha256').update(v).digest('hex');
const STRATEGY = process.env.G7_STRATEGY === 's1r4' ? STRATEGY_S1R4 : STRATEGY_S1R3;
const pins = { Planner: PIN, Worker: PIN, Tester: PIN, Reviewer: PIN, ...Object.fromEntries((process.env.G7_PINS ?? '').split(',').filter(Boolean).map(kv => kv.split('='))) };
if (CLOUD) Object.assign(pins, { Worker: CLOUD.MODEL, Tester: CLOUD.MODEL });
if (Object.values(pins).some(m => m.endsWith(':cloud'))) throw new Error('cloud-backed tags are refused');
const loaded = CLOUD && await CLOUD.loadCloud();
const cloud = CLOUD && CLOUD.createCloud({ ...loaded, fetcher: (u, i) => fetch(u, i), forbidden: G7_TASKS.flatMap(t => [t.hiddenTests, t.reference]) });
const cloudEvidence = () => ({ provider: CLOUD.PROVIDER, model: CLOUD.MODEL, caps: CLOUD.CAPS, reasoningHeadroomTokens: CLOUD.REASONING_TOKENS, attestation: loaded.attestation, approval: loaded.approval,
  assignments: Object.fromEntries(Object.entries(pins).map(([role, m]) => [role, m === CLOUD.MODEL ? `cloud:${CLOUD.PROVIDER}/${m}` : `local:ollama/${m}`])),
  requests: cloud.sent(), refusedByCap: cloud.calls.filter(c => !c.sent).length, calls: cloud.calls,
  usage: ['promptTokens', 'completionTokens', 'reasoningTokens'].reduce((a, k) => ({ ...a, [k]: cloud.calls.reduce((n, c) => n + (c.usage?.[k] ?? 0), 0) }), {}),
  costUsd: 0, costBasis: 'Free plan without payment method (owner-attested), approval spending_limit_usd 0; any 402 stops the run.' });
const stopRun = reason => { evidence.cloud = { ...cloudEvidence(), stopped: reason }; save(); CLOUD.revoke(); console.error('G7C STOPPED: ' + reason); process.exit(2); };
const receipts = [], memoryWaits = [];
const call = async ({ role, model, prompt, schema, signal, attempt, options }) => {
  if (cloud && model === CLOUD.MODEL) {
    try { const r = await cloud.call({ role, prompt, schema, signal, attempt, options }); receipts.push({ role, model, ok: r.ok, durationMs: r.durationMs, cloud: true }); return r; }
    catch (e) { if (e instanceof CLOUD.StopRun) return stopRun(e.message); throw e; }
  }
  // S1R4: other workloads on this host swing RAM by several GiB; wait (bounded, logged) for headroom instead of
  // failing a trial on a momentary dip, and still refuse after 15 minutes.
  for (const until = Date.now() + 15 * 60_000; freemem() < 4 * 1024 ** 3;) {
    if (Date.now() > until || signal?.aborted) return { ok: false, error: 'Free memory below 4 GiB for 15 minutes; refusing to load more work.', durationMs: 0 };
    memoryWaits.push(new Date().toISOString()); await new Promise(r => setTimeout(r, 5000));
  }
  const started = Date.now();
  const r = await execute({ taskId: 'g7-' + randomUUID(), provider: 'ollama', model, prompt, localOnly: true, numCtx: 8192, numPredict: options?.numPredict ?? 2048, ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}), ...(schema ? { format: schema } : {}) }, { signal, timeoutMs: 240_000 });
  const durationMs = Date.now() - started, x = r.receipt;
  receipts.push({ role, model, ok: r.ok, durationMs, doneReason: x?.doneReason ?? null, promptTokens: x?.promptEvalCount ?? null, outputTokens: x?.evalCount ?? null, evalNs: x?.evalDurationNs ?? null, loadNs: x?.loadDurationNs ?? null });
  return r.ok ? { ok: true, text: r.output ?? '', servedModel: r.receipt?.model ?? '', durationMs } : { ok: false, error: r.error ?? 'failed', stopped: !!r.stopped, durationMs };
};

const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error('Sandbox unavailable: dynamic execution BLOCKED; G7 not run.');
const fresh = { version: G7_VERSION, pin: PIN, ...(STRATEGY !== STRATEGY_S1R3 || process.env.G7_PINS ? { strategy: STRATEGY.id, pins } : {}), trials: TRIALS, startedAt: new Date().toISOString(), sandbox, taskHash: sha(JSON.stringify(G7_TASKS)), preflight: [], runs: [] };
const evidence = process.env.G7_RESUME === '1' && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : fresh;
if (evidence !== fresh) {
  if (evidence.taskHash !== fresh.taskHash || evidence.pin !== PIN || evidence.strategy !== fresh.strategy || JSON.stringify(evidence.pins) !== JSON.stringify(fresh.pins) || evidence.g7) throw new Error('Resume refused: different task set or pin, or the run is already complete.');
  (evidence.resumes ??= []).push({ at: fresh.startedAt, keptTrials: evidence.runs.length, sandbox });
}
const preflight = evidence === fresh ? evidence.preflight : (evidence.resumes.at(-1).preflight = []);
const unload = () => Promise.all([...new Set(Object.values(pins))].filter(m => !CLOUD || m !== CLOUD.MODEL).map(model => fetch(ORIGIN + '/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).then(r => r.text()).catch(() => {})));
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
for (const task of G7_TASKS.filter(t => !CLOUD || t.kind === 'regression')) {
  const n = task.kind === 'regression' ? TRIALS.regression : TRIALS.heldout;
  for (let trial = 1; trial <= n; trial++) {
    if (evidence.runs.some(r => r.task === task.id && r.trial === trial)) continue;
    const started = Date.now(), firstReceipt = receipts.length;
    cloud?.setTrial(`${task.id}#${trial}`);
    const r = await runCodingWorkflow(task, { call, sandbox: runSandboxed, pins, maxRepairs: 2, strategy: STRATEGY, onEvent: e => console.log(`  ${task.id}#${trial} ${e}`) });
    const final = r.attempts.at(-1);
    evidence.runs.push({ task: task.id, kind: task.kind, trial, status: r.status, reason: r.reason, repairsUsed: r.repairsUsed, durationMs: Date.now() - started,
      attempts: r.attempts, repairs: r.repairs, failures: r.failures, contractVersion: r.contractVersion, reviewer: r.reviewer, reviewerFalseApproval: r.reviewerFalseApproval, reviewerFalseRejection: r.reviewerFalseRejection, workerTesterConcurrent: r.workerTesterConcurrent,
      calls: r.calls.map(({ role, model, attempt, ok, durationMs, servedModel, startedAt, endedAt }) => ({ role, model, attempt, ok, durationMs, servedModel, startedAt, endedAt })),
      invariants: { pinsHeld: r.calls.every(c => c.model === pins[c.role] && (!c.ok || c.servedModel === pins[c.role])), ordering: r.status === 'passed' || r.status === 'failed' ? order(r.calls) : null,
        gateIsAuthority: (r.status === 'passed') === !!final?.accepted || !['passed', 'failed'].includes(r.status) },
      finalSourceSha256: r.finalSource ? sha(r.finalSource) : null, finalSource: r.finalSource?.slice(0, 2500) ?? null,
      ...(STRATEGY !== STRATEGY_S1R3 ? { strategy: r.strategy, workerSamples: r.graph?.workerSamples ?? 1, candidates: r.candidates, toolCalls: r.toolReceipts.length, toolReceiptsOk: r.toolReceipts.every(t => t.ok && t.invoker === 'orchestrator'), callReceipts: receipts.slice(firstReceipt) } : {}) });
    console.log(`${task.id}#${trial}: ${r.status} (${r.reason})`);
    if (cloud) evidence.cloud = cloudEvidence();
    save();
    if (cloud && (['sandbox_error', 'pin_violation'].includes(r.status) || !evidence.runs.at(-1).invariants.pinsHeld)) stopRun(`security invariant: ${r.status}`);
    await unload();
  }
}

// Controlled cancellation: abort as soon as the Worker starts.
if (CLOUD) evidence.cancellation = { notRun: 'G7C: would spend cloud budget; the local S1R4 cancellation result stands (evidence/g7-s1r4-auto.json).' };
else {
  const controller = new AbortController(); let sandboxRuns = 0;
  const watching = async (req) => { if (req.role === 'Worker') setTimeout(() => controller.abort(), 1000); return call(req); };
  const r = await runCodingWorkflow(G7_TASKS[1], { call: watching, sandbox: async (q, s) => { sandboxRuns++; return runSandboxed(q, s); }, pins, signal: controller.signal, strategy: STRATEGY });
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
  invariants: { pinsHeld: inv.every(i => i.pinsHeld), ordering: inv.every(i => i.ordering !== false), gateIsAuthority: inv.every(i => i.gateIsAuthority), cancellation: evidence.cancellation.notRun ? null : evidence.cancellation.status === 'cancelled' && evidence.cancellation.sandboxRuns === 0 && evidence.cancellation.liveRequestsAfter === 0 },
  externalRequestsRefused: refused, memoryWaitSamples: memoryWaits.length,
};
const s = evidence.summary;
evidence.g7 = s.heldout.passed >= 14 && s.regression.passed >= 2 && Object.values(s.invariants).every(Boolean) ? 'PASS' : 'FAIL';
if (CLOUD) {
  evidence.g7 = s.regression.passed >= 2 && Object.values(s.invariants).every(v => v !== false) ? 'PASS' : 'FAIL';
  evidence.verdictScope = 'G7 v2 regression only (>= 2/3), CLOUD-ASSISTED (Worker+Tester groq/openai/gpt-oss-120b). Held-out not rerun (local S1R4 17/20 stands). Not evidence of local-model capability.';
  evidence.cloud = cloudEvidence(); CLOUD.revoke(); evidence.cloud.revokedAt = new Date().toISOString();
}
evidence.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ g7: evidence.g7, ...s }, null, 1));
