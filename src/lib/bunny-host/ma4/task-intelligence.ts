/**
 * MA4-S1R4 adaptive task intelligence for coding tasks: a deterministic task profile and a bounded, typed task graph.
 * Pure functions. The profile only decides HOW MUCH verified effort a task gets (independent Worker samples, budgets);
 * it never changes the task contract, the acceptance rule, the pins or the repair limit, and it never adds agents:
 * the graph always has the same four roles, and extra effort is extra samples of the Worker, verified by tests.
 */
import { analyzeModelTask } from "./analyzer.ts";

export type Role = "Planner" | "Worker" | "Tester" | "Reviewer";
export type ProfileInput = { id: string; spec: string; module: string; allowedImports: string[]; testerRule: "all-pass" | "reference-validated" };
export type TaskProfile = {
  taskId: string;
  category: "coding" | "debugging" | "planning";
  complexity: "low" | "medium" | "high";
  /** Model capabilities every role needs; the router must reject a model that lacks one (S1R4 routing step 3). */
  capabilities: ("code-generation" | "test-generation" | "structured-output" | "review")[];
  /** Deterministic tools the orchestrator runs (never the model): all go through the permission broker. */
  tools: ("static_check" | "import_smoke" | "run_tests")[];
  sensitivity: "local-only" | "ordinary";
  artifacts: string[];
  acceptance: string[];
  /** Explicit error conditions the contract states; a proxy for how many edge cases a correct solution must get right. */
  errorConditions: number;
  budgets: { maxRepairs: number; maxAgents: number; maxModelCalls: number; maxToolCalls: number };
};
export type GraphNode = { id: string; kind: "plan" | "implement" | "test" | "select" | "verify" | "diagnose" | "repair" | "review"; actor: Role | "orchestrator"; dependsOn: string[]; samples?: number };
export type TaskGraph = { taskId: string; nodes: GraphNode[]; workerSamples: number };

const MAX_SAMPLES = 3;

/** Deterministic profile from host task facts only (never from model output). */
export function profileCodingTask(task: ProfileInput, options: { maxRepairs?: number } = {}): TaskProfile {
  const { analysis } = analyzeModelTask({ prompt: task.spec, constraints: { sensitive: true } });
  const category = /\bfix it\b|\bbug\b|\bdoes not\b|\bmisses\b/i.test(task.spec) ? "debugging" : /^\s*plan and implement\b/i.test(task.spec) ? "planning" : "coding";
  const errorConditions = (task.spec.match(/\braise[sd]?\b|\bmust raise\b|\berror\b/gi) ?? []).length + (task.spec.match(/\(([^()]*,){2,}[^()]*\)/g) ?? []).length;
  // Strict acceptance (every generated test must pass) or several stated error conditions make a single sample fragile.
  const complexity: TaskProfile["complexity"] = task.testerRule === "all-pass" || analysis.complexity === "high" || analysis.complexity === "maximum" || errorConditions >= 4 ? "high"
    : errorConditions >= 2 || task.spec.length > 350 ? "medium" : "low";
  const maxRepairs = Math.max(0, Math.min(options.maxRepairs ?? 2, 2));
  const samples = workerSamplesFor(complexity);
  return {
    taskId: task.id, category, complexity,
    capabilities: ["code-generation", "test-generation", "structured-output", "review"],
    tools: ["static_check", "import_smoke", "run_tests"],
    sensitivity: "local-only",
    artifacts: [`${task.module}.py`, "test_generated.py"],
    acceptance: ["static validation and import policy", "independent acceptance tests (hidden)", task.testerRule === "all-pass" ? "every generated test passes" : "at least one reference-consistent generated test, all passing"],
    errorConditions,
    // Planner + samples + Tester + per repair round (Worker + Tester) + Reviewer; tools: per candidate 2, per attempt 5.
    budgets: { maxRepairs, maxAgents: 4, maxModelCalls: 1 + samples + 1 + 2 * (maxRepairs + 1) + 1, maxToolCalls: 2 * samples + 5 * (maxRepairs + 1) + 4 },
  };
}

export function workerSamplesFor(complexity: TaskProfile["complexity"]): number {
  return complexity === "high" ? MAX_SAMPLES : complexity === "medium" ? 2 : 1;
}

/** The bounded graph the workflow executes. Repairs loop back to verify at most `maxRepairs` times (not unrolled). */
export function buildTaskGraph(profile: TaskProfile, workerSamples: number): TaskGraph {
  const samples = Math.max(1, Math.min(workerSamples, MAX_SAMPLES));
  const nodes: GraphNode[] = [
    { id: "plan", kind: "plan", actor: "Planner", dependsOn: [] },
    { id: "implement", kind: "implement", actor: "Worker", dependsOn: ["plan"], samples },
    { id: "test", kind: "test", actor: "Tester", dependsOn: ["plan"] },
    ...(samples > 1 ? [{ id: "select", kind: "select", actor: "orchestrator", dependsOn: ["implement", "test"] } as GraphNode] : []),
    { id: "verify", kind: "verify", actor: "orchestrator", dependsOn: samples > 1 ? ["select"] : ["implement", "test"] },
    { id: "diagnose", kind: "diagnose", actor: "orchestrator", dependsOn: ["verify"] },
    { id: "repair", kind: "repair", actor: "orchestrator", dependsOn: ["diagnose"] },
    { id: "review", kind: "review", actor: "Reviewer", dependsOn: ["diagnose"] },
  ];
  const graph = { taskId: profile.taskId, nodes, workerSamples: samples };
  const problems = validateGraph(graph, { maxAgents: profile.budgets.maxAgents, maxNodes: 12 });
  if (problems.length) throw new Error(`Invalid task graph: ${problems.join("; ")}`);
  return graph;
}

/** Structural checks: unique ids, known dependencies, no cycles, bounded size, bounded distinct agents. */
export function validateGraph(graph: TaskGraph, limits: { maxAgents: number; maxNodes: number }): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of graph.nodes) { if (ids.has(n.id)) problems.push(`duplicate node ${n.id}`); ids.add(n.id); }
  for (const n of graph.nodes) for (const d of n.dependsOn) if (!ids.has(d)) problems.push(`${n.id} depends on unknown ${d}`);
  if (graph.nodes.length > limits.maxNodes) problems.push(`more than ${limits.maxNodes} nodes`);
  const agents = new Set(graph.nodes.map(n => n.actor).filter(a => a !== "orchestrator"));
  if (agents.size > limits.maxAgents) problems.push(`more than ${limits.maxAgents} agents`);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { problems.push(`cycle ${[...path, id].join(" → ")}`); return; }
    state.set(id, 1);
    for (const d of byId.get(id)?.dependsOn ?? []) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const n of graph.nodes) visit(n.id, []);
  return problems;
}
