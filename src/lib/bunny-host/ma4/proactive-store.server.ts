import type { HostDatabase } from "../persistence.server.ts";
import {
  deliverAt, GOAL_STATES, goalCanTransition, GoalSpecSchema, MONITOR_STATES, MonitorSpecSchema, PrefsSchema, PROACTIVE_SCHEMA_VERSION, ProactivePolicySchema,
  sanitize, SCHEDULE_STATES, ScheduleSpecSchema, specHash, TERMINAL_GOAL_STATES,
  type Approval, type ChangeClass, type GoalLink, type GoalMet, type GoalSpec, type GoalState, type MonitorSpec, type MonitorState, type NotificationCategory,
  type NotificationPrefs, type Outcome, type ProactivePolicy, type ScheduleSpec, type ScheduleState,
} from "./proactive.ts";
import { sha256 } from "./task-runtime.ts";

/**
 * MA4-S2-T3 durable proactive state: additive tables on the Host's own SQLite file, next to the S2-T1 task tables.
 * Goals, schedules and monitors are hash-checked records (a tampered or unreadable row is shown as such and never acts).
 * Occurrences are keyed by schedule and slot: the PRIMARY KEY is the duplicate guard, so a restarted Host, a second
 * Host on the same file, or a clock moving backwards can never fire one slot twice. Notifications are keyed by their
 * event identity, so re-deriving an event after a crash inserts nothing.
 */
export const PROACTIVE_MIGRATION = "ma4.proactive.v1";
const MAX_OBSERVATIONS_PER_MONITOR = 200;
const MAX_TRANSITIONS_PER_RECORD = 200;
const RETAIN_MS = 30 * 24 * 3_600_000;

export class ProactiveConflictError extends Error { readonly code = "PROACTIVE_CONFLICT"; }
export class ProactiveCorruptError extends Error { readonly code = "PROACTIVE_RECORD_CORRUPT"; }

export type Kind = "goal" | "schedule" | "monitor";
export type GoalRecord = {
  schema: "ma4.goal.v1"; id: string; projectId: string; spec: GoalSpec; specSha256: string; state: GoalState;
  origin: "owner" | "suggested"; approval: Approval | null; links: GoalLink[]; met: GoalMet[]; attention: string | null;
  createdAt: number; updatedAt: number;
};
export type ScheduleRecord = {
  schema: "ma4.schedule.v1"; id: string; projectId: string; spec: ScheduleSpec; specSha256: string; state: ScheduleState;
  approval: Approval | null;
  /** Every slot up to and including this instant has been decided (fired, missed or skipped). */
  cursor: number;
  nextAt: number | null;
  /** A transient deferral: try the pending slot again at this time, until its grace runs out. */
  retryAt: number | null;
  lastAttempt: { at: number; slot: number; outcome: Outcome | "missed"; reason: string; taskId: string | null } | null;
  lastFiredAt: number | null;
  createdAt: number; updatedAt: number;
};
export type MonitorRecord = {
  schema: "ma4.monitor.v1"; id: string; projectId: string; spec: MonitorSpec; specSha256: string; state: MonitorState;
  approval: Approval | null;
  baseline: { value: string; sha256: string; at: number } | null;
  last: { value: string; sha256: string; at: number } | null;
  lastClass: ChangeClass | null; lastCheckAt: number | null; nextCheckAt: number; errors: number;
  lastNotifiedAt: number | null; changeSeq: number;
  createdAt: number; updatedAt: number;
};
type RecordOf<K extends Kind> = K extends "goal" ? GoalRecord : K extends "schedule" ? ScheduleRecord : MonitorRecord;
const SPECS = { goal: GoalSpecSchema, schedule: ScheduleSpecSchema, monitor: MonitorSpecSchema } as const;
const STATES: Record<Kind, readonly string[]> = { goal: GOAL_STATES, schedule: SCHEDULE_STATES, monitor: MONITOR_STATES };

export type Occurrence = { key: string; scheduleId: string; slot: number; outcome: Outcome | "missed"; reason: string; taskId: string | null; modelSteps: number; at: number; dispatched: boolean; settled: boolean };
export type ProactiveNotification = {
  key: string; category: NotificationCategory; sourceKind: Kind | "task"; sourceId: string; priority: "low" | "normal" | "high";
  title: string; reason: string; verifiedState: string; action: string; at: number; deliverAt: number;
  delivered: boolean; dismissed: boolean; snoozedUntil: number | null; suppressed: boolean;
};
export type NewNotification = Pick<ProactiveNotification, "key" | "category" | "sourceKind" | "sourceId" | "title" | "reason" | "verifiedState" | "action"> & { priority?: ProactiveNotification["priority"] };
export type Change<K extends Kind> = {
  actor: string; reason: string; now: number; expectVersion?: number; from?: readonly string[]; to?: string;
  mutate?: (record: RecordOf<K>) => void;
  occurrence?: Omit<Occurrence, "at" | "dispatched" | "settled"> & { dispatched?: boolean };
  notify?: NewNotification[];
};
type Row = { kind: string; id: string; state: string; version: number; record: string; record_sha256: string };

export function verifyProactive<K extends Kind>(kind: K, row: Pick<Row, "id" | "state" | "record" | "record_sha256">): RecordOf<K> {
  const fail = (why: string): never => { throw new ProactiveCorruptError(`Stored ${kind} ${row.id} failed its integrity check (${why}); it will not act until it is reviewed.`); };
  if (sha256(row.record) !== row.record_sha256) fail("record hash mismatch");
  let record: RecordOf<K>;
  try { record = JSON.parse(row.record); } catch { return fail("unparseable record"); }
  if (!record || record.schema !== `ma4.${kind}.v1` || record.id !== row.id || record.state !== row.state || !STATES[kind].includes(record.state)) fail("identity or state");
  if (!SPECS[kind].safeParse(record.spec).success) fail("specification shape");
  if (specHash(record.spec) !== record.specSha256) fail("specification hash");
  return record;
}

export class ProactiveStore {
  readonly host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ma4_proactive(kind TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,record TEXT NOT NULL,record_sha256 TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS ma4_proactive_transitions(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,from_state TEXT,to_state TEXT NOT NULL,version INTEGER NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ma4_proactive_transitions_id ON ma4_proactive_transitions(kind,id,seq);
      CREATE TABLE IF NOT EXISTS ma4_occurrences(key TEXT PRIMARY KEY,schedule_id TEXT NOT NULL,slot INTEGER NOT NULL,outcome TEXT NOT NULL,reason TEXT NOT NULL,task_id TEXT,model_steps INTEGER NOT NULL DEFAULT 0,at INTEGER NOT NULL,dispatched INTEGER NOT NULL DEFAULT 0,settled INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ma4_occurrences_schedule ON ma4_occurrences(schedule_id,at);
      CREATE INDEX IF NOT EXISTS ma4_occurrences_open ON ma4_occurrences(settled,at);
      CREATE TABLE IF NOT EXISTS ma4_observations(seq INTEGER PRIMARY KEY AUTOINCREMENT,monitor_id TEXT NOT NULL,at INTEGER NOT NULL,class TEXT NOT NULL,value_sha256 TEXT,value TEXT);
      CREATE INDEX IF NOT EXISTS ma4_observations_monitor ON ma4_observations(monitor_id,seq);
      CREATE TABLE IF NOT EXISTS ma4_proactive_notifications(key TEXT PRIMARY KEY,category TEXT NOT NULL,source_kind TEXT NOT NULL,source_id TEXT NOT NULL,priority TEXT NOT NULL,title TEXT NOT NULL,reason TEXT NOT NULL,verified_state TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL,deliver_at INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,dismissed INTEGER NOT NULL DEFAULT 0,snoozed_until INTEGER,suppressed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ma4_proactive_notifications_at ON ma4_proactive_notifications(at);
      CREATE TABLE IF NOT EXISTS ma4_host_gaps(seq INTEGER PRIMARY KEY AUTOINCREMENT,from_at INTEGER NOT NULL,to_at INTEGER NOT NULL,kind TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations(key) VALUES('${PROACTIVE_MIGRATION}');`);
    const row = host.db.prepare("SELECT value FROM settings WHERE key='ma4_proactive_schema'").get() as { value: string } | undefined;
    const stored = Number(row?.value ?? PROACTIVE_SCHEMA_VERSION);
    if (!Number.isInteger(stored) || stored > PROACTIVE_SCHEMA_VERSION) throw new Error(`Proactive schema ${row?.value} is newer than this Host (${PROACTIVE_SCHEMA_VERSION}); refusing to open it.`);
    if (!row) host.db.prepare("INSERT INTO settings(key,value) VALUES('ma4_proactive_schema',?)").run(String(PROACTIVE_SCHEMA_VERSION));
  }
  get db() { return this.host.db; }
  private tx<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch (rollback) { throw new AggregateError([error, rollback], "Proactive store transaction and rollback failed."); } throw error; }
  }
  private row(kind: Kind, id: string) { return this.db.prepare("SELECT kind,id,state,version,record,record_sha256 FROM ma4_proactive WHERE kind=? AND id=?").get(kind, id) as Row | undefined; }

  insert<K extends Kind>(kind: K, record: RecordOf<K>, actor: string, now: number, notify: NewNotification[] = []): { record: RecordOf<K>; version: number } {
    return this.tx(() => {
      if (this.row(kind, record.id)) throw new ProactiveConflictError(`A ${kind} with this id already exists.`);
      const json = JSON.stringify(record);
      this.db.prepare("INSERT INTO ma4_proactive(kind,id,project_id,state,version,created_at,updated_at,record,record_sha256) VALUES(?,?,?,?,1,?,?,?,?)").run(kind, record.id, record.projectId, record.state, now, now, json, sha256(json));
      this.db.prepare("INSERT INTO ma4_proactive_transitions(kind,id,from_state,to_state,version,actor,reason,at) VALUES(?,?,NULL,?,1,?,?,?)").run(kind, record.id, record.state, actor.slice(0, 80), "created", now);
      for (const n of notify) this.notifyRow(n, now);
      return { record, version: 1 };
    });
  }
  get<K extends Kind>(kind: K, id: string): { record: RecordOf<K>; version: number } {
    const row = this.row(kind, id);
    if (!row) throw new ProactiveConflictError(`That ${kind} does not exist.`);
    return { record: verifyProactive(kind, row), version: row.version };
  }
  list<K extends Kind>(kind: K, states?: readonly string[]): ({ ok: true; record: RecordOf<K>; version: number } | { ok: false; id: string; error: string })[] {
    const rows = (states
      ? this.db.prepare(`SELECT kind,id,state,version,record,record_sha256 FROM ma4_proactive WHERE kind=? AND state IN (${states.map(() => "?").join(",")}) ORDER BY created_at,id`).all(kind, ...states)
      : this.db.prepare("SELECT kind,id,state,version,record,record_sha256 FROM ma4_proactive WHERE kind=? ORDER BY created_at,id").all(kind)) as Row[];
    return rows.map(row => {
      try { return { ok: true as const, record: verifyProactive(kind, row), version: row.version }; }
      catch (error) { return { ok: false as const, id: row.id, error: (error as Error).message }; }
    });
  }

  /** One transaction: version check, transition check, record, transition log, occurrence and notifications together. */
  update<K extends Kind>(kind: K, id: string, change: Change<K>): { record: RecordOf<K>; version: number; inserted: string[] } {
    return this.tx(() => {
      const row = this.row(kind, id);
      if (!row) throw new ProactiveConflictError(`That ${kind} does not exist.`);
      const record = verifyProactive(kind, row);
      if (change.expectVersion !== undefined && change.expectVersion !== row.version) throw new ProactiveConflictError(`The ${kind} changed since this view (version ${row.version}, not ${change.expectVersion}).`);
      if (change.from && !change.from.includes(record.state)) throw new ProactiveConflictError(`The ${kind} is ${record.state}; this needs ${change.from.join(" or ")}.`);
      const from = record.state;
      change.mutate?.(record);
      (record as { state: string }).state = from;
      if (change.to && change.to !== from) {
        if (kind === "goal" ? !goalCanTransition(from as GoalState, change.to as GoalState) : ["COMPLETED", "CANCELLED", "EXPIRED", "FAILED", "DISABLED"].includes(from))
          throw new ProactiveConflictError(`Invalid ${kind} transition ${from} → ${change.to}.`);
        (record as { state: string }).state = change.to;
      }
      record.updatedAt = change.now;
      // A changed specification is a different authorization: its hash is recomputed and any approval of the old one lapses.
      record.specSha256 = specHash(record.spec);
      const version = row.version + 1, json = JSON.stringify(record);
      this.db.prepare("UPDATE ma4_proactive SET state=?,version=?,updated_at=?,record=?,record_sha256=? WHERE kind=? AND id=?").run(record.state, version, change.now, json, sha256(json), kind, id);
      this.db.prepare("INSERT INTO ma4_proactive_transitions(kind,id,from_state,to_state,version,actor,reason,at) VALUES(?,?,?,?,?,?,?,?)").run(kind, id, from, record.state, version, change.actor.slice(0, 80), change.reason.slice(0, 240), change.now);
      this.db.prepare("DELETE FROM ma4_proactive_transitions WHERE kind=? AND id=? AND seq NOT IN (SELECT seq FROM ma4_proactive_transitions WHERE kind=? AND id=? ORDER BY seq DESC LIMIT ?)").run(kind, id, kind, id, MAX_TRANSITIONS_PER_RECORD);
      if (change.occurrence) {
        const o = change.occurrence;
        // The duplicate guard: one row per schedule slot, ever. A second claim rolls the whole change back.
        const inserted = this.db.prepare("INSERT OR IGNORE INTO ma4_occurrences(key,schedule_id,slot,outcome,reason,task_id,model_steps,at,dispatched,settled) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(o.key, o.scheduleId, o.slot, o.outcome, sanitize(o.reason, 240), o.taskId, o.modelSteps, change.now, o.dispatched ? 1 : 0, o.taskId ? 0 : 1);
        if (inserted.changes !== 1) throw new ProactiveConflictError(`Occurrence ${o.key} was already decided; it is not run again.`);
      }
      const insertedKeys = (change.notify ?? []).flatMap(n => this.notifyRow(n, change.now) ? [n.key] : []);
      return { record, version, inserted: insertedKeys };
    });
  }
  transitions(kind: Kind, id: string) {
    return this.db.prepare("SELECT from_state AS 'from',to_state AS 'to',version,actor,reason,at FROM ma4_proactive_transitions WHERE kind=? AND id=? ORDER BY seq").all(kind, id) as { from: string | null; to: string; version: number; actor: string; reason: string; at: number }[];
  }

  // ── occurrences ───────────────────────────────────────────────────────────────────────────────────────────────────
  occurrence(key: string): Occurrence | null { const r = this.db.prepare("SELECT * FROM ma4_occurrences WHERE key=?").get(key) as OccRow | undefined; return r ? occ(r) : null; }
  occurrences(scheduleId: string, limit = 20): Occurrence[] { return (this.db.prepare("SELECT * FROM ma4_occurrences WHERE schedule_id=? ORDER BY at DESC,key LIMIT ?").all(scheduleId, limit) as OccRow[]).map(occ); }
  openOccurrences(): Occurrence[] { return (this.db.prepare("SELECT * FROM ma4_occurrences WHERE settled=0 ORDER BY at,key").all() as OccRow[]).map(occ); }
  occurrencesSince(since: number): Occurrence[] { return (this.db.prepare("SELECT * FROM ma4_occurrences WHERE at>=? ORDER BY at,key").all(since) as OccRow[]).map(occ); }
  /** Runs that actually created work or a reminder, in a rolling window. */
  runsSince(scheduleId: string, since: number): number {
    return (this.db.prepare("SELECT COUNT(*) n FROM ma4_occurrences WHERE schedule_id=? AND at>? AND outcome IN ('execute','queue','notify')").get(scheduleId, since) as { n: number }).n;
  }
  /** Model calls reserved by proactive occurrences in a rolling window (reserved at dispatch, before any call). */
  modelStepsSince(since: number): number { return (this.db.prepare("SELECT COALESCE(SUM(model_steps),0) n FROM ma4_occurrences WHERE at>?").get(since) as { n: number }).n; }
  markDispatched(key: string) { this.db.prepare("UPDATE ma4_occurrences SET dispatched=1 WHERE key=?").run(key); }
  settle(key: string, notify: NewNotification[], now: number): string[] {
    return this.tx(() => {
      const changed = this.db.prepare("UPDATE ma4_occurrences SET settled=1 WHERE key=? AND settled=0").run(key).changes === 1;
      return changed ? notify.flatMap(n => this.notifyRow(n, now) ? [n.key] : []) : [];
    });
  }
  /** Missed or abandoned dispatches: recorded so the slot is never claimed again. */
  recordOutcome(key: string, outcome: Outcome | "missed", reason: string) { this.db.prepare("UPDATE ma4_occurrences SET outcome=?,reason=?,settled=1 WHERE key=?").run(outcome, sanitize(reason, 240), key); }

  // ── observations ──────────────────────────────────────────────────────────────────────────────────────────────────
  observe(monitorId: string, at: number, cls: ChangeClass, value: { value: string; sha256: string } | null): number {
    const r = this.db.prepare("INSERT INTO ma4_observations(monitor_id,at,class,value_sha256,value) VALUES(?,?,?,?,?)").run(monitorId, at, cls, value?.sha256 ?? null, value?.value ?? null);
    this.db.prepare("DELETE FROM ma4_observations WHERE monitor_id=? AND seq NOT IN (SELECT seq FROM ma4_observations WHERE monitor_id=? ORDER BY seq DESC LIMIT ?)").run(monitorId, monitorId, MAX_OBSERVATIONS_PER_MONITOR);
    return Number(r.lastInsertRowid);
  }
  checksSince(monitorId: string, since: number): number { return (this.db.prepare("SELECT COUNT(*) n FROM ma4_observations WHERE monitor_id=? AND at>=?").get(monitorId, since) as { n: number }).n; }
  observations(monitorId: string, limit = 20) { return this.db.prepare("SELECT seq,at,class,value_sha256 AS sha256 FROM ma4_observations WHERE monitor_id=? ORDER BY seq DESC LIMIT ?").all(monitorId, limit) as { seq: number; at: number; class: ChangeClass; sha256: string | null }[]; }
  observationsSince(since: number) { return this.db.prepare("SELECT monitor_id AS monitorId,class,COUNT(*) n FROM ma4_observations WHERE at>=? GROUP BY monitor_id,class").all(since) as { monitorId: string; class: ChangeClass; n: number }[]; }

  // ── notifications ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Inside a transaction. The key is the event's identity: a recovered Host deriving the same event inserts nothing. */
  private notifyRow(n: NewNotification, now: number): boolean {
    const prefs = this.prefs();
    const suppressed = prefs.categories[n.category] === false;
    return this.db.prepare("INSERT OR IGNORE INTO ma4_proactive_notifications(key,category,source_kind,source_id,priority,title,reason,verified_state,action,at,deliver_at,delivered,dismissed,snoozed_until,suppressed) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,0,NULL,?)")
      .run(n.key.slice(0, 200), n.category, n.sourceKind, n.sourceId, n.priority ?? "normal", sanitize(n.title, 120), sanitize(n.reason, 200), n.verifiedState.slice(0, 40), n.action.slice(0, 40), now, deliverAt(prefs, now), suppressed ? 1 : 0).changes === 1;
  }
  notify(list: NewNotification[], now: number): string[] { return this.tx(() => list.flatMap(n => this.notifyRow(n, now) ? [n.key] : [])); }
  /** Newly deliverable: not suppressed, past quiet hours and snooze. Marked delivered in the same statement's transaction. */
  deliverDue(now: number): ProactiveNotification[] {
    return this.tx(() => {
      const due = (this.db.prepare("SELECT * FROM ma4_proactive_notifications WHERE delivered=0 AND dismissed=0 AND suppressed=0 AND deliver_at<=? AND COALESCE(snoozed_until,0)<=? ORDER BY at,key").all(now, now) as NoteRow[]).map(note);
      for (const n of due) this.db.prepare("UPDATE ma4_proactive_notifications SET delivered=1 WHERE key=?").run(n.key);
      return due.map(n => ({ ...n, delivered: true }));
    });
  }
  notifications(limit = 50): ProactiveNotification[] { return (this.db.prepare("SELECT * FROM ma4_proactive_notifications ORDER BY at DESC,key LIMIT ?").all(limit) as NoteRow[]).map(note); }
  notification(key: string): ProactiveNotification | null { const r = this.db.prepare("SELECT * FROM ma4_proactive_notifications WHERE key=?").get(key) as NoteRow | undefined; return r ? note(r) : null; }
  nextDelivery(now: number): number | null {
    const r = this.db.prepare("SELECT MIN(MAX(deliver_at,COALESCE(snoozed_until,0))) t FROM ma4_proactive_notifications WHERE delivered=0 AND dismissed=0 AND suppressed=0").get() as { t: number | null };
    return r.t === null ? null : Math.max(r.t, now);
  }
  /** A request that has been answered is no longer news: its approval notices are dismissed. */
  dismissApprovals(sourceId: string): number { return this.db.prepare("UPDATE ma4_proactive_notifications SET dismissed=1 WHERE source_id=? AND category='approval_required' AND dismissed=0").run(sourceId).changes as number; }
  dismiss(key: string): boolean { return this.db.prepare("UPDATE ma4_proactive_notifications SET dismissed=1 WHERE key=? AND dismissed=0").run(key).changes === 1; }
  /** A snoozed notification is shown again (re-delivered) when the snooze ends. */
  snooze(key: string, until: number): boolean { return this.db.prepare("UPDATE ma4_proactive_notifications SET snoozed_until=?,delivered=0 WHERE key=? AND dismissed=0").run(until, key).changes === 1; }

  // ── settings ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private setting(key: string): unknown { const r = this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined; return r ? JSON.parse(r.value) : undefined; }
  private put(key: string, value: unknown) { this.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); }
  // Unreadable settings fail closed to the defaults.
  prefs(): NotificationPrefs { try { return PrefsSchema.parse(this.setting("ma4_proactive_prefs_v1") ?? {}); } catch { return PrefsSchema.parse({}); } }
  setPrefs(raw: unknown): NotificationPrefs { const p = PrefsSchema.parse(raw); this.put("ma4_proactive_prefs_v1", p); return p; }
  policy(): ProactivePolicy { try { return ProactivePolicySchema.parse(this.setting("ma4_proactive_policy_v1") ?? {}); } catch { return ProactivePolicySchema.parse({}); } }
  setPolicy(raw: unknown): ProactivePolicy { const p = ProactivePolicySchema.parse(raw); this.put("ma4_proactive_policy_v1", p); return p; }
  heartbeat(): number | null { const v = this.setting("ma4_proactive_heartbeat"); return typeof v === "number" ? v : null; }
  beat(now: number) { this.put("ma4_proactive_heartbeat", now); }
  awayMarker(): number | null { const v = this.setting("ma4_proactive_away_marker"); return typeof v === "number" ? v : null; }
  setAwayMarker(now: number) { this.put("ma4_proactive_away_marker", now); }
  gap(from: number, to: number, kind: "off" | "asleep") { this.db.prepare("INSERT INTO ma4_host_gaps(from_at,to_at,kind) VALUES(?,?,?)").run(from, to, kind); }
  gapsSince(since: number) { return this.db.prepare("SELECT from_at AS 'from',to_at AS 'to',kind FROM ma4_host_gaps WHERE to_at>=? ORDER BY seq").all(since) as { from: number; to: number; kind: "off" | "asleep" }[]; }

  /** Bounded history: terminal records, settled occurrences and old notifications past the retention window. */
  prune(now: number) {
    const before = now - RETAIN_MS;
    this.tx(() => {
      this.db.prepare("DELETE FROM ma4_occurrences WHERE settled=1 AND at<?").run(before);
      this.db.prepare("DELETE FROM ma4_proactive_notifications WHERE at<?").run(before);
      this.db.prepare("DELETE FROM ma4_host_gaps WHERE to_at<?").run(before);
      for (const r of this.db.prepare(`SELECT kind,id FROM ma4_proactive WHERE updated_at<? AND state IN ('COMPLETED','CANCELLED','EXPIRED','FAILED','DISABLED')`).all(before) as { kind: string; id: string }[]) {
        this.db.prepare("DELETE FROM ma4_proactive WHERE kind=? AND id=?").run(r.kind, r.id);
        this.db.prepare("DELETE FROM ma4_proactive_transitions WHERE kind=? AND id=?").run(r.kind, r.id);
      }
    });
  }
}
export const isTerminalGoal = (s: GoalState) => TERMINAL_GOAL_STATES.includes(s);

type OccRow = { key: string; schedule_id: string; slot: number; outcome: string; reason: string; task_id: string | null; model_steps: number; at: number; dispatched: number; settled: number };
const occ = (r: OccRow): Occurrence => ({ key: r.key, scheduleId: r.schedule_id, slot: r.slot, outcome: r.outcome as Occurrence["outcome"], reason: r.reason, taskId: r.task_id, modelSteps: r.model_steps, at: r.at, dispatched: !!r.dispatched, settled: !!r.settled });
type NoteRow = { key: string; category: string; source_kind: string; source_id: string; priority: string; title: string; reason: string; verified_state: string; action: string; at: number; deliver_at: number; delivered: number; dismissed: number; snoozed_until: number | null; suppressed: number };
const note = (r: NoteRow): ProactiveNotification => ({ key: r.key, category: r.category as NotificationCategory, sourceKind: r.source_kind as ProactiveNotification["sourceKind"], sourceId: r.source_id, priority: r.priority as ProactiveNotification["priority"], title: r.title, reason: r.reason, verifiedState: r.verified_state, action: r.action, at: r.at, deliverAt: r.deliver_at, delivered: !!r.delivered, dismissed: !!r.dismissed, snoozedUntil: r.snoozed_until, suppressed: !!r.suppressed });
