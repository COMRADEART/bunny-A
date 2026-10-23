// MA4-S2-T1 live qualification on THIS PC: the real Host process (scripts/bunny-host.mjs) and real local inference on the
// pinned Ollama model. No window is attached at any point (the script never reads /state; ptask.* commands are not window
// presence). Isolated application data under %LOCALAPPDATA%\Bunny-A, a free port, never the installed Host.
//   node --experimental-strip-types scripts/ma4-s2t1/live-qualify.mjs
// Output: docs/ma4-s2-t1/evidence/live-qualification.json (hashes and lengths of model output, never the output text).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PIN = 'qwen2.5-coder:7b', HOSTED = 'deepseek-v4.1-flash:cloud', OLLAMA = 'http://127.0.0.1:11434';
const data = join(process.env.LOCALAPPDATA, 'Bunny-A', `ma4-s2t1-qual-${Date.now()}`);
mkdirSync(data, { recursive: true });
const port = await new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const ev = { at: new Date().toISOString(), pin: PIN, port, freeMemGiBAtStart: +(freemem() / 1024 ** 3).toFixed(1), steps: [] };
const note = (name, facts) => { ev.steps.push({ name, ...facts }); log(name, JSON.stringify(facts)); };

let host = null, token = null;
async function startHostProcess() {
  const started = performance.now();
  host = spawn(process.execPath, ['--experimental-strip-types', 'scripts/bunny-host.mjs'], { env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: data, BUNNY_HOST_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 240; i++) {
    try { const h = await (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).json(); if (h.pid === host.pid) break; } catch { /* starting */ }
    await sleep(250);
  }
  token = JSON.parse(readFileSync(join(data, 'credentials.json'), 'utf8')).token;
  return performance.now() - started;
}
const cmd = async (action, d = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) });
  const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.code} ${b.error}`); return b.data;
};
const get = id => cmd('ptask.get', { id });
async function until(id, ok, ms) { const end = Date.now() + ms; for (;;) { const t = await get(id); if (ok(t)) return t; if (Date.now() > end) return t; await sleep(250); } }
const kill = () => { execFileSync('taskkill.exe', ['/PID', String(host.pid), '/F'], { windowsHide: true }); return new Promise(r => host.once('exit', r)); };
const envelope = (o = {}) => ({ capabilities: ['local.generate'], providers: ['ollama'], localOnly: true, models: [PIN], projectScopes: ['qual'], sideEffects: false, background: true, budgets: { maxModelCalls: 6, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 6 * 3_600_000, ...o });
const spec = (title, steps) => ({ title, projectId: 'qual', steps, acceptance: { requiredSteps: steps.map(s => s.id) } });

try {
  note('host.start', { ms: Math.round(await startHostProcess()) });
  // Q1 background OFF and no window: nothing runs.
  await cmd('ptask.policy', { policy: { background: false, resumeOnStart: false } });
  const q1 = await cmd('ptask.create', { spec: spec('Background off', [{ id: 'g', kind: 'local.generate', model: PIN, input: { prompt: 'Say OK.', maxTokens: 16 } }]), envelope: envelope({ background: false }) });
  await sleep(25_000);
  const q1v = await get(q1.id);
  note('Q1 background off, no window, 25 s', { state: q1v.state, done: q1v.progress.done });
  await cmd('ptask.cancel', { id: q1.id });

  // Q2 background ON, no window: a two-step task runs; the Host is killed mid-inference of step 1.
  await cmd('ptask.policy', { policy: { background: true, resumeOnStart: false } });
  const q2 = await cmd('ptask.create', { spec: spec('Release notes draft', [
    { id: 'g1', kind: 'local.generate', model: PIN, input: { prompt: 'Write a 250-word plain-text overview of how a write-ahead log makes a database crash-safe.', maxTokens: 400 } },
    { id: 'g2', kind: 'local.generate', model: PIN, input: { prompt: 'In one sentence, what is a fencing token?', maxTokens: 60 } }]), envelope: envelope() });
  note('Q2 created', { state: q2.state });
  await cmd('ptask.approve', { id: q2.id });
  const running = await until(q2.id, t => t.state === 'RUNNING', 120_000);
  let loaded = [];
  for (let i = 0; i < 240 && !loaded.length; i++) { loaded = (await (await fetch(`${OLLAMA}/api/ps`)).json()).models.map(m => m.name); if (!loaded.length) await sleep(500); }
  await sleep(4_000); // well inside step g1's generation
  const before = await get(q2.id);
  note('Q2 running before kill', { state: running.state, current: before.progress.current, done: before.progress.done, ollamaLoaded: loaded });
  const killedAt = performance.now();
  await kill();
  note('Q2 Host killed (taskkill /F)', { ms: Math.round(performance.now() - killedAt) });

  // Q3 restart: the default startup policy waits for the user; P11 is the time to that correct state.
  const restartAt = performance.now();
  const startMs = await startHostProcess();
  const recovered = await until(q2.id, t => t.state === 'PAUSED', 30_000);
  note('Q3 restart → recovered state (P11)', { hostStartMs: Math.round(startMs), toCorrectStateMs: Math.round(performance.now() - restartAt), state: recovered.state, blocked: recovered.blocked?.code, done: recovered.progress.done });
  await sleep(10_000);
  note('Q3 nothing ran on its own for 10 s', { state: (await get(q2.id)).state });

  // Q4 resume with no window: completes; step g1 re-runs once (read-only), g2 once; pins held.
  const resumedAt = performance.now();
  await cmd('ptask.resume', { id: q2.id });
  const done = await until(q2.id, t => ['COMPLETED', 'FAILED', 'PAUSED'].includes(t.state), 600_000);
  const outputs = await Promise.all(['g1', 'g2'].map(async s => { const o = await cmd('ptask.output', { id: q2.id, stepId: s }); return { step: s, chars: o?.content.length ?? 0, sha256: o ? createHash('sha256').update(o.content).digest('hex') : null }; }));
  note('Q4 resumed with no window', { state: done.state, failure: done.failure, ms: Math.round(performance.now() - resumedAt), evidence: done.evidence, outputs });

  // Q5 a hosted tag is never used: the task blocks, nothing is sent.
  const q5 = await cmd('ptask.create', { spec: spec('Hosted pin', [{ id: 'g', kind: 'local.generate', model: HOSTED, input: { prompt: 'x', maxTokens: 8 } }]), envelope: envelope({ models: [HOSTED] }) });
  await cmd('ptask.approve', { id: q5.id });
  const q5v = await until(q5.id, t => t.state === 'PAUSED' || t.state === 'COMPLETED', 30_000);
  note('Q5 hosted model pin', { state: q5v.state, blocked: q5v.blocked?.code, done: q5v.progress.done });

  // P9 idle CPU: no running task, no window, 60 s.
  await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: PIN, keep_alive: 0 }) }).then(r => r.text()).catch(() => {});
  const cpu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${host.pid}).TotalProcessorTime.TotalMilliseconds`], { encoding: 'utf8' }).trim());
  await sleep(5_000);
  const c0 = cpu(), t0 = performance.now(); await sleep(60_000); const c1 = cpu(), t1 = performance.now();
  note('P9 idle CPU', { cpuMs: Math.round(c1 - c0), wallMs: Math.round(t1 - t0), percentOfOneCore: +((c1 - c0) / (t1 - t0) * 100).toFixed(2) });
  await kill();

  // Ledger facts straight from the database the Host wrote.
  const db = new DatabaseSync(join(data, 'host.sqlite'), { readOnly: true });
  ev.operations = db.prepare('SELECT key,category,state,attempts FROM ma4_task_operations ORDER BY key').all();
  ev.q2Transitions = db.prepare('SELECT from_state,to_state,actor,reason FROM ma4_task_transitions WHERE task_id=? ORDER BY seq').all(q2.id);
  ev.notifications = db.prepare('SELECT kind,text,delivered FROM ma4_task_notifications ORDER BY at').all();
  ev.events = db.prepare("SELECT type,detail FROM events WHERE type LIKE 'ptask.%' AND type NOT IN ('ptask.changed') ORDER BY sequence").all();
  db.close();
} finally {
  try { if (host && host.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(host.pid), '/F'], { windowsHide: true }); } catch { /* gone */ }
  writeFileSync('docs/ma4-s2-t1/evidence/live-qualification.json', JSON.stringify(ev, null, 2) + '\n');
  await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: PIN, keep_alive: 0 }) }).then(r => r.text()).catch(() => {});
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
