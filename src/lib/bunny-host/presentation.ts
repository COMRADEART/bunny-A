import { VOICE_ACTIONS } from "./voice/voice-protocol.ts";
import type { HostEvent, HostSnapshot } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import type { CapabilityRun, MissionStep, MissionView } from "../bunny-missions/types.ts";
import type { ArtifactSummary } from "../bunny-missions/types.ts";
import type { OperationalHealth } from "./failure.server.ts";

export const artifactStatus = (artifact: Pick<ArtifactSummary, "verification">) =>
  artifact.verification === "verified"
    ? "Verified"
    : artifact.verification === "failed"
      ? "Verification failed"
      : "Produced";
export function hostHealthMessage(health: OperationalHealth | null | undefined): string | null {
  if (!health || health.operationalState === "healthy") return null;
  if (health.operationalState === "fatal")
    return "Host recovery required. New execution is refused.";
  if (health.operationalState === "draining")
    return "Host is shutting down. New execution is refused.";
  return health.unavailableSubsystems.includes("*")
    ? "Host degraded. New execution is unavailable until recovery."
    : `Host degraded. ${health.unavailableSubsystems.includes("browser") ? "Browser unavailable. " : ""}Dependent execution is unavailable; independent work may continue.`;
}

/** Read-only projections. These objects carry evidence references, never execution authority. */
export type ActivityState =
  | "Requested"
  | "Waiting for approval"
  | "Running"
  | "Succeeded"
  | "Failed"
  | "Stopped"
  | "Interrupted"
  | "Unknown effect"
  | "Completed"
  | "Verifying"
  | "Verified"
  | "Waiting for user"
  | "Denied";
export type PublicActivity = {
  id: string;
  at: number;
  sequence: number | null;
  source: "journal" | "capability" | "request";
  taskId: string | null;
  missionId: string | null;
  stepId: string | null;
  runId: string | null;
  title: string;
  state: ActivityState;
  detail: string;
};
export type TaskPresentation = {
  id: string;
  label: string;
  verification: string;
  activity: string;
  detail: string;
};
export type HostPresentation = {
  version: 1;
  revision: number;
  retainedFrom: number;
  activities: PublicActivity[];
  tasks?: TaskPresentation[];
};

const ACTIONS: Record<string, string> = {
  "filesystem.read": "Read file",
  "filesystem.list": "Listed files",
  "filesystem.exists": "Checked file",
  "filesystem.write": "Edited file",
  "filesystem.delete": "Deleted file",
  "terminal.exec": "Ran command",
  "git.status": "Checked Git status",
  "git.diff": "Read Git diff",
  "git.log": "Read Git history",
  "git.commit": "Git commit",
  "git.merge": "Git merge",
  "git.worktree_add": "Added Git worktree",
  "git.worktree_remove": "Removed Git worktree",
  "browser.navigate": "Opened browser page",
  "browser.search": "Searched the web",
  "browser.read": "Read page",
  "browser.extract": "Extracted page data",
  "browser.metadata": "Read page metadata",
  "browser.click": "Clicked browser control",
  "browser.type": "Entered browser text",
  "browser.wait": "Waited for page",
  "browser.screenshot": "Captured browser screenshot",
  "browser.download": "Downloaded file",
  "browser.tabs": "Listed browser tabs",
  "computer.list_windows": "Listed windows",
  "computer.read_controls": "Read window controls",
  "computer.focus_window": "Focused window",
  "computer.invoke_control": "Used window control",
  "computer.type": "Entered text",
  "computer.capture": "Captured screen",
  "computer.open_app": "Opened application",
  "github.pr_list": "Listed pull requests",
  "github.issue_list": "Listed issues",
  "github.repo_view": "Read repository",
  "github.pr_create": "Created pull request",
  "github.comment": "Posted comment",
  "notifications.send": "Sent notification",
};
export const capabilityTitle = (action: string) => ACTIONS[action] ?? "Capability action";

const LABELS: Record<string, string> = {
  "task.created": "Task submitted",
  "routing.started": "Routing",
  "task.routed": "Provider selected",
  "approval.required": "Approval required",
  "task.approved": "Task approved",
  "approval.accepted": "Task approved",
  "agent.starting": "Provider starting",
  "agent.started": "Provider turn running",
  "agent.reading": "Reading",
  "agent.editing": "Editing",
  "agent.command": "Running command",
  "agent.testing": "Running tests",
  "agent.searching": "Searching",
  "agent.building": "Building",
  "agent.rendering": "Rendering",
  "agent.planning": "Planning",
  "agent.thinking": "Working",
  "agent.reasoning": "Working",
  "agent.output": "Provider output available",
  "agent.completed": "Provider turn finished",
  "agent.failed": "Provider turn failed",
  "agent.verifying": "Bunny verifying",
  "verification.completed": "Verification result",
  "task.completed": "Task completed",
  "task.failed": "Task failed",
  "task.stopped": "Task stopped",
  "agent.stopped": "Stopped",
  "agent.waiting_for_input": "Waiting for user",
  "agent.waiting_for_approval": "Approval required",
  "task.retargeted": "Provider switched",
  "mission.approval_required": "Mission approval required",
  "mission.permission_required": "Capability approval required",
  "mission.step.completed": "Mission step completed",
  "mission.step.verifying": "Mission verification running",
  "mission.verifying": "Mission verification running",
  "mission.completed": "Mission completed",
  "mission.failed": "Mission failed",
  "mission.stopped": "Mission stopped",
  "mission.recovered": "Mission interrupted",
  "mission.recovery": "Mission interrupted",
  "mission.step.recovered": "Step recovered after restart",
  "capability.requested": "Capability requested",
  "capability.started": "Capability running",
  "capability.completed": "Capability succeeded",
  "capability.failed": "Capability failed",
  "authorization.required": "Waiting for approval",
  "authorization.denied": "Capability denied",
  "authorization.granted": "Capability authorized",
  "host.degraded": "Host degraded",
  "host.recovered": "Host restarted",
  "host.fatal": "Host recovery required",
  "host.draining": "Host stopping",
  "thermal.warning": "Temperature warning",
  // M-A-3 T11 team Missions.
  "mission.team.plan_proposed": "Team plan proposed",
  "mission.team.plan_rejected": "Team plan rejected by Bunny",
  "mission.team.handoff": "Verified handoff between Agents",
  "mission.team.handoff_refused": "Handoff refused",
  "mission.team.rework": "Bounded rework started",
  "mission.team.agent_stopped": "Team member stopped",
  "mission.team.seeded": "Test fault injected (recorded)",
  // M-A-3 T13 Personal Agent slots (presentation only).
  "personal_agents.configured": "Personal Agents updated",
  // M-A-3 T13.1 AI & Models settings and advisory routing provenance.
  "routing.assisted": "Decision assistance reviewed",
  "routing.consent_denied": "Provider switch requires approval",
  "connections.changed": "AI account updated",
  "connections.configured": "Routing privacy updated",
  "connections.checked": "AI account checked",
  "connections.retention": "Usage history rolled up",
  "connections.review_requested": "AI account review requested",
  "intelligence.configured": "AI & Models settings updated",
  "intelligence.credential_saved": "API key saved",
  "intelligence.credential_removed": "API key removed",
  "intelligence.tested": "Connection tested",
  "intelligence.laya_configured": "Laya preference updated",
  "intelligence.laya_benchmarked": "Laya benchmarked",
};
export const publicEventLabel = (type: string) => LABELS[type] ?? "Activity recorded";
/**
 * M-A-3 T4: agent LIFECYCLE rows (taskId=null + a kind:"agent-lifecycle" detail marker) never project
 * into the journal feed — the agent panel carries them. Provider ACTIVITY rows with the same agent.*
 * type names always carry a task stream id, so the two stay distinct here.
 */
export function isAgentLifecycle(event: {
  type: string;
  taskId: string | null;
  detail: string;
}): boolean {
  if (event.taskId !== null || !event.type.startsWith("agent.")) return false;
  try {
    return (JSON.parse(event.detail) as { kind?: string }).kind === "agent-lifecycle";
  } catch {
    return true;
  }
}
export function taskInterrupted(task: Pick<OrchTask, "state" | "stopReason" | "error">) {
  return (
    ["failed", "stopped"].includes(task.state) &&
    /host.*(?:restart|fatal|failure)|interrupt|not resumed|cannot be reattached/i.test(
      `${task.stopReason ?? ""} ${task.error ?? ""}`,
    )
  );
}
/** M-A-3 T13.3 N-C: the honest state of write work that may have taken effect before it failed. */
export const UNCERTAIN_LABEL = "Outcome uncertain — reconciliation required";

export function taskStatus(task: OrchTask): { label: string; verification: string } {
  const labels: Record<OrchTask["state"], string> = {
    queued: "Queued",
    routing: "Routing",
    waiting_for_approval: "Approval required",
    launching: "Provider starting",
    running:
      task.latestEvent?.type === "agent.completed"
        ? "Provider turn finished"
        : "Provider turn running",
    waiting_for_input: "Waiting for user",
    waiting_for_agent_approval: "Approval required",
    verifying: "Bunny verifying",
    paused: "Paused",
    completed: "Task completed",
    failed: "Task failed",
    stopped: "Task stopped",
  };
  return {
    label: task.reconciliation?.required ? UNCERTAIN_LABEL : taskInterrupted(task) ? "Interrupted · retry available"
      // MA4-S1R: the Host runtime watchdog stops with this exact reason; say so instead of a generic Stop.
      : task.state === "stopped" && /^Runtime limit reached\b/.test(task.stopReason ?? "") ? "Stopped · runtime limit reached" : labels[task.state],
    verification: task.verification
      ? task.verification.passed
        ? "Verified by Bunny"
        : "Verification failed"
      : task.state === "verifying"
        ? "Independent verification running"
        : "Not independently verified",
  };
}
export function publicEventDetail(type: string, _detail = "", task?: OrchTask): string {
  if (/thinking|reasoning/i.test(type)) return "Provider is working.";
  if (type === "agent.completed")
    return "The provider finished its turn. Task completion and verification are separate Host decisions.";
  if (type === "verification.completed")
    return task?.verification
      ? taskStatus(task).verification
      : "An independent check finished; consult the canonical result.";
  if (type === "task.completed")
    return task?.verification?.passed
      ? "Task completed. Verified by Bunny."
      : "Task completed. Independent verification was not established.";
  if (
    ["task.failed", "task.stopped", "agent.failed", "agent.stopped"].includes(type) &&
    task &&
    taskInterrupted(task)
  )
    return "Interrupted by Host failure or restart. The old session was not resumed; retry starts fresh work.";
  // Only these exact, non-sensitive legacy messages may survive. No regex-based free-text forwarding.
  if (
    type === "approval.required" &&
    ["Provider is ready.", "Stays on this machine. Provider is ready."].includes(_detail)
  )
    return task?.provider === "ollama" && /:cloud$/i.test(task.model)
      ? "Provider is ready."
      : _detail;
  if (type === "agent.command" && _detail === "npm test") return "npm test";
  return publicEventLabel(type) + ". Details omitted from public activity.";
}

function eventState(event: HostEvent, task?: OrchTask): ActivityState {
  if (task && taskInterrupted(task) && ["task.failed", "task.stopped"].includes(event.type))
    return "Interrupted";
  if (event.type === "verification.completed")
    return task?.verification
      ? task.verification.passed
        ? "Verified"
        : "Failed"
      : "Unknown effect";
  if (/verifying$/.test(event.type)) return "Verifying";
  if (/required$|waiting_for_approval/.test(event.type)) return "Waiting for approval";
  if (["task.approved", "approval.accepted"].includes(event.type)) return "Completed";
  if (event.type === "task.created") return "Requested";
  if (/waiting_for_input/.test(event.type)) return "Waiting for user";
  if (/stopped$/.test(event.type)) return "Stopped";
  if (/failed$|degraded$|fatal$/.test(event.type)) return "Failed";
  if (/completed$/.test(event.type)) return "Completed";
  if (/denied$/.test(event.type)) return "Denied";
  return "Running";
}
export function projectEvents(events: HostEvent[], tasks: OrchTask[]): PublicActivity[] {
  const unique = new Map<number, HostEvent>();
  for (const event of events)
    if (Number.isSafeInteger(event.sequence) && !unique.has(event.sequence))
      unique.set(event.sequence, event);
  return [...unique.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .filter(
      (event) =>
        LABELS[event.type] &&
        !event.type.startsWith("capability.") &&
        !event.type.startsWith("authorization.") &&
        event.type !== "agent.output" &&
        !/thinking|reasoning/i.test(event.type) &&
        // M-A-3 T4 additive: agent LIFECYCLE rows are projected into the agent panel, not the journal;
        // provider ACTIVITY rows with the same agent.* type names always carry a task stream id.
        !isAgentLifecycle(event),
    )
    .map((event) => {
      const task = tasks.find((item) => item.id === event.taskId);
      return {
        id: `journal:${event.sequence}`,
        at: event.at,
        sequence: event.sequence,
        source: "journal",
        taskId: event.taskId,
        missionId: event.missionId ?? task?.mission?.missionId ?? null,
        stepId: task?.mission?.stepId ?? null,
        runId: null,
        title: publicEventLabel(event.type),
        state: eventState(event, task),
        detail: publicEventDetail(event.type, event.detail, task),
      };
    });
}
export function capabilityState(run: CapabilityRun): ActivityState {
  if (run.status === "running") return "Running";
  if (run.status === "succeeded") return "Succeeded";
  if (run.status === "stopped") return "Stopped";
  if (run.status === "interrupted") return "Interrupted";
  if (run.status === "denied") return "Denied";
  // A failed cleanup does not prove that an external side effect was rolled back.
  if (run.cleanup?.attempted && !run.cleanup.ok) return "Unknown effect";
  return "Failed";
}
const operationId = (mission: MissionView, step: MissionStep) =>
  `step-operation:${mission.id}:${step.id}:${Math.max(1, step.attempts.length)}`;
export function projectCapabilities(
  runs: CapabilityRun[],
  missions: MissionView[],
): PublicActivity[] {
  const rows: PublicActivity[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    const mission = missions.find((item) => item.id === run.missionId);
    const step = mission?.steps.find(
      (item) =>
        item.id === run.stepId &&
        item.capabilityRunId === run.id &&
        item.executor.kind === "capability",
    );
    rows.push({
      id: mission && step ? operationId(mission, step) : `capability:${run.id}`,
      at: run.finishedAt ?? run.startedAt,
      sequence: null,
      source: "capability",
      taskId: null,
      missionId: run.missionId,
      stepId: run.stepId,
      runId: run.id,
      title: capabilityTitle(run.action),
      state: capabilityState(run),
      detail:
        run.status === "interrupted"
          ? "Interrupted. Effect requires review; execution was not resumed."
          : run.status === "timeout"
            ? "Time limit reached. Consult the Host cleanup result."
            : "Capability result is separate from task and artifact verification.",
    });
  }
  for (const mission of missions)
    for (const step of mission.steps) {
      if (
        step.executor.kind !== "capability" ||
        (step.capabilityRunId && seen.has(step.capabilityRunId))
      )
        continue;
      if (!["pending", "ready", "waiting_for_approval", "failed", "stopped"].includes(step.state))
        continue;
      const request = mission.requests.find((r) => r.id === step.pendingRequestId);
      rows.push({
        id: operationId(mission, step),
        at: request?.resolvedAt ?? request?.createdAt ?? mission.updatedAt,
        sequence: null,
        source: "request",
        taskId: null,
        missionId: mission.id,
        stepId: step.id,
        runId: null,
        title: capabilityTitle(step.executor.action),
        state:
          step.state === "stopped"
            ? "Stopped"
            : step.state === "failed"
              ? request?.resolution === "deny"
                ? "Denied"
                : "Failed"
              : step.state === "waiting_for_approval"
                ? "Waiting for approval"
                : "Requested",
        detail: "Execution has not started. Authorization is decided by the Host.",
      });
    }
  return rows;
}
export function projectHostActivity(
  snapshot: HostSnapshot,
  runs: CapabilityRun[],
  retainedFrom: number,
  revision: number,
): HostPresentation {
  return {
    version: 1,
    revision,
    retainedFrom,
    tasks: snapshot.tasks.map((task) => {
      const terminal = ["completed", "failed", "stopped"].includes(task.state);
      return {
        id: task.id,
        ...taskStatus(task),
        activity: terminal
          ? taskStatus(task).label
          : task.state === "verifying"
            ? "Bunny verifying"
            : task.latestEvent
              ? publicEventLabel(task.latestEvent.type)
              : taskStatus(task).label,
        detail: publicEventDetail(
          terminal ? `task.${task.state}` : (task.latestEvent?.type ?? `task.${task.state}`),
          "",
          task,
        ),
      };
    }),
    activities: [
      ...projectEvents(snapshot.events, snapshot.tasks),
      ...projectCapabilities(runs, snapshot.missions?.missions ?? []),
    ].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)),
  };
}

/** Gateway export: activity fields contain summaries before crossing into the browser. The private journal stays intact. */
/** Shared public task projection for dashboard and paired-device Project reads. */
export function publicTask(task: OrchTask): OrchTask {
  return {

      ...task,
      // The Host stores an untyped provider transcript here, not a reviewed public result.
      output: "",
      verify: task.verify ? { ...task.verify, expected: "[Content retained on Host]" } : null,
      error: task.error
        ? taskInterrupted(task)
          ? "Interrupted by Host failure or restart. Retry starts a fresh attempt."
          : "Task failed. Diagnostic details are retained on the Host."
        : null,
      stopReason: task.stopReason
        ? taskInterrupted(task)
          ? "Host interruption; execution was not resumed."
          : "Stopped by the Host."
        : null,
      verification: task.verification
        ? {
            ...task.verification,
            detail: task.verification.passed
              ? "Independent verification passed."
              : "Independent verification failed.",
          }
        : null,
      latestEvent: task.latestEvent
        ? {
            ...task.latestEvent,
            label: publicEventLabel(task.latestEvent.type),
            detail: publicEventDetail(task.latestEvent.type, task.latestEvent.detail, task),
          }
        : null,
      logs: task.logs.map((log) => ({
        at: log.at,
        line: "Host activity recorded. Details omitted from public activity.",
      })),
      progress:
        task.progress?.kind === "determinate"
          ? { ...task.progress, current: null, source: "Provider plan" }
          : task.progress,
      processTree: null,
  };
}

export function dashboardSnapshot(snapshot: HostSnapshot): HostSnapshot {
  return {
    ...snapshot,
    health: snapshot.health
      ? {
          ...snapshot.health,
          reason: hostHealthMessage(snapshot.health),
          lastFatal: snapshot.health.lastFatal
            ? {
                ...snapshot.health.lastFatal,
                reason: "Previous Host failure. Old execution was not resumed.",
              }
            : null,
        }
      : undefined,
    events: snapshot.events.map((event) => ({
      ...event,
      // M-A-3 T4: lifecycle rows keep their raw JSON out of the browser; the agent panel carries them.
      detail: isAgentLifecycle(event)
        ? "Agent lifecycle event; see the agents panel."
        : publicEventDetail(
            event.type,
            event.detail,
            snapshot.tasks.find((task) => task.id === event.taskId),
          ),
    })),
    tasks: snapshot.tasks.map(publicTask),
    missions: snapshot.missions
      ? {
          ...snapshot.missions,
          missions: snapshot.missions.missions.map((mission) => ({
            ...mission,
            planning: { ...mission.planning, rationale: [] },
            requestedScope: mission.requestedScope
              ? {
                  ...mission.requestedScope,
                  terminal: {
                    ...mission.requestedScope.terminal,
                    commands: mission.requestedScope.terminal.commands.map(
                      () => "Scoped command (arguments retained on Host)",
                    ),
                    executables: [],
                  },
                }
              : null,
            failure: mission.failure
              ? { ...mission.failure, detail: "Mission failed. Review the failed step or retry." }
              : null,
            recovery: mission.recovery
              ? {
                  ...mission.recovery,
                  detail:
                    "Interrupted by Host failure or restart. Old work was not resumed; retry starts a fresh attempt.",
                }
              : null,
            result: mission.result
              ? {
                  ...mission.result,
                  summary: `${mission.result.verifiedSteps} verified steps · ${mission.result.unverifiedSteps} steps without independent verification`,
                }
              : null,
            ...(mission.team ? { team: publicTeam(mission.team) } : {}),
            ...(mission.teamView ? { teamView: publicTeamView(mission.teamView) } : {}),
            steps: mission.steps.map((step) => ({
              ...step,
              ...(step.team ? { team: publicStepTeam(step.team) } : {}),
              evidence: [],
              verification: [],
              attempts: step.attempts.map((attempt) => ({
                ...attempt,
                detail: "Attempt recorded by the Host.",
              })),
              executor:
                step.executor.kind === "model"
                  ? { kind: "model" as const }
                  : { ...step.executor, params: {} },
              failure: step.failure
                ? { ...step.failure, detail: "Step failed. Details retained on the Host." }
                : null,
              result: step.result
                ? {
                    ...step.result,
                    summary: step.result.verified ? "Verified by Bunny" : "Step completed",
                    verification: step.result.verification.length
                      ? [
                          step.result.verified
                            ? "Independent verification passed"
                            : "Verification did not establish success",
                        ]
                      : [],
                  }
                : null,
            })),
            requests: mission.requests.map((request) => ({
              ...request,
              reason: `Authorize ${capabilityTitle(request.action)} in this mission's approved workspace. ${request.risk === "EXTERNAL_SIDE_EFFECT" ? "This action affects an external service." : request.risk === "DESTRUCTIVE" ? "This action may remove or replace data." : "The Host enforces the existing scope."}`,
            })),
          })),
          inbox: snapshot.missions.inbox.map((item) => ({
            ...item,
            title:
              item.kind === "requires_approval"
                ? "Approval required"
                : item.kind === "failure"
                  ? "Operation failed"
                  : item.kind === "completed"
                    ? "Operation completed"
                    : "Host notification",
            detail: "Open the associated mission or task for its current canonical state.",
          })),
          capabilities: snapshot.missions.capabilities.map((capability) => ({
            ...capability,
            detail:
              capability.availability === "available"
                ? "Runtime available"
                : "Runtime " + capability.availability,
          })),
        }
      : undefined,
  };
}

/**
 * M-A-3 T11: team facts that cross into the browser. Identities, roles, kinds, dependencies, file names and Host
 * verdicts stay; project file listings, repair evidence and handed-off content stay on the Host.
 */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
export function publicTeam(team: NonNullable<MissionView["team"]>): NonNullable<MissionView["team"]> {
  return { ...team, offerFiles: [], rejected: team.rejected.slice(-5).map((entry) => ({ at: entry.at, reasons: entry.reasons.slice(0, 15).map((reason) => clip(reason, 240)) })) };
}
export function publicStepTeam(team: NonNullable<MissionStep["team"]>): NonNullable<MissionStep["team"]> {
  const { repair, reviewerFindings, ...rest } = team;
  return { ...rest, ...(repair ? { repair: "Rework of a delivery that failed Bunny's check; see the requirement results." } : {}), ...(reviewerFindings ? { reviewerFindings: "Advisory Reviewer findings were handed to this rework step." } : {}) };
}
export function publicTeamView(view: NonNullable<MissionView["teamView"]>): NonNullable<MissionView["teamView"]> {
  return {
    ...view,
    rejected: view.rejected.map((entry) => ({ at: entry.at, reasons: entry.reasons.slice(0, 15).map((reason) => clip(reason, 240)) })),
    handoffs: view.handoffs.map((handoff) => ({ ...handoff, reason: handoff.reason ? clip(handoff.reason, 200) : null })),
    findings: view.findings.map((review) => ({ ...review, findings: review.findings.slice(0, 12).map((finding) => ({ ...finding, summary: clip(finding.summary, 300) })) })),
    requirementResults: view.requirementResults.map((result) => ({ ...result, detail: result.detail ? clip(result.detail, 240) : null })),
  };
}

/**
 * MA4-S2-T2: Approval Center reads whose answer the dashboard shows (the waiting action's preview, receipts, registered
 * folders, a Planner proposal, a step's output). The Host answers them for the workstation owner only.
 */
const DASHBOARD_DATA_ACTIONS = ["action.inspect", "action.receipts", "connector.roots.list", "ptask.plan", "ptask.output"];
/** Only the fields used by the dashboard cross its command boundary. Private session/capability data stays local. */
export function dashboardCommand<
  T extends { snapshot?: HostSnapshot; task?: OrchTask; mission?: MissionView; pairCode?: string ;
    data?: unknown;
    operation?: { id: string; state: "applied" | "refused" | "failed" | "in_progress"; replayed: boolean };
  },
>(result: T, projectAction?: string) {
  // M-A-3 T10: voice responses carry only {data: VoiceSnapshot} and no dashboard snapshot.
  const snapshot = result.snapshot ? dashboardSnapshot(result.snapshot) : undefined;
  const voiceData = VOICE_ACTIONS.has(projectAction ?? "") && result.data !== undefined;
  return {
    ...(snapshot ? { snapshot } : {}),
    ...(voiceData || (result.data !== undefined && ["project.list", "project.get", "project.add", "project.create", "project.update", "project.relink", "project.remove", "project.artifact", "project.repository", "project.agent.create", "operation.status", ...DASHBOARD_DATA_ACTIONS].includes(projectAction ?? "")) ? { data: result.data as import("../bunny-missions/types.ts").JsonValue } : {}),
    ...(result.operation ? { operation: result.operation } : {}),
    pairCode: result.pairCode,
    task: result.task && snapshot ? snapshot.tasks.find((task) => task.id === result.task!.id) : undefined,
    mission: result.mission && snapshot
      ? snapshot.missions?.missions.find((mission) => mission.id === result.mission!.id)
      : undefined,
  };
}
