// MA4-S2-T3 performance bench (docs/ma4-s2-t3/PERFORMANCE_REPORT.md). Real Host processes on this laptop, real timers.
//   node --experimental-strip-types scripts/ma4-s2t3/bench.mjs [--out file.json] [--idle-s 60]
// 1. Idle Host, nothing proactive configured: CPU and heap over a quiet window (the baseline).
// 2. Same Host with 8 active file monitors (60 s interval, the policy minimum), 10 daily schedules and a goal: same window.
// 3. Scheduler lateness: 10 one-time reminders, each found by the engine's own timer (real setTimeout, no wake command).
// 4. Restart recovery: a Host restart with that state; time until the engine has completed its first pass.
// 5. A scheduled summary run end to end: model calls per completed proactive task (recorded fake model).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';
import { localGenerate } from '../../src/lib/bunny-host/ma4/task-executors.server.ts';
import { localReview } from '../../src/lib/bunny-host/ma4/connected-workflow.server.ts';
import { fakeModel, MODEL, TEST_BASE } from '../../src/lib/bunny-host/ma4-s2t2-fixtures.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const IDLE_MS = Number(arg('--idle-s', '60')) * 1000, MIN = 60_000, DAY = 24 * 60 * MIN;
const free = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
mkdirSync(TEST_BASE, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t3-bench-')), project = mkdtempSync(join(TEST_BASE, 'bench3-'));
mkdirSync(join(project, 'build'));
writeFileSync(join(project, 'STATUS.md'), 'Atlas status: two open issues; RC3 built.\n');
for (let i = 0; i < 8; i++) writeFileSync(join(project, 'build', `status-${i}.json`), JSON.stringify({ status: 'PASS' }));
const model = fakeModel({ Worker: 'Atlas: two open issues; RC3 built.' });
const port = await free();
const clock = { offset: 0 }, now = () => Date.now() + clock.offset;
const options = { dataDirectory: data, root: project, port, adapters: [], sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: [] }),
  ptasks: { executors: [localGenerate, localReview], call: model.call, modelAvailable: async m => m === MODEL, now }, proactive: { now } };
let host = await startHost(options);
const cmd = async (action, d = {}) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { connection: 'close', Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) }); const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.error}`); return b.data; };
const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers: { connection: 'close', Authorization: `Bearer ${host.token}` } })).json();
const until = async (pick, ms = 60_000) => { const end = Date.now() + ms; for (;;) { const s = await state(); const v = pick(s); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
/** CPU of this whole process (Host + engine + runtime) over a quiet window, as a share of one core. */
async function idle(label) {
  global.gc?.();
  const heap0 = process.memoryUsage().heapUsed, rss0 = process.memoryUsage().rss, cpu0 = process.cpuUsage(), t0 = performance.now();
  await new Promise(r => setTimeout(r, IDLE_MS));
  const cpu = process.cpuUsage(cpu0), wall = performance.now() - t0;
  global.gc?.();
  return { label, windowS: Math.round(wall / 1000), cpuPctOneCore: +((cpu.user + cpu.system) / 1000 / wall * 100).toFixed(3), heapMB: +(process.memoryUsage().heapUsed / 2 ** 20).toFixed(1), heapDeltaMB: +((process.memoryUsage().heapUsed - heap0) / 2 ** 20).toFixed(2), rssMB: +(process.memoryUsage().rss / 2 ** 20).toFixed(1), rss0MB: +(rss0 / 2 ** 20).toFixed(1) };
}
const env = (kinds, grants) => ({ capabilities: [...new Set(kinds)], providers: ['ollama'], localOnly: true, models: [MODEL], projectScopes: ['p1'], sideEffects: false, background: true, budgets: { maxModelCalls: 5, maxWallMs: 3_600_000 }, expiresAt: now() + 30 * DAY, grants });
const summary = { type: 'task', spec: { title: 'Project summary', projectId: 'p1', acceptance: { requiredSteps: ['read', 'sum', 'check'] },
  steps: [{ id: 'read', kind: 'file.read', input: { root: 'atlas', path: 'STATUS.md' } }, { id: 'sum', kind: 'local.generate', input: { prompt: 'Summarize.', contextFrom: 'read' }, model: MODEL },
    { id: 'check', kind: 'local.review', input: { criteria: 'Supported by the sources.', subjectFrom: 'sum', contextFrom: 'read' }, model: MODEL }] },
  envelope: env(['file.read', 'local.generate', 'local.review'], { files: [{ root: 'atlas', access: 'read' }] }) };
const hhmm = t => new Date(t).toISOString().slice(11, 16);
const result = { machine: { node: process.version, platform: process.platform, gcExposed: typeof global.gc === 'function' }, idle: [], lateness: [], recovery: null, run: null };
try {
  await state();
  await cmd('connector.roots.set', { roots: [{ id: 'atlas', label: 'Atlas project', path: project }] });
  result.idle.push(await idle('idle Host, nothing proactive'));
  // Load: 8 monitors at the policy minimum, 10 daily schedules, one goal.
  for (let i = 0; i < 8; i++) { const m = await cmd('monitor.create', { spec: { title: `Build ${i}`, label: `Build ${i}`, projectId: 'p1', source: { kind: 'file', root: 'atlas', path: `build/status-${i}.json`, field: 'status' }, predicate: { type: 'transition', from: 'PASS', to: 'FAIL' }, intervalMs: MIN, maxChecksPerHour: 60, expiresAt: now() + 7 * DAY } }); await cmd('monitor.approve', { id: m.id }); }
  for (let i = 0; i < 10; i++) { const s = await cmd('schedule.create', { spec: { title: `Daily ${i}`, projectId: 'p1', trigger: { type: 'daily', time: hhmm(now() + (6 + i) * 3_600_000), timeZone: 'UTC' }, action: summary, expiresAt: now() + 7 * DAY } }); await cmd('schedule.approve', { id: s.id }); }
  const g = await cmd('goal.create', { spec: { title: 'Beta', projectId: 'p1', successCriteria: [{ id: 'a', description: 'A' }], expiresAt: now() + 7 * DAY } }); await cmd('goal.approve', { id: g.id });
  const checks0 = (await state()).proactive.monitors.reduce((n, m) => n + m.checksLastHour, 0);
  result.idle.push({ ...(await idle('8 monitors + 10 schedules + 1 goal')), checksInWindow: (await state()).proactive.monitors.reduce((n, m) => n + m.checksLastHour, 0) - checks0, modelCalls: model.prompts.length });
  // Lateness: each reminder is due ~1.5 s after the clock is placed; only the engine's own armed timer finds it.
  for (let i = 0; i < 10; i++) {
    const slot = Math.ceil((now() + 5_000) / MIN) * MIN;
    const s = await cmd('schedule.create', { spec: { title: `Remind ${i}`, projectId: 'p1', trigger: { type: 'once', at: new Date(slot).toISOString().slice(0, 16), timeZone: 'UTC' }, action: { type: 'remind', text: `Reminder ${i}` }, expiresAt: now() + DAY } });
    await cmd('schedule.approve', { id: s.id });
    clock.offset = slot - 1_500 - Date.now();
    await cmd('proactive.list'); // re-arms the engine's timer for the new clock; the slot is still 1.5 s away
    await until(x => x.proactive.notifications.some(n => n.category === 'reminder_due' && n.sourceId === s.id), 30_000);
    result.lateness.push(host.proactive.lateness.at(-1));
  }
  // One scheduled summary end to end.
  const slot = Math.ceil((now() + 5_000) / MIN) * MIN, before = model.prompts.length;
  const run = await cmd('schedule.create', { spec: { title: 'Bench summary', projectId: 'p1', trigger: { type: 'daily', time: hhmm(slot), timeZone: 'UTC' }, action: { ...summary, spec: { ...summary.spec, title: 'Bench run' } }, expiresAt: now() + 7 * DAY } });
  await cmd('schedule.approve', { id: run.id });
  clock.offset = slot - 500 - Date.now(); await cmd('proactive.list');
  const t0 = performance.now();
  await until(x => x.persistentTasks.tasks.some(t => t.title === 'Bench run' && t.state === 'COMPLETED'), 60_000);
  const done = (await state()).persistentTasks.tasks.filter(t => t.title === 'Bench run');
  result.run = { slotToCompletedMs: Math.round(performance.now() - t0 + 500), modelCallsForTheRun: model.prompts.length - before, tasks: done.map(t => ({ state: t.state, receipts: t.evidence.length, createdAt: t.createdAt })), totalPrompts: model.prompts.length };
  // Restart recovery with all of that state on disk.
  await host.close();
  const r0 = performance.now();
  host = await startHost(options);
  const startMs = performance.now() - r0;
  const firstPass = await until(x => x.proactive && x.proactive.schedules.length >= 21 && x, 30_000);
  result.recovery = { hostStartMs: Math.round(startMs), stateAfterMs: Math.round(performance.now() - r0), schedules: firstPass.proactive.schedules.length, monitors: firstPass.proactive.monitors.length, duplicateTasks: firstPass.persistentTasks.tasks.filter(t => t.title === 'Bench run').length - 1, unexpectedTasks: firstPass.persistentTasks.tasks.filter(t => t.title !== 'Bench run').length };
  result.latenessMs = { n: result.lateness.length, p50: pct(result.lateness, 50), p95: pct(result.lateness, 95), max: Math.max(...result.lateness) };
  const outFile = arg('--out', null);
  if (outFile) writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await host.close().catch(() => undefined);
  rmSync(data, { recursive: true, force: true, maxRetries: 10 }); rmSync(project, { recursive: true, force: true, maxRetries: 10 });
}
