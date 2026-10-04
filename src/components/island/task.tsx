import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Folder,
  Mic,
  Play,
  ShieldCheck,
  Square,
  Terminal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { liveProviders, useIsland } from "@/store/use-island";
import type { Mode, OrchTask, ProviderId } from "@/lib/orch/types";
import { Empty, NAMES, ProviderIcon, ProviderStatus, TaskActivity, TaskBadge } from "./ui";
import {
  elapsed,
  finitePlan,
  isActive,
  verifiedFile,
  usesCloudModel,
  conflictsWithLocalOnly,
} from "./ui-model";
import {
  ArtifactPreview,
  ProviderComparison,
  RoutingGraph,
  TaskJourney,
  TaskReplay,
  ActivityRibbon,
} from "./motion";
import { publicTaskLogs } from "./motion-model";
import { ActivityTimeline } from "./activity";
import { taskStatus } from "@/lib/bunny-host/presentation";
import { useVoiceInput, VoicePanel } from "./voice";

export function openTask(id: string) {
  useIsland.setState({ decisionTaskId: id, sheet: "task" });
}
/** Task / Mission switch; shown only when the Host reports missions enabled. */
function ComposeKindToggle() {
  const store = useIsland();
  if (!store.missions?.enabled) return null;
  return (
    <div className="mode-selector compose-kind" aria-label="Request kind">
      {(["task", "mission"] as const).map((kind) => (
        <button
          type="button"
          key={kind}
          aria-pressed={store.composeKind === kind}
          onClick={() => store.setComposeKind(kind)}
        >
          {kind === "task" ? "Task" : "Mission"}
        </button>
      ))}
    </div>
  );
}
export function Composer({ phone = false }: { phone?: boolean }) {
  const store = useIsland();
  const providers = liveProviders(store);
  const [advanced, setAdvanced] = useState(false);
  const voice = useVoiceInput();
  if (voice.state === "listening" || voice.state === "starting")
    return <VoicePanel state={voice.state} transcript={voice.transcript} onStop={voice.stop} />;
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        store.submit();
      }}
    >
      <p className="eyebrow">{phone ? "New task" : "Ask Bunny"}</p>
      <ComposeKindToggle />
      <h2>{phone ? "What should Bunny do?" : "What do you want Bunny to do?"}</h2>
      <label className="sr-only" htmlFor="task-prompt">
        Task description
      </label>
      <textarea
        id="task-prompt"
        autoFocus
        value={store.prompt}
        rows={4}
        maxLength={16000}
        placeholder={
          store.composeKind === "mission" && store.missions?.enabled
            ? "Describe the outcome. Bunny plans the steps and asks once before starting."
            : "Describe a task. Bunny will find the right agent."
        }
        onChange={(e) => store.setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            store.submit();
          }
        }}
      />
      <div className="composer-shortcuts" aria-label="Task shortcuts">
        {[
          { label: "Deep Research", prompt: "Research ", mode: "deep" },
          { label: "Create PDF", prompt: "Create a PDF report about ", mode: "balanced" },
          { label: "Build Website", prompt: "Build a website for ", mode: "balanced" },
        ].map((shortcut) => (
          <button
            type="button"
            key={shortcut.label}
            onClick={() => {
              store.setPrompt(shortcut.prompt);
              store.setMode(shortcut.mode as Mode);
              document.getElementById("task-prompt")?.focus();
            }}
          >
            {shortcut.label}
          </button>
        ))}
        <button
          type="button"
          className="voice-button"
          aria-label="Voice input"
          onClick={voice.start}
        >
          <Mic size={15} />
        </button>
      </div>
      <div className="mode-selector" aria-label="Task depth">
        {(["fast", "balanced", "deep"] as Mode[]).map((mode) => (
          <button
            type="button"
            key={mode}
            aria-pressed={store.mode === mode}
            onClick={() => store.setMode(mode)}
          >
            {mode[0].toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
      <div className="composer-options">
        <label>
          Project
          <select
            aria-label="Task project"
            value={store.projectId ?? ""}
            onChange={(e) => store.setProjectId(e.target.value || null)}
          >
            <option value="">Auto</option>
            {store.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!phone || advanced ? (
          <>
            <label>
              Route
              <select
                aria-label="Task route"
                value={store.override}
                onChange={(e) => store.setOverride(e.target.value as ProviderId | "auto")}
              >
                <option value="auto">Auto</option>
                {providers.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={!["ready", "busy"].includes(p.availability)}
                  >
                    {NAMES[p.id]}
                    {!["ready", "busy"].includes(p.availability) ? " · unavailable" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="local-toggle"
              role="switch"
              aria-checked={store.localOnly}
              onClick={() => store.setLocalOnly(!store.localOnly)}
            >
              Local only <span>{store.localOnly ? "On" : "Off"}</span>
            </button>
          </>
        ) : (
          <button type="button" className="quiet-button" onClick={() => setAdvanced(true)}>
            Options <ChevronDown size={12} />
          </button>
        )}
      </div>
      <div className="composer-bottom">
        <span className="caption">
          {phone ? "Review the route before running." : "Ctrl + Enter to route"}
        </span>
        {store.host === "online" ? (
          <button
            className="btn primary"
            type="submit"
            disabled={!store.prompt.trim() || store.submitting}
          >
            {phone ? "Route" : ""}
            <ArrowRight size={20} />
            <span className="sr-only">{phone ? " task" : "Route task"}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={!store.prompt.trim() || store.pairingRequired}
            onClick={store.queueDraft}
          >
            Queue task <ArrowRight size={16} />
          </button>
        )}
      </div>
      {store.host !== "online" ? (
        <p className="offline-note">
          {store.pairingRequired
            ? "Pair this device to route a task."
            : store.host === "sleeping"
              ? "Your workstation is sleeping. Queue a draft until it wakes."
              : "Workstation unreachable. Drafts stay on this device until you review them."}
        </p>
      ) : null}
    </form>
  );
}
export function Routing({ task, pending = true }: { task?: OrchTask; pending?: boolean }) {
  const store = useIsland();
  const providers = liveProviders(store);
  return (
    <div className="routing-view" role="status">
      <RoutingGraph decision={task?.decision} selected={task?.provider} pending={pending} />
      <p className="eyebrow">BunnyRouter</p>
      <h2>
        {pending
          ? "Choosing the best agent…"
          : `${NAMES[task?.provider ?? "codex"]} is the best match.`}
      </h2>
      <ul className="routing-checks">
        <li>
          <Check size={13} />
          Capabilities ·{" "}
          {providers.some((p) => p.capabilities?.length)
            ? "Host discovery available"
            : "Awaiting Host"}
        </li>
        <li>
          <Check size={13} />
          Availability ·{" "}
          {providers.filter((p) => ["ready", "busy"].includes(p.availability)).length} eligible by
          current health
        </li>
        <li>
          <Check size={13} />
          History ·{" "}
          {store.performance.length
            ? "Observed task outcomes available"
            : "No outcome evidence yet"}
        </li>
        <li>
          <Check size={13} />
          Usage ·{" "}
          {providers.some((p) => p.usageWindows?.length)
            ? "Reported windows available"
            : "Unavailable"}
        </li>
        <li>
          <ShieldCheck size={13} />
          Constraints ·{" "}
          {task?.constraints?.localOnly || store.localOnly
            ? "Local only"
            : "Your approved routing preferences"}
        </li>
      </ul>
      <p className="caption">
        {pending
          ? "Scores appear when the Host returns its decision."
          : "Routing scores, not success probabilities."}
      </p>
      <span className="caption">
        <ShieldCheck size={13} />
        You’ll review the recommendation before anything runs.
      </span>
    </div>
  );
}
export function Approval({ task, phone = false }: { task: OrchTask; phone?: boolean }) {
  const store = useIsland();
  const providers = liveProviders(store);
  const provider = providers.find((p) => p.id === task.provider)!;
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState(false);
  const cloud = usesCloudModel(task);
  const conflict = conflictsWithLocalOnly(task);
  const ready =
    !conflict && store.host === "online" && ["ready", "busy"].includes(provider.availability);
  const action = async (type: "run" | "stop") => {
    setPending(true);
    try {
      await store[type](task.id);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="approval-view">
      <p className="eyebrow">{phone ? "Recommended" : "Your approval"}</p>
      <h2>{phone ? NAMES[task.provider] : `Use ${NAMES[task.provider]}?`}</h2>
      {cloud ? (
        <p className="caption">{task.model} · runs through Ollama’s cloud service.</p>
      ) : null}
      {conflict ? (
        <p className="offline-note" role="alert">
          This cloud model conflicts with your local-only constraint. Change the route or cancel.
        </p>
      ) : null}
      {task.decision.requirements?.length ? (
        <p className="requirements">{task.decision.requirements.join(" · ")}</p>
      ) : null}
      <div className="recommendation">
        <ProviderIcon id={task.provider} />
        <div>
          <strong>{NAMES[task.provider]}</strong>
          <small>
            {task.manual ? "Your selection" : "Best match"} ·{" "}
            {provider.availability === "ready"
              ? "Ready"
              : provider.availability === "busy"
                ? "Busy"
                : "Unavailable"}
          </small>
        </div>
        <ShieldCheck size={18} />
      </div>
      <details className="route-explanation">
        <summary>Why this agent</summary>
        <p className="route-reason">
          {cloud
            ? task.decision.reason.replace("Stays on this machine. ", "")
            : task.decision.reason}
        </p>
        <ul className="route-reasons">
          {(task.decision.reasons?.length
            ? task.decision.reasons
            : (task.decision.requirements ?? [])
          )
            .slice(0, 3)
            .map((reason) => (
              <li key={reason}>
                <Check size={13} />
                <span>{reason}</span>
              </li>
            ))}
        </ul>
      </details>
      <TaskJourney task={task} />
      {changing ? (
        <ProviderComparison
          task={task}
          onSelect={(id) => {
            store.retarget(task.id, id);
            setChanging(false);
          }}
        />
      ) : null}
      <details className="route-scores">
        <summary>
          Routes considered <ChevronDown size={12} />
        </summary>
        <RoutingGraph decision={task.decision} selected={task.provider} />
        <ul>
          {task.decision.scores.map((s) => (
            <li key={s.provider}>
              <span>{NAMES[s.provider]}</span>
              <span className="score">{s.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <p className="caption">Routing scores, not success probabilities.</p>
        {task.decision.excluded?.length ? (
          <details>
            <summary>Unavailable routes</summary>
            {task.decision.excluded.map((p) => (
              <p key={p.provider} className="caption">
                {NAMES[p.provider]} · {p.reason}
              </p>
            ))}
          </details>
        ) : null}
      </details>
      <div className="actions">
        <button
          type="button"
          className="btn quiet"
          disabled={pending}
          onClick={() => void action("stop")}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={pending}
          onClick={() => setChanging(!changing)}
        >
          Change
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!ready || pending}
          onClick={() => void action("run")}
        >
          <Play size={14} />
          Approve &amp; Run
        </button>
      </div>
      {!ready ? (
        <p className="caption">
          {store.host !== "online"
            ? "Reconnect your workstation to run this task."
            : provider.detail}
        </p>
      ) : null}
    </section>
  );
}
export function TaskDetail({ now }: { now: number }) {
  const store = useIsland();
  const task = store.tasks.find((t) => t.id === store.decisionTaskId);
  const [copied, setCopied] = useState(false);
  if (!task)
    return (
      <Empty
        title={store.host === "online" ? "Task unavailable" : "Reconnect to view this task"}
        detail="Your task history belongs to the workstation."
      />
    );
  if (task.state === "waiting_for_approval")
    return (
      <div className="detail-approval glass">
        <Approval task={task} />
      </div>
    );
  const file = verifiedFile(task);
  const progress = finitePlan(task.progress);
  const provider = liveProviders(store).find((p) => p.id === task.provider)!;
  const role=task.mission ? store.missions?.missions.find(mission=>mission.id===task.mission?.missionId)?.steps.find(step=>step.id===task.mission?.stepId)?.role : null;
  return (
    <article className="task-detail glass">
      <header className="task-detail-header">
        <div className="task-heading">
          <ProviderIcon id={task.provider} />
          <div>
            <p className="eyebrow">
              {role ? `${role} · ` : ""}{NAMES[task.provider]} · {elapsed(task, now)}
            </p>
            <h2>{task.title}</h2>
          </div>
        </div>
        <TaskBadge state={task.state} task={task} />
      </header>
      <TaskJourney task={task} />
      <div className="verification-card" data-passed={task.verification?.passed ?? "unknown"} role="status">
        <ShieldCheck size={16} aria-hidden="true" /><div><strong>{taskStatus(task).verification}</strong><p className="caption">Provider turns, task completion and independent verification are separate.</p></div>
      </div>
      <ActivityRibbon
        task={task}
        onOpen={() =>
          document.getElementById("task-activity")?.scrollIntoView({
            behavior:
              store.appearance.motion === "full" &&
              !window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "smooth"
                : "instant",
            block: "nearest",
          })
        }
      />
      {isActive(task) ? <TaskActivity task={task} expanded /> : null}
      {task.error ? (
        <div className="error-card" role="alert">
          <strong>Task failed</strong>
          <p>{task.error}</p>
        </div>
      ) : null}
      {progress ? (
        <section>
          <h3 className="eyebrow">Plan</h3>
          <p>
            {progress.completed} / {progress.total} steps completed
          </p>
        </section>
      ) : null}
      <section id="task-activity">
        <ActivityTimeline taskId={task.id} limit={24} />
      </section>
      {file ? (
        <section>
          <h3 className="eyebrow">Files</h3>
          <ArtifactPreview task={task} />
        </section>
      ) : null}
      {!isActive(task) ? (
        <details className="replay-disclosure">
          <summary>Replay this task</summary>
          <TaskReplay task={task} />
        </details>
      ) : null}
      <section>
        <h3 className="eyebrow">Routing</h3>
        <p>
          Selected: {NAMES[task.provider]}
          {task.manual ? " · manual selection" : ""}
        </p>
        <p className="caption">
          {usesCloudModel(task)
            ? task.decision.reason.replace("Stays on this machine. ", "")
            : task.decision.reason}
        </p>
        {usesCloudModel(task) ? (
          <p className="caption">{task.model} · runs through Ollama’s cloud service.</p>
        ) : null}
        {task.decision.alternatives.map((a) => (
          <p className="caption" key={a.provider}>
            Alternative: {NAMES[a.provider]} · {a.note} · score {a.score.toFixed(2)}
          </p>
        ))}
        <div className="detail-meta">
          <span>
            <Folder size={14} />
            {task.cwd || "Working folder unavailable"}
          </span>
          <span>{task.model || "Model unavailable"}</span>
        </div>
      </section>
      {task.output ? (
        <section>
          <div className="section-heading">
            <h3 className="eyebrow">{isActive(task) ? "Latest output" : "Result"}</h3>
            <button
              className="quiet-button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(task.output)
                  .then(() => setCopied(true))
                  .catch(() => store.note("Copy unavailable; select the result text."))
              }
            >
              {copied ? <Check size={14} /> : <Clipboard size={14} />}{" "}
              {copied ? "Copied" : "Copy result"}
            </button>
          </div>
          <pre className="output-panel">{task.output}</pre>
          {task.verification ? (
            <p className="verification" data-passed={task.verification.passed}>
              {task.verification.passed ? <Check size={14} /> : <Square size={14} />}{" "}
              {taskStatus(task).verification}
            </p>
          ) : null}
        </section>
      ) : null}
      {!isActive(task) && !task.output ? <p className="caption">Provider transcripts remain on the Host. Files and independent verification are shown above.</p> : null}
      <details className="raw-logs">
        <summary>Technical details & logs</summary>
        <dl className="fact-list">
          <div>
            <dt>Host-owned session</dt>
            <dd>{task.sessionId ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Process</dt>
            <dd>{task.pid ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Exit code</dt>
            <dd>{task.exitCode ?? "Unavailable"}</dd>
          </div>
        </dl>
        <ProviderStatus provider={provider} />
        <pre>
          {publicTaskLogs(task, store.events)
            .map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.line}`)
            .join("\n")}
        </pre>
      </details>
      <footer className="actions">
        {isActive(task) ? (
          <>
            <button
              className="btn secondary"
              disabled
              title={
                provider.features?.terminalAttachment.note ?? "No supported terminal attachment"
              }
            >
              <Terminal size={15} />
              Terminal unavailable
            </button>
            <button className="btn danger" onClick={() => void store.stop(task.id)}>
              <Square size={14} />
              Stop task
            </button>
          </>
        ) : (
          <>
            <button
              className="btn quiet"
              aria-pressed={task.feedback === "positive"}
              onClick={() => store.feedback(task.id, "positive")}
            >
              <ThumbsUp size={14} />
              Worked
            </button>
            <button
              className="btn quiet"
              aria-pressed={task.feedback === "negative"}
              onClick={() => store.feedback(task.id, "negative")}
            >
              <ThumbsDown size={14} />
              Didn’t work
            </button>
            <button className="btn secondary" onClick={() => store.restart(task.id)}>
              Route again <ArrowRight size={14} />
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
