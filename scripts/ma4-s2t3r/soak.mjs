// MA4-S2-T3R real-clock soak driver (docs/ma4-s2-t3r/REAL_CLOCK_SOAK.md). Real time only: nothing here moves a clock.
//   node --experimental-strip-types scripts/ma4-s2t3r/soak.mjs --hours 24 --dir <soakDir> --project <folder> --port 43190
// It owns one Host process (soak-host.mjs), configures a permission-safe workload through the Host's own commands,
// drives file changes, reminders, cancellations, restarts, a crash, an offline window and a background-policy change on a
// fixed timeline, and samples the Host process every minute. Output (appended, timestamped): <soakDir>/events.jsonl,
// <soakDir>/samples.jsonl, <soakDir>/host.log. Analyse at any time with soak-report.mjs. No external account, send,
// purchase, publication or model call is involved.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const HOURS = Number(arg('--hours', '24')), DIR = resolve(arg('--dir', '')), PROJECT = resolve(arg('--project', '')), PORT = Number(arg('--port', '43190'));
if (!arg('--dir') || !arg('--project')) throw new Error('--dir and --project are required');
const ROOT = resolve(import.meta.dirname, '../..');
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const DATA = join(DIR, 'state'), WORKSPACE = join(DIR, 'workspace');
for (const d of [DIR, DATA, WORKSPACE, join(PROJECT, 'build')]) mkdirSync(d, { recursive: true });
const log = (file, row) => appendFileSync(join(DIR, file), JSON.stringify({ t: Date.now(), ...row }) + '\n');
const event = (kind, extra = {}) => { log('events.jsonl', { kind, ...extra }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = Date.now(), END = START + HOURS * HOUR;
event('soak_start', { hours: HOURS, commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), node: process.version, port: PORT });

// ── project files the workload reads and the monitors watch ────────────────────────────────────────────────────────
const write = (name, content) => writeFileSync(join(PROJECT, name), content);
write('STATUS.md', 'Soak project: synthetic status file read by scheduled checks.\n');
for (let i = 0; i < 4; i++) write(`build/status-${i}.json`, JSON.stringify({ status: 'PASS' }));
write('REPORT.md', 'Report v0\n');

// ── Host process ───────────────────────────────────────────────────────────────────────────────────────────────────
let host = null, token = null;
async function startHost(reason) {
  const t0 = Date.now();
  const child = spawn(process.execPath, ['--experimental-strip-types', join(ROOT, 'scripts/ma4-s2t3r/soak-host.mjs'), DATA, WORKSPACE, String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', d => appendFileSync(join(DIR, 'host.log'), d)); child.stderr.on('data', d => appendFileSync(join(DIR, 'host.log'), d));
  child.once('exit', (code, signal) => event('host_exit', { pid: child.pid, code, signal }));
  host = child;
  event('host_start', { pid: child.pid, reason });
  for (let i = 0; i < 600; i++) {
    try {
      const cred = JSON.parse(readFileSync(join(DATA, 'credentials.json'), 'utf8'));
      if (cred.pid === child.pid) {
        token = cred.token;
        const r = await fetch(`http://127.0.0.1:${PORT}/state`, { headers: { connection: 'close', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
        if (r.ok && (await r.json()).proactive) { event('host_ready', { pid: child.pid, recoveryMs: Date.now() - t0, reason }); return; }
      }
    } catch { /* starting */ }
    await sleep(200);
  }
  event('host_start_failed', { pid: child.pid });
}
async function stopHost(reason) {
  if (!host) return;
  const pid = host.pid, exited = new Promise(r => host.once('exit', r));
  event('host_stop_requested', { pid, reason });
  writeFileSync(join(DATA, 'stop-requested'), '1');
  await Promise.race([exited, sleep(60_000)]);
  if (host.exitCode === null) { event('host_stop_forced', { pid }); spawnSync('taskkill', ['/pid', String(pid), '/t', '/f']); await exited; }
  host = null; await orphans(pid);
}
async function crashHost() {
  if (!host) return;
  const pid = host.pid, exited = new Promise(r => host.once('exit', r));
  event('crash_injected', { pid });
  spawnSync('taskkill', ['/pid', String(pid), '/f']); // the Host only, not its tree: what survives is checked below
  await exited; host = null; await orphans(pid);
}
/** Processes still parented by a Host that is gone. */
async function orphans(pid) {
  await sleep(3_000);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`], { encoding: 'utf8' });
  const rows = r.stdout.trim() ? [].concat(JSON.parse(r.stdout.trim())) : [];
  event('orphan_check', { pid, orphans: rows });
}

async function api(action, data = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}/command`, { method: 'POST', headers: { connection: 'close', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(30_000) });
  const body = await r.json();
  if (r.status !== 200) throw new Error(`${action}: ${body.error}`);
  return body.data ?? body;
}
const state = async () => (await fetch(`http://127.0.0.1:${PORT}/state`, { headers: { connection: 'close', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })).json();

// ── workload ───────────────────────────────────────────────────────────────────────────────────────────────────────
const hhmm = t => new Date(t).toISOString().slice(11, 16);
const envelope = (expiresAt) => ({ capabilities: ['file.read', 'file.stat'], providers: ['ollama'], localOnly: true, models: [], projectScopes: ['soak'], sideEffects: false, background: true,
  budgets: { maxModelCalls: 0, maxWallMs: HOUR }, expiresAt, grants: { files: [{ root: 'soak', access: 'read' }] } });
const check = (title, expiresAt) => ({ type: 'task', spec: { title, projectId: 'soak', acceptance: { requiredSteps: ['read', 'stat'] },
  steps: [{ id: 'read', kind: 'file.read', input: { root: 'soak', path: 'STATUS.md' }, model: null }, { id: 'stat', kind: 'file.stat', input: { root: 'soak', path: 'build/status-0.json' }, model: null }] }, envelope: envelope(expiresAt) });
async function setup() {
  await api('connector.roots.set', { roots: [{ id: 'soak', label: 'Soak project', path: PROJECT }] });
  await api('ptask.policy', { policy: { background: true, resumeOnStart: false } });
  const expires = END + DAY;
  const schedules = [];
  // 48 daily schedules, one every 30 minutes from start + 20 min; alternate missed-run policies; one ends at 12 h.
  for (let k = 0; k < 48; k++) {
    const slot = START + 20 * MIN + k * 30 * MIN, policy = k % 2 ? 'run_once' : 'skip', ends = k === 5 ? START + 12 * HOUR : expires;
    const s = await api('schedule.create', { spec: { title: `Soak check ${String(k).padStart(2, '0')}`, projectId: 'soak', trigger: { type: 'daily', time: hhmm(slot), timeZone: 'UTC' }, action: check(`Soak check ${String(k).padStart(2, '0')}`, ends + DAY), missedPolicy: policy, graceMs: 15 * MIN, maxRunsPerDay: 2, expiresAt: ends } });
    await api('schedule.approve', { id: s.id, ttlMs: 30 * DAY });
    schedules.push({ id: s.id, k, time: hhmm(slot), policy, expiresAt: ends });
  }
  const monitors = [];
  for (let i = 0; i < 4; i++) {
    const m = await api('monitor.create', { spec: { title: `Build ${i}`, label: `Build ${i}`, projectId: 'soak', source: { kind: 'file', root: 'soak', path: `build/status-${i}.json`, field: 'status' }, predicate: { type: 'transition', from: 'PASS', to: 'FAIL' }, intervalMs: MIN, maxChecksPerHour: 60, dedupMs: 30 * MIN, expiresAt: expires } });
    await api('monitor.approve', { id: m.id, ttlMs: 30 * DAY }); monitors.push({ id: m.id, file: `status-${i}.json` });
  }
  const report = await api('monitor.create', { spec: { title: 'Report updated', label: 'Report', projectId: 'soak', source: { kind: 'file', root: 'soak', path: 'REPORT.md' }, predicate: { type: 'changed' }, intervalMs: MIN, maxChecksPerHour: 60, dedupMs: 0, expiresAt: expires } });
  await api('monitor.approve', { id: report.id, ttlMs: 30 * DAY }); monitors.push({ id: report.id, file: 'REPORT.md' });
  const conditions = [];
  for (const i of [0, 1]) {
    const c = await api('schedule.create', { spec: { title: `On failure ${i}`, projectId: 'soak', trigger: { type: 'condition', monitorId: monitors[i].id }, action: check(`Failure check ${i}`, expires + DAY), minGapMs: 20 * MIN, maxRunsPerDay: 48, expiresAt: expires } });
    await api('schedule.approve', { id: c.id, ttlMs: 30 * DAY }); conditions.push({ id: c.id, monitorId: monitors[i].id, minGapMs: 20 * MIN });
  }
  event('setup', { schedules, monitors, conditions });
}

// Fixed timeline (hours after start). Each entry runs once; anything due while the PC slept runs when it wakes.
const timeline = [
  [6, 'restart'], [9, 'offline'], [12, 'restart'], [15, 'crash'], [18, 'background_off'], [19.2, 'background_on'], [21, 'restart'],
].map(([h, kind]) => ({ at: START + h * HOUR, kind, done: false }));
let flips = 0, lastFlip = START, lastSame = START, lastReport = START, lastRemind = START - 2 * HOUR, lastCancel = START;
async function workloadTick(now) {
  if (now - lastFlip >= 13 * MIN) { lastFlip = now; flips++; for (const i of [0, 1]) write(`build/status-${i}.json`, JSON.stringify({ status: flips % 2 ? 'FAIL' : 'PASS' })); event('file_flip', { to: flips % 2 ? 'FAIL' : 'PASS' }); }
  if (now - lastSame >= 7 * MIN) { lastSame = now; write('build/status-2.json', JSON.stringify({ status: 'PASS' })); event('file_same'); }
  if (now - lastReport >= 47 * MIN) { lastReport = now; appendFileSync(join(PROJECT, 'REPORT.md'), `update ${new Date(now).toISOString()}\n`); event('file_report'); }
  if (!host) return;
  if (now - lastRemind >= 2 * HOUR) {
    lastRemind = now;
    const at = new Date(Math.ceil((now + 30 * MIN) / MIN) * MIN).toISOString().slice(0, 16);
    const s = await api('schedule.create', { spec: { title: `Soak reminder ${at}`, projectId: 'soak', trigger: { type: 'once', at, timeZone: 'UTC' }, action: { type: 'remind', text: 'Soak reminder.' }, expiresAt: now + DAY } });
    await api('schedule.approve', { id: s.id, ttlMs: DAY }); event('reminder_created', { id: s.id, at });
  }
  if (now - lastCancel >= 4 * HOUR) {
    lastCancel = now;
    const at = new Date(Math.ceil((now + 60 * MIN) / MIN) * MIN).toISOString().slice(0, 16);
    const s = await api('schedule.create', { spec: { title: `Soak cancelled ${at}`, projectId: 'soak', trigger: { type: 'once', at, timeZone: 'UTC' }, action: check('Cancelled check', now + 2 * DAY), expiresAt: now + DAY } });
    await api('schedule.approve', { id: s.id, ttlMs: DAY });
    const t = await api('ptask.create', { spec: { title: 'Soak cancelled task', projectId: 'soak', steps: [{ id: 'read', kind: 'file.read', input: { root: 'soak', path: 'STATUS.md' } }], acceptance: { requiredSteps: ['read'] } }, envelope: { ...envelope(now + DAY), background: false } });
    const cancelled = await api('ptask.cancel', { id: t.id }).catch(e => ({ error: String(e) }));
    await api('schedule.cancel', { id: s.id });
    event('cancellations', { scheduleId: s.id, scheduleAt: at, taskId: t.id, taskState: cancelled.state ?? cancelled.error ?? null });
  }
}
async function timelineTick(now) {
  for (const step of timeline) {
    if (step.done || step.at > now) continue;
    step.done = true;
    if (step.kind === 'restart') { await stopHost('scheduled restart'); await startHost('restart'); }
    else if (step.kind === 'offline') { await stopHost('offline window'); event('offline_begin'); await sleep(12 * MIN); event('offline_end'); await startHost('after offline window'); }
    else if (step.kind === 'crash') { await crashHost(); await startHost('after crash'); }
    else if (step.kind === 'background_off') { await api('ptask.policy', { policy: { background: false, resumeOnStart: false } }); event('background_policy', { background: false }); }
    else if (step.kind === 'background_on') { await api('ptask.policy', { policy: { background: true, resumeOnStart: false } }); event('background_policy', { background: true }); }
  }
}
async function sample() {
  if (!host) return;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$p=Get-Process -Id ${host.pid} -ErrorAction SilentlyContinue; if($p){@{cpuS=$p.CPU;ws=$p.WorkingSet64;priv=$p.PrivateMemorySize64;handles=$p.HandleCount;threads=$p.Threads.Count;children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${host.pid}").Count}|ConvertTo-Json -Compress}`], { encoding: 'utf8', timeout: 30_000 });
  let proc = null; try { proc = JSON.parse(r.stdout.trim()); } catch { /* gone */ }
  let s = null;
  try {
    const st = await state();
    s = { status: st.proactive?.status, notifications: st.proactive?.notifications?.length, tasks: st.persistentTasks?.tasks?.length, health: st.health?.operationalState ?? null };
  } catch (e) { s = { error: String(e).slice(0, 120) }; }
  log('samples.jsonl', { pid: host.pid, proc, state: s });
}

await startHost('soak start');
await setup();
let lastWall = Date.now(), lastMono = performance.now();
while (Date.now() < END) {
  const wall = Date.now(), mono = performance.now();
  // The PC slept or the driver was suspended: wall time moved but this process did not run. Recorded, never counted as work.
  if (wall - lastWall > 3 * MIN) event('driver_gap', { from: lastWall, to: wall, monoMs: Math.round(mono - lastMono) });
  lastWall = wall; lastMono = mono;
  try { await timelineTick(wall); await workloadTick(wall); await sample(); }
  catch (e) { event('driver_error', { error: String(e).slice(0, 300) }); }
  await sleep(MIN);
}
await stopHost('soak end');
event('soak_end');
