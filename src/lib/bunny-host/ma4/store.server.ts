import type { HostDatabase } from "../persistence.server.ts";
import { createHash } from "node:crypto";
import { DEFAULT_CONFIGURATION, ModelMetadataSchema, loadConfiguration, type Configuration, type ModelMetadata } from "./registry.ts";
import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import { ApprovalSchema, type IssuedApproval, type ReliabilityCategory, type ReliabilityEvidence } from "./hybrid.ts";

/** Additive host-owned tables. No prompts, outputs, credentials or benchmark answers. */
export class IntelligenceStore {
  db: HostDatabase;
  constructor(db: HostDatabase) {
    this.db = db;
    db.db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ma4_models(id TEXT PRIMARY KEY,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ma4_usage(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,model TEXT NOT NULL,tokens INTEGER NOT NULL,reserved_usd REAL NOT NULL,input_tokens INTEGER,output_tokens INTEGER);
      CREATE INDEX IF NOT EXISTS ma4_usage_at ON ma4_usage(at);
      CREATE TABLE IF NOT EXISTS ma4_evaluations(id INTEGER PRIMARY KEY,model TEXT NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ma4_approvals(provider TEXT NOT NULL,model TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(provider,model));
      CREATE TABLE IF NOT EXISTS ma4_reliability(provider TEXT NOT NULL,model TEXT NOT NULL,category TEXT NOT NULL,passes INTEGER NOT NULL,samples INTEGER NOT NULL,source TEXT NOT NULL,PRIMARY KEY(provider,model,category,source));`);
  }
  configuration(): Configuration {
    try {
      const row = this.db.db.prepare("SELECT value FROM settings WHERE key='ma4_config_v1'").get() as { value: string } | undefined;
      return row ? loadConfiguration(JSON.parse(row.value)) : structuredClone(DEFAULT_CONFIGURATION);
    } catch { return structuredClone(DEFAULT_CONFIGURATION); }
  }
  configure(raw: unknown) {
    const configuration = loadConfiguration(raw);
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES('ma4_config_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(configuration));
    return configuration;
  }
  models(now = Date.now()): ModelMetadata[] {
    const config = this.configuration();
    return (this.db.db.prepare("SELECT record FROM ma4_models ORDER BY id").all() as { record: string }[]).flatMap(row => {
      try {
        const m = ModelMetadataSchema.parse(JSON.parse(row.record));
        const age = now - Date.parse(m.verifiedAt ?? "");
        return [{ ...m, enabled: config.enabled && config.models.includes(m.id) && Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60_000 }];
      } catch { return []; }
    });
  }
  fingerprint() { return createHash("sha256").update(JSON.stringify(this.configuration())).digest("hex"); }
  failureStreak(): number {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key='ma4_failure_streak_v1'").get() as { value: string } | undefined;
    const n = Number(row?.value ?? 0); return Number.isInteger(n) && n >= 0 ? Math.min(n, 6) : 6;
  }
  recordFailure(success = false) {
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES('ma4_failure_streak_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(success ? 0 : Math.min(6, this.failureStreak() + 1)));
  }
  replaceModels(models: ModelMetadata[]) {
    const admitted = models.map(m => ModelMetadataSchema.parse(m));
    this.db.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.db.prepare("DELETE FROM ma4_models").run();
      for (const m of admitted) this.db.db.prepare("INSERT INTO ma4_models VALUES(?,?)").run(m.id, JSON.stringify({ ...m, enabled: false }));
      this.db.db.exec("COMMIT");
    } catch (e) { this.db.db.exec("ROLLBACK"); throw e; }
  }
  cooldownUntil(): number {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key='ma4_cooldown_v1'").get() as { value: string } | undefined;
    const n = Number(row?.value ?? 0); return Number.isFinite(n) && n >= 0 ? n : Number.MAX_SAFE_INTEGER;
  }
  cooldown(until: number) {
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES('ma4_cooldown_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Math.max(until, this.cooldownUntil())));
  }
  /** Sync transaction reserves ALL attempts, including failures and concurrent requests. Unknown billing stays reserved. */
  reserve(model: string, tokens: number, usd: number, now = Date.now()): number {
    const c = this.configuration();
    if (!c.enabled || !c.models.includes(model) || now < this.cooldownUntil()) throw new Error("Provider disabled or rate_limited; owner review/cooldown required.");
    if (!Number.isSafeInteger(tokens) || tokens <= 0 || !Number.isFinite(usd) || usd < 0 || usd > c.maxUsdPerRequest) throw new Error("Request budget exceeded.");
    this.db.db.exec("BEGIN IMMEDIATE");
    try {
      const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
      const minute = this.db.db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(tokens),0) AS tokens FROM ma4_usage WHERE at>?").get(now - 60_000) as { n: number; tokens: number };
      const daily = this.db.db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(reserved_usd),0) AS usd FROM ma4_usage WHERE at>=?").get(day.getTime()) as { n: number; usd: number };
      if (minute.n >= c.requestsPerMinute || minute.tokens + tokens > c.tokensPerMinute || daily.n >= c.requestsPerDay || daily.usd + usd > c.maxUsdPerDay) throw new Error("rate_limited: provider request/token/cost budget exhausted.");
      const result = this.db.db.prepare("INSERT INTO ma4_usage(at,model,tokens,reserved_usd) VALUES(?,?,?,?)").run(now, model, tokens, usd);
      this.db.db.exec("COMMIT"); return Number(result.lastInsertRowid);
    } catch (e) { this.db.db.exec("ROLLBACK"); throw e; }
  }
  recordUsage(id: number, input: number | null, output: number | null) {
    this.db.db.prepare("UPDATE ma4_usage SET input_tokens=?,output_tokens=? WHERE id=?").run(input, output, id);
  }
  /** MA4-S1R2 B4: only the trusted workstation actor issues approvals; the Host stamps issuer and time. */
  issueApproval(raw: unknown, actor: unknown, now = Date.now()): IssuedApproval {
    if (!isTrustedLocalActor(actor)) throw new Error("Only the workstation owner can issue external model approvals.");
    const approval = ApprovalSchema.parse(raw);
    if (approval.approval_status === "approved" && (!approval.expiry || Date.parse(approval.expiry) <= now || !approval.approved_purpose)) throw new Error("An approval needs a purpose and a future expiry.");
    const issued: IssuedApproval = { ...approval, issued_by: "workstation", issued_at: new Date(now).toISOString() };
    this.db.db.prepare("INSERT INTO ma4_approvals(provider,model,record) VALUES(?,?,?) ON CONFLICT(provider,model) DO UPDATE SET record=excluded.record").run(issued.provider_id, issued.model_id, JSON.stringify(issued));
    return issued;
  }
  approvals(): IssuedApproval[] {
    return (this.db.db.prepare("SELECT record FROM ma4_approvals").all() as { record: string }[]).flatMap(row => {
      try { const r = JSON.parse(row.record); const a = ApprovalSchema.parse({ provider_id: r.provider_id, model_id: r.model_id, approval_status: r.approval_status, approved_purpose: r.approved_purpose, data_categories: r.data_categories, spending_limit_usd: r.spending_limit_usd, expiry: r.expiry });
        return r.issued_by === "workstation" && typeof r.issued_at === "string" ? [{ ...a, issued_by: "workstation" as const, issued_at: r.issued_at }] : []; } catch { return []; }
    });
  }
  /** Reserved spend since the approval was issued (unknown billing stays reserved). */
  spentUsd(model: string, sinceIso: string): number {
    const row = this.db.db.prepare("SELECT COALESCE(SUM(reserved_usd),0) AS usd FROM ma4_usage WHERE model=? AND at>=?").get(model, Date.parse(sinceIso) || 0) as { usd: number };
    return row.usd;
  }
  /** Replaces one source's measured evidence (e.g. a benchmark suite version); other sources are kept. */
  importReliability(rows: ReliabilityEvidence[], source: string) {
    this.db.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.db.prepare("DELETE FROM ma4_reliability WHERE source=?").run(source);
      for (const r of rows) {
        if (!Number.isInteger(r.passes) || !Number.isInteger(r.samples) || r.passes < 0 || r.samples < 1 || r.passes > r.samples) throw new Error("Invalid reliability evidence.");
        this.db.db.prepare("INSERT INTO ma4_reliability VALUES(?,?,?,?,?,?)").run(r.provider, r.model, r.category, r.passes, r.samples, source);
      }
      this.db.db.exec("COMMIT");
    } catch (e) { this.db.db.exec("ROLLBACK"); throw e; }
  }
  /** H2: a verified runtime outcome (pass or fail) adds one sample under the "runtime" source. */
  recordOutcome(provider: string, model: string, category: ReliabilityCategory, passed: boolean) {
    this.db.db.prepare("INSERT INTO ma4_reliability VALUES(?,?,?,?,1,'runtime') ON CONFLICT(provider,model,category,source) DO UPDATE SET passes=passes+excluded.passes,samples=samples+1").run(provider, model, category, passed ? 1 : 0);
  }
  reliability(provider: string, model: string | null, category: ReliabilityCategory): { passes: number; samples: number } | null {
    if (!model) return null;
    const row = this.db.db.prepare("SELECT COALESCE(SUM(passes),0) AS passes,COALESCE(SUM(samples),0) AS samples FROM ma4_reliability WHERE provider=? AND model=? AND category=?").get(provider, model, category) as { passes: number; samples: number };
    return row.samples > 0 ? { passes: row.passes, samples: row.samples } : null;
  }
}
