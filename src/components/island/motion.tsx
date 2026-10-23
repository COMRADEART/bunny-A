import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronRight,
  FileCheck2,
  FileImage,
  FileText,
  Play,
  Radio,
  RotateCcw,
  X,
} from "lucide-react";
import type { OrchTask, ProviderId, RouteDecision } from "@/lib/orch/types";
import { activeTasks, liveProviders, useIsland } from "@/store/use-island";
import { BunnyMark, Empty, NAMES, ProviderMark, ProviderStatus } from "./ui";
import { elapsed, isActive, verifiedFile } from "./ui-model";
import {
  activityDetail,
  activityLabel,
  orbState,
  replayFrame,
  replayRecords,
  routeStrengths,
  routingGraphIds,
  taskJourney,
  type OrbState,
} from "./motion-model";

export function BunnyOrb({ state = "idle", large = false }: { state?: OrbState; large?: boolean }) {
  return (
    <span
      className={`bunny-orb${large ? " large" : ""}`}
      data-state={state}
      role="img"
      aria-label={`Bunny ${state}`}
    >
      <span className="orb-halo" aria-hidden="true" />
      <span className="orb-ring" aria-hidden="true" />
      <span className="orb-core">
        <BunnyMark />
      </span>
      <Check className="orb-check" size={large ? 24 : 14} aria-hidden="true" />
    </span>
  );
}

export function TaskJourney({ task }: { task: Parameters<typeof taskJourney>[0] }) {
  return (
    <ol className="task-journey" aria-label="Task journey">
      {taskJourney(task).map((step) => (
        <li
          key={step.label}
          data-status={step.status}
          title={`${step.label}: ${step.status === "unavailable" ? "No verification or completion record" : step.status}`}
        >
          <span className="journey-dot" aria-hidden="true">
            {step.status === "done" ? (
              <Check size={10} />
            ) : step.status === "failed" ? (
              <X size={10} />
            ) : null}
          </span>
          <span>{step.label}</span>
          <span className="sr-only"> {step.status}</span>
        </li>
      ))}
    </ol>
  );
}

export function RoutingGraph({
  decision,
  selected,
  pending = false,
}: {
  decision?: RouteDecision | null;
  selected?: ProviderId;
  pending?: boolean;
}) {
  const store = useIsland();
  const providers = liveProviders(store);
  const strengths = routeStrengths(decision);
  const chosen = selected ?? decision?.recommended_provider;
  const ids = routingGraphIds(providers, decision);
  return (
    <div
      className="routing-graph"
      data-pending={pending}
      aria-label={
        pending ? "Routing request in progress; scores pending" : "Recorded routing scores"
      }
    >
      <svg
        className="routing-paths"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {ids.map((id, index) => {
          const score = strengths.find((s) => s.provider === id);
          const angle = ids.length === 3 ? [-180, -90, 0][index] : (index * 360) / ids.length - 180;
          return (
            <g
              key={id}
              className="routing-path"
              data-selected={chosen === id}
              data-known={!!score}
              data-provider={id}
              style={
                {
                  "--route-strength": score?.strength ?? 0,
                  "--path-weight": score ? `${1 + score.strength * 2}px` : "1px",
                } as CSSProperties
              }
            >
              <line
                x1={50}
                y1={58}
                x2={50 + Math.cos((angle * Math.PI) / 180) * 36}
                y2={58 + Math.sin((angle * Math.PI) / 180) * 32}
                vectorEffect="non-scaling-stroke"
              />
              {pending ? (
                <line
                  className="routing-light"
                  x1={50}
                  y1={58}
                  x2={50 + Math.cos((angle * Math.PI) / 180) * 36}
                  y2={58 + Math.sin((angle * Math.PI) / 180) * 32}
                  vectorEffect="non-scaling-stroke"
                  pathLength={100}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="routing-center">
        <BunnyOrb state={pending ? "routing" : "waiting"} large />
        <span>Bunny</span>
      </div>
      {ids.map((id, index) => {
        const provider = providers.find((p) => p.id === id)!;
        const score = strengths.find((s) => s.provider === id);
        const angle = ids.length === 3 ? [-180, -90, 0][index] : (index * 360) / ids.length - 180;
        return (
          <div
            className="routing-node"
            key={id}
            data-selected={chosen === id}
            data-provider={id}
            style={
              {
                "--node-x": `${50 + Math.cos((angle * Math.PI) / 180) * 36}%`,
                "--node-y": `${58 + Math.sin((angle * Math.PI) / 180) * 32}%`,
              } as CSSProperties
            }
          >
            <ProviderMark provider={provider} />
            <strong>{NAMES[id]}</strong>
            <small>
              {score
                ? `Score ${score.score.toFixed(2)}`
                : pending
                  ? "Awaiting score"
                  : "Not scored"}
            </small>
          </div>
        );
      })}
    </div>
  );
}

export function ProviderComparison({
  task,
  onSelect,
}: {
  task: OrchTask;
  onSelect: (id: ProviderId) => void;
}) {
  const store = useIsland();
  const strengths = routeStrengths(task.decision);
  const available = liveProviders(store).filter(
    (p) => task.decision.scores.some((s) => s.provider === p.id) || p.id === task.provider,
  );
  return (
    <section className="provider-comparison" aria-label="Provider comparison">
      <div className="section-heading">
        <h3>Compare agents</h3>
        <span className="caption">Recorded route</span>
      </div>
      {available.map((p) => {
        const score = strengths.find((s) => s.provider === p.id);
        const history = store.performance.filter(
          (h) => h.provider === p.id && h.taskType === task.decision.task_type,
        );
        const quotas = p.usageWindows ?? [];
        const eligible =
          task.decision.eligible_providers?.includes(p.id) ??
          task.decision.scores.some((s) => s.provider === p.id);
        return (
          <button
            type="button"
            key={p.id}
            className="comparison-agent"
            data-selected={p.id === task.provider}
            disabled={!eligible || !["ready", "busy"].includes(p.availability)}
            onClick={() => onSelect(p.id)}
          >
            <span className="comparison-heading">
              <ProviderMark provider={p} />
              <strong>{NAMES[p.id]}</strong>
              <ProviderStatus provider={p} />
            </span>
            <span className="comparison-score">
              <span>Route fit</span>
              <meter
                aria-label={`${NAMES[p.id]} relative routing score`}
                min={0}
                max={1}
                value={score?.strength ?? 0}
              />
              <strong>{score?.score.toFixed(2) ?? "Unavailable"}</strong>
            </span>
            <span className="comparison-facts">
              <span>
                Speed{" "}
                <b>
                  {p.latency_estimate_ms == null
                    ? "Unavailable"
                    : `${(p.latency_estimate_ms / 1000).toFixed(1)}s observed`}
                </b>
              </span>
              <span>
                Execution{" "}
                <b>
                  {p.id === "ollama" && /:cloud$/i.test(p.current_model ?? "")
                    ? "Cloud model"
                    : p.local_or_cloud}
                </b>
              </span>
              <span>
                Usage{" "}
                <b>
                  {p.id === "ollama"
                    ? "No subscription quota"
                    : quotas.length
                      ? quotas.map((q) => `${q.label}: ${q.usedPercent}%`).join(" · ")
                      : "Unavailable"}
                </b>
              </span>
              <span>
                History{" "}
                <b>
                  {history.length
                    ? `${history.reduce((n, h) => n + h.verified, 0)} verified / ${history.reduce((n, h) => n + h.count, 0)} tasks`
                    : "No task-fit evidence"}
                </b>
              </span>
            </span>
          </button>
        );
      })}
      {task.decision.excluded?.map((p) => (
        <p className="caption" key={p.provider}>
          {NAMES[p.provider]} · {p.reason}
        </p>
      ))}
      <p className="caption">Bars compare routing scores. They are not success probabilities.</p>
    </section>
  );
}

export function ActivitySpark({ task, now }: { task: OrchTask; now: number }) {
  const events = useIsland((s) => s.events).filter(
    (e) =>
      e.taskId === task.id &&
      e.type.startsWith("agent.") &&
      !/thinking|reasoning|output/i.test(e.type) &&
      e.at <= now &&
      e.at > now - 30000,
  );
  const counts = Array.from(
    { length: 6 },
    (_, i) =>
      events.filter((e) => e.at > now - 30000 + i * 5000 && e.at <= now - 25000 + i * 5000).length,
  );
  const peak = Math.max(1, ...counts);
  return (
    <svg
      className="activity-spark"
      viewBox="0 0 54 18"
      role="img"
      aria-label={`${events.length} recorded agent actions in the last 30 seconds`}
    >
      <polyline points={counts.map((n, i) => `${i * 10 + 2},${16 - (n / peak) * 13}`).join(" ")} />
    </svg>
  );
}

export function ActivityRibbon({ task, onOpen }: { task: OrchTask; onOpen: () => void }) {
  const events = useIsland((s) => s.events)
    .filter(
      (e) =>
        e.taskId === task.id &&
        [
          "agent.reading",
          "agent.editing",
          "agent.command",
          "agent.testing",
          "agent.searching",
          "agent.building",
          "agent.rendering",
          "agent.verifying",
        ].includes(e.type),
    )
    .slice(-4);
  if (!events.length) return null;
  return (
    <button className="activity-ribbon" aria-label="Open full task activity" onClick={onOpen}>
      <span className="ribbon-track">
        {events.map((event) => (
          <span className="ribbon-event" key={event.sequence}>
            <b>{activityLabel(event.type)}</b>
            <span title={event.detail}>{event.detail}</span>
            <ChevronRight size={12} />
          </span>
        ))}
      </span>
    </button>
  );
}

export function ArtifactPreview({
  task,
  available = true,
}: {
  task: OrchTask;
  available?: boolean;
}) {
  const file = available ? verifiedFile(task) : null;
  if (!file) return null;
  const Icon = /\.(png|jpe?g|webp|gif)$/i.test(file.name)
    ? FileImage
    : /\.pdf$/i.test(file.name)
      ? FileText
      : FileCheck2;
  return (
    <div className="artifact-preview">
      <span className="artifact-icon">
        <Icon size={28} />
      </span>
      <div>
        <strong>{file.name}</strong>
        <p>Verified on your workstation</p>
        <small>{file.folder}</small>
      </div>
      <Check size={16} />
      <p className="caption">Preview and browser file opening unavailable.</p>
    </div>
  );
}

export function Constellation({
  now,
  compact = false,
  onOpen,
}: {
  now: number;
  compact?: boolean;
  onOpen: (id: string) => void;
}) {
  const store = useIsland();
  const active = activeTasks(store.tasks);
  const [focus, setFocus] = useState(0);
  const shown = active.slice(focus * 6, focus * 6 + 6);
  const providers = liveProviders(store);
  return (
    <section className={`constellation-view${compact ? " compact" : ""}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Constellation</p>
          <h2>{compact ? "Your live agents" : "A shared center of gravity."}</h2>
        </div>
        <span className="caption">{active.length} active</span>
      </div>
      <div className="constellation-map" aria-label="Real active agent assignments">
        <svg
          className="constellation-paths"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {shown.map((task, index) => {
            const angle = (index * 360) / Math.max(3, shown.length) - 90;
            const x = 50 + Math.cos((angle * Math.PI) / 180) * 34;
            const y = 50 + Math.sin((angle * Math.PI) / 180) * 35;
            return (
              <g
                key={task.id}
                className="constellation-path"
                data-working={task.state === "running" || task.state === "verifying"}
              >
                <line x1={50} y1={50} x2={x} y2={y} vectorEffect="non-scaling-stroke" />
                {task.state === "running" || task.state === "verifying" ? (
                  <line
                    className="constellation-light"
                    x1={50}
                    y1={50}
                    x2={x}
                    y2={y}
                    vectorEffect="non-scaling-stroke"
                    pathLength={100}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
        <div className="constellation-center">
          <BunnyOrb
            state={orbState(
              store.host,
              shown.find((t) => isActive(t)),
            )}
            large
          />
          <strong>Bunny-A</strong>
        </div>
        {shown.map((task, index) => {
          const angle = (index * 360) / Math.max(3, shown.length) - 90;
          return (
            <div
              className="constellation-assignment"
              key={task.id}
              style={
                {
                  "--assignment-x": `${50 + Math.cos((angle * Math.PI) / 180) * 34}%`,
                  "--assignment-y": `${50 + Math.sin((angle * Math.PI) / 180) * 35}%`,
                } as CSSProperties
              }
            >
              <button onClick={() => onOpen(task.id)}>
                <ProviderMark provider={providers.find((p) => p.id === task.provider)!} />
                <strong>{NAMES[task.provider]}</strong>
                <small>{task.title}</small>
                <time>{elapsed(task, now)}</time>
              </button>
            </div>
          );
        })}
        {!active.length ? (
          <p className="constellation-empty caption">No active assignments.</p>
        ) : null}
      </div>
      {active.length > 6 ? (
        <button
          className="quiet-button"
          onClick={() => setFocus((focus + 1) % Math.ceil(active.length / 6))}
        >
          Next assignments <ChevronRight size={14} />
        </button>
      ) : null}
      <p className="caption">
        Paths show Host-owned assignments. Agent handoffs are unavailable in the current Host.
      </p>
    </section>
  );
}

export function TaskReplay({ task }: { task: OrchTask }) {
  const events = useIsland((s) => s.events);
  const provider = liveProviders(useIsland()).find((p) => p.id === task.provider)!;
  const records = replayRecords(task, events);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const index = Math.min(cursor, Math.max(0, records.length - 1));
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (cursor >= records.length - 1) setPlaying(false);
      else setCursor(cursor + 1);
    }, 900);
    return () => clearTimeout(timer);
  }, [playing, cursor, records.length]);
  if (!records.length) return <Empty title="Replay unavailable" />;
  const at = records[index].at;
  const frame = replayFrame(task, records, at);
  const time = (value: number) => {
    const seconds = Math.max(0, Math.floor((value - task.createdAt) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  return (
    <section className="task-replay" aria-label="Task replay">
      <div className="section-heading">
        <span className="provider-heading">
          <RotateCcw size={16} />
          <h3>Replay</h3>
        </span>
        <time>{time(at)}</time>
      </div>
      <div className="replay-controls">
        <button
          className="icon-button"
          onClick={() => {
            if (index === records.length - 1) setCursor(0);
            setPlaying(!playing);
          }}
          aria-label={playing ? "Pause replay" : "Play replay"}
        >
          {playing ? <Radio size={16} /> : <Play size={16} />}
        </button>
        <label className="sr-only" htmlFor={`replay-${task.id}`}>
          Replay timeline
        </label>
        <input
          id={`replay-${task.id}`}
          type="range"
          min={0}
          max={records.length - 1}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
          aria-valuetext={`${time(at)} ${activityLabel(records[index].type)}`}
        />
      </div>
      <TaskJourney task={frame.task} />
      <div className="replay-assignment">
        {frame.routeAvailable ? (
          <>
            <ProviderMark provider={provider} />
            <span>
              {NAMES[task.provider]} ·{" "}
              {frame.agentStarted ? "Session started" : "Selected; awaiting approval"}
            </span>
          </>
        ) : (
          <span className="caption">Agent selection not yet recorded.</span>
        )}
      </div>
      <div className="replay-event" aria-live="polite">
        <ProviderMark
          provider={liveProviders(useIsland.getState()).find((p) => p.id === task.provider)!}
        />
        <div>
          <strong>
            {NAMES[task.provider]} ·{" "}
            {records[index].source === "log"
              ? "Retained Host log"
              : activityLabel(records[index].type)}
          </strong>
          <p>{activityDetail(records[index].type, records[index].detail)}</p>
        </div>
      </div>
      {frame.command ? <pre className="output-panel">{frame.command}</pre> : null}
      {frame.task.output ? (
        <pre className="output-panel replay-output">{frame.task.output}</pre>
      ) : (
        <p className="caption">No output retained at this point.</p>
      )}
      <ArtifactPreview task={task} available={frame.artifactAvailable} />
      <ol className="replay-timeline">
        {records.map((record, i) => (
          <li key={record.key}>
            <button
              data-selected={i === index}
              onClick={() => {
                setPlaying(false);
                setCursor(i);
              }}
            >
              <time>{time(record.at)}</time>
              <span>{record.source === "log" ? "Host log" : activityLabel(record.type)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="caption">
        Persisted events and retained timestamped Host logs. Gaps are not inferred. Final output and
        artifacts appear only at completion.
      </p>
    </section>
  );
}

export function IslandNotifications({
  now,
  onOpen,
}: {
  now: number;
  onOpen: (taskId: string | null) => void;
}) {
  const events = useIsland((s) => s.events);
  const tasks = useIsland((s) => s.tasks);
  const seeded = useRef(false);
  const last = useRef(0);
  const [notifications, setNotifications] = useState<typeof events>([]);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (!events.length) return;
    const latest = Math.max(...events.map((e) => e.sequence));
    if (!seeded.current) {
      seeded.current = true;
      last.current = latest;
      return;
    }
    const fresh = events.filter(
      (e) =>
        e.sequence > last.current &&
        [
          "approval.required",
          "task.completed",
          "task.failed",
          "thermal.warning",
          "agent.waiting_for_input",
          "agent.waiting_for_approval",
        ].includes(e.type),
    );
    last.current = latest;
    if (fresh.length) {
      setNotifications((n) => [...n, ...fresh].slice(-8));
      setExpanded(true);
    }
  }, [events]);
  const notification = notifications.at(-1);
  if (!notification) return null;
  if (!expanded || now - notification.at > 10000)
    return (
      <button
        className="island-notification-indicator"
        aria-label={`${notifications.length} Bunny notifications`}
        onClick={() => {
          onOpen(notification.taskId);
          setNotifications([]);
        }}
      >
        <Radio size={12} />
        {notifications.length}
      </button>
    );
  const task = tasks.find((t) => t.id === notification.taskId);
  const detail = task?.title ?? activityDetail(notification.type, notification.detail, task);
  return (
    <div className="island-notification" role="status">
      <button
        onClick={() => {
          onOpen(notification.taskId);
          setNotifications([]);
        }}
      >
        <span className="presence-dot" />
        <span>
          {notification.type === "thermal.warning"
            ? detail
            : `${activityLabel(notification.type)} · ${detail}`}
        </span>
      </button>
      <button
        className="icon-button"
        aria-label="Collapse notification"
        onClick={() => setExpanded(false)}
      >
        <X size={13} />
      </button>
    </div>
  );
}
