import { useEffect, useRef, useState } from "react";
import { deviceStatusPresentation, projectDeviceDiagnostics } from "@/lib/bunny-host/ma4/native-notifications";
import { useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { ThemedDialogContent, useAmbient, useDocumentTheme, useThemeScope } from "./theme";
import {
  Activity,
  Bot,
  Cpu,
  FileText,
  Folder,
  Gauge,
  Layers,
  LayoutGrid,
  ListChecks,
  Menu,
  MessageSquare,
  Moon,
  PenLine,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { liveProviders, useIsland, type Sheet } from "@/store/use-island";
import {
  BunnyMark,
  Empty,
  HostHealthWarning,
  NAMES,
  Notice,
  ProviderFacts,
  ProviderMark,
  ProviderStatus,
} from "./ui";
import { Approval, TaskDetail } from "./task";
import { TaskRow, Notifications } from "./desktop";
import { Projects } from "./projects";
import { AgenticWorkspace } from "./agentic";
import { ActivityRow } from "./activity";
import { Settings } from "./settings";
import { Pairing, Phone } from "./phone";
import { FabricWorkspace } from "./fabric";
import { Telemetry } from "./telemetry";
import { useHostStream } from "./host-stream";
import { filteredActivities, returnFocusTo, type ActivityFilters } from "./workspace-model";
import { CONNECTION_LABEL, freshnessLabel, pairingReason } from "./connection-model";
import {
  attentionCount,
  attentionLabel,
  isDevice,
  rightsSummary,
  shortId,
  WORKSTATION_CAPTION,
} from "./remote-view-model";
import { ChatHome } from "./chat-home";
import { Approvals } from "./approvals";
import { Files } from "./files";
import { ContextPanel } from "./context-panel";
import { DesignPreview } from "./design-preview";
import { ThemePreviewBar } from "./theme-gallery";
import { useReconcileItems } from "./reconciliation";
import { BunnyCompanion, usePrefersReducedMotion, useHappyWindow } from "./characters";
import { hostLive } from "./character-model";
import { approvalCount, pendingApprovalItems } from "./approvals-model";
import { COMPANION_LABEL, resolveCompanion } from "./companion-model";
import { activeNavView, deepLinkFromSearch, NAV_ADVANCED, NAV_PRIMARY, type NavView } from "./nav-model";
import { WidgetSurface, type WidgetOpeners } from "./widgets";
import {
  AgentsHome,
  CharactersHome,
  IslandStatus,
  Onboarding,
  StudioHome,
  TasksHome,
  TeamsHome,
  WidgetsPage,
} from "./surfaces";

import "./premium.css";
import "./glass.css";

const FOCUS_KEY = "bunny-a.focus.v1";

/** Focus mode hides advanced navigation and the context panel. It does not stop Host work. */
function useFocusMode(): [boolean, (next: boolean) => void] {
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    try {
      setFocus(sessionStorage.getItem(FOCUS_KEY) === "1");
    } catch {
      /* Private mode can refuse storage. Focus still works for this visit. */
    }
  }, []);
  const update = (next: boolean) => {
    setFocus(next);
    try {
      sessionStorage.setItem(FOCUS_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return [focus, update];
}

const NAV_ICONS: Record<NavView, LucideIcon> = {
  chat: MessageSquare,
  tasks: ListChecks,
  missions: Layers,
  teams: Users,
  agents: Bot,
  studio: PenLine,
  widgets: LayoutGrid,
  characters: Sparkles,
  projects: Folder,
  files: FileText,
  approvals: ShieldCheck,
  activity: Activity,
  telemetry: Gauge,
  settings: Settings2,
  models: Cpu,
  devices: Smartphone,
  server: Server,
  "design-preview": Settings2,
};

export function Island() {
  const store = useIsland();
  const [now, setNow] = useState(0);
  const [menu, setMenu] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [focus, setFocus] = useFocusMode();
  // Router search is available on the first server and client paint — no post-hydrate flash of the desktop shell.
  const companion = useRouterState({
    select: (state) => deepLinkFromSearch(state.location.searchStr).companion,
  });
  const hydrate = store.hydrate;
  const widgetOpeners: WidgetOpeners = {
    mission: (id) => { store.openMission(id); store.setSheet("missions"); },
    agent: (slot) => {
      void store.personalAgentCommand("personal_agent.foreground", { identity: slot as 1 | 2 | 3 | 4 });
      store.setSheet("agents");
    },
    usage: () => store.setSheet("provider"),
    memory: () => store.setSheet("agents"),
    reconcile: () => store.setSheet("approvals"),
  };
  const widgetLayout = store.shownWidgets().layout;
  const scope = useThemeScope();
  const ambient = useAmbient();
  useDocumentTheme();
  useHostStream();
  useEffect(() => {
    hydrate();
    setNow(Date.now());
  }, [hydrate]);
  // The clock causes expiry renders; each incoming Host event is evaluated with that render's current time.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!store.notice) return;
    const timer = setTimeout(store.dismissNotice, 6500);
    return () => clearTimeout(timer);
  }, [store.notice, store.dismissNotice]);
  useEffect(() => {
    // A theme on "system" follows the OS light/dark choice; the theme engine re-resolves which variant to show.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => useIsland.getState().refreshTheme();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMenu(false);
    if (NAV_ADVANCED.some((item) => item.view === activeNavView(store.sheet))) setAdvancedOpen(true);
  }, [store.sheet]);
  const page = store.sheet ?? "chat";
  const active = activeNavView(page);
  const navigate = (sheet: Sheet) => {
    if (sheet === "chat") store.setComposeKind("task");
    store.setSheet(sheet);
    setMenu(false);
  };
  const health = !store.connectionChecked
    ? "Connecting to Host"
    : store.pairingRequired
      ? "Pairing required"
      : store.host !== "online"
        ? "Host unavailable"
        : store.hostHealth?.operationalState && store.hostHealth.operationalState !== "healthy"
          ? `Host ${store.hostHealth.operationalState}`
          : "Host connected";
  const task = store.tasks.find((row) => row.id === store.decisionTaskId);
  const viewer = store.viewer?.kind === "device" ? "device" : "workstation";
  const approvals = approvalCount(
    pendingApprovalItems({
      tasks: store.tasks,
      missions: store.missions?.missions ?? [],
      agents: store.agents?.agents ?? [],
      viewer,
    }),
  );
  // Uncertain outcomes waiting for the owner's review count as Approvals work too.
  const paused = useReconcileItems().length;
  const attention = attentionCount(store.agents?.agents ?? [], store.missions?.missions ?? []);
  const connection = store.connection.state;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Keep the first server/client render deterministic, then use actual render time. A newly received interruption
  // must not be compared with the previous 2 s tick and mistaken for a receipt from the future.
  const renderNow = now === 0 ? 0 : Date.now();
  const freshness = freshnessLabel(store.connection.snapshotAt, renderNow, clock);
  // OS reduced-motion always wins, and so does any Motion setting other than Full (Settings promises both).
  const systemReduced = usePrefersReducedMotion();
  const reduced = systemReduced || store.appearance.motion !== "full";
  // The companion: the Host's voice truth, the connection and any verified Personal Agent result, decided by companion-model.
  const happyUntil = useHappyWindow(store.personalAgents?.slots ?? null, renderNow, hostLive(store.connection, renderNow));
  const bunny = resolveCompanion({
    now: renderNow,
    connection: store.connection,
    voice: store.voice,
    voiceReceivedAt: store.voiceReceivedAt || null,
    happyUntil,
    reduced,
  });
  if (companion) {
    // `?companion=1` is the full-screen, touch-first companion (Phone), on every surface link.
    return (
      <div className="bunny-app t8-app" {...scope} data-ambient={ambient} data-surface="companion">
        <a href="#bunny-content" className="skip-link">
          Skip to content
        </a>
        <main id="bunny-content" className="workspace-content" tabIndex={-1}>
          <Phone now={now} />
        </main>
        <Notice />
      </div>
    );
  }
  return (
    <div className="bunny-app t8-app" {...scope} data-ambient={ambient} data-menu={menu} data-focus={focus ? "true" : "false"}>
      <a href="#bunny-content" className="skip-link">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <button className="brand-button" onClick={() => navigate("chat")}>
            <BunnyMark />
            <span>BunnyA</span>
          </button>
          <span className="mobile-header-actions">
            {attention > 0 && (
              <button
                className="mobile-attention"
                aria-label={attentionLabel(attention)}
                onClick={() => navigate("missions")}
              >
                <ShieldCheck size={16} />
                <span>{attention}</span>
              </button>
            )}
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              aria-controls="primary-navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
          </span>
        </div>
        <nav id="primary-navigation" aria-label="Primary navigation">
          {NAV_PRIMARY.map(({ view, sheet, label }) => {
            const Icon = NAV_ICONS[view];
            return (
              <button key={view} aria-current={active === view ? "page" : undefined} onClick={() => navigate(sheet)}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="nav-group-label"
            aria-expanded={advancedOpen}
            aria-controls="advanced-navigation"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            Advanced
          </button>
          {advancedOpen && (
            <div id="advanced-navigation" className="nav-advanced">
              {NAV_ADVANCED.map(({ view, sheet, label }) => {
                const Icon = NAV_ICONS[view];
                const count = view === "approvals" ? approvals + paused : view === "missions" ? attention : 0;
                return (
                  <button key={view} aria-current={active === view ? "page" : undefined} onClick={() => navigate(sheet)}>
                    <Icon size={18} />
                    <span>{label}</span>
                    {count > 0 && <span className="nav-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <p className="caption">Work stays with your Host.</p>
          <div>
            <span className="connection-dot" data-online={store.host === "online"} />
            <span>{health}</span>
          </div>
          <button
            className="quiet-button"
            onClick={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
            aria-label={store.theme === "dark" ? "Light appearance: switch theme" : "Dark appearance: switch theme"}
          >
            {store.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span>{store.theme === "dark" ? "Light appearance" : "Dark appearance"}</span>
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <span className="topbar-companion">
            <BunnyCompanion state={bunny.state} level={bunny.level} size="compact" reduced={reduced} label={`Bunny is ${COMPANION_LABEL[bunny.state]}`} />
            <IslandStatus now={now} />
          </span>
          <div>
            <span className="stream-indicator" role="status" data-connection={connection}>
              {connection === "live" || connection === "polling"
                ? `${CONNECTION_LABEL[connection]} · ${freshness}`
                : CONNECTION_LABEL[connection]}
            </span>
            <button type="button" className="quiet-button" aria-pressed={focus} onClick={() => setFocus(!focus)}>
              {focus ? "Show navigation" : "Focus"}
            </button>
            <button
              className="icon-button"
              aria-label="Refresh Host state"
              onClick={() => void store.refreshOllama()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <HostHealthWarning />
        <ThemePreviewBar />
        <ConnectionBanner freshness={freshness} />
        {store.syncStatus && (
          <p className="sync-message" role="status">
            {store.syncStatus}
          </p>
        )}
        <div className="workspace-split">
          <main id="bunny-content" className="workspace-content" tabIndex={-1}>
            {page === "missions" || page === "agentic" ? (
              <AgenticWorkspace />
            ) : page === "teams" ? (
              <TeamsHome />
            ) : page === "agents" ? (
              <AgentsHome now={now} />
            ) : page === "studio" ? (
              <StudioHome />
            ) : page === "characters" ? (
              <CharactersHome now={now} />
            ) : page === "widgets" ? (
              <WidgetsPage openers={widgetOpeners} />
            ) : page === "tasks" ? (
              <TasksHome now={now} />
            ) : page === "project" ? (
              <Projects />
            ) : page === "files" ? (
              <Files />
            ) : page === "approvals" ? (
              <Approvals />
            ) : page === "provider" ? (
              <ModelsWorkspace />
            ) : page === "activity" ? (
              <ActivityWorkspace now={now} />
            ) : page === "settings" ? (
              <Settings />
            ) : page === "devices" || page === "phone" ? (
              <DevicesWorkspace />
            ) : page === "fabric" ? (
              <FabricWorkspace now={now} freshness={freshness} />
            ) : page === "system" ? (
              <Telemetry />
            ) : page === "task" ? (
              <TaskDetail now={now} />
            ) : page === "extensions" ? (
              <Notifications now={now} />
            ) : page === "design-preview" ? (
              <DesignPreview />
            ) : page === "decision" && task?.state === "waiting_for_approval" ? (
              <div className="t8-surface">
                <Approval task={task} />
              </div>
            ) : (
              <>
                <Onboarding onOpenDevices={() => store.setSheet("devices")} />
                <ChatHome now={now} />
              </>
            )}
            {widgetLayout === "board" && page !== "widgets" && <WidgetSurface mode="board" page={page} openers={widgetOpeners} />}
          </main>
          {widgetLayout === "sidebar" && <WidgetSurface mode="sidebar" page={page} openers={widgetOpeners} />}
          {page !== "design-preview" && <ContextPanel now={now} />}
        </div>
        {widgetLayout === "drawer" && <WidgetSurface mode="drawer" page={page} openers={widgetOpeners} />}
        <footer className="workspace-footer">
          <span>Bunny-A</span>
          <span>Host authority · independently verified results</span>
        </footer>
      </div>
      <Notice />
    </div>
  );
}
/**
 * M-A-3 T9 connection truth for the whole shell. Retained data is labelled stale with its real time;
 * controls are paused by the store until a fresh canonical view arrives. Work on the Host continues
 * regardless of this device's connection.
 */
function ConnectionBanner({ freshness }: { freshness: string }) {
  const store = useIsland();
  const state = store.connection.state;
  if (state === "pairing")
    return (
      <div className="connection-banner" data-state="pairing" role="status">
        <div className="offline-banner">
          <WifiOff size={18} />
          <span>
            <strong>This device needs pairing.</strong>
            <small>{pairingReason(store.connection.pairingCode)} Agents keep running on your Windows Host.</small>
          </span>
        </div>
        <Pairing compact />
      </div>
    );
  if (state === "host-changed")
    return (
      <div className="offline-banner connection-banner" data-state="host-changed" role="alert">
        <ShieldCheck size={18} />
        <span>
          <strong>This is a different Bunny-A Host.</strong>
          <small>
            This device was paired with Host {shortId(store.pinnedHostId)}; the address now answers as Host{" "}
            {shortId(store.hostIdentity?.hostId)}. Controls stay off until you confirm this is your computer.
          </small>
        </span>
        <button className="btn secondary" onClick={() => store.trustHost()}>
          Trust this Host
        </button>
      </div>
    );
  if (state !== "reconnecting" && state !== "offline") return null;
  return (
    <div className="offline-banner connection-banner" data-state={state} role="status">
      <WifiOff size={18} />
      <span>
        <strong>{state === "offline" ? "Offline" : "Reconnecting to your Host…"}</strong>
        <small>
          {freshness} — controls are paused. Shown state may be out of date; Agents keep running on the Host.
        </small>
      </span>
      <button className="btn secondary" onClick={() => void store.refreshOllama()}>
        Reconnect
      </button>
    </div>
  );
}
function ModelsWorkspace() {
  const store = useIsland();
  const [busy, setBusy] = useState(false);
  const providers = liveProviders(store).filter((row) => !row.extension || row.installed);
  const fact = (value: boolean | null | undefined) =>
    value == null ? "UNKNOWN" : value ? "Supported" : "Not supported";
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Discovery & usage truth</p>
          <h1>Models</h1>
          <p>Capabilities from discovery. Usage from supported observations.</p>
        </div>
        <button
          className="btn secondary"
          disabled={busy || store.host !== "online"}
          onClick={async () => {
            setBusy(true);
            try {
              // Discovery re-probes providers on the workstation; a paired device only re-reads Host state.
              if (!isDevice(store.viewer)) await store.projectCommand("discover", {});
              await store.refreshOllama();
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={16} />
          {busy ? "Refreshing…" : isDevice(store.viewer) ? "Refresh" : "Refresh discovery"}
        </button>
      </div>
      <div className="models-list">
        {providers.map((provider) => {
          const catalogue = store.modelCapabilities?.providers.find(
            (row) => row.provider === provider.id,
          );
          return (
            <section className="t8-surface model-provider" key={provider.id}>
              <header>
                <ProviderMark provider={provider} />
                <div>
                  <h2>{NAMES[provider.id]}</h2>
                  <p className="caption">
                    {provider.local_or_cloud === "local"
                      ? "Local service; individual models may be hosted"
                      : "Hosted provider"}
                  </p>
                </div>
                <ProviderStatus provider={provider} />
              </header>
              <div className="model-provider-body">
                <div className="provider-usage">
                  <h3>Provider usage</h3>
                  <ProviderFacts provider={provider} />
                  <p className="caption">
                    Locally observed Tasks are separate from provider quota.
                  </p>
                </div>
                <div className="discovered-models">
                  <h3>Discovered models</h3>
                  {catalogue?.models.length ? (
                    catalogue.models.slice(0, 100).map((model) => (
                      <article className="model-record" key={model.model}>
                        <strong>{model.model}</strong>
                        <span className="caption">
                          {model.local ? "Local inference" : "Hosted"} ·{" "}
                          {model.loaded == null
                            ? "Loaded state UNKNOWN"
                            : model.loaded
                              ? "Loaded"
                              : "Not loaded"}
                        </span>
                        <dl className="fact-list">
                          <div>
                            <dt>Tool calling</dt>
                            <dd>{fact(model.toolCalling)}</dd>
                          </div>
                          <div>
                            <dt>Vision</dt>
                            <dd>{fact(model.vision)}</dd>
                          </div>
                          <div>
                            <dt>Embeddings</dt>
                            <dd>{fact(model.embedding)}</dd>
                          </div>
                          <div>
                            <dt>Context window</dt>
                            <dd>{model.contextWindow ?? "UNKNOWN"}</dd>
                          </div>
                        </dl>
                        <p className="caption">
                          {model.source} · observed {new Date(model.probedAt).toLocaleString()}
                          {!catalogue.probedThisRun ? " · Retained from an earlier Host" : ""}
                        </p>
                      </article>
                    ))
                  ) : (
                    <div className="model-record">
                      <strong>Provider Default — Exact model unknown</strong>
                      <p className="caption">
                        No individual model catalogue is available from this Host. Capabilities
                        remain UNKNOWN.
                      </p>
                    </div>
                  )}
                  <p className="caption">
                    Routing selects an eligible candidate per Task. Projects do not own a fixed
                    model.
                  </p>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
function ActivityWorkspace({ now }: { now: number }) {
  const store = useIsland();
  const [filters, setFilters] = useState<ActivityFilters>({
    project: "",
    agent: "",
    mission: "",
    task: "",
    status: "",
    provider: "",
    date: "",
  });
  const [offset, setOffset] = useState(0);
  const [showTasks, setShowTasks] = useState(false);
  const rows = filteredActivities(
    store.activities,
    filters,
    store.tasks,
    store.missions?.missions ?? [],
    store.agents?.agents ?? [],
  );
  const choice = (
    key: keyof ActivityFilters,
    label: string,
    options: { id: string; name: string }[],
  ) => (
    <label>
      {label}
      <select
        value={filters[key]}
        onChange={(event) => {
          setFilters({ ...filters, [key]: event.target.value });
          setOffset(0);
        }}
      >
        <option value="">All</option>
        {options.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Canonical execution history</p>
          <h1>Activity</h1>
          <p>Actual operations, permission boundaries and verification outcomes.</p>
        </div>
      </div>
      <div className="activity-filters">
        {choice("project", "Project", store.projects)}
        {choice("agent", "Agent", store.agents?.agents ?? [])}
        {choice(
          "mission",
          "Mission",
          (store.missions?.missions ?? []).map((row) => ({ id: row.id, name: row.title })),
        )}
        {choice(
          "task",
          "Task",
          store.tasks.map((row) => ({ id: row.id, name: row.title })),
        )}
        {choice(
          "status",
          "Status",
          [...new Set(store.activities.map((row) => row.state))].map((row) => ({
            id: row,
            name: row,
          })),
        )}
        {choice(
          "provider",
          "Provider",
          liveProviders(store).map((row) => ({ id: row.id, name: NAMES[row.id] })),
        )}
        <label>
          Date
          <input
            type="date"
            value={filters.date}
            onChange={(event) => {
              setFilters({ ...filters, date: event.target.value });
              setOffset(0);
            }}
          />
        </label>
      </div>
      <div className="t8-surface activity-workspace">
        <ol className="activity-timeline">
          {rows.slice(offset, offset + 30).map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ol>
        {!rows.length && (
          <Empty
            title="No matching activity."
            detail="Change your filters. Only bounded, privacy-safe Host history appears here."
          />
        )}
      </div>
      <div className="project-pagination">
        <span>{rows.length} matching events · up to 240 retained in this projection</span>
        <button
          className="btn quiet"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          Previous
        </button>
        <button
          className="btn quiet"
          disabled={offset + 30 >= rows.length}
          onClick={() => setOffset(offset + 30)}
        >
          Next
        </button>
      </div>
      <section className="t8-section">
        <div className="section-heading">
          <h2>Task history</h2>
          <button className="quiet-button" onClick={() => setShowTasks(!showTasks)}>
            {showTasks ? "Hide" : "Show retained Tasks"}
          </button>
        </div>
        {showTasks && (
          <div className="task-list t8-surface">
            {store.tasks.slice(0, 60).map((task) => (
              <TaskRow key={task.id} task={task} now={now} />
            ))}
            {!store.tasks.length && <p className="t8-empty-copy">No model Tasks retained.</p>}
          </div>
        )}
      </section>
    </>
  );
}
function DevicesWorkspace() {
  const store = useIsland();
  const [signingOut, setSigningOut] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const viewer = store.viewer;
  const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "Not recorded");
  const identity = store.hostIdentity;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Trusted connections</p>
          <h1>Devices</h1>
          <p>Who can reach this Host, and what each connection may do.</p>
        </div>
      </div>
      <section className="t8-surface current-device">
        <Smartphone size={22} />
        <div>
          <h2>{viewer?.kind === "device" ? viewer.name : "This workstation"}</h2>
          <p>
            {CONNECTION_LABEL[store.connection.state]}
            {viewer?.kind === "device" ? " · Paired device" : viewer ? " · Windows Host owner" : ""}
          </p>
          <dl className="fact-list">
            <div>
              <dt>Host</dt>
              <dd>
                {identity
                  ? `${shortId(identity.hostId)} · running since ${new Date(identity.startedAt).toLocaleString()}`
                  : "Unknown until the Host answers"}
              </dd>
            </div>
            {viewer?.kind === "device" && (
              <>
                <div>
                  <dt>Paired</dt>
                  <dd>{when(viewer.pairedAt)}</dd>
                </div>
                <div>
                  <dt>Session expires</dt>
                  <dd>{when(viewer.expiresAt)}</dd>
                </div>
                <div>
                  <dt>Last seen by the Host</dt>
                  <dd>{when(viewer.lastSeenAt)}</dd>
                </div>
              </>
            )}
          </dl>
          {viewer?.kind === "device" && (
            <>
              <h3 className="eyebrow">This device may</h3>
              <ul className="rights-list">
                {rightsSummary(viewer).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="caption">
                Creating Agents, first starts, scope changes, pairing and settings are {WORKSTATION_CAPTION.toLowerCase()}.
              </p>
              <button
                className="btn danger"
                onClick={(event) => {
                  dialogOpener.current = event.currentTarget;
                  setSigningOut(true);
                }}
              >
                Sign out this phone
              </button>
            </>
          )}
        </div>
      </section>
      {viewer?.kind !== "device" && (
        <>
          <Pairing />
          {store.devices.length ? (
            <section className="t8-surface paired-devices">
              <h2>Paired devices</h2>
              {store.devices.map((device) => {
                const diag = projectDeviceDiagnostics({ ...device, revoked: device.revoked === true }, Date.now());
                const status = deviceStatusPresentation(diag);
                const guidance = status.label === "Revoked"
                  ? "This phone can no longer supervise tasks. Pairing again needs a new code."
                  : status.label === "Pairing expired"
                    ? "The pairing lifetime ended. Create a new code on this PC."
                    : status.label === "Offline"
                      ? "Bunny-A has not heard from this phone recently. Open the app while this computer is reachable."
                      : status.label === "Reconnecting"
                        ? "The phone is trying to reach this Host again."
                        : "The phone can supervise tasks the Host allows.";
                return (
                <div className="paired-device-row" key={device.id}>
                  <Smartphone size={16} />
                  <span>
                    <strong className="wrap-anywhere">{diag.name}</strong>
                    <small>
                      {status.label} · authority {status.authority} · observed {status.observed} · last seen {when(diag.lastSeenAt)} · pairing ends {when(diag.expiresAt)}
                    </small>
                    <small>{guidance}</small>
                  </span>
                  {status.label === "Revoked" ? <span className="caption">Revoked</span> : (
                  <button
                    className="btn quiet danger-text"
                    disabled={!store.canAct()}
                    onClick={(event) => {
                      dialogOpener.current = event.currentTarget;
                      setRevoking({ id: device.id, name: device.name });
                    }}
                  >
                    Revoke access
                  </button>
                  )}
                </div>
                );
              })}
            </section>
          ) : null}
        </>
      )}
      <Dialog.Root open={signingOut} onOpenChange={setSigningOut}>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <ThemedDialogContent className="t8-dialog" onCloseAutoFocus={returnFocusTo(dialogOpener)}>
            <Dialog.Title>Sign out this phone?</Dialog.Title>
            <Dialog.Description>
              This phone revokes its own access on the Host and forgets its session. Agents keep running on
              your Windows Host. Pairing again needs a new code from the workstation.
            </Dialog.Description>
            <div className="actions">
              <Dialog.Close asChild>
                <button className="btn secondary">Stay signed in</button>
              </Dialog.Close>
              <button
                className="btn danger"
                onClick={async () => {
                  setSigningOut(false);
                  await store.signOutDevice();
                }}
              >
                Sign out
              </button>
            </div>
          </ThemedDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <ThemedDialogContent className="t8-dialog" onCloseAutoFocus={returnFocusTo(dialogOpener)}>
            <Dialog.Title>Revoke {revoking?.name}?</Dialog.Title>
            <Dialog.Description>
              The device loses access immediately and its open activity streams close. Approval batches it
              created and Agent consent it approved end, and those Agents stop. Completed work stays.
            </Dialog.Description>
            <div className="actions">
              <Dialog.Close asChild>
                <button className="btn secondary">Keep access</button>
              </Dialog.Close>
              <button
                className="btn danger"
                onClick={() => {
                  const target = revoking;
                  setRevoking(null);
                  if (target) store.revokeDevice(target.id);
                }}
              >
                Revoke access
              </button>
            </div>
          </ThemedDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
