// MA4-S1R4: adaptive task graph, fenced transport, verified Worker sampling, brokered tools, role assignment.
import test from "node:test";
import assert from "node:assert/strict";
import { extractCode, runCodingWorkflow, STRATEGY_S1R4, type CodingTask, type ModelCall, type Role, type Sampling } from "./ma4/coding-workflow.server.ts";
import { buildTaskGraph, profileCodingTask, validateGraph, type TaskGraph } from "./ma4/task-intelligence.ts";
import { assignRole, type RoleEvidence } from "./ma4/hybrid.ts";
import { runSandboxed, sandboxAvailability } from "./ma4/sandbox.server.ts";
import type { SandboxRequest } from "./ma4/sandbox.server.ts";

const REF = "def clamp(x, lo, hi):\n    if lo > hi:\n        raise ValueError('lo > hi')\n    return max(lo, min(x, hi))\n";
const TASK: CodingTask = {
  id: "clamp", spec: "Define clamp(x, lo, hi) returning x limited to the inclusive range [lo, hi]; raise ValueError when lo > hi.",
  module: "clampmod", allowedImports: ["math"], testerRule: "all-pass", reference: REF,
  hiddenTests: "import unittest\nfrom clampmod import clamp\nclass H(unittest.TestCase):\n    def test_values(self):\n        self.assertEqual(clamp(5, 0, 3), 3); self.assertEqual(clamp(-1, 0, 3), 0)\n    def test_error(self):\n        with self.assertRaises(ValueError): clamp(1, 3, 0)\n",
};
const GOOD = "def clamp(x, lo, hi):\n    if lo > hi:\n        raise ValueError('bad range')\n    return lo if x < lo else hi if x > hi else x\n";
const BUGGY = "def clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n";
const VALID = "import unittest\nfrom clampmod import *\nclass T(unittest.TestCase):\n    def test_mid(self):\n        self.assertEqual(clamp(2, 0, 3), 2)\n    def test_error(self):\n        with self.assertRaises(ValueError):\n            clamp(1, 3, 0)\n";
const fence = (code: string, preface = "Checklist:\n- clamp\n") => `${preface}\`\`\`python\n${code}\`\`\`\nUsage:\n\`\`\`python\nclamp(1, 0, 2)\n\`\`\``;
const pins: Record<Role, string> = { Planner: "planner:7b", Worker: "coder:7b", Tester: "tester:7b", Reviewer: "reviewer:7b" };
const planner = { requirements: ["clamp to range"], plan: ["check range", "clamp"], acceptance: ["clamp(5,0,3)==3"], constraints: [], dependencies: [] };
const review = { verdict: "approve", findings: [], confidence: 0.9 };
function scripted(replies: Partial<Record<Role, unknown[]>>) {
  const seen: { role: Role; schema: unknown; options?: Sampling; prompt: string }[] = [];
  const call: ModelCall = async ({ role, prompt, model, schema, options }) => {
    seen.push({ role, schema, options, prompt });
    const next = replies[role]?.shift();
    if (next === undefined) throw new Error(`unexpected ${role} call`);
    return { ok: true, text: typeof next === "string" ? next : JSON.stringify(next), servedModel: model, durationMs: 1 };
  };
  return { call, seen };
}
const live = await sandboxAvailability();
const skip = live.available ? false : "SKIPPED (not passed): sandbox unavailable";

test("R4-G2 task graph: bounded, acyclic, four agents at most; samples follow the deterministic profile", () => {
  const strict = profileCodingTask({ ...TASK, spec: "Any other string (empty, unknown unit, spaces, wrong order) must raise ValueError." });
  assert.equal(strict.complexity, "high");
  const g = buildTaskGraph(strict, 3);
  assert.equal(g.workerSamples, 3);
  assert.deepEqual(validateGraph(g, { maxAgents: 4, maxNodes: 12 }), []);
  assert.deepEqual([...new Set(g.nodes.map(n => n.actor))].sort(), ["Planner", "Reviewer", "Tester", "Worker", "orchestrator"]);
  assert.equal(buildTaskGraph(profileCodingTask({ ...TASK, testerRule: "reference-validated", spec: "Define double(x) returning 2 * x." }), 9).workerSamples, 3, "samples are capped");
  assert.equal(profileCodingTask({ ...TASK, testerRule: "reference-validated", spec: "Define double(x) returning 2 * x." }).complexity, "low");
  const cyclic: TaskGraph = { taskId: "x", workerSamples: 1, nodes: [{ id: "a", kind: "plan", actor: "Planner", dependsOn: ["b"] }, { id: "b", kind: "implement", actor: "Worker", dependsOn: ["a"] }, { id: "c", kind: "test", actor: "Tester", dependsOn: ["zz"] }] };
  const problems = validateGraph(cyclic, { maxAgents: 1, maxNodes: 2 });
  assert.ok(problems.some(p => p.startsWith("cycle")), problems.join("; "));
  assert.ok(problems.includes("c depends on unknown zz"));
  assert.ok(problems.includes("more than 2 nodes") && problems.includes("more than 1 agents"));
  assert.equal(strict.budgets.maxRepairs, 2, "the repair limit is never raised by the profile");
  assert.equal(profileCodingTask(TASK, { maxRepairs: 9 }).budgets.maxRepairs, 2);
});

test("fenced transport: the module is the longest block; an unfenced reply is the file; empty is nothing", () => {
  assert.equal(extractCode(fence(GOOD)), GOOD);
  assert.equal(extractCode(GOOD), GOOD);
  assert.equal(extractCode("  \n"), null);
  assert.equal(extractCode("```py\nx = 1\n```"), "x = 1\n");
});

test("R4-G6 tools: a broker denial fails closed before any execution; receipts name the orchestrator", async () => {
  let executed = 0;
  const m = scripted({ Planner: [planner], Worker: [fence(GOOD)], Tester: [fence(VALID)] });
  const r = await runCodingWorkflow(TASK, { call: m.call, pins, strategy: { ...STRATEGY_S1R4, workerSamples: 1 }, sandbox: async () => { executed++; throw new Error("never"); },
    authorize: manifest => ({ decision: manifest.id === "ma4.static_check" ? "deny" : "allow", reason: "denied by test policy", risk: manifest.risk }) });
  assert.equal(r.status, "sandbox_error"); assert.equal(executed, 0);
  assert.equal(r.failures.at(-1)?.failureCategory, "tool_failure");
  assert.deepEqual(r.toolReceipts.map(x => [x.tool, x.invoker, x.decision, x.ok]), [["ma4.static_check", "orchestrator", "deny", false]]);
});

test("R4-G6 tools: the per-workflow tool budget is enforced as resource exhaustion", async () => {
  const m = scripted({ Planner: [planner], Worker: [fence(GOOD)], Tester: [fence(VALID)] });
  const fake = async () => ({ exitCode: 0, stdout: "[]\n", stderr: "", timedOut: false, oomKilled: false, durationMs: 1 }) as never;
  const r = await runCodingWorkflow(TASK, { call: m.call, pins, sandbox: fake, strategy: { ...STRATEGY_S1R4, workerSamples: 1, maxToolCalls: 1 } });
  assert.equal(r.status, "sandbox_error");
  assert.equal(r.failures.at(-1)?.failureCategory, "resource_exhaustion");
  assert.equal(r.toolReceipts.filter(x => x.ok).length, 1);
});

test("R4-G3 verified sampling: Worker samples are ranked by the Tester's own tests, never by hidden tests or the reference", { skip }, async () => {
  const m = scripted({ Planner: [planner], Worker: [fence(BUGGY), fence(GOOD), fence(BUGGY)], Tester: [fence(VALID)], Reviewer: [review] });
  const runs: string[] = []; let selected = false;
  const sandbox = async (q: SandboxRequest, s?: AbortSignal) => { runs.push(`${selected ? "after" : "before"}:${Object.keys(q.files).sort().join(",")}`); return runSandboxed(q, s); };
  const r = await runCodingWorkflow(TASK, { call: m.call, pins, sandbox, strategy: { ...STRATEGY_S1R4, workerSamples: 3 }, onEvent: e => { if (e.startsWith("samples:")) selected = true; } });
  assert.equal(r.status, "passed", r.reason);
  assert.deepEqual(r.candidates.map(c => [c.index, c.staticOk, c.testsPassed, c.selected]), [[0, true, 1, false], [1, true, 2, true], [2, true, 1, false]]);
  assert.ok(runs.filter(x => x.startsWith("before")).every(x => !x.includes("test_hidden")), "selection never runs the hidden tests");
  assert.equal(r.finalSource, GOOD);
  // Sampling is per role; code-bearing roles use free text (no JSON schema), Planner/Reviewer keep schema decoding.
  assert.deepEqual(m.seen.map(x => [x.role, x.schema === null, x.options?.temperature]), [["Planner", false, 0.2], ["Worker", true, 0.2], ["Worker", true, 0.8], ["Worker", true, 0.8], ["Tester", true, 0.2], ["Reviewer", false, 0.2]]);
  assert.ok(r.toolReceipts.length > 0 && r.toolReceipts.every(x => x.invoker === "orchestrator" && x.decision === "allow" && x.ok));
});

test("R4-G5 an identical repair is unproductive: recorded with both hashes, and the loop stops", { skip }, async () => {
  const m = scripted({ Planner: [planner], Worker: [fence(BUGGY), fence(BUGGY, "The range check looks fine.\n")], Tester: [fence(VALID)], Reviewer: [{ verdict: "reject", findings: [], confidence: 0.5 }] });
  const r = await runCodingWorkflow(TASK, { call: m.call, pins, sandbox: runSandboxed, strategy: { ...STRATEGY_S1R4, workerSamples: 1 } });
  assert.equal(r.status, "failed");
  assert.equal(r.attempts.length, 1, "no retest of an unchanged artifact");
  assert.equal(r.repairs.length, 1);
  assert.equal(r.repairs[0].proposal, "identical");
  assert.equal(r.repairs[0].previousSha256, r.repairs[0].proposedSha256);
  assert.equal(r.repairs[0].remaining, 1);
  assert.match(m.seen.find(x => x.role === "Worker" && x.prompt.includes("REPAIR"))!.prompt, /what the failing checks show is wrong/);
});

test("R4-G4/R4-G9 role assignment: pins win and are never substituted; evidence ranks eligible models; high risk abstains", () => {
  const ev: RoleEvidence[] = [
    { model: "a:7b", role: "Worker", passes: 9, samples: 10, evaluator: "dev-v1" }, { model: "b:7b", role: "Worker", passes: 4, samples: 10, evaluator: "dev-v1" },
    { model: "a:7b", role: "Tester", passes: 1, samples: 2, evaluator: "dev-v1" },
  ];
  const cands = [{ model: "b:7b", exclusion: null }, { model: "a:7b", exclusion: null }, { model: "c:cloud", exclusion: "External inference needs an owner-issued approval." }];
  assert.deepEqual([assignRole("Worker", cands, ev).model, assignRole("Worker", cands, ev).decision], ["a:7b", "measured"]);
  assert.deepEqual([assignRole("Worker", cands, ev, { pin: "b:7b" }).model, assignRole("Worker", cands, ev, { pin: "b:7b" }).decision], ["b:7b", "pinned"]);
  const blocked = assignRole("Worker", cands, ev, { pin: "c:cloud" });
  assert.equal(blocked.model, null); assert.equal(blocked.decision, "abstain"); assert.match(blocked.reasons[0], /no substitute/);
  assert.equal(assignRole("Tester", cands, ev).decision, "unproven", "fewer than 3 samples earn nothing");
  assert.equal(assignRole("Tester", cands, ev).model, "b:7b", "ties keep the caller's (local-first) order");
  const risky = assignRole("Tester", cands, ev, { highRisk: true });
  assert.equal(risky.model, null); assert.equal(risky.decision, "abstain");
  assert.equal(assignRole("Worker", cands, ev, { highRisk: true }).model, "a:7b");
  assert.equal(assignRole("Worker", [{ model: "c:cloud", exclusion: "not approved" }], ev).decision, "abstain");
});
