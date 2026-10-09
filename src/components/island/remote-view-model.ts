import type { SnapshotViewer } from "../../lib/bunny-host/contracts.ts";
import type { AgenticProjection } from "../../lib/bunny-missions/agentic-types.ts";
import type { MissionView, RemoteAnswer, RiskClass } from "../../lib/bunny-missions/types.ts";
import type { Uncertain } from "./connection-model.ts";

/**
 * M-A-3 T9 phone presentation decisions. Pure: every verdict here comes from the Host's own projection
 * (`viewer`, `remote`, `remoteOffer`); the phone never re-derives authorization policy.
 */
export const WORKSTATION_CAPTION = "Available on the Windows Host";
export const APPROVAL_ON_HOST = "Approval required on Windows Host.";
export const OUTCOME_UNKNOWN = "Outcome unknown — checking the Host…";
export const RECONNECT_CAPTION = "Reconnect to the Host to use controls.";
export const TALK_CAPTION =
  "Agent conversation and redirect are not supported by the Host yet. Use regular Bunny chat.";

export const isDevice = (viewer: SnapshotViewer | null | undefined) => viewer?.kind === "device";

export type PendingAsk = {
  id: string;
  action: string;
  risk: RiskClass;
  reason: string;
  resource?: string;
  remote?: RemoteAnswer;
  /** The Agentic revision the ask was offered at, when it belongs to an Agentic delegation. */
  revision: number | null;
};
/**
 * Every unanswered Host ask for one Agent: its Agentic pending items and its Mission's unresolved requests,
 * once each (the Agentic list wins: it carries the exact resource).
 */
export function pendingAsks(authorization: AgenticProjection | null | undefined, mission: MissionView | undefined): PendingAsk[] {
  const out = new Map<string, PendingAsk>();
  for (const item of authorization?.pending ?? [])
    out.set(item.id, { ...item, revision: authorization?.revision ?? null });
  for (const request of mission?.requests ?? [])
    if (!request.resolvedAt && !out.has(request.id))
      out.set(request.id, {
        id: request.id,
        action: request.action,
        risk: request.risk,
        reason: request.reason,
        remote: request.remote,
        revision: request.agentic?.revision ?? null,
      });
  return [...out.values()];
}

export type Verdict = { allowed: boolean; caption: string | null };
/** Allow once on one ask: the workstation always may; a device only where the Host said it may. */
export function allowVerdict(ask: Pick<PendingAsk, "remote">, viewer: SnapshotViewer | null | undefined): Verdict {
  if (!isDevice(viewer)) return { allowed: true, caption: null };
  if (ask.remote?.answerable) return { allowed: true, caption: null };
  return { allowed: false, caption: ask.remote?.reason ?? APPROVAL_ON_HOST };
}
/** Approving a pending Agentic consent offer (initial delegation or post-restart re-consent). */
export function offerVerdict(authorization: Pick<AgenticProjection, "state" | "remoteOffer">, viewer: SnapshotViewer | null | undefined): Verdict {
  if (authorization.state !== "WAITING_FOR_USER") return { allowed: false, caption: null };
  if (!isDevice(viewer)) return { allowed: true, caption: null };
  if (authorization.remoteOffer?.answerable) return { allowed: true, caption: null };
  return { allowed: false, caption: authorization.remoteOffer?.reason ?? APPROVAL_ON_HOST };
}
/** Approving a pending Mission plan. */
export function missionApproveVerdict(mission: Pick<MissionView, "state" | "remote">, viewer: SnapshotViewer | null | undefined): Verdict {
  if (mission.state !== "waiting_for_approval") return { allowed: false, caption: null };
  if (!isDevice(viewer)) return { allowed: true, caption: null };
  if (mission.remote?.answerable) return { allowed: true, caption: null };
  return { allowed: false, caption: mission.remote?.reason ?? APPROVAL_ON_HOST };
}

/**
 * Why a control for one target cannot act right now, or null when it can. Order matters: an unconfirmed
 * earlier command outranks everything, so a user never stacks a second action on an unknown outcome.
 */
export function controlCaption(input: {
  canAct: boolean;
  targetId: string;
  pending: Record<string, string>;
  uncertain: Pick<Uncertain, "targetId">[];
}): string | null {
  if (input.uncertain.some((row) => row.targetId === input.targetId)) return OUTCOME_UNKNOWN;
  if (input.pending[input.targetId]) return "Waiting for the Host…";
  if (!input.canAct) return RECONNECT_CAPTION;
  return null;
}

/** Agents needing a decision plus unanswered Mission asks (deduplicated), for the mobile header badge. */
export function attentionCount(
  agents: { state: string; authorization?: Pick<AgenticProjection, "state" | "pending"> | null; missionId: string | null }[],
  missions: Pick<MissionView, "id" | "requests">[],
): number {
  const attentionStates = ["WAITING_FOR_USER", "INTERRUPTED", "FAILED"];
  let count = agents.filter(
    (agent) =>
      attentionStates.includes(agent.state) ||
      agent.authorization?.state === "WAITING_FOR_USER" ||
      (agent.authorization?.pending.length ?? 0) > 0,
  ).length;
  const owned = new Set(agents.map((agent) => agent.missionId).filter(Boolean));
  for (const mission of missions)
    if (!owned.has(mission.id)) count += mission.requests.filter((request) => !request.resolvedAt).length;
  return count;
}
export const attentionLabel = (count: number) =>
  `${count} ${count === 1 ? "item needs" : "items need"} attention`;

/** Human summary of the paired-device role, from the Host's own rights list. */
export function rightsSummary(viewer: SnapshotViewer | null | undefined): string[] {
  if (!viewer || viewer.kind !== "device") return [];
  const rights = new Set(viewer.rights);
  const lines: string[] = [];
  if (rights.has("agent.get")) lines.push("Read Agents, Missions, Projects and verified artifacts");
  if (rights.has("agent.pause") && rights.has("agent.stop"))
    lines.push("Supervise: pause, resume, stop, deny and revoke");
  if (rights.has("mission.respond"))
    lines.push("Answer Host offers within limits (deletions, external actions and first starts stay on the Windows Host)");
  if (rights.has("submit")) lines.push("Chat: queue ordinary requests for review");
  if (rights.has("device.revoke")) lines.push("Sign out this device");
  return lines;
}
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "Unknown");

/**
 * Presentation hint for a direct (non-Mission) task on a paired device: the Host lets a device launch only
 * local tool-free inference (never a hosted `-cloud` tag). The Host still enforces this on approve; the hint
 * only avoids offering a button the Host will refuse.
 */
export function directApprovalVerdict(
  task: { provider: string; model?: string | null; mission?: unknown },
  viewer: SnapshotViewer | null | undefined,
): Verdict {
  if (!isDevice(viewer)) return { allowed: true, caption: null };
  if (task.mission) return { allowed: false, caption: "Mission work is approved through its Mission request." };
  if (task.provider === "ollama" && !/(:|-)cloud$/i.test(task.model ?? "")) return { allowed: true, caption: null };
  return { allowed: false, caption: `${APPROVAL_ON_HOST} This route can use workspace tools or a hosted model.` };
}
