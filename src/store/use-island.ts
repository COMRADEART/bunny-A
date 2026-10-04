import { create } from "zustand";
import { commandBunnyHost, readBunnyHost } from "@/lib/orch/host";
import type { HostEvent, HostSnapshot, PerformanceProfile } from "@/lib/bunny-host/contracts";
import type { MissionSnapshot } from "@/lib/bunny-missions/types";
import type { OperationalHealth } from "@/lib/bunny-host/failure.server";
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
  performance: PerformanceProfile[];
  remoteConfigured: boolean;
  remoteUrl: string | null;
  devices: { id: string; name: string; createdAt: number }[];
  revokeDevice: (id: string) => void;
  pairCode: string | null;
  localOnly: boolean;
  /** Host-owned mission state (null until a Host that knows missions answers). */
  missions: MissionSnapshot | null;
  composeKind: "task" | "mission";
  missionFocus: string | null;
  setComposeKind: (kind: "task" | "mission") => void;
  openMission: (id: string | null) => void;
  approveMission: (id: string) => Promise<void>;
  stopMission: (id: string) => Promise<void>;
  retryMission: (id: string) => Promise<void>;
  respondMission: (requestId: string, decision: "allow_once" | "deny") => Promise<void>;
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
let migrationAttempted = false;
export const useIsland = create<Island>((set, get) => {
  const apply = (snapshot: HostSnapshot) => {
    const ollama = snapshot.providers.find((p) => p.id === "ollama");
    // The first snapshot only seeds the cursor: replaying history would notify about long-finished tasks.
    const previous = get().cursor;
    const fresh = get().hydratedFromHost
      ? snapshot.events.filter((event) => event.sequence > previous)
      : [];
    set({
      hostHealth:snapshot.health ?? null,
      remoteUrl: snapshot.remoteUrl ?? null,
      devices: snapshot.devices ?? [],
      events: snapshot.events,
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
      cursor: Math.max(previous, snapshot.cursor),
      performance: snapshot.performance,
      remoteConfigured: snapshot.remoteConfigured,
      missions: snapshot.missions ?? null,
      cpuWarn: snapshot.thermal?.cpuWarn ?? 90,
      gpuWarn: snapshot.thermal?.gpuWarn ?? 85,
      ollamaUp: ollama?.availability === "ready" || ollama?.availability === "busy",
      ollamaModels: ollama?.current_model ? [ollama.current_model] : [],
      audit: snapshot.events
        .slice(-80)
        .reverse()
        .map((e) => ({ at: e.at, line: `${e.type}: ${e.detail}` })),
    });
    for (const event of fresh)
      if (
        // A mission's child tasks are approved and reported by the mission itself.
        !(event.missionId && ["approval.required", "task.completed", "task.failed"].includes(event.type)) &&
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
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        )
          new Notification("Bunny-A", {
            body: event.type === "thermal.warning" ? event.detail : event.type.replaceAll(".", " "),
            tag: event.taskId ?? event.missionId ?? event.type,
          });
      }
  };
  const command = async (action: string, data: Record<string, unknown>) => {
    try {
      const result = await commandBunnyHost({ data: { action, data } });
      apply(result.snapshot);
      return result;
    } catch (error) {
      get().note(error instanceof Error ? error.message : "Host command failed.");
      return null;
    }
  };
  return {
    theme: "dark",
    appearance: DEFAULT_APPEARANCE,
    submitting: false,
    events: [],
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
    performance: [],
    remoteConfigured: false,
    pairCode: null,
    localOnly: false,
    remoteUrl: null,
    devices: [],
    missions: null,
    hostHealth:null,
    composeKind: "task",
    missionFocus: null,
    setComposeKind: (composeKind) => set({ composeKind }),
    openMission: (missionFocus) => set({ missionFocus }),
    approveMission: async (id) => {
      await command("mission.approve", { id });
    },
    stopMission: async (id) => {
      await command("mission.stop", { id });
    },
    retryMission: async (id) => {
      await command("mission.retry", { id });
    },
    respondMission: async (requestId, decision) => {
      await command("mission.respond", { requestId, decision });
    },
    ackInbox: (id) => {
      void command("inbox.ack", { id });
    },
    configureMissions: (patch) => {
      void command("mission.configure", patch);
    },
    revokeDevice: (id) => {
      void command("device.revoke", { id });
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
        agents: "provider",
        projects: "project",
        system: "system",
        settings: "settings",
        history: "tasks",
        notifications: "extensions",
        compose: "compose",
        constellation: "constellation",
      };
      const requestedView = query.get("view");
      if (requestedView && views[requestedView]) set({ sheet: views[requestedView] });
      const requestedTheme = query.get("theme");
      if (requestedTheme === "dark" || requestedTheme === "light")
        set({ theme: requestedTheme, appearance: { ...appearance, theme: requestedTheme } });
      const taskId = query.get("task");
      if (taskId) set({ decisionTaskId: taskId, sheet: "task" });
      void get().refreshOllama();
    },
    refreshOllama: async () => {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          const snapshot = await readBunnyHost({ data: { after: 0 } });
          apply(snapshot);
          if (!migrationAttempted) {
            migrationAttempted = true;
            const legacy = load(LEGACY_KEY);
            if (legacy.tasks?.length || legacy.projects?.length)
              await command("legacy.import", {
                tasks: legacy.tasks ?? [],
                projects: legacy.projects ?? [],
              });
          }
        } catch (error) {
          set({
            host: "offline",
            connectionChecked: true,
            pairingRequired: error instanceof Error && error.message.includes("Pair this device"),
          });
        }
      })().finally(() => {
        refreshing = null;
      });
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
      await command("approve", { id });
    },
    stop: async (id) => {
      await command("stop", { id });
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
