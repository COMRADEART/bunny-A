import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderAdapter } from "./contracts.ts";
import { HostDatabase } from "./persistence.server.ts";
import { ProviderRegistry } from "./registry.server.ts";
import {
  deriveProviderUsage,
  normalizeUsageWindow,
  ProviderUsageService,
  rawValueHash,
  USAGE_FRESHNESS_MS,
  usageEventDiff,
  usageValueSignature,
  type UsageEstimator,
} from "./provider-usage.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { ObservedUsage, ProviderId, ProviderLive, UsageWindow } from "../orch/types.ts";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const live = (fields: Partial<ProviderLive>): ProviderLive => ({ ...providerBase(fields.id ?? "codex"), ...fields });
const observed = (fields: Partial<ObservedUsage> = {}): ObservedUsage => ({
  tasks: 3, completed: 2, failed: 1, stopped: 0, runtimeMs: 90_000, inputTokens: 1_200, outputTokens: 800, cachedInputTokens: 100, lastTaskAt: NOW - HOUR, ...fields,
});
const windows = (fields: Partial<UsageWindow> = {}): UsageWindow[] => [
  { label: "5-hour window", usedPercent: 41, resetsAt: NOW + 3 * HOUR, kind: "short", ...fields },
];
const codex = (fields: Partial<ProviderLive> = {}): ProviderLive => ({
  ...live({
    id: "codex", availability: "ready", installed: true, authenticated: true, authenticatedState: "authenticated",
    usageCapabilities: { shortWindow: true, weekly: false, resetTime: true, tokenUsage: true, activeJobs: true, source: "codex app-server account/rateLimits/read" },
    usage_note: "Usage unavailable", ...fields,
  }),
});
const claude = (fields: Partial<ProviderLive> = {}): ProviderLive => ({
  ...live({
    id: "claude", availability: "ready", installed: true, authenticated: true, authenticatedState: "authenticated",
    usageCapabilities: { shortWindow: false, weekly: false, resetTime: false, tokenUsage: true, activeJobs: true, source: "Claude Code rate_limit_event, reported during Bunny-A sessions" },
    ...fields,
  }),
});
const detectOnly = (): ProviderLive => live({ id: "cline", availability: "unavailable", installed: true });

const derive = (state: ProviderLive, over: Partial<Parameters<typeof deriveProviderUsage>[0]> = {}) =>
  deriveProviderUsage({ id: state.id, live: state, probed: true, observed: observed(), now: NOW, ...over });

const serviceEvents: Array<{ type: string; providerId: ProviderId; detail: string }> = [];
const service = (providers: ProviderLive[], options: Partial<ConstructorParameters<typeof ProviderUsageService>[0]> = {}): ProviderUsageService =>
  new ProviderUsageService({
    providers: () => providers,
    probed: (id) => providers.some((p) => p.id === id) && (options.probed?.(id) ?? true),
    observed: () => observed(),
    now: () => NOW,
    publish: (events) => serviceEvents.push(...events),
    ...options,
  });
const resetEvents = () => { serviceEvents.length = 0; };
const normalizeWith = (window: UsageWindow) => normalizeUsageWindow(window, { sourceKind: "provider_native", sourceSurface: "test surface", confidence: "provider_reported", observedAt: NOW });

// §18 A. provider returns valid exact usage → CURRENT.
test("a provider-reported window observed this run is CURRENT with provider-reported confidence (§18 A)", () => {
  const record = derive(codex({ usageWindows: windows(), usageObservedAt: NOW }));
  assert.equal(record.status, "current");
  assert.equal(record.windows.length, 1);
  assert.equal(record.windows[0].percentUsed, 41);
  assert.equal(record.windows[0].sourceKind, "provider_native");
  assert.equal(record.windows[0].confidence, "provider_reported");
  assert.equal(record.windows[0].sourceSurface, "codex app-server account/rateLimits/read");
  assert.equal(record.observedAt, NOW);
  assert.match(record.note, /Reported just now/);
});

// §18 B/C. provider omits limit / reset → those fields stay UNKNOWN (null), never invented.
test("a percent-only report leaves limit, remaining and unit UNKNOWN, and a missing reset stays unknown (§18 B, C)", () => {
  const record = derive(codex({ usageWindows: windows({ resetsAt: null, kind: undefined }), usageObservedAt: NOW }));
  const first = record.windows[0];
  assert.equal(first.limitValue, null, "no absolute limit was reported, so none is invented");
  assert.equal(first.usedValue, null);
  assert.equal(first.remainingValue, null);
  assert.equal(first.unit, null);
  assert.equal(first.percentUsed, 41);
  assert.equal(first.resetAt, null, "no reset time was reported, so none is invented");
  assert.equal(record.status, "current");
});

// §18 D. usage read fails after a good observation → previous value STALE, never zeroed.
test("a failed usage read keeps the previous good windows and marks them stale, never zero (§18 D)", () => {
  const record = derive(codex({ usageWindows: windows(), usageObservedAt: NOW - 60_000, usage_failed_at: NOW, usage_error: "usage read failed: timed out" }));
  assert.equal(record.status, "stale");
  assert.equal(record.windows.length, 1, "previous observation survives the failure");
  assert.equal(record.windows[0].percentUsed, 41, "the last good value is shown, not zeroed");
  assert.match(record.note, /check failed/);
  assert.equal(record.error, "usage read failed: timed out");
});

// §18 E. malformed provider response → rejected.
test("malformed window values are rejected, leaving UNKNOWN instead of defaults (§18 E)", () => {
  for (const bad of ["41", NaN, Infinity, -Infinity, null, true]) {
    const normalized = normalizeWith({ label: "5-hour window", usedPercent: bad as number, resetsAt: NOW + HOUR });
    assert.equal(normalized.percentUsed, null, `${String(bad)} is not a utilisation value`);
    assert.equal(normalized.limitValue, null);
  }
  const record = derive(codex({ usageWindows: [{ label: "5-hour window", usedPercent: "41" as unknown as number, resetsAt: NOW + HOUR }], usageObservedAt: NOW }));
  assert.equal(record.windows[0].percentUsed, null);
  assert.ok(usageValueSignature(record).includes("null"));
});

// §18 F. future/invalid timestamp → rejected/fail closed.
test("a future observation timestamp is rejected outright and invalid reset times fail closed (§18 F)", () => {
  const future = derive(codex({ usageWindows: windows(), usageObservedAt: NOW + HOUR }));
  assert.equal(future.status, "unavailable", "an observation from the future is not evidence; fail closed");
  assert.equal(future.windows.length, 0, "future-stamped windows are not projected");
  assert.equal(normalizeWith({ label: "5-hour window", usedPercent: 41, resetsAt: NOW - HOUR }).resetAt, null, "a reset already past its own observation is not a future fact");
  assert.equal(normalizeWith({ label: "5-hour window", usedPercent: 41, resetsAt: Number.POSITIVE_INFINITY }).resetAt, null);
  assert.equal(normalizeWith({ label: "5-hour window", usedPercent: 41, resetsAt: NOW + HOUR }).resetAt, NOW + HOUR, "a genuine future reset is kept as reported");
});

// §18 D recovery + registry integration: a null read never erases, and a succeeding read re-derives CURRENT.
test("a read returning nothing stays UNAVAILABLE without erasing state, and a later successful read wins (§18 D recovery)", async () => {
  const db = new HostDatabase(":memory:");
  try {
    let attempt = 0;
    const adapter: ProviderAdapter = {
      id: "codex",
      detect: async () => codex(),
      launch: () => { throw new Error("fixture only"); },
      usage: async () => { attempt += 1; return attempt === 1 ? null : { windows: windows(), observedAt: NOW }; },
    };
    const registry = new ProviderRegistry([adapter], db);
    await registry.refresh({ force: true });
    await registry.refreshUsage("codex");
    assert.equal(attempt, 1);
    let record = derive(registry.get("codex")!);
    assert.equal(record.status, "unavailable", "a null read with no prior observation is unavailable, not zero");
    assert.equal(record.windows.length, 0);
    await registry.refreshUsage("codex");
    assert.equal(attempt, 2);
    record = derive(registry.get("codex")!);
    assert.equal(record.status, "current", "the later provider-reported value takes over");
    assert.equal(record.windows[0].percentUsed, 41);
  } finally { db.close(); }
});

// §18 G. refresh timeout → bounded failure.
test("a timed-out usage read is bounded: one attempt, previous windows kept, derived stale (§18 G)", async () => {
  const db = new HostDatabase(":memory:");
  try {
    let usageCalls = 0;
    const adapter: ProviderAdapter = {
      id: "codex",
      detect: async () => codex({ usageWindows: windows(), usageObservedAt: NOW }),
      launch: () => { throw new Error("fixture only"); },
      usage: async () => { usageCalls += 1; throw new Error("usage read exceeded its 8s bound"); },
    };
    const registry = new ProviderRegistry([adapter], db);
    await registry.refresh({ force: true });
    await registry.refreshUsage("codex");
    assert.equal(usageCalls, 1, "one bounded attempt, no retries inside the probe layer");
    const stored = registry.get("codex")!;
    assert.equal(stored.usageWindows?.length, 1, "the failed read did not overwrite the previous windows");
    assert.equal(stored.usageWindows![0].usedPercent, 41);
    const record = derive(stored);
    assert.equal(record.status, "stale", "the bounded failure turns the previous value stale");
    assert.match(record.note, /exceeded its 8s bound/);
  } finally { db.close(); }
});

// §18 H. two simultaneous refreshes → single-flight.
test("two simultaneous service refreshes are single-flight and publish exactly once (§18 H)", async () => {
  resetEvents();
  const svc = service([codex({ usageWindows: windows(), usageObservedAt: NOW })]);
  const first = svc.refresh();
  const second = svc.refresh();
  assert.equal(second, first, "the in-flight refresh is the same promise");
  const events = await first;
  assert.equal(serviceEvents.length, events.length, "publish ran exactly once");
});

// §18 I. Host restart → persisted prior value is not falsely CURRENT.
test("a persisted observation restored at boot is STALE until this Host run probed it (§18 I)", () => {
  const restored = derive(codex({ usageWindows: windows(), usageObservedAt: NOW - 30_000 }), { probed: false });
  assert.equal(restored.status, "stale", "never CURRENT from persisted state alone");
  assert.match(restored.note, /before this Host restart/);
  const restoredClaude = derive(claude({ usageWindows: windows(), usageObservedAt: NOW - 120_000 }), { probed: false });
  assert.equal(restoredClaude.status, "stale");
});

// §18 J. provider disconnected → UNAVAILABLE or UNKNOWN, no invented percentage.
test("a disconnected signed-out provider reports UNAVAILABLE and a surface-less one UNKNOWN, with no percentage (§18 J, K)", () => {
  const offlineCodex = derive(codex({ availability: "offline", authenticated: false, authenticatedState: "not_authenticated", usageWindows: [], usageObservedAt: null }));
  assert.equal(offlineCodex.status, "unavailable", "a readable usage surface exists, so the honest state is unavailable");
  assert.equal(offlineCodex.windows.length, 0, "no percentage may be invented");
  assert.match(offlineCodex.note, /Sign-in is required/);
  const offlineClaude = derive(claude({ availability: "offline", authenticated: false, authenticatedState: "not_authenticated", usageWindows: [], usageObservedAt: null }));
  assert.equal(offlineClaude.status, "unknown", "Claude has no standalone usage surface even signed out (§8)");
  assert.equal(offlineClaude.windows.length, 0);
});

// §18 K. provider has no usage API → UNKNOWN.
test("providers without a usage surface stay UNKNOWN and produce no fake usage rows (§18 K)", () => {
  const record = derive(detectOnly());
  assert.equal(record.status, "unknown");
  assert.equal(record.windows.length, 0);
  assert.match(record.note, /No usage reporting surface is known/);
});

// §18 L. estimate exists → clearly ESTIMATED.
test("a registered estimate is labelled ESTIMATED and can never claim provider-native truth (§18 L)", async () => {
  resetEvents();
  const estimator: UsageEstimator = (input) => [{
    label: "Window since last task", kind: "other", limitValue: null, usedValue: null, remainingValue: null, unit: null,
    percentUsed: 12, resetAt: null, resetDescription: null,
    sourceKind: "provider_native", sourceSurface: "bunny-a estimate", confidence: "exact",
    observedAt: input.now, rawValueHash: "x",
  }];
  const svc = service([codex({ usageWindows: [], usageObservedAt: null })], { estimators: { codex: estimator } });
  await svc.refresh();
  const record = svc.get("codex")!;
  assert.equal(record.status, "estimated");
  assert.equal(record.windows[0].sourceKind, "estimate", "even a lying estimator is stamped estimate");
  assert.equal(record.windows[0].confidence, "estimated");
  assert.equal(record.windows[0].sourceSurface, "bunny-a estimate");
});

// §18 M. estimate later replaced by exact provider value → provider value wins.
test("a provider-reported value replaces a prior estimate and the journal records the retirement (§18 M)", () => {
  const before = deriveProviderUsage(
    { id: "codex", live: codex({ usageWindows: [], usageObservedAt: null }), probed: true, observed: observed(), now: NOW },
    [() => [{ label: "Window since last task", kind: "other", limitValue: null, usedValue: null, remainingValue: null, unit: null, percentUsed: 12, resetAt: null, resetDescription: null, sourceKind: "estimate" as const, sourceSurface: "bunny-a estimate", confidence: "estimated" as const, observedAt: NOW, rawValueHash: "x" }]],
  );
  const after = derive(codex({ usageWindows: windows(), usageObservedAt: NOW }));
  assert.equal(before.status, "estimated");
  assert.equal(after.status, "current");
  assert.equal(after.windows[0].sourceKind, "provider_native", "the provider value wins");
  const events = usageEventDiff("codex", before, after, NOW);
  assert.equal(events[0].type, "provider.usage_refreshed");
  assert.match(events[0].detail, /estimate was replaced by a provider-reported value/);
});

// §18 N. old observation ages beyond freshness → STALE.
test("observations age past their per-provider freshness window into STALE (§18 N + §15)", () => {
  assert.equal(USAGE_FRESHNESS_MS.codex, 10 * 60_000);
  assert.equal(USAGE_FRESHNESS_MS.claude, 30 * 60_000);
  assert.equal(USAGE_FRESHNESS_MS.ollama, 5 * 60_000);
  const elevenMinutes = derive(codex({ usageWindows: windows(), usageObservedAt: NOW - 11 * 60_000 }));
  assert.equal(elevenMinutes.status, "stale");
  assert.match(elevenMinutes.note, /freshness window/);
  const tenMinutes = derive(codex({ usageWindows: windows(), usageObservedAt: NOW - 10 * 60_000 }));
  assert.equal(tenMinutes.status, "current", "exactly at the freshness boundary is still current");
  const claude29 = derive(claude({ usageWindows: windows(), usageObservedAt: NOW - 29 * 60_000 }));
  const claude31 = derive(claude({ usageWindows: windows(), usageObservedAt: NOW - 31 * 60_000 }));
  assert.equal(claude29.status, "current");
  assert.equal(claude31.status, "stale");
});

// §18 O. cloud-hosted Ollama model → do not infer quota from local daemon facts.
test("hosted Ollama tags never inherit the local daemon's quota-less semantics (§18 O)", () => {
  const record = derive(live({ id: "ollama", availability: "ready", authenticated: true, authenticatedState: "not_required", local_or_cloud: "local", current_model: "llama3.2:3b", vram: "3.60 GB loaded VRAM", models: ["llama3.2:3b", "qwen3:8b:cloud"], remoteModels: ["qwen3:8b:cloud"] }));
  assert.equal(record.status, "current", "the local telemetry itself is fresh");
  assert.equal(record.windows.length, 0, "no quota windows exist, even with a cloud tag present");
  assert.match(record.note, /Hosted models \(qwen3:8b:cloud\) are separate; no quota facts exist for them/);
  assert.match(record.note, /exposes no subscription quota/);
});

// §9 Ollama local truth: residency telemetry is CURRENT while the daemon probed this run.
test("Ollama local telemetry is the truth surface, with residency reported and no quota (§9)", () => {
  const record = derive(live({ id: "ollama", availability: "ready", authenticated: true, authenticatedState: "not_required", local_or_cloud: "local", current_model: "llama3.2:3b", vram: "3.60 GB loaded VRAM", models: ["llama3.2:3b"] }));
  assert.equal(record.status, "current");
  assert.match(record.note, /Loaded: llama3.2:3b \(3.60 GB loaded VRAM\)/);
  assert.equal(record.accountScope, "local workstation");
  assert.equal(record.windows.length, 0);
  const restarted = derive(live({ id: "ollama", current_model: "llama3.2:3b" }), { probed: false });
  assert.equal(restarted.status, "stale", "after a restart the local state is stale too until re-probed");
});

// §8 Claude honest UNKNOWN: without a session report, Unknown is the product state.
test("Claude without any session-reported usage is UNKNOWN, exactly as the brief allows (§8, §18 K)", () => {
  const record = derive(claude({ usageWindows: [], usageObservedAt: null, authenticated: true, authenticatedState: "authenticated" }));
  assert.equal(record.status, "unknown");
  assert.equal(record.windows.length, 0);
  assert.match(record.note, /live sessions/);
  assert.match(record.note, /usage is Unknown/);
});

// §8 Claude session-reported usage keeps its provenance and its own observation time.
test("Claude in-session usage windows are provider-reported with the session observation time (§8)", () => {
  const record = derive(claude({ usageWindows: windows({ label: "5-hour window", usedPercent: 12, resetsAt: NOW + 2 * HOUR }), usageObservedAt: NOW - 5 * 60_000 }));
  assert.equal(record.status, "current", "5 minutes is inside the 30-minute Claude freshness bound");
  assert.equal(record.windows[0].sourceSurface, "Claude Code rate_limit_event, reported during Bunny-A sessions");
  assert.equal(record.windows[0].confidence, "provider_reported");
});

// §16 restart restore through the service: nothing is CURRENT from persisted rows alone.
test("a fresh service over persisted rows derives STALE or UNKNOWN, never CURRENT, before any probe (§16)", () => {
  resetEvents();
  const svc = service([codex({ usageWindows: windows(), usageObservedAt: NOW - 60_000 }), claude({ usageWindows: [], usageObservedAt: null })], { probed: () => false });
  const snapshot = svc.snapshot();
  assert.equal(snapshot.version, 1);
  const codexRecord = snapshot.providers.find((p) => p.providerId === "codex")!;
  const claudeRecord = snapshot.providers.find((p) => p.providerId === "claude")!;
  assert.equal(codexRecord.status, "stale");
  assert.equal(claudeRecord.status, "unknown");
  assert.equal(snapshot.refreshedAt, NOW);
});

// §12 event model: semantic types only, no timestamp-only churn, value changes as usage_changed.
test("value-only changes emit usage_changed; timestamp-only refreshes emit nothing (§12)", () => {
  const before = derive(codex({ usageWindows: windows(), usageObservedAt: NOW }));
  const later = NOW + 5_000;
  const changed = usageEventDiff("codex", before, derive(codex({ usageWindows: windows({ usedPercent: 63 }), usageObservedAt: later }), { now: later }), later);
  assert.equal(changed[0].type, "provider.usage_changed");
  assert.match(changed[0].detail, /41% → 63% used/);
  const sameValues = usageEventDiff("codex", before, derive(codex({ usageWindows: windows(), usageObservedAt: later }), { now: later }), later);
  assert.deepEqual(sameValues, [], "identical values at a newer observation time are not a change event");
  const unavailable = usageEventDiff("codex", before, derive(codex({ usageWindows: [], usageObservedAt: null, usage_error: "read refused" })), NOW);
  assert.equal(unavailable[0].type, "provider.usage_unavailable");
  const aged = usageEventDiff("codex", before, derive(codex({ usageWindows: windows(), usageObservedAt: NOW - 11 * 60_000 })), NOW);
  assert.equal(aged[0].type, "provider.usage_stale");
});

// §12 wiring: refresh publishes through the injected Host stream; snapshot() stays silent.
test("the service publishes semantic events through the Host's existing stream and snapshot never publishes", async () => {
  resetEvents();
  const svc = service([codex({ usageWindows: windows(), usageObservedAt: NOW })]);
  const events = await svc.refresh();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "provider.usage_refreshed");
  assert.equal(serviceEvents.length, 1, "the injected publish received the same events");
  for (const event of serviceEvents) assert.ok(event.type.startsWith("provider.usage_"));
  resetEvents();
  svc.snapshot();
  assert.equal(serviceEvents.length, 0, "snapshot reads stay silent");
  const repeated = await svc.refresh();
  assert.deepEqual(repeated, [], "an unchanged derivation publishes nothing");
});

// §17 privacy: the projection carries no credential material and no raw bodies.
test("the usage projection exposes no tokens, cookies, auth headers or raw response bodies (§17)", () => {
  resetEvents();
  const svc = service([codex({ usageWindows: windows(), usageObservedAt: NOW, usage_error: "read failed: 401" }), claude({ usageWindows: windows(), usageObservedAt: NOW }), live({ id: "ollama", current_model: "m" })]);
  const snapshot = svc.snapshot();
  const serialized = JSON.stringify(snapshot).toLowerCase();
  for (const forbidden of ["bearer", "cookie", "authorization:", "sk-", "api_key", "apikey", "access_token", "set-cookie", "password"]) {
    assert.ok(!serialized.includes(forbidden), `snapshot must not contain ${forbidden}`);
  }
  for (const record of snapshot.providers) for (const window of record.windows) {
    assert.ok(/^[0-9a-f]{64}$/.test(window.rawValueHash), "raw window values appear only as a hash");
    assert.ok(window.unit === null || ["tokens", "requests", "compute", "credits", "provider_defined"].includes(window.unit));
  }
});

// Provenance: identical provider values hash identically; a changed value hashes differently.
test("raw_value_hash is deterministic for identical provider values and differs for changed ones", () => {
  const same = rawValueHash({ label: "5-hour window", usedPercent: 41, resetsAt: NOW + HOUR, kind: "short" });
  const again = rawValueHash({ label: "5-hour window", usedPercent: 41, resetsAt: NOW + HOUR, kind: "short" });
  const changed = rawValueHash({ label: "5-hour window", usedPercent: 63, resetsAt: NOW + HOUR, kind: "short" });
  assert.equal(same, again);
  assert.notEqual(same, changed);
});

// §5 projection shape: versioned, ordered by the managed set, one record per managed provider.
test("the service snapshot is versioned, provider-ordered and holds the managed providers only", () => {
  resetEvents();
  const svc = service([live({ id: "ollama", current_model: "m" }), codex({ usageWindows: windows(), usageObservedAt: NOW }), claude({}), detectOnly()]);
  const snapshot = svc.snapshot();
  assert.deepEqual(snapshot.providers.map((p) => p.providerId), ["ollama", "codex", "claude", "cline"]);
  assert.equal(JSON.parse(JSON.stringify(snapshot)).version, 1);
  const claudeRecord = snapshot.providers.find((p) => p.providerId === "claude")!;
  assert.equal(claudeRecord.localTelemetry.tasks, observed().tasks, "Bunny's own counters ride along, never as quota");
  assert.equal(claudeRecord.localTelemetry.sourceKind, "local_observation");
  assert.match(claudeRecord.localTelemetry.sourceSurface, /not provider quota/);
  assert.equal(claudeRecord.accountScope, "signed-in Claude Code account");
  const unknownStatuses = snapshot.providers.filter((p) => p.status === "unknown").map((p) => p.providerId);
  assert.deepEqual(unknownStatuses, ["claude", "cline"], "absent facts stay Unknown in the projection");
});