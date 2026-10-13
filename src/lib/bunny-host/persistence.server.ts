import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ObservedUsage, OrchTask, Project, ProviderId } from "../orch/types.ts";
import type { HostEvent, PerformanceProfile } from "./contracts.ts";

/** Profiles below this many outcomes are reported but carry no routing weight. */
export const MINIMUM_SAMPLES = 5;
const OUTCOME_COLUMNS: [string, string][] = [
  ["state", "TEXT"], ["mode", "TEXT"], ["complexity", "REAL"], ["scores", "TEXT"], ["manual", "INTEGER"], ["verification", "TEXT"],
  ["retries", "INTEGER"], ["stop_reason", "TEXT"], ["feedback", "TEXT"], ["input_tokens", "INTEGER"], ["output_tokens", "INTEGER"],
  ["cached_tokens", "INTEGER"], ["exit_code", "INTEGER"], ["model", "TEXT"], ["finished_at", "INTEGER"], ["error", "TEXT"],
];
const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2); };

export class HostDatabase {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, task_id TEXT, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outcomes(task_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_type TEXT NOT NULL, completed INTEGER NOT NULL, verified INTEGER NOT NULL, duration_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE TABLE IF NOT EXISTS migrations(key TEXT PRIMARY KEY);
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id, sequence);
      PRAGMA user_version=3;`);
    // Additive migration: older Host databases keep every row; new evidence columns start empty.
    const existing = new Set((this.db.prepare("PRAGMA table_info(outcomes)").all() as { name: string }[]).map((column) => column.name));
    for (const [name, type] of OUTCOME_COLUMNS) if (!existing.has(name)) this.db.exec(`ALTER TABLE outcomes ADD COLUMN ${name} ${type}`);
    // v3 (M-A-0): events may belong to a mission. Existing events keep a null mission id.
    const eventColumns = new Set((this.db.prepare("PRAGMA table_info(events)").all() as { name: string }[]).map((column) => column.name));
    if (!eventColumns.has("mission_id")) this.db.exec("ALTER TABLE events ADD COLUMN mission_id TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS events_mission ON events(mission_id, sequence)");
  }
  tasks(): OrchTask[] { return (this.db.prepare("SELECT record FROM tasks").all() as { record: string }[]).map(row => JSON.parse(row.record) as OrchTask).sort((a,b) => b.createdAt-a.createdAt); }
  projects(): Project[] { return (this.db.prepare("SELECT record FROM projects").all() as { record: string }[]).map(row => JSON.parse(row.record) as Project); }
  get(id: string): OrchTask { const row = this.db.prepare("SELECT record FROM tasks WHERE id=?").get(id) as { record: string } | undefined; if (!row) throw new Error("Unknown task."); return JSON.parse(row.record) as OrchTask; }
  inserted = 0;
  onFailure: ((error:unknown,rollbackFailed:boolean)=>void)|null=null;
  /** Synchronous SQLite boundary: preserve the original failure even if rollback itself fails. */
  transaction<T>(work: () => T): T {
    let started=false;
    try {this.db.exec("BEGIN IMMEDIATE");started=true;const result=work();this.db.exec("COMMIT");return result;}
    catch(error) {
      if(started) try {this.db.exec("ROLLBACK");} catch(rollback) {const fatal=new AggregateError([error,rollback],"SQLite transaction and rollback failed; Host integrity requires recovery.");this.onFailure?.(fatal,true);throw fatal;}
      this.onFailure?.(error,false);throw error;
    }
  }
  event(type: string, taskId: string | null, detail: string, missionId: string | null = null): HostEvent {
    const at = Date.now(); const result = this.db.prepare("INSERT INTO events(at,type,task_id,detail,mission_id) VALUES(?,?,?,?,?)").run(at,type,taskId,detail.slice(0,16000),missionId);
    // Bound the journal: keep the newest 20,000 events, trimming every 500 inserts.
    if (++this.inserted % 500 === 0) this.db.prepare("DELETE FROM events WHERE sequence<=?").run(Number(result.lastInsertRowid) - 20000);
    return { sequence: Number(result.lastInsertRowid), at, type, taskId, detail: detail.slice(0,16000), missionId };
  }
  write(task: OrchTask, type: string, detail: string): HostEvent {
    return this.transaction(()=>{
      this.db.prepare("INSERT INTO tasks(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record").run(task.id,JSON.stringify(task));
      if(task.startedAt && /^task\.(completed|failed|stopped)$/.test(type)) this.outcome(task);
      return this.event(type,task.id,detail,task.mission?.missionId ?? null);
    });
  }
  events(after = 0): HostEvent[] { return (this.db.prepare("SELECT sequence,at,type,task_id AS taskId,detail,mission_id AS missionId FROM events WHERE sequence>? ORDER BY sequence LIMIT 500").all(after) as HostEvent[]); }
  taskEvents(taskId: string, after = 0): HostEvent[] { return (this.db.prepare("SELECT sequence,at,type,task_id AS taskId,detail,mission_id AS missionId FROM events WHERE task_id=? AND sequence>? ORDER BY sequence LIMIT 500").all(taskId, after) as HostEvent[]); }
  recentEvents(): HostEvent[] { return (this.db.prepare("SELECT sequence,at,type,task_id AS taskId,detail,mission_id AS missionId FROM events ORDER BY sequence DESC LIMIT 80").all() as HostEvent[]).reverse(); }
  /** A mission's own events plus those of its child tasks, in journal order. */
  missionEvents(missionId: string, taskIds: string[], after = 0, limit = 500): HostEvent[] {
    const placeholders = taskIds.map(() => "?").join(",");
    const sql = `SELECT sequence,at,type,task_id AS taskId,detail,mission_id AS missionId FROM events WHERE sequence>? AND (mission_id=?${taskIds.length ? ` OR task_id IN (${placeholders})` : ""}) ORDER BY sequence LIMIT ?`;
    return this.db.prepare(sql).all(after, missionId, ...taskIds, limit) as HostEvent[];
  }
  cursor(): number { return Number((this.db.prepare("SELECT COALESCE(MAX(sequence),0) n FROM events").get() as { n: number }).n); }
  project(project: Project) { this.db.prepare("INSERT INTO projects(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record").run(project.id, JSON.stringify(project)); }
  /** Records (or updates) the evidence for one finished task. Called again when verification or feedback arrives. */
  outcome(task: OrchTask) {
    const verification = task.verification ? (task.verification.passed ? "passed" : "failed") : "none";
    this.db.prepare(`INSERT INTO outcomes(task_id,provider,task_type,completed,verified,duration_ms,state,mode,complexity,scores,manual,verification,retries,stop_reason,feedback,input_tokens,output_tokens,cached_tokens,exit_code,model,finished_at,error)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET completed=excluded.completed,verified=excluded.verified,duration_ms=excluded.duration_ms,state=excluded.state,verification=excluded.verification,
        retries=excluded.retries,stop_reason=excluded.stop_reason,feedback=excluded.feedback,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
        cached_tokens=excluded.cached_tokens,exit_code=excluded.exit_code,model=excluded.model,finished_at=excluded.finished_at,error=excluded.error`).run(
      task.id, task.provider, task.decision.task_type, task.state === "completed" ? 1 : 0, task.verification?.passed ? 1 : 0,
      Math.max(0, (task.finishedAt ?? Date.now()) - (task.startedAt ?? Date.now())), task.state, task.mode, task.decision.complexity,
      JSON.stringify(task.decision.scores ?? []), task.manual ? 1 : 0, verification, task.retries ?? 0, task.stopReason ?? null, task.feedback ?? null,
      task.usage?.inputTokens ?? null, task.usage?.outputTokens ?? null, task.usage?.cachedInputTokens ?? null, task.exitCode ?? null, task.model, task.finishedAt ?? null,
      task.error ? task.error.slice(0, 500) : null,
    );
  }
  performance(): PerformanceProfile[] {
    const rows = this.db.prepare(`SELECT provider,task_type AS taskType,COUNT(*) AS count,SUM(completed) AS completed,SUM(verified) AS verified,SUM(duration_ms) AS durationMs,
      SUM(CASE WHEN verification='failed' THEN 1 ELSE 0 END) AS verifiedFailed,SUM(CASE WHEN state='stopped' THEN 1 ELSE 0 END) AS stopped,SUM(COALESCE(manual,0)) AS manual,
      SUM(COALESCE(input_tokens,0)) AS inputTokens,SUM(COALESCE(output_tokens,0)) AS outputTokens FROM outcomes GROUP BY provider,task_type`).all() as unknown as PerformanceProfile[];
    const durations = this.db.prepare("SELECT provider,task_type AS taskType,duration_ms AS d FROM outcomes WHERE completed=1").all() as { provider: string; taskType: string; d: number }[];
    return rows.map((row) => ({ ...row, medianDurationMs: median(durations.filter((item) => item.provider === row.provider && item.taskType === row.taskType).map((item) => item.d)), minimumSamples: MINIMUM_SAMPLES, sufficient: row.count >= MINIMUM_SAMPLES }));
  }
  learned(provider: ProviderId, taskType: string): number {
    const profile = this.performance().find(row => row.provider===provider && row.taskType===taskType);
    // Completion alone does not establish quality. Only independently verified success contributes,
    // and a task the user stopped says nothing about the provider, so it is not counted.
    const decided = profile ? profile.count - (profile.stopped ?? 0) : 0;
    if (!profile || decided < MINIMUM_SAMPLES) return 0;
    return Math.max(-0.06, Math.min(0.06, ((profile.verified+2)/(decided+4)-0.5)*0.12));
  }
  /** Median completed duration for a provider and task type, only with enough samples to mean anything. */
  latency(provider: ProviderId, taskType: string): number | null {
    const values = (this.db.prepare("SELECT duration_ms AS d FROM outcomes WHERE provider=? AND task_type=? AND completed=1").all(provider, taskType) as { d: number }[]).map((row) => row.d);
    return values.length >= MINIMUM_SAMPLES ? median(values) : null;
  }
  /** What Bunny-A itself observed for a provider: counts, runtime and provider-reported tokens. */
  observed(provider: ProviderId): ObservedUsage {
    const row = this.db.prepare(`SELECT COUNT(*) AS tasks,SUM(completed) AS completed,SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,SUM(CASE WHEN state='stopped' THEN 1 ELSE 0 END) AS stopped,
      SUM(duration_ms) AS runtimeMs,SUM(COALESCE(input_tokens,0)) AS inputTokens,SUM(COALESCE(output_tokens,0)) AS outputTokens,SUM(COALESCE(cached_tokens,0)) AS cachedInputTokens,MAX(finished_at) AS lastTaskAt FROM outcomes WHERE provider=?`).get(provider) as Record<string, number | null>;
    return { tasks: Number(row.tasks ?? 0), completed: Number(row.completed ?? 0), failed: Number(row.failed ?? 0), stopped: Number(row.stopped ?? 0), runtimeMs: Number(row.runtimeMs ?? 0), inputTokens: Number(row.inputTokens ?? 0), outputTokens: Number(row.outputTokens ?? 0), cachedInputTokens: Number(row.cachedInputTokens ?? 0), lastTaskAt: row.lastTaskAt == null ? null : Number(row.lastTaskAt) };
  }
  close() { this.db.close(); }
}
