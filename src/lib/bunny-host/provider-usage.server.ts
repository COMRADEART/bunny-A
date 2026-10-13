/**
 * M-A-3 T2: normalized provider usage truth.
 *
 * The service DERIVES usage state from what the Host has actually observed —
 * it probes nothing and owns no persistence, scheduler, or event store. All
 * probing stays where it already lives (ProviderRegistry + adapters, driven by
 * the single supervised discovery loop); this service reads that state, reads
 * Bunny's own task counters, timestamps observations, and classifies freshness.
 *
 * Every value carries a proven source. A value the provider did not report is
 * null — UNKNOWN is never converted to 0%, 100%, unlimited or exhausted.
 * "UNKNOWN is a valid product state. A polished lie is a bug."
 */
import { createHash } from "node:crypto";
import type { ObservedUsage, ProviderId, ProviderLive, UsageWindow } from "../orch/types.ts";
import { safeError } from "./failure.server.ts";

/** Enforced usage states (M-A-3 T2 §4). LOWERCASE; the UI maps them to labels. */
export type UsageState = "current" | "stale" | "estimated" | "unknown" | "unavailable";
/** Where a usage value came from (T2 §5). Lowercase in snapshots; brief names are uppercase. */
export type UsageSourceKind = "provider_native" | "local_observation" | "estimate";
/** How much the value can be trusted. */
export type UsageConfidence = "exact" | "provider_reported" | "estimated" | "unknown";
/** Denomination of absolute values; null when only a percentage was reported. */
export type UsageUnit = "tokens" | "requests" | "compute" | "credits" | "provider_defined";

/**
 * One normalized usage window (T2 §5). Absolute values are null unless the
 * provider itself reported them; deriving a percent's complement or a limit
 * from marketing pages, context windows, or one task's token counts is forbidden.
 * percentOnly sources (the only real ones today) carry unit null and values null.
 */
export type ProviderUsageWindow = {
  label: string;
  /** short | weekly | other — the provider's own window grouping. */
  kind: string;
  limitValue: number | null;
  usedValue: number | null;
  remainingValue: number | null;
  unit: UsageUnit | null;
  /** Provider-reported utilization 0–100; null = UNKNOWN. A real reported 0 is legal data, not a default. */
  percentUsed: number | null;
  resetAt: number | null;
  resetDescription: string | null;
  sourceKind: UsageSourceKind;
  /** Safe semantic identifier of the reporting surface, e.g. "codex app-server account/rateLimits/read". */
  sourceSurface: string;
  confidence: UsageConfidence;
  observedAt: number;
  /** sha256 of the provider-supplied window values as received — provenance without raw bodies. */
  rawValueHash: string;
};

/** The per-provider normalized observation (T2 §5 contract, camelCase per codebase style). */
export type ProviderUsageSnapshot = {
  providerId: ProviderId;
  name: string;
  /** Opaque-safe scope class ("signed-in Codex account", "local workstation"); never an account identifier. */
  accountScope: string | null;
  status: UsageState;
  /** Newest real provider-reported observation of these windows; null when none exists. */
  observedAt: number | null;
  /** Last time the service examined this provider, regardless of outcome. */
  refreshedAt: number;
  windows: ProviderUsageWindow[];
  /** State-annotated summary carrying no fabricated numbers. */
  note: string;
  /** What Bunny-A itself can prove (its own task counters); never presented as provider quota. */
  localTelemetry: { sourceKind: "local_observation"; sourceSurface: string } & ObservedUsage;
  /** First line of the still-applicable failed usage-read attempt, or null. */
  error: string | null;
};

export type ProviderUsageServiceSnapshot = { version: 1; refreshedAt: number; providers: ProviderUsageSnapshot[] };

/** Safe per-provider event about a usage change (T2 §12). Details are semantic, never raw bodies. */
export type UsageEvent = { type: string; providerId: ProviderId; detail: string };

/** A window whose values Bunny computed from locally observable information. Test/estimator-registered only. */
export type UsageEstimator = (input: UsageEstimatorInput) => ProviderUsageWindow[];
export type UsageEstimatorInput = { live: ProviderLive; observed: ObservedUsage; now: number };

/**
 * Per-provider freshness policy (T2 §15): how long a provider-reported usage
 * observation may stay CURRENT. Justified from the probe cadences in
 * RegistryTiming/DEFAULT_TIMING (codex reads every 5 min while healthy; Claude
 * reports only during sessions, so a longer horizon tolerates the gap between
 * them; Ollama local telemetry is refreshed every discovery tick).
 */
export const USAGE_FRESHNESS_MS: Partial<Record<ProviderId, number>> = {
  codex: 10 * 60_000,
  claude: 30 * 60_000,
  ollama: 5 * 60_000,
};

const USAGE_PROVIDERS: ProviderId[] = ["ollama", "codex", "claude", "opencode", "cline", "cursor"];
const display = (id: ProviderId): string => (id === "codex" ? "Codex" : id === "claude" ? "Claude Code" : id === "ollama" ? "Ollama" : id === "opencode" ? "OpenCode" : id === "cline" ? "Cline" : "Cursor Agent");
const ACCOUNT_SCOPES: Partial<Record<ProviderId, string>> = {
  codex: "signed-in Codex account",
  claude: "signed-in Claude Code account",
  ollama: "local workstation",
};
const TELEMETRY_SURFACE = "bunny-a task outcomes journal (Bunny's own counters, not provider quota)";
/** The usageCapabilities.source values that mean a real external reporting surface exists. */
const NO_SURFACE = new Set(["none", "Local model: no quota"]);

const relative = (span: number): string => {
  if (!Number.isFinite(span) || span < 0) return "recently";
  const seconds = Math.floor(span / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
};

/** sha256 of exactly the provider-supplied window values (provenance without raw bodies). */
export function rawValueHash(window: UsageWindow): string {
  return createHash("sha256").update(JSON.stringify([window.label, window.usedPercent ?? null, window.resetsAt ?? null, window.kind ?? null, window.windowMinutes ?? null])).digest("hex");
}

/** Normalizes a provider-reported UsageWindow. Nulls stay null; nothing is computed into existence. */
export function normalizeUsageWindow(window: UsageWindow, options: { sourceKind: UsageSourceKind; sourceSurface: string; confidence: UsageConfidence; observedAt: number }): ProviderUsageWindow {
  return {
    label: window.label,
    kind: window.kind ?? (window.label === "Weekly" ? "weekly" : /hour/i.test(window.label) ? "short" : "other"),
    limitValue: null, usedValue: null, remainingValue: null, unit: null, // Provider-reported percentage only; absolutes are invented, so UNKNOWN.
    percentUsed: typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent) ? window.usedPercent : null,
    // Fail closed (§18F): a reset time that no longer lies ahead of its own observation is not a
    // verified future fact — dropped to UNKNOWN rather than shown as an already-expired reset.
    resetAt: typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt) && window.resetsAt > options.observedAt ? window.resetsAt : null,
    resetDescription: null,
    sourceKind: options.sourceKind, sourceSurface: options.sourceSurface, confidence: options.confidence,
    observedAt: options.observedAt, rawValueHash: rawValueHash(window),
  };
}

export type UsageDeriveInput = { id: ProviderId; live: ProviderLive; probed: boolean; observed: ObservedUsage; now: number };

/**
 * Derives one provider's usage snapshot from observed Host state. Pure — all
 * state arrives as arguments. Failure, restart and absence rules are enforced
 * here: unknown stays unknown, previous data becomes stale, nothing fabricates.
 */
export function deriveProviderUsage(input: UsageDeriveInput, estimators?: UsageEstimator[]): ProviderUsageSnapshot {
  const { id, live, probed, observed, now } = input;
  const refreshedAt = now;
  const telemetry = { sourceKind: "local_observation" as const, sourceSurface: TELEMETRY_SURFACE, ...observed };
  const base: ProviderUsageSnapshot = {
    providerId: id, name: live.name ?? display(id), accountScope: ACCOUNT_SCOPES[id] ?? null,
    status: "unknown", observedAt: null, refreshedAt, windows: [], note: "", localTelemetry: telemetry,
    error: typeof live.usage_error === "string" ? live.usage_error : null,
  };
  const surface = live.usageCapabilities?.source;
  const hasSurface = !!surface && !NO_SURFACE.has(surface);
  // Session-derived surfaces (Claude Code rate-limit events) cannot be read on demand: with no
  // report yet the honest state is Unknown (§8), not Unavailable — no endpoint read has failed.
  const sessionOnly = hasSurface && /session/i.test(surface!);

  if (id === "ollama") {
    // Ollama is local: the defensible truth is residency telemetry, not a subscription quota.
    // Cloud-hosted tags never inherit the daemon's local facts.
    if (!probed) {
      return { ...base, status: "stale", note: "Local service state was recorded before this Host restart; re-probing. It exposes no subscription quota." };
    }
    const loaded = live.current_model ? ` Loaded: ${live.current_model}${live.vram ? ` (${live.vram})` : ""}.` : "";
    const cloud = live.remoteModels?.length ? ` Hosted models (${live.remoteModels.join(", ")}) are separate; no quota facts exist for them.` : "";
    return { ...base, status: "current", note: `Local inference on this workstation; ${(live.models ?? []).length} model(s) installed.${loaded} The service exposes no subscription quota.${cloud}` };
  }

  // Fail closed (T2 §18F): an observation stamped in the future is not evidence of anything;
  // it is rejected entirely instead of gaining a negative age.
  const observation = live.usageObservedAt != null && live.usageObservedAt <= now ? live.usageObservedAt : null;
  const providerWindows = (observation != null && live.usageWindows?.length)
    ? live.usageWindows.map((window) => normalizeUsageWindow(window, { sourceKind: "provider_native", sourceSurface: surface ?? "provider report", confidence: "provider_reported", observedAt: observation }))
    : [];
  const estimateWindows = (estimators ?? []).flatMap((estimator) => {
    try { return estimator({ live, observed, now }); } catch { return []; }
  }).map((window) => ({ ...window, sourceKind: "estimate" as const, confidence: "estimated" as const }));

  const failure = typeof live.usage_failed_at === "number" ? live.usage_failed_at : null;

  if (!providerWindows.length && !estimateWindows.length) {
    if (!hasSurface) {
      return { ...base, status: "unknown", note: "No usage reporting surface is known for this provider. Usage is Unknown until one is verified." };
    }
    if (sessionOnly) {
      return { ...base, status: "unknown", note: "Usage reports arrive only from within live sessions on this workstation; none has reported yet, so usage is Unknown." };
    }
    const signIn = live.authenticatedState && live.authenticatedState !== "authenticated" ? " Sign-in is required to read usage." : "";
    const attempted = failure ? ` The most recent read failed${live.usage_error ? `: ${live.usage_error}` : ""}.` : "";
    return { ...base, status: "unavailable", note: `${live.usage_note ?? "The usage read returned nothing."}${signIn}${attempted}`, ...(failure ? { error: live.usage_error ?? base.error } : {}) };
  }

  const windows = [...providerWindows, ...estimateWindows];
  const newestObservation = providerWindows.length ? Math.max(...providerWindows.map((w) => w.observedAt)) : null;
  const record: ProviderUsageSnapshot = { ...base, windows, observedAt: newestObservation };

  if (!probed) {
    // Restart restore (T2 §16): persisted observation may return, but never as CURRENT.
    const age = relative(now - (newestObservation ?? now));
    return { ...record, status: "stale", note: `Last known usage recorded ${age === "just now" ? "moments" : age} ago, before this Host restart; no verified re-probe yet.` };
  }
  if (failure && providerWindows.length) {
    // §18D/F: a later read attempt produced nothing; previous good values become stale, never zeroed.
    return { ...record, status: "stale", note: `The most recent usage check failed${live.usage_error ? `: ${live.usage_error}` : ""}. Showing usage as reported ${relative(now - (newestObservation ?? now))} ago.` };
  }
  if (!providerWindows.length) {
    // Estimates only: Bunny computed these from locally observable information.
    return { ...record, status: "estimated", note: "Estimated from locally observable information; not provider-reported. Verify against the provider's own numbers." };
  }
  const freshness = USAGE_FRESHNESS_MS[id];
  const age = now - (newestObservation ?? 0);
  if (freshness == null || age <= freshness) {
    return { ...record, status: "current", note: `${relative(age) === "just now" ? "Reported just now" : `Last reported ${relative(age)} ago`}${freshness == null ? "" : "; within the verified freshness window."}` };
  }
  return { ...record, status: "stale", note: `Last reported ${relative(age)} ago; beyond this provider's freshness window. Values last verified then; nothing newer has been observed.` };
}

/** Value-level signature of a snapshot: statuses and windows, excluding observation timestamps. */
export function usageValueSignature(snapshot: ProviderUsageSnapshot): string {
  return JSON.stringify([snapshot.status, snapshot.windows.map((w) => [w.kind, w.percentUsed, w.resetAt, w.usedValue, w.remainingValue, w.sourceKind])]);
}

const describeWindow = (window: ProviderUsageWindow, now: number): string => {
  const used = window.percentUsed == null ? "unknown used" : `${Math.round(window.percentUsed)}% used`;
  const reset = window.resetAt ? `; resets ${window.resetAt > now ? `in ${relative(window.resetAt - now)}` : `at ${new Date(window.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}` : "";
  return `${window.label}: ${used}${reset}`;
};

const windowDiff = (before: ProviderUsageWindow, after: ProviderUsageWindow, now: number): string | null => {
  const parts: string[] = [];
  if (before.percentUsed !== after.percentUsed && (before.percentUsed ?? null) !== (after.percentUsed ?? null)) parts.push(`${before.percentUsed == null ? "unknown" : `${Math.round(before.percentUsed)}%`} → ${after.percentUsed == null ? "unknown" : `${Math.round(after.percentUsed)}%`} used`);
  if ((before.resetAt ?? null) !== (after.resetAt ?? null)) parts.push(`reset ${relative((before.resetAt ?? 0) - now)} → ${relative((after.resetAt ?? 0) - now)}`);
  if ((before.usedValue ?? null) !== (after.usedValue ?? null) || (before.remainingValue ?? null) !== (after.remainingValue ?? null)) parts.push("provider-reported values changed");
  return parts.length ? `${after.label}: ${parts.join(", ")}` : null;
};

/**
 * Difference events between two derived snapshots (T2 §12). Only four types,
 * semantic details, no raw bodies. Estimated→provider-reported replacement is
 * a usage_refreshed so the journal records exactly when the estimate retired.
 */
export function usageEventDiff(providerId: ProviderId, before: ProviderUsageSnapshot | null, after: ProviderUsageSnapshot, now: number): Array<{ type: string; providerId: ProviderId; detail: string }> {
  const name = after.name ?? display(providerId);
  const windows = after.windows;
  const empty = (type: string, detail: string) => [{ type, providerId, detail }];
  if (!before) {
    if (after.status === "unknown") return [];
    if (after.status === "stale") return empty("provider.usage_stale", `${name} usage restored from before the restart: ${windows.length} window(s) last observed ${relative(now - (after.observedAt ?? 0))} ago; marked stale until a new verified observation.`);
    if (after.status === "unavailable") return empty("provider.usage_unavailable", `${name} usage is unavailable: ${after.note}`);
    const kind = after.status === "estimated" ? "estimated from locally observable information" : describeWindowJoin(windows, now);
    return empty("provider.usage_refreshed", `${name} usage ${after.status === "estimated" ? kind : `refreshed: ${kind}`}. Source: ${windows[0]?.sourceSurface ?? (after.note || "local observation")} (observed ${after.observedAt ? new Date(after.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "unavailable"}).`);
  }
  const beforeValues = usageValueSignature(before);
  const afterValues = usageValueSignature(after);
  if (beforeValues === afterValues) return [];
  if (after.status === "stale" && before.status !== "stale") {
    return empty("provider.usage_stale", `${name} usage is stale: the observation from ${relative(now - (after.observedAt ?? 0))} ago is beyond the freshness window; values unchanged, marked stale. Last check ${after.error ? `failed: ${after.error}` : "did not replace the value"}.`);
  }
  if (after.status === "unavailable" && before.status === "unavailable") return [];
  if (after.status === "unavailable") {
    return empty("provider.usage_unavailable", `${name} usage is unavailable: ${after.note}${after.error ? " Last known values remain as previously reported and were not overwritten." : ""}`);
  }
  if (before.status === "estimated" && after.status === "current" && after.windows.some((w) => w.sourceKind === "provider_native")) {
    return empty("provider.usage_refreshed", `${name} usage: the estimate was replaced by a provider-reported value (${describeWindowJoin(after.windows.filter((w) => w.sourceKind === "provider_native"), now)}). Source: ${after.windows[0]?.sourceSurface}.`);
  }
  if (["current", "estimated"].includes(after.status) && !["current", "estimated"].includes(before.status)) {
    return empty("provider.usage_refreshed", `${name} usage refreshed: ${describeWindowJoin(windows, now)}. Source: ${windows[0]?.sourceSurface ?? (after.note || "local observation")}.`);
  }
  if (["current", "estimated", "stale"].includes(before.status) && ["current", "estimated"].includes(after.status)) {
    const diffs = after.windows.flatMap((window) => {
      const was = before.windows.find((w) => w.kind === window.kind || w.label === window.label);
      return was ? [windowDiff(was, window, now)].filter(Boolean) : [];
    }).filter(Boolean) as string[];
    return empty("provider.usage_changed", `${name} usage changed: ${diffs.join("; ")}. Source: ${after.windows[0]?.sourceSurface ?? "provider report"}.`);
  }
  return [];
}
const describeWindowJoin = (windows: ProviderUsageWindow[], now: number): string => windows.map((w) => describeWindow(w, now)).join("; ") || "no usage windows were reported";

export type ProviderUsageOptions = {
  /** Live provider state from the registry (the Host's only provider state). */
  providers: () => ProviderLive[];
  /** True once this Host instance probed the provider itself; persisted state alone is stale. */
  probed: (id: ProviderId) => boolean;
  /** Bunny's own task counters for the provider. */
  observed: (id: ProviderId) => ObservedUsage;
  /** Providers this Host actually manages (its adapter set). Defaults to the full set. */
  availableProviders?: () => ProviderId[];
  /** Registered estimators. Production registers none; tests inject them (T2 §18 L/M). */
  estimators?: Partial<Record<ProviderId, UsageEstimator>>;
  now?: () => number;
  /** Where usage events go (the Host's existing event stream). */
  publish?: (events: Array<{ type: string; providerId: ProviderId; detail: string }>) => void;
};

/**
 * Host-owned usage truth. Derives from the provider registry state, persists
 * nothing (the registry's providers table is already the observation store),
 * emits only semantic events, and refuses every fabrication the brief forbids.
 * Refresh piggybacks the single supervised discovery loop — no second scheduler.
 */
export class ProviderUsageService {
  private readonly opts: Required<Pick<ProviderUsageOptions, "providers" | "probed" | "observed" | "availableProviders" | "now" | "publish">> & Pick<ProviderUsageOptions, "estimators">;
  private readonly records = new Map<ProviderId, ProviderUsageSnapshot>();
  private readonly signatures = new Map<ProviderId, string>();
  private derivedAt: number | null = null;
  private refreshing: Promise<Array<{ type: string; providerId: ProviderId; detail: string }>> | null = null;

  constructor(options: ProviderUsageOptions) {
    this.opts = {
      providers: options.providers,
      probed: options.probed,
      observed: options.observed,
      availableProviders: options.availableProviders ?? (() => USAGE_PROVIDERS),
      now: options.now ?? (() => Date.now()),
      publish: options.publish ?? (() => {}),
      estimators: options.estimators,
    };
  }

  /** One derived snapshot for one provider; also the exact projection the UI consumes. */
  get(id: ProviderId): ProviderUsageSnapshot | null { return this.records.get(id) ?? null; }

  /** Single-flight, like ProviderRegistry.refresh. Emits diff events (not raw bodies) and returns them. */
  refresh(): Promise<Array<{ type: string; providerId: ProviderId; detail: string }>> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = Promise.resolve().then(() => this.deriveAll(true)).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** Silent derivation for snapshot reads (never publishes); the aging rules still apply. */
  private ensure(): void { if (this.derivedAt == null) this.deriveAll(false); }

  private deriveAll(publish: boolean): Array<{ type: string; providerId: ProviderId; detail: string }> {
    const now = this.opts.now();
    const events: Array<{ type: string; providerId: ProviderId; detail: string }> = [];
    for (const live of this.opts.providers()) {
      const id = live.id;
      if (!this.opts.availableProviders().includes(id)) continue;
      const estimator = id ? this.opts.estimators?.[id] : undefined;
      const derived = deriveProviderUsage({ id, live, probed: this.opts.probed(id), observed: this.opts.observed(id), now }, estimator ? [estimator] : undefined);
      const before = this.records.get(id) ?? null;
      this.records.set(id, derived);
      this.signatures.set(id, usageValueSignature(derived));
      if (publish) {
        const diff = usageEventDiff(id, before, derived, now);
        if (diff.length) {
          events.push(...diff);
          this.opts.publish(diff);
        }
      }
    }
    this.derivedAt = now;
    return events;
  }

  /** Safe UI projection: every field is normalized, sourced, and freshness-stamped. */
  snapshot(): ProviderUsageServiceSnapshot {
    this.ensure();
    return { version: 1, refreshedAt: this.derivedAt ?? this.opts.now(), providers: USAGE_PROVIDERS.map((id) => this.records.get(id)).filter(Boolean) as ProviderUsageSnapshot[] };
  }
}