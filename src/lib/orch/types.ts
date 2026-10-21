import type { CodexCompatibilityProfile } from "./compatibility.ts";

export type Mode = "fast" | "balanced" | "deep";

export type ProviderId = "codex" | "claude" | "ollama" | "opencode" | "cline" | "cursor" | "openrouter";

export type TaskType = "coding" | "debug" | "research" | "writing" | "ops" | "general";

export type ContextNeed = "low" | "medium" | "high";

export type Availability =
  | "ready"
  | "busy"
  | "offline"
  | "not_installed"
  | "authentication_required"
  | "rate_limited"
  | "unavailable"
  | "unknown";

/** What a real probe established about a provider's credentials; "unknown" until a safe probe or a real run settles it. */
export type AuthState = "authenticated" | "not_authenticated" | "unknown" | "not_required";

/** Optional adapter features. Unsupported ones carry the reason instead of being silently absent. */
export type ProviderFeature =
  | "launch"
  | "stop"
  | "sendInput"
  | "approval"
  | "resume"
  | "modelSelection"
  | "terminalAttachment"
  | "usageQuota"
  | "projectAwareness";
export type ProviderFeatures = Record<ProviderFeature, { supported: boolean; note: string }>;

/** A provider-reported quota window. `kind` places it: short window = inner ring, weekly = outer ring. */
export type UsageWindow = {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  kind?: "short" | "weekly" | "other";
  windowMinutes?: number | null;
};

/** Which usage facts the provider itself exposes to Bunny-A. */
export type UsageCapabilities = {
  shortWindow: boolean;
  weekly: boolean;
  resetTime: boolean;
  tokenUsage: boolean;
  activeJobs: boolean;
  source: string;
};

/** Counted by Bunny-A from its own task records; never presented as provider quota. */
export type ObservedUsage = {
  tasks: number;
  completed: number;
  failed: number;
  stopped: number;
  runtimeMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  lastTaskAt: number | null;
};

export type TaskState =
  | "queued"
  | "routing"
  | "waiting_for_approval"
  | "launching"
  | "running"
  | "waiting_for_input"
  | "waiting_for_agent_approval"
  | "verifying"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type RouteDecision = {
  task_type: TaskType;
  complexity: number;
  latency_priority: number;
  privacy_priority: number;
  context_requirement: ContextNeed;
  recommended_provider: ProviderId;
  recommended_model: string;
  confidence: number;
  reason: string;
  alternatives: { provider: ProviderId; note: string; score: number }[];
  scores: { provider: ProviderId; score: number }[];
  mode?: Mode;
  requirements?: string[];
  eligible_providers?: ProviderId[];
  excluded?: { provider: ProviderId; reason: string }[];
  reasons?: string[];
  confidence_kind?: "uncalibrated_score";
  policy_id?: string;
  inputs?: RouteInputs;
  // M-A-3 T3 additions (additive): model-level routing truth on the same decision record.
  policy_version?: string;
  routing_mode?: "auto" | "manual";
  candidate_count?: number;
  eligible_candidate_count?: number;
  effort_mode?: string | null;
  task_requirements?: import("./router-requirements.ts").TaskRequirements;
  reroutes?: number;
  /** M-A-3 T3 §5/§19: the router's own reason for the model selection (distinct from the legacy route reason). */
  selection_reason?: string;
  /** M-A-3 T13.1: present only when hosted decision assistance was consulted; advisory provenance, never authority. */
  decision_assistance?: { source: "jev"; action: string; confidence: number | null; /** True only when the advice moved the Task off BunnyRouter's own pick. */ changed?: boolean };
  /** M-A-3 T3 §18/§19: the safe candidate subset the island view may show (the shape §18 persists, capped). */
  candidates?: {
    provider_id: ProviderId;
    model_id: string | null;
    candidate_kind: string;
    effort_mode: string;
    eligible: boolean;
    exclusion_reasons: string[];
    score: number | null;
    components: { name: string; points: number }[] | null;
  }[];
};

/** What the router actually used, recorded with each decision. */
export type RouteInputs = {
  weights: { fit: number; speed: number; local: number; context: number };
  latency_priority: number;
  privacy_priority: number;
  context_requirement: ContextNeed;
  workload: Partial<Record<ProviderId, number>>;
  history: Partial<Record<ProviderId, number>>;
  quota: Partial<Record<ProviderId, { label: string; usedPercent: number }[]>>;
};

export type Usage = {
  percent: number;
  label: string;
  reset: string | null;
} | null;

export type ProviderLive = {
  id: ProviderId;
  name: string;
  availability: Availability;
  installed: boolean;
  authenticated: boolean;
  local_or_cloud: "local" | "cloud";
  supported_task_types: TaskType[];
  current_model: string | null;
  usage: Usage;
  usage_note: string;
  active_jobs: number;
  latency_estimate_ms: number | null;
  extension: boolean;
  detail: string;
  vram: string | null;
  tokens_per_sec: number | null;
  executable?: string | null;
  version?: string | null;
  capabilities?: string[];
  usageWindows?: UsageWindow[];
  usageObservedAt?: number | null;
  /** When the most recent usage read attempt produced no data; previous windows survive untouched (M-A-3 T2). */
  usage_failed_at?: number | null;
  /** First-line reason a usage read attempt produced no data, when the provider threw one. */
  usage_error?: string | null;
  authenticatedState?: AuthState;
  models?: string[];
  /** Installed models that a local service proxies to a hosted provider (Ollama cloud tags). Never local inference. */
  remoteModels?: string[];
  usageCapabilities?: UsageCapabilities;
  features?: ProviderFeatures;
  activeSessions?: { taskId: string; providerSessionId: string | null; pid: number | null }[];
  observed?: ObservedUsage;
  probedAt?: number | null;
  evidence?: string[];
  /** Observed Codex facts; direct task readiness is separate from Mission security eligibility. */
  securityCompatibility?: CodexCompatibilityProfile;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  preferred: ProviderId | "auto";
};

export type TaskLog = { at: number; line: string };

/** Host-owned launch authority, independent of role names and routing preferences.
 * `write` includes provider-managed command execution; `read` must forbid mutations.
 * Absent only on unscoped legacy/direct tasks, whose launch behavior is unchanged.
 */
export type ProviderExecutionScope = { access: "read" | "write" };

/**
 * M-A-3 T13.3 N-C: write work whose attempt may have started and then failed has an uncertain outcome. The Host never
 * replays it automatically; the owner reconciles first (review what landed, then retry or close). Resolution is kept as
 * history; a new uncertain failure replaces it.
 */
export type Reconciliation = {
  required: boolean;
  /** Why the outcome is uncertain (taxonomy-specific, shown to the owner). */
  reason: string;
  at: number;
  resolution?: "retry" | "close" | "stop";
  resolvedBy?: string;
  resolvedAt?: number;
  /** A direct task's retry is a new linked task (terminal tasks never reopen). */
  retryTaskId?: string;
};

export type OrchTask = {
  /** Host policy binding: changing approved MA4 downstream hosts invalidates queued inference. */
  inferencePolicy?: string;
  connectionRoute?: import("../bunny-host/connections.ts").ApprovedRoute | null;
  proposedRoute?: import("../bunny-host/connections.ts").ApprovedRoute | null;
  id: string;
  title: string;
  prompt: string;
  /** Mission children only: the step objective that routing analyses, instead of Bunny's full agent prompt. */
  routingPrompt?: string;
  projectId: string | null;
  mode: Mode;
  state: TaskState;
  provider: ProviderId;
  model: string;
  decision: RouteDecision;
  manual: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  output: string;
  error: string | null;
  logs: TaskLog[];
  pauseSupported: boolean;
  sessionId?: string | null;
  pid?: number | null;
  cwd?: string;
  exitCode?: number | null;
  activity?: string;
  constraints?: TaskConstraints;
  maxRuntimeMs?: number;
  verification?: { passed: boolean; detail: string } | null;
  /** Most recent normalized activity; what the Island shows under the provider name. */
  latestEvent?: { type: string; detail: string; at: number; label?: string; actor?: "provider" | "bunny" } | null;
  progress?: TaskProgress | null;
  /** Token counts reported by the provider for this run. */
  usage?: TokenUsage | null;
  /** Last observed process tree of the owned session (root first). */
  processTree?: ProcessInfo[] | null;
  processTreeAt?: number | null;
  stopReason?: string | null;
  /** Stop ended future task admission; this separately reports OS cleanup verification. */
  stopCleanup?: { status: "complete" | "ownership_unverified" | "cleanup_incomplete"; inspectedAt: number; unresolvedProcessCount: number | null; terminationFailures: number };
  feedback?: "positive" | "negative" | null;
  retries?: number;
  /** Independent check Bunny-A runs itself after the provider exits successfully. */
  verify?: VerifySpec | null;
  /** Set only on child tasks a mission created; direct tasks never carry it. */
  mission?: { missionId: string; stepId: string } | null;
  /** Bounded Host context reference for this child; never an authorization token. */
  projectContextRef?: string;
  /** Who launched it: a direct user approval or a mission-delegated approval under an authorization envelope. */
  approval?: { kind: "user" | "mission"; at: number; authorizationId?: string; missionId?: string; stepId?: string } | null;
  executionScope?: ProviderExecutionScope;
  /** M-A-3 T13.3 N-C: set when a failed write attempt may have started; blocks every replay until reconciled. */
  reconciliation?: Reconciliation;
  /** M-A-3 T13.3 N-C: the last attempt's dispatch: certified not started, may have started, or finished and checked by Bunny-A. */
  dispatch?: "not_started" | "may_have_started" | "verified_terminal";
  // M-A-3 T3 additions (additive): per-Task dynamic-model routing facts.
  /** The provider-native effort/reasoning level selected for THIS Task; null when the provider does not expose one. */
  effort?: string | null;
  routingMode?: "auto" | "manual";
  /** Safe RoutingDecision record id in the routing_decisions store. */
  routingDecisionId?: string;
  /** True when Bunny-A re-routed this Task at least once (pre-launch revalidation or recovery). */
  routingRerouted?: boolean;
};

/** Determinate only when the provider published a finite plan; otherwise indeterminate. Never time-based. */
export type TaskProgress =
  | { kind: "determinate"; completed: number; total: number; source: string; current?: string | null }
  | { kind: "indeterminate"; source?: string };

export type TokenUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; source: string };

export type ProcessInfo = { pid: number; ppid: number; name: string; createdAt: number | null };

export type VerifySpec =
  | { kind: "file"; name: string; expected: string }
  | { kind: "python"; name: string; expected: string };

export type TaskConstraints = {
  /** MA4 hard routing constraints, scoped to this task only. */
  sensitive?: boolean;
  language?: string;
  requiresAudio?: boolean;
  maxCostUsd?: number;
  /** Host-owned Mission authority. Not accepted as a user-supplied HTTP constraint. */
  missionAccess?: ProviderExecutionScope["access"];
  localOnly?: boolean;
  offlineOnly?: boolean;
  /** MA4-S1R2 routing mode; modes only add restrictions (see bunny-host/ma4/hybrid.ts). */
  routingMode?: import("../bunny-host/ma4/hybrid.ts").RoutingMode;
  /** MA4-S1R2 data category an external approval must explicitly cover; absent means "unclassified". */
  dataCategory?: import("../bunny-host/ma4/hybrid.ts").DataCategory;
  /** M-A-3 T3 user routing constraints (§27). Hard filters, never silent overrides. */
  /** Run only on this exact model id; no substitution when it is unavailable. */
  modelExact?: string;
  /** Run only on one of these model ids (provider-qualified where ambiguous is the caller's duty). */
  modelAllowlist?: string[];
  /** Require cloud-hosted execution; local providers are excluded. */
  cloudOnly?: boolean;
  /** Require that data does not leave this workstation (local models only). */
  privacyLocal?: boolean;
  providerAllowlist?: ProviderId[];
  providerDenylist?: ProviderId[];
  requiresFilesystem?: boolean;
  requiresTerminal?: boolean;
  requiresGit?: boolean;
  requiresGPU?: boolean;
  /** Must run in exactly this approved folder. */
  workingDirectory?: string;
  maxRuntimeMs?: number;
  /** M-A-3 T11 Host-owned (never from HTTP): context window to load for a tool-free local generation (Ollama num_ctx). */
  contextTokens?: number;
  /** M-A-3 T11: upper bound on generated tokens (Ollama num_predict); a runaway constrained generation ends. */
  outputTokens?: number;
  /** M-A-3 T11 Host-owned (never from HTTP): structured-output grammar for a tool-free local generation (Ollama format). */
  responseFormat?: { [key: string]: SchemaJson };
};

/** M-A-3 T11: plain JSON for Host-built output schemas (serializable across the Host boundary). */
export type SchemaJson = string | number | boolean | null | SchemaJson[] | { [key: string]: SchemaJson };

export type GpuSample = {
  name: string;
  utilization: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  temperatureC: number | null;
  powerW: number | null;
  note: string | null;
};

export type HostSample = {
  at: number;
  cpu: { utilization: number | null; clockMhz: number | null; temperatureC: number | null };
  memory: { usedBytes: number; availableBytes: number; totalBytes: number };
  gpus: GpuSample[];
  notes: string[];
};

export type HostPresence = "online" | "offline" | "sleeping";

export type ExecRequest = {
  taskId: string;
  /** M-A-3 T10: the task requires local execution; a tag the fresh probe reports as hosted is refused at launch. */
  localOnly?: boolean;
  provider: ProviderId;
  model: string;
  prompt: string;
  /** M-A-3 T11: Ollama num_ctx; absent leaves the request body unchanged. */
  numCtx?: number;
  numPredict?: number;
  /** M-A-3 T11: Ollama structured-output JSON schema; absent leaves the request body unchanged. */
  format?: { [key: string]: SchemaJson };
  /** Provider-native effort/reasoning override Bunny selected; null when the provider does not expose one. */
  effort?: string | null;
};

export type ExecResult = {
  ok: boolean;
  stopped?: boolean;
  output?: string;
  error?: string;
  log: string;
  /** M-A-3 T11: the provider's own final-chunk receipt (Ollama `done` message); absent when the provider sent none. */
  receipt?: OllamaReceipt;
};
/** Provider-reported numbers only; durations are Ollama's nanoseconds, timestamps are Host-observed wall clock. */
export type OllamaReceipt = {
  model: string;
  doneReason: string | null;
  promptEvalCount: number | null;
  evalCount: number | null;
  totalDurationNs: number | null;
  loadDurationNs: number | null;
  promptEvalDurationNs: number | null;
  evalDurationNs: number | null;
  requestedAt: number;
  firstTokenAt: number | null;
  finishedAt: number;
};
