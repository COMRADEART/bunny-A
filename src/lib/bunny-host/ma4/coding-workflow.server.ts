/**
 * MA4-S1R3 fault-aware coding workflow:
 *   Planner → frozen Task Contract → (Worker ∥ Tester) → static validation → sandboxed tests → failure attribution →
 *   targeted repair → retest → Reviewer → deterministic gate.
 * Every role output is a schema-validated, hashed artifact (malformed → repaired by its producer within the budget, never
 * executed). Pins come from the caller, never from artifacts. Acceptance is decided only by non-LLM checks run in the
 * OS-enforced sandbox; the Reviewer's verdict is recorded and measured but can never turn a failing result into a pass.
 * Each failure is attributed from deterministic evidence to the component that caused it, and only that component is
 * repaired. Repair rounds are bounded (≤ 2 per trial, shared by every agent).
 * MA4-S1R4 strategy v3 (opt-in; the default stays S1R3 behaviour): code-bearing artifacts travel as fenced code instead of
 * JSON strings, the Worker may draw up to 3 independent samples that the orchestrator ranks by the Tester's own tests
 * (never the hidden tests or the reference), per-role sampling, an identical repair stops the loop, and every
 * deterministic tool runs through the permission broker with a bounded count and a receipt.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SandboxRequest, SandboxResult } from "./sandbox.server.ts";
import type { ActionManifest, PermissionDecision } from "../../bunny-missions/types.ts";
import { decide } from "../../bunny-missions/authorization.server.ts";
import { buildTaskGraph, profileCodingTask, workerSamplesFor, type TaskGraph, type TaskProfile } from "./task-intelligence.ts";

const line = (max = 300) => z.string().min(1).max(max);
// Module names only; enforced at decode time (Ollama honours `pattern`), so prose like "re (regex module)" cannot be emitted.
const moduleName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]{0,59}$/);
export const PlannerArtifactSchema = z.object({
  requirements: z.array(line()).min(1).max(12), plan: z.array(line()).min(1).max(10),
  acceptance: z.array(line()).min(1).max(12), constraints: z.array(line()).max(10), dependencies: z.array(moduleName).max(10),
}).strict();
export const WorkerArtifactSchema = z.object({
  source: z.string().min(1).max(20_000), notes: z.string().max(1000), dependencies: z.array(moduleName).max(10), files: z.array(line(80)).min(1).max(3),
}).strict();
export const TesterArtifactSchema = z.object({
  tests_source: z.string().min(1).max(20_000), cases: z.array(z.object({ name: line(100), expected: line(300) }).strict()).min(1).max(30), rationale: z.string().max(1000),
}).strict();
/** Fenced transport (S1R4): the code is the artifact; imports are checked from the AST, never from a declared list. */
export const FencedWorkerSchema = z.object({ source: z.string().min(1).max(20_000) }).strict();
export const FencedTesterSchema = z.object({ tests_source: z.string().min(1).max(20_000) }).strict();
export const ReviewerArtifactSchema = z.object({
  verdict: z.enum(["approve", "reject"]),
  findings: z.array(z.object({ severity: z.enum(["blocking", "major", "minor"]), issue: line(400), recommendation: z.string().max(400), evidence: z.string().max(300) }).strict()).max(10),
  confidence: z.number().min(0).max(1),
}).strict();
export type PlannerArtifact = z.infer<typeof PlannerArtifactSchema>;
export type WorkerArtifact = z.infer<typeof WorkerArtifactSchema>;
export type TesterArtifact = z.infer<typeof TesterArtifactSchema>;
export type ReviewerArtifact = z.infer<typeof ReviewerArtifactSchema>;

export type Role = "Planner" | "Worker" | "Tester" | "Reviewer";
/** Host-owned task facts. A model can neither see the hidden tests/reference nor change module, imports or rules. */
export type CodingTask = {
  id: string; spec: string; module: string; allowedImports: string[]; hiddenTests: string; reference?: string;
  /** "all-pass": every Tester test must pass (G7 v2 rule). "reference-validated": only tests the frozen reference passes count; >= 1 required. */
  testerRule: "all-pass" | "reference-validated";
};
/** `schema` null = free-text reply (fenced code transport). `options` absent = the caller's defaults (S1R3 behaviour). */
export type ModelCall = (request: { role: Role; model: string; prompt: string; schema: Record<string, unknown> | null; signal: AbortSignal; attempt: number; options?: Sampling }) =>
  Promise<{ ok: true; text: string; servedModel: string; durationMs: number } | { ok: false; error: string; stopped?: boolean; durationMs: number }>;
export type Sandbox = (request: SandboxRequest, signal?: AbortSignal) => Promise<SandboxResult>;
export type Sampling = { temperature?: number; numPredict?: number };
export type Authorize = (manifest: ActionManifest, params: Record<string, unknown>) => PermissionDecision;

export type WorkflowStrategy = {
  id: string;
  /** "json": code inside a JSON string (S1R3). "fenced": the reply is one fenced code block; no JSON escaping of code. */
  transport: "json" | "fenced";
  /** Independent first-attempt Worker samples; "adaptive" lets the task profile decide (1..3). */
  workerSamples: number | "adaptive";
  sampling: Partial<Record<Role | "WorkerSample" | "Repair", Sampling>>;
  maxToolCalls: number;
};
export const STRATEGY_S1R3: WorkflowStrategy = Object.freeze({ id: "s1r3", transport: "json", workerSamples: 1, sampling: {}, maxToolCalls: 200 });
export const STRATEGY_S1R4: WorkflowStrategy = Object.freeze({
  id: "s1r4-v3c", transport: "fenced", workerSamples: "adaptive",
  sampling: { Planner: { temperature: 0.2 }, Worker: { temperature: 0.2, numPredict: 2048 }, WorkerSample: { temperature: 0.8, numPredict: 2048 }, Tester: { temperature: 0.2, numPredict: 3072 }, Repair: { temperature: 0.6, numPredict: 3072 }, Reviewer: { temperature: 0.2 } },
  maxToolCalls: 60,
});

export type FailureCategory =
  | "schema_error" | "plan_invalid" | "implementation_invalid" | "dependency_violation" | "implementation_defect" | "test_invalid"
  | "ambiguous" | "reviewer_false_approval" | "unsupported_capability" | "timeout" | "model_error" | "pin_violation" | "sandbox_failure"
  | "tool_failure" | "resource_exhaustion";
export type Component = "planner" | "worker" | "tester" | "reviewer" | "router" | "infrastructure" | "none";
/** Structured failure attribution (one per distinct cause). `verified` = decided by a deterministic oracle. */
export type FailureRecord = {
  taskId: string; attempt: number;
  failingStage: "planning" | "generation" | "static_validation" | "sandbox_tests" | "review" | "infrastructure";
  failureCategory: FailureCategory; suspectedComponent: Component; evidence: string[];
  confidence: "verified" | "supported" | "ambiguous";
  recommendedAction: "repair_planner" | "repair_worker" | "repair_tester" | "route_capability" | "stop_infrastructure" | "diagnose" | "block_approval" | "stop";
  retryBudgetRemaining: number;
  /** Tester faults only: a syntax/load defect, an import-policy breach, or a semantic contradiction of the contract. */
  defect?: "syntax" | "policy" | "semantic";
};
export type ArtifactRecord = {
  taskId: string; producer: Role; model: string; contractVersion: string; attempt: number; sha256: string; bytes: number;
  validation: "valid" | "malformed" | "rejected"; createdAt: string;
};
/** `proposal` "identical" = the repair returned the previous artifact unchanged (unproductive; the loop stops). */
export type RepairRecord = { round: number; target: Role; categories: FailureCategory[]; evidence: string[]; outcome: "resolved" | "unresolved" | "not_retested";
  previousSha256?: string | null; proposedSha256?: string | null; proposal?: "valid" | "malformed" | "identical"; remaining?: number };
/** Every deterministic tool the orchestrator runs. `invoker` is always the orchestrator: these are never model tool calls. */
export type ToolReceipt = { index: number; tool: string; invoker: "orchestrator"; decision: PermissionDecision["decision"]; ok: boolean; durationMs: number; inputSha256: string };
export type CandidateRecord = { index: number; sha256: string | null; staticOk: boolean; testsPassed: number; testsTotal: number; selected: boolean };

type TestOutcome = { id: string; passed: boolean; message: string };
type TestRun = { loadError: string | null; results: TestOutcome[] };
export type AttemptRecord = {
  attempt: number; static: { ok: boolean; errors: string[] }; hidden: { ran: boolean; passed: boolean; total: number; failed: number };
  tester: { ran: boolean; total: number; valid: number; failedValid: string[]; passed: boolean }; accepted: boolean; durationMs: number;
  failures: FailureRecord[]; repaired: Role[]; feedback?: string;
};
export type WorkflowResult = {
  taskId: string; status: "passed" | "failed" | "malformed_artifact" | "pin_violation" | "model_error" | "cancelled" | "sandbox_error";
  reason: string; attempts: AttemptRecord[]; repairsUsed: number; calls: { role: Role; model: string; attempt: number; ok: boolean; durationMs: number; startedAt: number; endedAt: number; servedModel?: string }[];
  reviewer: { verdict: ReviewerArtifact["verdict"]; confidence: number; findings: number } | null; reviewerFalseApproval: boolean; reviewerFalseRejection: boolean;
  workerTesterConcurrent: boolean; finalSource: string | null; finalTests: string | null;
  contractVersion: string | null; failures: FailureRecord[]; repairs: RepairRecord[]; artifacts: ArtifactRecord[];
  strategy: string; profile: TaskProfile | null; graph: TaskGraph | null; candidates: CandidateRecord[]; toolReceipts: ToolReceipt[];
};

/** What one evaluation observed; the input of the pure attribution step. `oracle` = Tester tests run against the frozen reference. */
export type AttemptObservation = {
  testerRule: CodingTask["testerRule"]; sourceErrors: string[]; testErrors: string[];
  hidden: { ran: boolean; passed: boolean }; generated: TestRun | null; oracle: TestRun | null;
};
export type Attribution = Pick<FailureRecord, "failingStage" | "failureCategory" | "suspectedComponent" | "evidence" | "confidence"> & { testIds?: string[] };

/**
 * Deterministic failure attribution. A failing generated test is blamed on the Tester only when an oracle proves it wrong
 * (static/policy error, or it fails on the frozen reference); it is blamed on the Worker only when the test is proven
 * valid or the independent acceptance suite fails. Without an oracle the disagreement is reported as ambiguous.
 * Only failures that block acceptance are attributed.
 */
export function attributeAttempt(o: AttemptObservation): Attribution[] {
  const out: Attribution[] = [];
  const deps = o.sourceErrors.filter(e => /import of '|declared dependency/.test(e)), other = o.sourceErrors.filter(e => !deps.includes(e));
  if (other.length) out.push({ failingStage: "static_validation", failureCategory: "implementation_invalid", suspectedComponent: "worker", evidence: other, confidence: "verified" });
  if (deps.length) out.push({ failingStage: "static_validation", failureCategory: "dependency_violation", suspectedComponent: "worker", evidence: deps, confidence: "verified" });
  if (o.testErrors.length) out.push({ failingStage: "static_validation", failureCategory: "test_invalid", suspectedComponent: "tester", evidence: o.testErrors, confidence: "verified" });
  if (o.hidden.ran && !o.hidden.passed) out.push({ failingStage: "sandbox_tests", failureCategory: "implementation_defect", suspectedComponent: "worker", evidence: ["independent acceptance suite failed"], confidence: "verified" });
  const g = o.generated;
  if (!g) return out;
  const oraclePass = o.oracle && !o.oracle.loadError ? new Set(o.oracle.results.filter(x => x.passed).map(x => x.id)) : o.oracle ? new Set<string>() : null;
  if (g.loadError) {
    if (!o.oracle) out.push({ failingStage: "sandbox_tests", failureCategory: "ambiguous", suspectedComponent: "none", evidence: [`generated tests did not load and no oracle exists: ${g.loadError}`], confidence: "ambiguous" });
    else if (o.oracle.loadError) out.push({ failingStage: "sandbox_tests", failureCategory: "test_invalid", suspectedComponent: "tester", evidence: [`tests do not load even against the frozen reference: ${o.oracle.loadError}`], confidence: "verified" });
    else out.push({ failingStage: "sandbox_tests", failureCategory: "implementation_defect", suspectedComponent: "worker", evidence: [`tests load against the frozen reference but not against the implementation: ${g.loadError}`], confidence: "verified" });
    return out;
  }
  if (!g.results.length) { out.push({ failingStage: "sandbox_tests", failureCategory: "test_invalid", suspectedComponent: "tester", evidence: ["the test module defines no tests"], confidence: "verified" }); return out; }
  const failing = g.results.filter(x => !x.passed);
  if (!oraclePass) {
    if (failing.length && o.hidden.passed) out.push({ failingStage: "sandbox_tests", failureCategory: "ambiguous", suspectedComponent: "none", evidence: [`generated tests ${failing.map(x => x.id).join(", ")} fail on code that passes acceptance; no oracle decides which is wrong`], confidence: "ambiguous", testIds: failing.map(x => x.id) });
    else if (failing.length) out.push({ failingStage: "sandbox_tests", failureCategory: "implementation_defect", suspectedComponent: "worker", evidence: failing.map(x => x.id), confidence: "supported", testIds: failing.map(x => x.id) });
    return out;
  }
  const exposing = failing.filter(x => oraclePass.has(x.id));
  if (exposing.length) out.push({ failingStage: "sandbox_tests", failureCategory: "implementation_defect", suspectedComponent: "worker", evidence: exposing.map(x => `${x.id} passes on the frozen reference`), confidence: "verified", testIds: exposing.map(x => x.id) });
  // All-pass rule: a test the reference fails blocks every contract-correct implementation, even if it passes buggy code
  // today, so while the attempt fails anyway it is repaired now rather than after the Worker is fixed.
  const wrong = g.results.filter(x => !oraclePass.has(x.id) && (!x.passed || out.length > 0 || failing.length > 0));
  if (o.testerRule === "all-pass" && wrong.length) out.push({ failingStage: "sandbox_tests", failureCategory: "test_invalid", suspectedComponent: "tester", evidence: wrong.map(x => `${x.id} fails on the frozen reference`), confidence: "verified", testIds: wrong.map(x => x.id) });
  if (o.testerRule === "reference-validated" && !g.results.some(x => oraclePass.has(x.id))) out.push({ failingStage: "sandbox_tests", failureCategory: "test_invalid", suspectedComponent: "tester", evidence: ["no generated test is consistent with the frozen reference"], confidence: "verified", testIds: g.results.map(x => x.id) });
  return out;
}

const STATIC_CHECK = `import ast, json, sys
module, allowed = sys.argv[1], set(json.loads(sys.argv[2]))
errors = []
def check(path, kind):
    try:
        tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
    except SyntaxError as e:
        errors.append(f"{kind}: syntax error line {e.lineno}: {e.msg}"); return
    for n in ast.walk(tree):
        names = [a.name for a in n.names] if isinstance(n, ast.Import) else [n.module or ""] if isinstance(n, ast.ImportFrom) else []
        for name in names:
            root = name.split(".")[0]
            if (isinstance(n, ast.ImportFrom) and n.level) or root not in allowed | ({module, "unittest"} if kind == "tests" else set()):
                errors.append(f"{kind}: import of '{name}' is not allowed")
    if kind == "source":
        for n in tree.body:
            ok = isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef, ast.Assign, ast.AnnAssign)) or (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str))
            main = isinstance(n, ast.If) and isinstance(n.test, ast.Compare) and isinstance(n.test.left, ast.Name) and n.test.left.id == "__name__"
            if not (ok or main):
                errors.append(f"source: line {n.lineno}: top-level {type(n).__name__} runs on import; only imports, definitions, constants and a __main__ guard are allowed")
check(module + ".py", "source")
check("test_generated.py", "tests")
print(json.dumps(errors))
`;
const PER_TEST_RUNNER = `import json, sys, unittest
sys.path.insert(0, ".")
results = []
class R(unittest.TestResult):
    def addSuccess(self, t): results.append({"id": t.id(), "passed": True, "message": ""})
    def addFailure(self, t, e): results.append({"id": t.id(), "passed": False, "message": self._exc_info_to_string(e, t)[-600:]})
    def addError(self, t, e): results.append({"id": t.id(), "passed": False, "message": self._exc_info_to_string(e, t)[-600:]})
try:
    suite = unittest.defaultTestLoader.loadTestsFromName(sys.argv[1])
except Exception as e:
    print(json.dumps({"loadError": f"{type(e).__name__}: {e}"[:600], "results": []})); sys.exit(0)
suite.run(R())
print(json.dumps({"loadError": None, "results": results}))
`;
const SANDBOX_LIMITS = { timeoutMs: 20_000, memoryMb: 256, pids: 8, outputBytes: 262_144 } as const;

function stripFence(source: string): string {
  const m = /^\s*```[a-zA-Z0-9_+-]*\r?\n([\s\S]*?)```\s*$/.exec(source);
  return (m ? m[1] : source).trim() + "\n";
}
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}…` : text;
const sanitize = (text: string, max = 2000) => clip(text.replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, ""), max);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** Fenced transport: the longest fenced block (a module, not a usage snippet); an unfenced reply is taken as the file. */
export function extractCode(text: string): string | null {
  const blocks = [...text.matchAll(/```[ \t]*(?:python3?|py)?[ \t]*\r?\n([\s\S]*?)```/gi)].map(m => m[1]);
  const code = blocks.length ? blocks.reduce((a, b) => b.length > a.length ? b : a) : text;
  return code.trim() ? code.trim() + "\n" : null;
}
/** The orchestrator's deterministic tools. All execute Python only inside the OS-enforced sandbox. */
const TOOL_MANIFESTS: Record<string, ActionManifest> = Object.fromEntries(([
  ["ma4.static_check", "Parse generated Python and check the import policy and import safety (sandboxed)."],
  ["ma4.import_smoke", "Import the generated module once (sandboxed, no network)."],
  ["ma4.run_tests", "Run a unittest module against generated code (sandboxed, no network)."],
] as const).map(([id, description]) => [id, { id, description, risk: "EXECUTE", inputs: [], outputs: "json", evidence: "receipt", timeoutMs: SANDBOX_LIMITS.timeoutMs, implemented: true } satisfies ActionManifest]));
/** The workstation user starts this workflow directly; the existing broker still decides every invocation. */
const DEFAULT_AUTHORIZE: Authorize = (manifest, params) => decide(manifest, params, { envelope: null, missionId: null, grants: [], direct: { confirmed: false } });
/** The Tester's own failing line and exception type, never the reference's values. */
function ownLine(tests: string, message: string): string {
  const n = [...message.matchAll(/test_generated\.py", line (\d+)/g)].at(-1)?.[1];
  const type = /(\w+(?:Error|Exception))(?::|$)/m.exec(message.split("\n").filter(Boolean).at(-1) ?? "")?.[1] ?? "failure";
  return n ? `line ${n}: ${sanitize(tests.split("\n")[Number(n) - 1]?.trim() ?? "", 200)} (${type})` : `(${type})`;
}
const ROLE_OF: Partial<Record<Component, Role>> = { planner: "Planner", worker: "Worker", tester: "Tester" };
const ACTION_OF: Record<Component, FailureRecord["recommendedAction"]> = { planner: "repair_planner", worker: "repair_worker", tester: "repair_tester", reviewer: "block_approval", router: "route_capability", infrastructure: "stop_infrastructure", none: "diagnose" };

export async function runCodingWorkflow(task: CodingTask, deps: {
  call: ModelCall; sandbox: Sandbox; pins: Record<Role, string>; maxRepairs?: number; signal?: AbortSignal; onEvent?: (event: string) => void;
  strategy?: WorkflowStrategy; authorize?: Authorize;
}): Promise<WorkflowResult> {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(task.module)) throw new Error("Task module must be a plain Python identifier.");
  const signal = deps.signal ?? new AbortController().signal;
  const maxRepairs = Math.max(0, Math.min(deps.maxRepairs ?? 2, 2));
  const pins = Object.freeze({ ...deps.pins });
  const strategy = deps.strategy ?? STRATEGY_S1R3, authorize = deps.authorize ?? DEFAULT_AUTHORIZE;
  const fenced = strategy.transport === "fenced";
  const profile = strategy.workerSamples === "adaptive" ? profileCodingTask(task, { maxRepairs }) : null;
  const samples = profile ? workerSamplesFor(profile.complexity) : Math.max(1, Math.min(3, strategy.workerSamples as number));
  const result: WorkflowResult = { taskId: task.id, status: "failed", reason: "", attempts: [], repairsUsed: 0, calls: [], reviewer: null, reviewerFalseApproval: false, reviewerFalseRejection: false, workerTesterConcurrent: false, finalSource: null, finalTests: null,
    contractVersion: null, failures: [], repairs: [], artifacts: [], strategy: strategy.id, profile, graph: profile ? buildTaskGraph(profile, samples) : null, candidates: [], toolReceipts: [] };
  const fail = (attempt: number, a: Attribution): FailureRecord => {
    const record: FailureRecord = { taskId: task.id, attempt, ...a, evidence: a.evidence.map(e => sanitize(e, 300)).slice(0, 8), recommendedAction: a.failureCategory === "ambiguous" ? "diagnose" : ACTION_OF[a.suspectedComponent], retryBudgetRemaining: maxRepairs - result.repairsUsed };
    if (a.failureCategory === "test_invalid") record.defect = a.evidence.some(e => /import of '/.test(e)) ? "policy" : a.evidence.some(e => /syntax error|do not load|defines no tests/.test(e)) ? "syntax" : "semantic";
    delete (record as Attribution).testIds;
    result.failures.push(record); deps.onEvent?.(`failure ${a.failureCategory} → ${a.suspectedComponent}`);
    return record;
  };
  const done = (status: WorkflowResult["status"], reason: string) => Object.assign(result, { status, reason });
  const terminal = (attempt: number, stage: FailureRecord["failingStage"], category: FailureCategory, component: Component, status: WorkflowResult["status"], reason: string) => {
    fail(attempt, { failingStage: stage, failureCategory: category, suspectedComponent: component, evidence: [reason], confidence: "verified" });
    return done(status, reason);
  };
  const isResult = (x: unknown): x is WorkflowResult => x === result;
  let contractVersion = `task:${sha256(task.spec).slice(0, 16)}`;
  type Asked<T> = { ok: true; data: T } | { ok: false; issue: string };
  /** One model call. Terminal problems (pin, model, cancellation) end the workflow; a malformed artifact is returned for repair. */
  const ask = async <T>(role: Role, prompt: string, schema: z.ZodType<T>, attempt: number, how: { sampling?: Sampling; fenced?: "source" | "tests_source" } = {}): Promise<Asked<T> | WorkflowResult> => {
    if (signal.aborted) return done("cancelled", "Cancelled.");
    if (profile && result.calls.length >= profile.budgets.maxModelCalls) return terminal(attempt, "generation", "resource_exhaustion", "infrastructure", "model_error", `Model-call budget of ${profile.budgets.maxModelCalls} exhausted.`);
    const startedAt = Date.now();
    const r = await deps.call({ role, model: pins[role], prompt, schema: how.fenced ? null : z.toJSONSchema(schema) as Record<string, unknown>, signal, attempt, ...(how.sampling ? { options: how.sampling } : {}) });
    result.calls.push({ role, model: pins[role], attempt, ok: r.ok, durationMs: r.durationMs, startedAt, endedAt: Date.now(), ...(r.ok ? { servedModel: r.servedModel } : {}) });
    deps.onEvent?.(`${role}#${attempt} ${r.ok ? "ok" : "error"}`);
    if (!r.ok) {
      if (signal.aborted || r.stopped) return done("cancelled", "Cancelled.");
      const error = `${role}: ${sanitize(r.error, 300)}`;
      // The execution layer rejects unparseable structured output itself; that is a malformed artifact, not a model failure.
      if (/invalid structured JSON/i.test(r.error)) {
        result.artifacts.push({ taskId: task.id, producer: role, model: pins[role], contractVersion, attempt, sha256: sha256(""), bytes: 0, validation: "malformed", createdAt: new Date().toISOString() });
        return { ok: false, issue: `${role} artifact is not JSON.` };
      }
      if (/did not finish within|timed out|timeout/i.test(r.error)) return terminal(attempt, "generation", "timeout", "infrastructure", "model_error", error);
      if (/does not support|unsupported|no longer available|not found|not installed/i.test(r.error)) return terminal(attempt, "generation", "unsupported_capability", "router", "model_error", error);
      return terminal(attempt, "generation", "model_error", "router", "model_error", error);
    }
    if (r.servedModel !== pins[role]) return terminal(attempt, "generation", "pin_violation", "router", "pin_violation", `${role} was served by ${r.servedModel}, not the pinned ${pins[role]}; no substitution is accepted.`);
    const record = (validation: ArtifactRecord["validation"]) => result.artifacts.push({ taskId: task.id, producer: role, model: r.servedModel, contractVersion, attempt, sha256: sha256(r.text), bytes: r.text.length, validation, createdAt: new Date().toISOString() });
    let raw: unknown;
    if (how.fenced) raw = { [how.fenced]: extractCode(r.text) ?? "" };
    else try { raw = JSON.parse(r.text); } catch { record("malformed"); return { ok: false, issue: `${role} artifact is not JSON.` }; }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) { record("malformed"); return { ok: false, issue: `${role} artifact failed its schema: ${sanitize(parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; "), 300)}` }; }
    record("valid");
    return { ok: true, data: parsed.data };
  };
  const schemaFailure = (attempt: number, role: Role, issue: string, stage: FailureRecord["failingStage"] = "generation") =>
    fail(attempt, { failingStage: stage, failureCategory: "schema_error", suspectedComponent: role.toLowerCase() as Component, evidence: [issue], confidence: "verified" });
  const spend = (round: number, target: Role, records: FailureRecord[]) => {
    result.repairs.push({ round, target, categories: [...new Set(records.map(f => f.failureCategory))], evidence: records.flatMap(f => f.evidence).slice(0, 6), outcome: "not_retested" });
  };
  const settle = (round: number, failures: FailureRecord[]) => {
    for (const r of result.repairs) if (r.round === round) r.outcome = failures.some(f => ROLE_OF[f.suspectedComponent] === r.target) ? "unresolved" : "resolved";
  };

  // Planning: the Planner's advisory artifact may not contradict host task facts (allowed imports). Repairs share the budget.
  const allowedForPlan = new Set([...task.allowedImports, task.module, "unittest"]);
  const plannerBase = `You are the Planner agent. Task: ${task.spec}\nThe implementation is a Python module named ${task.module} (file ${task.module}.py). Allowed imports: ${task.allowedImports.join(", ") || "none"}.\nReturn JSON with requirements, plan (short steps), acceptance (checkable conditions), constraints and dependencies (module names only, each from the allowed imports).`;
  let planner: PlannerArtifact | null = null;
  for (let feedback = ""; ;) {
    const r = await ask("Planner", plannerBase + feedback, PlannerArtifactSchema, result.repairsUsed, { sampling: strategy.sampling.Planner });
    if (isResult(r)) return r;
    const bad = r.ok ? r.data.dependencies.filter(d => !allowedForPlan.has(d.split(".")[0])) : [];
    const record = !r.ok ? schemaFailure(result.repairsUsed, "Planner", r.issue, "planning")
      : bad.length ? fail(result.repairsUsed, { failingStage: "planning", failureCategory: "plan_invalid", suspectedComponent: "planner", evidence: [`dependencies outside the allowed imports: ${bad.join(", ")}`], confidence: "verified" }) : null;
    if (result.repairs.length) settle(result.repairsUsed, record ? [record] : []);
    if (!record && r.ok) { planner = r.data; break; }
    if (result.repairsUsed >= maxRepairs) return done(r.ok ? "failed" : "malformed_artifact", `Planner: ${record!.evidence[0]} (repair budget exhausted).`);
    result.repairsUsed++; spend(result.repairsUsed, "Planner", [record!]);
    feedback = `\nREPAIR ${result.repairsUsed} of ${maxRepairs}. Your previous plan was rejected: ${record!.evidence[0]}. Allowed imports: ${task.allowedImports.join(", ") || "none"}.`;
  }
  // The contract is immutable input for both parallel roles; the planner only adds advisory text.
  const contract = Object.freeze({ spec: task.spec, module: task.module, file: `${task.module}.py`, allowedImports: Object.freeze([...task.allowedImports]), planner: Object.freeze(structuredClone(planner)) });
  const contractText = JSON.stringify(contract, null, 1);
  result.contractVersion = contractVersion = `contract:${sha256(contractText).slice(0, 16)}`;
  // A debugging task describes the defect; the described wrong behaviour is the bug, never a requirement.
  const defectNote = (profile ?? profileCodingTask(task, { maxRepairs })).category === "debugging" ? " The task describes a defect: the wrong behaviour it describes is the bug to remove, not a requirement to keep or test." : "";
  const workerPrompt = (extra = "") => fenced
    ? `You are the Worker agent. Implement the task contract below as the complete source of ${contract.file}. Rules: only imports, definitions and constants at top level (no demo code, prints, input or tests); standard library only, limited to the allowed imports; implement every stated requirement; raise exactly the errors the contract states for the invalid inputs it lists, and add no validation or errors it does not ask for.${defectNote}\nCONTRACT:\n${contractText}${extra}\n${extra ? "First state in one or two sentences what the failing checks show is wrong" : "First write a short checklist of the required behaviours (and of the invalid inputs, only if the contract lists any), one line each"}; then give the complete file in a single \`\`\`python code block.`
    : `You are the Worker agent. Implement the task contract below as the complete source of ${contract.file}. Only definitions at top level (no demo code, prints or input at import time). Standard library only, limited to the allowed imports.\nCONTRACT:\n${contractText}${extra}\nReturn JSON: source (the full file text), notes, dependencies (module names imported), files (["${contract.file}"]).`;
  const testerPrompt = (extra = "") => fenced
    ? `You are the Tester agent. Write a Python unittest module for the task contract below, without seeing any implementation. It must start with:\nimport unittest\nfrom ${task.module} import *\nTest only behaviour the contract states explicitly: use the examples given in the task text, and for every invalid-input class the contract lists, check the stated error. Do not test inputs whose result the contract does not determine. Write one test method per case (one assertion each), so each case passes or fails on its own. Derive every expected value from the contract text and double-check the arithmetic.${defectNote} Imports are limited to unittest, ${task.module} and the allowed imports.\nCONTRACT:\n${contractText}${extra}\n${extra ? "First state in one or two sentences which of your tests contradict the contract and why" : "First list each case you will test with its expected result as the contract determines it, one line each"}; then give the complete test file in a single \`\`\`python code block.`
    : `You are the Tester agent. Write a Python unittest module for the task contract below, without seeing any implementation. It must start with: import unittest\nfrom ${task.module} import *\nCover normal cases, edge cases and the required errors. Imports are limited to unittest, ${task.module} and the allowed imports.\nCONTRACT:\n${contractText}${extra}\nReturn JSON: tests_source (the full test file), cases (name and expected behaviour of each), rationale.`;
  type WorkerData = Pick<WorkerArtifact, "source"> & Partial<WorkerArtifact>;
  type TesterData = Pick<TesterArtifact, "tests_source"> & Partial<TesterArtifact>;
  const askWorker = (extra: string, attempt: number, sampling?: Sampling) => ask<WorkerData>("Worker", workerPrompt(extra), fenced ? FencedWorkerSchema : WorkerArtifactSchema, attempt, { sampling, ...(fenced ? { fenced: "source" as const } : {}) });
  const askTester = (extra: string, attempt: number, sampling?: Sampling) => ask<TesterData>("Tester", testerPrompt(extra), fenced ? FencedTesterSchema : TesterArtifactSchema, attempt, { sampling, ...(fenced ? { fenced: "tests_source" as const } : {}) });

  // Worker ∥ Tester as in S1R3; extra samples run afterwards, so no request queues behind more than one other.
  const pair = await Promise.all([askWorker("", result.repairsUsed, strategy.sampling.Worker), askTester("", result.repairsUsed, strategy.sampling.Tester)]);
  const first: (Asked<WorkerData> | Asked<TesterData> | WorkflowResult)[] = [pair[0]];
  for (let i = 1; i < samples && !pair.some(isResult); i++) { const x = await askWorker("", result.repairsUsed, strategy.sampling.WorkerSample); first.push(x); if (isResult(x)) break; }
  first.push(pair[1]);
  const w = result.calls.find(c => c.role === "Worker"), t = result.calls.find(c => c.role === "Tester");
  // In flight at the same time (the runtime may still serialize generation internally).
  result.workerTesterConcurrent = !!w && !!t && w.startedAt < t.endedAt && t.startedAt < w.endedAt;
  for (const x of first) if (isResult(x)) return x;
  const workerSamples = first.slice(0, samples) as Asked<WorkerData>[];
  let workerReply = workerSamples[0], testerReply = first[samples] as Asked<TesterData>;

  let toolCalls = 0;
  /** Every deterministic tool goes through the permission broker, is counted against a budget and leaves a receipt. */
  const sandboxRun = async (tool: keyof typeof TOOL_MANIFESTS, files: Record<string, string>, argv: string[]) => {
    const manifest = TOOL_MANIFESTS[tool], inputSha256 = sha256(JSON.stringify([argv, Object.entries(files)]));
    const decision = authorize(manifest, { tool, argv: argv.slice(0, 2) });
    const receipt = (ok: boolean, durationMs = 0) => result.toolReceipts.push({ index: result.toolReceipts.length, tool, invoker: "orchestrator", decision: decision.decision, ok, durationMs, inputSha256 });
    if (decision.decision !== "allow") { receipt(false); throw Object.assign(new Error(`${tool} was not authorized: ${decision.reason}`), { tool: "tool_failure" }); }
    if (++toolCalls > strategy.maxToolCalls) { receipt(false); throw Object.assign(new Error(`tool budget of ${strategy.maxToolCalls} invocations exhausted`), { tool: "resource_exhaustion" }); }
    const started = Date.now();
    try { const r = await deps.sandbox({ files, argv: ["python3", "-I", "-S", ...argv], ...SANDBOX_LIMITS }, signal); receipt(true, Date.now() - started); return r; }
    catch (e) { receipt(false, Date.now() - started); throw Object.assign(new Error(signal.aborted ? "cancelled" : `sandbox: ${(e as Error).message}`), { sandbox: true }); }
  };
  const runTests = async (source: string, testFile: string, testSource: string): Promise<TestRun> => {
    const r = await sandboxRun("ma4.run_tests", { [`${task.module}.py`]: source, [`${testFile}.py`]: testSource, "per_test.py": PER_TEST_RUNNER }, ["per_test.py", testFile]);
    try { const o = JSON.parse(r.stdout.trim().split("\n").pop() ?? ""); return { loadError: o.loadError, results: (o.results as TestOutcome[]).map(x => ({ ...x, message: sanitize(String(x.message), 600) })) }; }
    catch { return { loadError: r.timedOut ? "test run timed out" : r.oomKilled ? "test run exceeded memory" : sanitize(r.stderr.split("\n").filter(Boolean).pop() ?? "no result", 300), results: [] }; }
  };
  // Oracle runs of the Tester's tests against the frozen reference, cached per test version; the reference never reaches a model.
  const oracleCache = new Map<string, TestRun>();
  /** Parse + import policy + import safety, inside the sandbox. Errors are prefixed "source:" or "tests:". */
  const staticErrors = async (worker: WorkerData, source: string, tests: string) => {
    const errors: string[] = [];
    if (worker.files && (worker.files.length !== 1 || worker.files[0] !== contract.file)) errors.push(`source: files must be exactly ["${contract.file}"]`);
    for (const d of worker.dependencies ?? []) if (!task.allowedImports.includes(d.split(".")[0]) && d !== task.module) errors.push(`source: declared dependency '${sanitize(d, 60)}' is not allowed`);
    const staticRun = await sandboxRun("ma4.static_check", { [`${task.module}.py`]: source, "test_generated.py": tests, "static_check.py": STATIC_CHECK }, ["static_check.py", task.module, JSON.stringify(task.allowedImports)]);
    try { errors.push(...(JSON.parse(staticRun.stdout.trim().split("\n").pop() ?? "") as string[])); } catch { errors.push("source: static check produced no result"); }
    if (!errors.some(e => e.startsWith("source"))) {
      const smoke = await sandboxRun("ma4.import_smoke", { [`${task.module}.py`]: source }, ["-c", `import sys; sys.path.insert(0, "."); import ${task.module}`]);
      if (smoke.exitCode !== 0) errors.push(`source: importing the module failed: ${sanitize(smoke.stderr.split("\n").filter(Boolean).pop() ?? (smoke.timedOut ? "timeout" : "error"), 300)}`);
    }
    return errors.map(e => sanitize(e, 300));
  };

  try {
    // Verified sampling: rank independent Worker samples by the Tester's OWN tests (unvalidated; never the hidden tests
    // or the reference, which are acceptance-only). Ties keep the lowest-temperature sample.
    if (workerSamples.length > 1) {
      const tests = testerReply.ok ? stripFence(testerReply.data.tests_source) : "import unittest\n";
      const scored = [];
      for (const [index, reply] of workerSamples.entries()) {
        const source = reply.ok ? stripFence(reply.data.source) : null;
        const errors = source && reply.ok ? await staticErrors(reply.data, source, tests) : ["unusable"];
        const staticOk = !errors.some(e => !e.startsWith("tests"));
        const run = staticOk && testerReply.ok && !errors.length ? await runTests(source!, "test_generated", tests) : null;
        const testsPassed = run && !run.loadError ? run.results.filter(x => x.passed).length : 0;
        scored.push({ index, sha256: source ? sha256(source) : null, staticOk, testsPassed, testsTotal: run?.results.length ?? 0, selected: false });
      }
      const best = scored.reduce((a, b) => (+b.staticOk - +a.staticOk || b.testsPassed - a.testsPassed) > 0 ? b : a);
      best.selected = true;
      result.candidates = scored;
      workerReply = workerSamples[best.index];
      deps.onEvent?.(`samples: ${scored.map(s => `${s.index}:${s.staticOk ? s.testsPassed + "/" + s.testsTotal : "invalid"}`).join(" ")} → ${best.index}`);
    }
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      const record: AttemptRecord = { attempt, static: { ok: false, errors: [] }, hidden: { ran: false, passed: false, total: 0, failed: 0 }, tester: { ran: false, total: 0, valid: 0, failedValid: [], passed: false }, accepted: false, durationMs: 0, failures: [], repaired: [] };
      result.attempts.push(record);
      const source = workerReply.ok ? stripFence(workerReply.data.source) : null, tests = testerReply.ok ? stripFence(testerReply.data.tests_source) : null;
      if (source) result.finalSource = source;
      if (tests) result.finalTests = tests;
      let attributions: Attribution[] = [];
      let generated: TestRun | null = null;
      if (!workerReply.ok || !testerReply.ok) {
        // A malformed artifact is never executed; its producer repairs it.
        for (const [role, reply] of [["Worker", workerReply], ["Tester", testerReply]] as const) if (!reply.ok) record.failures.push(schemaFailure(attempt, role, reply.issue));
      } else {
        // Static validation: declared files/dependencies (JSON transport), then parse + import policy + import-safety.
        const errors = await staticErrors(workerReply.data, source!, tests!);
        record.static = { ok: errors.length === 0, errors };
        const sourceErrors = record.static.errors.filter(e => !e.startsWith("tests")), testErrors = record.static.errors.filter(e => e.startsWith("tests"));
        let oracle: TestRun | null = null;
        if (!sourceErrors.length) {
          const hidden = await runTests(source!, "test_hidden", task.hiddenTests);
          record.hidden = { ran: true, total: hidden.results.length, failed: hidden.results.filter(x => !x.passed).length, passed: !hidden.loadError && hidden.results.length > 0 && hidden.results.every(x => x.passed) };
        }
        if (!testErrors.length) {
          if (task.reference) {
            const key = sha256(tests!);
            if (!oracleCache.has(key)) oracleCache.set(key, await runTests(task.reference, "test_generated", tests!));
            oracle = oracleCache.get(key)!;
          }
          if (!sourceErrors.length) {
            generated = await runTests(source!, "test_generated", tests!);
            const validTests = oracle && !oracle.loadError ? new Set(oracle.results.filter(x => x.passed).map(x => x.id)) : new Set<string>();
            const counted = task.testerRule === "all-pass" ? generated.results : generated.results.filter(x => validTests.has(x.id));
            const failedValid = counted.filter(x => !x.passed);
            record.tester = { ran: true, total: generated.results.length, valid: task.testerRule === "all-pass" ? generated.results.length : validTests.size, failedValid: failedValid.map(x => x.id),
              passed: !generated.loadError && counted.length > 0 && failedValid.length === 0 && (task.testerRule === "all-pass" ? generated.results.length > 0 : validTests.size > 0) };
          }
        }
        attributions = attributeAttempt({ testerRule: task.testerRule, sourceErrors, testErrors, hidden: record.hidden, generated: sourceErrors.length ? null : generated, oracle: testErrors.length ? null : oracle });
        record.accepted = record.static.ok && record.hidden.passed && record.tester.passed;
        if (!record.accepted) record.failures.push(...attributions.map(a => fail(attempt, a)));
        // Repair feedback for each target, built only from evidence attributed to it.
        const forWorker = attributions.filter(a => a.suspectedComponent === "worker"), forTester = attributions.filter(a => a.suspectedComponent === "tester");
        const byId = new Map((generated?.results ?? []).map(x => [x.id, x.message]));
        const oracleById = new Map((oracle?.results ?? []).map(x => [x.id, x.message]));
        (record as AttemptRecord & { workerFeedback?: string }).workerFeedback = sanitize([...sourceErrors,
          ...forWorker.flatMap(a => a.testIds ?? []).map(id => `${id}: ${byId.get(id) ?? ""}`),
          ...(generated?.loadError && forWorker.some(a => a.evidence[0]?.startsWith("tests load")) ? [`Generated tests could not load against your module: ${generated.loadError}`] : []),
          record.hidden.ran && !record.hidden.passed ? "An independent acceptance suite also failed (details withheld)." : ""].filter(Boolean).join("\n"), 2000);
        (record as AttemptRecord & { testerFeedback?: string }).testerFeedback = sanitize([...testErrors,
          ...forTester.filter(a => a.failureCategory === "test_invalid" && a.testIds && a.evidence[0]?.includes("fails on the frozen reference")).flatMap(a => a.testIds!).map(id => `${id} contradicts the frozen task contract at ${ownLine(tests ?? "", oracleById.get(id) ?? "")}`),
          ...forTester.filter(a => a.evidence[0]?.startsWith("no generated test")).map(() => "None of your tests is consistent with the frozen task contract; re-derive every expected value and error from the contract text."),
          ...forTester.filter(a => a.evidence[0]?.startsWith("tests do not load") || a.evidence[0]?.startsWith("the test module")).map(a => a.evidence[0])].join("\n"), 2000);
        record.feedback = (record as AttemptRecord & { workerFeedback?: string }).workerFeedback;
      }
      record.durationMs = Date.now() - started;
      if (result.repairs.length) settle(result.repairsUsed, record.failures);
      deps.onEvent?.(`attempt ${attempt}: static=${record.static.ok} hidden=${record.hidden.passed} tester=${record.tester.passed} → ${record.failures.map(f => f.suspectedComponent).join(",") || "none"}`);
      if (record.accepted || signal.aborted) break;
      const targets = [...new Set(record.failures.map(f => ROLE_OF[f.suspectedComponent]).filter((x): x is Role => !!x))];
      if (!targets.length) break; // ambiguous only: explicit diagnosis, no blind repair
      if (result.repairsUsed >= maxRepairs) break;
      result.repairsUsed++;
      const round = result.repairsUsed;
      record.repaired = targets;
      for (const target of targets) spend(round, target, record.failures.filter(f => ROLE_OF[f.suspectedComponent] === target));
      const issueOf = (reply: Asked<unknown>) => reply.ok ? "" : `Your previous reply was rejected: ${reply.issue} ${fenced ? "Reply with one fenced code block." : "Return exactly the JSON fields requested."}\n`;
      const wFeedback = !workerReply.ok ? issueOf(workerReply) : (record as AttemptRecord & { workerFeedback?: string }).workerFeedback;
      const tFeedback = !testerReply.ok ? issueOf(testerReply) : (record as AttemptRecord & { testerFeedback?: string }).testerFeedback;
      // Repair: original contract, the target's own attributed failures, its previous artifact and limits. Tests never see the implementation.
      const recheck = fenced ? "\nBefore rewriting, re-check every requirement and every listed invalid input of the contract one by one; keep what already works." : "";
      const sampling = strategy.sampling.Repair;
      const repaired = await Promise.all(targets.map(target => target === "Worker"
        ? askWorker(`\nREPAIR ${round} of ${maxRepairs}. Your previous implementation failed deterministic checks.\nFAILURES:\n${wFeedback}\nPREVIOUS IMPLEMENTATION:\n${clip(source ?? "(none)", 8000)}\nLimits: standard library only (allowed imports above), no I/O, the module must import cleanly.${recheck}`, round, sampling)
        : askTester(`\nREPAIR ${round} of ${maxRepairs}. Some of your tests are invalid: they break the import policy, cannot load, or contradict the frozen task contract. Keep the valid tests, fix or remove the invalid ones, and keep covering every required behaviour. Do not weaken checks the contract requires.\nINVALID:\n${tFeedback}\nPREVIOUS TESTS:\n${clip(tests ?? "(none)", 6000)}`, round, sampling)));
      for (const x of repaired) if (isResult(x)) return x;
      let productive = false;
      targets.forEach((target, i) => {
        const reply = repaired[i] as Asked<WorkerData> | Asked<TesterData>;
        const previous = target === "Worker" ? source : tests;
        const proposed = reply.ok ? stripFence("source" in reply.data ? reply.data.source : reply.data.tests_source) : null;
        const entry = result.repairs.find(r => r.round === round && r.target === target)!;
        Object.assign(entry, { previousSha256: previous ? sha256(previous) : null, proposedSha256: proposed ? sha256(proposed) : null, proposal: !proposed ? "malformed" : proposed === previous ? "identical" : "valid", remaining: maxRepairs - round });
        if (entry.proposal !== "identical") productive = true;
        if (target === "Worker") workerReply = reply as Asked<WorkerData>; else testerReply = reply as Asked<TesterData>;
      });
      // An identical resubmission cannot change the outcome; spending the remaining budget on it is unproductive.
      if (!productive && fenced) { deps.onEvent?.("repair unproductive (identical artifacts); stopping"); break; }
    }
  } catch (e) {
    const toolError = (e as { tool?: "tool_failure" | "resource_exhaustion" }).tool;
    if (toolError) return terminal(result.attempts.length - 1, "infrastructure", toolError, "infrastructure", "sandbox_error", sanitize((e as Error).message, 300));
    if ((e as { sandbox?: boolean }).sandbox) return signal.aborted ? done("cancelled", "Cancelled.") : terminal(result.attempts.length - 1, "infrastructure", "sandbox_failure", "infrastructure", "sandbox_error", sanitize((e as Error).message, 300));
    throw e;
  }
  if (signal.aborted) return done("cancelled", "Cancelled.");
  const final = result.attempts.at(-1)!;
  const malformed = final.failures.find(f => f.failureCategory === "schema_error");
  if (malformed) return done("malformed_artifact", `${malformed.evidence[0]} (repair budget exhausted).`);
  const testsText = testerReply.ok ? stripFence(testerReply.data.tests_source) : "";
  const summary = { static: final.static, hiddenAcceptance: final.hidden.passed ? "passed" : "failed", tester: final.tester };
  const review = await ask("Reviewer", `You are the Reviewer agent. Review the final implementation and tests against the contract and the deterministic check results. Your verdict is advisory: it cannot change failing checks.\nCONTRACT:\n${contractText}\nIMPLEMENTATION:\n${clip(result.finalSource ?? "", 8000)}\nTESTS:\n${clip(testsText, 6000)}\nCHECK RESULTS:\n${JSON.stringify(summary)}\nReturn JSON: verdict (approve or reject), findings (severity, issue, recommendation, evidence), confidence 0..1.`, ReviewerArtifactSchema, result.attempts.length, { sampling: strategy.sampling.Reviewer });
  if (isResult(review)) return review;
  // A malformed review fails closed: the Reviewer is outside the repair loop and a missing review is missing evidence.
  if (!review.ok) { schemaFailure(final.attempt, "Reviewer", review.issue, "review"); return done("malformed_artifact", review.issue); }
  result.reviewer = { verdict: review.data.verdict, confidence: review.data.confidence, findings: review.data.findings.length };
  result.reviewerFalseApproval = review.data.verdict === "approve" && !final.accepted;
  result.reviewerFalseRejection = review.data.verdict === "reject" && final.accepted;
  if (result.reviewerFalseApproval) fail(final.attempt, { failingStage: "review", failureCategory: "reviewer_false_approval", suspectedComponent: "reviewer", evidence: ["Reviewer approved a result the deterministic gate rejects; approval blocked"], confidence: "verified" });
  // The deterministic gate is the only acceptance authority.
  if (final.accepted) return done("passed", `Deterministic gate passed after ${result.repairsUsed} repair(s).`);
  const ambiguous = final.failures.some(f => f.failureCategory === "ambiguous") && !final.failures.some(f => ROLE_OF[f.suspectedComponent]);
  return done("failed", `Deterministic gate failed after ${result.repairsUsed} repair(s): ${ambiguous ? "ambiguous failure (diagnosis recorded, no blind repair)" : !final.static.ok ? "static validation" : !final.hidden.passed ? "independent acceptance tests" : "tester tests"}.`);
}
