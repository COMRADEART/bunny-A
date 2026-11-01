import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONTRACTS_VERSION,
  ContractBundleSchema,
  assertNoSecretKeys,
  validateBundle,
} from "./contracts.ts";
import type { ContractBundle } from "./contracts.ts";

const goldBytes = readFileSync(new URL("./fixtures/uof.v1.gold.json", import.meta.url), "utf8");
const gold = ContractBundleSchema.parse(JSON.parse(goldBytes)) as ContractBundle;

function mutated(fn: (b: ContractBundle) => void): ContractBundle {
  const clone = structuredClone(gold) as ContractBundle;
  fn(clone);
  return clone;
}

test("uof.v1 gold fixture parses and passes every cross-entity invariant", () => {
  assert.equal(gold.contractsVersion, CONTRACTS_VERSION);
  assert.deepEqual(validateBundle(gold), []);
  assertNoSecretKeys(gold);
});

test("event seq regression per task is rejected", () => {
  const bundle = mutated((b) => {
    b.events[1]!.seq = b.events[0]!.seq;
  });
  const got = validateBundle(bundle);
  assert.ok(got.some((v) => v.code === "event_seq_regression"), JSON.stringify(got));
});

test("dependency pointing outside the plan is rejected", () => {
  const bundle = mutated((b) => {
    b.dependencies[0]!.fromSubtaskId = "s-missing";
  });
  const got = validateBundle(bundle);
  assert.ok(got.some((v) => v.code === "dangling_ref"), JSON.stringify(got));
});

test("plan cycle is rejected", () => {
  const bundle = mutated((b) => {
    b.plans[0]!.dependencies.push({
      dependencyId: "d-2",
      fromSubtaskId: "s-apply",
      toSubtaskId: "s-route",
      kind: "finish_to_start",
    });
  });
  const got = validateBundle(bundle);
  assert.ok(got.some((v) => v.code === "plan_cycle"), JSON.stringify(got));
});

test("lease held outside the epoch coordinator is rejected", () => {
  const bundle = mutated((b) => {
    b.leases[0]!.holderDeviceId = "d-android";
  });
  const got = validateBundle(bundle);
  assert.ok(got.some((v) => v.code === "lease_rogue_holder"), JSON.stringify(got));
});

test("lease from a future epoch is rejected", () => {
  const bundle = mutated((b) => {
    b.leases[0]!.epoch = 99;
  });
  const got = validateBundle(bundle);
  assert.ok(got.some((v) => v.code === "lease_future_epoch"), JSON.stringify(got));
});

test("approval pending but resolved is rejected; resolved but unresolved time too", () => {
  const pendingResolved = mutated((b) => {
    b.approvals[0]!.resolvedAtMs = 1793491201000;
  });
  assert.ok(validateBundle(pendingResolved).some((v) => v.code === "approval_inconsistent"));
  const resolvedNoTime = mutated((b) => {
    b.approvals[0]!.state = "approved";
  });
  assert.ok(validateBundle(resolvedNoTime).some((v) => v.code === "approval_inconsistent"));
});

test("unknown-cost-is-not-zero rule is enforced by the schema itself", () => {
  const knownBad = mutated((b) => {
    b.usageEstimates[0]!.cost = { amountUsd: null, basis: "known" };
  });
  assert.throws(() => ContractBundleSchema.parse(knownBad));
  const unknownCarry = mutated((b) => {
    b.usageEstimates[0]!.cost = { amountUsd: 0.5, basis: "unknown" };
  });
  assert.throws(() => ContractBundleSchema.parse(unknownCarry));
});

test("stamped version mismatch is rejected", () => {
  const wrong = mutated((b) => {
    (b as unknown as { contractsVersion: string }).contractsVersion = "uof.v0";
  });
  assert.throws(() => ContractBundleSchema.parse(wrong));
});

test("secret-shaped keys are mechanically forbidden even in nested data", () => {
  assert.throws(() => assertNoSecretKeys({ tasks: [], nested: { accessToken: "x" } }));
  assert.throws(() => assertNoSecretKeys({ apiKey: "x" }));
  assert.doesNotThrow(() => assertNoSecretKeys({ accountRef: "acct-1", note: "session window" }));
});