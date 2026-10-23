/**
 * MA4-S2 verified skill learning (pure rules). A skill is a declarative PROCEDURE — advisory text for a role plus
 * references to deterministic tools the workflow already runs. It is never executable, never changes model weights,
 * and never grants a tool, a permission, a provider or data access. Lifecycle:
 *   discovered → candidate → sandbox_validated → benchmark_qualified → approved → active → (quarantined | rolled_back)
 * Screening, sandbox validation and benchmark qualification are Host evidence; approval and activation belong to the
 * workstation owner only. A skill text is model-written, so it is always shown labelled as advice, never as policy.
 */
import { z } from "zod";
import { isSteering } from "../lotus.ts";
import { looksSecret } from "../intelligence.ts";

export const SKILL_SCHEMA_VERSION = "bunny-a.ma4-s2.skill.v1";
/** Host-derived task tags (never model-chosen for a task); a skill declares which of them it applies to. */
export const TASK_TAGS = ["strict-parsing", "validation-errors", "string-processing", "collections", "algorithm", "debugging", "stateful-class", "numeric"] as const;
export type TaskTag = (typeof TASK_TAGS)[number];
export const SKILL_ROLES = ["Planner", "Worker", "Tester"] as const;
/** The only tools a skill may reference: the workflow's own sandboxed, broker-checked deterministic tools. */
export const BASE_TOOLS = ["ma4.static_check", "ma4.import_smoke", "ma4.run_tests"] as const;
export const SKILL_STATES = ["discovered", "candidate", "sandbox_validated", "benchmark_qualified", "approved", "active", "quarantined", "rolled_back", "rejected", "removed"] as const;
export type SkillState = (typeof SKILL_STATES)[number];

const line = (max: number) => z.string().trim().min(1).max(max);
/** What the extraction model may propose. Everything else on a skill is filled in by the Host. */
export const SkillProposalSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
  description: line(300),
  categories: z.array(z.enum(TASK_TAGS)).min(1).max(4),
  preconditions: z.array(line(160)).max(4),
  procedure: z.array(line(200)).min(1).max(6),
  roles: z.array(z.enum(SKILL_ROLES)).min(1).max(3),
  tools: z.array(z.string().max(60)).max(4),
  limitations: z.array(line(200)).max(4),
}).strict();
export type SkillProposal = z.infer<typeof SkillProposalSchema>;

export type SkillEvidence = { stage: "screen" | "sandbox" | "qualify" | "monitor"; passed: boolean; at: string; detail: string; trials?: string[] };
export type Skill = SkillProposal & {
  schema: typeof SKILL_SCHEMA_VERSION; id: string; version: number; state: SkillState;
  inputs: string; outputs: string;
  /** Host fact: the failure categories the source trial had to overcome (empty for a first-attempt pass). */
  failureCategories: string[];
  requiredPermissions: string[];
  budget: { maxGuidanceChars: number };
  evidence: SkillEvidence[];
  uses: { at: string; taskId: string; passed: boolean }[];
  provenance: { taskId: string; trial: number; model: string; extractorSha256: string; discoveredAt: string };
  history: { at: string; from: SkillState | null; to: SkillState; actor: SkillActor; reason: string }[];
};
/** workstation = the trusted local owner (checked by the caller); host = the orchestrator's own deterministic steps. */
export type SkillActor = "workstation" | "host";

/** Lower-case word/number tokens; overlap in runs of N tokens detects copied test or reference text. */
const tokens = (text: string) => text.toLowerCase().match(/[a-z0-9_]+|[^\sa-z0-9_]/g) ?? [];
export function sharedRun(a: string, b: string, n = 6): string | null {
  const seen = new Set<string>(), ta = tokens(a), tb = tokens(b);
  for (let i = 0; i + n <= tb.length; i++) seen.add(tb.slice(i, i + n).join(" "));
  for (let i = 0; i + n <= ta.length; i++) { const k = ta.slice(i, i + n).join(" "); if (seen.has(k)) return k; }
  return null;
}
const MODEL_NAME = /\b(qwen|llama|gpt|claude|gemini|mistral|deepseek|phi-?\d|gemma|groq|openai|anthropic|ollama)\b/i;
const ALTERS_ACCEPTANCE = /\b(skip|disable|delete|remove|modify|weaken|edit|rewrite|ignore)\b[^.\n]{0,30}\b(tests?|acceptance|assert(ion)?s?|test suite|checks?)\b/i;

/** Screening before a proposal may become a CANDIDATE. Returns every reason it is rejected (empty = admissible). */
export function screen(p: SkillProposal, forbidden: readonly string[]): string[] {
  const text = [p.name, p.description, ...p.preconditions, ...p.procedure, ...p.limitations].join("\n");
  const reasons: string[] = [];
  if (isSteering(text)) reasons.push("contains instruction-steering text");
  if (looksSecret(text)) reasons.push("contains credential-like text");
  if (MODEL_NAME.test(text)) reasons.push("depends on a named model or provider");
  if (ALTERS_ACCEPTANCE.test(text)) reasons.push("would alter tests or acceptance checks");
  const extra = p.tools.filter(t => !(BASE_TOOLS as readonly string[]).includes(t));
  if (extra.length) reasons.push(`requests tools outside the workflow's deterministic tools (${extra.join(", ")}); owner approval required`);
  for (const f of forbidden) { const run = sharedRun(text, f); if (run) { reasons.push(`shares text with a hidden test or reference ("${run}")`); break; } }
  return reasons;
}

const NEXT: Record<SkillState, readonly SkillState[]> = {
  discovered: ["candidate", "rejected"],
  candidate: ["sandbox_validated", "rejected"],
  sandbox_validated: ["benchmark_qualified", "rejected"],
  benchmark_qualified: ["approved", "rejected"],
  approved: ["active", "rejected"],
  active: ["quarantined", "rolled_back"],
  quarantined: ["active", "rolled_back", "rejected"],
  rolled_back: [],
  rejected: [],
  removed: [],
};
const OWNER_ONLY = new Set<SkillState>(["approved", "active", "removed"]);
const EVIDENCE_FOR: Partial<Record<SkillState, SkillEvidence["stage"]>> = { candidate: "screen", sandbox_validated: "sandbox", benchmark_qualified: "qualify" };

/** Checks one lifecycle step. Throws with the reason; never skips a stage, never lets the Host approve. */
export function assertTransition(skill: Pick<Skill, "state" | "evidence" | "requiredPermissions">, to: SkillState, actor: SkillActor, permissionsApproved: readonly string[] = []): void {
  if (to !== "removed" && !NEXT[skill.state].includes(to)) throw new Error(`A ${skill.state} skill cannot become ${to}.`);
  if (to === "removed" && skill.state === "removed") throw new Error("The skill is already removed.");
  if (OWNER_ONLY.has(to) && actor !== "workstation") throw new Error(`Only the workstation owner can make a skill ${to}.`);
  if (skill.state === "quarantined" && to === "active" && actor !== "workstation") throw new Error("Only the workstation owner can reinstate a quarantined skill.");
  const stage = EVIDENCE_FOR[to];
  if (stage && !skill.evidence.some(e => e.stage === stage && e.passed)) throw new Error(`A skill becomes ${to} only with passing ${stage} evidence.`);
  if (to === "approved") {
    const missing = skill.requiredPermissions.filter(p => !permissionsApproved.includes(p));
    if (missing.length) throw new Error(`Approving this skill would grant new permissions (${missing.join(", ")}); approve each explicitly.`);
  }
}

/**
 * product = ACTIVE only. evaluation = benchmark-qualified or later, under that evaluation's own authorization.
 * validation = the harness gating a skill (candidate or sandbox-validated) on its own stage; never product use.
 */
export type UseMode = "product" | "evaluation" | "validation";
export function usable(skill: Pick<Skill, "state">, mode: UseMode): boolean {
  if (mode === "validation") return skill.state === "candidate" || skill.state === "sandbox_validated";
  return mode === "product" ? skill.state === "active" : ["benchmark_qualified", "approved", "active"].includes(skill.state);
}

/** Monitoring: four consecutive failed uses, or any security violation, quarantine the skill. */
export function shouldQuarantine(uses: readonly { passed: boolean }[], securityViolation = false): boolean {
  return securityViolation || (uses.length >= 4 && uses.slice(-4).every(u => !u.passed));
}

/** Deterministic tags for a task from Host facts only (never from model output). */
export function taskTags(task: { spec: string; testerRule: string }): TaskTag[] {
  const s = task.spec;
  const tags: TaskTag[] = [];
  if (task.testerRule === "all-pass" || /any other string[^.]*must raise/i.test(s)) tags.push("strict-parsing");
  if (/\braise[sd]?\b[^.]{0,40}\b(ValueError|KeyError|ZeroDivisionError|TypeError|IndexError)\b|\(\w*Error\b/i.test(s)) tags.push("validation-errors");
  if (/\bfix it\b|\bbug\b|\bdoes not\b|\bit (fails|crashes|ignores)\b/i.test(s)) tags.push("debugging");
  if (/\bclass\s+[A-Z]\w*/.test(s)) tags.push("stateful-class");
  if (/\bstring|\btext\b|characters?\b|\bletters?\b/i.test(s)) tags.push("string-processing");
  if (/\blists?\b|\bdict\b|\btuples?\b/i.test(s)) tags.push("collections");
  if (/\bsort|order\b|\bwindow|\bmerge|interval|depend|graph|rotat/i.test(s)) tags.push("algorithm");
  if (/\bnumbers?\b|\bints?\b|\bdigits?\b|\bsum\b|average|median|seconds|cents/i.test(s)) tags.push("numeric");
  return tags;
}

/** Ranks usable skills for one role: shared task tags first, then (for a repair) matching failure categories. */
export function selectSkills(skills: readonly Skill[], input: { role: string; tags: readonly string[]; categories?: readonly string[]; mode: UseMode; limit?: number }): Skill[] {
  return skills
    .filter(s => usable(s, input.mode) && (s.roles as readonly string[]).includes(input.role))
    .map(s => ({ s, tag: s.categories.filter(c => input.tags.includes(c)).length, cat: s.failureCategories.filter(c => input.categories?.includes(c)).length }))
    .filter(x => x.tag > 0 && (!input.categories?.length || x.cat > 0 || x.tag >= 2))
    .sort((a, b) => b.tag + b.cat - (a.tag + a.cat) || a.s.name.localeCompare(b.s.name))
    .slice(0, input.limit ?? 3)
    .map(x => x.s);
}

/** The advisory block a role sees. Bounded; labelled with where it came from; the contract always wins. */
export function renderGuidance(skills: readonly Skill[], maxChars = 1200): string {
  if (!skills.length) return "";
  const head = "VERIFIED PROCEDURES (advisory: proposed by a model, validated by Host sandbox and benchmark runs; the task contract above always wins):";
  const lines: string[] = [];
  let used = head.length;
  for (const s of skills) {
    const text = `- [${s.name} v${s.version}] ${s.procedure.join(" ")}`.slice(0, s.budget.maxGuidanceChars);
    if (used + text.length + 1 > maxChars) break;
    lines.push(text); used += text.length + 1;
  }
  return lines.length ? [head, ...lines].join("\n") : "";
}
