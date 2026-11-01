import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_ROTATION_FORBIDDEN,
  aggregateCapabilityStatus,
  advertisedCapability,
  assertNoSecretKeys,
  attemptAccountRotation,
  noteLocalObservedQuota,
  noteProviderQuotaWindow,
  noteQuota429,
  recordProbeResult,
  unavailableCapability,
} from "./capability-surface.ts";

const NOW = 1_793_491_200_000;

test("an advertised-only capability is 'reported', never 'verified'", () => {
  const cap = advertisedCapability("cap-codex-image", "codex", "image", true);
  assert.equal(cap.status, "reported");
  assert.equal(cap.lastProbeAtMs, null);
  assert.equal(cap.evidenceNote, "advertised by provider model list; not probed");
});

test("a passing probe flips the record to verified with provenance", () => {
  const cap = recordProbeResult(advertisedCapability("cap-1", "codex", "code", true), { ok: true, atMs: NOW, note: "codex.cli.probe.run" });
  assert.equal(cap.status, "verified");
  assert.equal(cap.evidenceNote, "probe: codex.cli.probe.run");
  assert.equal(cap.lastProbeAtMs, NOW);
});

test("a failing probe records the honest failure reason", () => {
  const cap = recordProbeResult(advertisedCapability("cap-2", "cursor", "image", false), { ok: false, atMs: NOW + 10, note: "provider declined image synthesis" });
  assert.equal(cap.status, "unavailable");
  assert.equal(cap.evidenceNote, "probe failed: provider declined image synthesis");
});

test("probe inputs are validated and inputs are not mutated", () => {
  assert.throws(() => recordProbeResult(advertisedCapability("c", "x", "text", true), { ok: true, atMs: NOW, note: "  " }));
  assert.throws(() => unavailableCapability("c", "x", "text", true, "  "));
  const original = advertisedCapability("cap-3", "ollama", "audio", false);
  const frozen = structuredClone(original);
  recordProbeResult(original, { ok: true, atMs: NOW, note: "probe ran" });
  assert.deepEqual(original, frozen);
});

test("HTTP 429 lands as an honest quota signal with the provider's own reset window", () => {
  const withWindow = noteQuota429("codex", NOW, { retryAfterMs: 120_000 });
  assert.equal(withWindow.source, "http_429");
  assert.equal(withWindow.usedPercent, null);
  assert.equal(withWindow.resetsAtMs, NOW + 120_000);
  const noWindow = noteQuota429("codex", NOW);
  assert.equal(noWindow.resetsAtMs, null);
  assert.equal(noWindow.quotaSignalId, `codex-http_429-${NOW}`);
});

test("provider-reported windows validate their fill percentage", () => {
  const window = noteProviderQuotaWindow("codex", "Codex 5h window", 62, NOW + 3_600_000, NOW);
  assert.equal(window.source, "provider_api");
  assert.equal(window.usedPercent, 62);
  assert.throws(() => noteProviderQuotaWindow("codex", "bad", 101, null, NOW));
  assert.throws(() => noteProviderQuotaWindow("codex", "bad", -1, null, NOW));
  assert.throws(() => noteProviderQuotaWindow("codex", " ", 50, null, NOW));
});

test("locally observed counts keep the local_observed source and never masquerade", () => {
  const local = noteLocalObservedQuota("ollama", "today's runs", 40, NOW);
  assert.equal(local.source, "local_observed");
  assert.equal(local.resetsAtMs, null);
  assert.throws(() => noteLocalObservedQuota("ollama", "today's runs", 120, NOW));
});

test("account rotation to evade limits is structurally forbidden", () => {
  assert.equal(ACCOUNT_ROTATION_FORBIDDEN, true);
  assert.throws(() => attemptAccountRotation(), /forbidden/);
});

test("secret-shaped keys are mechanically banned", () => {
  assert.throws(() => assertNoSecretKeys({ accessToken: "x" }));
  assert.throws(() => assertNoSecretKeys({ nested: { apiKey: "x" } }));
  assert.throws(() => assertNoSecretKeys({ list: [{ session: "x" }] }));
  assert.doesNotThrow(() => assertNoSecretKeys({ accountRef: "a-1", fenceToken: "f-0003", note: "session window" }));
});

test("aggregate status is honest about the weakest provenance", () => {
  const verified = recordProbeResult(advertisedCapability("v", "codex", "code", true), { ok: true, atMs: NOW, note: "run" });
  assert.equal(aggregateCapabilityStatus([verified]), "verified");
  assert.equal(aggregateCapabilityStatus([advertisedCapability("r", "codex", "text", true)]), "reported");
  assert.equal(aggregateCapabilityStatus([]), "unavailable");
  const failed = recordProbeResult(advertisedCapability("f", "x", "text", true), { ok: false, atMs: NOW, note: "down" });
  assert.equal(aggregateCapabilityStatus([verified, failed]), "reported");
  assert.equal(aggregateCapabilityStatus([failed]), "unavailable");
});