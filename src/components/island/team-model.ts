import type { AgentSnapshot } from "../../lib/bunny-host/agent-types.ts";
import type { MissionStep, MissionView } from "../../lib/bunny-missions/types.ts";
import { AGENT_NON_TERMINAL, AGENT_STATE_LABEL } from "./agent-model.ts";

/**
 * M-A-3 T11 — island projection of a Team Mission. Every fact shown is a canonical Host fact: identities and states
 * from the Agent runtime, steps/handoffs/verdicts from the Mission. The model's plan text appears only as the
 * reviewed task objectives; Reviewer findings are labelled advisory and never shown as a verdict.
 */
type AgentRow = AgentSnapshot["agents"][number];

export const ROLE_LABEL: Record<string, string> = {
  coordinator: "Coordinator", planner: "Planner", researcher: "Researcher", implementer: "Implementer",
  documenter: "Documenter", reviewer: "Reviewer", tester: "Tester",
};
export const KIND_LABEL: Record<string, string> = {
  plan: "Planning", observe: "Reading project file", generate_json: "Building dataset", generate_markdown: "Writing Markdown",
  generate_html: "Building page", review: "Reviewing (advisory)", write_file: "Saving file", verify_output: "Bunny checking requirements",
};
const STEP_STATE: Record<string, string> = {
  pending: "Waiting", ready: "Ready", running: "Running", waiting_for_approval: "Needs approval", verifying: "Bunny verifying",
  completed: "Done", failed: "Failed", stopped: "Stopped", skipped: "Not needed", blocked: "Blocked",
};

export type TeamMemberRow = {
  id: string; name: string; role: string; roleLabel: string; state: AgentRow["state"]; stateLabel: string;
  task: string | null; taskState: string | null; model: string | null; owned: { total: number; completed: number; verified: number; failed: number } | null;
  paused: boolean; controllable: boolean;
};
export type TeamGraphNode = { id: string; key: string; role: string; kind: string; label: string; objective: string; state: string; stateLabel: string; dependsOn: string[]; round: number; rework: boolean; verified: boolean };
export type TeamPanel = {
  missionId: string; coordinatorId: string; name: string; missionState: string; phase: string; members: TeamMemberRow[];
  graph: TeamGraphNode[]; reserved: number; handoffs: { id: string; from: string; to: string; type: string; sha: string; purpose: string; state: string }[];
  requirements: { id: string; text: string; state: "passed" | "failed" | "pending"; detail: string | null; round: number | null }[];
  findings: { reviewer: string; verdict: string; items: { requirement: string | null; severity: string; summary: string; host: "confirmed" | "not confirmed" | "not checked" }[] }[];
  approvals: number; planReference: string | null; planRevisions: number; reworkRounds: number; rejected: string[];
  controllable: boolean; paused: boolean; progress: { done: number; total: number };
};

const stepKey = (step: MissionStep) => step.team?.key ?? step.id.slice(0, 8);

/** One panel per team Coordinator; members ordered by role, then creation. */
export function teamPanels(agents: AgentSnapshot | null | undefined, missions: MissionView[] | null | undefined): TeamPanel[] {
  if (!agents || !missions) return [];
  const rows = agents.agents;
  const out: TeamPanel[] = [];
  for (const coordinator of rows.filter((row) => row.team?.role === "coordinator")) {
    const mission = missions.find((item) => item.id === coordinator.missionId);
    if (!mission?.teamView) continue;
    const view = mission.teamView;
    const byId = new Map(mission.steps.map((step) => [step.id, step]));
    const nameOf = (agentId: string | null | undefined) => {
      const row = rows.find((item) => item.id === agentId);
      return row?.team ? ROLE_LABEL[row.team.role] ?? row.team.role : "Bunny";
    };
    const members = rows.filter((row) => row.team && row.team.role !== "coordinator" && row.missionId === mission.id).map((row): TeamMemberRow => ({
      id: row.id, name: row.name, role: row.team!.role, roleLabel: ROLE_LABEL[row.team!.role] ?? row.team!.role, state: row.state, stateLabel: AGENT_STATE_LABEL[row.state],
      task: row.current ? KIND_LABEL[row.current.kind] ?? row.current.kind : null, taskState: row.current ? STEP_STATE[row.current.state] ?? row.current.state : null,
      model: row.current?.model ? `${row.current.provider ?? "provider"} · ${row.current.model} (routed per task)` : null,
      owned: row.owned ? { total: row.owned.total, completed: row.owned.completed, verified: row.owned.verified, failed: row.owned.failed } : null,
      paused: row.state === "PAUSED", controllable: AGENT_NON_TERMINAL.includes(row.state),
    }));
    // The graph shows the reviewed plan; reserved rework replicas appear only once Bunny activated them.
    const live = mission.steps.filter((step) => step.team && (!step.team.dormant || step.attempts.length > 0) && step.state !== "skipped");
    const graph = live.map((step): TeamGraphNode => ({
      id: step.id, key: stepKey(step), role: step.team!.role, kind: step.team!.kind, label: KIND_LABEL[step.team!.kind] ?? step.team!.kind,
      objective: step.objective, state: step.state, stateLabel: STEP_STATE[step.state] ?? step.state,
      dependsOn: step.dependsOn.map((dep) => byId.get(dep)).filter((dep): dep is MissionStep => !!dep).map(stepKey), round: step.team!.round,
      rework: step.team!.round > 0, verified: step.result?.verified === true,
    }));
    const counted = graph.filter((node) => !mission.steps.find((step) => step.id === node.id)?.team?.supersededBy);
    out.push({
      missionId: mission.id, coordinatorId: coordinator.id, name: coordinator.name, missionState: mission.state, phase: view.phase, members,
      graph, reserved: mission.steps.filter((step) => step.team?.dormant && !step.attempts.length && step.state !== "skipped").length,
      handoffs: view.handoffs.slice(-20).map((handoff) => ({ id: handoff.id, from: nameOf(handoff.sourceAgentId), to: nameOf(handoff.destinationAgentId), type: handoff.artifactType,
        sha: handoff.artifactSha256.slice(0, 12), purpose: handoff.purpose, state: handoff.state })),
      requirements: view.requirementResults.map((result) => ({ id: result.id, text: result.text, state: result.passed === true ? "passed" : result.passed === false ? "failed" : "pending", detail: result.detail, round: result.round })),
      findings: view.findings.map((review) => ({ reviewer: nameOf(review.agentId), verdict: review.verdict, items: review.findings.map((finding) => ({ requirement: finding.requirement, severity: finding.severity, summary: finding.summary,
        host: finding.confirmedByHost === true ? "confirmed" as const : finding.confirmedByHost === false ? "not confirmed" as const : "not checked" as const })) })),
      approvals: mission.requests.filter((request) => !request.resolvedAt).length + (mission.state === "waiting_for_approval" ? 1 : 0),
      planReference: view.planReference, planRevisions: view.planRevisions, reworkRounds: view.reworkRounds,
      rejected: view.rejected.flatMap((entry) => entry.reasons).slice(-6),
      controllable: AGENT_NON_TERMINAL.includes(coordinator.state), paused: coordinator.state === "PAUSED",
      progress: { done: counted.filter((node) => node.state === "completed").length, total: counted.length },
    });
  }
  return out;
}

/** Ids of Agents shown inside a team panel (kept out of the flat single-Agent list). */
export function teamAgentIds(agents: AgentSnapshot | null | undefined): Set<string> {
  return new Set((agents?.agents ?? []).filter((row) => !!row.team).map((row) => row.id));
}

const CHECKS = ["html_id", "html_text", "markdown_heading", "link_to", "dataset_values", "no_external_resources"] as const;
/**
 * Requirement lines from the New team form, one per line: `<check> [value] | <description>`, e.g.
 * `html_id summary | The page has a summary section`. Ids R1… follow line order. The Host validates again.
 */
export function parseRequirementLines(text: string): { requirements: { id: string; text: string; check: { kind: string; value?: string } }[]; errors: string[] } {
  const requirements: { id: string; text: string; check: { kind: string; value?: string } }[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const [spec, ...rest] = line.split("|");
    const description = rest.join("|").trim();
    const [kind, ...valueParts] = spec.trim().split(/\s+/);
    const value = valueParts.join(" ").trim();
    if (!(CHECKS as readonly string[]).includes(kind)) { errors.push(`Line ${index + 1}: unknown check "${kind}". Use one of ${CHECKS.join(", ")}.`); return; }
    const needsValue = !["dataset_values", "no_external_resources"].includes(kind);
    if (needsValue && !value) { errors.push(`Line ${index + 1}: ${kind} needs a value.`); return; }
    if (!description) { errors.push(`Line ${index + 1}: add a description after "|".`); return; }
    requirements.push({ id: `R${requirements.length + 1}`, text: description.slice(0, 200), check: needsValue ? { kind, value } : { kind } });
  });
  if (requirements.length > 12) errors.push("At most 12 requirements.");
  return { requirements, errors };
}
