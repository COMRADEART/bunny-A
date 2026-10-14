import type { HostDatabase } from "./persistence.server.ts";
import type { OrchTask, TokenUsage } from "../orch/types.ts";
import { knownCost, type LedgerRow } from "./session-ledger.ts";
import type { BillingProvenance } from "./connections.ts";

const MIGRATION = "bunny-a.session-ledger.v1";

/** Additive table beside T13.2's `connection_usage`; keyed by its reservation id so the two never disagree on count. */
export class SessionLedger {
  private readonly db: HostDatabase;
  private readonly sessionId: string;
  constructor(db: HostDatabase, sessionId: string) {
    this.db = db;
    this.sessionId = sessionId;
    db.db.exec(`CREATE TABLE IF NOT EXISTS session_ledger(
      usage_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, at INTEGER NOT NULL, settled_at INTEGER,
      connection_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, task_id TEXT NOT NULL, mission_id TEXT, project_id TEXT,
      provider_session TEXT, outcome TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
      estimated_cost_usd REAL, observed_cost_usd REAL, cost_source TEXT NOT NULL)`);
    db.db.exec("CREATE INDEX IF NOT EXISTS session_ledger_session ON session_ledger(session_id, at)");
    db.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES (?)").run(MIGRATION);
    db.db.prepare("UPDATE session_ledger SET outcome='unknown_restart', settled_at=? WHERE outcome='pending'").run(Date.now());
    db.db.prepare("DELETE FROM session_ledger WHERE session_id<>? AND at<?").run(sessionId, Date.now() - 30 * 86_400_000);
  }
  reserve(usageId: number, connectionId: string, billing: BillingProvenance, task: OrchTask) {
    const cost = knownCost(billing);
    this.db.db
      .prepare(`INSERT OR IGNORE INTO session_ledger(usage_id, session_id, at, connection_id, provider, model, task_id, mission_id, project_id,
        provider_session, outcome, estimated_cost_usd, observed_cost_usd, cost_source) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?,?,?)`)
      .run(usageId, this.sessionId, Date.now(), connectionId, task.provider, task.model === "auto" ? null : task.model, task.id,
        task.mission?.missionId ?? null, task.projectId, task.sessionId ?? null, cost.estimated, cost.observed, cost.source);
  }
  /** `usage` is what the provider reported for this attempt only; null leaves the token counts UNKNOWN. */
  settle(usageId: number, ok: boolean, task: OrchTask, usage: TokenUsage | null) {
    this.db.db
      .prepare(`UPDATE session_ledger SET outcome=?, settled_at=?, model=COALESCE(?, model), provider_session=COALESCE(?, provider_session),
        input_tokens=?, output_tokens=? WHERE usage_id=? AND outcome='pending'`)
      .run(ok ? "completed" : "failed", Date.now(), task.model === "auto" ? null : task.model, task.sessionId ?? null,
        usage?.inputTokens ?? null, usage?.outputTokens ?? null, usageId);
  }
  rows(sessionId = this.sessionId): LedgerRow[] {
    return (this.db.db.prepare("SELECT * FROM session_ledger WHERE session_id=? ORDER BY at, usage_id").all(sessionId) as Record<string, unknown>[]).map((row) => ({
      usageId: Number(row.usage_id),
      sessionId: String(row.session_id),
      at: Number(row.at),
      settledAt: row.settled_at == null ? null : Number(row.settled_at),
      connectionId: String(row.connection_id),
      provider: row.provider as LedgerRow["provider"],
      model: (row.model as string | null) ?? null,
      taskId: String(row.task_id),
      missionId: (row.mission_id as string | null) ?? null,
      projectId: (row.project_id as string | null) ?? null,
      providerSession: (row.provider_session as string | null) ?? null,
      outcome: row.outcome as LedgerRow["outcome"],
      inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
      outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
      estimatedCostUsd: row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
      observedCostUsd: row.observed_cost_usd == null ? null : Number(row.observed_cost_usd),
      costSource: row.cost_source as LedgerRow["costSource"],
    }));
  }
  get session() {
    return this.sessionId;
  }
}
