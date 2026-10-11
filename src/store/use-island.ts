import { create } from "zustand";
import {
  commandBunnyHost,
  readBunnyHost,
  type HostCommandOk,
  type HostCommandResult,
  type HostFailure,
} from "@/lib/orch/host";
import type {
  HostEvent,
  HostIdentity,
  HostSnapshot,
  PerformanceProfile,
  SnapshotViewer,
} from "@/lib/bunny-host/contracts";
import {
  backoffMs,
  canAct,
  commandCaption,
  connectionReducer,
  initialConnection,
  isMutating,
  reconcileCaption,
  type Connection,
  type ConnectionEvent,
  type Uncertain,
} from "@/components/island/connection-model";
import type { MissionSnapshot } from "@/lib/bunny-missions/types";
import type { AgentSnapshot } from "@/lib/bunny-host/agent-types";
import type { VoiceMode, VoiceSnapshot } from "@/lib/bunny-host/voice/voice-protocol";
import {
  acceptVoiceSnapshot,
  parseVoiceSnapshot,
  planUiIntent,
  typedFallbackText,
  voiceRequest,
  type UiSeen,
} from "@/components/island/voice-model";
import {
  PRESS_IDLE,
  pressDown,
  pressEnded,
  pressListenPayload,
  pressOpened,
  pressReset,
  pressStarted,
  pressUp,
  type PressState,
  type PressStep,
  type StartOutcome,
} from "@/components/island/voice-press";
import type { OperationalHealth } from "@/lib/bunny-host/failure.server";
import type { PublicActivity } from "@/lib/bunny-host/presentation";
import type { ModelCapabilitySnapshot } from "@/lib/bunny-host/model-capability.server";
import type { ProviderUsageServiceSnapshot } from "@/lib/bunny-host/provider-usage.server";
import { needsCanonicalResync, reconcileSnapshot } from "@/components/island/activity-model";
import type {
  HostPresence,
  HostSample,
  Mode,
  OrchTask,
  Project,
  ProviderId,
  ProviderLive,
  TaskState,
} from "@/lib/orch/types";

const KEY = "bunny-a.preferences.v1";
const LEGACY_KEY = "jev.island.v1";
export type Sheet =
  | "today"
  | "task"
  | "settings"
  | "compose"
  | "decision"
  | "provider"
  | "system"
  | "tasks"
  | "extensions"
  | "phone"
  | "project"
  | "constellation"
  | "missions"
  | "agentic"
  | "activity"
  | "chat"
  | "devices"
  | null;
export type TaskFilter = "all" | "running" | "completed" | "failed" | "stopped";
export type Draft = {
  id: string;
  prompt: string;
  mode: Mode;
  projectId: string | null;
  createdAt: number;
};
export type Appearance = {
  size: "compact" | "normal" | "detailed";
  position: "left" | "center" | "right";
  idle: "providers" | "temperatures" | "tasks" | "clock" | "minimal" | "mixed";
  motion: "full" | "reduced" | "off";
  glass: "low" | "medium" | "high";
  collapse: 5 | 10 | 30 | 0;
  theme: "system" | "dark" | "light";
  primary: ProviderId[];
};
export const DEFAULT_APPEARANCE: Appearance = {
  size: "compact",
  position: "center",
  idle: "providers",
  glass: "medium",
  motion: "full",
  collapse: 10,
  theme: "dark",
  primary: ["codex", "claude", "ollama"],
};
type Preferences = {
  theme: "dark" | "light";
  appearance: Appearance;
  drafts: Draft[];
  extensions: { cline: boolean; cursor: boolean };
  autoSubmit: boolean;
  cpuWarn: number;
  gpuWarn: number;
};
type Island = Preferences & {
  projects: Project[];
  tasks: OrchTask[];
  audit: { at: number; line: string }[];
  events: HostEvent[];
  activities: PublicActivity[];
  hostInstanceId: string | null;
  snapshotRevision: number;
  syncStatus: string | null;
  streamStatus: "connecting" | "live" | "reconnecting";
  agentFocus: string | null;
  projectFocus: string | null;
  connectionChecked: boolean;
  sheet: Sheet;
  providerFocus: ProviderId | null;
  decisionTaskId: string | null;
  prompt: string;
  mode: Mode;
  autoRoute: boolean;
  override: ProviderId | "auto";
  projectId: string | null;
  host: HostPresence;
  hostHealth: OperationalHealth | null;
  release: HostSnapshot["release"];
  samples: HostSample[];
  ollamaUp: boolean;
  ollamaModels: string[];
  notice: string | null;
  filter: TaskFilter;
  hydrated: boolean;
  providerList: ProviderLive[];
  cursor: number;
  hydratedFromHost: boolean;
  pairingRequired: boolean;
  /** M-A-3 T9 connection truth (connection-model.ts); drives banners, retries and whether controls may act. */
  connection: Connection;
  connectionEvent: (event: ConnectionEvent) => void;
  /** Mutating controls may act only on a fresh canonical view over a working connection. */
  canAct: () => boolean;
  /** Stable Host installation id + this boot's epoch, from the last snapshot. */
  hostIdentity: HostIdentity | null;
  /** Who the Host projected the last snapshot for (workstation, or this paired device). */
  viewer: SnapshotViewer | null;
  /** The Host this device paired with (non-secret; device viewers only). */
  pinnedHostId: string | null;
  /** Commands the Host has not confirmed; their targets stay disabled until reconciled. Never resent. */
  uncertain: Uncertain[];
  /** In-flight command action per target id (Agent, Mission, request or task id). */
  pending: Record<string, string>;
  /** Re-pin after the user confirms a different Host is the one they expect. */
  trustHost: () => void;
  /** Pair this device with a workstation-issued one-time code; pins the returned Host id. */
  pairDevice: (code: string, name: string) => Promise<boolean>;
  /** Sign this device out: it revokes its own credential on the Host and clears its cookie. */
  signOutDevice: () => Promise<void>;
  performance: PerformanceProfile[];
  remoteConfigured: boolean;
  remoteUrl: string | null;
  devices: { id: string; name: string; createdAt: number; expiresAt?: number; lastSeenAt?: number | null }[];
  revokeDevice: (id: string) => void;
  pairCode: string | null;
  localOnly: boolean;
  /** Host-owned mission state (null until a Host that knows missions answers). */
  missions: MissionSnapshot | null;
  /** M-A-3 T2 normalized provider usage truth (null until a Host that knows it answers). */
  providerUsage: ProviderUsageServiceSnapshot | null;
  /** M-A-3 T1 probed per-model capability facts (null until a Host that knows them answers). */
  modelCapabilities: ModelCapabilitySnapshot | null;
  /** M-A-3 T4 durable Agent runtime state (null until a Host that knows agents answers). */
  agents: AgentSnapshot | null;
  /** M-A-3 T10 voice truth from the Host (null until a Host with voice answers). Rendered only; never authority. */
  voice: VoiceSnapshot | null;
  /** Local receipt time of the last voice answer; a stale value means voice is reconnecting, not listening. */
  voiceReceivedAt: number;
  /** False when the Host predates voice; null until a voice answer or a voice-bearing snapshot arrives. */
  voiceSupported: boolean | null;
  voiceNotice: string | null;
  /** Push-to-talk is held (pointer or Space). Set synchronously so a quick release is never lost. */
  voicePressing: boolean;
  openVoice: (mode?: VoiceMode) => Promise<void>;
  closeVoice: () => Promise<void>;
  setVoiceMode: (mode: VoiceMode) => Promise<void>;
  listenStart: () => Promise<void>;
  listenEnd: () => Promise<void>;
  voiceInterrupt: () => Promise<void>;
  setVoiceMute: (on: boolean) => Promise<void>;
  sendVoiceText: (text: string) => Promise<void>;
  confirmVoiceProposal: (id: string) => Promise<void>;
  cancelVoiceProposal: (id: string) => Promise<void>;
  refreshVoice: () => Promise<void>;
  composeKind: "task" | "mission";
  missionFocus: string | null;
  setComposeKind: (kind: "task" | "mission") => void;
  openMission: (id: string | null) => void;
  approveMission: (id: string) => Promise<void>;
  stopMission: (id: string) => Promise<void>;
  pauseAgent: (id: string) => Promise<void>;
  resumeAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  agentAuthorization: (
    id: string,
    action: "propose" | "approve" | "adjust" | "deny" | "revoke",
    revision?: number,
    patch?: {
      maximumActions?: number;
      durationMs?: number;
      maximumConcurrency?: number;
      capabilities?: string[];
    },
  ) => Promise<void>;
  retryMission: (id: string) => Promise<void>;
  /** M-A-3 T9R-F02: workstation-only full view of a staged paired-device change (recorded by the Host as inspected). */
  inspectStaged: (stagingId: string) => Promise<{ content: string; sha256: string; bytes: number } | null>;
  respondMission: (
    requestId: string,
    decision: "allow_once" | "allow_batch" | "deny",
  ) => Promise<void>;
  /** Answer one Host ask, recording which Agent/Mission it belongs to for pending/uncertain state. */
  respondRequest: (
    requestId: string,
    decision: "allow_once" | "allow_batch" | "deny",
  ) => Promise<boolean>;
  revokeBatch: (missionId: string, batchId: string) => Promise<void>;
  ackInbox: (id: string) => void;
  configureMissions: (patch: { enabled?: boolean; triggersEnabled?: boolean }) => void;
  hydrate: () => void;
  refreshOllama: () => Promise<void>;
  pushSample: (sample: HostSample) => void;
  setAppearance: (value: Partial<Appearance>) => void;
  submitting: boolean;
  queueDraft: () => void;
  reviewDraft: (id: string) => void;
  removeDraft: (id: string) => void;
  setSheet: (sheet: Sheet) => void;
  setTheme: (theme: "dark" | "light") => void;
  setPrompt: (prompt: string) => void;
  setMode: (mode: Mode) => void;
  setAutoRoute: (auto: boolean) => void;
  setOverride: (override: ProviderId | "auto") => void;
  setProjectId: (id: string | null) => void;
  setProviderFocus: (id: ProviderId) => void;
  setFilter: (filter: TaskFilter) => void;
  setHost: (host: HostPresence) => void;
  setAutoSubmit: (auto: boolean) => void;
  setCpuWarn: (value: number) => void;
  setGpuWarn: (value: number) => void;
  setExtension: (id: "cline" | "cursor", on: boolean) => void;
  addProject: (name: string, path: string) => void;
  projectCommand: (action: string, data: Record<string, unknown>) => Promise<unknown | null>;
  removeProject: (id: string) => void;
  dismissNotice: () => void;
  note: (line: string) => void;
  submit: () => void;
  sendDrafts: () => void;
  run: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  pause: (id: string) => void;
  resume: (id: string) => void;
  restart: (id: string) => void;
  retarget: (id: string, provider: ProviderId) => void;
  openDecision: (id: string) => void;
  feedback: (id: string, value: "positive" | "negative") => void;
  createPairCode: () => void;
  setLocalOnly: (value: boolean) => void;
};
const ACTIVE: TaskState[] = [
  "queued",
  "routing",
  "waiting_for_approval",
  "launching",
  "running",
  "waiting_for_input",
  "waiting_for_agent_approval",
  "verifying",
  "paused",
];
function load(key = KEY): Partial<Preferences> & { tasks?: OrchTask[]; projects?: Project[] } {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}
function save(state: Island) {
  const { theme, appearance, drafts, extensions, autoSubmit, cpuWarn, gpuWarn } = state;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ theme, appearance, drafts, extensions, autoSubmit, cpuWarn, gpuWarn }),
    );
  } catch {
    /* UI preferences are optional; Host owns tasks. */
  }
}
export function liveProviders(state: {
  providerList?: ProviderLive[];
  host?: HostPresence;
  tasks: OrchTask[];
  ollamaUp: boolean;
  ollamaModels: string[];
  extensions: { cline: boolean; cursor: boolean };
}): ProviderLive[] {
  if (state.providerList?.length)
    return state.providerList.map((p) =>
      state.host === "offline"
        ? {
            ...p,
            availability: "offline",
            authenticated: false,
            detail: "Bunny-A Host unreachable; last detected information retained.",
          }
        : p,
    );
  return (["codex", "claude", "ollama", "opencode", "cline", "cursor"] as ProviderId[]).map(
    (id) => ({
      id,
      name: {
        codex: "Codex",
        claude: "Claude Code",
        ollama: "Ollama",
        opencode: "OpenCode",
        cline: "Cline",
        cursor: "Cursor",
      }[id],
      availability: "unavailable",
      installed: false,
      authenticated: false,
      local_or_cloud: id === "ollama" ? "local" : "cloud",
      supported_task_types: [],
      current_model: null,
      usage: null,
      usage_note: "Usage unavailable",
      active_jobs: 0,
      latency_estimate_ms: null,
      extension: ["opencode", "cline", "cursor"].includes(id),
      detail: "Awaiting Host discovery.",
      vram: null,
      tokens_per_sec: null,
    }),
  );
}
let refreshing: Promise<void> | null = null;
/** A hung read never freezes the client: it counts as a failure and frees the single-flight slot. */
export const READ_TIMEOUT_MS = 12_000;
/** The gateway waits 45 s for a command; beyond this the outcome is unknown and is reconciled, never resent. */
export const COMMAND_TIMEOUT_MS = 50_000;
const PIN_KEY = "bunny-a.remote-host.v1";
function loadPin(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(PIN_KEY) ?? "null") as { hostId?: unknown } | null;
    return typeof value?.hostId === "string" ? value.hostId : null;
  } catch {
    return null;
  }
}
function savePin(hostId: string | null) {
  try {
    if (hostId) localStorage.setItem(PIN_KEY, JSON.stringify({ hostId }));
    else localStorage.removeItem(PIN_KEY);
  } catch {
    /* The pin is a convenience; the Host still checks every command's expected identity. */
  }
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function newOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Android Chrome throws for the page Notification constructor; a notification never breaks Host truth. */
function notify(body: string, tag: string) {
  try {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted")
      new Notification("Bunny-A", { body, tag });
  } catch {
    /* Unsupported constructor (mobile): the in-app attention badge still shows it. */
  }
}
export const useIsland = create<Island>((set, get) => {
  let requestOrder = 0,
    appliedOrder = 0,
    disconnected = false;
  let accessGeneration = 0;
  const reconciling = new Set<string>();
  // M-A-3 T10 voice slice. Polling runs only while a session is open; nothing here starts a session on its own.
  const VOICE_POLL_MS = 250;
  const VOICE_HIDDEN_STOP_MS = 30_000;
  let voiceSeen: UiSeen = null;
  let voiceTimer: ReturnType<typeof setInterval> | null = null;
  let voiceBusy = false;
  let voiceHiddenSince: number | null = null;
  // Push-to-talk sequencing lives in voice-press.ts; this slice only runs its effects against the Host.
  let press: PressState = PRESS_IDLE;
  const stopVoicePolling = () => {
    if (voiceTimer) clearInterval(voiceTimer);
    voiceTimer = null;
  };
  const acceptVoice = (next: VoiceSnapshot | null) => {
    if (!next) return;
    // Any answer proves the Host is reachable, so the receipt time moves even when the content is older.
    const current = get().voice;
    set({ voiceReceivedAt: Date.now(), voiceSupported: true });
    // A stale answer is dropped whole. It must not reset push-to-talk, replay a uiIntent or stop polling, because a
    // dashboard or /state reply computed before the open landed can arrive after it with open:false.
    if (!acceptVoiceSnapshot(current, next)) return;
    set({ voice: next, voiceSupported: true, voiceNotice: null });
    const plan = planUiIntent(next.uiIntent, voiceSeen, next.hostEpoch ?? "");
    voiceSeen = plan.seen;
    if (plan.target) set({ sheet: plan.target.sheet, agentFocus: plan.target.agentFocus ?? get().agentFocus });
    if (next.open) ensureVoicePolling();
    else {
      stopVoicePolling();
      press = pressReset();
      set({ voicePressing: false });
    }
  };
  let pressTurn: string | null = null;
  const runPress = async (planned: PressStep): Promise<void> => {
    press = planned.state;
    set({ voicePressing: press.pressed });
    for (const effect of planned.effects) {
      if (effect.type === "open_session") {
        await voiceCall("voice.session.open", { mode: "push_to_talk" });
        if (get().voice?.open) ensureVoicePolling();
        await runPress(pressOpened(press, !!get().voice?.open));
      } else if (effect.type === "listen_start") {
        ensureVoicePolling();
        const { snapshot, outcome } = await voiceCallOutcome("voice.listen.start", pressListenPayload());
        // The release is bound to the turn this start was answered with, never to an earlier snapshot.
        pressTurn = snapshot?.turnId ?? null;
        const started: StartOutcome = snapshot ? "started" : outcome === "refused" ? "refused" : "unknown";
        await runPress(pressStarted(press, started));
      } else {
        // Bound to the turn this press started: the Host ignores a late release for an older turn. An unknown start
        // has no turn, so its defensive end is unbound and ends whatever capture the Host holds.
        await voiceCall("voice.listen.end", pressTurn ? { turnId: pressTurn } : {});
        pressTurn = null;
        await runPress(pressEnded(press));
      }
    }
  };
  const voiceCall = async (action: string, data: Record<string, unknown> = {}): Promise<VoiceSnapshot | null> =>
    (await voiceCallOutcome(action, data)).snapshot;
  /** A transport failure or timeout is "unknown": the Host may have acted. A Host answer that is not ok is "refused". */
  const voiceCallOutcome = async (
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<{ snapshot: VoiceSnapshot | null; outcome: StartOutcome }> => {
    let result: HostCommandResult;
    try {
      result = await withTimeout(commandBunnyHost({ data: { action, data } }), COMMAND_TIMEOUT_MS);
    } catch {
      // No answer at all (timeout or transport): the Host may still have acted on the request.
      result = {
        ok: false,
        outcome: "unknown",
        code: "HOST_UNREACHABLE",
        message: "Bunny-A Host did not answer.",
        status: 0,
        pairing: false,
      };
    }
    if (result.ok) {
      const next = parseVoiceSnapshot(result.data);
      // An answer without the voice contract means the Host predates voice: say so, never fake a session.
      if (!next) {
        set({ voiceSupported: false, voiceNotice: "Voice needs the updated Bunny Host." });
        return { snapshot: null, outcome: "refused" };
      }
      acceptVoice(next);
      return { snapshot: next, outcome: "started" };
    }
    const outcome: StartOutcome = result.outcome === "unknown" ? "unknown" : "refused";
    if (result.pairing) {
      enterPairing(result.code);
      return { snapshot: null, outcome };
    }
    if (result.status === 404 || /UNKNOWN|NOT_FOUND|UNSUPPORTED/i.test(result.code)) {
      set({ voiceSupported: false, voiceNotice: "Voice needs the updated Bunny Host." });
      return { snapshot: null, outcome };
    }
    set({ voiceNotice: result.message });
    return { snapshot: null, outcome };
  };
  const refreshVoice = async () => {
    if (voiceBusy) return;
    if (typeof document !== "undefined" && document.hidden) {
      voiceHiddenSince ??= Date.now();
      if (Date.now() - voiceHiddenSince > VOICE_HIDDEN_STOP_MS) stopVoicePolling();
      return;
    }
    voiceHiddenSince = null;
    voiceBusy = true;
    try {
      await voiceCall("voice.state");
    } finally {
      voiceBusy = false;
    }
  };
  const ensureVoicePolling = () => {
    if (voiceTimer || typeof window === "undefined") return;
    voiceTimer = setInterval(() => {
      if (!get().voice?.open) {
        stopVoicePolling();
        return;
      }
      void refreshVoice();
    }, VOICE_POLL_MS);
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      voiceHiddenSince = null;
      if (get().voice?.open) {
        ensureVoicePolling();
        void refreshVoice();
      }
    });
  const apply = (snapshot: HostSnapshot, after = 0, order = ++requestOrder, generation = accessGeneration) => {
    const state = get();
    // A response admitted before sign-out/revocation cannot repopulate a cleared protected view.
    if (generation !== accessGeneration || state.connection.state === "pairing") return;
    if (order < appliedOrder && snapshot.instanceId !== state.hostInstanceId) return;
    const reconciled = reconcileSnapshot(
      {
        instanceId: state.hostInstanceId,
        revision: state.snapshotRevision,
        cursor: state.cursor,
        events: state.events,
        activities: state.activities,
      },
      snapshot,
      after,
    );
    if (!reconciled) return;
    appliedOrder = Math.max(appliedOrder, order);
    // M-A-3 T9: a paired device pins the Host it paired with; a different Host blocks controls until trusted.
    const identity = snapshot.hostIdentity ?? null;
    const viewer = snapshot.viewer ?? null;
    let pinned = state.pinnedHostId;
    if (viewer?.kind === "device" && identity && !pinned) {
      pinned = identity.hostId;
      savePin(pinned);
    }
    const hostChanged = viewer?.kind === "device" && !!identity && !!pinned && identity.hostId !== pinned;
    set({ hostIdentity: identity, viewer, pinnedHostId: pinned });
    get().connectionEvent({ type: "read-ok", at: Date.now(), hostChanged });
    const ollama = snapshot.providers.find((p) => p.id === "ollama");
    // The first snapshot only seeds the cursor: replaying history would notify about long-finished tasks.
    const fresh = reconciled.fresh;
    set({
      hostHealth: snapshot.health ?? null,
      release: snapshot.release ?? null,
      remoteUrl: snapshot.remoteUrl ?? null,
      devices: snapshot.devices ?? [],
      events: reconciled.events,
      activities: reconciled.activities,
      hostInstanceId: reconciled.instanceId,
      snapshotRevision: reconciled.revision,
      syncStatus: reconciled.gap
        ? "Activity history gap. Current state refreshed from the Host."
        : reconciled.restarted
          ? "Host restarted. Current state refreshed; old sessions were not resumed."
          : disconnected
            ? "Reconnected. Current state refreshed from the Host."
            : state.syncStatus,
      connectionChecked: true,
    });
    set({
      hydratedFromHost: true,
      pairingRequired: false,
      host: "online",
      tasks: snapshot.tasks,
      projects: snapshot.projects,
      providerList: snapshot.providers,
      samples: snapshot.samples,
      cursor: reconciled.cursor,
      performance: snapshot.performance,
      remoteConfigured: snapshot.remoteConfigured,
      missions: snapshot.missions ?? null,
      agents: snapshot.agents ?? null,
      providerUsage: snapshot.providerUsage ?? null,
      modelCapabilities: snapshot.modelCapabilities ?? null,
      cpuWarn: snapshot.thermal?.cpuWarn ?? 90,
      gpuWarn: snapshot.thermal?.gpuWarn ?? 85,
      ollamaUp: ollama?.availability === "ready" || ollama?.availability === "busy",
      ollamaModels: ollama?.current_model ? [ollama.current_model] : [],
      audit: reconciled.events
        .slice(-80)
        .reverse()
        .map((e) => ({ at: e.at, line: `${e.type}: ${e.detail}` })),
    });
    disconnected = false;
    // M-A-3 T10: the dashboard carries the same voice truth, so a reconnected page restores it without a voice poll.
    acceptVoice(parseVoiceSnapshot((snapshot as { voice?: unknown }).voice));
    for (const event of fresh)
      if (
        // A mission's child tasks are approved and reported by the mission itself.
        !(
          event.missionId &&
          ["approval.required", "task.completed", "task.failed"].includes(event.type)
        ) &&
        [
          "thermal.warning",
          "task.completed",
          "task.failed",
          "approval.required",
          "agent.waiting_for_input",
          "agent.waiting_for_approval",
          "mission.approval_required",
          "mission.permission_required",
          "mission.completed",
          "mission.failed",
        ].includes(event.type)
      ) {
        if (event.type === "thermal.warning") get().note(event.detail);
        notify(
          event.type === "thermal.warning" ? event.detail : event.type.replaceAll(".", " "),
          event.taskId ?? event.missionId ?? event.type,
        );
      }
  };
  /** Revoked, expired or unpaired: stop retrying and drop every protected projection from memory. */
  const enterPairing = (code: string) => {
    accessGeneration++;
    refreshing = null;
    disconnected = true;
    set({
      host: "offline",
      connectionChecked: true,
      pairingRequired: true,
      agents: null,
      voice: null,
      voiceReceivedAt: 0,
      voicePressing: false,
      missions: null,
      tasks: [],
      projects: [],
      events: [],
      activities: [],
      audit: [],
      devices: [],
      providerList: [],
      providerUsage: null,
      modelCapabilities: null,
      samples: [],
      uncertain: [],
      pending: {},
      hostInstanceId: null,
      viewer: null,
      hostIdentity: null,
      hostHealth: null,
      release: null,
      performance: [],
      remoteUrl: null,
      pairCode: null,
      cursor: 0,
    });
    get().connectionEvent({ type: "pairing", code });
  };
  const failRead = (failure: HostFailure | null) => {
    if (failure?.pairing) return enterPairing(failure.code);
    disconnected = true;
    set({ host: "offline", connectionChecked: true, pairingRequired: false });
    get().connectionEvent({ type: "read-fail", at: Date.now() });
  };
  const forget = (operationId: string, caption: string) => {
    set({ uncertain: get().uncertain.filter((row) => row.operationId !== operationId) });
    get().note(caption);
  };
  /**
   * A command whose answer was lost: refresh canonical state and ask the Host what happened to that exact
   * operation id. Nothing is ever resent; a new Host epoch means the ledger is gone, so only canonical state counts.
   */
  const reconcile = async (row: Uncertain) => {
    if (reconciling.has(row.operationId)) return;
    reconciling.add(row.operationId);
    if (!get().uncertain.some((item) => item.operationId === row.operationId))
      set({ uncertain: [...get().uncertain, row] });
    get().note(commandCaption({ code: "OUTCOME_UNKNOWN", message: "", outcome: "unknown" }));
    try {
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (!get().uncertain.some((item) => item.operationId === row.operationId)) return;
      await get().refreshOllama();
      const current = get();
      if (current.connection.state === "pairing") return forget(row.operationId, "This device must pair again.");
      if (current.host === "online" && current.connection.state !== "host-changed") {
        const sameEpoch = !!row.epoch && current.hostIdentity?.epoch === row.epoch;
        if (!sameEpoch) return forget(row.operationId, reconcileCaption("unknown", false));
        const status = await command("operation.status", { operationId: row.operationId });
        const data = status?.data as { state?: string; error?: string | null } | undefined;
        if (data?.state && data.state !== "in_progress")
          return forget(row.operationId, reconcileCaption(data.state, true, data.error));
      }
      await sleep(backoffMs(attempt));
    }
    // An in-progress or unreachable operation remains uncertain. A later successful refresh checks again;
    // elapsed time is never authority to unlock a conflicting control.
    get().note("The Host has not confirmed this action yet. Controls stay paused while it is checked.");
    } finally {
      reconciling.delete(row.operationId);
    }
  };
  /**
   * Every Host command. Mutating actions carry an operation id and the Host identity/epoch this view came from,
   * are refused locally when the view is not fresh, and are never queued or resent. Returns the Host answer only
   * when the Host applied it.
   */
  const command = async (
    action: string,
    data: Record<string, unknown>,
    targetId: string | null = null,
  ): Promise<HostCommandOk | null> => {
    const mutating = isMutating(action);
    const before = get();
    if (mutating && !before.canAct()) {
      before.note(
        before.connection.state === "host-changed"
          ? "This is a different Bunny-A Host. Review it before changing anything."
          : "Reconnect to the Host before changing anything. Nothing was sent.",
      );
      return null;
    }
    if (targetId && (before.pending[targetId] || before.uncertain.some((row) => row.targetId === targetId))) {
      before.note("Bunny is still confirming the previous action on this item.");
      return null;
    }
    const operationId = mutating ? newOperationId() : undefined;
    const generation = accessGeneration;
    const identity = before.hostIdentity;
    const expect = mutating && identity ? { hostId: identity.hostId, epoch: identity.epoch } : undefined;
    if (targetId) set({ pending: { ...get().pending, [targetId]: action } });
    const order = ++requestOrder;
    let result: HostCommandResult;
    try {
      result = await withTimeout(
        commandBunnyHost({
          data: { action, data, ...(operationId ? { operationId } : {}), ...(expect ? { expect } : {}) },
        }),
        COMMAND_TIMEOUT_MS,
      );
    } catch {
      result = {
        ok: false,
        outcome: mutating ? "unknown" : "refused",
        code: mutating ? "OUTCOME_UNKNOWN" : "HOST_UNREACHABLE",
        message: "Bunny-A Host did not answer.",
        status: 0,
        pairing: false,
      };
    } finally {
      if (targetId) {
        const { [targetId]: _done, ...rest } = get().pending;
        set({ pending: rest });
      }
    }
    if (generation !== accessGeneration) return null;
    if (result.ok) {
      // M-A-3 T10: voice.* replies carry only {data}; every other command still returns the dashboard snapshot.
      if (result.snapshot) apply(result.snapshot, 0, order, generation);
      return result;
    }
    if (result.pairing) {
      enterPairing(result.code);
      return null;
    }
    if (result.outcome === "unknown" && operationId) {
      void reconcile({ operationId, action, targetId, since: Date.now(), epoch: identity?.epoch ?? null });
      return null;
    }
    get().note(commandCaption(result));
    if (result.code === "HOST_EPOCH_CHANGED" || result.code === "HOST_IDENTITY_CHANGED") void get().refreshOllama();
    return null;
  };
  const agentRevision = (id: string) =>
    get().agents?.agents.find((agent) => agent.id === id)?.authorization?.revision;
  const requestTarget = (requestId: string) =>
    get().agents?.agents.find((agent) => agent.authorization?.pending.some((item) => item.id === requestId) ||
      get().missions?.missions.find((mission) => mission.id === agent.missionId)?.requests.some((request) => request.id === requestId))?.id ??
    get().missions?.missions.find((mission) => mission.requests.some((request) => request.id === requestId))?.id ??
    requestId;
  return {
    voice: null,
    voiceReceivedAt: 0,
    voiceSupported: null,
    voiceNotice: null,
    voicePressing: false,
    refreshVoice: async () => {
      await refreshVoice();
    },
    openVoice: async (mode = "push_to_talk") => {
      await voiceCall("voice.session.open", { mode });
      if (get().voice?.open) ensureVoicePolling();
    },
    closeVoice: async () => {
      press = pressReset();
      set({ voicePressing: false });
      await voiceCall("voice.session.close");
    },
    setVoiceMode: async (mode) => {
      await voiceCall("voice.session.open", { mode });
    },
    listenStart: async () => {
      await runPress(pressDown(press, !!get().voice?.open));
    },
    listenEnd: async () => {
      await runPress(pressUp(press));
    },
    voiceInterrupt: async () => {
      await voiceCall("voice.interrupt");
    },
    setVoiceMute: async (on) => {
      await voiceCall("voice.mute", voiceRequest.mute(on));
    },
    sendVoiceText: async (text) => {
      const clean = typedFallbackText(text);
      if (!clean) return;
      await voiceCall("voice.text", { text: clean });
    },
    confirmVoiceProposal: async (id) => {
      await voiceCall("voice.control.confirm", voiceRequest.confirm(id));
    },
    cancelVoiceProposal: async (id) => {
      await voiceCall("voice.control.cancel", { id });
    },
    theme: "dark",
    appearance: DEFAULT_APPEARANCE,
    submitting: false,
    events: [],
    activities: [],
    hostInstanceId: null,
    snapshotRevision: 0,
    syncStatus: null,
    streamStatus: "connecting",
    agentFocus: null,
    projectFocus: null,
    connectionChecked: false,
    drafts: [],
    extensions: { cline: false, cursor: false },
    autoSubmit: false,
    cpuWarn: 90,
    gpuWarn: 85,
    projects: [],
    tasks: [],
    audit: [],
    sheet: "today",
    providerFocus: null,
    decisionTaskId: null,
    prompt: "",
    mode: "balanced",
    autoRoute: true,
    override: "auto",
    projectId: null,
    host: "offline",
    samples: [],
    ollamaUp: false,
    ollamaModels: [],
    notice: null,
    filter: "all",
    hydrated: false,
    providerList: [],
    cursor: 0,
    hydratedFromHost: false,
    pairingRequired: false,
    connection: initialConnection(),
    connectionEvent: (event) => {
      const next = connectionReducer(get().connection, event);
      if (next !== get().connection) set({ connection: next });
    },
    canAct: () => canAct(get().connection, Date.now()),
    hostIdentity: null,
    viewer: null,
    pinnedHostId: null,
    uncertain: [],
    pending: {},
    trustHost: () => {
      const hostId = get().hostIdentity?.hostId ?? null;
      if (!hostId) return;
      savePin(hostId);
      set({ pinnedHostId: hostId });
      get().connectionEvent({ type: "trust-host", at: Date.now() });
      get().note("This Host is now trusted on this device.");
    },
    pairDevice: async (code, name) => {
      try {
        accessGeneration++;
        refreshing = null;
        const response = await fetch("/api/bunny-pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: code.trim(), name: name.trim() || "Phone" }),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string; hostId?: string | null };
        if (!response.ok) {
          get().note(result.error ?? "Pairing failed. Check the one-time code on your workstation.");
          return false;
        }
        if (result.hostId) {
          savePin(result.hostId);
          set({ pinnedHostId: result.hostId });
        }
        disconnected = true;
        set({ pairingRequired: false });
        get().connectionEvent({ type: "paired", at: Date.now() });
        await get().refreshOllama();
        return true;
      } catch {
        get().note("Pairing unavailable. Check the secure companion connection.");
        return false;
      }
    },
    signOutDevice: async () => {
      try {
        const response = await fetch("/api/bunny-pair", { method: "DELETE" });
        const result = (await response.json().catch(() => ({}))) as { revoked?: boolean; hostUnreachable?: boolean };
        get().note(
          result.revoked
            ? "This phone is signed out and its access was revoked on the Host."
            : result.hostUnreachable
              ? "Signed out on this phone. The Host was unreachable: revoke this device from your workstation too."
              : "Signed out on this phone.",
        );
      } catch {
        get().note("Sign out could not reach the Host. Revoke this device from your workstation.");
      }
      savePin(null);
      set({ pinnedHostId: null });
      enterPairing("PAIRING_REQUIRED");
    },
    performance: [],
    remoteConfigured: false,
    pairCode: null,
    localOnly: false,
    remoteUrl: null,
    devices: [],
    missions: null,
    agents: null,
    providerUsage: null,
    modelCapabilities: null,
    hostHealth: null,
    release: null,
    composeKind: "task",
    missionFocus: null,
    setComposeKind: (composeKind) => set({ composeKind }),
    openMission: (missionFocus) => set({ missionFocus }),
    approveMission: async (id) => {
      // Bind the approval to the plan this view reviewed; the Host refuses a replanned scope.
      const plan = get().missions?.missions.find((mission) => mission.id === id)?.planReference;
      await command("mission.approve", { id, ...(plan ? { plan } : {}) }, id);
    },
    pauseAgent: async (id) => {
      await command("agent.pause", { id }, id);
    },
    resumeAgent: async (id) => {
      // Resume restores admissions, so it is bound to the consent revision this view reviewed.
      const revision = agentRevision(id);
      await command("agent.resume", { id, ...(revision === undefined ? {} : { revision }) }, id);
    },
    stopAgent: async (id) => {
      await command("agent.stop", { id }, id);
    },
    agentAuthorization: async (id, action, revision, patch) => {
      await command(
        `agent.authorization.${action}`,
        {
          id,
          ...(revision === undefined ? {} : { revision }),
          ...(patch ? { patch } : {}),
        },
        id,
      );
    },
    stopMission: async (id) => {
      await command("mission.stop", { id }, id);
    },
    retryMission: async (id) => {
      await command("mission.retry", { id }, id);
    },
    inspectStaged: async (stagingId) => {
      const result = await command("mission.staging.inspect", { stagingId }, stagingId);
      const data = result?.data as { content?: unknown; sha256?: unknown; bytes?: unknown } | undefined;
      return data && typeof data.content === "string" && typeof data.sha256 === "string" && typeof data.bytes === "number"
        ? { content: data.content, sha256: data.sha256, bytes: data.bytes }
        : null;
    },
    respondMission: async (requestId, decision) => {
      await get().respondRequest(requestId, decision);
    },
    respondRequest: async (requestId, decision) =>
      !!(await command("mission.respond", { requestId, decision }, requestTarget(requestId))),
    revokeBatch: async (missionId, batchId) => {
      await command("mission.revoke_batch", { missionId, batchId }, missionId);
    },
    ackInbox: (id) => {
      void command("inbox.ack", { id });
    },
    configureMissions: (patch) => {
      void command("mission.configure", patch);
    },
    revokeDevice: (id) => {
      void command("device.revoke", { id }, id);
    },
    hydrate: () => {
      if (get().hydrated) return;
      const legacy = load(LEGACY_KEY),
        loaded = load();
      const appearance = { ...DEFAULT_APPEARANCE, ...loaded.appearance };
      if (!loaded.appearance && (loaded.theme ?? legacy.theme))
        appearance.theme = loaded.theme ?? legacy.theme ?? "dark";
      appearance.primary = Array.isArray(appearance.primary)
        ? [...new Set(appearance.primary)]
            .filter((id) =>
              ["codex", "claude", "ollama", "opencode", "cline", "cursor"].includes(id),
            )
            .slice(0, 3)
        : DEFAULT_APPEARANCE.primary;
      set({
        appearance,
        theme:
          appearance.theme === "system"
            ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : appearance.theme,
        drafts: loaded.drafts ?? legacy.drafts ?? [],
        pinnedHostId: loadPin(),
        extensions: loaded.extensions ?? legacy.extensions ?? { cline: false, cursor: false },
        autoSubmit: loaded.autoSubmit ?? false,
        cpuWarn: loaded.cpuWarn ?? 90,
        gpuWarn: loaded.gpuWarn ?? 85,
        hydrated: true,
      });
      const query = new URLSearchParams(window.location.search);
      if (query.get("companion") === "1") set({ sheet: "phone" });
      const views: Record<string, Sheet> = {
        today: "today",
        agents: "agentic",
        agentic: "agentic",
        models: "provider",
        activity: "activity",
        devices: "devices",
        chat: "chat",
        projects: "project",
        system: "system",
        settings: "settings",
        history: "tasks",
        notifications: "extensions",
        compose: "compose",
        constellation: "constellation",
        missions: "agentic",
      };
      const requestedView = query.get("view");
      if (requestedView && views[requestedView]) set({ sheet: views[requestedView] });
      const requestedTheme = query.get("theme");
      if (requestedTheme === "dark" || requestedTheme === "light")
        set({ theme: requestedTheme, appearance: { ...appearance, theme: requestedTheme } });
      const taskId = query.get("task");
      if (taskId) set({ decisionTaskId: taskId, sheet: "task" });
      const missionId = query.get("mission");
      if (missionId) set({ missionFocus: missionId, sheet: "agentic" });
      const agentId = query.get("agent");
      if (agentId) set({ agentFocus: agentId, sheet: "agentic" });
      void get().refreshOllama();
    },
    refreshOllama: async () => {
      if (get().connection.state === "pairing") return;
      if (refreshing) return refreshing;
      const generation = accessGeneration;
      const refreshJob = (async () => {
        try {
          const after = disconnected ? 0 : get().cursor;
          const order = ++requestOrder;
          const read = await withTimeout(readBunnyHost({ data: { after } }), READ_TIMEOUT_MS);
          if (generation !== accessGeneration) return;
          if (!read.ok) return failRead(read);
          const resync = needsCanonicalResync(get().hostInstanceId, read.snapshot, after);
          apply(read.snapshot, after, order, generation);
          if (resync) {
            const canonical = await withTimeout(readBunnyHost({ data: { after: 0 } }), READ_TIMEOUT_MS);
            if (generation !== accessGeneration) return;
            if (canonical.ok) apply(canonical.snapshot, 0, ++requestOrder, generation);
            else failRead(canonical);
          }
        } catch {
          if (generation === accessGeneration) failRead(null);
        }
      })().finally(() => {
        if (refreshing === refreshJob) refreshing = null;
        if (generation === accessGeneration && get().canAct())
          for (const row of get().uncertain) if (!reconciling.has(row.operationId)) void reconcile(row);
      });
      refreshing = refreshJob;
      return refreshing;
    },
    setSheet: (sheet) => set({ sheet }),
    setTheme: (theme) => {
      set({ theme, appearance: { ...get().appearance, theme } });
      save(get());
    },
    setAppearance: (value) => {
      const appearance = { ...get().appearance, ...value };
      appearance.primary = [...new Set(appearance.primary)].slice(0, 3);
      set({
        appearance,
        theme:
          appearance.theme === "system"
            ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : appearance.theme,
      });
      save(get());
    },
    setPrompt: (prompt) => set({ prompt }),
    setMode: (mode) => set({ mode }),
    setAutoRoute: (autoRoute) => set({ autoRoute, override: autoRoute ? "auto" : get().override }),
    setOverride: (override) => set({ override, autoRoute: override === "auto" }),
    setProjectId: (projectId) => set({ projectId }),
    setProviderFocus: (providerFocus) => set({ providerFocus, sheet: "provider" }),
    setFilter: (filter) => set({ filter }),
    setHost: () =>
      get().note("Workstation presence comes from Host connectivity; sleep cannot be simulated."),
    setAutoSubmit: (autoSubmit) => {
      set({ autoSubmit });
      save(get());
    },
    setCpuWarn: (cpuWarn) => {
      void command("thermal.configure", { cpuWarn, gpuWarn: get().gpuWarn, autoStop: false });
    },
    setGpuWarn: (gpuWarn) => {
      void command("thermal.configure", { cpuWarn: get().cpuWarn, gpuWarn, autoStop: false });
    },
    setExtension: (id, on) => {
      set({ extensions: { ...get().extensions, [id]: on } });
      save(get());
      get().note(
        "Optional integration preference saved; installation and readiness come from discovery.",
      );
    },
    addProject: (name, path) => {
      void command("project.add", { name, path });
    },
    projectCommand: async (action, data) => {
      const result = await command(action, data);
      return result?.data ?? null;
    },
    removeProject: (id) => {
      void command("project.remove", { id });
    },
    dismissNotice: () => set({ notice: null }),
    note: (line) => set({ notice: line }),
    pushSample: (sample) => set({ samples: [...get().samples, sample].slice(-40) }),
    submit: () => {
      const { prompt, mode, projectId, autoRoute, override, localOnly } = get();
      if (!prompt.trim() || get().submitting) return;
      if (get().host !== "online") {
        get().note(
          get().pairingRequired
            ? "Pair this device first: open Phone and enter the one-time code from your workstation."
            : "Bunny-A Host is unreachable. Your task remains an unsent draft.",
        );
        return;
      }
      set({ submitting: true });
      if (get().composeKind === "mission" && get().missions?.enabled) {
        void command("mission.create", { objective: prompt.trim(), mode, projectId, localOnly })
          .then((result) => {
            const mission = result?.mission;
            if (mission) set({ prompt: "", missionFocus: mission.id, sheet: "today" });
          })
          .finally(() => set({ submitting: false }));
        return;
      }
      void command("submit", {
        prompt: prompt.trim(),
        mode,
        projectId,
        override: autoRoute ? "auto" : override,
        constraints: { localOnly },
      })
        .then((result) => {
          if (result?.task) set({ prompt: "", decisionTaskId: result.task.id, sheet: "decision" });
        })
        .finally(() => set({ submitting: false }));
    },
    queueDraft: () => {
      const { prompt, mode, projectId, drafts } = get();
      if (!prompt.trim()) return;
      set({
        drafts: [
          ...drafts,
          {
            id: crypto.randomUUID(),
            prompt: prompt.trim(),
            mode,
            projectId,
            createdAt: Date.now(),
          },
        ],
        prompt: "",
        sheet: "phone",
      });
      save(get());
      get().note(
        "Draft saved on this device. Review and route it when your workstation is available.",
      );
    },
    reviewDraft: (id) => {
      const draft = get().drafts.find((d) => d.id === id);
      if (draft)
        set({
          prompt: draft.prompt,
          mode: draft.mode,
          projectId: draft.projectId,
          sheet: "compose",
        });
    },
    removeDraft: (id) => {
      set({ drafts: get().drafts.filter((d) => d.id !== id) });
      save(get());
    },
    sendDrafts: () => {
      const draft = get().drafts[0];
      if (draft) get().reviewDraft(draft.id);
    },
    run: async (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (
        task?.provider === "ollama" &&
        /:cloud$/i.test(task.model) &&
        (task.constraints?.localOnly || task.constraints?.offlineOnly)
      ) {
        get().note(
          "This cloud model conflicts with your local-only constraint. Change the route or cancel.",
        );
        return;
      }
      await command("approve", { id }, id);
    },
    stop: async (id) => {
      await command("stop", { id }, id);
    },
    pause: () => get().note("Pause unsupported by these executors."),
    resume: () => get().note("Live resume unsupported; route a new task for review."),
    restart: (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (task)
        set({
          prompt: task.prompt,
          mode: task.mode,
          projectId: task.projectId,
          autoRoute: !task.manual,
          override: task.manual ? task.provider : "auto",
          sheet: "compose",
        });
    },
    retarget: (id, provider) => {
      void command("retarget", { id, provider });
    },
    feedback: (id, value) => {
      void command("task.feedback", { id, value });
    },
    openDecision: (decisionTaskId) => set({ decisionTaskId, sheet: "decision" }),
    createPairCode: () => {
      void command("pairing.create", {}).then((result) =>
        set({ pairCode: result?.pairCode ?? null }),
      );
    },
    setLocalOnly: (localOnly) => set({ localOnly }),
  };
});
export function activeTasks(tasks: OrchTask[]) {
  return tasks.filter((task) => ACTIVE.includes(task.state));
}
