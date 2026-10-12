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
export type StepFact = { title: string; status: string; model: string | null; checks: CheckFact[]; /** M-A-3 T11: Host label of a team step (role and kind), its owner, and whether a rework replaced it. */ team?: { label: string; agentId: string | null; superseded: boolean; dormant: boolean } };
/** T12 F5: `origin` names who created the Mission ("voice:workstation" for a spoken draft); absent in older facts. */
export type MissionFact = { id: string; title: string; status: string; updatedAt: number; origin?: string; steps: StepFact[] };
export type AgentFact = { id: string; name: string; state: string; missionId: string | null; updatedAt: number; role?: string | null; task?: { kind: string; state: string } | null };
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

const ROLE_WORD: Record<string, string> = { coordinator: "Coordinator", planner: "Planner", researcher: "Researcher", implementer: "Implementer", documenter: "Documenter", reviewer: "Reviewer", tester: "Tester" };
const KIND_WORD: Record<string, string> = { plan: "planning", observe: "reading a project file", generate_json: "building the dataset", generate_markdown: "writing Markdown", generate_html: "building the page", review: "reviewing, advisory only", write_file: "saving a file", verify_output: "having Bunny check the requirements" };
/** Maps one recorded mission step to its spoken facts. Only `verified` true/false counts as a check. */
export function stepFact(step: Pick<MissionStep, "objective" | "state" | "result"> & Partial<Pick<MissionStep, "team">>, model: string | null): StepFact {
  const checks: CheckFact[] = [];
  // A team step is named by its Host label (role and kind), never by the planner's free-text objective.
  const title = step.team ? `${ROLE_WORD[step.team.role] ?? step.team.role} ${KIND_WORD[step.team.kind] ?? step.team.kind}${step.team.target ? ` ${step.team.target}` : ""}` : step.objective.slice(0, 80);
  if (step.result && typeof step.result.verified === "boolean") {
    checks.push({ name: title, outcome: step.result.verified ? "passed" : "failed" });
  }
  return { title, status: step.state, model, checks, ...(step.team ? { team: { label: title, agentId: step.team.agentId, superseded: !!step.team.supersededBy, dormant: !!step.team.dormant } } : {}) };
}

/** M-A-3 T11: answers about an Agent team, from Agent runtime rows and Mission step records only. */
export function answerTeam(question: string, agents: AgentFact[], missions: MissionFact[]): string {
  const team = agents.filter((agent) => agent.role && agent.role !== "coordinator");
  const working = (agent: AgentFact) => agent.state === "RUNNING" || agent.state === "VERIFYING";
  const doing = (agent: AgentFact) => (agent.task ? KIND_WORD[agent.task.kind] ?? agent.task.kind : "no task right now");
  const named = (agent: AgentFact) => (agent.role ? `the ${ROLE_WORD[agent.role] ?? agent.role} agent` : agent.name);
  if (question === "count") {
    const active = agents.filter((agent) => !isTerminalAgent(agent.state));
    // The Coordinator represents the team and owns no task of its own, so it is never counted as working.
    const busy = active.filter((agent) => working(agent) && agent.role !== "coordinator");
    if (!active.length) return "No agent is active right now.";
    if (!busy.length) return `${active.length} ${active.length === 1 ? "agent is" : "agents are"} active, but none is working at this moment.`;
    return `${busy.length} ${busy.length === 1 ? "agent is" : "agents are"} working: ${busy.map((agent) => `${named(agent)}, ${doing(agent)}`).join("; ")}.`;
  }
  if (question.startsWith("role:")) {
    const role = question.slice(5);
    const members = team.filter((agent) => agent.role === role && !isTerminalAgent(agent.state));
    if (!members.length) return `No ${ROLE_WORD[role] ?? role} agent is active right now.`;
    return members.map((agent) => `${named(agent)} is ${humanState(agent.state)}${agent.task ? `, ${doing(agent)}` : ""}.`).join(" ");
  }
  // T12 F5: when the newest Mission is a plain (non-team) one, its completion is answered from every canonical Mission.
  const newest = [...missions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  if (question === "finished" && newest && !newest.steps.some((step) => step.team)) return answerMissionFinished(missions);
  const teamMissions = missions.filter((mission) => mission.steps.some((step) => step.team));
  const mission = [...teamMissions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  if (!mission) return "No agent team mission is recorded.";
  const live = mission.steps.filter((step) => step.team && !step.team.dormant);
  if (question === "failed") {
    const failed = live.filter((step) => step.status === "failed");
    if (!failed.length) return `No task of ${mission.title} has failed.`;
    const reworked = failed.filter((step) => step.team?.superseded).length;
    return `${failed.length} ${failed.length === 1 ? "task" : "tasks"} failed: ${failed.map((step) => step.title).join("; ")}.${reworked ? ` Bunny started a bounded rework for ${reworked} of them.` : ""}`;
  }
  const counted = live.filter((step) => !step.team?.superseded);
  const done = counted.filter((step) => step.status === "completed").length;
  if (["completed", "failed", "stopped"].includes(mission.status)) return `The team mission ${mission.title} has ${mission.status === "completed" ? "finished and Bunny verified it" : humanState(mission.status)}. ${done} of ${counted.length} tasks completed.`;
  return `The team mission ${mission.title} has not finished. It is ${humanState(mission.status)}, with ${done} of ${counted.length} tasks completed.`;
}

/** Adapter: canonical AgentRuntime rows and MissionManager records to voice facts. Read-only. */
export function hostFactsFrom(input: {
  agents: AgentSnapshot["agents"];
  mission: (id: string) => (Mission & { steps: MissionStep[] }) | null;
  approvals: () => ApprovalFact[];
  /** Recorded model of a task (null when unknown). */
  taskModel?: (taskId: string) => string | null;
  /** T12 F5: every canonical Mission record, plain and team, so a Mission's completion is answerable without an Agent. */
  allMissions?: () => (Mission & { steps: MissionStep[] })[];
}): { agents: AgentFact[]; missions: MissionFact[]; approvals: ApprovalFact[] } {
  const agents: AgentFact[] = input.agents.map((row) => ({ id: row.id, name: row.name, state: row.state, missionId: row.missionId, updatedAt: row.updatedAt,
    ...(row.team ? { role: row.team.role, task: row.current ? { kind: row.current.kind, state: row.current.state } : null } : {}) }));
  const missions: MissionFact[] = [];
  const seen = new Set<string>();
  const add = (mission: Mission & { steps: MissionStep[] }) => {
    if (seen.has(mission.id)) return;
    seen.add(mission.id);
    missions.push({
      id: mission.id,
      title: mission.title,
      status: mission.state,
      updatedAt: mission.updatedAt,
      origin: mission.origin,
      steps: mission.steps.map((step) => stepFact(step, step.taskId && input.taskModel ? input.taskModel(step.taskId) : null)),
    });
  };
  for (const agent of agents) {
    if (!agent.missionId || seen.has(agent.missionId)) continue;
    const mission = input.mission(agent.missionId);
    if (mission) add(mission);
  }
  for (const mission of input.allMissions?.() ?? []) add(mission);
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
    // A pending consent offer is its own ask (a separate store from Mission requests) and always counts (R3-session#0).
    // An agent that only waits because its Mission has an unresolved request is that same ask, already listed above.
    const waitsOnMissionRequest = agent.state === "WAITING_FOR_USER" && !!agent.missionId && missionsAsking.has(agent.missionId);
    if (!consentPending && waitsOnMissionRequest) continue;
    if (agent.state === "WAITING_FOR_USER" || consentPending) facts.push({ name: `${agent.name} agent`, kind: "mission_request" });
  }
  return facts;
}

/** Mission states that mean the Mission is over (the Host's own terminal set, plus failed). */
export const MISSION_OVER = ["completed", "failed", "stopped"];

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The step the Mission is working on now, when the record shows one. Never inferred from progress. */
function currentStepTitle(mission: MissionFact | null): string | null {
  return mission?.steps.find((step) => step.status === "running" || step.status === "verifying")?.title ?? null;
}

/** T12 F5: "has the mission finished" for a plain or a team Mission, from every canonical Mission record. */
export function answerMissionFinished(missions: MissionFact[]): string {
  if (missions.length === 0) return "No mission is recorded.";
  const byRecent = [...missions].sort((a, b) => b.updatedAt - a.updatedAt);
  const mission = byRecent.find((item) => !MISSION_OVER.includes(item.status)) ?? byRecent[0];
  if (mission.status === "completed") {
    const checks = mission.steps.flatMap((step) => step.checks);
    const verified = checks.length === 0 ? "No verification results are recorded for it." : `${checks.length - checks.filter((check) => check.outcome === "failed").length} of ${checks.length} recorded verification checks passed.`;
    return `The mission ${mission.title} has finished. ${verified}`;
  }
  if (mission.status === "failed") return `The mission ${mission.title} has failed.`;
  if (mission.status === "stopped") return `The mission ${mission.title} was stopped.`;
  return `The mission ${mission.title} has not finished. It is ${humanState(mission.status)}.`;
}

/** The Mission a follow-up or a Host answer is about. An Agent subject carries its own Mission when it has one. */
export type FollowUpSubject = { kind: "agent"; agent: AgentFact; mission: MissionFact | null } | { kind: "mission"; mission: MissionFact };

/**
 * T12 F4: one resolved follow-up subject, answered from its canonical record only. Nothing is estimated: there is no
 * percentage, and an unrecorded value is said to be unrecorded.
 */
export function answerFollowUp(focus: string, subject: FollowUpSubject): string {
  const mission: MissionFact | null = subject.mission;
  const label = subject.kind === "agent" ? subject.agent.name : `the mission ${spokenTitle(subject.mission.title)}`;
  const state = subject.kind === "agent" ? subject.agent.state : subject.mission.status;
  const over = MISSION_OVER.includes(state.toLowerCase()) || isTerminalAgent(state);
  if (focus === "verification") return mission ? `For the mission ${spokenTitle(mission.title)}: ${answerVerification(mission)}` : answerVerification(null);
  if (focus === "finished") {
    const word = state.toLowerCase();
    if (word === "completed") return `Yes, ${label} has finished.`;
    if (word === "failed") return `No, ${label} failed.`;
    if (word === "stopped") return `No, ${label} was stopped.`;
    return `No, ${label} is still ${humanState(state)}.`;
  }
  if (focus === "running") return over ? `No, ${label} is ${humanState(state)}.` : `Yes, ${label} is still ${humanState(state)}.`;
  const step = currentStepTitle(mission);
  const sentences = [`${capitalized(label)} is ${humanState(state)}.`];
  if (subject.kind === "agent" && subject.agent.task && focus === "doing") sentences.push(`Current task: ${KIND_WORD[subject.agent.task.kind] ?? subject.agent.task.kind}.`);
  sentences.push(step ? `Current step: ${step}.` : "No current step is recorded.");
  if (focus === "progress") sentences.push("No progress percentage is recorded.");
  return sentences.join(" ");
}

/**
 * T12 live: a long Mission objective is read as its opening words only (up to the first comma, at most eight words), so a
 * spoken answer reaches the fact quickly. Short titles are unchanged.
 */
export function spokenTitle(title: string): string {
  const head = title.split(/[,;:(]/)[0].trim() || title.trim();
  const words = head.split(/\s+/).filter(Boolean);
  return words.length > 8 ? words.slice(0, 8).join(" ") : head;
}

/** T12 F6: names the Mission a verification or model answer describes, and says so when it is not the active one. */
export function missionLabel(mission: MissionFact): string {
  return `For the mission ${spokenTitle(mission.title)}${MISSION_OVER.includes(mission.status) ? " (not the active one)" : ""}: `;
}
