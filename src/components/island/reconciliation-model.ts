/**
 * Visual Experience 2.0 Gate I: the owner's reconciliation review (pure). When the Host could not prove whether a write
 * finished, it pauses the work as "Outcome uncertain — reconciliation required" and replays nothing. This model gathers
 * what the owner needs to decide from canonical Host facts only. It never infers that an operation failed because a
 * provider disconnected, never offers an automatic replay, and offers decisions only to the workstation: a paired device
 * and any subordinate worker see the review, not the controls.
 */
import type { OrchTask, Reconciliation } from "../../lib/orch/types.ts";
import type { MissionStep, MissionView } from "../../lib/bunny-missions/types.ts";
import type { PersonalAgentsSnapshot } from "../../lib/bunny-host/personal-agents.ts";

export const RECONCILE_HEADLINE = "Outcome uncertain — reconciliation required";

export type ReconcileChoice = {
  resolution: "retry" | "close" | "stop";
  label: string;
  /** What happens, in plain words, before the owner decides. */
  consequence: string;
};

export type ReconcileItem = {
  key: string;
  kind: "task" | "mission";
  /** The Host command and its exact payload (without the resolution) that the owner's choice sends. */
  command: { action: "task.reconcile" | "mission.reconcile"; data: { id: string; stepId?: string } };
  title: string;
  owner: { slot: number; name: string; weapon: string } | null;
  project: string | null;
  mission: { id: string; title: string } | null;
  task: { id: string; title: string } | null;
  checkpoint: string;
  lastAttempt: string;
  reason: string;
  sideEffects: string[];
  evidence: string[];
  since: number;
  choices: ReconcileChoice[];
};


/** What the uncertain work could have changed, from the step's declared access and executor. Never a guess at the outcome. */
function sideEffectsOf(step: MissionStep | null, task: OrchTask | null): string[] {
  const out: string[] = [];
  if (step) {
    const executor = step.executor;
    if (executor.kind === "capability") out.push(`It ran ${executor.action}, which may have changed what it targets.`);
    else if (executor.kind === "skill") out.push(`It ran the ${executor.skillId} skill, which may have acted outside Bunny-A.`);
    else out.push("A model session was working; it may have edited files or used tools before the outcome was lost.");
    if (step.scope?.access === "write") out.push(`Declared write access in ${step.scope.root ?? "the Mission's project"}.`);
  } else if (task) {
    out.push(`A ${task.provider} session was working in ${task.cwd ?? "its project folder"}; it may have edited files or used tools.`);
    if (task.executionScope?.access === "write") out.push("It ran under a write-capable execution scope.");
  }
  out.push("Nothing is replayed automatically. Check the target yourself before choosing.");
  return out;
}

function ownerOf(missionId: string | null, slots: PersonalAgentsSnapshot | null) {
  if (!missionId || !slots) return null;
  const slot = slots.slots.find((row) => row.agent?.missionId === missionId);
  return slot ? { slot: slot.slot, name: slot.displayName, weapon: slot.weapon } : null;
}

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "not recorded");

export function reconcileItems(input: {
  tasks: OrchTask[];
  missions: MissionView[];
  personalAgents: PersonalAgentsSnapshot | null;
  projects: { id: string; name: string }[];
}): ReconcileItem[] {
  const projectName = (id: string | null | undefined) => (id ? (input.projects.find((row) => row.id === id)?.name ?? "Unknown project") : null);
  const items: ReconcileItem[] = [];
  for (const task of input.tasks) {
    // A Mission's own child task is reconciled through its Mission (the Host refuses it here), so it is listed there.
    if (!task.reconciliation?.required || task.mission) continue;
    items.push({
      key: `task:${task.id}`,
      kind: "task",
      command: { action: "task.reconcile", data: { id: task.id } },
      title: task.title,
      owner: null,
      project: projectName(task.projectId),
      mission: null,
      task: { id: task.id, title: task.title },
      checkpoint: task.startedAt ? `Started ${when(task.startedAt)}; no verified result after that.` : "No verified checkpoint was recorded.",
      lastAttempt: `${task.provider}${task.model ? ` · ${task.model}` : ""} · ${task.state}`,
      reason: reasonOf(task.reconciliation),
      sideEffects: sideEffectsOf(null, task),
      evidence: evidenceOfTask(task),
      since: task.reconciliation.at,
      choices: [
        { resolution: "retry", label: "Retry as a new task", consequence: "Starts a new linked task on the same provider. It waits for your fresh approval before it runs." },
        { resolution: "close", label: "Close without retrying", consequence: "Records your review and ends here. Nothing runs again." },
      ],
    });
  }
  for (const mission of input.missions) {
    for (const step of mission.steps) {
      if (!step.reconciliation?.required || step.state !== "failed") continue;
      const last = step.attempts.at(-1) ?? null;
      const verified = mission.steps.filter((row) => row.result?.verified).map((row) => row.role);
      const task = step.taskId ? (input.tasks.find((row) => row.id === step.taskId) ?? null) : null;
      items.push({
        key: `mission:${mission.id}:${step.id}`,
        kind: "mission",
        command: { action: "mission.reconcile", data: { id: mission.id, stepId: step.id } },
        title: `${mission.title}: ${step.role}`,
        owner: ownerOf(mission.id, input.personalAgents),
        project: projectName(mission.projectId),
        mission: { id: mission.id, title: mission.title },
        task: task ? { id: task.id, title: task.title } : step.taskId ? { id: step.taskId, title: step.role } : null,
        checkpoint: verified.length ? `Last verified step: ${verified.at(-1)}.` : "No step of this Mission has a verified result yet.",
        lastAttempt: last
          ? `Attempt ${last.attempt} · ${last.provider ?? (step.executor.kind === "capability" ? step.executor.action : step.executor.kind)} · ${last.outcome}`
          : "No attempt was recorded.",
        reason: reasonOf(step.reconciliation),
        sideEffects: sideEffectsOf(step, task),
        evidence: [
          ...(last?.detail ? [last.detail] : []),
          ...(step.result?.verification ?? []),
          ...(task ? evidenceOfTask(task) : []),
        ].slice(0, 6),
        since: step.reconciliation.at,
        choices: [
          { resolution: "retry", label: "Retry this step", consequence: "Runs the step again under the Mission's existing approval, only once no earlier process is alive." },
          { resolution: "stop", label: "Stop the Mission", consequence: "Records your review and stops the Mission. Completed work stays." },
        ],
      });
    }
  }
  return items.sort((a, b) => a.since - b.since);
}

function reasonOf(reconciliation: Reconciliation): string {
  // The Host's own words; only the taxonomy prefix is removed for reading.
  return reconciliation.reason.replace(/^[A-Z_]+:\s*/, "");
}

function evidenceOfTask(task: OrchTask): string[] {
  const out: string[] = [];
  if (task.dispatch === "may_have_started") out.push("The Host recorded that this work may have started.");
  if (task.error) out.push(task.error);
  if (task.latestEvent?.detail) out.push(`Last event: ${task.latestEvent.detail}`);
  if (task.stopCleanup) out.push(`Process cleanup: ${task.stopCleanup.status.replaceAll("_", " ")}.`);
  return out.slice(0, 4);
}

/**
 * Who may decide. Only a viewer the Host identified as the workstation gets controls; a paired device, an unknown kind
 * or a snapshot without a viewer yet (still loading) gets the review without them (M-A-3 T14: fail closed).
 */
export const mayReconcile = (viewer: { kind: string } | null | undefined) => viewer?.kind === "workstation";
