import type { HostDatabase } from "./persistence.server.ts";
import type { CatalogEntry } from "./connections.ts";
import type { ProviderId } from "../orch/types.ts";
import { firstLine, probe, stripAnsi } from "./adapters.server.ts";
import { locate, locateAny, systemContext } from "./discovery.server.ts";
import { harnessExecutables, type HarnessId, type HarnessProbe, type HarnessTest } from "./harnesses.ts";

/** Runs the harness's own `--version` (contained, scrubbed environment, 15 s). It never sends a prompt. */
export async function probeHarness(entry: CatalogEntry, configured: Partial<Record<ProviderId, string>>): Promise<HarnessProbe> {
  const ctx = systemContext(configured);
  const names = harnessExecutables(entry.id);
  const launch = entry.providerId ? locate(ctx, entry.providerId).launch : locateAny(ctx, names);
  if (!launch) return { path: null, version: null, runs: null, detail: `No ${names.join(" or ")} was found on this PC.` };
  const result = await probe(launch, ["--version"], 15_000);
  const line = firstLine(stripAnsi(`${result.stdout}\n${result.stderr}`));
  const runs = result.code === 0;
  return {
    path: launch.path,
    version: runs ? line.slice(0, 80) || null : null,
    runs,
    detail: runs ? `Reported "${line.slice(0, 80)}".` : result.error ?? (result.timedOut ? "It did not answer within 15 seconds." : `It exited with code ${result.code}.`),
  };
}

/** The latest capability test per harness. Additive table; no existing row changes. */
export class HarnessStore {
  private db: HostDatabase;
  constructor(db: HostDatabase) {
    this.db = db;
    db.db.exec(`CREATE TABLE IF NOT EXISTS harness_tests(harness TEXT PRIMARY KEY,record TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS harness_paused(harness TEXT NOT NULL,route TEXT NOT NULL,PRIMARY KEY(harness,route));
      INSERT OR IGNORE INTO migrations(key) VALUES('bunny-a.harnesses.v1');`);
  }
  /** Routes that harness.disable paused, so harness.enable resumes those and never one the owner paused separately. */
  markPaused(harness: HarnessId, route: string) {
    this.db.db.prepare("INSERT OR IGNORE INTO harness_paused VALUES(?,?)").run(harness, route);
  }
  pausedRoutes(harness: HarnessId): string[] {
    return (this.db.db.prepare("SELECT route FROM harness_paused WHERE harness=?").all(harness) as { route: string }[]).map((row) => row.route);
  }
  clearPaused(harness: HarnessId) {
    this.db.db.prepare("DELETE FROM harness_paused WHERE harness=?").run(harness);
  }
  save(test: HarnessTest) {
    this.db.db
      .prepare("INSERT INTO harness_tests VALUES(?,?,?) ON CONFLICT(harness) DO UPDATE SET record=excluded.record,at=excluded.at")
      .run(test.harness, JSON.stringify(test), test.at);
    return test;
  }
  tests(): HarnessTest[] {
    return (this.db.db.prepare("SELECT record FROM harness_tests").all() as { record: string }[]).flatMap((row) => {
      try {
        return [JSON.parse(row.record) as HarnessTest];
      } catch {
        return [];
      }
    });
  }
  /** Tasks the Host recorded as completed per connection (T13.2 usage ledger); the only inference evidence used. */
  completed(): Record<string, number> {
    const rows = this.db.db
      .prepare("SELECT connection_id AS id,COUNT(*) AS n FROM connection_usage WHERE outcome='completed' GROUP BY connection_id")
      .all() as { id: string; n: number }[];
    return Object.fromEntries(rows.map((row) => [row.id, row.n]));
  }
  remove(harness: HarnessId) {
    this.db.db.prepare("DELETE FROM harness_tests WHERE harness=?").run(harness);
  }
}
