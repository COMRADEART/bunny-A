import type { RiskClass, ScopeRequest } from "./types.ts";

export const AGENTIC_POLICY_VERSION = "ma3.agentic.v1";
export const AGENTIC_STATES = ["PROPOSED", "WAITING_FOR_USER", "ACTIVE", "PAUSED", "EXPIRED", "REVOKED", "EXHAUSTED", "COMPLETED"] as const;
export type AgenticState = typeof AGENTIC_STATES[number];
export type ResourceScope = { kind: "filesystem" | "git"; root: string; identity: string; operations: string[] };
export type CommandBinding = {
  command: string; executable: string; executable_hash: string; prefix: string[];
  args: string[]; cwd: string; script: string; script_hash: string; timeout_ms: number;
  test_resources: string[]; boundary: "pure-read-check-v1";
};
/** Historical consent, subordinate to the MA0 envelope and canonical Host policy. Never a token. */
export type AgenticAuthorizationEnvelope = {
  cross_app?: import("./cross-app.ts").CrossAppConsent;
  id: string; policy_version: typeof AGENTIC_POLICY_VERSION;
  agent_id: string; mission_id: string; project_id: string | null;
  user_authorization_id: string | null;
  authorization_provenance: { actor: string; channel: "workstation" | "paired-device"; request_revision: number } | null;
  proposed_at: number; approved_at: number | null; expires_at: number;
  permitted_capabilities: string[]; permitted_resource_scopes: ResourceScope[]; permitted_action_families: string[];
  browser_origins: string[]; commands: CommandBinding[];
  risk_ceiling: RiskClass; maximum_actions: number; maximum_duration: number; maximum_concurrency: number;
  budget_constraints: { maximum_provider_attempts: number; usage_unknown: "finite-action-budget" };
  current_state: AgenticState; revoked_at: number | null;
  revision: number; integrity_reference: string; host_generation: string | null;
  scope: ScopeRequest; plan_reference: string; restart_requires_consent: true;
};
export type AgenticAdmission = {
  id: string; envelope_id: string; revision: number; host_generation: string;
  agent_id: string; mission_id: string; task_id: string | null; step_id: string;
  capability: string; resource_reference: string; admitted_at: number;
  finished_at: number | null; outcome: "ADMITTED" | "COMPLETED" | "FAILED" | "UNKNOWN";
  attempt_kind: "action" | "retry" | "reroute";
};
export type AgenticProjection = {
  browserOrigins?: string[];
  applications?: string[];
  id: string; revision: number; state: AgenticState; objective: string; capabilities: string[];
  roots: string[]; commands: { command: string; args: string[]; cwd: string; timeoutMs: number }[];
  riskCeiling: RiskClass; expiresAt: number; durationMs: number; maximumActions: number;
  maximumConcurrency: number; admitted: number; completed: number; failed: number; unknown: number;
  remainingActions: number; remainingMs: number; latestAdmission: AgenticAdmission | null;
  pending: { id: string; action: string; risk: RiskClass; reason: string; resource?: string; remote?: import("./types.ts").RemoteAnswer }[];
  limitations: string[];
  /** M-A-3 T9 projection only: whether a paired device may answer the pending consent offer (WAITING_FOR_USER). */
  remoteOffer?: import("./types.ts").RemoteAnswer;
};
export type AgenticAdjustment = { capabilities?: string[]; maximumActions?: number; durationMs?: number; maximumConcurrency?: number };
