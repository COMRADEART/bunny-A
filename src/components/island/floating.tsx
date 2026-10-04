import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Monitor,
  Orbit,
  Plus,
  Settings2,
  Smartphone,
  Square,
  Thermometer,
  X,
} from "lucide-react";
import { activeTasks, liveProviders, useIsland } from "@/store/use-island";
import { Approval, Composer, openTask, Routing } from "./task";
import { HostHealthWarning, NAMES, ProviderMark, TaskActivity, TaskBadge } from "./ui";
import { elapsed, isActive, verifiedFile, TERMINAL } from "./ui-model";
import { Sparkline, Telemetry, thermalReading, ThermalWarning } from "./telemetry";
import {
  ActivityRibbon,
  ActivitySpark,
  ArtifactPreview,
  BunnyOrb,
  Constellation,
  IslandNotifications,
  TaskJourney,
} from "./motion";
import { orbState, isPrivateEvent } from "./motion-model";
import { useVoiceInput, VoicePanel } from "./voice";
import { focusMission, justFinished } from "./mission-model";
import { MissionCompletion, MissionPanel, MissionStrip } from "./mission";

type View =
  | "idle"
  | "composer"
  | "approval"
  | "task"
  | "tasks"
  | "system"
  | "menu"
  | "thermal"
  | "constellation"
  | "voice"
  | "mission";
export function FloatingIsland({ now }: { now: number }) {
  const store = useIsland();
  const providers = liveProviders(store);
  const active = activeTasks(store.tasks);
  const [view, setView] = useState<View>("idle");
  const [focused, setFocused] = useState<string | null>(null);
  const voice = useVoiceInput();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const [dismissedHeat, setDismissedHeat] = useState<string | null>(null);
  const [height, setHeight] = useState(64);
  const measured = useRef<HTMLDivElement>(null);
  const bunny = useRef<HTMLButtonElement>(null);
  const previous = useRef<{ id: string; state: string } | null>(null);
  const remembered = store.tasks.find((t) => t.id === focused);
  const task =
    remembered && !isActive(remembered) && active.length && (view === "idle" || view === "tasks")
      ? active[0]
      : (remembered ?? active[0]);
  const selected = store.tasks.find((t) => t.id === store.decisionTaskId);
  // Missions: the live one (or the one the user opened) takes the Bar; its child tasks are shown inside it.
  const mission = focusMission(store.missions);
  const finished = justFinished(store.missions, now);
  const shownMission =
    store.missions?.missions.find((m) => m.id === store.missionFocus) ?? mission ?? finished;
  const shownMissionId = shownMission?.id;
  const shownMissionState = shownMission?.state;
  const directActive = active.filter((t) => !t.mission);
  const compactTask = mission ? directActive[0] : task;
  const reading = thermalReading();
  const taskId = task?.id;
  const taskState = task?.state;
  const selectedId = selected?.id;
  const selectedState = selected?.state;
  const heatKey = reading?.key;
  const { sheet, setSheet, appearance, missionFocus } = store;
  const routing = store.submitting;
  const expanded = view !== "idle" || routing;
  const visiblePrimary = store.appearance.primary.flatMap((id) =>
    providers.filter((p) => p.id === id),
  );
  const sample = store.samples.at(-1);
  const orb =
    voice.state === "listening"
      ? "listening"
      : orbState(store.host, expanded ? task : active[0], routing);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );
  const temps = [
    sample?.cpu.temperatureC,
    ...(sample?.gpus.map((g) => g.temperatureC) ?? []),
  ].filter((t): t is number => t != null);
  const temperature =
    store.host === "online" && sample && now - sample.at < 15000 && temps.length
      ? Math.max(...temps)
      : null;
  const collapse = () => {
    setView("idle");
    voice.stop();
    if (store.sheet === "compose" || store.sheet === "decision") store.setSheet("today");
    requestAnimationFrame(() => bunny.current?.focus());
  };
  useEffect(() => {
    if (sheet === "compose") setView("composer");
    if (sheet === "decision" && selectedId) {
      setFocused(selectedId);
      setView(selectedState === "waiting_for_approval" ? "approval" : "task");
    }
  }, [sheet, selectedId, selectedState]);
  useEffect(() => {
    if (!taskId || !taskState) return;
    // Remember the focused Host task so its terminal transition survives removal from the active list.
    setFocused(taskId);
    if (
      previous.current?.id === taskId &&
      TERMINAL.includes(taskState) &&
      !["completed", "failed", "stopped"].includes(previous.current.state)
    )
      setView("task");
    previous.current = { id: taskId, state: taskState };
  }, [taskId, taskState]);
  useEffect(() => {
    // A mission the user just created opens Mission Control in the Bar.
    if (missionFocus) setView("mission");
  }, [missionFocus]);
  useEffect(() => {
    if (
      view !== "mission" ||
      !shownMissionState ||
      !["completed", "failed", "stopped"].includes(shownMissionState) ||
      !appearance.collapse
    )
      return;
    // Show the result briefly, then collapse back like a finished task.
    const timer = setTimeout(() => {
      setView("idle");
      useIsland.setState({ missionFocus: null });
    }, appearance.collapse * 1000);
    return () => clearTimeout(timer);
  }, [view, shownMissionId, shownMissionState, appearance.collapse]);
  useEffect(() => {
    if (heatKey && heatKey !== dismissedHeat && view !== "composer" && !routing) setView("thermal");
    if (!heatKey) setDismissedHeat(null);
  }, [heatKey, dismissedHeat, routing, view]);
  useEffect(() => {
    if (
      !taskId ||
      !taskState ||
      !TERMINAL.includes(taskState) ||
      view !== "task" ||
      !appearance.collapse
    )
      return;
    const timer = setTimeout(() => {
      setView("idle");
      if (useIsland.getState().sheet === "decision") setSheet("today");
    }, appearance.collapse * 1000);
    return () => clearTimeout(timer);
  }, [taskId, taskState, view, appearance.collapse, setSheet]);
  useEffect(() => {
    const el = measured.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setHeight(Math.ceil(el.getBoundingClientRect().height)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const cycle = (direction: number) => {
    if (!active.length || !["idle", "task", "tasks"].includes(view)) return;
    const index = active.findIndex((t) => t.id === task?.id);
    setFocused(active[(index + direction + active.length) % active.length].id);
    setView(active.length > 1 ? "tasks" : "task");
  };
  const output = (task?.output ?? "").split("\n").slice(-5).join("\n");
  const file = task ? verifiedFile(task) : null;
  return (
    <section
      className="floating-island glass"
      data-expanded={expanded}
      data-view={routing ? "routing" : view}
      data-orb={orb}
      data-size={store.appearance.size}
      data-position={store.appearance.position}
      aria-label="Bunny Island"
      style={{ height, "--island-height": `${height}px` } as CSSProperties}
      onWheel={(e) => {
        if (active.length && Math.abs(e.deltaY) > 8) cycle(e.deltaY > 0 ? 1 : -1);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          collapse();
        }
        if (
          (e.key === "ArrowDown" || e.key === "ArrowUp") &&
          !(
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement ||
            e.target instanceof HTMLInputElement
          )
        ) {
          e.preventDefault();
          cycle(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <div className="island-measure" ref={measured}>
        <HostHealthWarning />
        <header className="island-header">
          <button
            type="button"
            className="bunny-trigger"
            ref={bunny}
            aria-label="Ask Bunny"
            aria-expanded={view === "composer"}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              held.current = false;
              holdTimer.current = setTimeout(() => {
                held.current = true;
                voice.start();
                setView("voice");
              }, 420);
            }}
            onPointerUp={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              if (held.current) voice.stop();
            }}
            onPointerLeave={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              if (held.current) voice.stop();
            }}
            onPointerCancel={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              voice.stop();
            }}
            onClick={() => {
              if (held.current) {
                held.current = false;
                return;
              }
              store.setSheet("compose");
              setView("composer");
            }}
          >
            <BunnyOrb state={orb} />
          </button>
          <span className="island-divider" />
          {store.appearance.idle === "clock" && !expanded ? (
            <time className="island-clock">
              {now
                ? new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "—"}
            </time>
          ) : store.appearance.idle === "tasks" && !expanded ? (
            <button className="quiet-button island-active-count" onClick={() => setView("tasks")}>
              {active.length} active
            </button>
          ) : store.appearance.idle === "minimal" && !expanded ? (
            <span className="island-minimal">Bunny-A</span>
          ) : store.appearance.idle === "temperatures" && !expanded ? (
            <div className="island-system-micro">
              <div className="micro-sensor">
                <span>CPU</span>
                <Sparkline
                  label="CPU utilization"
                  height={12}
                  data={store.samples.map((s) => ({ at: s.at, value: s.cpu.utilization }))}
                />
              </div>
              {sample?.gpus[0] ? (
                <div className="micro-sensor">
                  <span>GPU</span>
                  <Sparkline
                    label="GPU utilization"
                    height={12}
                    data={store.samples.map((s) => ({
                      at: s.at,
                      value:
                        s.gpus.find((g) => g.name === sample.gpus[0].name)?.utilization ?? null,
                    }))}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="island-idle-mixed">
              <div className="island-providers">
                {visiblePrimary.map((p) => (
                  <ProviderMark key={p.id} provider={p} interactive />
                ))}
              </div>
              {store.appearance.idle === "mixed" && !expanded ? (
                <div className="micro-sensor">
                  <span>CPU</span>
                  <Sparkline
                    label="CPU utilization"
                    height={12}
                    data={store.samples.map((s) => ({ at: s.at, value: s.cpu.utilization }))}
                  />
                </div>
              ) : null}
            </div>
          )}
          <button
            className="island-temperature"
            onClick={() => setView(view === "system" ? "idle" : "system")}
            aria-label={`System telemetry. ${temperature == null ? "Temperature unavailable" : `${temperature} degrees Celsius`}`}
          >
            <Thermometer size={14} />
            <span>{temperature == null ? "—" : `${temperature}°`}</span>
          </button>
          <button
            className="icon-button"
            aria-label={expanded ? "Collapse Island" : "Island menu"}
            onClick={() => (expanded ? collapse() : setView("menu"))}
          >
            {expanded ? <X size={16} /> : <Ellipsis size={18} />}
          </button>
        </header>
        {expanded ? (
          <div className="island-content" key={routing ? "routing" : view}>
            {routing ? (
              <Routing />
            ) : view === "voice" ? (
              <VoicePanel
                state={voice.state}
                transcript={voice.transcript}
                onStop={() => {
                  voice.stop();
                  store.setSheet("compose");
                  setView("composer");
                }}
              />
            ) : view === "composer" ? (
              <Composer />
            ) : view === "mission" && shownMission ? (
              <MissionPanel mission={shownMission} now={now} />
            ) : (view === "approval" || view === "task") &&
              task?.state === "waiting_for_approval" ? (
              <Approval task={task} />
            ) : view === "system" ? (
              <Telemetry compact />
            ) : view === "constellation" ? (
              <Constellation
                now={now}
                compact
                onOpen={(id) => {
                  setFocused(id);
                  setView("task");
                }}
              />
            ) : view === "thermal" && reading ? (
              <ThermalWarning
                reading={reading}
                onContinue={() => {
                  setDismissedHeat(reading.key);
                  setView(active.length ? "task" : "idle");
                }}
              />
            ) : view === "menu" ? (
              <div className="island-menu">
                <p className="eyebrow">Bunny-A</p>
                <button
                  onClick={() => {
                    store.setSheet("today");
                    setView("idle");
                  }}
                >
                  <Monitor size={17} />
                  Open application
                  <ChevronRight size={14} />
                </button>
                <button onClick={() => setView("tasks")}>
                  <Square size={17} />
                  {active.length} active tasks
                  <ChevronRight size={14} />
                </button>
                {store.missions?.enabled ? (
                  <button
                    onClick={() => {
                      if (shownMission) setView("mission");
                      else {
                        store.setSheet("today");
                        setView("idle");
                      }
                    }}
                  >
                    <Orbit size={17} />
                    {mission ? "Mission control" : "Missions"}
                    <ChevronRight size={14} />
                  </button>
                ) : null}
                <button onClick={() => setView("constellation")}>
                  <Orbit size={17} />
                  Constellation
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => {
                    store.setSheet("phone");
                    setView("idle");
                  }}
                >
                  <Smartphone size={17} />
                  Phone companion
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => {
                    store.setSheet("settings");
                    setView("idle");
                  }}
                >
                  <Settings2 size={17} />
                  Settings
                  <ChevronRight size={14} />
                </button>
                <div className="optional-providers">
                  {providers
                    .filter((p) => !store.appearance.primary.includes(p.id))
                    .map((p) => (
                      <div key={p.id}>
                        <ProviderMark provider={p} interactive />
                        <span>{NAMES[p.id]}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : view === "tasks" && active.length ? (
              <div className="island-multitask">
                <div className="section-heading">
                  <strong>Bunny</strong>
                  <span className="caption">{active.length} active</span>
                </div>
                {active.map((t) => (
                  <button
                    key={t.id}
                    data-focused={t.id === task?.id}
                    onClick={() => {
                      setFocused(t.id);
                      setView(t.state === "waiting_for_approval" ? "approval" : "task");
                      if (t.state === "waiting_for_approval")
                        useIsland.setState({ decisionTaskId: t.id });
                    }}
                  >
                    <ProviderMark provider={providers.find((p) => p.id === t.provider)!} />
                    <span>
                      <strong>{NAMES[t.provider]}</strong>
                      <small>
                        {(t.latestEvent && isPrivateEvent(t.latestEvent.type)
                          ? "Working…"
                          : t.latestEvent?.label) ??
                          (t.state === "waiting_for_approval" ? "Needs approval" : "Working…")}
                      </small>
                      {t.id === task?.id ? (
                        <small className="focused-title">{t.title}</small>
                      ) : null}
                    </span>
                    <ActivitySpark task={t} now={now} />
                    <time>{elapsed(t, now)}</time>
                  </button>
                ))}
                <p className="caption">Scroll or use ↑ ↓ to focus a task.</p>
              </div>
            ) : task ? (
              <div className="island-task">
                <div className="section-heading">
                  <span className="provider-heading">
                    <ProviderMark provider={providers.find((p) => p.id === task.provider)!} />
                    {NAMES[task.provider]}
                  </span>
                  <time>{elapsed(task, now)}</time>
                </div>
                <h2>{task.title}</h2>
                <TaskBadge state={task.state} />
                <TaskJourney task={task} />
                {isActive(task) ? (
                  <>
                    <TaskActivity task={task} expanded />
                    <ActivityRibbon
                      task={task}
                      onOpen={() => {
                        openTask(task.id);
                        setView("idle");
                      }}
                    />
                    {output ? <pre className="output-panel latest-output">{output}</pre> : null}
                    <div className="actions">
                      <button
                        className="btn secondary"
                        onClick={() => {
                          openTask(task.id);
                          setView("idle");
                        }}
                      >
                        Open task <ExternalLink size={14} />
                      </button>
                      <button className="btn danger" onClick={() => void store.stop(task.id)}>
                        <Square size={13} />
                        Stop
                      </button>
                    </div>
                    <p className="caption">Terminal unavailable</p>
                  </>
                ) : (
                  <>
                    <p className="result-summary">
                      {task.state === "failed"
                        ? (task.error ?? "The task did not finish.").split("\n")[0].slice(0, 180)
                        : task.state === "stopped"
                          ? "The Host stopped this task."
                          : (file?.name ?? "Task completed. The result is ready in task details.")}
                    </p>
                    {file ? <ArtifactPreview task={task} /> : null}
                    <div className="actions">
                      <button
                        className="btn secondary"
                        onClick={() => {
                          openTask(task.id);
                          setView("idle");
                        }}
                      >
                        {task.state === "failed" ? "Details" : "Open task"}
                        <ExternalLink size={14} />
                      </button>
                      {task.state === "failed" ? (
                        <button
                          className="btn quiet"
                          onClick={() => {
                            store.setProviderFocus(task.provider);
                            setView("idle");
                          }}
                        >
                          Agent status
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="island-empty">
                <p>No active tasks.</p>
                <button className="btn secondary" onClick={() => store.setSheet("compose")}>
                  <Plus size={14} />
                  Ask Bunny
                </button>
              </div>
            )}
          </div>
        ) : mission || finished || (active.length && compactTask) ? (
          <>
            {mission ? (
              <MissionStrip
                mission={mission}
                onOpen={() => {
                  store.openMission(mission.id);
                  setView("mission");
                }}
              />
            ) : finished ? (
              <MissionCompletion
                mission={finished}
                onOpen={() => {
                  store.openMission(finished.id);
                  setView("mission");
                }}
              />
            ) : null}
            {compactTask ? (
              <button
                className="island-live-compact"
                onClick={() => {
                  setFocused(compactTask.id);
                  if (compactTask.state === "waiting_for_approval") {
                    store.openDecision(compactTask.id);
                    setView("approval");
                  } else setView(active.length > 1 ? "tasks" : "task");
                }}
              >
                <span>
                  <strong>{NAMES[compactTask.provider]}</strong>
                  <small>
                    {(compactTask.latestEvent && isPrivateEvent(compactTask.latestEvent.type)
                      ? "Working…"
                      : compactTask.latestEvent?.label) ??
                      (compactTask.state === "waiting_for_approval" ? "Needs approval" : "Working…")}
                  </small>
                </span>
                <time>{elapsed(compactTask, now)}</time>
                <ChevronDown size={14} />
                {(mission ? directActive : active).length > 1 ? (
                  <span className="count-pill">+{(mission ? directActive : active).length - 1}</span>
                ) : null}
              </button>
            ) : null}
          </>
        ) : null}
        <IslandNotifications
          now={now}
          onOpen={(id) => {
            if (id) {
              setFocused(id);
              const target = store.tasks.find((t) => t.id === id);
              setView(target?.state === "waiting_for_approval" ? "approval" : "task");
            } else {
              store.setSheet("extensions");
              setView("idle");
            }
          }}
        />
      </div>
    </section>
  );
}
