import type { HostDatabase } from "./persistence.server.ts";
import { localDayStart, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX } from "./connections.ts";
import { requestCostUsd } from "./intelligence.ts";

/** Bounded transactional cleanup. Current budgets, pending rows and the last Jev request stay in detail. */
export function pruneUsage(
  db: HostDatabase,
  options: { days: number; sessionId: string; now?: number; batch?: number },
) {
  const now = options.now ?? Date.now();
  if (
    !Number.isInteger(options.days) ||
    options.days < RETENTION_DAYS_MIN ||
    options.days > RETENTION_DAYS_MAX
  )
    throw new Error("Retention must be 7–365 days.");
  const cutoff = Math.min(localDayStart(now), now - options.days * 86_400_000);
  const limit = Math.max(1, Math.min(5000, options.batch ?? 500));
  db.db.exec(
    "CREATE TABLE IF NOT EXISTS usage_rollups(day TEXT NOT NULL, source TEXT NOT NULL, key TEXT NOT NULL, requests INTEGER NOT NULL, unknown INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL, PRIMARY KEY(day,source,key))",
  );
  let removed = 0;
  const add = db.db.prepare(
    `INSERT INTO usage_rollups VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(day,source,key) DO UPDATE SET requests=requests+excluded.requests,unknown=unknown+excluded.unknown,input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens,cost_usd=CASE WHEN cost_usd IS NULL OR excluded.cost_usd IS NULL THEN NULL ELSE cost_usd+excluded.cost_usd END`,
  );
  return db.transaction(() => {
    const exists = (name: string) =>
      !!db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (exists("jev_usage")) {
      const rows = db.db
        .prepare(
          "SELECT * FROM jev_usage WHERE at<? AND session_id<>? AND outcome<>'pending' AND id<>(SELECT COALESCE(MAX(id),0) FROM jev_usage WHERE kind IN ('decision','decision_test')) ORDER BY id LIMIT ?",
        )
        .all(cutoff, options.sessionId, limit) as {
        id: number;
        at: number;
        kind: string;
        answered_by: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
      }[];
      for (const row of rows) {
        const billable = ["decision", "decision_test"].includes(row.kind);
        const cost = billable ? requestCostUsd(row.answered_by, row.input_tokens) : 0;
        add.run(
          new Date(row.at).toISOString().slice(0, 10),
          "jev",
          row.kind,
          1,
          billable && cost === null ? 1 : 0,
          row.input_tokens ?? 0,
          row.output_tokens ?? 0,
          cost,
        );
        db.db.prepare("DELETE FROM jev_usage WHERE id=?").run(row.id);
        removed++;
      }
    }
    if (exists("connection_usage")) {
      const rows = db.db
        .prepare(
          "SELECT * FROM connection_usage WHERE at<? AND outcome<>'pending' ORDER BY id LIMIT ?",
        )
        .all(cutoff, limit) as {
        id: number;
        at: number;
        connection_id: string;
        input_tokens: number | null;
        output_tokens: number | null;
        cost_usd: number | null;
      }[];
      for (const row of rows) {
        add.run(
          new Date(row.at).toISOString().slice(0, 10),
          "connection",
          row.connection_id,
          1,
          row.cost_usd === null ? 1 : 0,
          row.input_tokens ?? 0,
          row.output_tokens ?? 0,
          row.cost_usd,
        );
        db.db.prepare("DELETE FROM connection_usage WHERE id=?").run(row.id);
        removed++;
      }
    }
    return { removed, cutoff, bounded: true };
  });
}
