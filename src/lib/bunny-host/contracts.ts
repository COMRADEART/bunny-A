import type { MissionSnapshot } from "../bunny-missions/types.ts";
import type { OperationalHealth } from "./failure.server.ts";
import type { ModelCapabilitySnapshot } from "./model-capability.server.ts";
import type { ProviderUsageServiceSnapshot } from "./provider-usage.server.ts";
import type { HostPresentation } from "./presentation.ts";
import type { ReleaseIdentity } from "./release-identity.server.ts";
import type { AgentSnapshot } from "./agent-types.ts";
import type { Mode, OrchTask, Project, ProviderId, ProviderLive, HostSample, TaskConstraints, ProviderFeatures, TaskProgress, TokenUsage, UsageWindow, VerifySpec, ProcessInfo, TaskState, ProviderExecutionScope } from "../orch/types.ts";

/** missionId is null for direct-task and system events (and for every event written before schema v3). */
export type HostEvent = { sequence: number; at: number; type: string; taskId: string | null; detail: string; missionId?: string | null };
export type PerformanceProfile = {
  provider: ProviderId; taskType: string; count: number; completed: number; verified: number; durationMs: number;
  verifiedFailed?: number; stopped?: number; manual?: number; medianDurationMs?: number | null; inputTokens?: number; outputTokens?: number;
  /** Below this many tasks the profile is shown but has no routing weight. */
  minimumSamples?: number; sufficient?: boolean;
};
export type HostIdentity = { hostId: string; epoch: string; startedAt: number };
export type SnapshotViewer =
  | { kind: "workstation" }
  | { kind: "device"; deviceId: string; name: string; role: "paired-device"; pairedAt: number; expiresAt: number; lastSeenAt: number | null; rights: string[] };
export type HostSnapshot = {
  app: "Bunny-A";
  instanceId: string;
  release?: ReleaseIdentity | null;
  health?: OperationalHealth;
  tasks: OrchTask[];
  projects: Project[];
  providers: ProviderLive[];
  samples: HostSample[];
  events: HostEvent[];
  cursor: number;
  /** Read-only, privacy-safe activity over the existing journal and capability records. */
  presentation?: HostPresentation;
  /** M-A-3 T10: workstation-only voice session state. Absent for paired devices and older Hosts. */
  voice?: import("./voice/voice-protocol.ts").VoiceSnapshot;
  performance: PerformanceProfile[];
  remoteConfigured: boolean;
  remoteUrl?: string | null;
  devices?: {id:string;name:string;createdAt:number;expiresAt?:number;lastSeenAt?:number|null}[];
  /** M-A-3 T9: stable installation identity plus the per-boot epoch (the instanceId). Optional: older clients ignore it. */
  hostIdentity?: HostIdentity;
  /** M-A-3 T9: who this snapshot was projected for. Never carries a credential or its hash. */
  viewer?: SnapshotViewer;
  thermal: {cpuWarn:number;gpuWarn:number;autoStop:boolean};
  /** M-A-0 mission layer. Optional: older clients ignore it; when missions are disabled it reports enabled:false. */
  missions?: MissionSnapshot;
  /** M-A-3 T1 per-model capability facts (probed only). Optional: older clients ignore it. */
  modelCapabilities?: ModelCapabilitySnapshot;
  /** M-A-3 T2 normalized provider usage truth (derived from registry state and Bunny's own counters). Optional: older clients ignore it. */
  providerUsage?: ProviderUsageServiceSnapshot;
  /** M-A-3 T4 durable Agent runtime snapshot (agent-level continuity state). Optional: older clients ignore it. */
  agents?: AgentSnapshot;
  /** M-A-3 T13 Personal Agent slots projected onto live Host facts (presentation only). Optional: older clients ignore it. */
  personalAgents?: import("./personal-agents.ts").PersonalAgentsSnapshot;
  /** M-A-3 T13.3: per-Personal-Agent ownership, profile and conversation. Absent for paired devices. */
  personalAgentContext?: import("./personal-agent-context.ts").PersonalAgentContextSnapshot;
  /** M-A-3 T13.3 Gate E: workstation only; stripped from device snapshots. */
  harnesses?: { schema: string; harnesses: import("./harnesses.ts").HarnessView[] };
  /** M-A-3 T13.3 Gate F: this Host run's usage ledger. Workstation only; stripped from device snapshots. */
  sessionLedger?: import("./session-ledger.ts").SessionLedgerView;
  /** M-A-3 T13.3 Gate F: routing priority and Personal Agent fairness. Workstation only. */
  scheduler?: import("./fairness.ts").SchedulerView;
  routingLearning?: import("./routing-feedback.ts").RoutingLearningView;
  voicePersonalization?: import("./voice/voice-personalization.ts").VoicePersonalizationView;
  /** M-A-3 T13.3 Gate H: per-slot character style. Presentation only; paired devices receive it to draw the same look. */
  characterAppearance?: import("./character-style.ts").CharacterAppearanceView;
  /** M-A-3 T13.1 Laya/Jev intelligence state (no secrets; credential existence only). Absent for paired devices. */
  intelligence?: import("./intelligence-snapshot.ts").IntelligenceSnapshot;
  connections?: import("./connections.server.ts").ConnectionsSnapshot;
  deviceConnections?: import("./connections.ts").DeviceConnectionView[];
};
/** `routingPrompt` and `modelOverride` are set in-process by the caller that knows the selection context; HTTP validates both. */
export type SubmitTask = { prompt: string; routingPrompt?: string; mode: Mode; projectId?: string | null; override?: ProviderId | "auto"; /** M-A-3 T3 §27: MANUAL exact-model selection; only honored where a real model surface exists. */ modelOverride?: string | null; constraints?: TaskConstraints; verify?: VerifySpec | null; executionScope?: ProviderExecutionScope; /** M-A-3 T13.1: Host-owned decision assistance (advisory only); never accepted from HTTP bodies. */ decisionAssistance?: import("./intelligence.ts").DecisionAdvice | null };
/**
 * `dispatched: false` is the adapter's certificate that no provider process or request was started for this attempt (a
 * proven pre-dispatch failure). Anything else, including absence, means the attempt may have started (M-A-3 T13.3 N-C).
 */
export type AdapterResult = { ok: boolean; output: string; error?: string; stopped?: boolean; exitCode?: number | null; dispatched?: false };
export type AdapterHooks = {
  beforeDispatch?: () => Promise<void>;
  childEnvironment?: () => Record<string, string>;
  billingSource?: (source: string) => void;
  event: (type: string, detail: string) => void;
  session: (sessionId: string | null, pid: number | null) => void;
  output: (text: string) => void;
  model?: (model: string) => void;
  progress?: (progress: TaskProgress) => void;
  usage?: (usage: TokenUsage) => void;
  /** Usage windows the provider reported inside the session, with its own limit verdict when given. */
  rateLimits?: (windows: UsageWindow[], status?: string) => void;
  /** Raw provider stdout/stderr lines, kept in the Host's private session transcript. */
  raw?: (stream: "stdout" | "stderr", text: string) => void;
  /** M-A-3 T9R-F04: who owns a contained provider process (job record identity; confers no authority). */
  owner?: ProviderProcessOwner;
};
export type ProviderProcessOwner = { dataDirectory: string | null; hostGeneration: string; taskId: string; missionId: string | null; agentId: string | null };
/**
 * M-A-3 T9R-F04: lifetime of a local provider process tree as the Windows job reports it. "empty" is kernel
 * accounting (ActiveProcesses 0 after the job was terminated), never the absence of rows in a process sample.
 */
export type SessionContainment = {
  mechanism: "windows-job-object";
  state: "launching" | "running" | "terminating" | "empty" | "unconfirmed" | "refused";
  /** A provider process was created in the job (false: stopped or refused before any process existed). */
  admitted: boolean;
  operationId: string | null; rootPid: number | null; rootCreatedAt: number | null;
  activeProcesses: number | null; totalProcesses: number | null;
  /** Processes still in the job when the root ended or Stop arrived; all were terminated with the job. */
  terminatedAtEnd: number | null;
  detail: string;
};
export type RunningSession = {
  stop: () => Promise<void>;
  done: Promise<AdapterResult>;
  /** Root process of the owned session, when there is one. */
  pid?: () => number | null;
  sendInput?: (input: string) => Promise<void>;
  /** Present only for a job-contained local process tree (M-A-3 T9R-F04). */
  containment?: () => SessionContainment;
};
/**
 * Provider adapter contract. Session-level operations (getSession, streamEvents, stop, sendInput by
 * task) live on the Host's TaskManager because the Host, not the adapter, owns sessions.
 */
export interface ProviderAdapter {
  /** Transient provider status identity, consumed only by the Host registry; never serialized. */
  connectionIdentity?(): import("./connections.server.ts").NativeAccount | null;
  id: ProviderId;
  /** Full probe: locate, version, authentication, catalogue. Spawns CLIs, so the registry runs it sparingly. */
  detect(): Promise<ProviderLive>;
  /** Cheap check between full probes; no CLI execution. Returns null when a full probe is needed. */
  health?(previous: ProviderLive): Promise<ProviderLive | null>;
  /** Explicit supported/unsupported optional features. */
  capabilities?(): ProviderFeatures;
  /** Official provider usage, when the provider exposes it. */
  usage?(): Promise<{ windows: UsageWindow[]; observedAt: number } | null>;
  launch(task: OrchTask, hooks: AdapterHooks): RunningSession;
}
/** Host-owned view of one agent session. */
export type AgentSession = {
  taskId: string; provider: ProviderId; providerSessionId: string | null; pid: number | null; processTree: ProcessInfo[] | null;
  projectId: string | null; cwd: string | null; startedAt: number | null; finishedAt: number | null; state: TaskState;
  latestEvent: OrchTask["latestEvent"]; progress: TaskProgress | null; logs: OrchTask["logs"]; result: string; error: string | null;
  exitCode: number | null; owned: boolean; features: ProviderFeatures | null; transcript: string | null;
};
