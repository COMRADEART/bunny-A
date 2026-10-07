import test from "node:test";
import assert from "node:assert/strict";
import {
  checkedLine,
  modelsDiscovered,
  relativeAge,
  resetIn,
  usageChipLabel,
  usageFor,
  usageHeadline,
  usageStateLabel,
  usageWindowLine,
  usageWindowReset,
  USAGE_STATE_LABEL,
} from "./usage-model.ts";
import type { ProviderUsageSnapshot, ProviderUsageServiceSnapshot, UsageState } from "../../lib/bunny-host/provider-usage.server.ts";
import type { ProviderId } from "../../lib/orch/types.ts";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const usageWindow = (over: Partial<ProviderUsageSnapshot["windows"][number]> = {}): ProviderUsageSnapshot["windows"][number] => ({
  label: "5-hour window", kind: "short", limitValue: null, usedValue: null, remainingValue: null, unit: null,
  percentUsed: 41, resetAt: NOW + 3 * HOUR + 12 * 60_000, resetDescription: null, sourceKind: "provider_native",
  sourceSurface: "codex app-server account/rateLimits/read", confidence: "provider_reported", observedAt: NOW,
  rawValueHash: "0".repeat(64),
  ...over,
});
const usageRecord = (over: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot => ({
  providerId: "codex", name: "Codex", accountScope: "signed-in Codex account", status: "current",
  observedAt: NOW, refreshedAt: NOW - 60_000, windows: [], note: "state note", error: null,
  localTelemetry: {
    sourceKind: "local_observation", sourceSurface: "bunny-a task outcomes journal",
    tasks: 4, completed: 3, failed: 1, stopped: 0, runtimeMs: 5_000, inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, lastTaskAt: null,
  },
  ...over,
});
const snapshot = (providers: ProviderUsageSnapshot[]): ProviderUsageServiceSnapshot | null =>
  providers.length ? { version: 1, refreshedAt: NOW, providers } : null;

// Provider lookup: records are keyed by provider id; a null answer stays null.
test("usageFor reads one provider's record and returns null when absent", () => {
  const record = usageRecord();
  assert.equal(usageFor(snapshot([record]), "codex"), record);
  assert.equal(usageFor(snapshot([record]), "claude"), null);
  assert.equal(usageFor(null, "codex"), null);
  assert.equal(usageFor(snapshot([]), "codex"), null);
});

// Relative ages are render-time formatting only ("Checked 2 min ago" style).
test("relativeAge formats just now, minutes, hours and days; missing stamps are 'never'", () => {
  assert.equal(relativeAge(null, NOW), "never");
  assert.equal(relativeAge(NOW - 5_000, NOW), "just now");
  assert.equal(relativeAge(NOW - 59_000, NOW), "under a minute ago");
  assert.equal(relativeAge(NOW - 60_000, NOW), "1 min ago");
  assert.equal(relativeAge(NOW - 2 * 60_000, NOW), "2 min ago");
  assert.equal(relativeAge(NOW - 90 * 60_000, NOW), "1h 30m ago");
  assert.equal(relativeAge(NOW - 27 * HOUR, NOW), "1d ago");
});

// The Checked line is the brief's example: honest about when the last examination happened.
test("checkedLine reports the last examination time, never an observation as evidence", () => {
  assert.equal(checkedLine(usageRecord({ refreshedAt: NOW - 2 * 60_000 }), NOW), "Checked 2 min ago");
  assert.equal(checkedLine(null, NOW), "Checked never");
  assert.equal(checkedLine(usageRecord({ refreshedAt: NOW }), NOW), "Checked just now");
});

// Reset formatting: future only; past/unknown resets are not future facts.
test("resetIn formats future resets and stays null for past or unknown ones", () => {
  assert.equal(resetIn(null, NOW), null);
  assert.equal(resetIn(NOW - HOUR, NOW), null);
  assert.equal(resetIn(NOW + 45_000, NOW), "under a minute");
  assert.equal(resetIn(NOW + 5 * 60_000, NOW), "5m");
  assert.equal(resetIn(NOW + 3 * HOUR + 12 * 60_000, NOW), "3h 12m");
  assert.equal(resetIn(NOW + 25 * HOUR, NOW), "1d 1h");
});

// Window lines always carry their source; unknown percentages stay unknown.
test("usageWindowLine reads '41% used · resets in 3h 12m · Provider reported' with per-value source", () => {
  assert.equal(usageWindowLine(usageWindow(), NOW), "5-hour window: 41% used · resets in 3h 12m · Provider reported");
  assert.equal(usageWindowLine(usageWindow({ percentUsed: null, resetAt: null, sourceKind: "local_observation" }), NOW), "5-hour window: Unknown used · Locally observed");
  assert.equal(usageWindowLine(usageWindow({ sourceKind: "estimate", resetAt: null, resetDescription: "after 4 requests" }), NOW), "5-hour window: 41% used · after 4 requests · Estimated");
});

// Headline value: the leading provider window, or the state itself when nothing is reported.
test("usageHeadline shows the leading window's utilisation or the visible state", () => {
  assert.equal(usageHeadline(null), "Unknown");
  assert.equal(usageHeadline(usageRecord({ status: "unknown" })), "Unknown");
  assert.equal(usageHeadline(usageRecord({ windows: [usageWindow()] })), "41% used");
  assert.equal(usageHeadline(usageRecord({ status: "unknown", windows: [usageWindow({ percentUsed: null })] })), "Unknown used");
  assert.equal(usageHeadline(usageRecord({ providerId: "ollama", status: "current" })), "Local");
  assert.equal(usageHeadline(usageRecord({ status: "unavailable" })), "Unavailable");
});

// Chip labels: Ollama shows its local truth; every other provider shows its state.
test("usageChipLabel distinguishes Ollama's local telemetry from provider quota states", () => {
  assert.equal(usageChipLabel(null), "Unknown");
  assert.equal(usageChipLabel(usageRecord({ status: "current" })), "Current");
  assert.equal(usageChipLabel(usageRecord({ status: "stale" })), "Stale");
  assert.equal(usageChipLabel(usageRecord({ status: "estimated" })), "Estimated");
  assert.equal(usageChipLabel(usageRecord({ status: "unavailable" })), "Unavailable");
  assert.equal(usageChipLabel(usageRecord({ providerId: "ollama", status: "current" })), "Local");
  assert.equal(usageChipLabel(usageRecord({ providerId: "ollama", status: "stale" })), "Stale");
});

// The five states from §4 are all named; there is no sixth fabricated state.
test("all five usage states have visible labels and nothing else is named", () => {
  for (const state of ["current", "stale", "estimated", "unknown", "unavailable"] as UsageState[]) {
    assert.equal(typeof usageStateLabel(state), "string");
    assert.notEqual(usageStateLabel(state), "");
  }
  assert.deepEqual(Object.keys(USAGE_STATE_LABEL).sort(), ["current", "estimated", "stale", "unavailable", "unknown"]);
});

// Facts-row reset text: relative when still future, absolute once expired, else the provider's words.
test("usageWindowReset prefers the relative span and falls back to the absolute time or description", () => {
  assert.equal(usageWindowReset(usageWindow(), NOW), "Resets in 3h 12m");
  assert.match(usageWindowReset(usageWindow({ resetAt: NOW - HOUR }), NOW) ?? "", /^Resets /);
  assert.equal(usageWindowReset(usageWindow({ resetAt: null, resetDescription: "after 4 requests" }), NOW), "after 4 requests");
  assert.equal(usageWindowReset(usageWindow({ resetAt: null, resetDescription: null }), NOW), null);
});

// "Models N discovered" counts probed models per provider; zero stays unshown (null).
test("modelsDiscovered counts a provider's probed models and stays null when nothing was discovered", () => {
  const capabilities = { providers: [{ provider: "codex" as ProviderId, models: [{}, {}, {}] }, { provider: "claude" as ProviderId, models: [] }] };
  assert.equal(modelsDiscovered(capabilities, "codex"), 3);
  assert.equal(modelsDiscovered(capabilities, "claude"), null);
  assert.equal(modelsDiscovered(capabilities, "ollama"), null);
  assert.equal(modelsDiscovered(null, "codex"), null);
});