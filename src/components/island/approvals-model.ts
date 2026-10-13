/**
 * M-A-3 T13 Approvals union, client side. Mirrors `pendingApprovalFacts` (voice/voice-answers.server.ts): one underlying
 * ask is one item, and the same canonical records decide it. Nothing is decided here. Each item only says where the
 * existing approve, deny or respond control lives, and whether this device may answer it (the Host's remote verdict).
 */
import type { AgentSnapshot } from "../../lib/bunny-host/agent-types.ts";
import type { MissionView, PermissionRequest } from "../../lib/bunny-missions/types.ts";
import type { OrchTask } from "../../lib/orch/types.ts";

export type ApprovalKind = "task" | "mission_request" | "agent_consent";

/** Whether the viewer may answer this ask from here. Devices follow the Host's per-request verdict. */
export type ApprovalAnswer =
  | { kind: "answerable" }
  | { kind: "not-answerable"; reason: string };

export type ApprovalItem = {
  /** Stable key: the task id, the request id, or the agent id for a consent offer. */
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  /** Where the existing answer control lives (the Task decision view, or the Mission/Agent panel). */
  target: { sheet: "decision"; taskId: string } | { sheet: "missions"; missionId: string | null; agentId: string | null };
  answer: ApprovalAnswer;
  /** Host time the ask was raised, or null when the record does not carry one. */
  at: number | null;
};

export type ApprovalInput = {
  tasks: (Pick<OrchTask, "id" | "state" | "provider" | "title" | "createdAt"> & { mission?: unknown })[];
  missions: Pick<MissionView, "id" | "title" | "requests">[];
  agents: Pick<AgentSnapshot["agents"][number], "id" | "name" | "state" | "missionId" | "authorization">[];
  viewer: "workstation" | "device";
};

const PROVIDER_NAME: Record<string, string> = { codex: "Codex", claude: "Claude", ollama: "Ollama", opencode: "OpenCode", cline: "Cline", cursor: "Cursor" };
const providerName = (id: string) => PROVIDER_NAME[id] ?? id;

/** A device answers only an ask the Host marks answerable; the workstation answers every ask it owns. */
export function approvalAnswer(request: Pick<PermissionRequest, "remote" | "desktopRequired">, viewer: "workstation" | "device"): ApprovalAnswer {
  if (viewer === "workstation") return { kind: "answerable" };
  if (request.remote?.answerable) return { kind: "answerable" };
  return { kind: "not-answerable", reason: request.remote?.reason || "Answer this one on your workstation." };
}

/**
 * Every pending ask the Host is waiting on, in one list: tasks waiting for approval outside a Mission, unresolved Mission
 * permission requests, and Agents waiting on the user's consent. An Agent whose Mission already lists the same ask is
 * not counted twice. Newest first, then by id, so the order is stable between reads.
 */
export function pendingApprovalItems(input: ApprovalInput): ApprovalItem[] {
  const items: ApprovalItem[] = [];
  for (const task of input.tasks) {
    if (task.state !== "waiting_for_approval" || task.mission) continue;
    items.push({
      id: task.id,
      kind: "task",
      title: `${providerName(task.provider)} task needs approval`,
      detail: task.title,
      target: { sheet: "decision", taskId: task.id },
      // A device's real gate is the Task's own decision view (local models only), so the list does not claim it here.
      answer:
        input.viewer === "workstation"
          ? { kind: "answerable" }
          : { kind: "not-answerable", reason: "Open the task to see whether this device may answer it." },
      at: task.createdAt ?? null,
    });
  }
  const missionsAsking = new Set<string>();
  for (const mission of input.missions) {
    for (const request of mission.requests) {
      if (request.resolvedAt) continue;
      missionsAsking.add(mission.id);
      items.push({
        id: request.id,
        kind: "mission_request",
        title: `${mission.title}: permission requested`,
        detail: request.reason,
        target: { sheet: "missions", missionId: mission.id, agentId: null },
        answer: approvalAnswer(request, input.viewer),
        at: request.createdAt ?? null,
      });
    }
  }
  for (const agent of input.agents) {
    const consentPending = agent.authorization?.state === "WAITING_FOR_USER";
    // A waiting Agent whose Mission already lists the unresolved request is that same ask, already listed above.
    const waitsOnMissionRequest = agent.state === "WAITING_FOR_USER" && !!agent.missionId && missionsAsking.has(agent.missionId);
    if (!consentPending && waitsOnMissionRequest) continue;
    if (agent.state !== "WAITING_FOR_USER" && !consentPending) continue;
    items.push({
      id: `consent:${agent.id}`,
      // An Agent ask is answered in its Agent panel, never by the Mission respond command: its id is not a request id.
      kind: "agent_consent",
      title: `${agent.name} is waiting for your consent`,
      detail: "Its authorization is in the Agent panel.",
      target: { sheet: "missions", missionId: agent.missionId, agentId: agent.id },
      answer: input.viewer === "workstation" ? { kind: "answerable" } : { kind: "not-answerable", reason: "Answer this on your workstation." },
      at: null,
    });
  }
  return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.id.localeCompare(b.id));
}

/** The count the nav badge and the Home summary show: every item, answerable here or not. */
export const approvalCount = (items: readonly ApprovalItem[]) => items.length;

/** Items this viewer may answer right now. The rest are shown with their reason, never with a control. */
export const answerableHere = (items: readonly ApprovalItem[]) => items.filter((item) => item.answer.kind === "answerable");
