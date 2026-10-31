import { z } from "zod";
import type { HostDatabase } from "../persistence.server.ts";
import { scanCheckpointJson } from "../agent-checkpoint.server.ts";
import { canonical, EnvelopeSchema, sha256, TASK_SCHEMA_VERSION, TASK_STATES, taskCanTransition, TaskSpecSchema, TERMINAL_TASK_STATES, type OperationCategory, type TaskRecord, type TaskState } from "./task-runtime.ts";
import { ExecutionOutcomeRecordSchema, type ExecutionOutcomeRecord, isVerifiedSuccess } from "./outcome-measurement.ts";

/**
 * MA4-S2-T1 durable task store: additive tables on the Host's own SQLite file. Every change is one BEGIN IMMEDIATE
 * transaction that checks the task's version, its lease and fencing token and the transition table, then writes the row,
 * an append-only transition record and — atomically with it — any operation receipt, checkpoint, output or notification.
 * Rows carry a SHA-256 of their record; a row that fails it is refused, never repaired or executed.
 */
export const TASK_RUNTIME_MIGRATION = "ma4.task-runtime.v1";
export const MAX_TRANSITIONS_PER_TASK = 500;
export const MAX_CHECKPOINTS_PER_TASK = 50;
export const MAX_OUTPUT_CHARS = 64_000;
export const RETAIN_TERMINAL_TASKS = 200;
export const RETAIN_TERMINAL_MS = 30 * 24 * 3_600_000;

export class TaskCorruptError extends Error { readonly code = "TASK_RECORD_CORRUPT"; }
/** A worker whose lease or fencing token is no longer current: its commit is refused and it must stop. */
export class StaleLeaseError extends Error { readonly code = "STALE_LEASE"; }
export class TaskConflictError extends Error { readonly code = "TASK_CONFLICT"; }

export type OperationState = "started" | "succeeded" | "failed" | "interrupted" | "needs_verify" | "uncertain";
export type OperationRow = { key: string; taskId: string; stepId: string; category: OperationCategory; state: OperationState; attempts: number; fence: number; receipt: string | null };
export type Lease = { holder: string; fence: number };
export type ProcessIdentity = { pid: number; createdAt: number; name: string };
export type NotificationKind = "completed" | "failed" | "approval_required" | "recovery_blocked" | "deadline_missed";
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ["completed", "failed", "approval_required", "recovery_blocked", "deadline_missed"];
export type Notification = { key: string; taskId: string; kind: NotificationKind; text: string; at: number; delivered: boolean; acknowledged: boolean };

export const PolicySchema = z.object({
  /** Off by default: with no workstation window attached, work does not continue. */
  background: z.boolean().default(false),
  /** Off by default: after a Host restart, recovered tasks wait for the user instead of continuing on their own. */
  resumeOnStart: z.boolean().default(false),
  notifications: z.object({ enabled: z.boolean().default(true), kinds: z.array(z.enum(["completed", "failed", "approval_required", "recovery_blocked", "deadline_missed"])).default([...NOTIFICATION_KINDS]) }).strict().default({ enabled: true, kinds: [...NOTIFICATION_KINDS] }),
}).strict();
export type TaskPolicy = z.infer<typeof PolicySchema>;

type Row = { id: string; state: string; version: number; fence: number; lease_holder: string | null; lease_expires: number | null; record: string; record_sha256: string };
export type Update = {
  actor: string; reason: string; now: number;
  /** Optimistic concurrency for user commands. */
  expectVersion?: number;
  /** Worker commits: the caller must still hold this exact lease, unexpired. */
  lease?: Lease;
  from?: readonly TaskState[];
  to?: TaskState;
  mutate?: (record: TaskRecord) => void;
  /** claim: take the lease (fence + 1); release: drop it; fence: invalidate any current holder (fence + 1, no holder). */
  leaseOp?: { kind: "claim"; holder: string; ttlMs: number } | { kind: "release" } | { kind: "fence" };
  operation?: { key: string; stepId: string; category: OperationCategory; state: OperationState; receipt?: string | null; start?: boolean };
  checkpoint?: Record<string, string | number | boolean | null>;
  output?: { stepId: string; content: string };
  notify?: { key: string; kind: NotificationKind; text: string; deliver: boolean }[];
};
export type Updated = { record: TaskRecord; version: number; fence: number; notified: Notification[] };

export function verifyRecord(row: Pick<Row, "id" | "state" | "record" | "record_sha256">): TaskRecord {
  const fail = (why: string): never => { throw new TaskCorruptError(`Stored task ${row.id} failed its integrity check (${why}); nothing will run until it is reviewed.`); };
  if (sha256(row.record) !== row.record_sha256) fail("record hash mismatch");
  let record: TaskRecord;
  try { record = JSON.parse(row.record) as TaskRecord; } catch { return fail("unparseable record"); }
  if (!record || record.schema !== "ma4.task.v1" || record.id !== row.id || record.state !== row.state || !(TASK_STATES as readonly string[]).includes(record.state)) fail("identity or state");
  const spec = TaskSpecSchema.safeParse(record.spec), envelope = EnvelopeSchema.safeParse(record.envelope);
  if (!spec.success || !envelope.success) fail("specification or envelope shape");
  if (sha256(canonical(record.spec)) !== record.specSha256 || sha256(canonical(record.envelope)) !== record.envelopeSha256) fail("specification or envelope hash");
  if (!Array.isArray(record.steps) || record.steps.length !== record.spec.steps.length || record.steps.some((s, i) => s.id !== record.spec.steps[i].id)) fail("step ledger");
  return record;
}

export class TaskStore {
  readonly host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ma4_tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,fence INTEGER NOT NULL DEFAULT 0,lease_holder TEXT,lease_expires INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,record TEXT NOT NULL,record_sha256 TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ma4_tasks_state ON ma4_tasks(state,created_at);
      CREATE TABLE IF NOT EXISTS ma4_task_transitions(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,from_state TEXT,to_state TEXT NOT NULL,version INTEGER NOT NULL,fence INTEGER NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ma4_task_transitions_task ON ma4_task_transitions(task_id,seq);
      CREATE TABLE IF NOT EXISTS ma4_task_operations(key TEXT PRIMARY KEY,task_id TEXT NOT NULL,step_id TEXT NOT NULL,category TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,fence INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,receipt TEXT);
      CREATE INDEX IF NOT EXISTS ma4_task_operations_task ON ma4_task_operations(task_id);
      CREATE TABLE IF NOT EXISTS ma4_task_checkpoints(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,at INTEGER NOT NULL,record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ma4_task_checkpoints_task ON ma4_task_checkpoints(task_id,seq);
      CREATE TABLE IF NOT EXISTS ma4_task_outputs(task_id TEXT NOT NULL,step_id TEXT NOT NULL,sha256 TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(task_id,step_id));
      CREATE TABLE IF NOT EXISTS ma4_task_processes(task_id TEXT NOT NULL,pid INTEGER NOT NULL,created_at INTEGER NOT NULL,name TEXT NOT NULL,PRIMARY KEY(pid,created_at));
      CREATE TABLE IF NOT EXISTS ma4_task_notifications(key TEXT PRIMARY KEY,task_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,delivered INTEGER NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ma4_task_outcomes(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,task_class TEXT NOT NULL,status TEXT NOT NULL,verified INTEGER NOT NULL,model_calls INTEGER NOT NULL,tool_calls INTEGER NOT NULL,execution_ms INTEGER NOT NULL,record TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ma4_task_outcomes_project ON ma4_task_outcomes(project_id, created_at);
      INSERT OR IGNORE INTO migrations(key) VALUES('${TASK_RUNTIME_MIGRATION}');`);
    // Versioned schema: a database written by a newer runtime is refused rather than misread.
    const row = host.db.prepare("SELECT value FROM settings WHERE key='ma4_task_runtime_schema'").get() as { value: string } | undefined;
    const stored = Number(row?.value ?? TASK_SCHEMA_VERSION);
    if (!Number.isInteger(stored) || stored > TASK_SCHEMA_VERSION) throw new Error(`Task runtime schema ${row?.value} is newer than this Host (${TASK_SCHEMA_VERSION}); refusing to open it.`);
    if (!row) host.db.prepare("INSERT INTO settings(key,value) VALUES('ma4_task_runtime_schema',?)").run(String(TASK_SCHEMA_VERSION));
  }
  get db() { return this.host.db; }

  /** Own transaction (not HostDatabase.transaction): an expected refusal such as a stale lease must not degrade the Host. */
  private tx<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch (rollback) { throw new AggregateError([error, rollback], "Task store transaction and rollback failed."); } throw error; }
  }
  private row(id: string): Row | undefined { return this.db.prepare("SELECT id,state,version,fence,lease_holder,lease_expires,record,record_sha256 FROM ma4_tasks WHERE id=?").get(id) as Row | undefined; }

  insert(record: TaskRecord, actor: string, now: number): Updated {
    return this.tx(() => {
      if (this.row(record.id)) throw new TaskConflictError("A task with this id already exists.");
      const json = JSON.stringify(record);
      this.db.prepare("INSERT INTO ma4_tasks(id,project_id,state,version,fence,lease_holder,lease_expires,created_at,updated_at,record,record_sha256) VALUES(?,?,?,1,0,NULL,NULL,?,?,?,?)")
        .run(record.id, record.projectId, record.state, record.createdAt, now, json, sha256(json));
      this.db.prepare("INSERT INTO ma4_task_transitions(task_id,from_state,to_state,version,fence,actor,reason,at) VALUES(?,NULL,?,1,0,?,?,?)").run(record.id, record.state, actor, "created", now);
      return { record, version: 1, fence: 0, notified: [] };
    });
  }

  get(id: string): { record: TaskRecord; version: number; fence: number; leaseHolder: string | null; leaseExpires: number | null } {
    const row = this.row(id);
    if (!row) throw new TaskConflictError("That task does not exist.");
    return { record: verifyRecord(row), version: row.version, fence: row.fence, leaseHolder: row.lease_holder, leaseExpires: row.lease_expires };
  }
  /** Every task row; a corrupt one is reported as such and never handed to a worker. */
  list(states?: readonly TaskState[]): ({ ok: true; record: TaskRecord; version: number; fence: number; leaseHolder: string | null; leaseExpires: number | null } | { ok: false; id: string; error: string })[] {
    const rows = (states
      ? this.db.prepare(`SELECT id,state,version,fence,lease_holder,lease_expires,record,record_sha256 FROM ma4_tasks WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY created_at,id`).all(...states)
      : this.db.prepare("SELECT id,state,version,fence,lease_holder,lease_expires,record,record_sha256 FROM ma4_tasks ORDER BY created_at,id").all()) as Row[];
    return rows.map(row => {
      try { return { ok: true as const, record: verifyRecord(row), version: row.version, fence: row.fence, leaseHolder: row.lease_holder, leaseExpires: row.lease_expires }; }
      catch (error) { return { ok: false as const, id: row.id, error: (error as Error).message }; }
    });
  }

  update(id: string, change: Update): Updated {
    return this.tx(() => {
      const row = this.row(id);
      if (!row) throw new TaskConflictError("That task does not exist.");
      const record = verifyRecord(row);
      if (change.expectVersion !== undefined && change.expectVersion !== row.version) throw new TaskConflictError(`The task changed since this view (version ${row.version}, not ${change.expectVersion}). Review the current state.`);
      if (change.lease && (row.lease_holder !== change.lease.holder || row.fence !== change.lease.fence || (row.lease_expires ?? 0) <= change.now))
        throw new StaleLeaseError(`Task ${id}: this worker's lease (fence ${change.lease.fence}) is no longer current (fence ${row.fence}); its commit was refused.`);
      if (change.from && !change.from.includes(record.state)) throw new TaskConflictError(`The task is ${record.state}; this action needs ${change.from.join(" or ")}.`);
      const from = record.state;
      change.mutate?.(record);
      record.state = from;
      if (change.to && change.to !== from) {
        if (!taskCanTransition(from, change.to)) throw new TaskConflictError(`Invalid transition ${from} → ${change.to}.`);
        record.state = change.to;
      }
      record.updatedAt = change.now;
      let fence = row.fence, holder = row.lease_holder, expires = row.lease_expires;
      const op = change.leaseOp;
      if (op?.kind === "claim") {
        if (holder && (expires ?? 0) > change.now && holder !== op.holder) throw new TaskConflictError(`Task ${id} is held by another worker.`);
        fence += 1; holder = op.holder; expires = change.now + op.ttlMs;
      } else if (op?.kind === "release") { holder = null; expires = null; }
      else if (op?.kind === "fence") { fence += 1; holder = null; expires = null; }
      if (TERMINAL_TASK_STATES.includes(record.state)) { holder = null; expires = null; }
      const version = row.version + 1, json = JSON.stringify(record);
      this.db.prepare("UPDATE ma4_tasks SET state=?,version=?,fence=?,lease_holder=?,lease_expires=?,updated_at=?,record=?,record_sha256=? WHERE id=?")
        .run(record.state, version, fence, holder, expires, change.now, json, sha256(json), id);
      this.db.prepare("INSERT INTO ma4_task_transitions(task_id,from_state,to_state,version,fence,actor,reason,at) VALUES(?,?,?,?,?,?,?,?)").run(id, from, record.state, version, fence, change.actor.slice(0, 80), change.reason.slice(0, 240), change.now);
      // Leaving AWAITING_APPROVAL answers the request: its "needs your approval" notice is no longer pending (T3R1: a
      // schedule's own approval left a stale notice on every scheduled run).
      if (from === "AWAITING_APPROVAL" && record.state !== from) this.db.prepare("UPDATE ma4_task_notifications SET acknowledged=1 WHERE task_id=? AND kind='approval_required'").run(id);
      if (change.operation) this.writeOperation(id, change.operation, fence, change.now);
      if (change.checkpoint) {
        const json = JSON.stringify({ ...change.checkpoint, fence, version });
        const scan = scanCheckpointJson(json);
        if (!scan.safe) throw new Error(`Checkpoint refused by material guard: ${scan.findings.join(", ")}`);
        this.db.prepare("INSERT INTO ma4_task_checkpoints(task_id,at,record) VALUES(?,?,?)").run(id, change.now, json);
        this.db.prepare("DELETE FROM ma4_task_checkpoints WHERE task_id=? AND seq NOT IN (SELECT seq FROM ma4_task_checkpoints WHERE task_id=? ORDER BY seq DESC LIMIT ?)").run(id, id, MAX_CHECKPOINTS_PER_TASK);
      }
      if (change.output) {
        const content = change.output.content.slice(0, MAX_OUTPUT_CHARS);
        this.db.prepare("INSERT INTO ma4_task_outputs(task_id,step_id,sha256,content) VALUES(?,?,?,?) ON CONFLICT(task_id,step_id) DO UPDATE SET sha256=excluded.sha256,content=excluded.content").run(id, change.output.stepId, sha256(content), content);
      }
      const notified: Notification[] = [];
      for (const n of change.notify ?? []) {
        // The dedup key is the notification's identity: a recovered Host re-deriving the same event inserts nothing.
        const inserted = this.db.prepare("INSERT OR IGNORE INTO ma4_task_notifications(key,task_id,kind,text,at,delivered) VALUES(?,?,?,?,?,?)").run(n.key, id, n.kind, n.text.slice(0, 240), change.now, n.deliver ? 1 : 0);
        if (inserted.changes === 1) notified.push({ key: n.key, taskId: id, kind: n.kind, text: n.text.slice(0, 240), at: change.now, delivered: n.deliver, acknowledged: false });
      }
      this.db.prepare("DELETE FROM ma4_task_transitions WHERE task_id=? AND seq NOT IN (SELECT seq FROM ma4_task_transitions WHERE task_id=? ORDER BY seq DESC LIMIT ?)").run(id, id, MAX_TRANSITIONS_PER_TASK);
      return { record, version, fence, notified };
    });
  }

  /**
   * The exactly-once guard lives here, below the runtime: an operation that started, succeeded or is uncertain can never be
   * started again. Only a proven non-dispatch ("failed"), a read-only interruption or a verified-absent idempotent key may.
   */
  private writeOperation(taskId: string, op: NonNullable<Update["operation"]>, fence: number, now: number) {
    const existing = this.operation(op.key);
    if (op.start) {
      if (existing && !["failed", "interrupted", "needs_verify"].includes(existing.state)) throw new TaskConflictError(`Operation ${op.key} is already ${existing.state}; it will not be started again.`);
      if (existing?.state === "interrupted" && existing.category === "irreversible") throw new TaskConflictError(`Operation ${op.key} is irreversible and was interrupted; only the owner may resolve it.`);
      this.db.prepare("INSERT INTO ma4_task_operations(key,task_id,step_id,category,state,attempts,fence,started_at,finished_at,receipt) VALUES(?,?,?,?, 'started',1,?,?,NULL,NULL) ON CONFLICT(key) DO UPDATE SET state='started',attempts=attempts+1,fence=excluded.fence,started_at=excluded.started_at,finished_at=NULL,receipt=NULL")
        .run(op.key, taskId, op.stepId, op.category, fence, now);
      return;
    }
    if (!existing) throw new TaskConflictError(`Operation ${op.key} was never started.`);
    this.db.prepare("UPDATE ma4_task_operations SET state=?,finished_at=?,receipt=COALESCE(?,receipt) WHERE key=?").run(op.state, now, op.receipt ?? null, op.key);
  }
  operation(key: string): OperationRow | null {
    const row = this.db.prepare("SELECT key,task_id AS taskId,step_id AS stepId,category,state,attempts,fence,receipt FROM ma4_task_operations WHERE key=?").get(key) as OperationRow | undefined;
    return row ?? null;
  }
  operations(taskId: string): OperationRow[] {
    return this.db.prepare("SELECT key,task_id AS taskId,step_id AS stepId,category,state,attempts,fence,receipt FROM ma4_task_operations WHERE task_id=? ORDER BY key").all(taskId) as OperationRow[];
  }

  /** Extends the caller's own lease. Same holder and fence only, so a reclaimed task cannot be renewed by its old worker. */
  renew(id: string, lease: Lease, ttlMs: number, now: number): boolean {
    return this.db.prepare("UPDATE ma4_tasks SET lease_expires=? WHERE id=? AND lease_holder=? AND fence=?").run(now + ttlMs, id, lease.holder, lease.fence).changes === 1;
  }

  transitions(id: string): { from: string | null; to: string; version: number; fence: number; actor: string; reason: string; at: number }[] {
    return this.db.prepare("SELECT from_state AS 'from',to_state AS 'to',version,fence,actor,reason,at FROM ma4_task_transitions WHERE task_id=? ORDER BY seq").all(id) as never;
  }
  checkpoints(id: string): Record<string, unknown>[] {
    return (this.db.prepare("SELECT record FROM ma4_task_checkpoints WHERE task_id=? ORDER BY seq").all(id) as { record: string }[]).map(r => JSON.parse(r.record));
  }
  output(id: string, stepId: string): { sha256: string; content: string } | null {
    return (this.db.prepare("SELECT sha256,content FROM ma4_task_outputs WHERE task_id=? AND step_id=?").get(id, stepId) as { sha256: string; content: string } | undefined) ?? null;
  }

  recordProcess(taskId: string, p: ProcessIdentity) { this.db.prepare("INSERT OR IGNORE INTO ma4_task_processes(task_id,pid,created_at,name) VALUES(?,?,?,?)").run(taskId, p.pid, p.createdAt, p.name); }
  forgetProcess(p: ProcessIdentity) { this.db.prepare("DELETE FROM ma4_task_processes WHERE pid=? AND created_at=?").run(p.pid, p.createdAt); }
  processes(): (ProcessIdentity & { taskId: string })[] {
    return this.db.prepare("SELECT task_id AS taskId,pid,created_at AS createdAt,name FROM ma4_task_processes").all() as never;
  }

  notifications(limit = 50): Notification[] {
    return (this.db.prepare("SELECT key,task_id AS taskId,kind,text,at,delivered,acknowledged FROM ma4_task_notifications ORDER BY at DESC,key LIMIT ?").all(limit) as (Omit<Notification, "delivered" | "acknowledged"> & { delivered: number; acknowledged: number })[])
      .map(n => ({ ...n, delivered: !!n.delivered, acknowledged: !!n.acknowledged }));
  }
  acknowledge(key: string): boolean { return this.db.prepare("UPDATE ma4_task_notifications SET acknowledged=1 WHERE key=?").run(key).changes === 1; }

  recordOutcome(outcome: ExecutionOutcomeRecord): void {
    const verified = isVerifiedSuccess(outcome) ? 1 : 0;
    this.db.prepare(`
      INSERT OR REPLACE INTO ma4_task_outcomes (
        task_id, project_id, task_class, status, verified, model_calls, tool_calls, execution_ms, record, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      outcome.taskId,
      outcome.projectId,
      outcome.taskClass,
      outcome.status,
      verified,
      outcome.modelCallCount,
      outcome.toolCallCount,
      outcome.executionTimeMs,
      JSON.stringify(outcome),
      outcome.createdAt,
    );
  }

  getOutcome(taskId: string): ExecutionOutcomeRecord | null {
    const row = this.db.prepare("SELECT record FROM ma4_task_outcomes WHERE task_id = ?").get(taskId) as { record: string } | undefined;
    if (!row) return null;
    try {
      return ExecutionOutcomeRecordSchema.parse(JSON.parse(row.record));
    } catch {
      return null;
    }
  }

  listOutcomes(projectId?: string, limit = 100): ExecutionOutcomeRecord[] {
    const rows = (projectId
      ? this.db.prepare("SELECT record FROM ma4_task_outcomes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit)
      : this.db.prepare("SELECT record FROM ma4_task_outcomes ORDER BY created_at DESC LIMIT ?").all(limit)) as { record: string }[];
    const res: ExecutionOutcomeRecord[] = [];
    for (const r of rows) {
      try {
        res.push(ExecutionOutcomeRecordSchema.parse(JSON.parse(r.record)));
      } catch { /* malformed historic rows are skipped; the queue keeps the parsable ones */ }
    }
    return res;
  }

  policy(): TaskPolicy {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='ma4_task_policy_v1'").get() as { value: string } | undefined;
    // Unreadable policy fails closed to the defaults (no background work, no automatic resume).
    try { return PolicySchema.parse(row ? JSON.parse(row.value) : {}); } catch { return PolicySchema.parse({}); }
  }
  setPolicy(raw: unknown): TaskPolicy {
    const policy = PolicySchema.parse(raw);
    this.db.prepare("INSERT INTO settings(key,value) VALUES('ma4_task_policy_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(policy));
    return policy;
  }

  /** SQLite's own page-level check. A failing database is opened read-only by the runtime (views, no execution). */
  integrity(): { ok: boolean; detail: string } {
    const rows = this.db.prepare("PRAGMA quick_check").all() as Record<string, string>[];
    const detail = rows.map(r => Object.values(r)[0]).join("; ");
    return { ok: detail === "ok", detail };
  }

  /** Bounded history: the newest terminal tasks within the retention window are kept; active tasks are never pruned. */
  prune(now: number): number {
    const terminal = this.db.prepare(`SELECT id,updated_at FROM ma4_tasks WHERE state IN ('COMPLETED','FAILED','CANCELLED') ORDER BY updated_at DESC`).all() as { id: string; updated_at: number }[];
    const doomed = terminal.filter((t, i) => i >= RETAIN_TERMINAL_TASKS || t.updated_at < now - RETAIN_TERMINAL_MS).map(t => t.id);
    if (!doomed.length) return 0;
    this.tx(() => {
      for (const id of doomed) for (const table of ["ma4_task_transitions", "ma4_task_operations", "ma4_task_checkpoints", "ma4_task_outputs", "ma4_task_notifications", "ma4_task_processes", "ma4_task_outcomes", "ma4_tasks"])
        this.db.prepare(`DELETE FROM ${table} WHERE ${table === "ma4_tasks" ? "id" : "task_id"}=?`).run(id);
    });
    return doomed.length;
  }
}
