import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Folder,
  Home,
  Menu,
  MessageSquare,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sun,
  WifiOff,
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
import { Composer, Approval, Routing, TaskDetail } from "./task";
import { TaskRow, Notifications } from "./desktop";
import { Projects } from "./projects";
import { AgenticWorkspace, AgentState, openAgent } from "./agentic";
import { ActivityRow, ActivityTimeline } from "./activity";
import { Settings } from "./settings";
import { Pairing, Phone } from "./phone";
import { Telemetry } from "./telemetry";
import { useHostStream } from "./host-stream";
import { attentionRequired, filteredActivities, type ActivityFilters } from "./workspace-model";
import { CONNECTION_LABEL, freshnessLabel, pairingReason } from "./connection-model";
import {
  attentionCount,
  attentionLabel,
  isDevice,
  rightsSummary,
  shortId,
  WORKSTATION_CAPTION,
} from "./remote-view-model";

import "./premium.css";

const NAV = [
  { id: "today", label: "Home", icon: Home },
  { id: "agentic", label: "Agentic", icon: Bot },
  { id: "project", label: "Projects", icon: Folder },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "provider", label: "Models", icon: Cpu },
  { id: "devices", label: "Devices", icon: Smartphone },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
export function Island() {
  const store = useIsland();
  const [now, setNow] = useState(0);
  const [menu, setMenu] = useState(false);
  const [companion, setCompanion] = useState(false);
  const hydrate = store.hydrate;
  useHostStream();
  useEffect(() => {
    hydrate();
    setNow(Date.now());
    setCompanion(new URLSearchParams(window.location.search).get("companion") === "1");
  }, [hydrate]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!store.notice) return;
    const timer = setTimeout(store.dismissNotice, 6500);
    return () => clearTimeout(timer);
  }, [store.notice, store.dismissNotice]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (useIsland.getState().appearance.theme === "system")
        useIsland.setState({ theme: query.matches ? "dark" : "light" });
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMenu(false);
  }, [store.sheet]);
  const page = store.sheet ?? "today";
  const active =
    page === "task" || page === "tasks"
      ? "activity"
      : page === "phone"
        ? "devices"
        : page === "system"
          ? "settings"
          : page;
  const navigate = (sheet: Sheet) => {
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
  const attention = attentionCount(store.agents?.agents ?? [], store.missions?.missions ?? []);
  const connection = store.connection.state;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const freshness = freshnessLabel(store.connection.snapshotAt, now || Date.now(), clock);
  return (
    <div
      className="bunny-app t8-app"
      data-theme={store.theme}
      data-motion={store.appearance.motion}
      data-menu={menu}
    >
      <a href="#bunny-content" className="skip-link">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <button className="brand-button" onClick={() => navigate("today")}>
            <BunnyMark />
            <span>
              Bunny<span className="brand-suffix">A</span>
            </span>
          </button>
          <span className="mobile-header-actions">
            {attention > 0 && (
              <button
                className="mobile-attention"
                aria-label={attentionLabel(attention)}
                onClick={() => navigate("agentic")}
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
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={active === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "agentic" &&
                (store.agents?.agents.filter(attentionRequired).length ?? 0) > 0 && (
                  <span className="nav-count">
                    {store.agents?.agents.filter(attentionRequired).length}
                  </span>
                )}
            </button>
          ))}
          <div className="nav-separator" />
          <button
            aria-current={page === "chat" ? "page" : undefined}
            onClick={() => {
              store.setComposeKind("task");
              navigate("chat");
            }}
          >
            <MessageSquare size={18} />
            <span>Bunny chat</span>
          </button>
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
            aria-label={store.theme === "dark" ? "Use light theme" : "Use dark theme"}
          >
            {store.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span>{store.theme === "dark" ? "Light appearance" : "Dark appearance"}</span>
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <span>{companion ? "Bunny companion" : "Your personal workspace"}</span>
          <div>
            <span className="stream-indicator" role="status" data-connection={connection}>
              {connection === "live" || connection === "polling"
                ? `${CONNECTION_LABEL[connection]} · ${freshness}`
                : CONNECTION_LABEL[connection]}
            </span>
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
        <ConnectionBanner freshness={freshness} />
        {store.syncStatus && (
          <p className="sync-message" role="status">
            {store.syncStatus}
          </p>
        )}
        <main id="bunny-content" className="workspace-content" tabIndex={-1}>
          {page === "today" ? (
            <HomeWorkspace now={now} />
          ) : page === "agentic" || page === "missions" ? (
            <AgenticWorkspace />
          ) : page === "project" ? (
            <Projects />
          ) : page === "provider" ? (
            <ModelsWorkspace />
          ) : page === "activity" || page === "tasks" ? (
            <ActivityWorkspace now={now} />
          ) : page === "settings" ? (
            <Settings />
          ) : page === "devices" || page === "phone" ? (
            <DevicesWorkspace />
          ) : page === "system" ? (
            <Telemetry />
          ) : page === "task" ? (
            <TaskDetail now={now} />
          ) : page === "extensions" ? (
            <Notifications now={now} />
          ) : page === "decision" && task?.state === "waiting_for_approval" ? (
            <div className="t8-surface">
              <Approval task={task} />
            </div>
          ) : page === "chat" || page === "compose" ? (
            <ChatWorkspace now={now} />
          ) : companion ? (
            <Phone now={now} />
          ) : (
            <HomeWorkspace now={now} />
          )}
        </main>
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
function HomeWorkspace({ now }: { now: number }) {
  const store = useIsland();
  const agents = store.agents?.agents ?? [];
  const active = agents.filter((row) => !["COMPLETED", "FAILED", "STOPPED"].includes(row.state));
  const pending = agents.filter(attentionRequired);
  const verified =
    store.missions?.missions.filter((row) => row.result && row.result.verifiedSteps > 0) ?? [];
  const providers = liveProviders(store).filter((row) => !row.extension || row.installed);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {now
              ? new Date(now).toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "Your workspace"}
          </p>
          <h1>A clear view of your work.</h1>
          <p>Pick up where you left off, or start something new.</p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            store.setComposeKind("task");
            store.setSheet("chat");
          }}
        >
          <MessageSquare size={16} />
          Ask Bunny
        </button>
      </div>
      <div className="home-summary">
        <button onClick={() => store.setSheet("agentic")}>
          <Bot size={20} />
          <strong>{store.hydratedFromHost ? active.length : "—"}</strong>
          <span>Active Agents</span>
          <small>Persistent Host work</small>
        </button>
        <button onClick={() => store.setSheet("agentic")}>
          <ShieldCheck size={20} />
          <strong>{store.hydratedFromHost ? pending.length : "—"}</strong>
          <span>Need your attention</span>
          <small>Permissions and recovery</small>
        </button>
        <button onClick={() => store.setSheet("agentic")}>
          <CheckCircle2 size={20} />
          <strong>{store.hydratedFromHost ? verified.length : "—"}</strong>
          <span>Verified results</span>
          <small>Retained Mission checks</small>
        </button>
      </div>
      <section className="t8-section">
        <div className="section-heading">
          <h2>Current work</h2>
          <button className="quiet-button" onClick={() => store.setSheet("agentic")}>
            Open Agentic
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="t8-surface">
          {active.slice(0, 4).map((agent) => (
            <button className="home-work-row" key={agent.id} onClick={() => openAgent(agent)}>
              <Bot size={20} />
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.activity?.step ?? "No step currently admitted"}</small>
              </span>
              <AgentState agent={agent} />
              <ChevronRight size={16} />
            </button>
          ))}
          {!active.length && (
            <Empty
              title="Ready for your next task."
              detail="Use Bunny chat for quick help, or Agentic for persistent multistep work."
            />
          )}
        </div>
      </section>
      <div className="home-columns">
        <section className="t8-section">
          <div className="section-heading">
            <h2>Recent Projects</h2>
            <button className="quiet-button" onClick={() => store.setSheet("project")}>
              All Projects
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="t8-surface">
            {store.projects.slice(0, 4).map((project) => (
              <button
                className="home-project-row"
                key={project.id}
                onClick={() => useIsland.setState({ projectFocus: project.id, sheet: "project" })}
              >
                <Folder size={19} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!store.projects.length && (
              <p className="t8-empty-copy">No registered Projects in this Host.</p>
            )}
          </div>
        </section>
        <section className="t8-section">
          <div className="section-heading">
            <h2>Connections</h2>
            <button className="quiet-button" onClick={() => store.setSheet("provider")}>
              Models
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="t8-surface">
            {providers.map((provider) => (
              <div className="connection-row" key={provider.id}>
                <ProviderMark provider={provider} />
                <strong>{NAMES[provider.id]}</strong>
                <ProviderStatus provider={provider} />
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="t8-section">
        <ActivityTimeline limit={5} />
      </section>
    </>
  );
}
function ChatWorkspace({ now }: { now: number }) {
  const store = useIsland();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Regular Bunny chat</p>
          <h1>What’s on your mind?</h1>
          <p>Questions, explanations and ordinary Tasks. Durable Missions live in Agentic.</p>
        </div>
      </div>
      <div className="chat-layout">
        <section className="t8-surface chat-compose">
          {store.submitting ? <Routing /> : <Composer />}
        </section>
        <section className="t8-section">
          <h2>Recent ordinary Tasks</h2>
          <div className="task-list t8-surface">
            {store.tasks
              .filter((row) => !row.mission)
              .slice(0, 12)
              .map((task) => (
                <TaskRow task={task} now={now} key={task.id} />
              ))}
            {!store.tasks.some((row) => !row.mission) && (
              <Empty
                title="Start a conversation."
                detail="Replies and outcomes come from the supported Host Task path."
              />
            )}
          </div>
        </section>
      </div>
    </>
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
              <button className="btn danger" onClick={() => setSigningOut(true)}>
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
              {store.devices.map((device) => (
                <div className="paired-device-row" key={device.id}>
                  <Smartphone size={16} />
                  <span>
                    <strong className="wrap-anywhere">{device.name}</strong>
                    <small>
                      Paired {when(device.createdAt)} · last seen {when(device.lastSeenAt)} · expires{" "}
                      {when(device.expiresAt)}
                    </small>
                  </span>
                  <button
                    className="btn quiet danger-text"
                    disabled={!store.canAct()}
                    onClick={() => setRevoking({ id: device.id, name: device.name })}
                  >
                    Revoke access
                  </button>
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}
      <Dialog.Root open={signingOut} onOpenChange={setSigningOut}>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <Dialog.Content className="t8-dialog" data-theme={store.theme}>
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <Dialog.Content className="t8-dialog" data-theme={store.theme}>
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
