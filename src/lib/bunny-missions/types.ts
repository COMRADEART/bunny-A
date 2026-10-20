import type { Mode, ProviderId, ProviderExecutionScope, TaskProgress, VerifySpec } from "../orch/types.ts";
import type { MissionTeam, StepTeam, TeamOutputContract, TeamRole } from "./team.ts";

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
  /** M-A-3 T13.3 N-B: the Host paused write work it could not safely move to another provider. */
  | "provider_write_paused"
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

export type PermissionDecision = {
  decision: "allow" | "ask" | "deny"; reason: string; risk: RiskClass;
  /** Set when an approval batch rescued the ask; admission consumes from it. */ batch?: { id: string };
  /** M-A-3 T9R-F01: the ask exceeds remote authority; only the trusted workstation may allow it, never a batch. */
  desktopRequired?: boolean;
  /** M-A-3 T9R-F01: the exact operation a desktop answer to this ask would cover (Host-computed). */
  desktopOperation?: DesktopOperation;
  /** M-A-3 T9R-F01: paired-device-authorized changes the workstation reviews by answering this ask. */
  remoteReview?: string[];
  /** M-A-3 T9R-F01: the trusted-desktop grant (its request id) this allow relies on; admission consumes it. */
  desktopGrant?: { id: string };
};

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
    /**
     * Optional on pre-remediation JSON. Missing authority never permits delegated model launches.
     * M-A-3 T9R-F01: `writeIncludesShell` is false on an envelope a paired device granted; such an envelope
     * never launches a shell-capable provider session without a trusted-desktop grant for that exact session.
     */
    sessions?: { steps: { stepId: string; scope: ProviderExecutionScope }[]; maxSessions: number; writeIncludesShell: boolean };
  };
  /** M-A-3 T9R-F01: where this approval came from. Absent on older JSON; derived from `grantedBy` then (fail closed). */
  authority?: EnvelopeAuthority;
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
/**
 * M-A-3 T9R-F01: the tool authority a provider session actually runs with.
 * tool_free: text generation only (Ollama). read_tools: file reading only, no command execution (Claude read).
 * shell: the session can run commands or code (Claude write, Codex in any sandbox mode).
 */
export type SessionAuthority = "tool_free" | "read_tools" | "shell";
/**
 * Who granted an envelope. A remote (paired-device) grant is capped: provider sessions stay within
 * `sessionCeiling` and code-executing actions need a trusted-desktop grant for the exact operation.
 */
export type EnvelopeAuthority =
  | { kind: "workstation" }
  | { kind: "remote"; actor: string; sessionCeiling: SessionAuthority[]; codeExecution: "desktop_only" };
/** The exact operation a trusted-desktop grant covers; compared field for field before use. */
export type DesktopOperation =
  | { kind: "provider_session"; provider: string; model: string; effort: string | null; access: string; cwd: string; sessionAuthority: SessionAuthority | "unknown" }
  | { kind: "capability"; action: string; digest: string; cwd: string; executable: { file: string; prefix: string[] } | null; files?: Record<string, string> };
/**
 * M-A-3 T9R-F01: a trusted-desktop authorization. Minted only when the authenticated workstation answers
 * allow_once to a Host request marked `desktopRequired`. It is bound to this Host and boot epoch, to the
 * exact Mission/Agent/step/Task, plan and envelope, and to one exact operation. It expires quickly, is
 * used at most `maxUses` times and is void once revoked. A paired device can never mint or use one.
 */
export type DesktopGrant = {
  id: string;
  requestId: string;
  hostId: string;
  epoch: string;
  missionId: string;
  agentId: string | null;
  stepId: string;
  taskId: string | null;
  planReference: string;
  authorizationId: string;
  operation: DesktopOperation;
  /** Host-wide count of project-mutating capability runs at approval time. */
  mutationSequence: number;
  grantedBy: "workstation";
  grantedAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
};

/** Requested scope shown before approval; becomes the envelope when approved. */
export type ScopeRequest = Omit<AuthorizationEnvelope, "id" | "missionId" | "grantedAt" | "grantedBy" | "expiresAt" | "revokedAt" | "agentic">;

export type VerificationCriterion =
  | { kind: "capability"; action: string; params: Record<string, JsonValue>; expect: { field: string; equals?: JsonValue; contains?: string } }
  | { kind: "capability_run"; expectExit: number; stdoutIncludes: string }
  | { kind: "task_spec"; spec: VerifySpec }
  | { kind: "file_exists"; path: string; contains?: string }
  | { kind: "command"; command: string; args: string[]; expectExit: number; timeoutMs?: number }
  | { kind: "artifact"; type: ArtifactType }
  | { kind: "git_diff_nonempty" }
  /** M-A-3 T11: Host extraction + check of a team model step's canonical output. */
  | { kind: "team_output"; contract: TeamOutputContract }
  /** M-A-3 T11: the file on disk carries exactly the bytes of the verified source step's canonical artifact. */
  | { kind: "team_file"; path: string; fromStep: string }
  /** M-A-3 T11: the user's requirements, checked by the Host on the real delivered file. */
  | { kind: "team_requirements"; path: string; requirements: string[]; datasetStep: string | null };

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
  /** M-A-3 T11: owning Agent, role, task kind, handoff inputs and rework lineage of a team step. */
  team?: StepTeam;
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
  /** M-A-3 T13.3 N-C: the step's last attempt may have changed something and then failed; replay waits for the owner. */
  reconciliation?: import("../orch/types.ts").Reconciliation;
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
  /** M-A-3 T9 projection only (never stored): whether a paired device may answer this exact ask. */
  remote?: RemoteAnswer;
  /** M-A-3 T9R-F01: Host-set; only the trusted workstation may allow this ask. */
  desktopRequired?: boolean;
  /** M-A-3 T9R-F01: Host-computed exact operation the workstation's allow_once binds to. */
  desktopOperation?: DesktopOperation;
  /** M-A-3 T9R-F01: ids of paired-device-authorized changes this workstation answer acknowledges. */
  remoteReview?: string[];
  /** M-A-3 T9R-F01: the Task, envelope and plan in force when the Host asked; a grant is minted only against these. */
  desktopBinding?: { taskId: string | null; authorizationId: string; planReference: string; mutationSequence?: number };
  /** M-A-3 T9R-F01: the exact-operation grant minted by the workstation's allow_once. */
  desktopGrant?: DesktopGrant;
  /**
   * M-A-3 T9R-F02 (D2): a Host-raised request to promote one staged paired-device change into the project. Only a
   * current workstation allow_once promotes, and only these exact bytes (stagingId + contentHash) to this destination.
   */
  promotion?: { stagingId: string; contentHash: string; contentSize: number; destination: string; classification: string };
  /**
   * M-A-3 T9R-F02 (section 12): why an answered request no longer authorizes anything. OFFERED / APPROVED / DENIED
   * derive from `resolution`; the first recorded end state wins and is never rewritten.
   */
  lifecycle?: { state: ApprovalLifecycleState; at: number; by: string; reason: string };
};
export type ApprovalLifecycleState =
  | "CONSUMED" | "EXPIRED" | "WITHDRAWN" | "INVALIDATED_BY_SCOPE_CHANGE" | "INVALIDATED_BY_SIGNOUT"
  | "INVALIDATED_BY_DEVICE_REVOCATION" | "INVALIDATED_BY_HOST_RESTART";
/** M-A-3 T9: the Host's own verdict on a paired-device answer; the phone never re-derives policy. */
export type RemoteAnswer = {
  answerable: boolean; reason: string | null;
  /** M-A-3 T9R-F01: what a remote approval of this plan leaves for trusted-desktop approval on the Windows Host. */
  desktopFollowUp?: string | null;
  /** M-A-3 T9R-F01: a device may grant only the Host-offered small batch here, not a single allow. */
  batchOnly?: boolean;
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
  /** MA4 task/agent pins persist with this mission, never as a global model preference. */
  modelSelection?: import("../bunny-host/ma4/selection.ts").ModelSelection;
  /** M-A-3 T9R-F01: the paired device that started or resumed this Mission (its changes are reviewed as such). */
  deviceDriven?: string;
  /** M-A-3 T11: present on a multi-Agent Team Mission. */
  team?: MissionTeam;
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

export type MissionView = Mission & { steps: MissionStep[]; progress: MissionProgress; requests: PermissionRequest[]; artifacts: ArtifactSummary[]; batch: BatchView | null;
  /** M-A-3 T9: digest of the reviewed plan; a paired device binds mission.approve to it so a replanned scope is never approved unseen. */
  planReference?: string;
  /** M-A-3 T9: whether a paired device may approve this pending plan (Host verdict). */
  remote?: RemoteAnswer;
  /** M-A-3 T11: Team projection (members, handoffs, findings) from canonical rows. */
  teamView?: TeamView;
};

/**
 * M-A-3 T11: one cross-Agent transfer of a verified artifact reference. A record of data movement only: it never
 * carries a grant, credential, path authority or executable permission.
 */
export type Handoff = {
  id: string;
  missionId: string;
  sourceAgentId: string | null;
  destinationAgentId: string | null;
  sourceStepId: string;
  destinationStepId: string;
  destinationAttempt: number;
  artifactId: string;
  artifactSha256: string;
  artifactType: ArtifactType;
  purpose: "context" | "content" | "review_subject";
  state: "DELIVERED" | "REFUSED";
  reason: string | null;
  createdAt: number;
};
export type TeamView = {
  coordinatorAgentId: string;
  phase: "planning" | "review" | "executing" | "ended";
  outputDir: string;
  limits: MissionTeam["limits"];
  requirements: { id: string; text: string; target: "html" | "markdown" }[];
  members: { agentId: string; role: TeamRole }[];
  planRevisions: number;
  reworkRounds: number;
  proposal: MissionTeam["proposal"];
  rejected: MissionTeam["rejected"];
  handoffs: Handoff[];
  findings: { stepId: string; agentId: string | null; verdict: string; findings: { requirement: string | null; severity: string; summary: string; confirmedByHost: boolean | null }[] }[];
  /** Bunny's own verdict per user requirement, from the latest Tester check that covered it (null: not checked yet). */
  requirementResults: { id: string; text: string; passed: boolean | null; detail: string | null; stepId: string | null; round: number | null }[];
  /** The exact reference the Coordinator approves the reviewed execution plan by (review phase only). */
  planReference: string | null;
};

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
  /** M-A-3 T13.3 N-C: set by the bus, never by an adapter: the action started and its outcome is unknown. */
  uncertain?: true;
  /** M-A-3 T13.3 N-C: the adapter certifies this failure changed nothing (a refusal before any effect). */
  noEffect?: true;
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
  /** M-A-3 T13.3 N-C: the action started and its outcome is unknown (it threw, timed out, or a late success was discarded). */
  uncertain?: true;
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
