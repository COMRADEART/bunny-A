import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../orch/router.ts";
import type { Mode, ProviderId, TaskType, VerifySpec } from "../orch/types.ts";
import { validateVerifySpec } from "../bunny-host/verification.server.ts";
import { validateGraph } from "./machine.ts";
import { operationContract } from "./cross-app.ts";
import type { ArtifactType, JsonValue, MissionLimits, MissionStep, StepExecutor, VerificationCriterion } from "./types.ts";

export const PLANNER_ID = "bunny-planner-deterministic-v1";
export type StepDraft = {
  crossApp?: import("./cross-app.ts").CrossAppMetadata;
  key: string; role: string; objective: string; dependsOn: string[]; executor: StepExecutor; requiredCapabilities: string[];
  reasoning: MissionStep["reasoning"]; access: "read" | "write"; isolation: "shared" | "worktree"; preferences: MissionStep["preferences"];
  providerConstraints: MissionStep["providerConstraints"]; verification: VerificationCriterion[]; expectedArtifacts: ArtifactType[];
  timeoutMs: number; maxRetries?: number; weight: number | null; modelConstraint: string | null;
};
export type Plan = { complexity: "simple" | "medium" | "complex"; rationale: string[]; steps: StepDraft[] };
export type PlanContext = { objective: string; mode: Mode; root: string; localOnly: boolean; available: (action: string) => boolean; limits: MissionLimits; explicit?: unknown };

const MODEL_TIMEOUT: Record<Mode, number> = { fast: 10 * 60_000, balanced: 20 * 60_000, deep: 30 * 60_000 };
const ROLE: Record<TaskType, string> = { coding: "Coding", debug: "Debugging", research: "Research", writing: "Documentation", ops: "Integration", general: "Assistant" };
const WRITE_WORDS = /\b(create|write|add|fix|implement|refactor|update|change|edit|modify|rename|delete|remove|build\s+(a|an|the)\s+\w+|generate)\b/i;

/** A named file in the request ("CONTRIBUTING guide", "notes.md") means the result is a file in the project. */
const FILE_TARGET = /\b[\w-]+\.(md|txt|json|ya?ml|ts|tsx|js|mjs|py|html|css)\b|\b(README|CONTRIBUTING|CHANGELOG|LICENSE)\b/;

function draft(key: string, partial: Partial<StepDraft> & Pick<StepDraft, "role" | "objective" | "executor">): StepDraft {
  return { key, dependsOn: [], requiredCapabilities: [], reasoning: "none", access: "read", isolation: "shared", preferences: {}, providerConstraints: {}, verification: [], expectedArtifacts: [], timeoutMs: 10 * 60_000, weight: null, modelConstraint: null, ...partial };
}
const skillStep = (key: string, role: string, objective: string, skillId: string, params: Record<string, JsonValue>, capabilities: string[]) =>
  draft(key, { role, objective, executor: { kind: "skill", skillId, params }, requiredCapabilities: capabilities, expectedArtifacts: [], timeoutMs: 20 * 60_000 });

/** Deterministic intents: solved by a capability or skill with zero model tokens. */
const INTENTS: { pattern: RegExp; build: (match: RegExpMatchArray, key: string) => StepDraft }[] = [
  { pattern: /^(?:please\s+)?(?:run|execute)\s+(?:the\s+|all\s+)?(?:project\s+|unit\s+)?tests?(?:\s+suite)?$/i, build: (_, key) => skillStep(key, "Test", "Run the project's tests", "project.test", {}, ["terminal.exec"]) },
  { pattern: /^(?:please\s+)?(?:run\s+(?:the\s+)?build|build\s+(?:the\s+)?(?:project|app))$/i, build: (_, key) => skillStep(key, "Build", "Build the project", "project.build", {}, ["terminal.exec"]) },
  { pattern: /^(?:please\s+)?(?:run\s+)?(?:the\s+)?type\s?-?check(?:ing)?$/i, build: (_, key) => skillStep(key, "Typecheck", "Typecheck the project", "project.typecheck", {}, ["terminal.exec"]) },
  { pattern: /^(?:please\s+)?(?:run\s+)?(?:the\s+)?lint(?:er)?$/i, build: (_, key) => skillStep(key, "Lint", "Lint the project", "project.lint", {}, ["terminal.exec"]) },
  { pattern: /^(?:git\s+status|show\s+(?:the\s+)?(?:git\s+)?(?:status|changes)|what\s+changed\??)$/i, build: (_, key) => skillStep(key, "Git", "Report git status and diff", "git.snapshot", {}, ["git.status", "git.diff"]) },
  { pattern: /^(?:take\s+a\s+)?screenshot(?:\s+of\s+(?:my|the)\s+screen)?$|^capture\s+(?:my\s+|the\s+)?screen$/i, build: (_, key) => skillStep(key, "Computer", "Capture the screen", "screen.capture", {}, ["computer.capture"]) },
  { pattern: /^(?:open|visit|screenshot|capture)\s+(https?:\/\/\S+)$/i, build: (match, key) => skillStep(key, "Browser", `Open and capture ${match[1]}`, "web.capture_page", { url: match[1] }, ["browser.navigate", "browser.read", "browser.screenshot"]) },
  { pattern: /^download\s+(https?:\/\/\S+)$/i, build: (match, key) => skillStep(key, "Browser", `Download ${match[1]}`, "web.download", { url: match[1] }, ["browser.download"]) },
  { pattern: /^open\s+(notepad|calculator|paint|explorer|terminal)$/i, build: (match, key) => skillStep(key, "Computer", `Open ${match[1]}`, "app.open", { app: match[1].toLowerCase() }, ["computer.open_app"]) },
  { pattern: /^(?:list|show)\s+(?:my\s+)?(?:open\s+)?windows$/i, build: (_, key) => draft(key, { role: "Computer", objective: "List open windows", executor: { kind: "capability", action: "computer.list_windows", params: {} }, requiredCapabilities: ["computer.list_windows"], timeoutMs: 30_000 }) },
];
export function deterministicPlan(objective: string): StepDraft[] | null {
  const parts = objective.trim().replace(/[.!]+$/, "").split(/\s*(?:,\s*)?(?:\band\s+then\b|\bthen\b|\band\b|;)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const steps: StepDraft[] = [];
  for (const [index, part] of parts.entries()) {
    const intent = INTENTS.map((item) => ({ item, match: part.match(item.pattern) })).find((row) => row.match);
    if (!intent) return null;
    const step = intent.item.build(intent.match!, `s${index + 1}`);
    // "run tests and build" means in that order: each part waits for the previous one.
    if (index) step.dependsOn = [`s${index}`];
    steps.push(step);
  }
  return steps;
}

function hasScript(root: string, name: string) {
  try { const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }; return !!pkg.scripts?.[name]; } catch { return false; }
}
const testsVerification = (root: string, mode: Mode, objective: string): VerificationCriterion[] =>
  hasScript(root, "test") && (mode === "deep" || /\btests?\b/i.test(objective)) ? [{ kind: "command", command: "npm", args: ["test"], expectExit: 0, timeoutMs: 15 * 60_000 }] : [];

/**
 * Chooses the smallest competent graph: deterministic intents become capability/skill steps with no
 * model; simple requests get one agent; medium requests a planner + implementer (+ deterministic test);
 * complex/deep requests a bounded DAG with parallel read-only research, implementation, tests and an
 * independent reviewer. Never more than the configured step limit.
 */
export function planMission(context: PlanContext): Plan {
  if (context.explicit !== undefined) return { complexity: "medium", rationale: ["User-supplied plan; validated and bounded by Bunny."], steps: explicitPlan(context.explicit, context) };
  const deterministic = deterministicPlan(context.objective);
  if (deterministic && deterministic.every((step) => step.requiredCapabilities.every(context.available))) {
    return { complexity: "simple", rationale: ["Recognised deterministic request; no reasoning model is needed (zero external-model tokens).", `${deterministic.length} skill/capability step${deterministic.length === 1 ? "" : "s"}.`], steps: deterministic };
  }
  const features = analyze(context.objective, context.mode);
  const writes = features.task_type === "coding" || features.task_type === "debug" || WRITE_WORDS.test(context.objective) || FILE_TARGET.test(context.objective);
  const timeout = MODEL_TIMEOUT[context.mode];
  const level = context.mode === "fast" ? "simple" : features.complexity < 0.45 ? "simple" : features.complexity < 0.7 && context.mode !== "deep" ? "medium" : context.mode === "deep" ? "complex" : "medium";
  const local = context.localOnly ? { local: true } : {};
  const rationale = [`Classified as ${features.task_type}, complexity ${features.complexity.toFixed(2)}, ${context.mode} mode → ${level} plan.`];
  if (deterministic) rationale.push("A deterministic route exists but a required capability is unavailable here; using an agent instead.");
  const role = ROLE[features.task_type];
  const canSearch = context.available("browser.search") && !context.localOnly;
  const research = (key: string, dependsOn: string[] = []) => draft(key, { role: "Research", objective: `Investigate what is needed for: ${context.objective}. Read the relevant files${dependsOn.length ? " and the search results provided" : ""}; report findings and constraints. Do not modify files.`, executor: { kind: "model" }, reasoning: "standard", dependsOn, preferences: local, expectedArtifacts: ["research_note"], timeoutMs: timeout, requiredCapabilities: ["filesystem.read"] });
  const search = (key: string) => draft(key, { role: "Search", objective: `Web search: ${context.objective.slice(0, 200)}`, executor: { kind: "capability", action: "browser.search", params: { query: context.objective.slice(0, 200), limit: 8 } }, requiredCapabilities: ["browser.search"], expectedArtifacts: ["research_note"], timeoutMs: 60_000 });
  const verification = writes ? testsVerification(context.root, context.mode, context.objective) : [];

  if (level === "simple") {
    rationale.push("One agent step is enough.");
    return { complexity: "simple", rationale, steps: [draft("s1", { role, objective: context.objective, executor: { kind: "model" }, reasoning: context.mode === "fast" ? "light" : "standard", access: writes ? "write" : "read", preferences: { ...local, fast: context.mode === "fast" }, verification, expectedArtifacts: [writes ? "patch" : "text"], timeoutMs: timeout, requiredCapabilities: writes ? ["filesystem.write"] : [] })] };
  }
  if (level === "medium") {
    if (!writes) {
      const steps: StepDraft[] = [];
      if (canSearch && features.task_type === "research") { steps.push(search("s1")); rationale.push("Bunny browser search first (no model tokens), then one research agent."); }
      steps.push(draft(`s${steps.length + 1}`, { role, objective: context.objective, executor: { kind: "model" }, reasoning: "standard", dependsOn: steps.map((step) => step.key), preferences: local, expectedArtifacts: ["research_note"], timeoutMs: timeout }));
      return { complexity: "medium", rationale, steps };
    }
    const steps = [
      draft("s1", { role: "Planner", objective: `Inspect the project and write a short, concrete implementation plan for: ${context.objective}. Do not modify files.`, executor: { kind: "model" }, reasoning: "light", preferences: local, expectedArtifacts: ["plan"], timeoutMs: timeout, requiredCapabilities: ["filesystem.read"] }),
      draft("s2", { role, objective: context.objective, executor: { kind: "model" }, reasoning: "standard", access: "write", dependsOn: ["s1"], preferences: local, verification, expectedArtifacts: ["patch"], timeoutMs: timeout, requiredCapabilities: ["filesystem.write"] }),
    ];
    if (hasScript(context.root, "test") && !verification.length) steps.push(skillStep("s3", "Test", "Run the project's tests after the change", "project.test", {}, ["terminal.exec"]));
    if (steps.length === 3) steps[2].dependsOn = ["s2"];
    rationale.push(`Planner → ${role}${steps.length === 3 ? " → deterministic tests" : ""}.`);
    return { complexity: "medium", rationale, steps };
  }
  // complex
  const steps: StepDraft[] = [];
  if (writes) {
    steps.push(research("s1"));
    steps.push(draft("s2", { role: "Architect", objective: `Design the approach for: ${context.objective}. Identify the files to change, risks and a test strategy. Do not modify files.`, executor: { kind: "model" }, reasoning: "deep", preferences: local, expectedArtifacts: ["specification"], timeoutMs: timeout, requiredCapabilities: ["filesystem.read"] }));
    steps.push(draft("s3", { role, objective: context.objective, executor: { kind: "model" }, reasoning: "deep", access: "write", dependsOn: ["s1", "s2"], preferences: local, verification, expectedArtifacts: ["patch"], timeoutMs: timeout, requiredCapabilities: ["filesystem.write"] }));
    const reviewDeps = ["s3"];
    if (hasScript(context.root, "test") && !verification.length) { steps.push({ ...skillStep("s4", "Test", "Run the project's tests after the change", "project.test", {}, ["terminal.exec"]), dependsOn: ["s3"] }); reviewDeps.push("s4"); }
    steps.push(draft(`s${steps.length + 1}`, { role: "Reviewer", objective: `Independently review the change made for: ${context.objective}. Check correctness against the objective and report concrete defects. Do not modify files.`, executor: { kind: "model" }, reasoning: "deep", dependsOn: reviewDeps, preferences: { ...local, independentOf: ["s3"] }, expectedArtifacts: ["review"], timeoutMs: timeout, requiredCapabilities: ["filesystem.read"] }));
    rationale.push("Research ∥ Architecture (read-only, parallel) → one writer → tests → independent review.");
  } else {
    if (canSearch) steps.push(search("s1"));
    steps.push(research(`s${steps.length + 1}`, steps.map((step) => step.key)));
    const researchKey = steps.at(-1)!.key;
    steps.push(draft(`s${steps.length + 1}`, { role: features.task_type === "writing" ? "Documentation" : "Analyst", objective: `Produce the final answer for: ${context.objective}, using the research provided.`, executor: { kind: "model" }, reasoning: "deep", dependsOn: [researchKey], preferences: local, expectedArtifacts: ["research_note"], timeoutMs: timeout }));
    steps.push(draft(`s${steps.length + 1}`, { role: "Reviewer", objective: `Independently check the answer for: ${context.objective}. Flag unsupported claims.`, executor: { kind: "model" }, reasoning: "standard", dependsOn: [steps.at(-1)!.key], preferences: { ...local, independentOf: [steps.at(-1)!.key] }, expectedArtifacts: ["review"], timeoutMs: timeout }));
    rationale.push(`${canSearch ? "Browser search → " : ""}research → answer → independent review.`);
  }
  return { complexity: "complex", rationale, steps: steps.slice(0, context.limits.maxSteps) };
}

const ROLE_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;
const PROVIDERS: ProviderId[] = ["codex", "claude", "ollama", "opencode", "cline", "cursor"];
function criteria(value: unknown): VerificationCriterion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) throw new Error("verification must be an array of at most 6 criteria.");
  return value.map((raw) => {
    const item = raw as Record<string, unknown>;
    if (!item || typeof item !== "object") throw new Error("Invalid verification criterion.");
    if (item.kind === "capability") {
      const expect = item.expect as Record<string, unknown> | undefined;
      const contract = typeof item.action === "string" ? operationContract(item.action) : null;
      const params = item.params ?? {};
      if (!contract || contract.sideEffect !== "READ" || !params || typeof params !== "object" || Array.isArray(params) || JSON.stringify(params).length > 8000
        || !expect || typeof expect.field !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(expect.field) || ["__proto__", "constructor", "prototype"].includes(expect.field)
        || !Object.hasOwn(expect, "equals") && (typeof expect.contains !== "string" || !expect.contains.length || expect.contains.length > 2000)) throw new Error("Capability verification needs a supported read operation and a concrete bounded expectation.");
      return { kind: "capability", action: item.action as string, params: params as Record<string, JsonValue>, expect: { field: expect.field, ...(Object.hasOwn(expect, "equals") ? { equals: expect.equals as JsonValue } : { contains: expect.contains as string }) } };
    }
    if (item.kind === "capability_run" && Number.isSafeInteger(item.expectExit) && typeof item.stdoutIncludes === "string" && item.stdoutIncludes.length > 0 && item.stdoutIncludes.length <= 2000) return { kind: "capability_run", expectExit: Number(item.expectExit), stdoutIncludes: item.stdoutIncludes };
    if (item.kind === "task_spec") return { kind: "task_spec", spec: validateVerifySpec(item.spec) as VerifySpec };
    if (item.kind === "file_exists" && typeof item.path === "string" && item.path.length < 500) return { kind: "file_exists", path: item.path, ...(typeof item.contains === "string" ? { contains: item.contains.slice(0, 2000) } : {}) };
    if (item.kind === "command" && typeof item.command === "string" && Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string") && item.args.length <= 32) return { kind: "command", command: item.command, args: item.args as string[], expectExit: Number.isInteger(item.expectExit) ? Number(item.expectExit) : 0, ...(typeof item.timeoutMs === "number" ? { timeoutMs: Math.min(item.timeoutMs, 30 * 60_000) } : {}) };
    if (item.kind === "artifact" && typeof item.type === "string") return { kind: "artifact", type: item.type as ArtifactType };
    if (item.kind === "git_diff_nonempty") return { kind: "git_diff_nonempty" };
    throw new Error("Unsupported verification criterion.");
  });
}
/** A user-supplied graph: every field is validated and the graph is checked for cycles and size. */
export function explicitPlan(value: unknown, context: Pick<PlanContext, "mode" | "limits">): StepDraft[] {
  if (!Array.isArray(value) || !value.length) throw new Error("steps must be a non-empty array.");
  if (value.length > context.limits.maxSteps) throw new Error(`Plan has ${value.length} steps; the limit is ${context.limits.maxSteps}.`);
  const steps = value.map((raw, index): StepDraft => {
    const item = raw as Record<string, unknown>;
    if (!item || typeof item !== "object") throw new Error(`Step ${index + 1} must be an object.`);
    const role = typeof item.role === "string" && ROLE_NAME.test(item.role) ? item.role : null;
    if (!role) throw new Error(`Step ${index + 1} needs a plain role name.`);
    const objective = typeof item.objective === "string" && item.objective.trim() && item.objective.length <= 8000 ? item.objective.trim() : null;
    if (!objective) throw new Error(`Step ${index + 1} needs an objective.`);
    const deps = item.dependsOn ?? [];
    if (!Array.isArray(deps) || deps.some((dep) => !Number.isInteger(dep) || dep < 0 || dep >= value.length)) throw new Error(`Step ${index + 1} has invalid dependencies (use step indexes).`);
    const executorInput = (item.executor ?? { kind: "model" }) as Record<string, unknown>;
    let executor: StepExecutor;
    if (executorInput.kind === "model") executor = { kind: "model" };
    else if (executorInput.kind === "capability" && typeof executorInput.action === "string" && /^[a-z]+\.[a-z_]+$/.test(executorInput.action)) executor = { kind: "capability", action: executorInput.action, params: (executorInput.params ?? {}) as Record<string, JsonValue> };
    else if (executorInput.kind === "skill" && typeof executorInput.skillId === "string") executor = { kind: "skill", skillId: executorInput.skillId, params: (executorInput.params ?? {}) as Record<string, JsonValue> };
    else throw new Error(`Step ${index + 1} has an invalid executor.`);
    const providers = (item.providers ?? {}) as Record<string, unknown>;
    const list = (v: unknown) => v === undefined ? undefined : Array.isArray(v) && v.every((p) => PROVIDERS.includes(p as ProviderId)) ? v as ProviderId[] : (() => { throw new Error(`Step ${index + 1} has an invalid provider list.`); })();
    const access = item.access === "write" ? "write" : "read";
    const isolation = item.isolation === "worktree" ? "worktree" : "shared";
    const timeoutMs = Math.max(30_000, Math.min(Number(item.timeoutMs ?? (executor.kind === "model" ? MODEL_TIMEOUT[context.mode] : 10 * 60_000)) || 60_000, 60 * 60_000));
    let crossApp: StepDraft["crossApp"];
    if (item.crossApp !== undefined) {
      if (item.crossApp !== true && (!item.crossApp || typeof item.crossApp !== "object" || Array.isArray(item.crossApp))) throw new Error("Invalid cross-app metadata.");
      const inputs = item.crossApp === true ? [] : (item.crossApp as Record<string, unknown>).inputs ?? [];
      if (!Array.isArray(inputs) || inputs.length > 1) throw new Error("Cross-app input references must be a bounded array.");
      crossApp = { version: "ma3.cross-app.v1", inputs: inputs.map(rawInput => {
        const ref = rawInput as Record<string, unknown>;
        if (!ref || ref.parameter !== "content" || ref.field !== "text" || !Number.isInteger(ref.step) || !(deps as number[]).includes(Number(ref.step))
          || executor.kind !== "capability" || executor.action !== "filesystem.write") throw new Error("Only a verified dependency's text may supply file content; executable/resource identities remain concrete.");
        return { parameter: "content", field: "text", stepId: `s${Number(ref.step) + 1}` };
      }) };
      if (executor.kind === "capability" && !operationContract(executor.action)) throw new Error("Unsupported cross-app operation; no adapter invented.");
      if (executor.kind === "skill") throw new Error("Cross-app skill expansion requires a reviewed pinned operation catalog; use explicit bounded steps.");
      if (!criteria(item.verification).length) throw new Error("Every cross-app step requires an independent postcondition.");
    }
    return draft(`s${index + 1}`, {
      ...(crossApp ? { crossApp } : {}),
      role, objective, executor, dependsOn: (deps as number[]).map((dep) => `s${dep + 1}`), access, isolation, timeoutMs,
      reasoning: executor.kind === "model" ? "standard" : "none",
      requiredCapabilities: executor.kind === "capability" ? [executor.action] : access === "write" ? ["filesystem.write"] : [],
      providerConstraints: { allow: list(providers.allow), deny: list(providers.deny) },
      verification: criteria(item.verification), expectedArtifacts: [],
      maxRetries: item.maxRetries === undefined ? undefined : Math.max(0, Math.min(Number(item.maxRetries) || 0, 5)),
      weight: typeof item.weight === "number" && item.weight > 0 ? item.weight : null,
      modelConstraint: typeof item.model === "string" && item.model.length < 100 ? item.model : null,
      preferences: Array.isArray(item.independentOf) ? { independentOf: (item.independentOf as number[]).filter(Number.isInteger).map((dep) => `s${dep + 1}`) } : {},
    });
  });
  const problem = validateGraph(steps.map((step) => ({ id: step.key, dependsOn: step.dependsOn })), context.limits);
  if (problem) throw new Error(problem);
  return steps;
}

export function isGitRoot(root: string) { return existsSync(join(root, ".git")); }
