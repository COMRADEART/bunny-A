import type { ProviderId, ProviderLive } from "../orch/types.ts";
import { FEATURES, providerBase } from "./adapters.server.ts";
import type { ProviderAdapter } from "./contracts.ts";
import type { HostDatabase } from "./persistence.server.ts";
import { safeError } from "./failure.server.ts";

export type RegistryTiming = {
  /** Full probes spawn CLIs (version, sign-in, catalogue); run them rarely. */
  fullMs: number;
  /** Detect-only providers are never routed, so they are re-probed even less often. */
  detectOnlyFullMs: number;
  /** Official usage (Codex app-server) refresh. */
  usageMs: number;
};
export const DEFAULT_TIMING: RegistryTiming = { fullMs: 10 * 60_000, detectOnlyFullMs: 30 * 60_000, usageMs: 5 * 60_000 };
const ORDER: ProviderId[] = ["ollama", "codex", "claude", "opencode", "cline", "cursor", "openrouter"];
export const SESSION_USAGE = "Reported by the provider during a Bunny-A session";

/** Fields whose change is a real status change. Usage percentages and probe timestamps are not. */
export function materialSignature(provider: ProviderLive): string {
  const security = provider.securityCompatibility;
  return JSON.stringify([provider.availability, provider.installed, provider.authenticatedState ?? null, provider.version ?? null, provider.executable ?? null, provider.current_model, [...(provider.models ?? [])].sort(), [...(provider.capabilities ?? [])].sort(), security ? [security.policyVersion, security.compatibilityClass, security.reason, security.executable?.executablePath, security.executable?.sha256, security.readIsolationValidated, security.writeIsolationValidated] : null]);
}
export function describeChange(before: ProviderLive | undefined, after: ProviderLive): string {
  if (!before) return `${after.name}: ${after.availability.replaceAll("_", " ")}${after.version ? ` (${after.version})` : ""}`;
  const parts: string[] = [];
  if (before.availability !== after.availability) parts.push(`${before.availability.replaceAll("_", " ")} → ${after.availability.replaceAll("_", " ")}`);
  if ((before.authenticatedState ?? null) !== (after.authenticatedState ?? null)) parts.push(`sign-in ${before.authenticatedState ?? "unknown"} → ${after.authenticatedState ?? "unknown"}`);
  if ((before.version ?? null) !== (after.version ?? null)) parts.push(`version ${before.version ?? "none"} → ${after.version ?? "none"}`);
  if ((before.executable ?? null) !== (after.executable ?? null)) parts.push(`executable ${after.executable ?? "removed"}`);
  const oldSecurity = before.securityCompatibility; const security = after.securityCompatibility;
  if (JSON.stringify([oldSecurity?.policyVersion, oldSecurity?.compatibilityClass, oldSecurity?.reason, oldSecurity?.executable?.sha256]) !== JSON.stringify([security?.policyVersion, security?.compatibilityClass, security?.reason, security?.executable?.sha256])) parts.push(`Mission compatibility ${security?.compatibilityClass ?? "check required"}${security ? `: ${security.reason}` : ""}`);
  if (before.current_model !== after.current_model) parts.push(`model ${before.current_model ?? "none"} → ${after.current_model ?? "none"}`);
  if (!parts.length) parts.push("models or capabilities changed");
  return `${after.name}: ${parts.join(", ")}`;
}

/**
 * Host-owned provider state. UIs read it from snapshots and never infer status themselves.
 * The last known state is persisted so a Host restart neither forgets it nor re-announces it.
 */
export class ProviderRegistry {
  adapters: ProviderAdapter[];
  db: HostDatabase;
  timing: RegistryTiming;
  providers = new Map<ProviderId, ProviderLive>();
  fullAt = new Map<ProviderId, number>();
  usageAt = new Map<ProviderId, number>();
  refreshing: Promise<string[]> | null = null;
  limitedUntil = new Map<ProviderId, number>();
  constructor(adapters: ProviderAdapter[], db: HostDatabase, timing: RegistryTiming = DEFAULT_TIMING) {
    this.adapters = adapters; this.db = db; this.timing = timing;
    db.db.exec("CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY, record TEXT NOT NULL, probed_at INTEGER)");
    for (const row of db.db.prepare("SELECT record FROM providers").all() as { record: string }[]) {
      try { const saved = JSON.parse(row.record) as ProviderLive; if (adapters.some((adapter) => adapter.id === saved.id)) this.providers.set(saved.id, saved); } catch { /* Corrupt rows are re-probed. */ }
    }
  }
  list(): ProviderLive[] {
    return [...this.providers.values()].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  }
  get(id: ProviderId) { return this.providers.get(id); }
  /** True once this Host instance has probed the provider itself (persisted state alone never makes it routable). */
  probedThisRun(id: ProviderId) { return this.fullAt.has(id); }
  /**
   * Refreshes providers. `force` re-probes everything (user asked); otherwise full probes only run when
   * their interval elapsed or a cheap health check says the executable changed. Returns the material changes.
   */
  refresh(options: { force?: boolean; now?: number } = {}): Promise<string[]> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.run(options).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async run({ force = false, now = Date.now() }: { force?: boolean; now?: number }): Promise<string[]> {
    const changes: string[] = [];
    await Promise.all(this.adapters.map(async (adapter) => {
      const previous = this.providers.get(adapter.id);
      const interval = ["opencode", "cline", "cursor"].includes(adapter.id) ? this.timing.detectOnlyFullMs : this.timing.fullMs;
      const due = force || !previous || !this.fullAt.has(adapter.id) || now - this.fullAt.get(adapter.id)! >= interval;
      let next: ProviderLive | null = null;
      try {
        if (!due && adapter.health) next = await adapter.health(previous!);
        if (!next) { next = await adapter.detect(); this.fullAt.set(adapter.id, now); if (next.usageObservedAt) this.usageAt.set(adapter.id, now); }
        else if (adapter.usage && now - (this.usageAt.get(adapter.id) ?? 0) >= this.timing.usageMs && next.authenticated) {
          // T2: a usage read that yields nothing is recorded as a failed attempt on the live record;
          // previous windows survive untouched, so the usage service can show them as stale rather than current.
          const attempt = await adapter.usage().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
          this.usageAt.set(adapter.id, now);
          next = attempt.ok && attempt.value ? applyUsage({ ...next }, attempt.value) : this.markUsageFailure({ ...next }, now, attempt.ok ? null : attempt.error);
        }
        next.features = adapter.capabilities?.() ?? next.features ?? FEATURES[adapter.id];
      } catch (error) {
        next = { ...providerBase(adapter.id), availability: "unknown", detail: `Discovery failed: ${safeError(error).message.split("\n")[0]}`, probedAt: now };
        this.fullAt.set(adapter.id, now);
      }
      // Usage that only arrives inside sessions (Claude Code) survives re-probes, keeping its report time.
      if (!adapter.usage && !next.usageWindows?.length && previous?.usageWindows?.length && previous.usage_note === SESSION_USAGE) next = applyUsage(next, { windows: previous.usageWindows, observedAt: previous.usageObservedAt ?? now }, SESSION_USAGE);
      next = this.withLimit(next, now);
      if (!previous || materialSignature(previous) !== materialSignature(next)) changes.push(describeChange(previous, next));
      this.providers.set(adapter.id, next);
      this.db.db.prepare("INSERT INTO providers(id,record,probed_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record, probed_at=excluded.probed_at").run(adapter.id, JSON.stringify(next), next.probedAt ?? now);
    }));
    return changes;
  }
  /** Re-reads official usage now (e.g. right after a Codex task), without a full probe. */
  async refreshUsage(id: ProviderId): Promise<void> {
    const adapter = this.adapters.find((candidate) => candidate.id === id);
    const current = this.providers.get(id);
    if (!adapter?.usage || !current?.authenticated) return;
    const attempt = await adapter.usage().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    this.usageAt.set(id, Date.now());
    const next = attempt.ok && attempt.value ? applyUsage({ ...current }, attempt.value) : this.markUsageFailure({ ...current }, Date.now(), attempt.ok ? null : attempt.error);
    this.providers.set(id, next);
    this.db.db.prepare("UPDATE providers SET record=? WHERE id=?").run(JSON.stringify(next), id);
  }
  /** Marks a usage read that produced no data. Previous windows are never erased or overwritten. */
  private markUsageFailure(live: ProviderLive, now: number, error: unknown): ProviderLive {
    return { ...live, usage_failed_at: now, ...(error ? { usage_error: safeError(error).message.split("\n")[0] } : {}) };
  }
  /** Usage windows a running session reported itself (Claude Code rate-limit events), with the provider's verdict. */
  recordSessionUsage(id: ProviderId, windows: ProviderLive["usageWindows"], status?: string) {
    const current = this.providers.get(id);
    if (!current || !windows?.length) return;
    const merged = [...(current.usageWindows ?? []).filter((window) => !windows.some((fresh) => fresh.kind === window.kind)), ...windows];
    const next = applyUsage({ ...current }, { windows: merged, observedAt: Date.now() }, SESSION_USAGE);
    // A refusal from the provider itself holds the provider out of routing until the window resets.
    if (status === "rejected") this.limitedUntil.set(id, Math.max(...windows.map((window) => window.resetsAt ?? 0), Date.now() + 60_000));
    else if (status) this.limitedUntil.delete(id);
    this.providers.set(id, this.withLimit(next));
    this.db.db.prepare("UPDATE providers SET record=? WHERE id=?").run(JSON.stringify(this.providers.get(id)), id);
  }
  /** Applies a provider-reported limit refusal that has not reset yet. */
  withLimit(live: ProviderLive, now = Date.now()): ProviderLive {
    const until = this.limitedUntil.get(live.id);
    if (!until || until <= now || !["ready", "busy"].includes(live.availability)) return live;
    return { ...live, availability: "rate_limited", detail: `${live.name} reported its usage limit as reached; it resets ${new Date(until).toISOString()}.` };
  }
}

export function applyUsage(live: ProviderLive, usage: { windows: NonNullable<ProviderLive["usageWindows"]>; observedAt: number } | null, note?: string): ProviderLive {
  if (!usage) return live;
  live.usageWindows = usage.windows; live.usageObservedAt = usage.observedAt;
  // Fresh provider-reported data reasserts itself: a previous failed attempt no longer applies.
  live.usage_failed_at = null; live.usage_error = null;
  const kinds = new Set(usage.windows.map((window) => window.kind));
  live.usageCapabilities = { ...(live.usageCapabilities ?? { tokenUsage: false, activeJobs: true, source: "provider" }), shortWindow: kinds.has("short"), weekly: kinds.has("weekly"), resetTime: usage.windows.some((window) => window.resetsAt !== null) } as NonNullable<ProviderLive["usageCapabilities"]>;
  live.usage_note = usage.windows.length ? note ?? live.usage_note : "Usage unavailable";
  return live;
}
