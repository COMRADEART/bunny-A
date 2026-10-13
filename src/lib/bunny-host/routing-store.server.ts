/**
 * M-A-3 Gate T3 §18/§35: safe persistence for routing records.
 *
 * Additive tables created by their owner (same recipe as `model_capabilities`):
 * idempotent `CREATE TABLE IF NOT EXISTS`, no `user_version` change, and only
 * SAFE artifacts — the RoutingDecisionRecord (no chats, no raw transcripts, no
 * credentials, no hidden model reasoning) plus one bounded attempt row per
 * recovery step. Stored profiles are Bunny's own routing policy metadata (§7):
 * never provider-reported capability facts.
 */
import type { ProviderId } from "../orch/types.ts";
import type { RoutingDecisionRecord, RoutingFailureTaxonomy } from "./routing.server.ts";
import type { ModelRoutingProfile, RoutingProfileProvenance } from "./routing.server.ts";
import { ROUTING_POLICY_VERSION } from "./routing.server.ts";
import type { HostDatabase } from "./persistence.server.ts";

export type StoredAttempt = {
  id: string;
  decisionId: string;
  taskId: string;
  attemptIndex: number;
  provider: ProviderId;
  model: string | null;
  effort: string | null;
  taxonomy: RoutingFailureTaxonomy;
  detail: string;
  createdAt: number;
};

export class RoutingDecisionStore {
  private readonly db: HostDatabase;
  constructor(db: HostDatabase) {
    this.db = db;
    // Additive tables, created by their owner like the providers table. Idempotent;
    // never touches PRAGMA user_version; the installed-state marker reconciles at boot.
    this.db.db.exec("CREATE TABLE IF NOT EXISTS routing_decisions(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, mission_id TEXT, created_at INTEGER NOT NULL, policy_version TEXT NOT NULL, decision TEXT NOT NULL)");
    this.db.db.exec("CREATE INDEX IF NOT EXISTS idx_routing_decisions_task ON routing_decisions(task_id)");
    this.db.db.exec("CREATE TABLE IF NOT EXISTS routing_attempts(id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt_index INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT, effort TEXT, taxonomy TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)");
    this.db.db.exec("CREATE INDEX IF NOT EXISTS idx_routing_attempts_task ON routing_attempts(task_id)");
    this.db.db.exec("CREATE TABLE IF NOT EXISTS model_routing_profiles(provider TEXT NOT NULL, model TEXT NOT NULL, provenance TEXT NOT NULL, profile TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(provider, model))");
  }

  saveDecision(record: RoutingDecisionRecord): void {
    this.db.db.prepare("INSERT OR REPLACE INTO routing_decisions(id, task_id, mission_id, created_at, policy_version, decision) VALUES(?,?,?,?,?,?)")
      .run(record.routing_decision_id, record.task_id, record.mission_id, record.created_at, record.policy_version, JSON.stringify(record));
  }

  decision(id: string): RoutingDecisionRecord | null {
    const row = this.db.db.prepare("SELECT decision FROM routing_decisions WHERE id=?").get(id) as { decision: string } | undefined;
    return this.parse(row?.decision ?? null);
  }

  latestForTask(taskId: string): RoutingDecisionRecord | null {
    const row = this.db.db.prepare("SELECT decision FROM routing_decisions WHERE task_id=? ORDER BY created_at DESC, id DESC LIMIT 1").get(taskId) as { decision: string } | undefined;
    return this.parse(row?.decision ?? null);
  }

  private parse(text: string | null): RoutingDecisionRecord | null {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as RoutingDecisionRecord;
      return parsed && typeof parsed === "object" && parsed.routing_decision_id && parsed.policy_version === ROUTING_POLICY_VERSION ? parsed : null;
    } catch { return null; } // A corrupt row is never fabricated into a decision.
  }

  saveAttempt(attempt: StoredAttempt): void {
    this.db.db.prepare("INSERT OR REPLACE INTO routing_attempts(id, decision_id, task_id, attempt_index, provider, model, effort, taxonomy, detail, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(attempt.id, attempt.decisionId, attempt.taskId, attempt.attemptIndex, attempt.provider, attempt.model, attempt.effort, attempt.taxonomy, attempt.detail, attempt.createdAt);
  }

  attempts(taskId: string): StoredAttempt[] {
    const rows = this.db.db.prepare("SELECT id, decision_id, task_id, attempt_index, provider, model, effort, taxonomy, detail, created_at FROM routing_attempts WHERE task_id=? ORDER BY attempt_index ASC").all(taskId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id), decisionId: String(row.decision_id), taskId: String(row.task_id), attemptIndex: Number(row.attempt_index),
      provider: row.provider as ProviderId, model: (row.model as string) ?? null, effort: (row.effort as string) ?? null,
      taxonomy: row.taxonomy as RoutingFailureTaxonomy, detail: (row.detail as string) ?? "", createdAt: Number(row.created_at),
    }));
  }

  /** Persists ONE Bunny routing-profile row (§7 policy metadata, not provider facts). */
  saveProfile(profile: ModelRoutingProfile, updatedAt: number): void {
    if (!profile.model_id) return; // PROVIDER_DEFAULT profiles are policy constants, not per-model rows.
    this.db.db.prepare("INSERT OR REPLACE INTO model_routing_profiles(provider, model, provenance, profile, updated_at) VALUES(?,?,?,?,?)")
      .run(profile.provider_id, profile.model_id, profile.provenance, JSON.stringify(profile), updatedAt);
  }

  profile(provider: ProviderId, model: string): { provenance: RoutingProfileProvenance; profile: ModelRoutingProfile; updatedAt: number } | null {
    const row = this.db.db.prepare("SELECT provenance, profile, updated_at FROM model_routing_profiles WHERE provider=? AND model=?").get(provider, model) as { provenance: string; profile: string; updated_at: number } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.profile) as ModelRoutingProfile;
      if (!parsed || typeof parsed !== "object" || parsed.provider_id !== provider) return null;
      return { provenance: row.provenance as RoutingProfileProvenance, profile: parsed, updatedAt: Number(row.updated_at) };
    } catch { return null; } // Corrupt rows fall back to policy defaults.
  }
}