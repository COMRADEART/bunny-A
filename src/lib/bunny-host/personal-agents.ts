import type { AgentFailure, AgentSnapshot, AgentState } from "./agent-types.ts";
import type { MissionStep, MissionView } from "../bunny-missions/types.ts";
import type { OrchTask } from "../orch/types.ts";
import { classifyCommand } from "./events.ts";

/**
 * M-A-3 T13 — Personal Agent presentation identity.
 *
 * Four user-customizable slots, each shown as one of the user's four weapon characters. A slot is PRESENTATION only:
 * it names, describes and draws a durable Agent the user already owns. Nothing here creates, starts, routes, grants,
 * pauses or stops work; changing a slot never changes what an Agent may do. Internal team members (planner,
 * researcher, …) and AI providers are never bindable and never drawn as weapons.
 *
 * The presentation state of a bound slot is DERIVED from canonical Host facts (AgentState, Mission steps, Host-recorded
 * capability actions, Host-planned team kinds, provider-proven activity events). Every derived state carries its basis
 * so a client can say where it came from. When no honest source exists the state is ACTIVE (neutral) or UNKNOWN —
 * never a guessed category, never a percentage, never "verified" without Host verification.
 */

export const PERSONAL_AGENTS_SCHEMA = "bunny-a.personal-agents.v1";
export const PERSONAL_AGENTS_SETTING = "personal_agent_slots";

export const WEAPONS = ["gada", "spear", "chakra", "sword"] as const;
export type WeaponId = (typeof WEAPONS)[number];
export const WEAPON_LABEL: Record<WeaponId, string> = { gada: "Gada", spear: "Spear", chakra: "Vishnu Chakra", sword: "Sword" };

export const SLOT_IDS = [1, 2, 3, 4] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export const INTERACTION_STYLES = ["concise", "detailed", "conversational"] as const;
export type InteractionStyle = (typeof INTERACTION_STYLES)[number];

/** Descriptive tags the user picks in the Studio. They document intent; they grant nothing and route nothing. */
export const RESPONSIBILITIES = ["research", "coding", "testing", "files", "planning", "review", "writing"] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

export const PERSONAL_AGENT_LIMITS = { displayName: 40, description: 280, purpose: 280, responsibilities: RESPONSIBILITIES.length } as const;

export type PersonalAgentSlotConfig = {
  slot: SlotId;
  weapon: WeaponId;
  displayName: string;
  description: string;
  purpose: string;
  style: InteractionStyle;
  responsibilities: Responsibility[];
  /** Durable AgentProfile.id of a USER-FACING Agent (single Agent or Team Coordinator); null = unassigned. */
  agentId: string | null;
  /** Whether the bound character appears in the Notch strip. Presentation only. */
  active: boolean;
};

export type PersonalAgentsConfig = {
  schema: typeof PERSONAL_AGENTS_SCHEMA;
  /** Monotonic per write; a configure command may pass `expectRevision` to refuse lost updates. */
  revision: number;
  updatedAt: number;
  slots: PersonalAgentSlotConfig[];
};

export function defaultPersonalAgentsConfig(now = 0): PersonalAgentsConfig {
  return {
    schema: PERSONAL_AGENTS_SCHEMA,
    revision: 0,
    updatedAt: now,
    slots: SLOT_IDS.map((slot, index) => ({
      slot,
      weapon: WEAPONS[index],
      displayName: WEAPON_LABEL[WEAPONS[index]],
      description: "",
      purpose: "",
      style: "concise",
      responsibilities: [],
      agentId: null,
      active: true,
    })),
  };
}

/** A user-facing Agent: a single Agent or a Team Coordinator. Team members are internal and never bindable. */
export function isUserFacingAgent(row: Pick<AgentSnapshot["agents"][number], "team">): boolean {
  return !row.team || row.team.role === "coordinator";
}

const clean = (value: unknown, max: number, field: string): string => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  // Control characters (C0, DEL, C1) and bidi overrides or isolates never reach a label, so a name cannot spoof its
  // own text or break a layout; whitespace runs collapse so a name cannot be padded into a layout break.
  const text = value
    // eslint-disable-next-line no-control-regex -- labels must exclude C0/C1 control characters.
    .replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > max) throw new Error(`${field} is longer than ${max} characters.`);
  return text;
};

/**
 * Validates a complete four-slot configuration. Exactly four slots, each slot id once, each weapon once (the four
 * characters are the user's four identities; no extra weapon types, no duplicates). Unknown keys are refused, so a
 * client cannot smuggle authority-looking fields (permissions, provider, model, schedule) into presentation state.
 * `agentIds` is the set of currently bindable (user-facing, existing) Agent ids; a binding outside it is refused.
 */
export function validatePersonalAgentSlots(input: unknown, agentIds: ReadonlySet<string>): PersonalAgentSlotConfig[] {
  if (!Array.isArray(input) || input.length !== SLOT_IDS.length) throw new Error("Exactly four Personal Agent slots are required.");
  const allowed = new Set(["slot", "weapon", "displayName", "description", "purpose", "style", "responsibilities", "agentId", "active"]);
  const seenSlots = new Set<number>();
  const seenWeapons = new Set<string>();
  const seenAgents = new Set<string>();
  const slots = input.map((raw): PersonalAgentSlotConfig => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Each slot must be an object.");
    const row = raw as Record<string, unknown>;
    for (const key of Object.keys(row)) if (!allowed.has(key)) throw new Error(`Unsupported Personal Agent field: ${key.slice(0, 40)}.`);
    const slot = row.slot;
    if (!SLOT_IDS.includes(slot as SlotId) || seenSlots.has(slot as number)) throw new Error("Slots must be 1, 2, 3 and 4, once each.");
    seenSlots.add(slot as number);
    const weapon = row.weapon;
    if (!WEAPONS.includes(weapon as WeaponId) || seenWeapons.has(weapon as string)) throw new Error("Each of Gada, Spear, Vishnu Chakra and Sword must be used exactly once.");
    seenWeapons.add(weapon as string);
    const style = row.style ?? "concise";
    if (!INTERACTION_STYLES.includes(style as InteractionStyle)) throw new Error("Unsupported interaction style.");
    const responsibilities = row.responsibilities ?? [];
    if (!Array.isArray(responsibilities) || responsibilities.length > PERSONAL_AGENT_LIMITS.responsibilities) throw new Error("Unsupported responsibilities.");
    const tags = [...new Set(responsibilities)].map((tag) => {
      if (!RESPONSIBILITIES.includes(tag as Responsibility)) throw new Error("Unsupported responsibility.");
      return tag as Responsibility;
    });
    const agentId = row.agentId ?? null;
    if (agentId !== null) {
      if (typeof agentId !== "string" || agentId.length > 200 || !agentIds.has(agentId)) throw new Error("A slot can only be assigned to one of your own Agents.");
      if (seenAgents.has(agentId)) throw new Error("An Agent can appear in only one slot.");
      seenAgents.add(agentId);
    }
    const active = row.active ?? true;
    if (typeof active !== "boolean") throw new Error("Active must be true or false.");
    const displayName = clean(row.displayName, PERSONAL_AGENT_LIMITS.displayName, "Name") || WEAPON_LABEL[weapon as WeaponId];
    return {
      slot: slot as SlotId,
      weapon: weapon as WeaponId,
      displayName,
      description: clean(row.description, PERSONAL_AGENT_LIMITS.description, "Description"),
      purpose: clean(row.purpose, PERSONAL_AGENT_LIMITS.purpose, "Purpose"),
      style: style as InteractionStyle,
      responsibilities: tags,
      agentId: agentId as string | null,
      active,
    };
  });
  return slots.sort((a, b) => a.slot - b.slot);
}

/** Reads a persisted configuration; anything malformed falls back to defaults rather than inventing a binding. */
export function parsePersonalAgentsConfig(raw: string | null | undefined, now = 0): PersonalAgentsConfig {
  if (!raw) return defaultPersonalAgentsConfig(now);
  try {
    const value = JSON.parse(raw) as Partial<PersonalAgentsConfig>;
    if (value?.schema !== PERSONAL_AGENTS_SCHEMA || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return defaultPersonalAgentsConfig(now);
    // Persisted bindings are re-checked at projection time against live Agents; here only shape is validated.
    const ids = new Set((value.slots ?? []).map((slot) => slot?.agentId).filter((id): id is string => typeof id === "string"));
    const slots = validatePersonalAgentSlots(value.slots, ids);
    return { schema: PERSONAL_AGENTS_SCHEMA, revision: value.revision as number, updatedAt: Number(value.updatedAt) || 0, slots };
  } catch {
    return defaultPersonalAgentsConfig(now);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Presentation state (what the character animates). OFFLINE is client-only: the Host never emits it.
// ---------------------------------------------------------------------------------------------------------------

export const PRESENTATION_STATES = [
  "UNASSIGNED", "IDLE", "PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "ACTIVE", "VERIFYING",
  "WAITING", "WAITING_FOR_USER", "PAUSED", "COMPLETED", "VERIFIED", "FAILED", "STOPPED", "RECOVERING", "UNKNOWN", "OFFLINE",
] as const;
export type PresentationState = (typeof PRESENTATION_STATES)[number];

/** Where a presentation state came from. Clients surface this (e.g. "Provider reported: testing"). */
export type PresentationBasis =
  | { kind: "unassigned" }
  | { kind: "agent-missing" }
  | { kind: "agent-state"; agentState: AgentState }
  | { kind: "mission-result"; verifiedSteps: number; unverifiedSteps: number }
  | { kind: "capability"; action: string; stepId: string }
  | { kind: "command"; classified: "agent.testing" | "agent.building" | "agent.rendering" | "agent.command"; stepId: string }
  | { kind: "team-step"; teamKind: string; role: string; stepId: string }
  | { kind: "provider-event"; event: string; at: number; taskId: string }
  | { kind: "step-state"; stepState: string; stepId: string }
  | { kind: "no-category"; reason: string };

export type PersonalAgentPresentation = { state: PresentationState; label: string; basis: PresentationBasis };

export type PersonalAgentView = PersonalAgentSlotConfig & {
  agent: {
    id: string;
    name: string;
    state: AgentState;
    missionId: string | null;
    missionTitle: string | null;
    objective: string | null;
    projectId: string | null;
    failure: AgentFailure | null;
    team: boolean;
    updatedAt: number;
  } | null;
  presentation: PersonalAgentPresentation;
  /** Pending asks a person must answer for this Agent. An Agentic authorization envelope projects the mission's
   *  unresolved permission requests, so those are counted once; anything else unresolved in the Mission is added. */
  attention: { pendingApprovals: number };
  /** Real step counts from the Mission; `verified` counts steps the Host itself verified. Never a percentage. */
  progress: { completed: number; total: number; verified: number } | null;
  /** Mission completion summary as the Host recorded it (present only after completion). */
  result: { verifiedSteps: number; unverifiedSteps: number } | null;
  /** Technical detail for expanded views only; never the Agent's identity. */
  technical: { provider: string | null; model: string | null; taskId: string | null } | null;
};

export type PersonalAgentsSnapshot = {
  schema: typeof PERSONAL_AGENTS_SCHEMA;
  revision: number;
  updatedAt: number;
  slots: PersonalAgentView[];
  /** User-facing Agents that exist but are not in any slot (shown as a neutral count, never as a weapon). */
  unslottedAgents: number;
  /** Agents eligible for binding in the Studio: existing bound Agents plus the newest user-facing Agents, bounded. */
  bindable: { id: string; name: string; state: AgentState; missionTitle: string | null }[];
};

/** A provider activity event older than this no longer describes what the Agent is doing now. */
export const PROVIDER_EVENT_FRESH_MS = 90_000;

const READ_ACTIONS = /^(filesystem\.(read|list|stat|search|exists)|git\.(status|log|diff|show|branch_list)|browser\.)/;
const WRITE_ACTIONS = /^(filesystem\.(write|delete|move|copy|mkdir|rename|append)|git\.(commit|merge|add|checkout|branch|worktree_\w+|stash))/;

const LABEL: Record<PresentationState, string> = {
  UNASSIGNED: "Not assigned",
  IDLE: "Ready to start",
  PLANNING: "Planning",
  RESEARCHING: "Researching",
  CODING: "Coding",
  TESTING: "Testing",
  FILE_WORK: "Working with files",
  ACTIVE: "Working",
  VERIFYING: "Verifying",
  WAITING: "Waiting on another step",
  WAITING_FOR_USER: "Needs you",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  VERIFIED: "Completed and verified",
  FAILED: "Failed",
  STOPPED: "Stopped",
  RECOVERING: "Recovering after restart",
  UNKNOWN: "Status unknown",
  OFFLINE: "Offline",
};
export function presentationLabel(state: PresentationState): string { return LABEL[state]; }

const of = (state: PresentationState, basis: PresentationBasis, label = LABEL[state]): PersonalAgentPresentation => ({ state, label, basis });

const TEAM_KIND_STATE: Record<string, PresentationState> = {
  plan: "PLANNING",
  observe: "RESEARCHING",
  generate_json: "CODING",
  generate_html: "CODING",
  generate_markdown: "FILE_WORK",
  write_file: "FILE_WORK",
  review: "VERIFYING",
  verify_output: "VERIFYING",
};

const EVENT_STATE: Record<string, PresentationState> = {
  "agent.planning": "PLANNING",
  "agent.reading": "RESEARCHING",
  "agent.searching": "RESEARCHING",
  "agent.editing": "CODING",
  "agent.testing": "TESTING",
  "agent.verifying": "VERIFYING",
};

type TaskFacts = Pick<OrchTask, "id" | "state" | "provider" | "model"> & { latestEvent?: OrchTask["latestEvent"] };

/**
 * What a RUNNING Agent is doing, from the strongest honest source available for its admitted step(s):
 * a step in `verifying` → VERIFYING; a Host-planned team kind; a Host-recorded capability action (and, for
 * terminal.exec, the command the Host will run classified by events.classifyCommand); a FRESH provider-proven
 * activity event on the step's running task. Otherwise ACTIVE with no category.
 */
export function runningPresentation(steps: MissionStep[], tasks: ReadonlyMap<string, TaskFacts>, now: number): PersonalAgentPresentation {
  // A single Agent owns every step of its Mission; a Team Coordinator is shown by its team's newest admitted step.
  const live = steps.filter((step) => step.state === "running" || step.state === "verifying");
  const ordered = [...live].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  for (const step of ordered) {
    if (step.state === "verifying") return of("VERIFYING", { kind: "step-state", stepState: step.state, stepId: step.id });
    if (step.team) {
      const state = TEAM_KIND_STATE[step.team.kind];
      if (state) return of(state, { kind: "team-step", teamKind: step.team.kind, role: step.team.role, stepId: step.id });
    }
    if (step.executor.kind === "capability") {
      const action = step.executor.action;
      if (action === "terminal.exec") {
        const command = step.executor.params?.command;
        if (typeof command === "string") {
          // terminal.exec launches an executable with separate arguments, without a shell.
          // Include that argv when describing the work; "node" alone cannot prove a test is running.
          const args = step.executor.params?.args;
          const argv = Array.isArray(args) && args.every((arg) => typeof arg === "string") ? args : [];
          const classified = classifyCommand([command, ...argv].join(" "));
          if (classified === "agent.testing") return of("TESTING", { kind: "command", classified, stepId: step.id });
          return of("ACTIVE", { kind: "command", classified, stepId: step.id }, classified === "agent.building" ? "Building" : "Running a command");
        }
      }
      if (READ_ACTIONS.test(action)) return of("RESEARCHING", { kind: "capability", action, stepId: step.id });
      if (WRITE_ACTIONS.test(action)) return of("FILE_WORK", { kind: "capability", action, stepId: step.id });
      return of("ACTIVE", { kind: "capability", action, stepId: step.id });
    }
    const task = step.taskId ? tasks.get(step.taskId) : undefined;
    const event = task?.latestEvent;
    // An event stamped after this instant (a clock step backwards) proves nothing about now either, so it is not fresh.
    const age = now - (event?.at ?? Number.NaN);
    if (task && event && EVENT_STATE[event.type] && age >= 0 && age <= PROVIDER_EVENT_FRESH_MS && (task.state === "running" || task.state === "verifying")) {
      return of(EVENT_STATE[event.type], { kind: "provider-event", event: event.type, at: event.at, taskId: task.id });
    }
  }
  return of("ACTIVE", { kind: "no-category", reason: live.length ? "No Host or provider fact names the current kind of work." : "No step is admitted right now." });
}

/**
 * The full mapping from a bound Agent's canonical facts to its presentation state. Precedence: terminal outcomes,
 * user asks, pause, recovery, verification, dependency wait, planning, running category, not-started.
 * COMPLETED becomes VERIFIED only when the Mission result reports at least one verified step and zero unverified steps.
 */
export function agentPresentation(
  agent: AgentSnapshot["agents"][number],
  mission: MissionView | null,
  tasks: ReadonlyMap<string, TaskFacts>,
  now: number,
): PersonalAgentPresentation {
  const basis: PresentationBasis = { kind: "agent-state", agentState: agent.state };
  // A pending consent ask outranks every non-terminal state: work never waits silently behind an approval the user has not seen.
  const consentAsked = agent.authorization?.state === "WAITING_FOR_USER" || (agent.authorization?.pending.length ?? 0) > 0;
  if (consentAsked && agent.state !== "COMPLETED" && agent.state !== "FAILED" && agent.state !== "STOPPED") return of("WAITING_FOR_USER", basis);
  switch (agent.state) {
    case "COMPLETED": {
      const result = mission?.result;
      if (result && result.verifiedSteps > 0 && result.unverifiedSteps === 0) {
        return of("VERIFIED", { kind: "mission-result", verifiedSteps: result.verifiedSteps, unverifiedSteps: result.unverifiedSteps });
      }
      return result
        ? of("COMPLETED", { kind: "mission-result", verifiedSteps: result.verifiedSteps, unverifiedSteps: result.unverifiedSteps },
            result.unverifiedSteps > 0 ? `Completed · ${result.unverifiedSteps} unverified` : "Completed")
        : of("COMPLETED", basis);
    }
    case "FAILED": return of("FAILED", basis);
    case "STOPPED": return of("STOPPED", basis);
    case "WAITING_FOR_USER": return of("WAITING_FOR_USER", basis);
    case "PAUSED": return of("PAUSED", basis);
    case "INTERRUPTED": return of("RECOVERING", basis);
    case "VERIFYING": return of("VERIFYING", basis);
    case "WAITING_FOR_DEPENDENCY": return of("WAITING", basis);
    case "PLANNING": return of("PLANNING", basis);
    case "CREATED": return of("IDLE", basis);
    case "RUNNING": {
      return runningPresentation(mission?.steps ?? [], tasks, now);
    }
    default: return of("UNKNOWN", basis);
  }
}

export type PersonalAgentsInput = {
  config: PersonalAgentsConfig;
  agents: AgentSnapshot["agents"];
  missions: MissionView[];
  tasks: TaskFacts[];
  now: number;
};

const BINDABLE_LIMIT = 50;

/** Projects the configured slots onto live Host facts. Pure: the Host calls it per snapshot, before redaction. */
export function projectPersonalAgents({ config, agents, missions, tasks, now }: PersonalAgentsInput): PersonalAgentsSnapshot {
  const userFacing = agents.filter(isUserFacingAgent);
  const byId = new Map(userFacing.map((agent) => [agent.id, agent]));
  const missionById = new Map(missions.map((mission) => [mission.id, mission]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const slotted = new Set<string>();
  const slots = config.slots.map((slot): PersonalAgentView => {
    const base = { ...slot, agent: null, attention: { pendingApprovals: 0 }, progress: null, result: null, technical: null };
    if (!slot.agentId) return { ...base, presentation: of("UNASSIGNED", { kind: "unassigned" }) };
    const agent = byId.get(slot.agentId);
    // A binding to an Agent that is gone or has become internal is shown as unknown, never as some other Agent.
    if (!agent) return { ...base, presentation: of("UNKNOWN", { kind: "agent-missing" }) };
    slotted.add(agent.id);
    const mission = agent.missionId ? missionById.get(agent.missionId) ?? null : null;
    const steps = mission?.steps ?? [];
    // With an Agentic authorization envelope, `authorization.pending` IS this mission's unresolved permission
    // requests (the projection maps the same permission_requests rows), so the mission list must count only the
    // rows the envelope does not already cover, or every ask is reported twice.
    const consentAsks = agent.authorization?.pending.length ?? 0;
    const consentIds = new Set((agent.authorization?.pending ?? []).map((request) => String(request.id)));
    const missionAsks = (mission?.requests ?? []).filter((request) => request.resolution === null && !consentIds.has(String(request.id))).length;
    const running = [...steps].filter((step) => step.state === "running" || step.state === "verifying").sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    const runningTask = running?.taskId ? taskById.get(running.taskId) : undefined;
    return {
      ...slot,
      agent: {
        id: agent.id,
        name: agent.name,
        state: agent.state,
        missionId: agent.missionId,
        missionTitle: mission?.title ?? null,
        objective: mission?.objective ?? null,
        projectId: mission?.projectId ?? null,
        failure: agent.failure,
        team: !!agent.team,
        updatedAt: agent.updatedAt,
      },
      presentation: agentPresentation(agent, mission, taskById, now),
      attention: { pendingApprovals: consentAsks + missionAsks },
      progress: steps.length
        ? { completed: steps.filter((step) => step.state === "completed").length, total: steps.length, verified: steps.filter((step) => step.result?.verified === true).length }
        : null,
      result: mission?.result ? { verifiedSteps: mission.result.verifiedSteps, unverifiedSteps: mission.result.unverifiedSteps } : null,
      technical: runningTask ? { provider: runningTask.provider ?? null, model: runningTask.model ?? null, taskId: runningTask.id } : null,
    };
  });
  const bindable = [...userFacing]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    // Keep every existing confirmed binding editable even after enough newer Agents displace it from the recent list.
    // At most four bound Agents are added to the fifty recent entries; internal/missing bindings never enter this list.
    .filter((agent, index) => index < BINDABLE_LIMIT || slotted.has(agent.id))
    .map((agent) => ({ id: agent.id, name: agent.name, state: agent.state, missionTitle: agent.missionId ? missionById.get(agent.missionId)?.title ?? null : null }));
  return {
    schema: PERSONAL_AGENTS_SCHEMA,
    revision: config.revision,
    updatedAt: config.updatedAt,
    slots,
    unslottedAgents: userFacing.filter((agent) => !slotted.has(agent.id) && !["COMPLETED", "FAILED", "STOPPED"].includes(agent.state)).length,
    bindable,
  };
}
