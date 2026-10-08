import { Projects } from "./projects";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  ChevronRight,
  Folder,
  Monitor,
  Moon,
  Orbit,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Smartphone,
  Sun,
} from "lucide-react";
import { activeTasks, liveProviders, useIsland, type Sheet } from "@/store/use-island";
import type { OrchTask, ProviderLive } from "@/lib/orch/types";
import {
  BunnyMark,
  Empty,
  NAMES,
  Notice,
  ProviderFacts,
  ProviderMark,
  ProviderStatus,
  TaskBadge,
  TaskActivity,
  HostHealthWarning,
} from "./ui";
import { elapsed, isActive, todayCount} from "./ui-model";
import { FloatingIsland } from "./floating";
import { Composer, openTask, Routing, TaskDetail, Approval } from "./task";
import { Telemetry } from "./telemetry";
import { Phone, Pairing } from "./phone";
import { Settings } from "./settings";
import { Constellation } from "./motion";
import { isPrivateEvent } from "./motion-model";
import { MissionsSection } from "./mission";
import { AgentsSection } from "./agent";
import { ActivityTimeline } from "./activity";

const NAV = [
  { id: "today", label: "Home", icon: Monitor },
  { id: "provider", label: "Agents", icon: Activity },
  { id: "tasks", label: "Tasks", icon: Folder },
  { id: "project", label: "Projects", icon: Folder },
  { id: "system", label: "System", icon: Activity },
] as const;
export function Island() {
  const store = useIsland();
  const { hydrate, refreshOllama } = store;
  const [now, setNow] = useState(0);
  const [companion, setCompanion] = useState(false);
  useEffect(() => {
    hydrate();
    setCompanion(new URLSearchParams(window.location.search).get("companion") === "1");
    setNow(Date.now());
  }, [hydrate]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await refreshOllama();
      if (!cancelled) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshOllama]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
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
  }, [store.sheet]);
  const view = store.sheet ?? "today";
  const page = (view === "compose" || view === "decision") && !companion ? "today" : view;
  const providers = liveProviders(store);
  const task = store.tasks.find((t) => t.id === store.decisionTaskId);
  const navCurrent = page === "task" ? "tasks" : page;
  const navigate = (sheet: Sheet) => {
    if (sheet === "provider") useIsland.setState({ providerFocus: null });
    store.setSheet(sheet);
  };
  return (
    <div
      className="bunny-app"
      data-theme={store.theme}
      data-glass={store.appearance.glass}
      data-motion={store.appearance.motion}
      data-companion={companion}
    >
      <a href="#bunny-content" className="skip-link">
        Skip to content
      </a>
      {companion ? (
        <>
          <header className="phone-topbar">
            <button className="brand-button" onClick={() => navigate("phone")}>
              <BunnyMark />
              <strong>Bunny-A</strong>
            </button>
            <div>
              <button
                className="icon-button"
                aria-label="Notifications"
                onClick={() => navigate("extensions")}
              >
                <Bell size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Settings"
                onClick={() => navigate("settings")}
              >
                <Settings2 size={18} />
              </button>
            </div>
          </header>
          <HostHealthWarning />
          <main id="bunny-content" className="phone-content" tabIndex={-1} key={page}>
            {store.submitting ? (
              <div className="glass phone-surface">
                <Routing />
              </div>
            ) : page === "compose" ? (
              <div className="glass phone-surface">
                <Composer phone />
              </div>
            ) : page === "decision" && task?.state === "waiting_for_approval" ? (
              <div className="glass phone-surface">
                <Approval task={task} phone />
              </div>
            ) : page === "decision" || page === "task" ? (
              <TaskDetail now={now} />
            ) : page === "provider" ? (
              <Agents providers={providers} now={now} />
            ) : page === "system" ? (
              <Telemetry />
            ) : page === "settings" ? (
              <Settings />
            ) : page === "extensions" ? (
              <Notifications now={now} />
            ) : page === "project" ? (
              <Projects />
            ) : page === "tasks" ? (
              <History now={now} />
            ) : page === "constellation" ? (
              <Constellation now={now} onOpen={openTask} />
            ) : (
              <Phone now={now} />
            )}
          </main>
          <nav className="phone-dock glass" aria-label="Phone navigation">
            <button
              aria-current={page === "phone" || page === "today" ? "page" : undefined}
              onClick={() => navigate("phone")}
            >
              <Monitor size={20} />
              <span>Home</span>
            </button>
            <button
              aria-current={page === "provider" ? "page" : undefined}
              onClick={() => navigate("provider")}
            >
              <Activity size={20} />
              <span>Agents</span>
            </button>
            <button className="phone-ask" aria-label="New task" onClick={() => navigate("compose")}>
              <Plus size={22} />
            </button>
            <button
              aria-current={page === "tasks" || page === "task" ? "page" : undefined}
              onClick={() => navigate("tasks")}
            >
              <Folder size={20} />
              <span>Tasks</span>
            </button>
            <button
              aria-current={page === "settings" || page === "system" ? "page" : undefined}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={20} />
              <span>More</span>
            </button>
          </nav>
        </>
      ) : (
        <>
          <FloatingIsland now={now} />
          <div className="desktop-window glass">
            <header className="desktop-toolbar">
              <button className="brand-button" onClick={() => navigate("today")}>
                <BunnyMark />
                <span>Bunny-A</span>
              </button>
              <nav aria-label="Primary navigation">
                {NAV.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    aria-current={navCurrent === id ? "page" : undefined}
                    onClick={() => navigate(id)}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </nav>
              <div className="toolbar-actions">
                <span className="host-presence" data-state={store.host}>
                  {!store.connectionChecked
                    ? "Connecting"
                    : store.pairingRequired
                      ? "Not paired"
                      : store.host === "online"
                        ? store.hostHealth && store.hostHealth.operationalState!=="healthy" ? `Host ${store.hostHealth.operationalState}`
                          : "Host online"
                        : store.host === "sleeping"
                          ? "Sleeping"
                          : "Connection unavailable"}
                </span>
                <button
                  className="icon-button"
                  aria-label="Phone companion"
                  onClick={() => navigate("phone")}
                >
                  <Smartphone size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={store.theme === "dark" ? "Use light theme" : "Use dark theme"}
                  onClick={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
                >
                  {store.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Settings"
                  aria-current={page === "settings" ? "page" : undefined}
                  onClick={() => navigate("settings")}
                >
                  <Settings2 size={17} />
                </button>
              </div>
            </header>
            <HostHealthWarning />
            <main id="bunny-content" className="desktop-content" tabIndex={-1}>
              <div className="page-enter" key={page}>
                {page === "today" ? (
                  <Today now={now} />
                ) : page === "provider" ? (
                  <Agents providers={providers} now={now} />
                ) : page === "project" ? (
                  <Projects />
                ) : page === "system" ? (
                  <Telemetry />
                ) : page === "settings" ? (
                  <Settings />
                ) : page === "task" ? (
                  <TaskDetail now={now} />
                ) : page === "tasks" ? (
                  <History now={now} />
                ) : page === "constellation" ? (
                  <Constellation now={now} onOpen={openTask} />
                ) : page === "extensions" ? (
                  <Notifications now={now} />
                ) : page === "phone" ? (
                  <Pairing />
                ) : null}
              </div>
            </main>
            <footer className="desktop-footer">
              <span>
                <BunnyMark />
                Your agents. A little closer.
              </span>
              <span>Host-owned tasks · explicit approval</span>
            </footer>
          </div>
        </>
      )}
      <Notice />
    </div>
  );
}
export function TaskRow({ task, now }: { task: OrchTask; now: number }) {
  return (
    <button className="task-row" onClick={() => openTask(task.id)}>
      <ProviderMark
        provider={liveProviders(useIsland.getState()).find((p) => p.id === task.provider)!}
      />
      <span className="task-row-text">
        <strong>{task.title}</strong>
        <small>
          {NAMES[task.provider]} ·{" "}
          {isActive(task)
            ? ((task.latestEvent && isPrivateEvent(task.latestEvent.type)
                ? "Working…"
                : task.latestEvent?.label) ??
              (task.state === "waiting_for_approval" ? "Awaiting your approval" : "Working…"))
            : task.verification?.passed
              ? "Independently verified"
              : task.state === "completed"
                ? "Result ready"
                : task.state === "failed"
                  ? "View error details"
                  : "Stopped by Host"}
        </small>
      </span>
      <TaskBadge state={task.state} />
      <time>{elapsed(task, now)}</time>
      <ChevronRight size={16} />
    </button>
  );
}
function Today({ now }: { now: number }) {
  const store = useIsland();
  const active = activeTasks(store.tasks);
  const recent = store.tasks.filter((t) => !isActive(t)).slice(0, 5);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const completed = store.tasks.filter(
    (t) =>
      t.state === "completed" &&
      t.finishedAt != null &&
      t.finishedAt >= start.getTime() &&
      t.finishedAt <= now,
  ).length;
  const hour = now ? new Date(now).getHours() : -1;
  const greeting =
    hour < 0
      ? "Welcome back."
      : hour < 12
        ? "Good morning."
        : hour < 18
          ? "Good afternoon."
          : "Good evening.";
  return (
    <>
      <div className="today-heading">
        <div>
          <p className="eyebrow">
            Today
            {now
              ? ` · ${new Date(now).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`
              : ""}
          </p>
          <h1>{greeting}</h1>
          <p>
            {completed} {completed === 1 ? "task" : "tasks"} completed today{" "}
            <span className="summary-divider">/</span>{" "}
            {new Set(active.map((task) => task.provider)).size} agents on {active.length} tasks
          </p>
        </div>
        <button className="btn primary" onClick={() => store.setSheet("compose")}>
          <Plus size={16} />
          Ask Bunny
        </button>
      </div>
      <MissionsSection now={now} />
      <AgentsSection />
      <section className="today-section">
        <div className="section-heading">
          <h2 className="eyebrow">Active</h2>
          <button className="quiet-button" onClick={() => store.setSheet("constellation")}>
            <Orbit size={14} />
            Constellation
          </button>
        </div>
        <div className={active.length ? "home-active-grid" : "task-list glass"}>
          {active.length ? (
            active.map((t) => (
              <button
                className="home-active-card glass"
                key={t.id}
                onClick={() =>
                  t.state === "waiting_for_approval" ? store.openDecision(t.id) : openTask(t.id)
                }
              >
                <header>
                  <ProviderMark provider={liveProviders(store).find((p) => p.id === t.provider)!} />
                  <time className="caption">{elapsed(t, now)}</time>
                </header>
                <p className="eyebrow">{NAMES[t.provider]}</p>
                <h3>{t.title}</h3>
                {t.state === "waiting_for_approval" ? (
                  <TaskBadge state={t.state} />
                ) : (
                  <TaskActivity task={t} />
                )}
              </button>
            ))
          ) : (
            <Empty
              title="A little space for your next idea."
              detail="Ask Bunny in the Island. Your agents are one task away."
            />
          )}
        </div>
      </section>
      <ActivityTimeline limit={4} />
      <section className="today-section">
        <div className="section-heading">
          <h2 className="eyebrow">Recent</h2>
          <button className="quiet-button" onClick={() => store.setSheet("tasks")}>
            All tasks <ArrowRight size={14} />
          </button>
        </div>
        <div className="task-list glass">
          {recent.length ? (
            recent.map((t) => <TaskRow task={t} now={now} key={t.id} />)
          ) : (
            <Empty
              title="Your work will settle here."
              detail="Completed, stopped, and failed tasks stay in Host history."
            />
          )}
        </div>
      </section>
      {store.drafts.length ? (
        <div className="draft-reminder glass">
          <Folder size={18} />
          <span>
            {store.drafts.length} saved {store.drafts.length === 1 ? "draft" : "drafts"}
          </span>
          <button className="quiet-button" onClick={store.sendDrafts}>
            Review <ArrowRight size={14} />
          </button>
        </div>
      ) : null}
    </>
  );
}
function Agents({ providers, now }: { providers: ProviderLive[]; now: number }) {
  const store = useIsland();
  const selected = providers.find((p) => p.id === store.providerFocus);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Agents</p>
          <h1>The right minds for the task.</h1>
          <p>Provider reports and observations from your workstation.</p>
        </div>
        <button className="btn secondary" onClick={() => void store.refreshOllama()}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <div className="agent-grid">
        {providers
          .filter((p) => !p.extension)
          .map((p) => {
            const checks = store.tasks.filter((t) => t.provider === p.id && t.verification != null);
            const verified = checks.filter((t) => t.verification?.passed).length;
            return (
              <article
                className="agent-card glass"
                key={p.id}
                data-selected={p.id === selected?.id}
              >
                <header>
                  <ProviderMark provider={p} />
                  <ProviderStatus provider={p} />
                </header>
                <h2>{NAMES[p.id]}</h2>
                <p className="caption">
                  {p.id === "ollama"
                    ? /:cloud$/i.test(p.current_model ?? "")
                      ? "Local service · cloud model"
                      : "Local service"
                    : "Cloud agent"}
                </p>
                <ProviderFacts provider={p} compact />
                <dl className="fact-list observed">
                  <div>
                    <dt>Tasks today</dt>
                    <dd>{todayCount(store.tasks, now, p.id)}</dd>
                  </div>
                  <div>
                    <dt>Verified success</dt>
                    <dd>
                      {checks.length ? `${verified} / ${checks.length}` : "No verified outcomes"}
                    </dd>
                  </div>
                </dl>
                <button
                  className="quiet-button agent-details"
                  onClick={() => store.setProviderFocus(p.id)}
                >
                  Agent details <ChevronRight size={14} />
                </button>
              </article>
            );
          })}
      </div>
      <section className="optional-agents">
        <h2 className="eyebrow">Other detected agents</h2>
        {providers
          .filter((p) => p.extension)
          .map((p) => (
            <button
              key={p.id}
              className="optional-agent glass"
              onClick={() => store.setProviderFocus(p.id)}
            >
              <ProviderMark provider={p} />
              <span>
                <strong>{NAMES[p.id]}</strong>
                <small>{p.version ?? "Version unavailable"}</small>
              </span>
              <ProviderStatus provider={p} />
              <ChevronRight size={14} />
            </button>
          ))}
      </section>
      {selected ? (
        <section className="agent-info glass">
          <div className="section-heading">
            <h2>{NAMES[selected.id]} details</h2>
            <ProviderStatus provider={selected} />
          </div>
          <p>{selected.detail}</p>
          <ProviderFacts provider={selected} />
          <p className="caption">
            Authentication: {(selected.authenticatedState ?? "unknown").replaceAll("_", " ")} · Last
            probe:{" "}
            {selected.probedAt ? new Date(selected.probedAt).toLocaleString() : "Unavailable"}
          </p>
          <details>
            <summary>Capabilities and discovery evidence</summary>
            {selected.features ? (
              <dl className="fact-list">
                {Object.entries(selected.features).map(([name, feature]) => (
                  <div key={name}>
                    <dt>
                      {name}
                      <small>{feature.note}</small>
                    </dt>
                    <dd>{feature.supported ? "Supported" : "Unavailable"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="caption">Capabilities unavailable.</p>
            )}
            <p className="caption">Executable: {selected.executable ?? "Not detected"}</p>
          </details>
          {store.performance.filter((p) => p.provider === selected.id).length ? (
            <details>
              <summary>Observed outcomes</summary>
              {store.performance
                .filter((p) => p.provider === selected.id)
                .map((p) => (
                  <p className="caption" key={p.taskType}>
                    {p.taskType} · {p.count} tasks · {p.verified} verified
                    {!p.sufficient ? " · insufficient evidence for routing weight" : ""}
                  </p>
                ))}
            </details>
          ) : null}
          <button
            className="btn secondary"
            disabled={!["ready", "busy"].includes(selected.availability)}
            onClick={() => {
              store.setOverride(selected.id);
              store.setSheet("compose");
            }}
          >
            Use for next task <ArrowRight size={15} />
          </button>
        </section>
      ) : null}
    </>
  );
}
function History({ now }: { now: number }) {
  const store = useIsland();
  const [query, setQuery] = useState("");
  const matching = store.tasks.filter(
    (t) =>
      (store.filter === "all" ||
        (store.filter === "running" ? isActive(t) : t.state === store.filter)) &&
      `${t.title} ${t.prompt} ${t.provider}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Every task has a story.</h1>
          <p>{store.tasks.length} tasks retained by your Host.</p>
        </div>
      </div>
      <div className="history-tools">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks or agents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="task-filters">
          {(["all", "running", "completed", "failed", "stopped"] as const).map((f) => (
            <button key={f} aria-pressed={store.filter === f} onClick={() => store.setFilter(f)}>
              {f === "running" ? "Active" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="task-list glass">
        {matching.length ? (
          matching.map((t) => <TaskRow task={t} now={now} key={t.id} />)
        ) : (
          <Empty title="No matching tasks." detail="Try another search or filter." />
        )}
      </div>
    </>
  );
}
export function Notifications({ now }: { now: number }) {
  const store = useIsland();
  const events = store.events
    .filter((e) =>
      [
        "thermal.warning",
        "task.completed",
        "task.failed",
        "approval.required",
        "agent.waiting_for_input",
        "agent.waiting_for_approval",
      ].includes(e.type),
    )
    .slice(-30)
    .reverse();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1>A few things to know.</h1>
        </div>
      </div>
      <div className="notification-list">
        {events.length ? (
          events.map((e) => {
            const task = store.tasks.find((t) => t.id === e.taskId);
            return (
              <article className="notification-card glass" key={e.sequence}>
                <header>
                  <Bell size={16} />
                  <strong>
                    {e.type === "approval.required"
                      ? `${task ? NAMES[task.provider] : "Agent"} needs approval`
                      : e.type === "task.completed"
                        ? "Task completed"
                        : e.type === "thermal.warning"
                          ? "Thermal warning"
                          : e.type === "task.failed"
                            ? "Task failed"
                            : "Your attention is needed"}
                  </strong>
                  <time>
                    {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </header>
                <p>{task?.title ?? e.detail}</p>
                {task ? (
                  <>
                    <p className="caption">{elapsed(task, now)}</p>
                    <button
                      className="btn secondary"
                      onClick={() =>
                        task.state === "waiting_for_approval"
                          ? store.openDecision(task.id)
                          : openTask(task.id)
                      }
                    >
                      {task.state === "waiting_for_approval" ? "Review & approve" : "Open task"}
                      <ArrowRight size={14} />
                    </button>
                  </>
                ) : (
                  <button className="btn secondary" onClick={() => store.setSheet("system")}>
                    View system
                  </button>
                )}
              </article>
            );
          })
        ) : (
          <Empty
            title="Nothing needs your attention."
            detail="Live approval, completion, and thermal events appear here."
          />
        )}
      </div>
    </>
  );
}
