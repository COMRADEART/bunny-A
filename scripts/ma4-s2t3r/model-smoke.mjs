// MA4-S2-T3R Phase H: real local pinned-model smoke. The production Host entry (runHostEntry: real containment, real
// Ollama call with the served-model receipt check) on an isolated data directory and port; provider CLI probes off.
// The workspace is a synthetic project folder. Model outputs are not stored: only lengths, hashes and grounding checks.
//   node --experimental-strip-types scripts/ma4-s2t3r/model-smoke.mjs
// Output: docs/ma4-s2-t3r/evidence/model-smoke.json
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runHostEntry } from '../../src/lib/bunny-host/entry.server.ts';

const MODEL = 'qwen2.5-coder:7b', CLOUD = 'deepseek-v4.1-flash:cloud', MIN = 60_000, DAY = 24 * 60 * MIN;
const repo = resolve(import.meta.dirname, '../..');
const free = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const ollama = async path => (await fetch(`http://127.0.0.1:11434${path}`, { signal: AbortSignal.timeout(10_000) })).json();
const sha = t => createHash('sha256').update(t).digest('hex');
// Outside Git and outside %LOCALAPPDATA% (the Host refuses both for these roles).
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t3r-model-')), project = mkdtempSync(join(homedir(), 'Documents', 'bunny-model-smoke-'));
writeFileSync(join(project, 'STATUS.md'), 'Atlas status (synthetic). Open issues: login timeout on slow networks; onboarding copy needs review. Release candidate RC3 was built on 2026-10-20. Next milestone: beta.\n');
const port = await free();
const evidence = { model: MODEL, ollama: null, steps: [], checks: [] };
const check = (name, pass, detail = null) => { evidence.checks.push({ name, pass: !!pass, detail }); console.error(`[smoke] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail).slice(0, 400)}` : ''}`); };
let host = null;
try {
  const tags = await ollama('/api/tags');
  evidence.ollama = { version: (await ollama('/api/version')).version, pinned: tags.models.find(m => m.name === MODEL) ? { digest: tags.models.find(m => m.name === MODEL).digest, size: tags.models.find(m => m.name === MODEL).size } : null };
  if (!evidence.ollama.pinned) throw new Error(`BLOCKED: ${MODEL} is not installed locally.`);
  host = await runHostEntry({ dataDirectory: data, root: project, port, adapters: [] });
  if (!host) throw new Error('Host did not start.');
  const auth = { connection: 'close', Authorization: `Bearer ${host.token}` };
  const cmd = async (action, d = {}) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) }); const b = await r.json(); if (r.status !== 200) throw Object.assign(new Error(`${action}: ${b.error}`), { refused: true }); return b.data; };
  const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers: auth })).json();
  const task = async id => (await state()).persistentTasks.tasks.find(t => t.id === id);
  const until = async (pick, ms) => { const end = Date.now() + ms; for (;;) { const v = await pick(); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 500)); } };
  const env = (kinds, extra = {}) => ({ capabilities: kinds, providers: ['ollama'], localOnly: true, models: [MODEL], projectScopes: ['p1'], sideEffects: false, background: true, budgets: { maxModelCalls: 6, maxWallMs: 30 * MIN }, expiresAt: Date.now() + DAY, grants: { files: [{ root: 'atlas', access: 'read' }] }, ...extra });
  await cmd('connector.roots.set', { roots: [{ id: 'atlas', label: 'Atlas project', path: project }] });

  // 1. A suggested goal is not active until the owner approves it.
  const goal = await cmd('goal.create', { spec: { title: 'Prepare Atlas for beta', projectId: 'p1', successCriteria: [{ id: 'status', description: 'Current status summarized and checked' }], expiresAt: Date.now() + 7 * DAY }, suggested: true });
  const g0 = (await state()).proactive.goals.find(x => x.id === goal.id);
  check('suggested goal is not active', g0.state !== 'ACTIVE', { state: g0.state });
  await cmd('goal.approve', { id: goal.id, version: g0.version });
  check('goal active after owner approval', (await state()).proactive.goals.find(x => x.id === goal.id).state === 'ACTIVE');

  // 2. Planner (proposal only) with the pinned model.
  let t0 = Date.now();
  const plan = await cmd('ptask.plan', { request: 'Read STATUS.md in the Atlas folder and write a short status summary for the owner, then check it against the file.', projectId: 'p1', model: MODEL, envelope: env(['file.read', 'local.generate', 'local.review']) }).catch(e => ({ error: e.message }));
  evidence.steps.push({ step: 'plan', ms: Date.now() - t0, kinds: plan.spec?.steps?.map(s => s.kind) ?? null, problems: plan.problems ?? null, error: plan.error ?? null });
  check('planner returns a validated proposal or explicit problems (no task created)', (plan.spec || plan.problems?.length || plan.error) && !(await state()).persistentTasks.tasks.length, evidence.steps.at(-1));

  // 3. Worker + Reviewer on the real file, pinned model, linked to the goal.
  const steps = [{ id: 'read', kind: 'file.read', input: { root: 'atlas', path: 'STATUS.md' } },
    { id: 'summary', kind: 'local.generate', input: { prompt: 'Summarize this project status for the owner in three short bullet points. Use only the source.', contextFrom: 'read' }, model: MODEL },
    { id: 'review', kind: 'local.review', input: { criteria: 'Every statement in the summary is supported by the source.', subjectFrom: 'summary', contextFrom: 'read' }, model: MODEL }];
  const work = await cmd('ptask.create', { spec: { title: 'Atlas status summary', projectId: 'p1', steps, acceptance: { requiredSteps: steps.map(s => s.id) } }, envelope: env(['file.read', 'local.generate', 'local.review']) });
  await cmd('goal.link', { id: goal.id, criterionId: 'status', taskId: work.id });
  t0 = Date.now();
  await cmd('ptask.approve', { id: work.id });
  const done = await until(async () => { const t = await task(work.id); return t && ['COMPLETED', 'FAILED', 'CANCELLED', 'UNCERTAIN'].includes(t.state) && t; }, 15 * MIN);
  const loaded = (await ollama('/api/ps')).models?.map(m => m.name) ?? [];
  const summary = done?.state === 'COMPLETED' ? await cmd('ptask.output', { id: work.id, stepId: 'summary' }).catch(() => null) : null;
  const text = summary?.content ?? '';
  evidence.steps.push({ step: 'worker+reviewer', ms: Date.now() - t0, state: done?.state ?? 'TIMEOUT', failure: done?.failure ?? null, progress: done?.progress ?? null, evidence: done?.evidence?.map(e => e.stepId) ?? null, loadedModels: loaded, summary: { chars: text.length, sha256: text ? sha(text) : null } });
  check('pinned-model task completes through Worker and Reviewer', done?.state === 'COMPLETED', evidence.steps.at(-1));
  check('the pinned model actually served (loaded in Ollama)', loaded.includes(MODEL), loaded);
  check('summary is grounded in the file (mentions the login timeout and RC3)', /login/i.test(text) && /RC3|release candidate/i.test(text), { chars: text.length });
  const g1 = await until(async () => { const x = (await state()).proactive.goals.find(y => y.id === goal.id); return x.progress.met === 1 && x; }, 60_000);
  check('goal progress counts only the completed, verified task', !!g1, g1?.progress ?? null);

  // 4. Pause and cancel while the model is working.
  const long = await cmd('ptask.create', { spec: { title: 'Long draft', projectId: 'p1', steps: [{ id: 'read', kind: 'file.read', input: { root: 'atlas', path: 'STATUS.md' } }, { id: 'draft', kind: 'local.generate', input: { prompt: 'Write a detailed 800-word beta readiness plan from this status, section by section.', contextFrom: 'read' }, model: MODEL }], acceptance: { requiredSteps: ['read', 'draft'] } }, envelope: env(['file.read', 'local.generate'], { capabilities: ['file.read', 'local.generate'] }) });
  await cmd('ptask.approve', { id: long.id });
  const running = await until(async () => { const t = await task(long.id); return t?.state === 'RUNNING' && t.progress.current === 'draft' && t; }, 5 * MIN);
  t0 = Date.now();
  await cmd('ptask.pause', { id: long.id });
  const paused = await until(async () => { const t = await task(long.id); return t?.state === 'PAUSED' && t; }, 2 * MIN);
  check('pause during generation stops the run', !!running && !!paused, { reachedRunning: !!running, ms: Date.now() - t0, state: paused?.state ?? (await task(long.id))?.state });
  await cmd('ptask.cancel', { id: long.id });
  const cancelled = await until(async () => { const t = await task(long.id); return t?.state === 'CANCELLED' && t; }, 2 * MIN);
  check('cancel ends it', !!cancelled, { state: cancelled?.state ?? (await task(long.id))?.state });

  // 5. A cloud tag is never used, even when named.
  const cloud = await cmd('ptask.create', { spec: { title: 'Cloud attempt', projectId: 'p1', steps: [{ id: 'g', kind: 'local.generate', input: { prompt: 'Say hello.' }, model: CLOUD }], acceptance: { requiredSteps: ['g'] } }, envelope: { ...env(['local.generate']), models: [CLOUD], grants: {} } }).then(t => ({ created: t.id }), e => ({ refused: e.message }));
  if (cloud.created) { await cmd('ptask.approve', { id: cloud.created }).catch(() => undefined); await new Promise(r => setTimeout(r, 5_000)); }
  const cloudTask = cloud.created ? await task(cloud.created) : null;
  evidence.steps.push({ step: 'cloud', ...cloud, state: cloudTask?.state ?? null, failure: cloudTask?.failure ?? null, blocked: cloudTask?.blocked ?? null });
  check('a cloud model tag is refused or never runs', !!cloud.refused || (cloudTask && cloudTask.state !== 'COMPLETED' && !cloudTask.evidence.some(e => e.stepId === 'g')), evidence.steps.at(-1));
} catch (error) {
  evidence.error = String(error?.message ?? error);
  console.error(evidence.error);
} finally {
  await host?.close().catch(() => undefined);
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); rmSync(project, { recursive: true, force: true, maxRetries: 10 });
  const failed = evidence.checks.filter(c => !c.pass).length;
  mkdirSync(join(repo, 'docs/ma4-s2-t3r/evidence'), { recursive: true });
  writeFileSync(join(repo, 'docs/ma4-s2-t3r/evidence/model-smoke.json'), JSON.stringify({ at: new Date().toISOString(), ...evidence, failed }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: evidence.checks.length, failed, error: evidence.error ?? null }));
  process.exitCode = failed || evidence.error ? 1 : 0;
}
