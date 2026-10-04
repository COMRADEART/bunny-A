import type { HostDatabase } from "../bunny-host/persistence.server.ts";
import type { HostEvent } from "../bunny-host/contracts.ts";
import type {
  Artifact, AuthorizationEnvelope, CapabilityRun, GrantPolicy, InboxEvent, MemoryEntry, Mission, MissionConfig, MissionStep,
  PermissionRequest, Skill, Trigger,
} from "./types.ts";

export const MISSION_SCHEMA = "ma0.missions.v1";
export const DEFAULT_CONFIG: MissionConfig = {
  enabled: false,
  limits: { maxConcurrentAgents: 3, maxSteps: 12, maxRetriesPerStep: 2, maxReplans: 2, maxMissionRuntimeMs: 2 * 60 * 60_000, maxActiveMissions: 3 },
  triggersEnabled: false,
  browserHeadless: true,
};
const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|cookie|authorization|credential/i;
/** Third-party secrets never reach ordinary run/event records. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1)]));
  if (typeof value === "string" && value.length > 4000) return `${value.slice(0, 4000)}…`;
  return value;
}

/**
 * Additive M-A-0 tables on the Host's own SQLite file. Creation is idempotent and recorded once in the
 * existing `migrations` table; no existing table or row is rewritten.
 */
export class MissionStore {
  host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS missions(id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_steps(id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, idx INTEGER NOT NULL, state TEXT NOT NULL, task_id TEXT, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_dependencies(mission_id TEXT NOT NULL, step_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY(step_id, depends_on));
      CREATE TABLE IF NOT EXISTS mission_artifacts(id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, step_id TEXT, created_at INTEGER NOT NULL, body TEXT, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_authorizations(id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, granted_at INTEGER NOT NULL, revoked_at INTEGER, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS permission_requests(id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, resolved_at INTEGER, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capability_grants(id TEXT PRIMARY KEY, action TEXT NOT NULL, scope TEXT NOT NULL, policy TEXT NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, UNIQUE(action, scope));
      CREATE TABLE IF NOT EXISTS capability_runs(id TEXT PRIMARY KEY, mission_id TEXT, step_id TEXT, action TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, active_version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS skill_versions(skill_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(skill_id, version));
      CREATE TABLE IF NOT EXISTS triggers(id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_events(id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, mission_id TEXT, acknowledged_at INTEGER, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_memory(id TEXT PRIMARY KEY, mission_id TEXT, kind TEXT NOT NULL, verified INTEGER NOT NULL, created_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_locks(id TEXT PRIMARY KEY, root TEXT NOT NULL, mode TEXT NOT NULL, mission_id TEXT NOT NULL, step_id TEXT NOT NULL, acquired_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS mission_steps_mission ON mission_steps(mission_id, idx);
      CREATE INDEX IF NOT EXISTS mission_artifacts_mission ON mission_artifacts(mission_id, created_at);
      CREATE INDEX IF NOT EXISTS capability_runs_mission ON capability_runs(mission_id, started_at);
      CREATE INDEX IF NOT EXISTS inbox_at ON inbox_events(at);
      CREATE INDEX IF NOT EXISTS memory_mission ON mission_memory(mission_id, created_at);
      INSERT OR IGNORE INTO migrations(key) VALUES('${MISSION_SCHEMA}');`);
  }
  get db() { return this.host.db; }

  config(): MissionConfig {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='missions_config'").get() as { value: string } | undefined;
    let saved: Partial<MissionConfig> = {};
    try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
    const env = process.env.BUNNY_MISSIONS;
    const enabled = env === "1" ? true : env === "0" ? false : saved.enabled ?? DEFAULT_CONFIG.enabled;
    return { ...DEFAULT_CONFIG, ...saved, enabled, limits: { ...DEFAULT_CONFIG.limits, ...saved.limits } };
  }
  saveConfig(config: MissionConfig) { this.db.prepare("INSERT INTO settings VALUES('missions_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config)); }

  saveMission(mission: Mission) {
    this.db.prepare("INSERT INTO missions(id,state,created_at,updated_at,record) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,record=excluded.record")
      .run(mission.id, mission.state, mission.createdAt, mission.updatedAt, JSON.stringify(mission));
  }
  mission(id: string): Mission {
    const row = this.db.prepare("SELECT record FROM missions WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("Unknown mission.");
    return JSON.parse(row.record) as Mission;
  }
  missions(limit = 30): Mission[] { return (this.db.prepare("SELECT record FROM missions ORDER BY created_at DESC LIMIT ?").all(limit) as { record: string }[]).map((row) => JSON.parse(row.record) as Mission); }
  missionsIn(states: string[]): Mission[] {
    return (this.db.prepare(`SELECT record FROM missions WHERE state IN (${states.map(() => "?").join(",")})`).all(...states) as { record: string }[]).map((row) => JSON.parse(row.record) as Mission);
  }

  saveStep(step: MissionStep) {
    this.db.prepare("INSERT INTO mission_steps(id,mission_id,idx,state,task_id,record) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,task_id=excluded.task_id,record=excluded.record")
      .run(step.id, step.missionId, step.index, step.state, step.taskId, JSON.stringify(step));
  }
  /** Replaces a mission's graph atomically (planning / replanning only). */
  replaceSteps(missionId: string, steps: MissionStep[]) {
    this.host.transaction(()=>{
      this.db.prepare("DELETE FROM mission_steps WHERE mission_id=?").run(missionId);
      this.db.prepare("DELETE FROM mission_dependencies WHERE mission_id=?").run(missionId);
      for (const step of steps) {
        this.saveStep(step);
        for (const dep of step.dependsOn) this.db.prepare("INSERT INTO mission_dependencies VALUES(?,?,?)").run(missionId, step.id, dep);
      }
    });
  }
  steps(missionId: string): MissionStep[] { return (this.db.prepare("SELECT record FROM mission_steps WHERE mission_id=? ORDER BY idx").all(missionId) as { record: string }[]).map((row) => JSON.parse(row.record) as MissionStep); }
  step(id: string): MissionStep {
    const row = this.db.prepare("SELECT record FROM mission_steps WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("Unknown mission step.");
    return JSON.parse(row.record) as MissionStep;
  }
  stepForTask(taskId: string): MissionStep | null {
    const row = this.db.prepare("SELECT record FROM mission_steps WHERE task_id=?").get(taskId) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as MissionStep : null;
  }
  dependencies(missionId: string): { stepId: string; dependsOn: string }[] { return this.db.prepare("SELECT step_id AS stepId,depends_on AS dependsOn FROM mission_dependencies WHERE mission_id=?").all(missionId) as { stepId: string; dependsOn: string }[]; }

  saveAuthorization(envelope: AuthorizationEnvelope) {
    this.db.prepare("INSERT INTO mission_authorizations(id,mission_id,granted_at,revoked_at,record) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revoked_at=excluded.revoked_at,record=excluded.record")
      .run(envelope.id, envelope.missionId, envelope.grantedAt, envelope.revokedAt, JSON.stringify(envelope));
  }
  authorization(id: string): AuthorizationEnvelope | null {
    const row = this.db.prepare("SELECT record FROM mission_authorizations WHERE id=?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as AuthorizationEnvelope : null;
  }

  saveRequest(request: PermissionRequest) {
    this.db.prepare("INSERT INTO permission_requests(id,mission_id,resolved_at,record) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=excluded.resolved_at,record=excluded.record").run(request.id, request.missionId, request.resolvedAt, JSON.stringify(request));
  }
  request(id: string): PermissionRequest {
    const row = this.db.prepare("SELECT record FROM permission_requests WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("Unknown permission request.");
    return JSON.parse(row.record) as PermissionRequest;
  }
  requests(missionId: string): PermissionRequest[] { return (this.db.prepare("SELECT record FROM permission_requests WHERE mission_id=?").all(missionId) as { record: string }[]).map((row) => JSON.parse(row.record) as PermissionRequest); }

  setGrant(action: string, scope: string, policy: GrantPolicy, createdBy: string) {
    this.db.prepare("INSERT INTO capability_grants(id,action,scope,policy,created_at,created_by) VALUES(?,?,?,?,?,?) ON CONFLICT(action,scope) DO UPDATE SET policy=excluded.policy,created_at=excluded.created_at,created_by=excluded.created_by")
      .run(crypto.randomUUID(), action, scope, policy, Date.now(), createdBy);
  }
  clearGrant(action: string, scope: string) { this.db.prepare("DELETE FROM capability_grants WHERE action=? AND scope=?").run(action, scope); }
  grants(): { action: string; scope: string; policy: GrantPolicy; createdAt: number; createdBy: string }[] {
    return this.db.prepare("SELECT action,scope,policy,created_at AS createdAt,created_by AS createdBy FROM capability_grants").all() as { action: string; scope: string; policy: GrantPolicy; createdAt: number; createdBy: string }[];
  }

  saveRun(run: CapabilityRun) {
    this.db.prepare("INSERT INTO capability_runs(id,mission_id,step_id,action,status,started_at,record) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record=excluded.record")
      .run(run.id, run.missionId, run.stepId, run.action, run.status, run.startedAt, JSON.stringify(run));
  }
  run(id: string): CapabilityRun {
    const row = this.db.prepare("SELECT record FROM capability_runs WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("Unknown capability run.");
    return JSON.parse(row.record) as CapabilityRun;
  }
  runs(filter: { missionId?: string; status?: string; limit?: number } = {}): CapabilityRun[] {
    const where: string[] = []; const args: (string | number)[] = [];
    if (filter.missionId) { where.push("mission_id=?"); args.push(filter.missionId); }
    if (filter.status) { where.push("status=?"); args.push(filter.status); }
    return (this.db.prepare(`SELECT record FROM capability_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT ?`).all(...args, filter.limit ?? 200) as { record: string }[]).map((row) => JSON.parse(row.record) as CapabilityRun);
  }

  saveArtifact(artifact: Artifact, body: string | null) {
    this.db.prepare("INSERT INTO mission_artifacts(id,mission_id,step_id,created_at,body,record) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record")
      .run(artifact.id, artifact.missionId, artifact.stepId, artifact.createdAt, body, JSON.stringify(artifact));
  }
  artifact(id: string): { artifact: Artifact; body: string | null } {
    const row = this.db.prepare("SELECT record,body FROM mission_artifacts WHERE id=?").get(id) as { record: string; body: string | null } | undefined;
    if (!row) throw new Error("Unknown artifact.");
    return { artifact: JSON.parse(row.record) as Artifact, body: row.body };
  }
  artifacts(missionId: string): Artifact[] { return (this.db.prepare("SELECT record FROM mission_artifacts WHERE mission_id=? ORDER BY created_at").all(missionId) as { record: string }[]).map((row) => JSON.parse(row.record) as Artifact); }

  saveMemory(entry: MemoryEntry) {
    this.db.prepare("INSERT INTO mission_memory(id,mission_id,kind,verified,created_at,record) VALUES(?,?,?,?,?,?)").run(entry.id, entry.missionId, entry.kind, entry.verified ? 1 : 0, entry.createdAt, JSON.stringify(entry));
  }
  memory(missionId: string | null, filter: { kind?: string; verified?: boolean } = {}): MemoryEntry[] {
    const where = [missionId === null ? "mission_id IS NULL" : "mission_id=?"]; const args: (string | number)[] = missionId === null ? [] : [missionId];
    if (filter.kind) { where.push("kind=?"); args.push(filter.kind); }
    if (filter.verified !== undefined) { where.push("verified=?"); args.push(filter.verified ? 1 : 0); }
    return (this.db.prepare(`SELECT record FROM mission_memory WHERE ${where.join(" AND ")} ORDER BY created_at`).all(...args) as { record: string }[]).map((row) => JSON.parse(row.record) as MemoryEntry);
  }
  trimMemory(missionId: string, keep: number) {
    this.db.prepare("DELETE FROM mission_memory WHERE mission_id=? AND kind NOT IN ('verified_fact','user_decision') AND id NOT IN (SELECT id FROM mission_memory WHERE mission_id=? ORDER BY created_at DESC LIMIT ?)").run(missionId, missionId, keep);
  }

  saveSkill(skill: Skill, activate: boolean) {
    this.db.prepare("INSERT INTO skill_versions(skill_id,version,status,record) VALUES(?,?,?,?) ON CONFLICT(skill_id,version) DO UPDATE SET status=excluded.status,record=excluded.record").run(skill.id, skill.version, skill.status, JSON.stringify(skill));
    if (activate) this.db.prepare("INSERT INTO skills(id,active_version) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET active_version=excluded.active_version").run(skill.id, skill.version);
  }
  skill(id: string, version?: number): Skill | null {
    const active = version ?? (this.db.prepare("SELECT active_version AS v FROM skills WHERE id=?").get(id) as { v: number } | undefined)?.v;
    if (active === undefined) return null;
    const row = this.db.prepare("SELECT record FROM skill_versions WHERE skill_id=? AND version=?").get(id, active) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as Skill : null;
  }
  skillVersions(id: string): Skill[] { return (this.db.prepare("SELECT record FROM skill_versions WHERE skill_id=? ORDER BY version").all(id) as { record: string }[]).map((row) => JSON.parse(row.record) as Skill); }
  activeSkills(): Skill[] {
    return (this.db.prepare("SELECT v.record FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.version=s.active_version ORDER BY s.id").all() as { record: string }[]).map((row) => JSON.parse(row.record) as Skill);
  }

  saveTrigger(trigger: Trigger) { this.db.prepare("INSERT INTO triggers(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record").run(trigger.id, JSON.stringify(trigger)); }
  trigger(id: string): Trigger {
    const row = this.db.prepare("SELECT record FROM triggers WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("Unknown trigger.");
    return JSON.parse(row.record) as Trigger;
  }
  triggers(): Trigger[] { return (this.db.prepare("SELECT record FROM triggers").all() as { record: string }[]).map((row) => JSON.parse(row.record) as Trigger); }
  deleteTrigger(id: string) { this.db.prepare("DELETE FROM triggers WHERE id=?").run(id); }

  saveInbox(event: InboxEvent) {
    this.db.prepare("INSERT INTO inbox_events(id,at,kind,mission_id,acknowledged_at,record) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET acknowledged_at=excluded.acknowledged_at,record=excluded.record")
      .run(event.id, event.at, event.kind, event.missionId, event.acknowledgedAt, JSON.stringify(event));
    // Bounded: keep the newest 2,000 entries.
    this.db.prepare("DELETE FROM inbox_events WHERE id NOT IN (SELECT id FROM inbox_events ORDER BY at DESC LIMIT 2000)").run();
  }
  inbox(limit = 40, unacknowledgedOnly = false): InboxEvent[] {
    return (this.db.prepare(`SELECT record FROM inbox_events ${unacknowledgedOnly ? "WHERE acknowledged_at IS NULL" : ""} ORDER BY at DESC LIMIT ?`).all(limit) as { record: string }[]).map((row) => JSON.parse(row.record) as InboxEvent);
  }
  inboxEvent(id: string): InboxEvent {
    const row = this.db.prepare("SELECT record FROM inbox_events WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) throw new Error("Unknown inbox event.");
    return JSON.parse(row.record) as InboxEvent;
  }

  locks(): { id: string; root: string; mode: "shared" | "exclusive"; missionId: string; stepId: string; acquiredAt: number }[] {
    return this.db.prepare("SELECT id,root,mode,mission_id AS missionId,step_id AS stepId,acquired_at AS acquiredAt FROM workspace_locks").all() as { id: string; root: string; mode: "shared" | "exclusive"; missionId: string; stepId: string; acquiredAt: number }[];
  }
  addLock(lock: { id: string; root: string; mode: "shared" | "exclusive"; missionId: string; stepId: string }) { this.db.prepare("INSERT INTO workspace_locks VALUES(?,?,?,?,?,?)").run(lock.id, lock.root, lock.mode, lock.missionId, lock.stepId, Date.now()); }
  releaseLocks(filter: { stepId?: string; missionId?: string }) {
    if (filter.stepId) this.db.prepare("DELETE FROM workspace_locks WHERE step_id=?").run(filter.stepId);
    else if (filter.missionId) this.db.prepare("DELETE FROM workspace_locks WHERE mission_id=?").run(filter.missionId);
  }

  missionEvents(missionId: string, after = 0): HostEvent[] {
    const taskIds = (this.db.prepare("SELECT task_id FROM mission_steps WHERE mission_id=? AND task_id IS NOT NULL").all(missionId) as { task_id: string }[]).map((row) => row.task_id);
    const all = new Set(taskIds);
    for (const step of this.steps(missionId)) for (const attempt of step.attempts) if (attempt.taskId) all.add(attempt.taskId);
    return this.host.missionEvents(missionId, [...all], after);
  }
}
