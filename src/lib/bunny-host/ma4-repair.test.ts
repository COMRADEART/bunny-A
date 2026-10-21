// MA4-S1R3 fault-aware repair: deterministic attribution (pure) and targeted repair through the live WSL2 sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { attributeAttempt, runCodingWorkflow, PlannerArtifactSchema, WorkerArtifactSchema, type AttemptObservation, type CodingTask, type ModelCall, type Role } from "./ma4/coding-workflow.server.ts";
import { runSandboxed, sandboxAvailability } from "./ma4/sandbox.server.ts";

const ok = (id: string) => ({ id, passed: true, message: "" }), bad = (id: string, message = "AssertionError") => ({ id, passed: false, message });
const obs = (o: Partial<AttemptObservation>): AttemptObservation => ({ testerRule: "all-pass", sourceErrors: [], testErrors: [], hidden: { ran: true, passed: true }, generated: { loadError: null, results: [ok("t.a")] }, oracle: { loadError: null, results: [ok("t.a")] }, ...o });
const who = (o: AttemptObservation) => attributeAttempt(o).map(a => `${a.failureCategory}:${a.suspectedComponent}:${a.confidence}`);

test("A2 attribution: static errors are blamed on the file that has them", () => {
  assert.deepEqual(who(obs({ testErrors: ["tests: import of 'time' is not allowed"], generated: null, oracle: null })), ["test_invalid:tester:verified"]);
  assert.deepEqual(who(obs({ sourceErrors: ["source: syntax error line 2: invalid syntax", "source: import of 'os' is not allowed"], hidden: { ran: false, passed: false }, generated: null })),
    ["implementation_invalid:worker:verified", "dependency_violation:worker:verified"]);
});

test("A2 attribution: a failing generated test is the Tester's fault only when the frozen reference also fails it", () => {
  // Valid test exposing a Worker defect (passes on the reference).
  assert.deepEqual(who(obs({ hidden: { ran: true, passed: false }, generated: { loadError: null, results: [bad("t.a")] } })), ["implementation_defect:worker:verified", "implementation_defect:worker:verified"]);
  // Invalid test (fails on the reference) under the all-pass rule: Tester, and the Worker is not blamed.
  assert.deepEqual(who(obs({ generated: { loadError: null, results: [ok("t.a"), bad("t.b")] }, oracle: { loadError: null, results: [ok("t.a"), bad("t.b")] } })), ["test_invalid:tester:verified"]);
  // Both at once: each component gets only its own failure.
  assert.deepEqual(who(obs({ hidden: { ran: true, passed: false }, generated: { loadError: null, results: [bad("t.a"), bad("t.b")] }, oracle: { loadError: null, results: [ok("t.a"), bad("t.b")] } })),
    ["implementation_defect:worker:verified", "implementation_defect:worker:verified", "test_invalid:tester:verified"]);
  // Reference-validated rule: invalid tests are not counted, so they block nothing — unless no test is valid.
  assert.deepEqual(who(obs({ testerRule: "reference-validated", generated: { loadError: null, results: [ok("t.a"), bad("t.b")] }, oracle: { loadError: null, results: [ok("t.a"), bad("t.b")] } })), []);
  assert.deepEqual(who(obs({ testerRule: "reference-validated", generated: { loadError: null, results: [ok("t.b")] }, oracle: { loadError: null, results: [bad("t.b")] } })), ["test_invalid:tester:verified"]);
  assert.deepEqual(who(obs({ generated: { loadError: null, results: [] } })), ["test_invalid:tester:verified"]);
});

test("A2 attribution: load errors are decided by the oracle; without one the failure is ambiguous, never guessed", () => {
  assert.deepEqual(who(obs({ generated: { loadError: "ImportError: cannot import name 'parse'", results: [] }, oracle: { loadError: null, results: [ok("t.a")] } })), ["implementation_defect:worker:verified"]);
  assert.deepEqual(who(obs({ generated: { loadError: "NameError: unittest", results: [] }, oracle: { loadError: "NameError: unittest", results: [] } })), ["test_invalid:tester:verified"]);
  assert.deepEqual(who(obs({ generated: { loadError: "NameError: x", results: [] }, oracle: null })), ["ambiguous:none:ambiguous"]);
  assert.deepEqual(who(obs({ generated: { loadError: null, results: [bad("t.a")] }, oracle: null })), ["ambiguous:none:ambiguous"], "acceptance passes, test fails, no oracle");
  assert.deepEqual(who(obs({ hidden: { ran: true, passed: false }, generated: { loadError: null, results: [bad("t.a")] }, oracle: null })), ["implementation_defect:worker:verified", "implementation_defect:worker:supported"]);
});

test("B2/A1 decode-time module-name constraint replaces prose dependencies", () => {
  for (const schema of [PlannerArtifactSchema, WorkerArtifactSchema]) {
    const json = z.toJSONSchema(schema) as unknown as { properties: { dependencies: { items: { pattern?: string } } } };
    assert.equal(json.properties.dependencies.items.pattern, "^[A-Za-z_][A-Za-z0-9_.]{0,59}$");
  }
  assert.equal(WorkerArtifactSchema.safeParse({ source: "x", notes: "", dependencies: ["re (regular expression module)"], files: ["a.py"] }).success, false);
});

// ---- live-sandbox routing -------------------------------------------------------------------------------------------
const REF = "def clamp(x, lo, hi):\n    if lo > hi:\n        raise ValueError('lo > hi')\n    return max(lo, min(x, hi))\n";
const TASK: CodingTask = {
  id: "clamp", spec: "Define clamp(x, lo, hi) returning x limited to the inclusive range [lo, hi]; raise ValueError when lo > hi.",
  module: "clampmod", allowedImports: ["math"], testerRule: "all-pass", reference: REF,
  hiddenTests: "import unittest\nfrom clampmod import clamp\nclass H(unittest.TestCase):\n    def test_values(self):\n        self.assertEqual(clamp(5, 0, 3), 3); self.assertEqual(clamp(-1, 0, 3), 0); self.assertEqual(clamp(2, 0, 3), 2)\n    def test_error(self):\n        with self.assertRaises(ValueError): clamp(1, 3, 0)\n",
};
const GOOD = "def clamp(x, lo, hi):\n    if lo > hi:\n        raise ValueError('bad range')\n    return lo if x < lo else hi if x > hi else x\n";
const BUGGY = "def clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n";
const VALID = "import unittest\nfrom clampmod import *\nclass T(unittest.TestCase):\n    def test_mid(self):\n        self.assertEqual(clamp(2, 0, 3), 2)\n    def test_error(self):\n        with self.assertRaises(ValueError):\n            clamp(1, 3, 0)\n";
const WRONG = VALID + "    def test_wrong_expectation(self):\n        self.assertEqual(clamp(9, 0, 3), 9)\n";
const pins: Record<Role, string> = { Planner: "planner:7b", Worker: "coder:7b", Tester: "tester:7b", Reviewer: "reviewer:7b" };
const planner = (dependencies: string[] = []) => ({ requirements: ["clamp to range"], plan: ["check range", "clamp"], acceptance: ["clamp(5,0,3)==3"], constraints: [], dependencies });
const worker = (source: string) => ({ source, notes: "", dependencies: [], files: ["clampmod.py"] });
const tester = (tests_source: string) => ({ tests_source, cases: [{ name: "mid", expected: "2" }], rationale: "edges" });
const review = (verdict: "approve" | "reject") => ({ verdict, findings: [], confidence: 0.9 });
function scripted(replies: Partial<Record<Role, unknown[]>>) {
  const prompts: { role: Role; prompt: string; attempt: number }[] = [];
  const call: ModelCall = async ({ role, prompt, model, attempt }) => {
    prompts.push({ role, prompt, attempt });
    await new Promise(r => setTimeout(r, 5));
    const next = replies[role]?.shift();
    if (next === undefined) throw new Error(`unexpected ${role} call`);
    return { ok: true, text: typeof next === "string" ? next : JSON.stringify(next), servedModel: model, durationMs: 5 };
  };
  return { call, prompts, roles: () => prompts.map(p => p.role) };
}
const live = await sandboxAvailability();
const skip = live.available ? false : "SKIPPED (not passed): sandbox unavailable";
const sandbox = runSandboxed;

test("R3-G3 an invalid generated test is repaired by the Tester, without spending a Worker repair", { skip }, async () => {
  const m = scripted({ Planner: [planner()], Worker: [worker(GOOD)], Tester: [tester(WRONG), tester(VALID)], Reviewer: [review("approve")] });
  const r = await runCodingWorkflow(TASK, { call: m.call, sandbox, pins });
  assert.equal(r.status, "passed", r.reason);
  assert.deepEqual(m.roles(), ["Planner", "Worker", "Tester", "Tester", "Reviewer"], "the correct Worker is never re-asked");
  assert.equal(r.repairsUsed, 1);
  assert.deepEqual(r.repairs.map(x => [x.target, x.categories, x.outcome]), [["Tester", ["test_invalid"], "resolved"]]);
  assert.deepEqual(r.attempts[0].failures.map(f => [f.failureCategory, f.suspectedComponent, f.recommendedAction, f.confidence, f.retryBudgetRemaining]), [["test_invalid", "tester", "repair_tester", "verified", 2]]);
  assert.equal(r.attempts[0].hidden.passed, true);
  const repair = m.prompts[3].prompt;
  assert.match(repair, /REPAIR 1 of 2/); assert.match(repair, /test_wrong_expectation contradicts the frozen task contract at line 10: self\.assertEqual\(clamp\(9, 0, 3\), 9\) \(AssertionError\)/);
  assert.doesNotMatch(repair, /bad range|raise ValueError\('lo > hi'\)|3 != 9|test_values/, "the Tester sees neither the implementation, the reference, the reference's values nor hidden tests");
});

test("R3-G3 a Tester policy violation goes to the Tester; R3-G4 a valid failing test goes to the Worker; both in one round", { skip }, async () => {
  const policy = scripted({ Planner: [planner()], Worker: [worker(GOOD)], Tester: [tester("import time\n" + VALID), tester(VALID)], Reviewer: [review("approve")] });
  const p = await runCodingWorkflow(TASK, { call: policy.call, sandbox, pins });
  assert.equal(p.status, "passed", p.reason); assert.deepEqual(policy.roles(), ["Planner", "Worker", "Tester", "Tester", "Reviewer"]);
  assert.match(policy.prompts[3].prompt, /tests: import of 'time' is not allowed/);

  const defect = scripted({ Planner: [planner()], Worker: [worker(BUGGY), worker(GOOD)], Tester: [tester(VALID)], Reviewer: [review("approve")] });
  const d = await runCodingWorkflow(TASK, { call: defect.call, sandbox, pins });
  assert.equal(d.status, "passed", d.reason); assert.deepEqual(defect.roles(), ["Planner", "Worker", "Tester", "Worker", "Reviewer"], "a valid test is never rewritten to fit wrong code");
  assert.deepEqual(d.repairs.map(x => [x.target, x.outcome]), [["Worker", "resolved"]]);
  assert.match(defect.prompts[3].prompt, /test_error/); assert.doesNotMatch(defect.prompts[3].prompt, /class H\(unittest|test_values/);

  const both = scripted({ Planner: [planner()], Worker: [worker(BUGGY), worker(GOOD)], Tester: [tester(WRONG), tester(VALID)], Reviewer: [review("approve")] });
  const b = await runCodingWorkflow(TASK, { call: both.call, sandbox, pins });
  assert.equal(b.status, "passed", b.reason); assert.equal(b.repairsUsed, 1, "one round repairs both components");
  assert.deepEqual(b.repairs.map(x => x.target).sort(), ["Tester", "Worker"]);
  assert.doesNotMatch(both.prompts.find(x => x.role === "Worker" && x.attempt === 1)!.prompt, /test_wrong_expectation/, "an invalid test is never fed to the Worker");
});

test("A3 planner contradicting host facts is repaired by the Planner; the budget is shared and stops cleanly", { skip }, async () => {
  const m = scripted({ Planner: [planner(["os"]), planner(["math"])], Worker: [worker(BUGGY), worker(BUGGY)], Tester: [tester(VALID)], Reviewer: [review("approve")] });
  const r = await runCodingWorkflow(TASK, { call: m.call, sandbox, pins });
  assert.equal(r.status, "failed"); assert.equal(r.repairsUsed, 2);
  assert.deepEqual(m.roles(), ["Planner", "Planner", "Worker", "Tester", "Worker", "Reviewer"]);
  assert.match(m.prompts[1].prompt, /dependencies outside the allowed imports: os/);
  assert.deepEqual(r.repairs.map(x => [x.round, x.target, x.outcome]), [[1, "Planner", "resolved"], [2, "Worker", "unresolved"]]);
  assert.equal(r.failures.at(-2)!.retryBudgetRemaining, 0);
  assert.equal(r.reviewerFalseApproval, true, "R3-G5: the Reviewer approved, the gate rejected");
  assert.deepEqual(r.failures.at(-1)!.failureCategory, "reviewer_false_approval"); assert.equal(r.failures.at(-1)!.recommendedAction, "block_approval");
});

test("A3 without an oracle a test/code disagreement is diagnosed as ambiguous, not blindly repaired", { skip }, async () => {
  const m = scripted({ Planner: [planner()], Worker: [worker(GOOD)], Tester: [tester(WRONG)], Reviewer: [review("reject")] });
  const r = await runCodingWorkflow({ ...TASK, reference: undefined }, { call: m.call, sandbox, pins });
  assert.equal(r.status, "failed"); assert.match(r.reason, /ambiguous/); assert.equal(r.repairsUsed, 0);
  assert.deepEqual(m.roles(), ["Planner", "Worker", "Tester", "Reviewer"]);
  assert.deepEqual(r.failures.map(f => [f.failureCategory, f.recommendedAction]), [["ambiguous", "diagnose"]]);
});

test("B2 artifacts are typed, hashed, versioned to the contract, and a malformed Worker reply is repaired without execution", { skip }, async () => {
  const runs: string[] = [];
  const counting = async (q: Parameters<typeof runSandboxed>[0], s?: AbortSignal) => { runs.push(q.argv.join(" ")); return runSandboxed(q, s); };
  const m = scripted({ Planner: [planner()], Worker: ["{not json", worker(GOOD)], Tester: [tester(VALID)], Reviewer: [review("approve")] });
  const r = await runCodingWorkflow(TASK, { call: m.call, sandbox: counting, pins });
  assert.equal(r.status, "passed", r.reason);
  assert.equal(r.attempts[0].failures[0].failureCategory, "schema_error"); assert.equal(r.attempts[0].static.errors.length, 0);
  assert.equal(r.attempts[0].hidden.ran, false, "nothing ran in the attempt with a malformed artifact");
  assert.match(r.contractVersion ?? "", /^contract:[0-9a-f]{16}$/);
  assert.deepEqual(r.artifacts.map(a => [a.producer, a.validation]), [["Planner", "valid"], ["Worker", "malformed"], ["Tester", "valid"], ["Worker", "valid"], ["Reviewer", "valid"]]);
  const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
  assert.equal(r.artifacts[3].sha256, sha(worker(GOOD)));
  assert.ok(r.artifacts.slice(1).every(a => a.contractVersion === r.contractVersion && a.model === pins[a.producer]));
});
