import type { MissionState, MissionStep } from "./types.ts";

/**
 * M-A-3 T14 — the autonomous execution loop as the owner sees it: PLAN → DELEGATE → EXECUTE → OBSERVE → VERIFY →
 * REPAIR → COMPLETE, plus the states that hold it. This is a PROJECTION of canonical Mission, step and worker facts,
 * not a second state machine: nothing reads it to decide what runs. COMPLETE needs a completed Mission, and it is only
 * `verified` when every step and every worker passed Bunny's own checks; a model's final message never counts.
 */
export const AUTONOMY_PHASES = [
  "PLAN", "DELEGATE", "EXECUTE", "OBSERVE", "VERIFY", "REPAIR", "COMPLETE",
  "WAITING_RESOURCE", "WAITING_DEPENDENCY", "WAITING_AUTHORIZATION", "OUTCOME_UNCERTAIN", "RECONCILIATION_REQUIRED", "FAILED", "CANCELLED",
] as const;
export type AutonomyPhase = (typeof AUTONOMY_PHASES)[number];

export type AutonomyView = {
  phase: AutonomyPhase;
  /** Which canonical fact the phase came from, in plain words. */
  basis: string;
  /** COMPLETE only: whether every step and worker was independently verified by the Host. Null otherwise. */
  verified: boolean | null;
};

type StepFacts = Pick<MissionStep, "state" | "attempts" | "failure" | "reconciliation"> & { team?: { repair?: string | null } };
export type AutonomyInput = {
  state: MissionState;
  steps: StepFacts[];
  requests: { resolvedAt: number | null }[];
  result: { unverifiedSteps: number } | null;
};
export type DelegatedWork = { open: number; verified: number; unverified: number };

const RESOURCE = ["provider_unavailable", "provider_rate_limited", "provider_write_paused", "budget_exceeded", "timeout", "capability_unavailable", "workspace_conflict"];
// A retry after a failed check, or a Team rework replica the Host activated with its failure evidence.
const repairing = (step: StepFacts) => !!step.team?.repair || (step.attempts.length > 1 && step.attempts.at(-2)?.category === "verification_failed");

export function autonomyPhase(mission: AutonomyInput, delegated: DelegatedWork = { open: 0, verified: 0, unverified: 0 }): AutonomyView {
  const at = (phase: AutonomyPhase, basis: string, verified: boolean | null = null): AutonomyView => ({ phase, basis, verified });
  const { state, steps } = mission;
  if (state === "stopped") return at("CANCELLED", "The Mission was stopped.");
  if (state === "failed") return at("FAILED", "The Mission failed.");
  if (state === "completed") {
    const verified = (mission.result?.unverifiedSteps ?? 1) === 0 && delegated.unverified === 0;
    return at("COMPLETE", verified ? "Every step and worker passed Bunny's checks." : "Finished, but some work was not independently verified.", verified);
  }
  const uncertain = steps.some((step) => step.reconciliation?.required);
  if (uncertain && state === "waiting_for_user") return at("RECONCILIATION_REQUIRED", "Outcome uncertain — reconciliation required.");
  if (uncertain) return at("OUTCOME_UNCERTAIN", "A step may already have taken effect; it waits while unrelated work continues.");
  if (state === "draft" || state === "planning") return at("PLAN", "Bunny is planning the Mission.");
  if (state === "waiting_for_approval") return at("WAITING_AUTHORIZATION", "The plan waits for your approval.");
  if (state === "ready") return at("DELEGATE", "Approved; work is being handed out.");
  if (state === "waiting_for_user") {
    if (mission.requests.some((request) => request.resolvedAt === null) || steps.some((step) => step.state === "waiting_for_approval"))
      return at("WAITING_AUTHORIZATION", "An action outside the approval waits for you.");
    const failed = steps.find((step) => step.state === "failed")?.failure?.category ?? "";
    if (RESOURCE.includes(failed)) return at("WAITING_RESOURCE", "A provider, budget or resource ran out; the Mission is paused.");
    if (failed === "dependency_failed") return at("WAITING_DEPENDENCY", "A dependency failed; the Mission is paused.");
    return at("WAITING_AUTHORIZATION", "The Mission needs your decision to continue.");
  }
  if (state === "verifying" || steps.some((step) => step.state === "verifying")) return at("VERIFY", "Bunny is checking the results.");
  const running = steps.filter((step) => step.state === "running");
  if (running.some(repairing)) return at("REPAIR", "A failed check is being repaired.");
  if (running.some((step) => step.attempts.at(-1)?.outcome === "completed")) return at("OBSERVE", "Work finished; Bunny is collecting its results.");
  if (running.length) return at("EXECUTE", "Work is running.");
  if (steps.some((step) => step.state === "waiting_for_approval")) return at("WAITING_AUTHORIZATION", "An action outside the approval waits for you.");
  const ready = steps.filter((step) => step.state === "ready");
  if (ready.some((step) => step.attempts.at(-1)?.category === "verification_failed")) return at("REPAIR", "A failed check is queued for repair.");
  if (ready.some((step) => RESOURCE.includes(step.attempts.at(-1)?.category ?? ""))) return at("WAITING_RESOURCE", "Waiting for a provider or resource before retrying.");
  if (ready.length) return at("DELEGATE", "The next work is being handed out.");
  if (delegated.open && steps.every((step) => ["completed", "skipped"].includes(step.state))) return at("WAITING_DEPENDENCY", `Waiting for ${delegated.open} worker(s).`);
  return at("WAITING_DEPENDENCY", "Waiting for earlier work to finish.");
}
