import { clean, type SlotId } from "./personal-agents.ts";

/**
 * M-A-3 T13.3 Gate D — bounded child workers (pure, browser-safe).
 *
 * A worker is temporary help a Personal Agent asks for inside one of its own Missions. It is not an identity and not an
 * executor: each admitted worker becomes one child Mission that MissionManager plans, gets approved, runs and verifies
 * exactly like any other. This module only decides whether a worker may exist and what its Mission's outcome means.
 */

export const WORKER_SCHEMA = "bunny-a.workers.v1";

export const WORKER_STATES = ["PROPOSED", "ELIGIBILITY_CHECK", "ADMITTED", "RUNNING", "RESULT_REPORTED", "VERIFIED", "REJECTED", "INDETERMINATE", "CLOSED"] as const;
export type WorkerState = (typeof WORKER_STATES)[number];

const NEXT: Record<WorkerState, readonly WorkerState[]> = {
  PROPOSED: ["ELIGIBILITY_CHECK"],
  ELIGIBILITY_CHECK: ["ADMITTED", "REJECTED"],
  // A child Mission can end (refused plan, stop before approval) without ever running.
  ADMITTED: ["RUNNING", "RESULT_REPORTED"],
  RUNNING: ["RESULT_REPORTED"],
  RESULT_REPORTED: ["VERIFIED", "REJECTED", "INDETERMINATE"],
  VERIFIED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  INDETERMINATE: ["CLOSED"],
  CLOSED: [],
};
export const canMove = (from: WorkerState, to: WorkerState) => NEXT[from].includes(to);
export const OPEN_STATES: readonly WorkerState[] = ["PROPOSED", "ELIGIBILITY_CHECK", "ADMITTED", "RUNNING", "RESULT_REPORTED"];

export const WORKER_LIMITS = {
  /** Open workers under one parent Mission, and in total over its life. */
  openPerParent: 3,
  totalPerParent: 12,
  /** Open workers across all of one Personal Agent's Missions. */
  openPerSlot: 6,
  /** Components in a composed ability (each becomes one step of the worker's Mission). */
  components: 5,
  objective: 2000,
  timeoutMs: { min: 30_000, max: 30 * 60_000, default: 10 * 60_000 },
  maxRetries: 1,
  /** Lotus lines a worker receives: the one-Project slice, never the Agent's private scope. */
  contextLines: 4,
  history: 20,
} as const;

/**
 * What a worker can do. Built-in abilities wrap the Host's verified skills (deterministic, Host-validated) or a routed
 * model step (tool-free text). A composed ability chains approved skill-backed abilities; it holds no code of its own.
 */
export type WorkerAbility = {
  id: string;
  name: string;
  description: string;
  kind: "skill" | "model" | "composed";
  /** kind "skill": the Host skill id. */
  skillId?: string;
  /** kind "composed": built-in skill-backed ability ids, run in order. */
  components?: string[];
  /** Parameters the caller must supply (skill parameters). */
  parameters?: string[];
  /** The Host's independent postcondition: this command, run by the verifier, must exit 0. Without one, a worker can
   * finish but never be VERIFIED. */
  verify?: { command: string; args: string[] };
  status: "active" | "pending_review";
  source: "builtin" | "user";
  createdAt?: number;
};

export const BUILTIN_ABILITIES: readonly WorkerAbility[] = [
  { id: "test", name: "Run tests", description: "Runs the Project's npm test; the Host re-runs it to verify.", kind: "skill", skillId: "project.test", verify: { command: "npm", args: ["test"] }, status: "active", source: "builtin" },
  { id: "build", name: "Build verification", description: "Runs the Project's npm run build; the Host re-runs it to verify.", kind: "skill", skillId: "project.build", verify: { command: "npm", args: ["run", "build"] }, status: "active", source: "builtin" },
  { id: "typecheck", name: "Typecheck", description: "Runs the Project's npm run typecheck; the Host re-runs it to verify.", kind: "skill", skillId: "project.typecheck", verify: { command: "npm", args: ["run", "typecheck"] }, status: "active", source: "builtin" },
  { id: "lint", name: "Lint", description: "Runs the Project's npm run lint; the Host re-runs it to verify.", kind: "skill", skillId: "project.lint", verify: { command: "npm", args: ["run", "lint"] }, status: "active", source: "builtin" },
  { id: "repository", name: "Repository analysis", description: "Reads git status and diff of the Project. Evidence only; never VERIFIED.", kind: "skill", skillId: "git.snapshot", status: "active", source: "builtin" },
  { id: "web", name: "Web page capture", description: "Opens a public page in the Bunny browser, reads and screenshots it. Evidence only; never VERIFIED.", kind: "skill", skillId: "web.capture_page", parameters: ["url"], status: "active", source: "builtin" },
  { id: "research", name: "Research notes", description: "A routed model writes notes from the objective. Tool-free; never VERIFIED by its own words.", kind: "model", status: "active", source: "builtin" },
  { id: "documentation", name: "Documentation draft", description: "A routed model drafts documentation text. Tool-free; never VERIFIED by its own words.", kind: "model", status: "active", source: "builtin" },
  { id: "review", name: "Review", description: "A routed model reviews the objective's material and lists findings. Tool-free; never VERIFIED by its own words.", kind: "model", status: "active", source: "builtin" },
];

/** A user-described ability: a name, plain-language purpose and approved skill-backed components. Never code. */
export function composeAbility(input: { name: unknown; description: unknown; components: unknown }, existing: readonly WorkerAbility[], now: number): WorkerAbility {
  const name = clean(input.name, 60, "Ability name");
  const description = clean(input.description, 400, "Ability description");
  if (!name || !description) throw new Error("Describe the ability with a name and what it should do.");
  const components = Array.isArray(input.components) ? input.components.filter((item): item is string => typeof item === "string") : [];
  if (!components.length || components.length > WORKER_LIMITS.components) throw new Error(`Choose 1 to ${WORKER_LIMITS.components} existing abilities to build it from.`);
  for (const id of components) {
    const part = BUILTIN_ABILITIES.find((ability) => ability.id === id);
    if (!part || part.kind !== "skill" || part.parameters?.length) throw new Error(`${id} cannot be a component; only built-in Host-verified abilities without parameters can.`);
  }
  const id = `user.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ability"}`;
  if (existing.some((ability) => ability.id === id)) throw new Error("An ability with that name already exists.");
  return { id, name, description, kind: "composed", components, status: "pending_review", source: "user", createdAt: now };
}

export type WorkerBudget = { timeoutMs: number; maxRetries: number };

export function workerBudget(value: { timeoutMs?: unknown; maxRetries?: unknown }): WorkerBudget {
  const { min, max } = WORKER_LIMITS.timeoutMs;
  const timeoutMs = value.timeoutMs === undefined ? WORKER_LIMITS.timeoutMs.default : Number(value.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < min || timeoutMs > max) throw new Error(`A worker's time limit must be ${min / 1000} seconds to ${max / 60_000} minutes.`);
  const maxRetries = value.maxRetries === undefined ? 0 : Number(value.maxRetries);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > WORKER_LIMITS.maxRetries) throw new Error(`A worker may retry at most ${WORKER_LIMITS.maxRetries} time.`);
  return { timeoutMs, maxRetries };
}

export type EligibilityInput = {
  slot: SlotId;
  ability: WorkerAbility | null;
  /** Capability actions the ability's steps need, from the Host's skill records. */
  abilityTools: readonly string[];
  /** Tools the proposal asks for; null means "what the ability needs". */
  requestedTools: readonly string[] | null;
  parent: { missionId: string; state: string; projectId: string | null; ownedBySlot: boolean; isWorkerMission: boolean } | null;
  projectId: string | null;
  openForParent: number;
  totalForParent: number;
  openForSlot: number;
};

const PARENT_LIVE = ["draft", "planning", "waiting_for_approval", "ready", "running", "waiting_for_user", "verifying"];

/** Every reason the Host refuses this worker; an empty list admits it. Nothing here widens any permission. */
export function eligibility(input: EligibilityInput): string[] {
  const problems: string[] = [];
  const { ability, parent } = input;
  if (!ability) problems.push("That ability is not in the catalogue.");
  else if (ability.status !== "active") problems.push("That ability is waiting for your review and cannot be used yet.");
  if (!parent) problems.push("A worker needs a parent Mission.");
  else {
    if (parent.isWorkerMission) problems.push("A worker cannot create workers; only a Personal Agent's own Mission can.");
    else if (!parent.ownedBySlot) problems.push("A Personal Agent can add workers only to a Mission it owns.");
    if (!PARENT_LIVE.includes(parent.state)) problems.push("The parent Mission has ended, so it cannot take new workers.");
    if (input.projectId !== parent.projectId) problems.push("A worker's Project must be its parent Mission's Project.");
  }
  if (input.requestedTools) {
    const extra = input.requestedTools.filter((tool) => !input.abilityTools.includes(tool));
    if (extra.length) problems.push(`A worker cannot ask for tools beyond its ability (${extra.join(", ")}).`);
  }
  if (input.openForParent >= WORKER_LIMITS.openPerParent) problems.push(`This Mission already has ${WORKER_LIMITS.openPerParent} open workers.`);
  if (input.totalForParent >= WORKER_LIMITS.totalPerParent) problems.push(`This Mission has used its ${WORKER_LIMITS.totalPerParent} workers.`);
  if (input.openForSlot >= WORKER_LIMITS.openPerSlot) problems.push(`This Personal Agent already has ${WORKER_LIMITS.openPerSlot} open workers.`);
  return problems;
}

export type ChildOutcome = {
  state: string;
  steps: { state: string; verified: boolean | null; summary: string | null; failure?: string | null }[];
};

/**
 * What a finished child Mission means. Only the Host's own step verification can make a worker VERIFIED; a summary that
 * says "success" counts for nothing. A Mission that ended without running everything, or ran without independent
 * verification, is INDETERMINATE.
 */
export function verdict(outcome: ChildOutcome): { state: "VERIFIED" | "REJECTED" | "INDETERMINATE"; reason: string } {
  if (outcome.steps.some((step) => step.verified === false)) return { state: "REJECTED", reason: "The Host's verification failed." };
  if (outcome.state === "failed") return { state: "REJECTED", reason: "The worker's Mission failed." };
  // T13.3 N-C: a step whose own work reported failure stays a failure when the owner then stops the paused Mission. An
  // interruption (restart, stop, timeout) is not a verdict on the work.
  if (outcome.steps.some((step) => step.state === "failed" && (step.failure === "capability_failed" || step.failure === "verification_failed")))
    return { state: "REJECTED", reason: "A step of the worker's Mission failed." };
  if (outcome.state === "stopped") return { state: "INDETERMINATE", reason: "The worker was stopped before a verified result." };
  if (outcome.state !== "completed") return { state: "INDETERMINATE", reason: `The worker's Mission ended as ${outcome.state}.` };
  if (!outcome.steps.length || outcome.steps.some((step) => step.state !== "completed")) return { state: "INDETERMINATE", reason: "Not every step completed." };
  if (outcome.steps.some((step) => step.verified !== true)) return { state: "INDETERMINATE", reason: "Finished without independent verification." };
  return { state: "VERIFIED", reason: "Every step passed the Host's verification." };
}

export type AgentWorker = {
  id: string;
  slot: SlotId;
  parentMissionId: string;
  projectId: string | null;
  abilityId: string;
  abilityName: string;
  objective: string;
  tools: string[];
  budget: WorkerBudget;
  /** The Lotus lines it was given (rendered, labelled); empty without a Project. */
  context: string[];
  /** How it executes: "skill:<id>" per step, or "model:routed" (BunnyRouter picks per step at run time). */
  harness: string[];
  /** Providers the Host actually used, read from step attempts after the run. */
  providers: string[];
  childMissionId: string | null;
  state: WorkerState;
  problems: string[];
  result: { summary: string; verified: boolean | null; reason: string } | null;
  history: { state: WorkerState; at: number; note: string }[];
  provenance: `agent:${SlotId}`;
  createdAt: number;
  updatedAt: number;
};

/** Applies one lifecycle step; an illegal move is a programming error and throws. */
export function move(worker: AgentWorker, to: WorkerState, note: string, at: number): AgentWorker {
  if (!canMove(worker.state, to)) throw new Error(`A worker cannot move from ${worker.state} to ${to}.`);
  return { ...worker, state: to, updatedAt: at, history: [...worker.history, { state: to, at, note: note.slice(0, 300) }].slice(-WORKER_LIMITS.history) };
}
