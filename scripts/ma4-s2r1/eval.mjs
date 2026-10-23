// MA4-S2R1 evaluation harness (pre-registered protocol: docs/ma4-s2r1/NEW_BENCHMARK_PREREGISTRATION.md).
//   node --experimental-strip-types scripts/ma4-s2r1/eval.mjs --phase dev|heldout [--only id,id]
// Same execution path as S2: production Ollama execute() with a served-model receipt, generated code only in the
// OS-enforced sandbox, a localhost-only fetch allowlist, models unloaded after every trial, a free-memory floor.
// Arms (all the S2 collaboration workflow with the grouped schedule): A = no retrieval; B = A + relevance-gated skill;
// C = B + one relevance-gated Lotus experience line. Dev trials write signature-tagged experience; held-out trials
// write nothing. Evidence JSON (no prompts, no hidden tests, sources clipped) goes to docs/ma4-s2r1/evidence/.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { freemem } from 'node:os';
import { S2R1_TASKS, S2R1_EVAL_VERSION, RELEVANCE, split } from './eval-tasks.mjs';
import { openCorpus, SCOPE } from './corpus.mjs';
import { runCodingWorkflow, STRATEGY_S2 } from '../../src/lib/bunny-host/ma4/coding-workflow.server.ts';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';
import { execute } from '../../src/lib/orch/exec.server.ts';
import { taskTags } from '../../src/lib/bunny-host/ma4/skills.ts';
import { buildGuidance, skillsSeen } from '../../src/lib/bunny-host/ma4/skill-learning.server.ts';
import { taskSignature } from '../../src/lib/bunny-host/ma4/relevance.ts';
import { assignTeam, CODING_NEEDS, composeTeam, coordinatorChannel, gateCalls, planSchedule } from '../../src/lib/bunny-host/ma4/coordinator.ts';
import { requirementsHash } from '../../src/lib/bunny-host/ma4/collaboration.ts';
import { profileCodingTask } from '../../src/lib/bunny-host/ma4/task-intelligence.ts';
import { TeamRuns } from '../../src/lib/bunny-host/ma4/team-run.server.ts';
import { signTest, wilsonInterval } from '../../src/lib/bunny-host/ma4/role-performance.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const PHASE = arg('--phase', null);
if (!['dev', 'heldout'].includes(PHASE)) throw new Error('usage: --phase dev|heldout');
const only = arg('--only', null)?.split(',');
const ORIGIN = 'http://127.0.0.1:11434';
const realFetch = globalThis.fetch; let refused = 0;
globalThis.fetch = async (input, init) => { if (new URL(String(input)).origin !== ORIGIN) { refused++; throw new Error('S2R1 evaluation network allowlist refused ' + new URL(String(input)).origin); } return realFetch(input, init); };

// Pre-registered configuration (§3, §4). Never changed after results are seen.
const PINS = Object.freeze({ Planner: 'qwen2.5-coder:7b', Worker: 'qwen2.5-coder:7b', Tester: 'huihui_ai/qwen2.5-abliterate:7b', Reviewer: 'qwen2.5-coder:7b' });
const RESOURCES = { vramGiB: 6, modelGiB: { 'qwen2.5-coder:7b': 4.2, 'huihui_ai/qwen2.5-abliterate:7b': 4.2 } };
const SEED = 2610230001, TRIALS = PHASE === 'heldout' ? 2 : 1, ARMS = PHASE === 'heldout' ? ['A', 'B', 'C'] : ['A', 'C'];
const OUT = `docs/ma4-s2r1/evidence/${PHASE}.json`;
const sha = v => createHash('sha256').update(v).digest('hex');
const TASK_HASH = sha(JSON.stringify(S2R1_TASKS));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const candidate = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', 'src', 'scripts/ma4-s2r1', 'package.json') };
if (PHASE === 'heldout' && candidate.dirty) throw new Error(`The held-out run needs a frozen candidate; uncommitted changes:\n${candidate.dirty}`);

const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const shuffle = (xs, rnd) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const { db, registry, memory, copied } = openCorpus();
const runs = new TeamRuns(db);
let receipts = [], memoryWaits = [], minFreeGiB = Infinity;
const rawCall = async ({ role, model, prompt, schema, signal, options }) => {
  for (const until = Date.now() + 15 * 60_000; freemem() < 4 * 1024 ** 3;) {
    if (Date.now() > until || signal?.aborted) return { ok: false, error: 'Free memory below 4 GiB for 15 minutes; refusing to load more work.', durationMs: 0 };
    memoryWaits.push(new Date().toISOString()); await new Promise(r => setTimeout(r, 5000));
  }
  minFreeGiB = Math.min(minFreeGiB, freemem() / 1024 ** 3);
  const started = Date.now();
  const r = await execute({ taskId: 's2r1-' + randomUUID(), provider: 'ollama', model, prompt, localOnly: true, numCtx: 8192, numPredict: options?.numPredict ?? 2048, ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}), ...(schema ? { format: schema } : {}) }, { signal, timeoutMs: 240_000 });
  const durationMs = Date.now() - started, x = r.receipt;
  receipts.push({ role, model, ok: r.ok, durationMs, doneReason: x?.doneReason ?? null, promptTokens: x?.promptEvalCount ?? null, outputTokens: x?.evalCount ?? null, loadMs: x?.loadDurationNs ? Math.round(x.loadDurationNs / 1e6) : null, promptChars: prompt.length });
  return r.ok ? { ok: true, text: r.output ?? '', servedModel: x?.model ?? '', durationMs } : { ok: false, error: r.error ?? 'failed', stopped: !!r.stopped, durationMs };
};
const unload = () => Promise.all([...new Set(Object.values(PINS))].map(model => fetch(ORIGIN + '/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).then(r => r.text()).catch(() => {})));

const team = composeTeam(CODING_NEEDS(true));
const assignment = assignTeam(team, { candidates: [...new Set(Object.values(PINS))].map(model => ({ model, exclusion: null })), evidence: [], pins: PINS });
const schedule = planSchedule(assignment.pins, RESOURCES);

async function trial(task, arm, n) {
  const first = receipts.length, started = Date.now();
  const gate = gateCalls(rawCall, { maxConcurrent: schedule.mode === 'grouped' ? 1 : 2, timeoutMs: 300_000 });
  const profile = profileCodingTask(task, { maxRepairs: 2 });
  const channel = coordinatorChannel({ taskId: task.id, requirementsSha256: requirementsHash(task), members: team.members, deadlineAt: Date.now() + 60 * 60_000, budget: { modelCalls: profile.budgets.maxModelCalls, toolCalls: 0, tokens: 0 } });
  const learned = arm === 'A' ? null : buildGuidance({ registry, memory, scopes: [SCOPE], task, mode: 'evaluation', experience: arm === 'C' });
  // Injected guidance is measured per model call: the advisory texts this trial produced, found in each prompt.
  const shown = new Set();
  const guidance = learned && (req => { const g = learned.guidance(req); if (g.text) shown.add(g.text); return g; });
  const injected = [];
  const call = async req => { const chars = [...shown].filter(t => req.prompt.includes(t)).reduce((a, t) => a + t.length, 0); injected.push(chars); return gate.call(req); };
  const r = await runCodingWorkflow(task, { call, sandbox: runSandboxed, pins: assignment.pins, maxRepairs: 2, strategy: { ...STRATEGY_S2, schedule: schedule.mode }, channel, guidance: guidance ?? undefined, onEvent: e => console.log(`  ${arm} ${task.id}#${n} ${e}`) });
  const mine = receipts.slice(first), handoffs = channel.log(), d = learned?.decision;
  console.log(`${arm} ${task.id}#${n}: ${r.status} (${r.reason})${d?.skills.selected ? ` skill=${d.skills.selected.name}` : ''}${d?.experience.selected ? ' +experience' : ''}`);
  return { result: r, record: { arm, task: task.id, kind: task.kind, relation: RELEVANCE[task.id].relation, family: RELEVANCE[task.id].family ?? null, trial: n, status: r.status, reason: r.reason, repairsUsed: r.repairsUsed, firstAttempt: r.status === 'passed' && r.repairsUsed === 0,
    durationMs: Date.now() - started, modelCalls: mine.length, promptTokens: mine.reduce((a, c) => a + (c.promptTokens ?? 0), 0), outputTokens: mine.reduce((a, c) => a + (c.outputTokens ?? 0), 0), promptChars: mine.reduce((a, c) => a + c.promptChars, 0),
    injectedChars: injected.reduce((a, c) => a + c, 0), callsWithGuidance: injected.filter(c => c > 0).length,
    truncated: mine.filter(c => c.doneReason === 'length').length, modelLoads: mine.filter(c => (c.loadMs ?? 0) > 500).length, calls: mine.map(c => ({ role: c.role, model: c.model, ok: c.ok, durationMs: c.durationMs, loadMs: c.loadMs, promptTokens: c.promptTokens })),
    gate: gate.stats(), handoffs: { sent: handoffs.length, refused: handoffs.filter(h => !h.ok).length },
    retrieval: d ? { latencyMs: d.latencyMs, signature: { category: d.signature.category, operations: d.signature.operations, inputTypes: d.signature.inputTypes, formats: d.signature.formats },
      inspected: d.skills.inspected, eligible: d.skills.eligible, rejected: d.skills.rejected, selected: d.skills.selected, experienceInspected: d.experience.inspected, experienceSelected: d.experience.selected, experienceRejected: d.experience.rejected.length } : null,
    guidance: r.guidance ?? [], skillsSeen: skillsSeen(r), memorySeen: [...new Set((r.guidance ?? []).flatMap(g => g.sources).filter(s => s.startsWith('memory:')))],
    failures: r.failures.map(f => ({ attempt: f.attempt, category: f.failureCategory, component: f.suspectedComponent })), repairs: r.repairs.map(x => ({ target: x.target, categories: x.categories, outcome: x.outcome })),
    attempts: r.attempts.map(a => ({ attempt: a.attempt, static: a.static.ok, hidden: a.hidden.passed, tester: { total: a.tester.total, valid: a.tester.valid, passed: a.tester.passed }, accepted: a.accepted })),
    reviewer: r.reviewer, reviewerFalseApproval: r.reviewerFalseApproval,
    invariants: { pinsHeld: r.calls.every(c => !c.servedModel || c.servedModel === assignment.pins[c.role]), gateIsAuthority: r.status !== 'passed' || !!r.attempts.at(-1)?.accepted, handoffsRefused: handoffs.filter(h => !h.ok).length },
    finalSource: r.finalSource?.slice(0, 1500) ?? null } };
}
const experienceOf = (task, rec) => ({ taskId: task.id, kind: task.kind, tags: taskTags(task), status: rec.status, firstAttempt: rec.firstAttempt, repairs: rec.repairs.map(x => ({ target: x.target, categories: x.categories, outcome: x.outcome })), skills: rec.skillsSeen.map(id => registry.get(id)?.name ?? id) });

const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error(`Sandbox unavailable: ${sandbox.reason}`);
const rnd = mulberry32(SEED);
const slots = shuffle(split(PHASE).filter(t => !only || only.includes(t.id)).flatMap(t => Array.from({ length: TRIALS }, (_, i) => ({ task: t, n: i + 1 }))), rnd);
const plan = slots.flatMap(s => shuffle(ARMS, rnd).map(arm => ({ ...s, arm })));
const fresh = { version: S2R1_EVAL_VERSION, phase: PHASE, taskHash: TASK_HASH, pins: PINS, seed: SEED, candidate, corpus: { scope: SCOPE, copied }, team: { members: team.members }, schedule, sandbox,
  order: plan.map(p => `${p.arm}:${p.task.id}#${p.n}`), startedAt: new Date().toISOString(), runs: [] };
const evidence = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : fresh;
if (evidence.taskHash !== TASK_HASH || JSON.stringify(evidence.pins) !== JSON.stringify(PINS)) throw new Error('Resume refused: different task set or pins.');
if (PHASE === 'heldout' && evidence.candidate.commit !== candidate.commit) throw new Error(`Resume refused: the frozen candidate was ${evidence.candidate.commit}, this is ${candidate.commit}.`);
const save = () => { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n'); };
// Recorded results are never re-run; a trial that never reached a model (memory floor) is (pre-registration §4).
const done = (arm, id, n) => evidence.runs.some(r => r.arm === arm && r.task === id && r.trial === n && !/Free memory below/.test(r.reason));
const ledgerId = `s2r1-${PHASE}`;
evidence.skillsAtStart ??= registry.list().map(s => ({ id: s.id, name: s.name, version: s.version, state: s.state, attested: !!s.applicability }));
if (!runs.get(ledgerId)) runs.create(ledgerId, plan.map(p => ({ id: `${p.arm}:${p.task.id}#${p.n}`, reversible: true })), { maxConcurrent: 1, maxRetries: 1, persist: true });
else (evidence.recoveries ??= []).push({ at: new Date().toISOString(), ledger: runs.summary(runs.recover(ledgerId).id) });
save();

for (const p of plan) {
  const node = `${p.arm}:${p.task.id}#${p.n}`;
  if (done(p.arm, p.task.id, p.n)) { if (runs.get(ledgerId).nodes.find(x => x.id === node)?.state === 'pending') { runs.start(ledgerId, node); runs.finish(ledgerId, node, { ok: true }); } continue; }
  runs.start(ledgerId, node);
  const { record } = await trial(p.task, p.arm, p.n);
  evidence.runs = evidence.runs.filter(r => !(r.arm === record.arm && r.task === record.task && r.trial === record.trial));
  evidence.runs.push(record);
  runs.finish(ledgerId, node, { ok: true, resultSha256: sha(JSON.stringify(record)) });
  // Learning writes: dev trials only (held-out memory is read-only, §2).
  if (PHASE === 'dev') memory.recordExperience(SCOPE, experienceOf(p.task, record), 'synthetic', Date.now(), taskSignature(p.task, { projectScope: SCOPE }));
  save();
  await unload();
}

// ── conclusions ────────────────────────────────────────────────────────────────────────────────────────────────────
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
const summarize = rs => {
  const n = rs.length, pass = rs.filter(r => r.status === 'passed').length, lat = rs.flatMap(r => r.calls.filter(c => c.ok).map(c => c.durationMs)).sort((a, b) => a - b);
  const by = key => Object.fromEntries([...new Set(rs.map(r => r[key]))].map(k => [k, `${rs.filter(r => r[key] === k && r.status === 'passed').length}/${rs.filter(r => r[key] === k).length}`]));
  const promptTokens = sum(rs, r => r.promptTokens), injectedTokens = Math.round(sum(rs, r => r.injectedChars) / 4);
  return { trials: n, passed: pass, passInterval: wilsonInterval(pass, n), firstAttempt: rs.filter(r => r.firstAttempt).length, byKind: by('kind'), byRelation: by('relation'),
    statuses: rs.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}), repairsUsed: sum(rs, r => r.repairsUsed), passedAfterRepair: rs.filter(r => r.status === 'passed' && r.repairsUsed > 0).length,
    modelCalls: sum(rs, r => r.modelCalls), promptTokens, outputTokens: sum(rs, r => r.outputTokens), injectedTokens, injectedShareOfPrompt: promptTokens ? +(injectedTokens / promptTokens).toFixed(4) : 0,
    callsWithGuidance: sum(rs, r => r.callsWithGuidance), trialsWithSkill: rs.filter(r => r.skillsSeen.length).length, trialsWithExperience: rs.filter(r => r.memorySeen.length).length, zeroInjectionTrials: rs.filter(r => !r.injectedChars).length,
    retrievalLatencyMs: rs.filter(r => r.retrieval).map(r => r.retrieval.latencyMs).sort((a, b) => a - b).at(-1) ?? null,
    modelLoads: sum(rs, r => r.modelLoads), modelSwitches: sum(rs, r => r.gate.modelSwitches), peakConcurrent: Math.max(0, ...rs.map(r => r.gate.peakConcurrent)),
    callLatencyMs: { median: lat[Math.floor(lat.length / 2)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null }, trialMs: { total: sum(rs, r => r.durationMs), median: rs.map(r => r.durationMs).sort((a, b) => a - b)[Math.floor(n / 2)] ?? null },
    failureCategories: rs.flatMap(r => r.failures.map(f => f.category)).reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {}), reviewerFalseApprovals: rs.filter(r => r.reviewerFalseApproval).length,
    handoffs: sum(rs, r => r.handoffs.sent), handoffsRefused: sum(rs, r => r.handoffs.refused),
    invariants: { pinsHeld: rs.every(r => r.invariants.pinsHeld), gateIsAuthority: rs.every(r => r.invariants.gateIsAuthority), noHandoffRefused: rs.every(r => r.invariants.handoffsRefused === 0) } };
};
const versus = (x, y) => {
  const slots = evidence.runs.filter(r => r.arm === x).map(a => [a, evidence.runs.find(b => b.arm === y && b.task === a.task && b.trial === a.trial)]).filter(([, b]) => b);
  const wins = slots.filter(([a, b]) => a.status === 'passed' && b.status !== 'passed').length, losses = slots.filter(([a, b]) => a.status !== 'passed' && b.status === 'passed').length;
  const tasks = [...new Set(slots.map(([a]) => a.task))].map(t => { const mine = slots.filter(([a]) => a.task === t); return Math.sign(mine.filter(([a]) => a.status === 'passed').length - mine.filter(([, b]) => b.status === 'passed').length); });
  return { pairs: slots.length, wins, losses, difference: wins - losses, signTestP: signTest(wins, losses), taskLevel: { wins: tasks.filter(s => s > 0).length, losses: tasks.filter(s => s < 0).length, p: signTest(tasks.filter(s => s > 0).length, tasks.filter(s => s < 0).length) } };
};
const FAMILY = { 'parse-date-procedure': 'date-iso', slugify: 'slug', 'calculate-median': 'median', 'compute-median': 'median' };
const quality = rs => {
  const fp = rs.filter(r => r.retrieval && ((r.relation !== 'applicable' && (r.skillsSeen.length || r.memorySeen.length)) || r.skillsSeen.some(id => FAMILY[registry.get(id)?.name] !== r.family)));
  const app = rs.filter(r => r.retrieval && r.relation === 'applicable');
  return { falsePositiveTrials: fp.map(r => `${r.arm}:${r.task}#${r.trial}`), applicableTrials: app.length, applicableWithSkill: app.filter(r => r.skillsSeen.length).length };
};
const arms = [...new Set(evidence.runs.map(r => r.arm))].sort();
evidence.summary = { byArm: Object.fromEntries(arms.map(a => [a, summarize(evidence.runs.filter(r => r.arm === a))])), retrievalQuality: Object.fromEntries(arms.filter(a => a !== 'A').map(a => [a, quality(evidence.runs.filter(r => r.arm === a))])),
  externalRequestsRefused: refused, memoryWaitSamples: memoryWaits.length, minFreeGiB: Number.isFinite(minFreeGiB) ? +minFreeGiB.toFixed(2) : null, ledger: runs.summary(ledgerId) };
if (arms.includes('C')) evidence.summary.CvsA = versus('C', 'A');
if (PHASE === 'heldout') {
  const s = evidence.summary, A = s.byArm.A, C = s.byArm.C;
  Object.assign(s, { CvsB: versus('C', 'B'), BvsA: versus('B', 'A') });
  const invariants = Object.values(s.byArm).every(a => Object.values(a.invariants).every(Boolean)) && refused === 0;
  s.primary = { criterion: 'C passes >= A passes + 4 (of 32) AND one-sided sign test C vs A p <= 0.10 AND all invariants AND injected guidance <= 5% of arm C prompt tokens',
    cMinusA: C.passed - A.passed, p: s.CvsA.signTestP, invariants, overhead: C.injectedShareOfPrompt, complete: evidence.runs.length === plan.length,
    met: evidence.runs.length === plan.length && C.passed - A.passed >= 4 && s.CvsA.signTestP <= 0.10 && invariants && C.injectedShareOfPrompt <= 0.05 };
  s.verdict = s.primary.met ? 'S2R1 intelligence improvement DEMONSTRATED on the pre-registered held-out criterion' : 'intelligence improvement UNPROVEN (pre-registered criterion not met); memory/skill injection stays disabled';
}
evidence.skillsAtEnd = registry.list().map(s => ({ id: s.id, name: s.name, version: s.version, state: s.state }));
evidence.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ phase: PHASE, summary: evidence.summary }, null, 1));
