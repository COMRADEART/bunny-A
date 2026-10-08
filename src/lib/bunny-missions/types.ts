import type { Mode, ProviderId, ProviderExecutionScope, TaskProgress, VerifySpec } from "../orch/types.ts";

/**
 * Bunny-A M-A-0 mission contracts. A mission sits above TaskManager: it owns a bounded step graph,
 * an approved authorization envelope and the evidence each step produced. Model work still runs as
 * ordinary OrchTasks through TaskManager → BunnyRouter → ProviderAdapter.
 */

export type MissionState =
  | "draft"
  | "planning"
  | "waiting_for_approval"
  | "ready"
  | "running"
  | "waiting_for_user"
  | "verifying"
  | "completed"
  | "failed"
  | "stopped";

export type StepState =
  | "pending"
  | "ready"
  | "waiting_for_approval"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped"
  | "stopped";

export type FailureCategory =
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_failed"
  | "capability_unavailable"
  | "capability_failed"
  | "permission_required"
  | "permission_denied"
  | "dependency_failed"
  | "verification_failed"
  | "timeout"
  | "workspace_conflict"
  | "host_restart"
  | "host_failure"
  | "user_stopped"
  | "budget_exceeded"
  | "invalid_plan";

/** Risk classes a capability action declares. EXTERNAL_SIDE_EFFECT and DESTRUCTIVE always ask by default. */
export type RiskClass = "READ" | "WRITE" | "EXECUTE" | "EXTERNAL_SIDE_EFFECT" | "DESTRUCTIVE";

/** Persistent permission choices. The data model supports all of them; M-A-0 enforces them in decisions. */
export type GrantPolicy = "always_allow" | "allow_for_mission" | "ask_every_time" | "read_only" | "never_allow";

export type PermissionDecision = { decision: "allow" | "ask" | "deny"; reason: string; risk: RiskClass; /** Set when an approval batch rescued the ask; admission consumes from it. */ batch?: { id: string } };

export type Budget = {
  /** Child tasks routed to a cloud provider. */
  maxExternalModelCalls: number;
  maxRuntimeMs: number;
  /** Retries across the whole mission. */
  maxRetries: number;
  /** Enforced only against provider-reported token usage; null means no ceiling. */
  maxTokens: number | null;
};

export type MissionLimits = {
  maxConcurrentAgents: number;
  maxSteps: number;
  maxRetriesPerStep: number;
  maxReplans: number;
  maxMissionRuntimeMs: number;
  maxActiveMissions: number;
};

export type MissionConfig = {
  enabled: boolean;
  limits: MissionLimits;
  /** Triggers never fire unless this is on and the trigger itself is enabled. */
  triggersEnabled: boolean;
  /** Bunny-owned browser profile runs headless unless the workstation asks otherwise. */
  browserHeadless: boolean;
};

/** What the user approved for one mission. Child work outside it stops and asks. */
export type AuthorizationEnvelope = {
  /** T5 adjunct; canonical policy remains this envelope plus the Host's current revision. */
  agentic?: { id: string; revision: number };
  id: string;
  missionId: string;
  grantedAt: number;
  grantedBy: string;
  expiresAt: number;
  projectRoots: string[];
  riskClasses: RiskClass[];
  /** Capability action ids or prefixes ("filesystem.*"). */
  capabilities: string[];
  providers: {
    execution: boolean; allow: ProviderId[] | null; localOnly: boolean;
    /** Optional on pre-remediation JSON. Missing authority never permits delegated model launches. */
    sessions?: { steps: { stepId: string; scope: ProviderExecutionScope }[]; maxSessions: number; writeIncludesShell: true };
  };
  filesystem: { read: string[]; write: string[] };
  browser: { enabled: boolean; domains: string[] | "public" };
  terminal: { enabled: boolean; commands: string[]; executables?: { command: string; file: string; prefix: string[] }[] };
  git: { actions: GitAction[] };
  network: { allowed: boolean };
  computer: { enabled: boolean };
  budget: Budget;
  /** Risk classes that ask even inside the envelope. */
  alwaysAsk: RiskClass[];
  revokedAt: number | null;
};
export type GitAction = "status" | "diff" | "log" | "commit" | "worktree" | "merge";

/** Requested scope shown before approval; becomes the envelope when approved. */
export type ScopeRequest = Omit<AuthorizationEnvelope, "id" | "missionId" | "grantedAt" | "grantedBy" | "expiresAt" | "revokedAt" | "agentic">;

export type VerificationCriterion =
  | { kind: "capability"; action: string; params: Record<string, JsonValue>; expect: { field: string; equals?: JsonValue; contains?: string } }
  | { kind: "capability_run"; expectExit: number; stdoutIncludes: string }
  | { kind: "task_spec"; spec: VerifySpec }
  | { kind: "file_exists"; path: string; contains?: string }
  | { kind: "command"; command: string; args: string[]; expectExit: number; timeoutMs?: number }
  | { kind: "artifact"; type: ArtifactType }
  | { kind: "git_diff_nonempty" };

/** Plain JSON, so mission records cross the Host → UI server-function boundary unchanged. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type StepExecutor =
  | { kind: "model"; prompt?: string }
  | { kind: "capability"; action: string; params: Record<string, JsonValue> }
  | { kind: "skill"; skillId: string; params: Record<string, JsonValue> };

export type StepAttempt = {
  attempt: number;
  startedAt: number;
  finishedAt: number | null;
  taskId: string | null;
  capabilityRunId: string | null;
  provider: ProviderId | null;
  outcome: "completed" | "failed" | "stopped" | "interrupted" | "running";
  category: FailureCategory | null;
  detail: string;
};

export type StepAccounting = {
  runtimeMs: number;
  local: boolean | null;
  provider: ProviderId | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** True when no reasoning model was used for this step. */
  deterministic: boolean;
};

export type MissionStep = {
  crossApp?: import("./cross-app.ts").CrossAppMetadata;
  id: string;
  missionId: string;
  index: number;
  role: string;
  objective: string;
  dependsOn: string[];
  requiredCapabilities: string[];
  reasoning: "none" | "light" | "standard" | "deep";
  /** independentOf: a reviewer avoids the providers that produced these steps when another is eligible. */
  preferences: { local?: boolean; fast?: boolean; independentOf?: string[] };
  scope: { root: string | null; access: "read" | "write"; isolation: "shared" | "worktree" };
  providerConstraints: { allow?: ProviderId[]; deny?: ProviderId[] };
  /** Recorded and checked against the routed model; never silently substituted. */
  modelConstraint: string | null;
  executor: StepExecutor;
  expectedArtifacts: ArtifactType[];
  verification: VerificationCriterion[];
  maxRetries: number;
  timeoutMs: number;
  /** Optional explicit weight; progress is weighted only when every step has one. */
  weight: number | null;
  state: StepState;
  taskId: string | null;
  capabilityRunId: string | null;
  workspace: string | null;
  attempts: StepAttempt[];
  result: { summary: string; artifactIds: string[]; verified: boolean | null; verification: string[]; outputRef?: string; verificationRunIds?: string[] } | null;
  evidence: string[];
  failure: { category: FailureCategory; detail: string } | null;
  accounting: StepAccounting;
  pendingRequestId: string | null;
  /** Pending phase; one capability invocation or matching actions in one skill run (see approval UI). */
  pendingPhase: "execute" | "verify" | null;
  approvedOnce: { requestId: string; action: string } | null;
  startedAt: number | null;
  finishedAt: number | null;
};

export type PermissionRequest = {
  /** Exact Host-offered T5 scope; never accepted from model/client parameters. */
  agentic?: { fingerprint: string; revision: number; generation: string; resource: string };
  id: string;
  missionId: string;
  stepId: string;
  action: string;
  risk: RiskClass;
  reason: string;
  createdAt: number;
  resolvedAt: number | null;
  resolution: "allow_once" | "allow_batch" | "deny" | null;
  resolvedBy: string | null;
  /** Host-computed offer of one small bounded batch covering this ask; absent = no batch button. */
  batchOffer: PermissionBatchOffer | null;
};

/**
 * One ephemeral, mission-scoped bounded desktop batch (Gate T9). Created only from a Host-computed
 * offer attached to a real permission request; it never outlives its envelope, never carries more
 * authority than the offer stated, and ends on stop, replan, expiry, exhaustion, scope mismatch or
 * Host restart (`batchEpoch` marks the Host boot it belongs to).
 */
export type ApprovalBatch = {
  id: string;
  missionId: string;
  authorizationId: string;
  family: string;
  actions: string[];
  riskCeiling: RiskClass;
  target: { app: string | null; processId: number | null; title: string | null };
  targetTier: "process" | "app";
  maxActions: number;
  usedCount: number;
  observedPid: number | null;
  observedPidFrom: "params" | "post-run" | null;
  batchEpoch: string;
  createdAt: number;
  createdBy: string;
  expiresAt: number;
  status: "active" | "ended";
  endAt: number | null;
  endReason: "exhausted" | "expired" | "revoked" | "scope_mismatch" | "mission_ended" | "host_restart" | null;
  endBy: string | null;
  originStepId: string;
  /** Digests of concrete Host-planned operations, keyed by their owning step. No input values. */
  operations?: { stepId: string; digest: string }[];
  /** Exact native window + process lifetime observed before any covered window mutation. */
  windowIdentity?: { handle: string; processId: number; processStartedAt: string; contentProcessId?: number; contentStartedAt?: string };
};

/** What the Host proposes when a permission request comes from a small, predictable desktop sequence. */
export type PermissionBatchOffer = {
  family: "computer";
  actions: string[];
  /** Expected executions per covered action in one pass; sum ≤ maxActions. Read-only entries count 0. */
  counts: Record<string, number>;
  maxActions: number;
  ttlMs: number;
  riskCeiling: "EXECUTE";
  targetLabel: string;
  /** The bound target the batch will live inside (strictest identity available at grant time). */
  target: { app: string | null; processId: number | null; title: string | null };
  targetTier: "process" | "app";
  /** Read-only covered actions (never consume the budget). */
  readOnly: string[];
  operations?: { stepId: string; digest: string }[];
};

export type BatchView = {
  id: string;
  maxActions: number;
  usedCount: number;
  targetLabel: string;
  createdAt: number;
  expiresAt: number;
  status: "active" | "ended";
  endReason: ApprovalBatch["endReason"];
};

export type MissionProgress =
  | { kind: "steps"; completed: number; total: number; failed: number; running: number }
  | { kind: "weighted"; completedWeight: number; totalWeight: number; completed: number; total: number; failed: number; running: number };

export type MissionAccounting = {
  runtimeMs: number;
  externalModelCalls: number;
  localModelCalls: number;
  deterministicSteps: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  tokensReported: boolean;
};

export type Mission = {
  id: string;
  title: string;
  objective: string;
  request: string;
  projectId: string | null;
  root: string;
  mode: Mode;
  state: MissionState;
  origin: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  planning: { planner: string; complexity: "simple" | "medium" | "complex"; rationale: string[]; replans: number; plannedAt: number | null };
  requestedScope: ScopeRequest | null;
  authorizationId: string | null;
  capabilityRequirements: string[];
  providerConstraints: { allow?: ProviderId[]; deny?: ProviderId[]; localOnly?: boolean };
  budget: Budget;
  retryPolicy: { maxRetriesPerStep: number };
  verificationRequired: boolean;
  result: { summary: string; verifiedSteps: number; unverifiedSteps: number; artifactIds: string[] } | null;
  failure: { category: FailureCategory; detail: string; stepId: string | null } | null;
  recovery: { at: number; detail: string; interruptedSteps: string[] } | null;
  accounting: MissionAccounting;
};

export type MissionView = Mission & { steps: MissionStep[]; progress: MissionProgress; requests: PermissionRequest[]; artifacts: ArtifactSummary[]; batch: BatchView | null };

export type ArtifactType =
  | "source_file"
  | "patch"
  | "research_note"
  | "browser_evidence"
  | "test_report"
  | "screenshot"
  | "build_artifact"
  | "plan"
  | "specification"
  | "review"
  | "structured_result"
  | "text"
  | "download";

export type Artifact = {
  id: string;
  missionId: string;
  stepId: string | null;
  type: ArtifactType;
  title: string;
  /** Inline for small text/JSON; file for anything else. Consumers receive the reference, not the body. */
  location: { kind: "inline"; mediaType: string } | { kind: "file"; path: string; mediaType: string };
  sha256: string;
  bytes: number;
  createdAt: number;
  verification: "unverified" | "verified" | "failed";
  consumers: string[];
  provenance: string;
};
export type ArtifactSummary = Omit<Artifact, "consumers"> & { consumers: string[] };

export type MemoryKind = "mission_state" | "verified_fact" | "agent_conclusion" | "artifact" | "user_decision" | "skill_knowledge";
export type MemoryEntry = {
  id: string;
  missionId: string | null;
  kind: MemoryKind;
  key: string;
  value: string;
  /** Who established it: "bunny:capability:<run>", "provider:<task>", "user:<origin>". */
  provenance: string;
  /** Only Bunny's own deterministic checks or explicit user decisions make an entry verified. */
  verified: boolean;
  createdAt: number;
};

export type InboxKind = "informational" | "requires_attention" | "requires_approval" | "failure" | "completed" | "external_event";
export type InboxSource = "mission" | "task" | "capability" | "provider" | "browser" | "computer" | "connector" | "system" | "approval" | "trigger" | "skill";
export type InboxEvent = {
  id: string;
  at: number;
  source: InboxSource;
  kind: InboxKind;
  title: string;
  detail: string;
  missionId: string | null;
  taskId: string | null;
  stepId: string | null;
  requestId: string | null;
  acknowledgedAt: number | null;
  /** The Supervisor's rule-based suggestion. M-A-0 only notifies or asks; it never acts on this by itself. */
  suggestion: "ignore" | "notify" | "ask_user" | "continue_mission" | "create_mission";
  hostEventSequence: number | null;
};

export type TriggerSource = "schedule" | "capability_event" | "filesystem" | "github" | "message" | "email" | "calendar" | "mission_event" | "system_event";
export type TriggerAction =
  | { kind: "notify"; title: string }
  | { kind: "create_mission_draft"; objective: string; mode: Mode; projectId: string | null };
export type Trigger = {
  id: string;
  name: string;
  source: TriggerSource;
  /** schedule: intervalMs; event sources: eventType (exact or prefix ending in "*"). */
  condition: { intervalMs?: number; eventType?: string; contains?: string };
  action: TriggerAction;
  enabled: boolean;
  /** Mission drafts created by a trigger always wait for explicit approval. */
  requiresApproval: true;
  rateLimit: { minIntervalMs: number; maxPerHour: number };
  createdAt: number;
  createdBy: string;
  lastFiredAt: number | null;
  firings: number[];
};

export type CapabilityAvailability = "available" | "degraded" | "unavailable" | "unconfigured" | "unsupported";

export type ActionInput = { name: string; type: "string" | "number" | "boolean" | "string[]" | "object"; required: boolean; description: string };
export type ActionManifest = {
  id: string;
  description: string;
  risk: RiskClass;
  /** Privacy-sensitive reads (screen capture) ask like a write. */
  sensitive?: boolean;
  /** Never allowed silently, even by a persistent grant (calls, purchases, credentials). */
  hardApproval?: boolean;
  inputs: ActionInput[];
  outputs: string;
  evidence: string;
  timeoutMs: number;
  /** Actions that exist in the contract but have no implementation on this Host. */
  implemented: boolean;
};

export type CapabilityManifest = {
  id: string;
  version: string;
  description: string;
  locality: "local" | "remote";
  platforms: NodeJS.Platform[] | "any";
  actions: ActionManifest[];
  events: string[];
  cost: { kind: "local_compute" | "network" | "external_service" | "unknown"; note: string };
  adapter: string;
};

export type CapabilityStatus = CapabilityManifest & { availability: CapabilityAvailability; detail: string; checkedAt: number | null };

export type CapabilityRunStatus = "succeeded" | "failed" | "denied" | "unavailable" | "unconfigured" | "unsupported" | "timeout" | "interrupted" | "running" | "stopped";

export type CapabilityResult = {
  ok: boolean;
  status: CapabilityRunStatus;
  summary: string;
  output: unknown;
  evidence: string[];
  artifacts?: { type: ArtifactType; title: string; path?: string; inline?: string; mediaType: string }[];
  before?: unknown;
  after?: unknown;
  errorCategory?: FailureCategory;
  cleanup?: { attempted: boolean; ok: boolean; detail: string };
};

export type CapabilityRun = {
  outputRef?: string;
  cleanup?: { attempted: boolean; ok: boolean; detail: string };
  id: string;
  action: string;
  capability: string;
  missionId: string | null;
  stepId: string | null;
  risk: RiskClass;
  decision: PermissionDecision["decision"];
  decisionReason: string;
  params: Record<string, unknown>;
  status: CapabilityRunStatus;
  summary: string;
  evidence: string[];
  artifactIds: string[];
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  origin: string;
};

export type SkillStep = { action: string; params: Record<string, unknown>; label: string };
export type SkillValidation =
  | { kind: "status_succeeded"; step: number }
  | { kind: "exit_code"; step: number; equals: number }
  | { kind: "output_contains"; step: number; text: string };
export type Skill = {
  id: string;
  version: number;
  name: string;
  description: string;
  requirements: string[];
  preconditions: ({ kind: "capability_available"; action: string } | { kind: "git_repository" } | { kind: "file_exists"; path: string })[];
  parameters: { name: string; type: "string" | "number"; required: boolean; default?: string | number; description: string }[];
  steps: SkillStep[];
  validations: SkillValidation[];
  cleanup: SkillStep[];
  provenance: "builtin" | "recorded" | "repaired";
  status: "active" | "candidate" | "retired";
  previousVersion: number | null;
  reliability: { runs: number; successes: number; lastSuccessAt: number | null; lastFailureAt: number | null };
  createdAt: number;
};

export type MissionSnapshot = {
  enabled: boolean;
  config: MissionConfig;
  missions: MissionView[];
  inbox: InboxEvent[];
  capabilities: CapabilityStatus[];
  skills: Pick<Skill, "id" | "version" | "name" | "description" | "status" | "reliability">[];
  triggers: Trigger[];
};

/** Normalized progress of the child task behind a model step, as the Bar shows it. */
export type AgentActivity = { label: string; detail: string | null; at: number | null; progress: TaskProgress | null };
