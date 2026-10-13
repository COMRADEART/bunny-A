import type { SnapshotViewer } from "../../lib/bunny-host/contracts.ts";
import type { AgentSnapshot, AgentState } from "../../lib/bunny-host/agent-types.ts";
import { isUserFacingAgent, type PersonalAgentView, type SlotId } from "../../lib/bunny-host/personal-agents.ts";
import type { MissionView } from "../../lib/bunny-missions/types.ts";
import type { OrchTask } from "../../lib/orch/types.ts";
import { hostLive } from "./character-model.ts";
import { pairingReason, type Connection } from "./connection-model.ts";
import { controlCaption, type Verdict } from "./remote-view-model.ts";
import { LIVE_MISSION, MISSION_LABEL } from "./mission-model.ts";

/**
 * T13 touch-first phone companion (pure). Tab and detail routing, what this principal may do (workstation or paired
 * device, from the Host's own rights list), whether the client may present the Host's view as live, the agent action
 * availability, and the real step-count text. No React, no timers, no mock data: every number here is a count the Host
 * reported. Progress is never a percentage.
 */

// ---------------------------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------------------------

export const PHONE_TABS = ["home", "chat", "agents", "missions", "settings"] as const;
export type PhoneTab = (typeof PHONE_TABS)[number];
export const PHONE_TAB_LABEL: Record<PhoneTab, string> = { home: "Home", chat: "Chat", agents: "Agents", missions: "Missions", settings: "Settings" };

/** A detail view remembers the tab it was opened from, so Back returns there and that tab stays highlighted. */
export type PhoneRoute =
  | { kind: "tab"; tab: PhoneTab }
  | { kind: "agent"; slot: SlotId; from: PhoneTab }
  | { kind: "mission"; missionId: string; from: PhoneTab }
  | { kind: "projects"; from: PhoneTab };

export const HOME_ROUTE: PhoneRoute = { kind: "tab", tab: "home" };

export function isPhoneTab(value: unknown): value is PhoneTab {
  return typeof value === "string" && (PHONE_TABS as readonly string[]).includes(value);
}

/** Unknown or missing tab names fall back to Home; a query string can never name a view that does not exist. */
export function tabFromParam(value: string | null | undefined): PhoneTab {
  return isPhoneTab(value) ? value : "home";
}

const SLOT_PARAM = new Set(["1", "2", "3", "4"]);

/**
 * The starting route from the page's query string: `?tab=missions`, `?slot=2` (Agent detail, opened from Home) or
 * `?mission=<id>` (Mission detail, opened from Missions). A slot or mission named in the query wins over the tab.
 */
export function routeFromSearch(search: string): PhoneRoute {
  const params = new URLSearchParams(search);
  const slot = params.get("slot");
  if (slot && SLOT_PARAM.has(slot)) return { kind: "agent", slot: Number(slot) as SlotId, from: "home" };
  const mission = params.get("mission");
  if (mission && mission.length <= 200) return { kind: "mission", missionId: mission, from: "missions" };
  if (params.get("view") === "projects") return { kind: "projects", from: "home" };
  return { kind: "tab", tab: tabFromParam(params.get("tab")) };
}

/** The bottom-bar tab that stays highlighted for a route. */
export function routeTab(route: PhoneRoute): PhoneTab {
  return route.kind === "tab" ? route.tab : route.from;
}

/** Where Back goes: a tab returns Home, a detail returns to the tab it was opened from. */
export function parentRoute(route: PhoneRoute): PhoneRoute {
  return route.kind === "tab" ? HOME_ROUTE : { kind: "tab", tab: route.from };
}

export const agentRoute = (slot: SlotId, from: PhoneTab): PhoneRoute => ({ kind: "agent", slot, from });
export const missionRoute = (missionId: string, from: PhoneTab): PhoneRoute => ({ kind: "mission", missionId, from });

// ---------------------------------------------------------------------------------------------------------------
// Connection status: is the Host's view live, retained, or not usable at all.
// ---------------------------------------------------------------------------------------------------------------

export type PhoneStatus = "live" | "stale" | "offline" | "connecting" | "pairing" | "host-changed";

/**
 * `live` only when the Host's view is fresh (characters.hostLive). A retained view with a known snapshot is `stale` while
 * the connection is still trying, and `offline` once the connection gave up. Pairing and a changed Host are their own
 * states: nothing from them is presented as current.
 */
export function phoneStatus(connection: Pick<Connection, "state" | "snapshotAt">, now: number): PhoneStatus {
  if (connection.state === "pairing") return "pairing";
  if (connection.state === "host-changed") return "host-changed";
  if (hostLive(connection, now)) return "live";
  if (connection.snapshotAt === null) return connection.state === "offline" ? "offline" : "connecting";
  return connection.state === "offline" ? "offline" : "stale";
}

/** Loops, one-shots and live levels run only while the Host's view is live. */
export const animatesFor = (status: PhoneStatus) => status === "live";

export type StatusCopy = { tone: "ok" | "warn" | "danger" | "neutral"; title: string; detail: string | null };

/**
 * The banner copy. `format` renders a snapshot time (for example "14:05"), so the caller owns the locale and tests stay
 * deterministic. Retained data always names the time it was last confirmed by the Host.
 */
export function statusCopy(
  status: PhoneStatus,
  input: { snapshotAt: number | null; pairingCode: string | null; format: (at: number) => string },
): StatusCopy {
  const known = input.snapshotAt === null ? null : `Showing last known state from ${input.format(input.snapshotAt)}`;
  switch (status) {
    case "live":
      return { tone: "ok", title: "Live from your PC", detail: null };
    case "stale":
      return {
        tone: "warn",
        title: known ?? "Connecting to Host",
        detail: known ? "Animations are stopped. Updates resume when the Host answers." : "Controls stay paused until the Host answers.",
      };
    case "offline":
      return {
        tone: "danger",
        title: "Bunny-A Host is unreachable",
        detail: known ? `${known}. Controls are paused.` : "Controls are paused until the Host answers.",
      };
    case "connecting":
      return { tone: "neutral", title: "Connecting to Host", detail: "Controls stay paused until the Host answers." };
    case "pairing":
      return { tone: "warn", title: "Pairing required", detail: pairingReason(input.pairingCode) };
    case "host-changed":
      return { tone: "danger", title: "Different Bunny-A Host", detail: "Review it before changing anything." };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Capabilities: what this principal may do. Default-deny: an unknown viewer can do nothing.
// ---------------------------------------------------------------------------------------------------------------

/** Device rights the Host grants for supervising a running Agent (device-authority DEVICE_RIGHTS). */
export const SUPERVISE_RIGHTS = ["agent.pause", "agent.resume", "agent.stop"] as const;

/**
 * The Host right each Agent control needs. The Host checks the same name per command, so the phone offers a control only
 * when the right it names is held.
 */
export const AGENT_ACTION_RIGHT = { pause: "agent.pause", resume: "agent.resume", stop: "agent.stop" } as const;

export type PhoneCapabilities = {
  /** The workstation itself (the only principal that may use voice and the Studio). */
  workstation: boolean;
  /** A paired device (a thin remote client). */
  device: boolean;
  /** Voice: workstation only, never a device. */
  voice: boolean;
  /** Personal Agent Studio writes (personal_agents.configure): workstation only. */
  studio: boolean;
  /** Ordinary chat requests: the workstation, or a device holding the `submit` right. */
  chat: boolean;
  /** pause / resume / stop on an Agent: the workstation, or a device holding all three supervise rights. */
  supervise: boolean;
  /** Stop a Mission (`mission.stop`): the workstation, or a device holding that right. */
  missionStop: boolean;
  /** Answering a Host ask (within the Host's per-request verdict): the workstation, or a device holding `mission.respond`. */
  answer: boolean;
  /** Approving a reviewed Mission plan (within the Host's verdict): the workstation, or a device holding `mission.approve`. */
  approve: boolean;
  /** Approving an Agent's delegation offer (within the Host's verdict): the workstation, or `agent.authorization.approve`. */
  delegate: boolean;
  /** Sign this device out (a device revokes only its own credential). */
  signOut: boolean;
};

/** Whether the viewer holds a named Host right. The workstation holds every right; an unknown viewer holds none. */
export function holdsRight(viewer: SnapshotViewer | null | undefined, right: string): boolean {
  if (!viewer) return false;
  if (viewer.kind === "workstation") return true;
  return viewer.rights.includes(right);
}

export function phoneCapabilities(viewer: SnapshotViewer | null | undefined): PhoneCapabilities {
  if (!viewer || (viewer.kind !== "workstation" && viewer.kind !== "device")) {
    return { workstation: false, device: false, voice: false, studio: false, chat: false, supervise: false, missionStop: false, answer: false, approve: false, delegate: false, signOut: false };
  }
  const workstation = viewer.kind === "workstation";
  return {
    workstation,
    device: !workstation,
    voice: workstation,
    studio: workstation,
    chat: holdsRight(viewer, "submit"),
    supervise: SUPERVISE_RIGHTS.every((right) => holdsRight(viewer, right)),
    missionStop: holdsRight(viewer, "mission.stop"),
    answer: holdsRight(viewer, "mission.respond"),
    approve: holdsRight(viewer, "mission.approve"),
    delegate: holdsRight(viewer, "agent.authorization.approve"),
    // A device revokes only its own credential; the workstation does not sign itself out from the phone.
    signOut: !workstation && holdsRight(viewer, "device.revoke"),
  };
}

/** The voice entry for this principal. Devices are told where voice lives instead of being shown a microphone. */
export function voiceEntry(viewer: SnapshotViewer | null | undefined): { available: boolean; caption: string } {
  return phoneCapabilities(viewer).voice
    ? { available: true, caption: "Talk to Bunny" }
    : { available: false, caption: "Voice is available on your PC" };
}

/** A short line naming who this screen is for. */
export function sessionLine(viewer: SnapshotViewer | null | undefined): string {
  if (!viewer) return "Checking this device";
  return viewer.kind === "workstation" ? "This workstation" : `Paired device · ${viewer.name}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Agent action availability.
// ---------------------------------------------------------------------------------------------------------------

export type AgentAction = "pause" | "resume" | "stop";

/** The Host's transition table (agent-types AGENT_NEXT) for each control, as states that may take it. */
export const AGENT_ACTION_STATES: Record<AgentAction, readonly AgentState[]> = {
  pause: ["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_DEPENDENCY", "VERIFYING", "WAITING_FOR_USER"],
  resume: ["PAUSED"],
  stop: ["CREATED", "PLANNING", "RUNNING", "WAITING_FOR_DEPENDENCY", "VERIFYING", "WAITING_FOR_USER", "PAUSED", "INTERRUPTED"],
};

export const AGENT_ACTION_LABEL: Record<AgentAction, string> = { pause: "Pause", resume: "Resume", stop: "Stop" };

export type ActionInput = {
  action: AgentAction;
  state: AgentState | null;
  viewer: SnapshotViewer | null | undefined;
  /** The Agent's own id, the target of the command (pending and uncertain state are per target). */
  targetId: string;
  canAct: boolean;
  pending: Record<string, string>;
  uncertain: { targetId: string | null }[];
};

/**
 * Whether an action is offered, and whether it can be pressed now. Hidden when the principal lacks the right or the
 * Agent's state does not take the action. Disabled with a caption while the Host has not confirmed, is unreachable, or
 * an earlier command on this Agent is unresolved. Success is never assumed: the caller waits for the Host's snapshot.
 */
export function agentActionAvailability(input: ActionInput): { visible: boolean; enabled: boolean; caption: string | null } {
  const rightHeld = holdsRight(input.viewer, AGENT_ACTION_RIGHT[input.action]);
  const stateAllows = input.state !== null && AGENT_ACTION_STATES[input.action].includes(input.state);
  const visible = rightHeld && stateAllows;
  if (!visible) return { visible: false, enabled: false, caption: null };
  const caption = controlCaption({
    canAct: input.canAct,
    targetId: input.targetId,
    pending: input.pending,
    uncertain: input.uncertain.map((row) => ({ targetId: row.targetId ?? "" })),
  });
  return { visible: true, enabled: caption === null, caption };
}

/**
 * The key the Host command path holds in-flight state under for an ask: the Agent whose Mission owns it (or whose
 * authorization lists it), else the Mission. Mirrors the store, so a pending or unconfirmed ask shows the same caption.
 */
export function requestTargetId(
  requestId: string,
  agents: readonly { id: string; missionId: string | null; authorization?: { pending: readonly { id: string }[] } | null }[],
  missions: readonly { id: string; requests: readonly { id: string }[] }[],
): string {
  const owner = agents.find(
    (agent) =>
      agent.authorization?.pending.some((item) => item.id === requestId) ||
      missions.find((mission) => mission.id === agent.missionId)?.requests.some((request) => request.id === requestId),
  );
  if (owner) return owner.id;
  return missions.find((mission) => mission.requests.some((request) => request.id === requestId))?.id ?? requestId;
}

/** Caption for an approval the device may not give: the Host's own reason when it gave one. */
export function approvalCaption(verdict: Verdict): string | null {
  return verdict.allowed ? null : verdict.caption;
}

// ---------------------------------------------------------------------------------------------------------------
// Progress: real step counts only.
// ---------------------------------------------------------------------------------------------------------------

export type StepCounts = { completed: number; total: number; verified: number };

const count = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Clamps the Host's counts so a segment bar and the sentence can never disagree. */
export function normalizeSteps(progress: StepCounts | null | undefined): { total: number; completed: number; verified: number } {
  const total = count(progress?.total ?? 0);
  const completed = Math.min(count(progress?.completed ?? 0), total);
  const verified = Math.min(count(progress?.verified ?? 0), completed);
  return { total, completed, verified };
}

/** "3 of 7 steps · 2 verified". No percentage, ever. */
export function stepProgressText(progress: StepCounts | null | undefined): string {
  const steps = normalizeSteps(progress);
  if (steps.total === 0) return "No steps yet";
  return `${steps.completed} of ${steps.total} ${steps.total === 1 ? "step" : "steps"} · ${steps.verified} verified`;
}

/** Segments for a step bar: verified, completed but not verified, and not yet completed. They always sum to total. */
export function stepSegments(progress: StepCounts | null | undefined): { verified: number; done: number; pending: number } {
  const steps = normalizeSteps(progress);
  return { verified: steps.verified, done: steps.completed - steps.verified, pending: steps.total - steps.completed };
}

// ---------------------------------------------------------------------------------------------------------------
// Agents list: the four Personal Agents and the other user-facing Agents (neutral rows, never weapons).
// ---------------------------------------------------------------------------------------------------------------

export const AGENT_STATE_TEXT: Record<AgentState, string> = {
  CREATED: "Ready to start",
  PLANNING: "Planning",
  RUNNING: "Working",
  WAITING_FOR_USER: "Needs you",
  WAITING_FOR_DEPENDENCY: "Waiting on a step",
  PAUSED: "Paused",
  VERIFYING: "Verifying",
  COMPLETED: "Completed",
  FAILED: "Failed",
  STOPPED: "Stopped",
  INTERRUPTED: "Recovering after restart",
};

export type OtherAgentRow = { id: string; name: string; stateLabel: string; updatedAt: number };

/** User-facing Agents outside every slot, newest first. Internal team members are never listed as Agents. */
export function otherAgentRows(snapshot: AgentSnapshot | null | undefined, slottedIds: ReadonlySet<string>, limit = 50): OtherAgentRow[] {
  if (!snapshot) return [];
  return snapshot.agents
    .filter((agent) => isUserFacingAgent(agent) && !slottedIds.has(agent.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((agent) => ({ id: agent.id, name: agent.name, stateLabel: AGENT_STATE_TEXT[agent.state], updatedAt: agent.updatedAt }));
}

/** The slots the phone draws. `drawn` lists bound and active characters; `attentionSlots` is every bound slot,
 *  because a consent ask waits on the Agent, not on the drawn character — the Host counts pending approvals for a
 *  turned-off slot too (the Notch does the same), and its Agent detail stays reachable from the row. */
export function boundSlots(slots: readonly PersonalAgentView[]): { drawn: PersonalAgentView[]; attentionSlots: PersonalAgentView[]; unassigned: number } {
  const bound = slots.filter((slot) => slot.agentId !== null);
  return {
    drawn: bound.filter((slot) => slot.active),
    attentionSlots: bound,
    unassigned: slots.filter((slot) => slot.agentId === null).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Missions and artifacts.
// ---------------------------------------------------------------------------------------------------------------

export type MissionRow = {
  id: string;
  title: string;
  label: string;
  live: boolean;
  progress: string;
  verifiedArtifacts: number;
  unverifiedArtifacts: number;
  openRequests: number;
  updatedAt: number;
};

/** Missions that need the user first, then live ones, then the rest; newest first within each group. */
export function missionRows(missions: readonly MissionView[]): MissionRow[] {
  const rank = (mission: MissionView) =>
    mission.state === "waiting_for_approval" || mission.state === "waiting_for_user" ? 0 : LIVE_MISSION.includes(mission.state) ? 1 : 2;
  return [...missions]
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
    .map((mission) => {
      const verifiedSteps = mission.steps.filter((step) => step.result?.verified === true).length;
      const verifiedArtifacts = mission.artifacts.filter((artifact) => artifact.verification === "verified").length;
      return {
        id: mission.id,
        title: mission.title,
        label: MISSION_LABEL[mission.state],
        live: LIVE_MISSION.includes(mission.state),
        progress: stepProgressText({ completed: mission.progress.completed, total: mission.progress.total, verified: verifiedSteps }),
        verifiedArtifacts,
        unverifiedArtifacts: mission.artifacts.length - verifiedArtifacts,
        openRequests: mission.requests.filter((request) => request.resolvedAt === null).length,
        updatedAt: mission.updatedAt,
      };
    });
}

/** Only artifacts the Host verified are listed as results. Unverified ones are counted, never shown as done. */
export function verifiedArtifactRows(mission: Pick<MissionView, "artifacts">): { id: string; title: string; type: string }[] {
  return mission.artifacts
    .filter((artifact) => artifact.verification === "verified")
    .map((artifact) => ({ id: artifact.id, title: artifact.title, type: artifact.type }));
}

// ---------------------------------------------------------------------------------------------------------------
// Chat: recent tasks the Host reported.
// ---------------------------------------------------------------------------------------------------------------

export type TaskRow = { id: string; title: string; stateLabel: string; createdAt: number };

export function taskStateLabel(state: OrchTask["state"]): string {
  const words = state.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Newest first, bounded. Titles are the user's own words; nothing is invented. */
export function recentTaskRows(tasks: readonly OrchTask[], limit = 8): TaskRow[] {
  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((task) => ({ id: task.id, title: task.title, stateLabel: taskStateLabel(task.state), createdAt: task.createdAt }));
}

/** Send is offered only with the chat right, a fresh view and a non-empty prompt that fits the Host's limit. */
export function canSend(input: { prompt: string; submitting: boolean; canAct: boolean; viewer: SnapshotViewer | null | undefined }): boolean {
  return phoneCapabilities(input.viewer).chat && input.canAct && !input.submitting && input.prompt.trim().length > 0 && input.prompt.length <= 16000;
}

// ---------------------------------------------------------------------------------------------------------------
// Agent detail facts.
// ---------------------------------------------------------------------------------------------------------------

export const pendingLabel = (count: number) => (count === 1 ? "1 approval waiting" : `${count} approvals waiting`);

/** The model line is technical detail: shown small, and never as the Agent's identity. */
export function technicalLine(technical: PersonalAgentView["technical"]): string | null {
  if (!technical) return null;
  const provider = technical.provider ?? "Unknown provider";
  return `${provider}${technical.model ? ` · ${technical.model}` : ""}`;
}
