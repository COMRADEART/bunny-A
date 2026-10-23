import test from "node:test";
import assert from "node:assert/strict";
import { providerBase } from "./adapters.server.ts";
import { buildCandidates, selectRoutingCandidate, type CandidateInput } from "./routing.server.ts";
import { analyzeModelTask } from "./ma4/analyzer.ts";
import { applyRoutingMode, approvalExclusion, importApproval, reliabilityPoints, wilsonLower, type IssuedApproval } from "./ma4/hybrid.ts";
import { IntelligenceStore } from "./ma4/store.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { validateConstraints } from "./http.server.ts";
import type { ModelCapabilityRecord } from "./model-capability.server.ts";
import type { ProviderId, ProviderLive, TaskConstraints } from "../orch/types.ts";

const now = 1_700_000_000_000;
const live = (id: ProviderId): ProviderLive => ({ ...providerBase(id), installed: true, authenticated: true, authenticatedState: id === "ollama" ? "not_required" : "authenticated", availability: "ready", capabilities: ["text"], current_model: null, probedAt: now, ...(id === "ollama" ? { models: ["coder:7b", "general:7b", "big:cloud"], remoteModels: ["big:cloud"] } : {}) });
const model = (name: string, local = true): ModelCapabilityRecord => ({ provider: "ollama", model: name, local, toolCalling: null, vision: null, embedding: null, contextWindow: 32_768, loaded: null, isDefault: null, source: "fixture", probedAt: now, evidence: [] } as unknown as ModelCapabilityRecord);
const input = (prompt: string, constraints: TaskConstraints, extra: Partial<CandidateInput> = {}): CandidateInput => {
  const analyzed = analyzeModelTask({ prompt, mode: "balanced", constraints });
  return { providers: [live("ollama"), live("claude")], modelSnapshot: { providers: [{ provider: "ollama", probedThisRun: true, probedAt: now, models: [model("coder:7b"), model("general:7b"), model("big:cloud", false)] }] },
    usage: { providers: [] }, requirements: { ...analyzed.legacy, model_intelligence: analyzed.analysis }, constraints: applyRoutingMode(constraints), override: "auto", mode: "balanced", ...extra };
};
const eligible = (i: CandidateInput) => buildCandidates(i).filter(c => c.eligibility === "eligible").map(c => c.model_id ?? c.provider_id);
const CODING = "Write a Python function that parses ISO dates and returns a tuple.";

test("B3 routing modes only add restrictions; MODEL_PINNED never chooses a model itself", () => {
  assert.deepEqual(applyRoutingMode({ routingMode: "AUTO_LOCAL" }), { routingMode: "AUTO_LOCAL", localOnly: true });
  assert.deepEqual(applyRoutingMode({ routingMode: "OFFLINE_ONLY", localOnly: false }), { routingMode: "OFFLINE_ONLY", localOnly: true, offlineOnly: true });
  assert.throws(() => applyRoutingMode({ routingMode: "MODEL_PINNED" }), /requires an exact model/);
  assert.deepEqual(applyRoutingMode({ routingMode: "MODEL_PINNED", modelExact: "coder:7b" }), { routingMode: "MODEL_PINNED", modelExact: "coder:7b" });
  assert.throws(() => applyRoutingMode({ routingMode: "SOMETHING" as never }));
  assert.deepEqual(eligible(input(CODING, { routingMode: "OFFLINE_ONLY" })).sort(), ["coder:7b", "general:7b"], "cloud-backed Ollama tags and hosted CLIs are excluded");
  assert.deepEqual(eligible(input(CODING, { routingMode: "AUTO_LOCAL" })).sort(), ["coder:7b", "general:7b"]);
  assert.deepEqual(eligible(input(CODING, { routingMode: "MODEL_PINNED", modelExact: "general:7b" })), ["general:7b"]);
  assert.deepEqual(validateConstraints({ routingMode: "OFFLINE_ONLY", dataCategory: "code" }), { routingMode: "OFFLINE_ONLY", dataCategory: "code" });
  assert.throws(() => validateConstraints({ routingMode: "YOLO" }));
  assert.throws(() => validateConstraints({ dataCategory: "anything" }));
});

test("H1 reliability-aware ranking: measured category correctness outranks valid-JSON-only evidence; UNPROVEN earns nothing", () => {
  const evidence: Record<string, Record<string, { passes: number; samples: number }>> = {
    "coder:7b": { programming: { passes: 0, samples: 6 }, "json-schema": { passes: 6, samples: 6 } },
    "general:7b": { programming: { passes: 5, samples: 6 } },
  };
  const reliability = (_p: ProviderId, m: string | null, c: string) => (m ? evidence[m]?.[c] : null) ?? null;
  const i = input(CODING, { routingMode: "AUTO_LOCAL" }, { reliability });
  const pick = selectRoutingCandidate({ candidates: buildCandidates(i), requirements: i.requirements });
  assert.equal(pick.selected?.model_id, "general:7b");
  const coder = pick.order.find(c => c.model_id === "coder:7b")!;
  assert.ok(coder.score_components!.find(c => c.name === "reliability")!.points < 0);
  assert.equal(reliabilityPoints(null).points, 0); assert.equal(reliabilityPoints({ passes: 2, samples: 2 }).points, 0, "fewer than 3 samples stays UNPROVEN");
  assert.ok(wilsonLower(6, 6) < 1 && wilsonLower(6, 6) > 0.5); assert.equal(wilsonLower(0, 6), 0); assert.equal(wilsonLower(7, 6), 0);
  // A hard pin beats any reliability evidence: no silent substitution.
  const pinned = input(CODING, { routingMode: "MODEL_PINNED", modelExact: "coder:7b" }, { reliability });
  assert.equal(selectRoutingCandidate({ candidates: buildCandidates(pinned), requirements: pinned.requirements }).selected?.model_id, "coder:7b");
  // Evidence lookups that throw are ignored, never fatal and never a bonus.
  const broken = input(CODING, { routingMode: "AUTO_LOCAL" }, { reliability: () => { throw new Error("db"); } });
  assert.ok(buildCandidates(broken).every(c => c.eligibility !== "eligible" || c.score_components!.find(x => x.name === "reliability")!.points === 0));
});

const approval = (fields: Partial<IssuedApproval> = {}): IssuedApproval => ({ provider_id: "openrouter", model_id: "vendor/model:free", approval_status: "approved", approved_purpose: ["coding"], data_categories: ["synthetic"], spending_limit_usd: 0, expiry: new Date(now + 86_400_000).toISOString(), issued_by: "workstation", issued_at: new Date(now).toISOString(), ...fields });
const request = (fields = {}) => ({ provider: "openrouter", model: "vendor/model:free", purpose: "coding" as const, dataCategory: "synthetic" as const, estimatedUsd: 0, spentUsd: 0, now, ...fields });

test("B4 approvals are scoped to provider, exact model, purpose, data category, expiry and spend", () => {
  assert.match(approvalExclusion([], request())!, /owner-issued approval/);
  assert.equal(approvalExclusion([approval()], request()), null);
  assert.match(approvalExclusion([approval()], request({ model: "vendor/other:free" }))!, /owner-issued/, "an approved provider does not authorize its other models");
  assert.match(approvalExclusion([approval()], request({ purpose: "planning" }))!, /purpose/);
  assert.match(approvalExclusion([approval()], request({ dataCategory: "code" }))!, /data category/);
  assert.match(approvalExclusion([approval()], request({ dataCategory: "unclassified" }))!, /data category/);
  assert.match(approvalExclusion([approval({ expiry: new Date(now - 1).toISOString() })], request())!, /unexpired/);
  assert.match(approvalExclusion([approval({ approval_status: "revoked" })], request())!, /revoked/);
  assert.match(approvalExclusion([approval({ approval_status: "pending" })], request())!, /owner-issued/);
  assert.match(approvalExclusion([approval({ spending_limit_usd: 1 })], request({ spentUsd: 0.9, estimatedUsd: 0.2 }))!, /spending limit/);
  assert.match(approvalExclusion([{ ...approval(), issued_by: "agent" as never }], request())!, /owner-issued/);
});

test("B4 only the workstation issues approvals; imported or agent-written records stay pending", () => {
  const store = new IntelligenceStore(new HostDatabase(":memory:"));
  const raw = { provider_id: "openrouter", model_id: "vendor/model:free", approval_status: "approved", approved_purpose: ["coding"], data_categories: ["synthetic"], spending_limit_usd: 0, expiry: new Date(Date.now() + 3_600_000).toISOString() };
  assert.equal(importApproval(raw).approval_status, "pending");
  for (const actor of ["agent", "remote:phone", undefined, "model-output", "Workstation"]) assert.throws(() => store.issueApproval(raw, actor), /workstation owner/);
  assert.throws(() => store.issueApproval({ ...raw, expiry: null }, "workstation"), /future expiry/);
  assert.throws(() => store.issueApproval({ ...raw, approved_purpose: null }, "workstation"), /purpose/);
  assert.throws(() => store.issueApproval({ ...raw, issued_by: "workstation" }, "workstation"), "unknown keys are rejected");
  store.issueApproval(raw, "workstation");
  assert.equal(store.approvals().length, 1);
  assert.equal(approvalExclusion(store.approvals(), request({ now: Date.now() })), null);
  // A row edited outside the Host (no issuer stamp) is ignored.
  store.db.db.prepare("UPDATE ma4_approvals SET record=?").run(JSON.stringify(raw));
  assert.equal(store.approvals().length, 0);
  assert.equal(new IntelligenceStore(new HostDatabase(":memory:")).configuration().enabled, false, "external inference stays disabled by default");
});

test("H2 reliability evidence: benchmark import replaces only its source; runtime outcomes accumulate", () => {
  const store = new IntelligenceStore(new HostDatabase(":memory:"));
  store.importReliability([{ provider: "ollama", model: "coder:7b", category: "programming", passes: 3, samples: 6, source: "x" }], "bench-v1");
  store.recordOutcome("ollama", "coder:7b", "programming", false);
  store.recordOutcome("ollama", "coder:7b", "programming", true);
  assert.deepEqual(store.reliability("ollama", "coder:7b", "programming"), { passes: 4, samples: 8 });
  store.importReliability([{ provider: "ollama", model: "coder:7b", category: "programming", passes: 6, samples: 6, source: "x" }], "bench-v1");
  assert.deepEqual(store.reliability("ollama", "coder:7b", "programming"), { passes: 7, samples: 8 });
  assert.equal(store.reliability("ollama", "coder:7b", "math"), null);
  assert.throws(() => store.importReliability([{ provider: "ollama", model: "m", category: "math", passes: 4, samples: 3, source: "x" }], "bad"));
});
