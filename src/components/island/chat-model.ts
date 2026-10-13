/**
 * M-A-3 T13 Chat landing, client side. Greeting and quick actions carry no user name and no invented data. Recent Missions
 * are the Host's own records: real step counts, real state, and a weapon only where a slotted Personal Agent owns the Mission.
 */
import type { MissionState, MissionView } from "../../lib/bunny-missions/types.ts";
import type { PersonalAgentsSnapshot, PresentationState, WeaponId } from "../../lib/bunny-host/personal-agents.ts";
import { WEAPON_LABEL } from "../../lib/bunny-host/personal-agents.ts";
import type { NavView } from "./nav-model.ts";

export const CHAT_QUESTION = "What would you like to do today?";

/** Time-of-day greeting. Never includes a user name: the Host knows no display name for the viewer. */
export function greetingFor(hour: number): "Good morning" | "Good afternoon" | "Good evening" {
  if (!Number.isFinite(hour)) return "Good morning";
  const h = Math.floor(hour) % 24;
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

export type QuickAction =
  | { id: string; label: string; kind: "prefill"; prompt: string }
  | { id: string; label: string; kind: "navigate"; view: NavView };

/** Quick actions only prefill the composer or open an existing surface. None of them starts work by itself. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "project", label: "Create a project", kind: "navigate", view: "projects" },
  { id: "analyze", label: "Analyze code", kind: "prefill", prompt: "Analyze the code in my project. Summarize its structure and point out risks." },
  { id: "fix", label: "Fix errors", kind: "prefill", prompt: "Find the errors in my project, fix them, and explain each change." },
  { id: "research", label: "Research anything", kind: "prefill", prompt: "Research this and summarize what you find, with sources: " },
  { id: "files", label: "Manage files", kind: "navigate", view: "files" },
];

/** Composer chips. Web, Files and Code only attach or prefill existing context. Voice appears only where voice is available. */
export type ComposerChip = { id: "web" | "files" | "code" | "voice"; label: string };
export function composerChips(voiceAvailable: boolean): ComposerChip[] {
  const chips: ComposerChip[] = [
    { id: "web", label: "Web" },
    { id: "files", label: "Files" },
    { id: "code", label: "Code" },
  ];
  if (voiceAvailable) chips.push({ id: "voice", label: "Voice" });
  return chips;
}

export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  draft: "Draft",
  planning: "Planning",
  waiting_for_approval: "Needs approval",
  ready: "Ready",
  running: "Running",
  waiting_for_user: "Needs you",
  verifying: "Verifying",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

export type MissionRow = {
  id: string;
  title: string;
  stateLabel: string;
  state: MissionState;
  /** Set only when a slotted Personal Agent owns this Mission; otherwise the row shows a neutral icon. */
  weapon: WeaponId | null;
  weaponName: string | null;
  /** The owning slot's Host presentation state, so the weapon art shows what the Host reports. */
  presentation: PresentationState | null;
  completed: number;
  total: number;
  verified: number;
  /** "3 of 7 steps · 2 verified", or "No steps yet". Never a percentage. */
  stepLabel: string;
};

/** Real step counts only: `completed` counts completed steps, `verified` counts steps the Host verified. */
export function missionStepCounts(mission: Pick<MissionView, "steps">) {
  const steps = mission.steps ?? [];
  return {
    completed: steps.filter((step) => step.state === "completed").length,
    total: steps.length,
    verified: steps.filter((step) => step.result?.verified === true).length,
  };
}

export function stepLabel(counts: { completed: number; total: number; verified: number }): string {
  if (counts.total === 0) return "No steps yet";
  return `${counts.completed} of ${counts.total} ${counts.total === 1 ? "step" : "steps"} · ${counts.verified} verified`;
}

/**
 * Recent Missions, newest activity first. The weapon comes from a slot whose bound Agent owns the Mission; a Mission with no
 * slotted Agent gets no weapon (the caller draws a neutral icon).
 */
export function recentMissionRows(
  missions: readonly MissionView[],
  personalAgents: PersonalAgentsSnapshot | null,
  limit = 4,
): MissionRow[] {
  const owner = new Map<string, { weapon: WeaponId; name: string; presentation: PresentationState }>();
  for (const slot of personalAgents?.slots ?? []) {
    const missionId = slot.agent?.missionId;
    if (missionId) owner.set(missionId, { weapon: slot.weapon, name: slot.displayName || WEAPON_LABEL[slot.weapon], presentation: slot.presentation.state });
  }
  return [...missions]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((mission) => {
      const counts = missionStepCounts(mission);
      const who = owner.get(mission.id) ?? null;
      return {
        id: mission.id,
        title: mission.title,
        state: mission.state,
        stateLabel: MISSION_STATE_LABEL[mission.state] ?? "Status unknown",
        weapon: who?.weapon ?? null,
        weaponName: who?.name ?? null,
        presentation: who?.presentation ?? null,
        ...counts,
        stepLabel: stepLabel(counts),
      };
    });
}

export const RECENT_MISSIONS_EMPTY = {
  title: "No Missions yet.",
  detail: "A Mission is durable work that keeps running on your Host, even when this window is closed.",
};
