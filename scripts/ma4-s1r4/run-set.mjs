// MA4-S1R4 workflow runner for the DEVELOPMENT set (never decides a gate; G7 runs only through scripts/ma4-s1r2/g7.mjs).
//   node --experimental-strip-types scripts/ma4-s1r4/run-set.mjs --strategy s1r3|s1r4 [--samples 1|2|3|adaptive]
//     [--pin model] [--pins Planner=m,Worker=m,Tester=m,Reviewer=m] [--trials 2] [--only id,id] --out file.json
// Same execution path as G7: production Ollama execute() with a served-model receipt, generated code only in the
// OS-enforced sandbox, a localhost-only fetch allowlist, the model unloaded after every trial, a free-memory floor.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { freemem } from 'node:os';
import { DEV_TASKS, DEV_VERSION } from './dev-tasks.mjs';
import { runCodingWorkflow, STRATEGY_S1R3, STRATEGY_S1R4 } from '../../src/lib/bunny-host/ma4/coding-workflow.server.ts';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';
import { execute } from '../../src/lib/orch/exec.server.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const ORIGIN = 'http://127.0.0.1:11434';
const realFetch = globalThis.fetch; let refused = 0;
globalThis.fetch = async (input, init) => { if (new URL(String(input)).origin !== ORIGIN) { refused++; throw new Error('runner network allowlist refused'); } return realFetch(input, init); };

const base = arg('--strategy', 's1r4') === 's1r3' ? STRATEGY_S1R3 : STRATEGY_S1R4;
const samplesArg = arg('--samples', null);
const strategy = samplesArg ? { ...base, id: `${base.id}-k${samplesArg}`, workerSamples: samplesArg === 'adaptive' ? 'adaptive' : Number(samplesArg) } : base;
const PIN = arg('--pin', 'qwen2.5-coder:7b');
const pins = { Planner: PIN, Worker: PIN, Tester: PIN, Reviewer: PIN, ...Object.fromEntries((arg('--pins', '') || '').split(',').filter(Boolean).map(kv => kv.split('='))) };
if (Object.values(pins).some(m => m.endsWith(':cloud'))) throw new Error('cloud-backed tags are refused');
const TRIALS = Number(arg('--trials', '2'));
const only = arg('--only', null)?.split(',');
const OUT = arg('--out', `docs/ma4-s1r4/evidence/dev-${strategy.id}.json`);
const sha = v => createHash('sha256').update(v).digest('hex');

const receipts = [];
const call = async ({ role, model, prompt, schema, signal, options }) => {
  if (freemem() < 2.5 * 1024 ** 3) return { ok: false, error: 'Free memory below 2.5 GiB; refusing to load more work.', durationMs: 0 };
  const started = Date.now();
  const r = await execute({ taskId: 'dev-' + randomUUID(), provider: 'ollama', model, prompt, localOnly: true, numCtx: 8192, numPredict: options?.numPredict ?? 2048, ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}), ...(schema ? { format: schema } : {}) }, { signal, timeoutMs: 240_000 });
  const durationMs = Date.now() - started;
  const x = r.receipt;
  receipts.push({ role, model, ok: r.ok, durationMs, doneReason: x?.doneReason ?? null, promptTokens: x?.promptEvalCount ?? null, outputTokens: x?.evalCount ?? null, evalTokPerS: x?.evalCount && x?.evalDurationNs ? +(x.evalCount / (x.evalDurationNs / 1e9)).toFixed(1) : null, loadMs: x?.loadDurationNs ? Math.round(x.loadDurationNs / 1e6) : null });
  return r.ok ? { ok: true, text: r.output ?? '', servedModel: x?.model ?? '', durationMs } : { ok: false, error: r.error ?? 'failed', stopped: !!r.stopped, durationMs };
};
const unload = () => Promise.all([...new Set(Object.values(pins))].map(model => fetch(ORIGIN + '/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).then(r => r.text()).catch(() => {})));

const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error('Sandbox unavailable: dynamic execution BLOCKED.');
const evidence = { version: DEV_VERSION, strategy, pins, trials: TRIALS, taskHash: sha(JSON.stringify(DEV_TASKS)), sandbox, startedAt: new Date().toISOString(), runs: [] };
const save = () => { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n'); };
for (const task of DEV_TASKS.filter(t => !only || only.includes(t.id))) {
  for (let trial = 1; trial <= TRIALS; trial++) {
    const started = Date.now(), first = receipts.length;
    const r = await runCodingWorkflow(task, { call, sandbox: runSandboxed, pins, maxRepairs: 2, strategy, onEvent: e => console.log(`  ${task.id}#${trial} ${e}`) });
    const mine = receipts.slice(first);
    evidence.runs.push({ task: task.id, kind: task.kind, trial, status: r.status, reason: r.reason, repairsUsed: r.repairsUsed, durationMs: Date.now() - started,
      calls: mine, modelCalls: mine.length, outputTokens: mine.reduce((a, c) => a + (c.outputTokens ?? 0), 0), truncated: mine.filter(c => c.doneReason === 'length').length,
      toolCalls: r.toolReceipts.length, candidates: r.candidates, repairs: r.repairs, failures: r.failures.map(f => ({ attempt: f.attempt, category: f.failureCategory, component: f.suspectedComponent, defect: f.defect ?? null })),
      attempts: r.attempts.map(a => ({ attempt: a.attempt, static: a.static.ok, hidden: a.hidden.passed, tester: a.tester, accepted: a.accepted })),
      reviewer: r.reviewer, reviewerFalseApproval: r.reviewerFalseApproval, profile: r.profile && { complexity: r.profile.complexity, errorConditions: r.profile.errorConditions }, workerSamples: r.graph?.workerSamples ?? 1, finalSource: r.finalSource?.slice(0, 2500) ?? null, finalTests: r.finalTests?.slice(0, 3000) ?? null });
    console.log(`${task.id}#${trial}: ${r.status} (${r.reason})`);
    save();
    await unload();
  }
}
const runs = evidence.runs;
const by = k => Object.fromEntries([...new Set(runs.map(r => r[k]))].map(v => [v, `${runs.filter(r => r[k] === v && r.status === 'passed').length}/${runs.filter(r => r[k] === v).length}`]));
const lat = runs.flatMap(r => r.calls.filter(c => c.ok).map(c => c.durationMs)).sort((a, b) => a - b);
evidence.summary = { passed: runs.filter(r => r.status === 'passed').length, trials: runs.length, byKind: by('kind'), byTask: by('task'),
  statuses: runs.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}), firstAttemptPasses: runs.filter(r => r.status === 'passed' && r.repairsUsed === 0).length,
  modelCalls: runs.reduce((a, r) => a + r.modelCalls, 0), outputTokens: runs.reduce((a, r) => a + r.outputTokens, 0), truncatedReplies: runs.reduce((a, r) => a + r.truncated, 0),
  callLatencyMs: { median: lat[Math.floor(lat.length / 2)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null }, trialMs: { total: runs.reduce((a, r) => a + r.durationMs, 0) },
  reviewerFalseApprovals: runs.filter(r => r.reviewerFalseApproval).length, externalRequestsRefused: refused };
evidence.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify(evidence.summary, null, 1));
