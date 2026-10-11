/**
 * M-A-3 T10: spoken answers about agents, missions and approvals, built ONLY from canonical Host facts.
 *
 * Pure builders take typed facts; `hostFactsFrom` is the thin adapter over the AgentRuntime snapshot and the
 * MissionManager records. Nothing here reads provider prose. Verification is reported only from recorded step results
 * (`result.verified` true or false); a step with no recorded result is never called "pending" or "passed".
 */
import type { AgentSnapshot } from "../agent-types.ts";
import type { Mission, MissionStep } from "../../bunny-missions/types.ts";

export type CheckFact = { name: string; outcome: "passed" | "failed" };
export type StepFact = { title: string; status: string; model: string | null; checks: CheckFact[] };
export type MissionFact = { id: string; title: string; status: string; updatedAt: number; steps: StepFact[] };
export type AgentFact = { id: string; name: string; state: string; missionId: string | null; updatedAt: number };
export type ApprovalFact = { name: string; kind: "task" | "mission_request" };

export const TERMINAL_AGENT_STATES = ["COMPLETED", "FAILED", "STOPPED"] as const;

export function isTerminalAgent(state: string): boolean {
  return (TERMINAL_AGENT_STATES as readonly string[]).includes(state);
}

/** Model facts: null, "auto", provider defaults and "UNKNOWN" are all reported as unknown, never invented. */
export function spokenModel(model: string | null | undefined): string {
  if (!model) return "unknown";
  const trimmed = model.trim();
  if (!trimmed || /^(auto|default|unknown)$/i.test(trimmed)) return "unknown";
  return trimmed;
}

export function humanState(state: string): string {
  return state.toLowerCase().replace(/_/g, " ");
}

export function answerStatus(agents: AgentFact[], missions: MissionFact[]): string {
  const active = agents.filter((agent) => !isTerminalAgent(agent.state));
  if (active.length === 0) return "No agent is running right now.";
  if (active.length > 1) {
    const names = active.map((agent) => agent.name).join(", ");
    return `${active.length} agents are active: ${names}. Say the name of the one you mean.`;
  }
  const agent = active[0];
  const mission = missions.find((item) => item.id === agent.missionId);
  const running = mission?.steps.find((step) => step.status === "running" || step.status === "verifying");
  const parts = [`${agent.name} is ${humanState(agent.state)}.`];
  if (mission) parts.push(`Mission: ${mission.title}, ${humanState(mission.status)}.`);
  if (running) parts.push(`Current step: ${running.title}.`);
  return parts.join(" ");
}

export function answerVerification(mission: MissionFact | null): string {
  if (!mission) return "No agent mission is available to check.";
  const checks = mission.steps.flatMap((step) => step.checks);
  if (checks.length === 0) return "No verification results are recorded for that mission yet.";
  const passed = checks.filter((check) => check.outcome === "passed");
  const failed = checks.filter((check) => check.outcome === "failed");
  const sentences = [`${passed.length} verification ${passed.length === 1 ? "check" : "checks"} passed and ${failed.length} failed.`];
  if (failed.length > 0) sentences.push(`Failed: ${failed.map((check) => check.name).join(", ")}.`);
  if (passed.length > 0) sentences.push(`Passed: ${passed.map((check) => check.name).join(", ")}.`);
  return sentences.join(" ");
}

export function answerModel(mission: MissionFact | null): string {
  if (!mission) return "No agent is running, so no model is in use.";
  const running = mission.steps.find((step) => step.status === "running" || step.status === "verifying");
  const step = running ?? mission.steps.find((item) => item.model) ?? null;
  if (!step) return "No model is recorded for that mission yet.";
  return `The recorded model for ${step.title} is ${spokenModel(step.model)}.`;
}

export function answerApprovals(approvals: ApprovalFact[]): string {
  if (approvals.length === 0) return "Nothing is waiting for your approval right now.";
  const names = approvals.map((item) => item.name).join(", ");
  const noun = approvals.length === 1 ? "item is" : "items are";
  return `${approvals.length} ${noun} waiting for your approval on the Windows Host screen: ${names}. I can't approve anything by voice.`;
}

export function answerLastMission(mission: MissionFact | null): string {
  if (!mission) return "I don't have a finished mission to report.";
  const sentences = [`Your last mission was ${mission.title}, ${humanState(mission.status)}.`];
  const checks = mission.steps.flatMap((step) => step.checks);
  if (checks.length === 0) sentences.push("No verification results are recorded for it.");
  else {
    const failed = checks.filter((check) => check.outcome === "failed").length;
    sentences.push(`${checks.length - failed} of ${checks.length} recorded verification checks passed.`);
  }
  return sentences.join(" ");
}

/** Maps one recorded mission step to its spoken facts. Only `verified` true/false counts as a check. */
export function stepFact(step: Pick<MissionStep, "objective" | "state" | "result">, model: string | null): StepFact {
  const checks: CheckFact[] = [];
  if (step.result && typeof step.result.verified === "boolean") {
    checks.push({ name: step.objective.slice(0, 80), outcome: step.result.verified ? "passed" : "failed" });
  }
  return { title: step.objective.slice(0, 80), status: step.state, model, checks };
}

/** Adapter: canonical AgentRuntime rows and MissionManager records to voice facts. Read-only. */
export function hostFactsFrom(input: {
  agents: AgentSnapshot["agents"];
  mission: (id: string) => (Mission & { steps: MissionStep[] }) | null;
  approvals: () => ApprovalFact[];
  /** Recorded model of a task (null when unknown). */
  taskModel?: (taskId: string) => string | null;
}): { agents: AgentFact[]; missions: MissionFact[]; approvals: ApprovalFact[] } {
  const agents: AgentFact[] = input.agents.map((row) => ({ id: row.id, name: row.name, state: row.state, missionId: row.missionId, updatedAt: row.updatedAt }));
  const missions: MissionFact[] = [];
  for (const agent of agents) {
    if (!agent.missionId) continue;
    const mission = input.mission(agent.missionId);
    if (!mission) continue;
    missions.push({
      id: mission.id,
      title: mission.title,
      status: mission.state,
      updatedAt: mission.updatedAt,
      steps: mission.steps.map((step) => stepFact(step, step.taskId && input.taskModel ? input.taskModel(step.taskId) : null)),
    });
  }
  return { agents, missions, approvals: input.approvals() };
}

/**
 * M-A-3 T10 H7: everything the Host is waiting on the workstation to decide, from canonical records only: tasks waiting
 * for approval (no mission), unresolved mission permission requests (MissionManager records), and agents waiting for the
 * user's authorization. Names and counts come from the records; nothing is inferred.
 */
export function pendingApprovalFacts(input: {
  tasks: { state: string; provider: string; mission?: unknown }[];
  missions: { id?: string; title: string; requests: { resolvedAt?: number | null }[] }[];
  /** truth#2: an agent waits on the user when its runtime state says so OR its canonical consent offer does (the screen's rule). */
  agents: { name: string; state: string; missionId?: string | null; authorization?: { state: string } | null }[];
}): ApprovalFact[] {
  const facts: ApprovalFact[] = [];
  for (const task of input.tasks) if (task.state === "waiting_for_approval" && !task.mission) facts.push({ name: `${task.provider} task`, kind: "task" });
  // T10-SUP#3: one underlying ask is one item. An agent whose Mission already lists an unresolved request is that same ask.
  const missionsAsking = new Set<string>();
  for (const mission of input.missions)
    for (const request of mission.requests)
      if (!request.resolvedAt) {
        facts.push({ name: `${mission.title} permission`, kind: "mission_request" });
        if (mission.id) missionsAsking.add(mission.id);
      }
  // truth#2: the AgenticProjection state WAITING_FOR_USER is the canonical consent offer (agentic-store.server.ts). The agent
  // state alone can read RUNNING while consent is pending, which the Windows screen already reports as "Needs approval".
  for (const agent of input.agents) {
    const consentPending = agent.authorization?.state === "WAITING_FOR_USER";
    if (agent.missionId && missionsAsking.has(agent.missionId)) continue;
    if (agent.state === "WAITING_FOR_USER" || consentPending) facts.push({ name: `${agent.name} agent`, kind: "mission_request" });
  }
  return facts;
}
