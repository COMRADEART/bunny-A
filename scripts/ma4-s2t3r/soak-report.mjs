// MA4-S2-T3R soak analysis against the pre-registered criteria (docs/ma4-s2t3r/REAL_CLOCK_SOAK.md). Read-only: the
// soak Host's SQLite file is opened read-only (WAL readers do not disturb the running Host). Safe to run mid-soak.
//   node scripts/ma4-s2t3r/soak-report.mjs --dir <soakDir> [--out summary.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const DIR = resolve(arg('--dir', '')), MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const lines = f => existsSync(join(DIR, f)) ? readFileSync(join(DIR, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const events = lines('events.jsonl'), samples = lines('samples.jsonl');
const start = events.find(e => e.kind === 'soak_start'), setup = events.find(e => e.kind === 'setup'), end = events.find(e => e.kind === 'soak_end');
if (!start || !setup) throw new Error('No soak_start/setup in events.jsonl yet.');
const now = end?.t ?? Date.now(), elapsedH = (now - start.t) / HOUR;
const db = new DatabaseSync(join(DIR, 'state', 'host.sqlite'), { readOnly: true });
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
const median = xs => pct(xs, 50);

// ── availability: Host up (ready → stop/crash), minus sleep gaps; background policy windows ──────────────────────────
const up = []; let open = null;
for (const e of events) {
  if (e.kind === 'host_ready') open = e.t;
  if (['host_stop_requested', 'crash_injected'].includes(e.kind) || (e.kind === 'host_exit' && open !== null)) { if (open !== null) up.push([open, e.t]); open = null; }
}
if (open !== null) up.push([open, now]);
const gaps = [...events.filter(e => e.kind === 'driver_gap').map(e => [e.from, e.to]),
  ...db.prepare("SELECT from_at AS f, to_at AS t FROM ma4_host_gaps WHERE kind='asleep'").all().map(r => [r.f, r.t])];
const bgOff = []; let off = null;
for (const e of events.filter(e => e.kind === 'background_policy')) { if (!e.background) off = e.t; else if (off !== null) { bgOff.push([off, e.t]); off = null; } }
if (off !== null) bgOff.push([off, now]);
const inside = (t, spans) => spans.some(([a, b]) => t >= a && t <= b);
const available = t => inside(t, up) && !inside(t, gaps) && !inside(t, bgOff);
const unavailableMs = (() => { const total = now - start.t, upMs = up.reduce((n, [a, b]) => n + (b - a), 0); return { hostDownMs: Math.max(0, total - upMs), asleepMs: gaps.reduce((n, [a, b]) => n + (b - a), 0) }; })();

// ── daily schedules: every expected slot classified ─────────────────────────────────────────────────────────────────
const occ = new Map(db.prepare('SELECT key,schedule_id,slot,outcome,reason,task_id,at,dispatched,settled FROM ma4_occurrences').all().map(r => [r.key, r]));
const taskState = new Map(db.prepare('SELECT id,state FROM ma4_tasks').all().map(r => [r.id, r.state]));
const setupAt = setup.t, result = { executed: 0, late: [], missedWhileAvailable: [], unavailableSlots: 0, catchUpRuns: 0, backgroundSkipped: 0, expiredRespected: true, failedTasks: [] };
for (const s of setup.schedules) {
  const [h, m] = s.time.split(':').map(Number);
  for (let day = Date.UTC(new Date(start.t).getUTCFullYear(), new Date(start.t).getUTCMonth(), new Date(start.t).getUTCDate()); day < now; day += DAY) {
    const slot = day + h * HOUR + m * MIN;
    if (slot <= setupAt || slot > now - 20 * MIN) continue; // not yet settled
    if (slot > s.expiresAt) { if (occ.get(`${s.id}:${slot}`)?.task_id) result.expiredRespected = false; continue; }
    const o = occ.get(`${s.id}:${slot}`);
    if (available(slot) && available(slot + 2 * MIN)) {
      if (o && ['execute', 'queue'].includes(o.outcome)) {
        result.executed++; result.late.push(o.at - slot);
        if (taskState.get(o.task_id) !== 'COMPLETED') result.failedTasks.push({ key: o.key, state: taskState.get(o.task_id) ?? 'missing' });
      } else result.missedWhileAvailable.push({ schedule: s.k, slot: new Date(slot).toISOString(), outcome: o?.outcome ?? 'none', reason: o?.reason ?? null });
    } else {
      result.unavailableSlots++;
      if (o && ['execute', 'queue'].includes(o.outcome) && o.at - slot > 15 * MIN) result.catchUpRuns++;
      if (inside(slot, bgOff) && o && /background/.test(o.reason)) result.backgroundSkipped++;
    }
  }
}
// run_once may run only the latest slot of a gap, and skip must never run late at all.
const lateRunsBySchedule = new Map();
for (const o of occ.values()) if (['execute', 'queue'].includes(o.outcome) && o.at - o.slot > 15 * MIN && setup.schedules.some(s => s.id === o.schedule_id)) lateRunsBySchedule.set(o.schedule_id, (lateRunsBySchedule.get(o.schedule_id) ?? 0) + 1);
const skipRanLate = setup.schedules.filter(s => s.policy === 'skip' && lateRunsBySchedule.get(s.id)).map(s => s.k);

// ── duplicates: one dispatch per task step, one task per slot, condition gaps ───────────────────────────────────────
const dispatches = db.prepare("SELECT task_id,step_id,COUNT(*) n FROM ma4_action_receipts WHERE event='dispatched' GROUP BY task_id,step_id HAVING n>1").all();
const conditionGapViolations = [];
for (const c of setup.conditions) {
  const runs = [...occ.values()].filter(o => o.schedule_id === c.id && ['execute', 'queue'].includes(o.outcome)).map(o => o.at).sort((a, b) => a - b);
  for (let i = 1; i < runs.length; i++) if (runs[i] - runs[i - 1] < c.minGapMs) conditionGapViolations.push({ id: c.id, gapMs: runs[i] - runs[i - 1] });
}
const conditionRuns = [...occ.values()].filter(o => setup.conditions.some(c => c.id === o.schedule_id) && ['execute', 'queue'].includes(o.outcome)).length;
// Notifications: keys are unique by construction; a semantic duplicate is the same category, source and reason twice within a minute.
const notes = db.prepare('SELECT key,category,source_id,reason,at FROM ma4_proactive_notifications ORDER BY at').all();
const semanticDupes = notes.filter((n, i) => notes.some((m, j) => j < i && m.category === n.category && m.source_id === n.source_id && m.reason === n.reason && n.at - m.at < MIN));
const sourceChanged = notes.filter(n => n.category === 'source_changed').length;
// Cancelled schedules never ran; cancelled tasks never dispatched.
const cancels = events.filter(e => e.kind === 'cancellations');
const cancelledRan = cancels.filter(c => [...occ.values()].some(o => o.schedule_id === c.scheduleId && o.task_id) || db.prepare("SELECT COUNT(*) n FROM ma4_action_receipts WHERE task_id=? AND event='dispatched'").get(c.taskId).n > 0);
// Errors recorded by the Host itself.
const errorTypes = ['proactive.error', 'ptask.worker_error', 'ptask.scheduler_error', 'ptask.stale_worker_rejected', 'ptask.storage_refused'];
const hostErrors = db.prepare(`SELECT type,COUNT(*) n FROM events WHERE type IN (${errorTypes.map(() => '?').join(',')}) AND at>=? GROUP BY type`).all(...errorTypes, start.t);
// Permission: every file the workload's steps read sits in the granted root (receipts carry no absolute path outside it).
const outsideRoot = db.prepare("SELECT COUNT(*) n FROM ma4_action_receipts WHERE event='refused'").get().n;

// ── process metrics ─────────────────────────────────────────────────────────────────────────────────────────────────
const byPid = new Map();
for (const s of samples) if (s.proc) (byPid.get(s.pid) ?? byPid.set(s.pid, []).get(s.pid)).push(s);
const cpuPct = [];
for (const rows of byPid.values()) for (let i = 1; i < rows.length; i++) { const dt = rows[i].t - rows[i - 1].t; if (dt > 30_000 && dt < 5 * MIN) cpuPct.push((rows[i].proc.cpuS - rows[i - 1].proc.cpuS) * 1000 / dt * 100); }
// Memory growth within each Host life (a restart resets the process), as MB per 24 h from a least-squares slope after its first hour.
const slopes = [];
for (const rows of byPid.values()) {
  const r = rows.filter(x => x.t - rows[0].t > HOUR);
  if (r.length < 60) continue;
  const xs = r.map(x => (x.t - r[0].t) / DAY), ys = r.map(x => x.proc.priv / 2 ** 20), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  slopes.push({ pid: rows[0].pid, hours: +((r.at(-1).t - r[0].t) / HOUR).toFixed(1), mbPerDay: +(xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / xs.reduce((n, x) => n + (x - mx) ** 2, 0)).toFixed(1), privMBStart: +ys[0].toFixed(1), privMBEnd: +ys.at(-1).toFixed(1) });
}
const handleGrowth = [...byPid.values()].filter(r => r.length > 120).map(r => ({ pid: r[0].pid, secondHour: median(r.slice(60, 120).map(x => x.proc.handles)), lastHour: median(r.slice(-60).map(x => x.proc.handles)) }));
const recoveries = events.filter(e => e.kind === 'host_ready' && e.reason !== 'soak start').map(e => ({ reason: e.reason, ms: e.recoveryMs }));
const orphans = events.filter(e => e.kind === 'orphan_check' && e.orphans.length);

const lat = result.late;
const metrics = {
  window: { start: new Date(start.t).toISOString(), now: new Date(now).toISOString(), elapsedHours: +elapsedH.toFixed(2), finished: !!end, commit: start.commit },
  availability: { hostUpIntervals: up.length, hostDownMinutes: Math.round(unavailableMs.hostDownMs / MIN), asleepMinutes: Math.round(unavailableMs.asleepMs / MIN), backgroundOffMinutes: Math.round(bgOff.reduce((n, [a, b]) => n + (b - a), 0) / MIN) },
  occurrences: { totalRows: occ.size, dailyExecuted: result.executed, conditionRuns, unavailableSlots: result.unavailableSlots, catchUpRuns: result.catchUpRuns, backgroundSkipped: result.backgroundSkipped, reminders: notes.filter(n => n.category === 'reminder_due').length, sourceChanged },
  latencyMs: { n: lat.length, p50: pct(lat, 50), p95: pct(lat, 95), max: lat.length ? Math.max(...lat) : null },
  violations: {
    missedWhileAvailable: result.missedWhileAvailable, failedTasks: result.failedTasks, duplicateDispatches: dispatches, skipPolicyRanLate: skipRanLate, expiredScheduleRan: !result.expiredRespected,
    conditionGapViolations, semanticDuplicateNotifications: semanticDupes.length, cancelledWorkRan: cancelledRan.length, refusedOrOutOfScope: outsideRoot, orphans: orphans.length, hostErrors, driverErrors: events.filter(e => e.kind === 'driver_error').map(e => e.error).slice(0, 10),
  },
  resources: { cpuPctOneCore: { median: median(cpuPct) === null ? null : +median(cpuPct).toFixed(3), p95: pct(cpuPct, 95) === null ? null : +pct(cpuPct, 95).toFixed(3) }, memoryMBPerDay: slopes, handles: handleGrowth, maxChildren: Math.max(0, ...samples.filter(s => s.proc).map(s => s.proc.children)) },
  recoveries,
};
// Pre-registered criteria (REAL_CLOCK_SOAK.md §2). A criterion is only judged once the soak has run its full duration.
const v = metrics.violations;
const criteria = {
  S1_noDuplicateExecutions: !v.duplicateDispatches.length && !v.conditionGapViolations.length,
  S2_noMissedWhileAvailable: !v.missedWhileAvailable.length && !v.failedTasks.length,
  S3_unavailableNeverClaimed: !v.skipPolicyRanLate.length && !v.expiredScheduleRan,
  S4_latency: lat.length > 0 && pct(lat, 95) <= 5_000 && Math.max(...lat) <= 120_000,
  S5_memory: slopes.every(s => s.mbPerDay <= 50),
  S6_idleCpu: metrics.resources.cpuPctOneCore.median !== null && metrics.resources.cpuPctOneCore.median <= 2,
  S7_handles: handleGrowth.every(h => h.lastHour - h.secondHour <= 200),
  S8_notifications: v.semanticDuplicateNotifications === 0,
  S9_permissions: v.cancelledWorkRan === 0 && v.refusedOrOutOfScope === 0,
  S10_recovery: recoveries.length > 0 && recoveries.every(r => r.ms <= 10_000),
  S11_orphans: v.orphans === 0,
  S12_errors: !v.hostErrors.length && !v.driverErrors.length,
};
const fullDuration = metrics.window.finished && elapsedH >= 24;
const summary = { status: !fullDuration ? 'IN PROGRESS' : Object.values(criteria).every(Boolean) ? 'PASS' : 'FAIL', criteria, metrics };
const out = arg('--out', null);
if (out) writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
