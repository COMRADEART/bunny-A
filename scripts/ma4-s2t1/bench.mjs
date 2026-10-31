// MA4-S2-T1 performance qualification against the targets pre-registered in docs/ma4-s2-t1/PERFORMANCE_REPORT.md §1.
//   node --expose-gc --experimental-strip-types scripts/ma4-s2t1/bench.mjs
// Real store and runtime on a file-backed WAL database; recorded fake executors (no model). P9 and P11 are measured by
// live-qualify.mjs on the real Host process. Output: docs/ma4-s2-t1/evidence/bench.json.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { TaskStore } from '../../src/lib/bunny-host/ma4/task-store.server.ts';
import { PersistentTaskRuntime } from '../../src/lib/bunny-host/ma4/task-runtime.server.ts';
import { killVerifiedProcess, processIdentity } from '../../src/lib/bunny-host/ma4/task-executors.server.ts';

const p = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null; };
const stats = xs => ({ n: xs.length, p50: +p(xs, 0.5).toFixed(2), p95: +p(xs, 0.95).toFixed(2), max: +Math.max(...xs).toFixed(2) });
const holds = new Map();
const marks = [];
const executors = [
  { kind: 'b.read', category: 'read_only', gpu: false, sideEffect: false, timeoutMs: 600_000,
    async run(input, ctx) {
      marks.push({ at: performance.now(), kind: 'start', task: ctx.taskId });
      if (input.hold) await new Promise(r => { holds.set(ctx.taskId, r); ctx.signal.addEventListener('abort', r, { once: true }); });
      marks.push({ at: performance.now(), kind: 'end', task: ctx.taskId });
      return ctx.signal.aborted ? { ok: false, error: 'stopped', dispatched: true, definite: false } : { ok: true, output: 'ok' };
    } },
  { kind: 'b.gen', category: 'read_only', gpu: true, sideEffect: false, timeoutMs: 600_000,
    async run(_input, ctx) { const r = await ctx.call({ role: 'Worker', model: ctx.model, prompt: 'x', schema: null, signal: ctx.signal, attempt: ctx.attempt }); return r.ok ? { ok: true, output: r.text } : { ok: false, error: r.error, dispatched: true, definite: true }; } },
  { kind: 'b.child', category: 'read_only', gpu: false, sideEffect: false, timeoutMs: 600_000,
    async run(_input, ctx) { const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true }); children.push(c.pid); ctx.track(c); await new Promise(r => { holds.set(ctx.taskId, r); }); return { ok: true, output: 'ok' }; } },
];
const children = [];
const call = async req => { await new Promise(r => setTimeout(r, 30)); return { ok: true, text: 'x', servedModel: req.model, durationMs: 30 }; };
const envelope = (project = 'p1') => ({ capabilities: ['b.read', 'b.gen', 'b.child'], providers: ['ollama'], localOnly: true, models: ['m:7b'], projectScopes: [project], sideEffects: false, background: false, budgets: { maxModelCalls: 50, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000 });
const spec = (steps, project = 'p1', title = 'bench') => ({ title, projectId: project, steps, acceptance: { requiredSteps: steps.map(s => s.id) } });
const open = (dir, extra = {}) => { const db = new HostDatabase(join(dir, 'host.db')), store = new TaskStore(db); return { db, store, rt: new PersistentTaskRuntime({ store, executors, call, modelAvailable: async () => true, uiAttached: () => true, ...extra }) }; };
const results = { at: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}` };

// P1 creation, P4 query, P6 memory
{
  const dir = mkdtempSync(join(tmpdir(), 's2t1-bench-')), { db, rt } = open(dir);
  global.gc?.(); const rss0 = process.memoryUsage().rss;
  const create = [];
  for (let i = 0; i < 200; i++) { const t = performance.now(); rt.create({ spec: spec([{ id: 'a', kind: 'b.read', input: { n: i } }, { id: 'b', kind: 'b.read', input: {} }]), envelope: envelope() }, 'workstation'); create.push(performance.now() - t); }
  rt.crash(); // nothing runs; the scheduler wake from create() is cancelled
  global.gc?.(); const rss1 = process.memoryUsage().rss;
  const query = []; for (let i = 0; i < 50; i++) { const t = performance.now(); rt.snapshot(); query.push(performance.now() - t); }
  results.P1_createMs = stats(create); results.P4_snapshot200Ms = stats(query); results.P6_rssDeltaMB = +((rss1 - rss0) / 1024 ** 2).toFixed(2);
  db.close(); rmSync(dir, { recursive: true, force: true });
}
// P2 claim, P3 per-step bookkeeping
{
  const dir = mkdtempSync(join(tmpdir(), 's2t1-bench-')), { db, rt } = open(dir, { maxActive: 1 });
  const claim = [];
  for (let i = 0; i < 50; i++) {
    rt.create({ spec: spec([{ id: 'a', kind: 'b.read', input: {} }]), envelope: envelope() }, 'workstation');
    const t = performance.now(); await rt.tick(); claim.push(performance.now() - t); await rt.idle();
  }
  marks.length = 0;
  for (let i = 0; i < 10; i++) { rt.create({ spec: spec(Array.from({ length: 20 }, (_, j) => ({ id: `s${j}`, kind: 'b.read', input: {} }))), envelope: envelope() }, 'workstation'); await rt.tick(); await rt.idle(); }
  const gaps = [];
  for (let i = 1; i < marks.length; i++) if (marks[i - 1].kind === 'end' && marks[i].kind === 'start' && marks[i - 1].task === marks[i].task) gaps.push(marks[i].at - marks[i - 1].at);
  results.P2_claimMs = stats(claim); results.P3_stepBookkeepingMs = stats(gaps);
  await rt.close(); db.close(); rmSync(dir, { recursive: true, force: true });
}
// P7 fairness, P8 model gate
{
  const dir = mkdtempSync(join(tmpdir(), 's2t1-bench-')), events = [];
  const { db, rt } = open(dir, { maxActive: 1, emit: (type, detail, _id) => { if (type === 'ptask.changed' && / RUNNING$/.test(detail)) events.push(detail.split(':')[0]); } });
  for (let i = 0; i < 10; i++) for (const project of ['alpha', 'beta']) rt.create({ spec: spec([{ id: 'a', kind: 'b.read', input: {} }], project, project), envelope: envelope(project) }, 'workstation');
  for (let i = 0; i < 40; i++) { await rt.tick(); await rt.idle(); }
  // A claim is the QUEUED -> RUNNING transition, read from the append-only history.
  const db2 = new HostDatabase(join(dir, 'host.db'));
  const seq = db2.db.prepare("SELECT t.task_id, json_extract(k.record,'$.projectId') AS project FROM ma4_task_transitions t JOIN ma4_tasks k ON k.id=t.task_id WHERE t.from_state='QUEUED' AND t.to_state='RUNNING' ORDER BY t.seq").all().map(r => r.project);
  let run = 1, longest = 1; for (let i = 1; i < seq.length; i++) { const bothLeft = seq.slice(i).includes('alpha') && seq.slice(i).includes('beta'); run = seq[i] === seq[i - 1] ? run + 1 : 1; if (bothLeft) longest = Math.max(longest, run); }
  results.P7_fairness = { claimOrder: seq.join(','), longestSameProjectRunWhileBothQueued: longest };
  db2.close(); await rt.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  const dir2 = mkdtempSync(join(tmpdir(), 's2t1-bench-')), g = open(dir2, { maxActive: 4 });
  for (let i = 0; i < 4; i++) g.rt.create({ spec: spec([{ id: 'g', kind: 'b.gen', model: 'm:7b', input: {} }]), envelope: envelope() }, 'workstation');
  await g.rt.tick(); await g.rt.idle();
  results.P8_modelGate = { activeTasks: 4, ...g.rt.gateStats() };
  await g.rt.close(); g.db.close(); rmSync(dir2, { recursive: true, force: true });
}
// P5 recovery with 50 interrupted tasks
{
  const dir = mkdtempSync(join(tmpdir(), 's2t1-bench-')), a = open(dir, { maxActive: 50 });
  for (let i = 0; i < 50; i++) a.rt.create({ spec: spec([{ id: 'a', kind: 'b.read', input: { hold: true } }]), envelope: envelope() }, 'workstation');
  await a.rt.tick();
  a.rt.crash(); a.db.close();
  const b = open(dir, { exclusive: true });
  b.store.setPolicy({ background: false, resumeOnStart: false });
  const t = performance.now(); await b.rt.start(); const ms = performance.now() - t;
  const states = b.store.list().map(r => r.ok ? r.record.state : 'CORRUPT');
  results.P5_recovery50 = { ms: +ms.toFixed(1), interrupted: 50, pausedForUser: states.filter(s => s === 'PAUSED').length };
  for (const r of holds.values()) r();
  await b.rt.close(); b.db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
}
// P10 process cleanup (Windows: production identity-verified termination). One fresh task per Host life.
if (process.platform === 'win32') {
  const dir = mkdtempSync(join(tmpdir(), 's2t1-bench-')), opts = { identify: processIdentity, killVerified: killVerifiedProcess, exclusive: true };
  let env = open(dir, opts);
  for (let i = 0; i < 10; i++) {
    env.rt.create({ id: `cleanup-${i}`, spec: spec([{ id: 'c', kind: 'b.child', input: {} }]), envelope: envelope() }, 'workstation');
    await env.rt.tick();
    for (let w = 0; w < 100 && !env.store.processes().some(x => x.taskId === `cleanup-${i}`); w++) await new Promise(r => setTimeout(r, 100));
    Object.assign(env.rt, { dead: true, closed: true }); env.db.close(); // the Host dies; its escaped (detached) child lives on
    env = open(dir, opts);
    await env.rt.start(); // default policy: recovered work waits for the user; the orphan is cleaned up
    env.rt.cancel(`cleanup-${i}`, 'workstation');
  }
  await new Promise(r => setTimeout(r, 500));
  const alive = children.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  results.P10_cleanup = { cycles: 10, childrenSpawned: children.length, survivors: alive.length, recordsLeft: env.store.processes().length };
  for (const pid of alive) try { process.kill(pid); } catch { /* gone */ }
  for (const r of holds.values()) r();
  await env.rt.close(); env.db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
}
writeFileSync('docs/ma4-s2-t1/evidence/bench.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
