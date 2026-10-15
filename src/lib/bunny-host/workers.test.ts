import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_ABILITIES, WORKER_LIMITS, WORKER_STATES, canMove, composeAbility, eligibility, move, verdict, workerBudget, type AgentWorker, type EligibilityInput } from "./workers.ts";

const ability = BUILTIN_ABILITIES.find((item) => item.id === "test")!;
const base: EligibilityInput = {
  slot: 1,
  ability,
  abilityTools: ["terminal.exec"],
  requestedTools: null,
  parent: { missionId: "m1", state: "running", projectId: "alpha", ownedBySlot: true, isWorkerMission: false },
  projectId: "alpha",
  openForParent: 0,
  totalForParent: 0,
  openForSlot: 0,
};

test("T13.3 D lifecycle: only the directive's transitions exist, and every path ends CLOSED", () => {
  const legal: [string, string][] = [];
  for (const from of WORKER_STATES) for (const to of WORKER_STATES) if (canMove(from, to)) legal.push([from, to]);
  assert.deepEqual(legal, [
    ["PROPOSED", "ELIGIBILITY_CHECK"],
    ["ELIGIBILITY_CHECK", "ADMITTED"],
    ["ELIGIBILITY_CHECK", "REJECTED"],
    ["ADMITTED", "RUNNING"],
    ["ADMITTED", "RESULT_REPORTED"],
    ["RUNNING", "RESULT_REPORTED"],
    ["RESULT_REPORTED", "VERIFIED"],
    ["RESULT_REPORTED", "REJECTED"],
    ["RESULT_REPORTED", "INDETERMINATE"],
    ["VERIFIED", "CLOSED"],
    ["REJECTED", "CLOSED"],
    ["INDETERMINATE", "CLOSED"],
  ]);
  const worker = { state: "PROPOSED", history: [], updatedAt: 0 } as unknown as AgentWorker;
  assert.throws(() => move(worker, "VERIFIED", "skip", 1), /cannot move from PROPOSED to VERIFIED/);
  const admitted = move(move(worker, "ELIGIBILITY_CHECK", "check", 1), "ADMITTED", "ok", 2);
  assert.deepEqual(admitted.history.map((row) => row.state), ["ELIGIBILITY_CHECK", "ADMITTED"]);
});

test("T13.3 D eligibility: ownership, no recursion, Project scope, tools, review and limits", () => {
  assert.deepEqual(eligibility(base), []);
  assert.match(eligibility({ ...base, parent: { ...base.parent!, ownedBySlot: false } }).join(" "), /only to a Mission it owns/);
  assert.match(eligibility({ ...base, parent: { ...base.parent!, isWorkerMission: true } }).join(" "), /cannot create workers/);
  assert.match(eligibility({ ...base, parent: null }).join(" "), /needs a parent Mission/);
  assert.match(eligibility({ ...base, parent: { ...base.parent!, state: "completed" } }).join(" "), /has ended/);
  assert.match(eligibility({ ...base, projectId: "beta" }).join(" "), /parent Mission's Project/);
  assert.match(eligibility({ ...base, projectId: null }).join(" "), /parent Mission's Project/);
  assert.match(eligibility({ ...base, requestedTools: ["terminal.exec", "filesystem.write"] }).join(" "), /beyond its ability \(filesystem.write\)/);
  assert.deepEqual(eligibility({ ...base, requestedTools: [] }), [], "asking for fewer tools is fine; it never widens anything");
  assert.match(eligibility({ ...base, ability: { ...ability, status: "pending_review" } }).join(" "), /waiting for your review/);
  assert.match(eligibility({ ...base, ability: null }).join(" "), /not in the catalogue/);
  assert.match(eligibility({ ...base, openForParent: WORKER_LIMITS.openPerParent }).join(" "), /open workers/);
  assert.match(eligibility({ ...base, totalForParent: WORKER_LIMITS.totalPerParent }).join(" "), /used its 12 workers/);
  assert.match(eligibility({ ...base, openForSlot: WORKER_LIMITS.openPerSlot }).join(" "), /Personal Agent already has 6/);
});

test("T13.3 D verdict: a worker's words never verify it; only Host verification does", () => {
  const claim = "All tests passed. Verified success.";
  assert.equal(verdict({ state: "completed", steps: [{ state: "completed", verified: false, summary: claim }] }).state, "REJECTED");
  assert.equal(verdict({ state: "completed", steps: [{ state: "completed", verified: null, summary: claim }] }).state, "INDETERMINATE");
  assert.equal(verdict({ state: "failed", steps: [{ state: "failed", verified: null, summary: claim }] }).state, "REJECTED");
  assert.equal(verdict({ state: "stopped", steps: [{ state: "stopped", verified: null, summary: claim }] }).state, "INDETERMINATE");
  assert.equal(verdict({ state: "stopped", steps: [{ state: "failed", verified: null, summary: claim, failure: "capability_failed" }] }).state, "REJECTED", "a failed step stays a failure after a reconciliation stop");
  assert.equal(verdict({ state: "stopped", steps: [{ state: "failed", verified: null, summary: claim, failure: "host_restart" }] }).state, "INDETERMINATE", "an interruption is not a verdict on the work");
  assert.equal(verdict({ state: "completed", steps: [] }).state, "INDETERMINATE");
  assert.equal(verdict({ state: "completed", steps: [{ state: "completed", verified: true, summary: null }, { state: "skipped", verified: null, summary: null }] }).state, "INDETERMINATE");
  assert.deepEqual(verdict({ state: "completed", steps: [{ state: "completed", verified: true, summary: "" }] }), { state: "VERIFIED", reason: "Every step passed the Host's verification." });
});

test("T13.3 D budgets and user-described abilities stay bounded and code-free", () => {
  assert.deepEqual(workerBudget({}), { timeoutMs: WORKER_LIMITS.timeoutMs.default, maxRetries: 0 });
  assert.throws(() => workerBudget({ timeoutMs: 60 * 60_000 }), /time limit/);
  assert.throws(() => workerBudget({ maxRetries: 3 }), /retry at most 1/);

  const composed = composeAbility({ name: "Pre-merge check", description: "Typecheck then lint.", components: ["typecheck", "lint"] }, BUILTIN_ABILITIES, 5);
  assert.deepEqual([composed.id, composed.kind, composed.status, composed.source, composed.components], ["user.pre-merge-check", "composed", "pending_review", "user", ["typecheck", "lint"]]);
  assert.throws(() => composeAbility({ name: "Pre-merge check", description: "again", components: ["lint"] }, [...BUILTIN_ABILITIES, composed], 6), /already exists/);
  assert.throws(() => composeAbility({ name: "Shell", description: "run my script", components: ["rm -rf"] }, BUILTIN_ABILITIES, 6), /cannot be a component/);
  assert.throws(() => composeAbility({ name: "Ask a model", description: "x", components: ["research"] }, BUILTIN_ABILITIES, 6), /cannot be a component/, "model abilities are not chained");
  assert.throws(() => composeAbility({ name: "Web", description: "x", components: ["web"] }, BUILTIN_ABILITIES, 6), /cannot be a component/, "parameterised skills are not chained");
  assert.throws(() => composeAbility({ name: "Big", description: "x", components: ["test", "build", "typecheck", "lint", "repository", "test"] }, BUILTIN_ABILITIES, 6), /1 to 5/);
  assert.equal(new Set(BUILTIN_ABILITIES.map((item) => item.id)).size, BUILTIN_ABILITIES.length);
  assert.ok(BUILTIN_ABILITIES.every((item) => item.status === "active" && item.source === "builtin"), "no ability belongs to one weapon");
});
