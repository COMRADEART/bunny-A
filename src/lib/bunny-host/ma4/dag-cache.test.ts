import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  evaluateArtifactReuse,
  validateAndOptimizePlanGraph,
  type VerifiedArtifactCacheEntry,
} from "./adaptive-planner.ts";
import type { TaskSpec, Envelope, ExecutorFacts } from "./task-runtime.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

test("dag cache: validates reuse when all safety, provenance and contract conditions match", () => {
  const envelope: Envelope = {
    capabilities: ["file.read", "local.generate"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen2.5-coder:7b"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [{ root: "src", access: "read" }], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "config.json" },
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("All steps pass:step1");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const validEntry: VerifiedArtifactCacheEntry = {
    sha256: "cached-artifact-hash-valid",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: validEntry,
  });

  assert.equal(res.reusable, true);
  assert.ok(res.reason.includes("Verified artifact cache hit"));
});

test("dag cache negative: changed source file invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["file.read"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "changed-config.json" }, // CHANGED path
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const oldContentHash = sha256(JSON.stringify({ root: "src", path: "original-config.json" }));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "old-hash",
    sourceContentHash: oldContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Changed source file"));
});

test("dag cache negative: expired cache entry invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["file.read"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "file.ts" },
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "expired-hash",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() - 1000, // EXPIRED
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Expired cache entry"));
});

test("dag cache negative: changed authorization envelope invalidates reuse", () => {
  // Envelope does NOT grant file.read
  const envelope: Envelope = {
    capabilities: ["local.generate"], // file.read is revoked!
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "file.ts" },
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "auth-revoked-hash",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Changed authorization"));
});

test("dag cache negative: different project scope strictly invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["file.read"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-beta"], // Target is proj-beta
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "file.ts" },
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "cross-project-hash",
    sourceContentHash,
    projectScope: "proj-alpha", // Cached under proj-alpha
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-beta",
    contractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Different project scope"));
});

test("dag cache negative: different verification contract invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["file.read"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "file.ts" },
    model: null,
    maxAttempts: 2,
  };

  const currentContractHash = sha256("new acceptance contract criteria");
  const oldContractHash = sha256("old acceptance contract criteria");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "contract-mismatch-hash",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: oldContractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash: currentContractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Different verification contract"));
});

test("dag cache negative: modified model pin invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["local.generate"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen2.5-coder:7b"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "local.generate",
    input: { prompt: "Generate code" },
    model: "qwen2.5-coder:7b",
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "model-mismatch-hash",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: "qwen2.5-coder:14b", // Cached with a different model pin!
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Modified model pin"));
});

test("dag cache negative: tampered artifact invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["file.read"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "file.ts" },
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "tampered-hash",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: false, // Mark invalid / corrupted
    success: true,
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: entry,
    tampered: true,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Tampered or invalid artifact"));
});

test("dag cache negative: failed previous execution invalidates reuse", () => {
  const envelope: Envelope = {
    capabilities: ["file.read"],
    providers: ["ollama"],
    localOnly: true,
    models: ["qwen"],
    projectScopes: ["proj-alpha"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [], origins: [], services: [] },
  };

  const step: TaskSpec["steps"][number] = {
    id: "step1",
    kind: "file.read",
    input: { root: "src", path: "file.ts" },
    model: null,
    maxAttempts: 2,
  };

  const contractHash = sha256("contract");
  const sourceContentHash = sha256(JSON.stringify(step.input));

  const entry: VerifiedArtifactCacheEntry = {
    sha256: "failed-execution-hash",
    sourceContentHash,
    projectScope: "proj-alpha",
    verificationContractHash: contractHash,
    modelPin: null,
    expiresAt: Date.now() + 3_600_000,
    valid: true,
    success: false, // PREVIOUS RUN FAILED!
  };

  const res = evaluateArtifactReuse({
    step,
    projectScope: "proj-alpha",
    contractHash,
    envelope,
    cachedEntry: entry,
  });

  assert.equal(res.reusable, false);
  assert.ok(res.reason.includes("Failed previous execution"));
});
