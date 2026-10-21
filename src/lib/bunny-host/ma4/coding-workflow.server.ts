/**
 * MA4-S1R2 G7 structured coding workflow:
 *   Planner → frozen Task Contract → (Worker ∥ Tester) → static validation → sandboxed tests → Reviewer → deterministic gate.
 * Every role output is a schema-validated artifact (malformed → fail closed). Pins come from the caller, never from
 * artifacts. Acceptance is decided only by non-LLM checks run in the OS-enforced sandbox; the Reviewer's verdict is
 * recorded and measured but can never turn a failing result into a pass. Repairs are bounded.
 */
import { z } from "zod";
import type { SandboxRequest, SandboxResult } from "./sandbox.server.ts";

const line = (max = 300) => z.string().min(1).max(max);
export const PlannerArtifactSchema = z.object({
  requirements: z.array(line()).min(1).max(12), plan: z.array(line()).min(1).max(10),
  acceptance: z.array(line()).min(1).max(12), constraints: z.array(line()).max(10), dependencies: z.array(line(60)).max(10),
}).strict();
export const WorkerArtifactSchema = z.object({
  source: z.string().min(1).max(20_000), notes: z.string().max(1000), dependencies: z.array(line(60)).max(10), files: z.array(line(80)).min(1).max(3),
}).strict();
export const TesterArtifactSchema = z.object({
  tests_source: z.string().min(1).max(20_000), cases: z.array(z.object({ name: line(100), expected: line(300) }).strict()).min(1).max(30), rationale: z.string().max(1000),
}).strict();
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
export type ModelCall = (request: { role: Role; model: string; prompt: string; schema: Record<string, unknown>; signal: AbortSignal; attempt: number }) =>
  Promise<{ ok: true; text: string; servedModel: string; durationMs: number } | { ok: false; error: string; stopped?: boolean; durationMs: number }>;
export type Sandbox = (request: SandboxRequest, signal?: AbortSignal) => Promise<SandboxResult>;

type TestOutcome = { id: string; passed: boolean; message: string };
export type AttemptRecord = {
  attempt: number; static: { ok: boolean; errors: string[] }; hidden: { ran: boolean; passed: boolean; total: number; failed: number };
  tester: { ran: boolean; total: number; valid: number; failedValid: string[]; passed: boolean }; accepted: boolean; durationMs: number;
};
export type WorkflowResult = {
  taskId: string; status: "passed" | "failed" | "malformed_artifact" | "pin_violation" | "model_error" | "cancelled" | "sandbox_error";
  reason: string; attempts: AttemptRecord[]; repairsUsed: number; calls: { role: Role; model: string; attempt: number; ok: boolean; durationMs: number; startedAt: number; endedAt: number; servedModel?: string }[];
  reviewer: { verdict: ReviewerArtifact["verdict"]; confidence: number; findings: number } | null; reviewerFalseApproval: boolean; reviewerFalseRejection: boolean;
  workerTesterConcurrent: boolean; finalSource: string | null;
};

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

export async function runCodingWorkflow(task: CodingTask, deps: {
  call: ModelCall; sandbox: Sandbox; pins: Record<Role, string>; maxRepairs?: number; signal?: AbortSignal; onEvent?: (event: string) => void;
}): Promise<WorkflowResult> {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(task.module)) throw new Error("Task module must be a plain Python identifier.");
  const signal = deps.signal ?? new AbortController().signal;
  const maxRepairs = Math.max(0, Math.min(deps.maxRepairs ?? 2, 2));
  const pins = Object.freeze({ ...deps.pins });
  const result: WorkflowResult = { taskId: task.id, status: "failed", reason: "", attempts: [], repairsUsed: 0, calls: [], reviewer: null, reviewerFalseApproval: false, reviewerFalseRejection: false, workerTesterConcurrent: false, finalSource: null };
  const done = (status: WorkflowResult["status"], reason: string) => Object.assign(result, { status, reason });
  const ask = async <T>(role: Role, prompt: string, schema: z.ZodType<T>, attempt: number): Promise<T | WorkflowResult> => {
    if (signal.aborted) return done("cancelled", "Cancelled.");
    const startedAt = Date.now();
    const r = await deps.call({ role, model: pins[role], prompt, schema: z.toJSONSchema(schema) as Record<string, unknown>, signal, attempt });
    result.calls.push({ role, model: pins[role], attempt, ok: r.ok, durationMs: r.durationMs, startedAt, endedAt: Date.now(), ...(r.ok ? { servedModel: r.servedModel } : {}) });
    deps.onEvent?.(`${role}#${attempt} ${r.ok ? "ok" : "error"}`);
    if (!r.ok) return signal.aborted || r.stopped ? done("cancelled", "Cancelled.") : done("model_error", `${role}: ${sanitize(r.error, 300)}`);
    if (r.servedModel !== pins[role]) return done("pin_violation", `${role} was served by ${r.servedModel}, not the pinned ${pins[role]}; no substitution is accepted.`);
    let raw: unknown;
    try { raw = JSON.parse(r.text); } catch { return done("malformed_artifact", `${role} artifact is not JSON.`); }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return done("malformed_artifact", `${role} artifact failed its schema: ${sanitize(parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; "), 300)}`);
    return parsed.data;
  };
  const isResult = (x: unknown): x is WorkflowResult => x === result;

  const plannerPrompt = `You are the Planner agent. Task: ${task.spec}\nThe implementation is a Python module named ${task.module} (file ${task.module}.py). Allowed imports: ${task.allowedImports.join(", ") || "none"}.\nReturn JSON with requirements, plan (short steps), acceptance (checkable conditions), constraints and dependencies.`;
  const planner = await ask("Planner", plannerPrompt, PlannerArtifactSchema, 0);
  if (isResult(planner)) return planner;
  // The contract is immutable input for both parallel roles; the planner only adds advisory text.
  const contract = Object.freeze({ spec: task.spec, module: task.module, file: `${task.module}.py`, allowedImports: Object.freeze([...task.allowedImports]), planner: Object.freeze(structuredClone(planner)) });
  const contractText = JSON.stringify(contract, null, 1);
  const workerPrompt = (extra = "") => `You are the Worker agent. Implement the task contract below as the complete source of ${contract.file}. Only definitions at top level (no demo code, prints or input at import time). Standard library only, limited to the allowed imports.\nCONTRACT:\n${contractText}${extra}\nReturn JSON: source (the full file text), notes, dependencies (modules imported), files (["${contract.file}"]).`;
  const testerPrompt = `You are the Tester agent. Write a Python unittest module for the task contract below, without seeing any implementation. It must start with: import unittest\nfrom ${task.module} import *\nCover normal cases, edge cases and the required errors.\nCONTRACT:\n${contractText}\nReturn JSON: tests_source (the full test file), cases (name and expected behaviour of each), rationale.`;

  const [worker0, tester] = await Promise.all([ask("Worker", workerPrompt(), WorkerArtifactSchema, 0), ask("Tester", testerPrompt, TesterArtifactSchema, 0)]);
  const w = result.calls.find(c => c.role === "Worker"), t = result.calls.find(c => c.role === "Tester");
  // In flight at the same time (the runtime may still serialize generation internally).
  result.workerTesterConcurrent = !!w && !!t && w.startedAt < t.endedAt && t.startedAt < w.endedAt;
  if (isResult(worker0)) return worker0;
  if (isResult(tester)) return tester;
  const tests = stripFence(tester.tests_source);

  const sandboxRun = async (files: Record<string, string>, argv: string[]) => {
    try { return await deps.sandbox({ files, argv: ["python3", "-I", "-S", ...argv], ...SANDBOX_LIMITS }, signal); }
    catch (e) { throw Object.assign(new Error(signal.aborted ? "cancelled" : `sandbox: ${(e as Error).message}`), { sandbox: true }); }
  };
  const runTests = async (source: string, testFile: string, testSource: string): Promise<{ loadError: string | null; results: TestOutcome[] }> => {
    const r = await sandboxRun({ [`${task.module}.py`]: source, [`${testFile}.py`]: testSource, "per_test.py": PER_TEST_RUNNER }, ["per_test.py", testFile]);
    try { const o = JSON.parse(r.stdout.trim().split("\n").pop() ?? ""); return { loadError: o.loadError, results: (o.results as TestOutcome[]).map(x => ({ ...x, message: sanitize(String(x.message), 600) })) }; }
    catch { return { loadError: r.timedOut ? "test run timed out" : r.oomKilled ? "test run exceeded memory" : sanitize(r.stderr.split("\n").filter(Boolean).pop() ?? "no result", 300), results: [] }; }
  };
  // Frozen reference validation of the Tester's tests happens once; the reference never reaches a model.
  let validTests: Set<string> | null = null;

  let worker: WorkerArtifact = worker0;
  try {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      const source = stripFence(worker.source);
      const record: AttemptRecord = { attempt, static: { ok: false, errors: [] }, hidden: { ran: false, passed: false, total: 0, failed: 0 }, tester: { ran: false, total: 0, valid: 0, failedValid: [], passed: false }, accepted: false, durationMs: 0 };
      result.attempts.push(record); result.finalSource = source;
      // Static validation: declared files/dependencies, then parse + import policy + import-safety inside the sandbox.
      const errors: string[] = [];
      if (worker.files.length !== 1 || worker.files[0] !== contract.file) errors.push(`files must be exactly ["${contract.file}"]`);
      for (const d of worker.dependencies) if (!task.allowedImports.includes(d.split(".")[0]) && d !== task.module) errors.push(`declared dependency '${sanitize(d, 60)}' is not allowed`);
      const staticRun = await sandboxRun({ [`${task.module}.py`]: source, "test_generated.py": tests, "static_check.py": STATIC_CHECK }, ["static_check.py", task.module, JSON.stringify(task.allowedImports)]);
      try { errors.push(...(JSON.parse(staticRun.stdout.trim().split("\n").pop() ?? "") as string[])); } catch { errors.push("static check produced no result"); }
      if (!errors.some(e => e.startsWith("source"))) {
        const smoke = await sandboxRun({ [`${task.module}.py`]: source }, ["-c", `import sys; sys.path.insert(0, "."); import ${task.module}`]);
        if (smoke.exitCode !== 0) errors.push(`source: importing the module failed: ${sanitize(smoke.stderr.split("\n").filter(Boolean).pop() ?? (smoke.timedOut ? "timeout" : "error"), 300)}`);
      }
      record.static = { ok: errors.length === 0, errors: errors.map(e => sanitize(e, 300)) };
      const sourceOk = !errors.some(e => !e.startsWith("tests"));
      if (sourceOk) {
        const hidden = await runTests(source, "test_hidden", task.hiddenTests);
        record.hidden = { ran: true, total: hidden.results.length, failed: hidden.results.filter(x => !x.passed).length, passed: !hidden.loadError && hidden.results.length > 0 && hidden.results.every(x => x.passed) };
        if (!errors.some(e => e.startsWith("tests"))) {
          if (validTests === null && task.testerRule === "reference-validated" && task.reference) {
            const ref = await runTests(task.reference, "test_generated", tests);
            validTests = new Set(ref.results.filter(x => x.passed).map(x => x.id));
          }
          const generated = await runTests(source, "test_generated", tests);
          const counted = task.testerRule === "all-pass" ? generated.results : generated.results.filter(x => validTests?.has(x.id));
          const failedValid = counted.filter(x => !x.passed);
          record.tester = { ran: true, total: generated.results.length, valid: task.testerRule === "all-pass" ? generated.results.length : validTests?.size ?? 0, failedValid: failedValid.map(x => x.id),
            passed: !generated.loadError && counted.length > 0 && failedValid.length === 0 && (task.testerRule === "all-pass" ? generated.results.length > 0 : (validTests?.size ?? 0) > 0) };
          (record as AttemptRecord & { feedback?: string }).feedback = generated.loadError ? `Generated tests could not load against your module: ${generated.loadError}` : failedValid.map(x => `${x.id}: ${x.message}`).join("\n");
        }
      }
      record.accepted = record.static.ok && record.hidden.passed && record.tester.passed;
      record.durationMs = Date.now() - started;
      deps.onEvent?.(`attempt ${attempt}: static=${record.static.ok} hidden=${record.hidden.passed} tester=${record.tester.passed}`);
      if (record.accepted || attempt >= maxRepairs || signal.aborted) break;
      // Repair: original contract, failing (validated) test cases, sanitized errors, previous implementation, limits.
      result.repairsUsed++;
      const feedback = sanitize([...record.static.errors, (record as AttemptRecord & { feedback?: string }).feedback ?? "", record.hidden.ran && !record.hidden.passed ? "An independent acceptance suite also failed (details withheld)." : ""].filter(Boolean).join("\n"), 2000);
      const repaired = await ask("Worker", workerPrompt(`\nREPAIR ${attempt + 1} of ${maxRepairs}. Your previous implementation failed deterministic checks.\nFAILURES:\n${feedback}\nPREVIOUS IMPLEMENTATION:\n${clip(source, 8000)}\nLimits: standard library only (allowed imports above), no I/O, the module must import cleanly.`), WorkerArtifactSchema, attempt + 1);
      if (isResult(repaired)) return repaired;
      worker = repaired;
    }
  } catch (e) {
    if ((e as { sandbox?: boolean }).sandbox) return signal.aborted ? done("cancelled", "Cancelled.") : done("sandbox_error", sanitize((e as Error).message, 300));
    throw e;
  }
  const final = result.attempts.at(-1)!;
  const summary = { static: final.static, hiddenAcceptance: final.hidden.passed ? "passed" : "failed", tester: final.tester };
  const review = await ask("Reviewer", `You are the Reviewer agent. Review the final implementation and tests against the contract and the deterministic check results. Your verdict is advisory: it cannot change failing checks.\nCONTRACT:\n${contractText}\nIMPLEMENTATION:\n${clip(result.finalSource ?? "", 8000)}\nTESTS:\n${clip(tests, 6000)}\nCHECK RESULTS:\n${JSON.stringify(summary)}\nReturn JSON: verdict (approve or reject), findings (severity, issue, recommendation, evidence), confidence 0..1.`, ReviewerArtifactSchema, result.attempts.length);
  if (isResult(review)) return review;
  result.reviewer = { verdict: review.verdict, confidence: review.confidence, findings: review.findings.length };
  result.reviewerFalseApproval = review.verdict === "approve" && !final.accepted;
  result.reviewerFalseRejection = review.verdict === "reject" && final.accepted;
  // The deterministic gate is the only acceptance authority.
  return final.accepted ? done("passed", `Deterministic gate passed after ${result.repairsUsed} repair(s).`) : done("failed", `Deterministic gate failed after ${result.repairsUsed} repair(s): ${!final.static.ok ? "static validation" : !final.hidden.passed ? "independent acceptance tests" : "tester tests"}.`);
}
