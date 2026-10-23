// MA4-S2 evaluation harness (pre-registered protocol: docs/ma4-s2/INTELLIGENCE_EVALUATION.md §1).
//   node --experimental-strip-types scripts/ma4-s2/eval.mjs --phase discover|validate|qualify|heldout [--only id,id]
// Same execution path as G7: production Ollama execute() with a served-model receipt, generated code only in the
// OS-enforced sandbox, a localhost-only fetch allowlist, models unloaded after every trial, a free-memory floor.
// Arms: A = frozen S1R4 workflow; B = S2 Coordinator + protocol + grouped schedule, no memory; C = B + Lotus
// retrieval of qualified skills and verified experience (read-only during the held-out phase).
// State (skills, Lotus memory, run ledger) lives in an evaluation database outside the repository; evidence JSON is
// written per phase under docs/ma4-s2/evidence/ (compact: no prompts, no hidden tests, sources clipped).
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { freemem, homedir } from 'node:os';
import { S2_TASKS, S2_EVAL_VERSION, split } from './eval-tasks.mjs';
import { G7_TASKS } from '../ma4-s1r2/g7-tasks.mjs';
import { DEV_TASKS } from '../ma4-s1r4/dev-tasks.mjs';
import { runCodingWorkflow, STRATEGY_S1R4, STRATEGY_S2 } from '../../src/lib/bunny-host/ma4/coding-workflow.server.ts';
import { runSandboxed, sandboxAvailability } from '../../src/lib/bunny-host/ma4/sandbox.server.ts';
import { execute } from '../../src/lib/orch/exec.server.ts';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { ExperienceMemory } from '../../src/lib/bunny-host/ma4/experience.server.ts';
import { SkillRegistry } from '../../src/lib/bunny-host/ma4/skills.server.ts';
import { taskTags } from '../../src/lib/bunny-host/ma4/skills.ts';
import { buildGuidance, extractSkill, skillsSeen } from '../../src/lib/bunny-host/ma4/skill-learning.server.ts';
import { assignTeam, CODING_NEEDS, composeTeam, coordinatorChannel, gateCalls, planSchedule } from '../../src/lib/bunny-host/ma4/coordinator.ts';
import { requirementsHash } from '../../src/lib/bunny-host/ma4/collaboration.ts';
import { profileCodingTask } from '../../src/lib/bunny-host/ma4/task-intelligence.ts';
import { TeamRuns } from '../../src/lib/bunny-host/ma4/team-run.server.ts';
import { signTest, wilsonInterval } from '../../src/lib/bunny-host/ma4/role-performance.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const PHASE = arg('--phase', null);
if (!['discover', 'validate', 'qualify', 'heldout'].includes(PHASE)) throw new Error('usage: --phase discover|validate|qualify|heldout');
const only = arg('--only', null)?.split(',');
const ORIGIN = 'http://127.0.0.1:11434';
const realFetch = globalThis.fetch; let refused = 0;
globalThis.fetch = async (input, init) => { if (new URL(String(input)).origin !== ORIGIN) { refused++; throw new Error('S2 evaluation network allowlist refused ' + new URL(String(input)).origin); } return realFetch(input, init); };

// Pre-registered configuration (§1.2). Never changed after results are seen.
const PINS = Object.freeze({ Planner: 'qwen2.5-coder:7b', Worker: 'qwen2.5-coder:7b', Tester: 'huihui_ai/qwen2.5-abliterate:7b', Reviewer: 'qwen2.5-coder:7b' });
const RESOURCES = { vramGiB: 6, modelGiB: { 'qwen2.5-coder:7b': 4.2, 'huihui_ai/qwen2.5-abliterate:7b': 4.2 } }; // S1R4 measured peak per 7B
const TRIALS = 2, MAX_CANDIDATES = 6, SCOPE = 'project:ma4-s2-eval';
const DB_PATH = join(process.env.LOCALAPPDATA ?? homedir(), 'Bunny-A', 'ma4-s2-eval', 'eval.sqlite');
const OUT = `docs/ma4-s2/evidence/${PHASE}.json`;
const sha = v => createHash('sha256').update(v).digest('hex');
const TASK_HASH = sha(JSON.stringify(S2_TASKS));
const FORBIDDEN = [...S2_TASKS, ...G7_TASKS, ...DEV_TASKS].flatMap(t => [t.hiddenTests, t.reference].filter(Boolean));

const db = new HostDatabase(DB_PATH), registry = new SkillRegistry(db), memory = new ExperienceMemory(db), runs = new TeamRuns(db);
memory.setPolicy({ enabled: true, retentionDays: 30, persistRuns: true });

let receipts = [], memoryWaits = [], minFreeGiB = Infinity;
const rawCall = async ({ role, model, prompt, schema, signal, options }) => {
  for (const until = Date.now() + 15 * 60_000; freemem() < 4 * 1024 ** 3;) {
    if (Date.now() > until || signal?.aborted) return { ok: false, error: 'Free memory below 4 GiB for 15 minutes; refusing to load more work.', durationMs: 0 };
    memoryWaits.push(new Date().toISOString()); await new Promise(r => setTimeout(r, 5000));
  }
  minFreeGiB = Math.min(minFreeGiB, freemem() / 1024 ** 3);
  const started = Date.now();
  const r = await execute({ taskId: 's2-' + randomUUID(), provider: 'ollama', model, prompt, localOnly: true, numCtx: 8192, numPredict: options?.numPredict ?? 2048, ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}), ...(schema ? { format: schema } : {}) }, { signal, timeoutMs: 240_000 });
  const durationMs = Date.now() - started, x = r.receipt;
  receipts.push({ role, model, ok: r.ok, durationMs, doneReason: x?.doneReason ?? null, promptTokens: x?.promptEvalCount ?? null, outputTokens: x?.evalCount ?? null, loadMs: x?.loadDurationNs ? Math.round(x.loadDurationNs / 1e6) : null });
  return r.ok ? { ok: true, text: r.output ?? '', servedModel: x?.model ?? '', durationMs } : { ok: false, error: r.error ?? 'failed', stopped: !!r.stopped, durationMs };
};
const unload = () => Promise.all([...new Set(Object.values(PINS))].map(model => fetch(ORIGIN + '/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).then(r => r.text()).catch(() => {})));

const team = composeTeam(CODING_NEEDS(true));
const assignment = assignTeam(team, { candidates: [...new Set(Object.values(PINS))].map(model => ({ model, exclusion: null })), evidence: [], pins: PINS });
const schedule = planSchedule(assignment.pins, RESOURCES);

/** One trial of one arm. `skillScope` = the Lotus scope C retrieves from; `mode` = which skill states are usable. */
async function trial(task, arm, n, { skillScope = SCOPE, mode = 'evaluation' } = {}) {
  const first = receipts.length, started = Date.now();
  const s2 = arm !== 'A';
  const gate = gateCalls(rawCall, { maxConcurrent: s2 && schedule.mode === 'grouped' ? 1 : 2, timeoutMs: 300_000 });
  const profile = profileCodingTask(task, { maxRepairs: 2 });
  const channel = s2 ? coordinatorChannel({ taskId: task.id, requirementsSha256: requirementsHash(task), members: team.members, deadlineAt: Date.now() + 60 * 60_000, budget: { modelCalls: profile.budgets.maxModelCalls, toolCalls: 0, tokens: 0 } }) : undefined;
  const learned = arm === 'C' ? buildGuidance({ registry, memory, scopes: [skillScope], task, mode }) : null;
  const r = await runCodingWorkflow(task, { call: gate.call, sandbox: runSandboxed, pins: assignment.pins, maxRepairs: 2, strategy: s2 ? { ...STRATEGY_S2, schedule: schedule.mode } : STRATEGY_S1R4, channel, guidance: learned?.guidance, onEvent: e => console.log(`  ${arm} ${task.id}#${n} ${e}`) });
  const mine = receipts.slice(first);
  const handoffs = channel?.log() ?? [];
  console.log(`${arm} ${task.id}#${n}: ${r.status} (${r.reason})`);
  return { result: r, record: { arm, task: task.id, kind: task.kind, split: task.split, trial: n, status: r.status, reason: r.reason, repairsUsed: r.repairsUsed, firstAttempt: r.status === 'passed' && r.repairsUsed === 0,
    durationMs: Date.now() - started, modelCalls: mine.length, promptTokens: mine.reduce((a, c) => a + (c.promptTokens ?? 0), 0), outputTokens: mine.reduce((a, c) => a + (c.outputTokens ?? 0), 0),
    truncated: mine.filter(c => c.doneReason === 'length').length, modelLoads: mine.filter(c => (c.loadMs ?? 0) > 500).length, calls: mine.map(c => ({ role: c.role, model: c.model, ok: c.ok, durationMs: c.durationMs, loadMs: c.loadMs })),
    gate: gate.stats(), handoffs: { sent: handoffs.length, refused: handoffs.filter(h => !h.ok).length, downgraded: handoffs.filter(h => h.trust === 'untrusted').length },
    guidance: r.guidance ?? [], skillsSeen: skillsSeen(r), toolCalls: r.toolReceipts.length,
    failures: r.failures.map(f => ({ attempt: f.attempt, category: f.failureCategory, component: f.suspectedComponent })), repairs: r.repairs.map(x => ({ target: x.target, categories: x.categories, outcome: x.outcome, proposal: x.proposal ?? null })),
    attempts: r.attempts.map(a => ({ attempt: a.attempt, static: a.static.ok, hidden: a.hidden.passed, tester: { total: a.tester.total, valid: a.tester.valid, passed: a.tester.passed }, accepted: a.accepted })),
    reviewer: r.reviewer, reviewerFalseApproval: r.reviewerFalseApproval, reviewerFalseRejection: r.reviewerFalseRejection, workerSamples: r.graph?.workerSamples ?? 1,
    invariants: { pinsHeld: r.calls.every(c => !c.servedModel || c.servedModel === assignment.pins[c.role]), gateIsAuthority: r.status !== 'passed' || !!r.attempts.at(-1)?.accepted, handoffsRefused: handoffs.filter(h => !h.ok).length },
    finalSource: r.finalSource?.slice(0, 1500) ?? null } };
}
const experienceOf = (task, rec) => ({ taskId: task.id, kind: task.kind, tags: taskTags(task), status: rec.status, firstAttempt: rec.firstAttempt, repairs: rec.repairs.map(x => ({ target: x.target, categories: x.categories, outcome: x.outcome })), skills: rec.skillsSeen.map(id => registry.get(id)?.name ?? id) });

const sandbox = await sandboxAvailability();
if (!sandbox.available) throw new Error(`Sandbox unavailable: ${sandbox.reason}`);
const fresh = { version: S2_EVAL_VERSION, phase: PHASE, taskHash: TASK_HASH, pins: PINS, team: { members: team.members, reasons: team.reasons }, assignment: assignment.roles.map(r => ({ role: r.role, model: r.model, decision: r.decision })), schedule, sandbox, startedAt: new Date().toISOString(), runs: [] };
// A crash leaves a "running" trial in the ledger; recovery re-queues it (reversible: sandboxed, no external effect).
// Recorded results are never re-run (pre-registration: no selection by outcome).
const evidence = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : fresh;
if (evidence.taskHash !== TASK_HASH || JSON.stringify(evidence.pins) !== JSON.stringify(PINS)) throw new Error('Resume refused: different task set or pins.');
const save = () => { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n'); };
const done = (arm, id, n) => evidence.runs.some(r => r.arm === arm && r.task === id && r.trial === n && !/Free memory below/.test(r.reason));
const ledgerId = `s2-${PHASE}`;
const plan = [];

if (PHASE === 'discover') {
  for (const t of split('train').filter(t => !only || only.includes(t.id))) for (let n = 1; n <= TRIALS; n++) plan.push({ arm: 'B', task: t, n });
} else if (PHASE === 'validate') {
  const disc = JSON.parse(readFileSync('docs/ma4-s2/evidence/discover.json', 'utf8'));
  for (const c of disc.candidates.filter(c => c.state === 'candidate').slice(0, MAX_CANDIDATES)) {
    const skill = registry.get(c.id), task = S2_TASKS.find(t => t.id === skill.provenance.taskId);
    memory.recordSkillPointer(`project:ma4-s2-validate-${skill.id}`, skill, 'synthetic');
    plan.push({ arm: 'C', task, n: 1, skillId: skill.id });
  }
} else if (PHASE === 'qualify') {
  for (const s of registry.list(['sandbox_validated'])) memory.recordSkillPointer('project:ma4-s2-qualify', s, 'synthetic');
  for (const t of split('qualify').filter(t => !only || only.includes(t.id))) for (let n = 1; n <= TRIALS; n++) for (const arm of ['B', 'C']) plan.push({ arm, task: t, n });
} else {
  for (const t of split('heldout').filter(t => !only || only.includes(t.id))) for (let n = 1; n <= TRIALS; n++) for (const arm of ['A', 'B', 'C']) plan.push({ arm, task: t, n });
}
evidence.skillsAtStart = registry.list().map(s => ({ id: s.id, name: s.name, version: s.version, state: s.state }));
if (!runs.get(ledgerId)) runs.create(ledgerId, plan.map(p => ({ id: `${p.arm}:${p.task.id}#${p.n}${p.skillId ? ':' + p.skillId.slice(0, 8) : ''}`, reversible: true })), { maxConcurrent: 1, maxRetries: 1, persist: true });
else (evidence.recoveries ??= []).push({ at: new Date().toISOString(), ledger: runs.summary(runs.recover(ledgerId).id) });

for (const p of plan) {
  const node = `${p.arm}:${p.task.id}#${p.n}${p.skillId ? ':' + p.skillId.slice(0, 8) : ''}`;
  if (done(p.arm, p.task.id, p.n) && !p.skillId) { if (runs.get(ledgerId).nodes.find(x => x.id === node)?.state === 'pending') { runs.start(ledgerId, node); runs.finish(ledgerId, node, { ok: true }); } continue; }
  if (p.skillId && evidence.runs.some(r => r.skillId === p.skillId)) continue;
  runs.start(ledgerId, node);
  const opts = PHASE === 'validate' ? { skillScope: `project:ma4-s2-validate-${p.skillId}`, mode: 'validation' } : PHASE === 'qualify' ? { skillScope: 'project:ma4-s2-qualify', mode: 'validation' } : {};
  const { result, record } = await trial(p.task, p.arm, p.n, opts);
  if (p.skillId) record.skillId = p.skillId;
  evidence.runs = evidence.runs.filter(r => !(r.arm === record.arm && r.task === record.task && r.trial === record.trial && r.skillId === record.skillId));
  evidence.runs.push(record);
  runs.finish(ledgerId, node, { ok: true, resultSha256: sha(JSON.stringify(record)) });
  // Learning writes: discovery and qualification trials become verified experience (never held-out trials).
  if (PHASE === 'discover') {
    memory.recordExperience(SCOPE, experienceOf(p.task, record), 'synthetic');
    if (result.status === 'passed') {
      const x = await extractSkill({ call: rawCall, model: PINS.Reviewer, task: p.task, result, signal: new AbortController().signal });
      (evidence.extractions ??= []).push({ task: p.task.id, trial: p.n, repaired: record.repairsUsed > 0, ok: !!x.proposal, error: x.error, promptSha256: x.promptSha256, durationMs: x.durationMs, name: x.proposal?.name ?? null });
      if (x.proposal) {
        const skill = registry.propose(x.proposal, { failureCategories: [...new Set(result.failures.map(f => f.failureCategory))], provenance: { taskId: p.task.id, trial: p.n, model: PINS.Reviewer, extractorSha256: x.promptSha256, discoveredAt: new Date().toISOString() } });
        evidence.extractions.at(-1).skillId = skill.id;
      }
    }
  }
  if (PHASE === 'validate') {
    const ok = result.status === 'passed' && record.skillsSeen.includes(p.skillId);
    registry.addEvidence(p.skillId, { stage: 'sandbox', passed: ok, detail: `${p.task.id}: ${result.status}${record.skillsSeen.includes(p.skillId) ? '' : ' (skill not retrieved)'}`, trials: [node] });
    registry.transition(p.skillId, ok ? 'sandbox_validated' : 'rejected', 'host', ok ? 'source task passed with the skill' : 'sandbox validation failed');
  }
  save();
  await unload();
}

// ── phase conclusions ──────────────────────────────────────────────────────────────────────────────────────────────
if (PHASE === 'discover') {
  // Screening, de-duplication and the candidate cap (§1.3 step 2): repaired trials first, then task order.
  const order = S2_TASKS.map(t => t.id), seen = new Set();
  const proposed = (evidence.extractions ?? []).filter(x => x.skillId).sort((a, b) => (+b.repaired - +a.repaired) || order.indexOf(a.task) - order.indexOf(b.task) || a.trial - b.trial);
  evidence.candidates = [];
  for (const x of proposed) {
    let skill = registry.get(x.skillId);
    if (skill.state === 'discovered') {
      if (seen.has(skill.name)) skill = registry.transition(skill.id, 'rejected', 'host', 'duplicate name');
      else if (evidence.candidates.filter(c => c.state === 'candidate').length >= MAX_CANDIDATES) skill = registry.transition(skill.id, 'rejected', 'host', 'candidate cap reached');
      else skill = registry.screen(skill.id, FORBIDDEN);
    }
    seen.add(skill.name);
    evidence.candidates.push({ id: skill.id, name: skill.name, task: x.task, trial: x.trial, state: skill.state, screen: skill.evidence.find(e => e.stage === 'screen')?.detail ?? skill.history.at(-1).reason, categories: skill.categories, roles: skill.roles, procedure: skill.procedure, tools: skill.tools });
  }
}
if (PHASE === 'qualify') {
  // §1.3 step 4: retrieved in ≥ 1 qualify trial, C passes on those slots ≥ B passes on the same slots, no violation.
  evidence.qualification = [];
  for (const s of registry.list(['sandbox_validated'])) {
    const slots = evidence.runs.filter(r => r.arm === 'C' && r.skillsSeen.includes(s.id));
    const cPass = slots.filter(r => r.status === 'passed').length;
    const bPass = slots.filter(c => evidence.runs.some(b => b.arm === 'B' && b.task === c.task && b.trial === c.trial && b.status === 'passed')).length;
    const violation = slots.some(r => !r.invariants.pinsHeld || r.invariants.handoffsRefused > 0);
    const ok = slots.length > 0 && cPass >= bPass && !violation;
    registry.addEvidence(s.id, { stage: 'qualify', passed: ok, detail: slots.length ? `retrieved in ${slots.length} qualify trial(s): C ${cPass}/${slots.length} vs B ${bPass}/${slots.length}${violation ? '; violation' : ''}` : 'never retrieved on the qualify split (generalization unproven)', trials: slots.map(r => `${r.task}#${r.trial}`) });
    if (ok) { registry.transition(s.id, 'benchmark_qualified', 'host', 'qualified on the qualify split'); memory.recordSkillPointer(SCOPE, registry.get(s.id), 'synthetic'); }
    evidence.qualification.push({ id: s.id, name: s.name, slots: slots.length, cPass, bPass, violation, qualified: ok });
  }
  // Qualification trials become experience only now, so no qualify trial saw another's outcome.
  for (const r of evidence.runs) memory.recordExperience(SCOPE, experienceOf(S2_TASKS.find(t => t.id === r.task), r), 'synthetic');
}
const summarize = rs => {
  const n = rs.length, pass = rs.filter(r => r.status === 'passed').length, lat = rs.flatMap(r => r.calls.filter(c => c.ok).map(c => c.durationMs)).sort((a, b) => a - b);
  return { trials: n, passed: pass, passInterval: wilsonInterval(pass, n), firstAttempt: rs.filter(r => r.firstAttempt).length,
    byKind: Object.fromEntries([...new Set(rs.map(r => r.kind))].map(k => [k, `${rs.filter(r => r.kind === k && r.status === 'passed').length}/${rs.filter(r => r.kind === k).length}`])),
    statuses: rs.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}), repairsUsed: rs.reduce((a, r) => a + r.repairsUsed, 0), passedAfterRepair: rs.filter(r => r.status === 'passed' && r.repairsUsed > 0).length,
    modelCalls: rs.reduce((a, r) => a + r.modelCalls, 0), promptTokens: rs.reduce((a, r) => a + r.promptTokens, 0), outputTokens: rs.reduce((a, r) => a + r.outputTokens, 0), truncated: rs.reduce((a, r) => a + r.truncated, 0),
    modelLoads: rs.reduce((a, r) => a + r.modelLoads, 0), modelSwitches: rs.reduce((a, r) => a + r.gate.modelSwitches, 0), peakConcurrent: Math.max(0, ...rs.map(r => r.gate.peakConcurrent)),
    callLatencyMs: { median: lat[Math.floor(lat.length / 2)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null }, trialMs: { total: rs.reduce((a, r) => a + r.durationMs, 0), median: rs.map(r => r.durationMs).sort((a, b) => a - b)[Math.floor(n / 2)] ?? null },
    failureCategories: rs.flatMap(r => r.failures.map(f => f.category)).reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {}),
    reviewerFalseApprovals: rs.filter(r => r.reviewerFalseApproval).length, guidanceShown: rs.filter(r => r.guidance.length).length, skillsUsed: [...new Set(rs.flatMap(r => r.skillsSeen))].length,
    handoffs: rs.reduce((a, r) => a + r.handoffs.sent, 0), handoffsRefused: rs.reduce((a, r) => a + r.handoffs.refused, 0),
    invariants: { pinsHeld: rs.every(r => r.invariants.pinsHeld), gateIsAuthority: rs.every(r => r.invariants.gateIsAuthority), noHandoffRefused: rs.every(r => r.invariants.handoffsRefused === 0) } };
};
const versus = (x, y) => {
  const slots = evidence.runs.filter(r => r.arm === x).map(a => [a, evidence.runs.find(b => b.arm === y && b.task === a.task && b.trial === a.trial)]).filter(([, b]) => b);
  const wins = slots.filter(([a, b]) => a.status === 'passed' && b.status !== 'passed').length, losses = slots.filter(([a, b]) => a.status !== 'passed' && b.status === 'passed').length;
  return { pairs: slots.length, wins, losses, difference: wins - losses, signTestP: signTest(wins, losses) };
};
const arms = [...new Set(evidence.runs.map(r => r.arm))];
evidence.summary = { byArm: Object.fromEntries(arms.map(a => [a, summarize(evidence.runs.filter(r => r.arm === a))])), externalRequestsRefused: refused, memoryWaitSamples: memoryWaits.length, minFreeGiB: Number.isFinite(minFreeGiB) ? +minFreeGiB.toFixed(2) : null, ledger: runs.summary(ledgerId) };
if (PHASE === 'qualify') evidence.summary.CvsB = versus('C', 'B');
if (PHASE === 'heldout') {
  const s = evidence.summary, A = s.byArm.A, C = s.byArm.C;
  Object.assign(s, { CvsA: versus('C', 'A'), CvsB: versus('C', 'B'), BvsA: versus('B', 'A') });
  const invariants = Object.values(s.byArm).every(a => Object.values(a.invariants).every(Boolean)) && refused === 0;
  s.primary = { criterion: 'C passes >= A passes + 3 (of 24) AND one-sided sign test C vs A p <= 0.10 AND all invariants', cMinusA: C.passed - A.passed, p: s.CvsA.signTestP, invariants,
    met: C.passed - A.passed >= 3 && s.CvsA.signTestP <= 0.10 && invariants };
  s.verdict = s.primary.met ? 'S2 intelligence improvement DEMONSTRATED on the pre-registered held-out criterion' : 'functionally complete, intelligence improvement UNPROVEN (pre-registered criterion not met)';
}
evidence.skillsAtEnd = registry.list().map(s => ({ id: s.id, name: s.name, version: s.version, state: s.state }));
evidence.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ phase: PHASE, summary: evidence.summary, candidates: evidence.candidates?.map(c => `${c.name}:${c.state}`), qualification: evidence.qualification }, null, 1));
