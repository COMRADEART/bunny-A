import type { MissionSnapshot } from "../bunny-missions/types.ts";
import type { OperationalHealth } from "./failure.server.ts";
import type { Mode, OrchTask, Project, ProviderId, ProviderLive, HostSample, TaskConstraints, ProviderFeatures, TaskProgress, TokenUsage, UsageWindow, VerifySpec, ProcessInfo, TaskState, ProviderExecutionScope } from "../orch/types.ts";

/** missionId is null for direct-task and system events (and for every event written before schema v3). */
export type HostEvent = { sequence: number; at: number; type: string; taskId: string | null; detail: string; missionId?: string | null };
export type PerformanceProfile = {
  provider: ProviderId; taskType: string; count: number; completed: number; verified: number; durationMs: number;
  verifiedFailed?: number; stopped?: number; manual?: number; medianDurationMs?: number | null; inputTokens?: number; outputTokens?: number;
  /** Below this many tasks the profile is shown but has no routing weight. */
  minimumSamples?: number; sufficient?: boolean;
};
export type HostSnapshot = {
  app: "Bunny-A";
  instanceId: string;
  health?: OperationalHealth;
  tasks: OrchTask[];
  projects: Project[];
  providers: ProviderLive[];
  samples: HostSample[];
  events: HostEvent[];
  cursor: number;
  performance: PerformanceProfile[];
  remoteConfigured: boolean;
  remoteUrl?: string | null;
  devices?: {id:string;name:string;createdAt:number}[];
  thermal: {cpuWarn:number;gpuWarn:number;autoStop:boolean};
  /** M-A-0 mission layer. Optional: older clients ignore it; when missions are disabled it reports enabled:false. */
  missions?: MissionSnapshot;
};
/** `routingPrompt` is set in-process by the MissionManager only (never from HTTP input). */
export type SubmitTask = { prompt: string; routingPrompt?: string; mode: Mode; projectId?: string | null; override?: ProviderId | "auto"; constraints?: TaskConstraints; verify?: VerifySpec | null; executionScope?: ProviderExecutionScope };
export type AdapterResult = { ok: boolean; output: string; error?: string; stopped?: boolean; exitCode?: number | null };
export type AdapterHooks = {
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
};
export type RunningSession = {
  stop: () => Promise<void>;
  done: Promise<AdapterResult>;
  /** Root process of the owned session, when there is one. */
  pid?: () => number | null;
  sendInput?: (input: string) => Promise<void>;
};
/**
 * Provider adapter contract. Session-level operations (getSession, streamEvents, stop, sendInput by
 * task) live on the Host's TaskManager because the Host, not the adapter, owns sessions.
 */
export interface ProviderAdapter {
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
