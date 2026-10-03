import type { CodexCompatibilityProfile } from "./compatibility.ts";

export type Mode = "fast" | "balanced" | "deep";

export type ProviderId = "codex" | "claude" | "ollama" | "opencode" | "cline" | "cursor";

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

export type OrchTask = {
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
  feedback?: "positive" | "negative" | null;
  retries?: number;
  /** Independent check Bunny-A runs itself after the provider exits successfully. */
  verify?: VerifySpec | null;
  /** Set only on child tasks a mission created; direct tasks never carry it. */
  mission?: { missionId: string; stepId: string } | null;
  /** Who launched it: a direct user approval or a mission-delegated approval under an authorization envelope. */
  approval?: { kind: "user" | "mission"; at: number; authorizationId?: string; missionId?: string; stepId?: string } | null;
  executionScope?: ProviderExecutionScope;
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
  /** Host-owned Mission authority. Not accepted as a user-supplied HTTP constraint. */
  missionAccess?: ProviderExecutionScope["access"];
  localOnly?: boolean;
  offlineOnly?: boolean;
  providerAllowlist?: ProviderId[];
  providerDenylist?: ProviderId[];
  requiresFilesystem?: boolean;
  requiresTerminal?: boolean;
  requiresGit?: boolean;
  requiresGPU?: boolean;
  /** Must run in exactly this approved folder. */
  workingDirectory?: string;
  maxRuntimeMs?: number;
};

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
  provider: ProviderId;
  model: string;
  prompt: string;
};

export type ExecResult = {
  ok: boolean;
  stopped?: boolean;
  output?: string;
  error?: string;
  log: string;
};
