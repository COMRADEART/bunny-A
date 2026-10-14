import type { AgentSnapshot } from "./agent-types.ts";
import type { MissionView } from "../bunny-missions/types.ts";
import { looksSecret } from "./intelligence.ts";
import type { LotusMemory } from "./lotus.ts";
import type { AgentWorker, WorkerAbility } from "./workers.ts";
import { SLOT_IDS, WEAPON_LABEL, clean, type SlotId, type WeaponId } from "./personal-agents.ts";

/**
 * M-A-3 T13.3 Gate B — durable context of the four Personal Agents (pure).
 *
 * A Personal Agent is a slot (T13). It OWNS any number of AgentRuntime Agents, each with its own Mission, and keeps a
 * user-authored profile and a bounded conversation. Nothing here creates, starts, routes, grants or stops work. Replies
 * are built only from the slot's own Host facts; a slot never reads another slot's turns or profile.
 */

export const PERSONAL_AGENT_CONTEXT_SCHEMA = "bunny-a.personal-agent-context.v1";
export const FOREGROUND_SETTING = "personal_agent_foreground";

export const CONTEXT_LIMITS = {
  personality: 500,
  goals: 8,
  goal: 200,
  preferences: 20,
  preferenceKey: 60,
  preferenceValue: 280,
  turn: 2000,
  retainedTurns: 200,
  projectedTurns: 20,
  answeredMissions: 4,
} as const;

export type ConversationIdentity = "bunny" | SlotId;

export function parseIdentity(value: unknown): ConversationIdentity {
  if (value === "bunny") return "bunny";
  if (SLOT_IDS.includes(value as SlotId)) return value as SlotId;
  throw new Error("Choose Bunny or one of the four Personal Agents.");
}

export function parseSlot(value: unknown): SlotId {
  if (!SLOT_IDS.includes(value as SlotId)) throw new Error("Choose one of the four Personal Agents (slot 1 to 4).");
  return value as SlotId;
}

export type Preference = { key: string; value: string; at: number };
export type PersonalAgentProfile = {
  slot: SlotId;
  revision: number;
  updatedAt: number;
  personality: string;
  goals: string[];
  /** Explicit user statements only. An inferred preference is never written here. */
  preferences: Preference[];
};

export const emptyProfile = (slot: SlotId): PersonalAgentProfile => ({ slot, revision: 0, updatedAt: 0, personality: "", goals: [], preferences: [] });

const noSecret = (text: string, field: string) => {
  if (looksSecret(text)) throw new Error(`${field} looks like a credential. Personal Agent memory never stores credentials.`);
  return text;
};

/** Validates a user-authored profile edit. Unknown keys are refused so no authority-looking field can be smuggled in. */
export function validateProfile(slot: SlotId, input: unknown, now: number, previous: PersonalAgentProfile): PersonalAgentProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Profile must be an object.");
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row))
    if (!["personality", "goals", "preferences"].includes(key)) throw new Error(`Unsupported Personal Agent profile field: ${key.slice(0, 40)}.`);
  const personality = row.personality === undefined ? previous.personality : noSecret(clean(row.personality, CONTEXT_LIMITS.personality, "Personality"), "Personality");
  let goals = previous.goals;
  if (row.goals !== undefined) {
    if (!Array.isArray(row.goals) || row.goals.length > CONTEXT_LIMITS.goals) throw new Error(`At most ${CONTEXT_LIMITS.goals} goals.`);
    goals = row.goals.map((goal) => noSecret(clean(goal, CONTEXT_LIMITS.goal, "Goal"), "Goal")).filter(Boolean);
  }
  let preferences = previous.preferences;
  if (row.preferences !== undefined) {
    if (!Array.isArray(row.preferences) || row.preferences.length > CONTEXT_LIMITS.preferences) throw new Error(`At most ${CONTEXT_LIMITS.preferences} preferences.`);
    const keep = new Map(previous.preferences.map((pref) => [pref.key, pref]));
    const seen = new Set<string>();
    preferences = row.preferences.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Each preference needs a key and a value.");
      const { key, value, ...rest } = raw as Record<string, unknown>;
      if (Object.keys(rest).length) throw new Error("Each preference has only a key and a value.");
      const k = noSecret(clean(key, CONTEXT_LIMITS.preferenceKey, "Preference name"), "Preference name");
      const v = noSecret(clean(value, CONTEXT_LIMITS.preferenceValue, "Preference"), "Preference");
      if (!k || !v) throw new Error("Each preference needs a key and a value.");
      if (seen.has(k)) throw new Error(`Preference "${k}" appears twice.`);
      seen.add(k);
      const old = keep.get(k);
      return { key: k, value: v, at: old && old.value === v ? old.at : now };
    });
  }
  return { slot, revision: previous.revision + 1, updatedAt: now, personality, goals, preferences };
}

export type TurnRole = "user" | "agent";
/** `host-facts`: the reply was assembled from Host records only. */
export type TurnBasis = "user" | "host-facts";
export type ConversationTurn = { id: number; slot: SlotId; at: number; role: TurnRole; text: string; basis: TurnBasis };

export function cleanTurn(text: unknown): string {
  const value = clean(text, CONTEXT_LIMITS.turn, "Message");
  if (!value) throw new Error("Say something for the Personal Agent to answer.");
  return noSecret(value, "Message");
}

export type PersonalAgentContextSlot = {
  slot: SlotId;
  /** Owned AgentRuntime Agents with their canonical state, oldest assignment first. */
  owned: { agentId: string; missionId: string | null; state: string }[];
  profile: PersonalAgentProfile;
  turns: ConversationTurn[];
  /** T13.3 Gate C: Lotus memories this Agent may read (its own scope and its Projects), newest first, bounded. */
  memories: LotusMemory[];
  /** T13.3 Gate D: this Agent's child workers, newest first, bounded. */
  workers: AgentWorker[];
};
/** Workstation-only projection; paired devices never receive it (private conversation and preferences). */
export type PersonalAgentContextSnapshot = {
  schema: typeof PERSONAL_AGENT_CONTEXT_SCHEMA;
  foreground: ConversationIdentity;
  slots: PersonalAgentContextSlot[];
  /** T13.3 Gate D: the worker ability catalogue, shared by all four Agents. */
  abilities: WorkerAbility[];
};

// ---------------------------------------------------------------------------------------------------------------
// Replies from Host facts only.
// ---------------------------------------------------------------------------------------------------------------

type OwnedAgent = Pick<AgentSnapshot["agents"][number], "id" | "state" | "missionId" | "updatedAt">;
type MissionFacts = Pick<MissionView, "id" | "title" | "objective" | "state" | "steps" | "requests">;

const STATE_WORDS: Record<string, string> = {
  CREATED: "not started",
  PLANNING: "planning",
  RUNNING: "working",
  WAITING_FOR_USER: "waiting for you",
  WAITING_FOR_DEPENDENCY: "waiting on another step",
  PAUSED: "paused",
  VERIFYING: "verifying its results",
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
  INTERRUPTED: "recovering after a restart",
};
const FINISHED = new Set(["COMPLETED", "FAILED", "STOPPED"]);
const STOP_WORDS = new Set(["what", "whats", "happened", "with", "the", "my", "is", "are", "how", "about", "doing", "to", "on", "of", "a", "an", "and", "status", "update", "going", "your", "you"]);
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));

export function personalAgentName(weapon: WeaponId, displayName: string): string {
  return displayName.trim() || WEAPON_LABEL[weapon];
}

/**
 * The reply a Personal Agent gives about its own work. Only the slot's owned Agents are considered. A question naming a
 * Mission ("the website") narrows to Missions whose title or objective share a word with it; otherwise unfinished work
 * is reported first. Counts are recorded step counts, never percentages; "verified" means Host-verified steps.
 */
export function answerFromOwnFacts(input: { name: string; question: string; owned: readonly OwnedAgent[]; missions: readonly MissionFacts[] }): string {
  const missionById = new Map(input.missions.map((mission) => [mission.id, mission]));
  const rows = input.owned.map((agent) => ({ agent, mission: agent.missionId ? missionById.get(agent.missionId) ?? null : null }));
  if (!rows.length) return `${input.name} has no Missions yet.`;
  const asked = new Set(words(input.question));
  const matches = asked.size
    ? rows.filter(({ mission }) => mission && words(`${mission.title} ${mission.objective ?? ""}`).some((word) => asked.has(word)))
    : [];
  const pool = (matches.length ? matches : rows)
    .sort((a, b) => Number(FINISHED.has(a.agent.state)) - Number(FINISHED.has(b.agent.state)) || b.agent.updatedAt - a.agent.updatedAt)
    .slice(0, CONTEXT_LIMITS.answeredMissions);
  const lines = pool.map(({ agent, mission }) => {
    const title = mission?.title ?? "A Mission whose record is no longer retained";
    const steps = mission?.steps ?? [];
    const done = steps.filter((step) => step.state === "completed").length;
    const verified = steps.filter((step) => step.result?.verified === true).length;
    const asks = (mission?.requests ?? []).filter((request) => request.resolution === null).length;
    const progress = steps.length ? `, ${done} of ${steps.length} steps done, ${verified} verified by the Host` : "";
    return `${title}: ${STATE_WORDS[agent.state] ?? "status unknown"}${progress}${asks ? `, ${asks} ${asks === 1 ? "question needs" : "questions need"} your answer` : ""}.`;
  });
  const active = rows.filter(({ agent }) => !FINISHED.has(agent.state)).length;
  const head = matches.length
    ? ""
    : `${input.name} owns ${rows.length} ${rows.length === 1 ? "Mission" : "Missions"}, ${active} unfinished. `;
  return `${head}${lines.join(" ")}`.trim();
}
