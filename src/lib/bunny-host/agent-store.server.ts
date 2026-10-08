import type { HostDatabase } from "./persistence.server.ts";
import { assertCheckpointSafe, parseCheckpoint } from "./agent-checkpoint.server.ts";
import type { AgentCheckpoint, AgentProfile, AgentRun, AgentSnapshot, AgentState, CheckpointBoundary, ReplaySafety } from "./agent-types.ts";

export const AGENT_RUNTIME_SCHEMA = "ma3.agent-runtime.v1";
/** Bounded retained history per run; the trim keeps the newest N checkpoints (§7 resource bounds). */
export const MAX_CHECKPOINTS_PER_RUN = 200;

/**
 * M-A-3 T4 additive tables on the Host's own SQLite file, created by their owner like the
 * routing tables. Idempotent creation, one migrations key, and no existing table or row is rewritten.
 */
export class AgentStore {
  host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, mission_id TEXT, state TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0, stopped INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, generation INTEGER NOT NULL, state TEXT NOT NULL, started_at INTEGER, ended_at INTEGER, end_reason TEXT, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_checkpoints(id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, run_id TEXT NOT NULL, boundary TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_recovery_claims(agent_id TEXT PRIMARY KEY, claim TEXT NOT NULL, generation INTEGER NOT NULL, holder TEXT NOT NULL, claimed_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_runs_agent ON agent_runs(agent_id, generation);
      CREATE INDEX IF NOT EXISTS agent_checkpoints_agent ON agent_checkpoints(agent_id, created_at);
      INSERT OR IGNORE INTO migrations(key) VALUES('${AGENT_RUNTIME_SCHEMA}');`);
  }
  get db() { return this.host.db; }

  saveAgent(agent: AgentProfile, state: string, flags: { paused: boolean; stopped: boolean }) {
    this.db.prepare(`INSERT INTO agents(id,mission_id,state,paused,stopped,created_at,updated_at,record) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,paused=excluded.paused,stopped=excluded.stopped,updated_at=excluded.updated_at,record=excluded.record`)
      .run(agent.id, agent.missionId, state, flags.paused ? 1 : 0, flags.stopped ? 1 : 0, agent.createdAt, agent.updatedAt, JSON.stringify(agent));
  }
  agent(id: string): AgentProfile | null {
    const row = this.db.prepare("SELECT record FROM agents WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) return null;
    // Fail closed on corrupt rows: a checkpoint-bearing profile must parse or recovery refuses.
    const parsed = JSON.parse(row.record) as AgentProfile;
    if (!parsed || typeof parsed.id !== "string") throw new Error("Agent record is corrupt.");
    return parsed;
  }
  agentFlags(id: string): { paused: boolean; stopped: boolean } {
    const row = this.db.prepare("SELECT paused,stopped FROM agents WHERE id=?").get(id) as { paused: number; stopped: number } | undefined;
    if (!row) return { paused: false, stopped: false };
    return { paused: !!row.paused, stopped: !!row.stopped };
  }
  agentsIn(states: string[]): { record: AgentProfile; state: string }[] {
    return (this.db.prepare(`SELECT state,record FROM agents WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY created_at`).all(...states) as { state: string; record: string }[])
      .map((row) => ({ state: row.state, record: JSON.parse(row.record) as AgentProfile }));
  }
  countActive(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE state NOT IN ('COMPLETED','FAILED','STOPPED')").get() as { n: number };
    return Number(row.n);
  }

  openRun(run: AgentRun): void {
    this.db.prepare("INSERT INTO agent_runs(id,agent_id,generation,state,started_at,ended_at,end_reason,record) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,ended_at=excluded.ended_at,end_reason=excluded.end_reason,record=excluded.record")
      .run(run.id, run.agentId, run.generation, run.state, run.startedAt, run.endedAt, run.endReason, JSON.stringify(run));
  }
  closeRun(runId: string, state: AgentState, endReason: string, at: number): void {
    const row = this.db.prepare("SELECT record FROM agent_runs WHERE id=?").get(runId) as { record: string } | undefined;
    if (!row) return;
    const run = JSON.parse(row.record) as AgentRun;
    this.openRun({ ...run, state, endedAt: at, endReason });
  }
  runs(agentId: string): AgentRun[] {
    return (this.db.prepare("SELECT record FROM agent_runs WHERE agent_id=? ORDER BY generation").all(agentId) as { record: string }[])
      .map((row) => JSON.parse(row.record) as AgentRun);
  }
  latestRun(agentId: string): AgentRun | null {
    const rows = this.runs(agentId); return rows.length ? rows[rows.length - 1] : null;
  }

  /** Refuses material the guard rejects before a single row is written (the guard itself is the gate). */
  saveCheckpoint(checkpoint: AgentCheckpoint): void {
    assertCheckpointSafe(checkpoint);
    this.db.prepare("INSERT INTO agent_checkpoints(id,agent_id,run_id,boundary,revision,created_at,record) VALUES(?,?,?,?,?,?,?)")
      .run(checkpoint.id, checkpoint.agentId, checkpoint.runId, checkpoint.boundary, checkpoint.revision, checkpoint.at, JSON.stringify(checkpoint));
  }
  checkpoint(id: string): AgentCheckpoint | null {
    const row = this.db.prepare("SELECT record FROM agent_checkpoints WHERE id=?").get(id) as { record: string } | undefined;
    return row ? parseCheckpoint(row.record) : null;
  }
  checkpoints(runId: string): AgentCheckpoint[] {
    return (this.db.prepare("SELECT record FROM agent_checkpoints WHERE run_id=? ORDER BY revision").all(runId) as { record: string }[])
      .map((row) => parseCheckpoint(row.record));
  }
  /** Count for snapshot; keeps the panel bounded on long runs. */
  checkpointCount(runId: string): number { return Number((this.db.prepare("SELECT COUNT(*) AS n FROM agent_checkpoints WHERE run_id=?").get(runId) as { n: number }).n); }
  lastCheckpoint(runId: string): { boundary: CheckpointBoundary; at: number; replaySafety: ReplaySafety } | null {
    const row = this.db.prepare("SELECT record FROM agent_checkpoints WHERE run_id=? ORDER BY revision DESC LIMIT 1").get(runId) as { record: string } | undefined;
    if (!row) return null;
    const cp = parseCheckpoint(row.record);
    return { boundary: cp.boundary, at: cp.at, replaySafety: cp.replaySafety };
  }
  trimCheckpoints(runId: string, keep = MAX_CHECKPOINTS_PER_RUN): void {
    this.db.prepare("DELETE FROM agent_checkpoints WHERE run_id=? AND id NOT IN (SELECT id FROM agent_checkpoints WHERE run_id=? ORDER BY revision DESC LIMIT ?)").run(runId, runId, keep);
  }

  /** ONE recovery claim per agent: the conditional INSERT is the only admission; losers must skip. */
  claimRecovery(agentId: string, claim: string, generation: number, holder: string, now: number, ttlMs = 120_000): { ok: boolean; holder: string | null } {
    const existing = this.db.prepare("SELECT claim,holder,claimed_at FROM agent_recovery_claims WHERE agent_id=?").get(agentId) as { claim: string; holder: string; claimed_at: number } | undefined;
    if (existing && existing.claimed_at > now - ttlMs) return { ok: existing.claim === claim, holder: existing.holder };
    if (existing) this.releaseClaim(agentId, existing.claim);
    const flipped = this.db.prepare("INSERT OR IGNORE INTO agent_recovery_claims(agent_id,claim,generation,holder,claimed_at) VALUES(?,?,?,?,?)").run(agentId, claim, generation, holder, now);
    return flipped.changes === 1 ? { ok: true, holder } : { ok: false, holder: this.claimHolder(agentId) };
  }
  claimHolder(agentId: string): string | null {
    const row = this.db.prepare("SELECT holder,claimed_at FROM agent_recovery_claims WHERE agent_id=?").get(agentId) as { holder: string; claimed_at: number } | undefined;
    if (!row) return null;
    return row.claimed_at < Date.now() - 120_000 ? null : row.holder;
  }
  releaseClaim(agentId: string, claim: string): void { this.db.prepare("DELETE FROM agent_recovery_claims WHERE agent_id=? AND claim=?").run(agentId, claim); }
  releaseAllClaims(): void { this.db.prepare("DELETE FROM agent_recovery_claims").run(); }

  snapshot(): AgentSnapshot {
    const rows = this.db.prepare("SELECT state,record FROM agents ORDER BY created_at").all() as { state: string; record: string }[];
    const agents = rows.map((row) => {
      const profile = JSON.parse(row.record) as AgentProfile;
      const run = this.latestRun(profile.id);
      return {
        id: profile.id, name: profile.name, state: row.state as AgentSnapshot["agents"][number]["state"], missionId: profile.missionId,
        createdAt: profile.createdAt, updatedAt: profile.updatedAt,
        failure: profile.failure?.category ?? null,
        run: run ? { id: run.id, generation: run.generation, state: run.state, startedAt: run.startedAt, endedAt: run.endedAt } : null,
        checkpoints: run ? this.checkpointCount(run.id) : 0,
        lastCheckpoint: run ? this.lastCheckpoint(run.id) : null,
        pausedAt: profile.pausedAt, stoppedAt: profile.stoppedAt,
        note: profile.failure?.detail ?? null,
      };
    });
    return { agents, cursor: this.cursor() };
  }
  cursor(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(sequence),0) n FROM events").get() as { n: number };
    return Number(row.n);
  }
}
export type { AgentCheckpoint, AgentProfile, AgentRun };