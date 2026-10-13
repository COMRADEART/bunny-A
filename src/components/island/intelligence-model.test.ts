import test from "node:test";
import assert from "node:assert/strict";
import {
  JEV_STATE_LABEL,
  MASKED_KEY,
  apiKeyProblem,
  assistanceLine,
  boundedNumber,
  jevDistinctions,
  jevTone,
  lastTestLine,
  layaDistinctions,
  usageLine,
} from "./intelligence-model.ts";
import { DEFAULT_JEV_POLICY } from "../../lib/bunny-host/intelligence.ts";
import type { IntelligenceSnapshot } from "../../lib/bunny-host/intelligence-snapshot.ts";
import type { OrchTask } from "../../lib/orch/types.ts";

function snapshot(jev: Partial<IntelligenceSnapshot["jev"]> = {}, laya: Partial<IntelligenceSnapshot["laya"]> = {}): IntelligenceSnapshot {
  return {
    version: 1,
    router: "BunnyRouter",
    laya: { status: "missing", enabled: true, models: [], probedAt: null, detail: "No Laya model is installed.", apiKeyRequired: false, benchmarking: null, ...laya },
    jev: {
      state: "DISABLED", enabled: false, hasCredential: false, credentialUpdatedAt: null, credentialProtection: "Windows DPAPI (current user)",
      model: "jev-latest", models: [], lastTest: null, lastError: null,
      privacy: DEFAULT_JEV_POLICY.privacy, limits: DEFAULT_JEV_POLICY.limits, thresholds: DEFAULT_JEV_POLICY.thresholds,
      usage: { sessionRequests: 0, dayRequests: 0, dayInputTokens: 0, dayCostUsd: 0, unknownUsageRows: 0, lastRequestAt: null, lastLatencyMs: null },
      usable: false, detail: "Hosted decisions are off.", ...jev,
    },
    localDecisionPolicy: { label: "Local Decision Policy", detail: "BunnyRouter's deterministic selection." },
    lastAssistance: null,
  };
}
const task = (patch: Partial<OrchTask>): OrchTask => ({ id: "t", state: "running", provider: "ollama", model: "qwen3:8b", decision: {} as OrchTask["decision"], ...patch }) as OrchTask;

test("T13.1 UI: every connection state has a label; only CONNECTED reads as ok", () => {
  assert.equal(Object.keys(JEV_STATE_LABEL).length, 10);
  assert.equal(jevTone("CONNECTED"), "ok");
  assert.equal(jevTone("SAVED_NOT_VERIFIED"), "warn");
  assert.equal(jevTone("DISABLED"), "off");
  assert.equal(jevTone("AUTH_FAILED"), "bad");
  assert.equal(JEV_STATE_LABEL.SAVED_NOT_VERIFIED, "Saved, not tested");
});

test("T13.1 UI: saved, tested and eligible stay distinct facts", () => {
  const saved = jevDistinctions(snapshot({ enabled: true, hasCredential: true, state: "SAVED_NOT_VERIFIED" }), []);
  const facts = Object.fromEntries(saved.map((row) => [row.key, row.value]));
  assert.deepEqual(facts, { enabled: true, credential: true, tested: false, eligible: false, selected: false });
  assert.match(saved.find((row) => row.key === "credential")!.detail, /Saving does not test the key/);
  const discovery = jevDistinctions(snapshot({ hasCredential: true, lastTest: { at: 1, ok: true, latencyMs: 90, inferenceVerified: false, answeredBy: null, detail: "x" } }), []);
  assert.match(discovery.find((row) => row.key === "tested")!.detail, /decision inference not tested/);
  const assisted = jevDistinctions(snapshot({ usable: true }), [task({ decision: { decision_assistance: { source: "jev", action: "accept", confidence: 0.9 } } as OrchTask["decision"] }), task({ state: "completed", decision: { decision_assistance: { source: "jev", action: "accept", confidence: 0.9 } } as OrchTask["decision"] })]);
  assert.equal(assisted.find((row) => row.key === "selected")!.detail, "1 active Task took hosted advice.");
});

test("T13.1 UI: Laya facts never claim availability or routing that the Host did not report", () => {
  const missing = Object.fromEntries(layaDistinctions(snapshot(), []).map((row) => [row.key, row.value]));
  assert.deepEqual(missing, { local: false, enabled: true, benchmarked: false, eligible: false, selected: false });
  const model = { model: "laya:7b", runtime: "Ollama (local runtime)", local: true, capabilities: [], contextWindow: null, memoryRequirement: null, benchmarks: [{ model: "laya:7b", taskClass: "general", passed: true, detail: "", latencyMs: 10, at: 1 }], eligibleTaskClasses: ["general"], routingEligible: true };
  const installed = layaDistinctions(snapshot({}, { status: "installed", models: [model] }), [task({ model: "laya:7b" }), task({ model: "qwen3:8b" })]);
  assert.deepEqual(Object.fromEntries(installed.map((row) => [row.key, row.value])), { local: true, enabled: true, benchmarked: true, eligible: true, selected: true });
  const off = layaDistinctions(snapshot({}, { status: "installed", enabled: false, models: [model] }), []);
  assert.equal(off.find((row) => row.key === "eligible")!.value, false);
});

test("T13.1 UI: key entry checks, a mask that reveals nothing, and honest usage text", () => {
  assert.equal(apiKeyProblem(""), "Enter an API key.");
  assert.equal(apiKeyProblem("short"), "That key is too short.");
  assert.match(apiKeyProblem("has a space in it")!, /no spaces/);
  assert.equal(apiKeyProblem("  ts_live_abcdefgh  "), null);
  assert.ok(!/[A-Za-z0-9]/.test(MASKED_KEY));
  const limits = { ...DEFAULT_JEV_POLICY.limits, maxRequestsPerDay: 10, maxRequestsPerSession: 5 };
  assert.equal(usageLine({ sessionRequests: 1, dayRequests: 2, dayInputTokens: null, dayCostUsd: null, unknownUsageRows: 1, lastRequestAt: null, lastLatencyMs: null }, limits), "2 of 10 requests today · 1 of 5 this session · tokens unknown · cost unknown");
  assert.equal(lastTestLine(null), "Never tested.");
  assert.match(lastTestLine({ at: 0, ok: false, latencyMs: null, inferenceVerified: false, answeredBy: null, detail: "Refused." }, 120 * 60_000), /^Failed 2 h ago\. Refused\.$/);
  assert.equal(assistanceLine(null), "No routing decision has used assistance yet.");
  assert.match(assistanceLine({ at: 1, source: "local", action: "router", detail: "Hosted decision unavailable.", recommended: null, confidence: null }), /^Local Decision Policy: router\./);
  assert.equal(boundedNumber("0.8", 0, 1), 0.8);
  assert.equal(boundedNumber("1.2", 0, 1), null);
  assert.equal(boundedNumber("", 0, 1), null);
});
