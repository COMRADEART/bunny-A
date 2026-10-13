/**
 * M-A-3 T3 §6: TaskRequirementClassifier.
 *
 * Structural, deterministic evidence about what a Task requires of a model.
 * Everything is derived from the canonical Task prompt/constraints alone.
 * Ambiguity resolves CONSERVATIVE and stays UNKNOWN — certainty is never
 * fabricated (same discipline as T1 probes and T2 usage truth).
 *
 * The classification describes requirements for ROUTING only. It carries no
 * authority: permission/capability decisions stay with the Host (T3 §28).
 */
import type { Mode, TaskConstraints } from "./types.ts";

/** T3 §6 task_class list — exactly the brief's classes. */
export type RoutingTaskClass =
  | "general" | "coding" | "repository_coding" | "research" | "math" | "reasoning"
  | "extraction" | "vision" | "tool_execution" | "structured_generation" | "verification";

export type CodingComplexity = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type ReasoningComplexity = "LOW" | "MEDIUM" | "HIGH" | "MAX";
export type PrivacyRequirement = "none" | "local_only" | "unknown";

export type TaskRequirements = {
  task_class: RoutingTaskClass;
  needs_tools: boolean;
  needs_vision: boolean;
  needs_large_context: boolean;
  needs_local_execution: boolean;
  needs_cloud: boolean;
  privacy_requirement: PrivacyRequirement;
  coding_complexity: CodingComplexity;
  reasoning_complexity: ReasoningComplexity;
  /** Approximate prompt size in characters this Task must fit; null = UNKNOWN. */
  estimated_context_requirement: number | null;
  /** Hard capability requirements: a candidate without a verified equivalent is excluded. */
  required_capabilities: string[];
  /** Soft preferences that only add score; never exclude. */
  preferred_capabilities: string[];
  /** Short, safe, structural reasons the classification chose these values. */
  evidence: string[];
};

const PRIVACY = /do not send off.?machine|keep (?:this|it|the|everything).{0,12}(?:local|on this (?:machine|workstation))|privacy.?sensitive|on.?premise|no (?:cloud|server)|stays? (?:local|on.?device|on this machine)/i;
const VISION_PRIMARY = /\b(?:describe|read|interpret|classify|look at|analyze)\b.{0,40}\b(?:this|the|that)?\s*(?:image|photo|picture|screenshot|diagram|chart|figure)\b|\b(?:image|screenshot|photo)\s+(?:analysis|classification|understanding)\b/i;
const TOOLS = /\b(?:run|execute|install|deploy|restart)\s+(?:a\s+|the\s+|an\s+)?(?:command|script|test|suite|container|service|server|migration)|git\s+(?:commit|push|pull|clone|revert|branch)|(?:npm|pnpm|yarn|bun)\s+(?:install|run)\b|shell\s+automation/i;
const REPO = /\b(?:fail(?:ing|ed)? test|test suite|the (?:code)?base|repository|repo\b|in (?:src|lib|src\/)|pull request|PR\b|refactor)/i;
const CODE = /\b(?:code|coding|function|class|component|fix|implement|refactor|migrate|typescript|python|javascript|rust|go|css|html|sql|script|api|bug|feature)\b/i;
const RESEARCH = /\b(?:research|investigate|compare|papers?|summarize|documentation|docs|explain the|write up|study the)\b/i;
const MATH = /\b(?:calculate|equation|prove\b|proof|derivation|derive the|mathematic)/i;
const REASONING = /\b(?:think through|reason(?:ing)? (?:about|through)|tradeoffs?|approach(?:es)?|strategy|plan how|first.?principles|derive)/i;
const STRUCTURED = /\b(?:json|csv|yaml|xml|schema|table with columns|structured output)\b/i;
const EXTRACTION = /\b(?:extract|parse|pull).{0,24}\b(?:from|out of)\b|from the following text/i;
const VERIFY_ASK = /\b(?:verify|check that|confirm that|validate that|double.?check)\b/i;
const MAX_REASONING = /\b(?:first.?principles|complex distributed|architect the (?:entire|whole)|mission.?critical|derive from scratch|formal proof)|maximum reasoning|hardest reasoning/i;
const HIGH_REASONING = /\b(?:debug|optimize|architect|complex|tradeoffs?|compare .*approach|distributed)/i;
const LARGE_CONTEXT = /\b(?:entire (?:code)?base|whole (?:code)?base|all files in|large context|full repository)/i;
/** Only prompts larger than this make large context a HARD requirement (T3 §6 conservative evidence). */
export const LARGE_CONTEXT_CHARS = 180_000;
const HIGH_CODING = /\b(?:architecture|distributed|migrat|multiple (?:services|files|modules)|system.?wide)/i;

/** The one deterministic classifier. Same input → same requirements (T3 §26). */
export function classifyRequirements(input: { prompt: string; mode?: Mode | null; constraints?: TaskConstraints | null }): TaskRequirements {
  const prompt = input.prompt ?? "";
  const constraints = input.constraints ?? {};
  const evidence: string[] = [];

  const visionPrimary = VISION_PRIMARY.test(prompt);
  const repoSignal = REPO.test(prompt);
  const codeSignal = CODE.test(prompt);
  const toolSignal = TOOLS.test(prompt) || constraints.requiresTerminal === true || constraints.requiresFilesystem === true;
  const researchSignal = RESEARCH.test(prompt);
  const structured = STRUCTURED.test(prompt);
  const extraction = EXTRACTION.test(prompt) && !researchSignal;
  const verification = VERIFY_ASK.test(prompt) && codeSignal;

  const task_class: RoutingTaskClass = visionPrimary ? "vision"
    : toolSignal && !repoSignal ? "tool_execution"
    : toolSignal && repoSignal ? "repository_coding"
    : repoSignal && codeSignal ? "repository_coding"
    : codeSignal ? "coding"
    : researchSignal ? "research"
    : MATH.test(prompt) ? "math"
    : REASONING.test(prompt) ? "reasoning"
    : structured ? "structured_generation"
    : extraction ? "extraction"
    : verification ? "verification"
    : "general";

  if (visionPrimary) evidence.push("The prompt names an image/screenshot as the subject of analysis.");
  if (toolSignal) evidence.push("Structural signals require command/tool execution.");
  if (repoSignal) evidence.push("Repository/test signals present.");
  if (researchSignal) evidence.push("Research/comparison signals present.");

  // Hard capability requirements: conservative and evidence-backed only.
  const needs_tools = task_class === "repository_coding" || task_class === "tool_execution" || task_class === "verification";
  const needs_vision = visionPrimary;
  const largeBySize = prompt.length >= LARGE_CONTEXT_CHARS;
  const needs_large_context = largeBySize || LARGE_CONTEXT.test(prompt);
  if (largeBySize) evidence.push(`Prompt is ${prompt.length} characters (≥ ${LARGE_CONTEXT_CHARS}).`);
  const needs_local = constraints.localOnly === true || constraints.offlineOnly === true;
  const needs_cloud = constraints.cloudOnly === true;

  const privacy_re = PRIVACY.test(prompt);
  const privacy_requirement: PrivacyRequirement = constraints.privacyLocal === true || constraints.localOnly === true ? "local_only"
    : privacy_re ? "local_only"
    : constraints.cloudOnly === true ? "none"
    : "unknown";
  if (privacy_re) evidence.push("A privacy/local-only phrasing was matched.");

  const isCodey = task_class === "coding" || task_class === "repository_coding";
  const coding_complexity: CodingComplexity = !isCodey ? "NONE"
    : HIGH_CODING.test(prompt) ? "HIGH"
    : /\b(?:fix|add|change|update|small|tiny|one)\b/i.test(prompt) ? "LOW"
    : "MEDIUM";
  const reasoning_complexity: ReasoningComplexity = MAX_REASONING.test(prompt) ? "MAX"
    : HIGH_REASONING.test(prompt) || (task_class === "math") ? "HIGH"
    : isCodey || researchSignal || task_class === "reasoning" || structured ? "MEDIUM"
    : "LOW";

  const required: string[] = [];
  if (needs_tools) required.push("tools");
  if (needs_vision) required.push("vision");
  if (needs_large_context) required.push("large_context");
  if (needs_local) required.push("local_execution");
  if (needs_cloud) required.push("cloud_execution");
  if (constraints.requiresTerminal) required.push("terminal");
  if (constraints.requiresFilesystem) required.push("filesystem");
  if (constraints.requiresGit) required.push("git");
  if (constraints.requiresGPU) required.push("gpu");
  if (privacy_requirement === "local_only") required.push("privacy_local");

  const preferred: string[] = [];
  if (input.mode === "fast") preferred.push("latency");
  if (input.mode === "deep") preferred.push("reasoning_depth");
  if (input.constraints?.requiresTerminal) preferred.push("tests");
  if (privacy_requirement === "unknown" && !needs_cloud && !needs_local) preferred.push("privacy_capacity");

  return {
    task_class,
    needs_tools, needs_vision, needs_large_context, needs_local_execution: needs_local, needs_cloud,
    privacy_requirement, coding_complexity, reasoning_complexity,
    estimated_context_requirement: needs_large_context ? prompt.length : null,
    required_capabilities: [...new Set(required)],
    preferred_capabilities: [...new Set(preferred.filter(Boolean))],
    evidence: [...new Set(evidence)],
  };
}

/** Normalized effort requirement (T3 §11): simple work never maps to MAX. */
export function effortRequirement(requirements: Pick<TaskRequirements, "reasoning_complexity">, mode?: Mode | null): "LOW" | "MEDIUM" | "HIGH" | "MAX" {
  let effort: "LOW" | "MEDIUM" | "HIGH" | "MAX" = requirements.reasoning_complexity === "MAX" ? "MAX"
    : requirements.reasoning_complexity === "HIGH" ? "HIGH"
    : requirements.reasoning_complexity === "MEDIUM" ? "MEDIUM" : "LOW";
  if (mode === "fast") effort = effort === "MAX" ? "HIGH" : effort === "HIGH" ? "MEDIUM" : effort; // "fast" never escalates; it trims
  if (mode === "deep" && effort === "LOW") effort = "MEDIUM";
  return effort;
}