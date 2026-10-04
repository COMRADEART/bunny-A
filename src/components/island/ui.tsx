import type { CSSProperties, ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Bot,
  Braces,
  Check,
  Circle,
  KeyRound,
  LoaderCircle,
  MousePointer2,
  Pause,
  Square,
  X,
} from "lucide-react";
import type { Availability, ProviderId, ProviderLive, TaskState } from "@/lib/orch/types";
import { ringPlacement } from "@/lib/bunny-host/usage";
import { useIsland } from "@/store/use-island";
import { finitePlan } from "./ui-model";
import type { OrchTask } from "@/lib/orch/types";
import { activityDetail, isPrivateEvent } from "./motion-model";
import { codexMissionExclusion, codexMissionStatus } from "@/lib/orch/compatibility";

export const NAMES: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
  ollama: "Ollama",
  opencode: "OpenCode",
  cline: "Cline",
  cursor: "Cursor",
};
export function HostHealthWarning() {
  const health=useIsland(state=>state.hostHealth);
  if(!health || health.operationalState==="healthy") return null;
  return <p className="host-health-warning" role="status">{health.operationalState==="degraded" ? health.unavailableSubsystems.includes("*") ? "Host degraded. New execution is unavailable until recovery." : "Host degraded. Dependent execution is unavailable; independent work may continue." : "Host is shutting down after a failure. New execution is refused."}</p>;
}
export const STATUS: Record<Availability, string> = {
  ready: "Ready",
  busy: "Busy",
  offline: "Offline",
  not_installed: "Not installed",
  authentication_required: "Auth required",
  rate_limited: "Rate limited",
  unavailable: "Unavailable",
  unknown: "Unknown",
};
export const STATES: Record<TaskState, string> = {
  queued: "Queued",
  routing: "Routing",
  waiting_for_approval: "Needs approval",
  launching: "Starting",
  running: "Working",
  waiting_for_input: "Needs input",
  waiting_for_agent_approval: "Agent approval needed",
  verifying: "Verifying",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};
const ICONS = {
  opencode: Braces,
  cline: Bot,
  cursor: MousePointer2,
};
export function BunnyMark() {
  return <img src="/favicon.svg" alt="" className="bunny-mark" aria-hidden="true" />;
}
export function ProviderIcon({ id }: { id: ProviderId }) {
  const Icon = id === "opencode" || id === "cline" || id === "cursor" ? ICONS[id] : null;
  return (
    <span className="agent-icon" data-provider={id}>
      {Icon ? (
        <Icon aria-hidden="true" size={20} />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {id === "claude" ? (
            Array.from({ length: 12 }, (_, i) => (
              <path
                key={i}
                d="M12 2.5V8.5"
                transform={`rotate(${i * 30} 12 12)`}
                strokeWidth="1.8"
              />
            ))
          ) : id === "codex" ? (
            Array.from({ length: 6 }, (_, i) => (
              <path
                key={i}
                d="M12 3.6C17.6.4 22.1 6.2 19.1 10.9L12 15V10.2L16.2 7.8"
                transform={`rotate(${i * 60} 12 12)`}
              />
            ))
          ) : (
            <>
              <path d="M7.5 9.5C5.5 6 5.5 1.5 7.5 2.5L9.5 8M14.5 8L16.5 2.5C18.5 1.5 18.5 6 16.5 9.5M7.5 9.5C5 11 4.5 14 5.5 17L4.5 21M16.5 9.5C19 11 19.5 14 18.5 17L19.5 21M5.5 16.5L8 15.5V21M18.5 16.5L16 15.5V21M8.5 13.5Q12 17 15.5 13.5" />
              <path d="M9 11.5H9.1M14.9 11.5H15" strokeWidth="2" />
            </>
          )}
        </svg>
      )}
    </span>
  );
}
function providerStatusText(provider: ProviderLive) {
  const directOnly = provider.id === "codex" && (codexMissionExclusion(provider, "read") || codexMissionExclusion(provider, "write"));
  return directOnly && provider.availability === "ready" ? "Direct tasks ready" : directOnly && provider.availability === "busy" ? "Direct task active" : STATUS[provider.availability];
}
export function ProviderStatus({ provider }: { provider: ProviderLive }) {
  const Icon =
    provider.availability === "authentication_required"
      ? KeyRound
      : provider.availability === "busy"
        ? LoaderCircle
        : Circle;
  return (
    <span className="provider-status" data-status={provider.availability}>
      <Icon aria-hidden="true" size={11} />
      {providerStatusText(provider)}
    </span>
  );
}
export function TaskBadge({ state }: { state: TaskState }) {
  const Icon =
    state === "completed"
      ? Check
      : state === "failed"
        ? X
        : state === "stopped"
          ? Square
          : state === "paused"
            ? Pause
            : Circle;
  return (
    <span className="task-badge" data-state={state}>
      <Icon aria-hidden="true" size={12} />
      {STATES[state]}
    </span>
  );
}
export const reportTime = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Unavailable";
export function usageDescription(provider: ProviderLive) {
  return `${NAMES[provider.id]} · ${providerStatusText(provider)}\n${provider.id === "ollama" ? `Model: ${provider.current_model ?? "Unavailable"}\nVRAM: ${provider.vram ?? "Unavailable"}\nTokens/sec: ${provider.tokens_per_sec ?? "Unavailable"}` : (provider.usageWindows ?? []).map((w) => `${w.label}: ${w.usedPercent}% used · reset ${reportTime(w.resetsAt)}`).join("\n") || "Quota unavailable"}\n${provider.active_jobs} active jobs · Version ${provider.version ?? "unavailable"}${provider.id === "codex" ? `\nMission execution: ${codexMissionStatus(provider)}` : ""}`;
}
export function ProviderMark({
  provider,
  interactive = false,
}: {
  provider: ProviderLive;
  interactive?: boolean;
}) {
  const ring = ringPlacement(provider.id === "ollama" ? [] : provider.usageWindows);
  const title = usageDescription(provider);
  const mark = (
    <span
      className="usage-mark"
      data-status={provider.availability}
      data-provider={provider.id}
      title={title}
      style={
        {
          "--outer": `${Math.max(0, Math.min(100, ring.outer?.usedPercent ?? 0)) * 3.6}deg`,
          "--inner": `${Math.max(0, Math.min(100, ring.inner?.usedPercent ?? 0)) * 3.6}deg`,
        } as CSSProperties
      }
    >
      {ring.outer ? <span className="usage-ring outer" /> : null}
      {ring.inner ? <span className="usage-ring inner" /> : null}
      <ProviderIcon id={provider.id} />
      <span className="provider-indicator" aria-hidden="true">
        {provider.availability === "authentication_required" ? (
          <KeyRound size={8} />
        ) : provider.availability === "busy" ? (
          <LoaderCircle size={9} />
        ) : provider.availability === "ready" ? (
          <Check size={8} />
        ) : (
          <X size={8} />
        )}
      </span>
    </span>
  );
  if (!interactive) return mark;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="provider-trigger" aria-label={title}>
          {mark}
        </button>
      </Popover.Trigger>
      <Popover.Portal
        container={
          typeof document === "undefined"
            ? undefined
            : document.querySelector<HTMLElement>(".bunny-app")
        }
      >
        <Popover.Content className="provider-popover glass" sideOffset={12} collisionPadding={16}>
          <header>
            <ProviderIcon id={provider.id} />
            <div>
              <strong>{NAMES[provider.id]}</strong>
              <ProviderStatus provider={provider} />
            </div>
            <Popover.Close className="icon-button" aria-label="Close provider details">
              <X size={16} />
            </Popover.Close>
          </header>
          <ProviderFacts provider={provider} />
          <p className="caption">{provider.detail}</p>
          <Popover.Arrow className="popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function ProviderFacts({
  provider,
  compact = false,
}: {
  provider: ProviderLive;
  compact?: boolean;
}) {
  return (
    <>
      <dl className="fact-list">
        {provider.id === "codex" ? (
          <div>
            <dt>Mission execution</dt>
            <dd>{codexMissionStatus(provider)}</dd>
          </div>
        ) : null}
        {provider.id === "ollama" ? (
          <>
            <div>
              <dt>Model</dt>
              <dd>{provider.current_model ?? "Unavailable"}</dd>
            </div>
            {!compact ? (
              <div>
                <dt>VRAM</dt>
                <dd>{provider.vram ?? "Unavailable"}</dd>
              </div>
            ) : null}
            {!compact ? (
              <div>
                <dt>Model RAM</dt>
                <dd>Unavailable</dd>
              </div>
            ) : null}
            <div>
              <dt>Tokens/sec</dt>
              <dd>
                {provider.tokens_per_sec == null
                  ? "Unavailable"
                  : provider.tokens_per_sec.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt>Generation</dt>
              <dd>{provider.active_jobs > 0 ? "Active" : "Idle"}</dd>
            </div>
          </>
        ) : (provider.usageWindows ?? []).length ? (
          (provider.usageWindows ?? []).map((w) => (
            <div key={`${w.kind}-${w.label}`}>
              <dt>
                {w.kind === "short" ? "Short window" : w.kind === "weekly" ? "Weekly" : w.label}
                {!compact ? <small>Resets {reportTime(w.resetsAt)}</small> : null}
              </dt>
              <dd>{w.usedPercent}%</dd>
            </div>
          ))
        ) : (
          <div>
            <dt>Provider quota</dt>
            <dd>Unavailable</dd>
          </div>
        )}
        <div>
          <dt>Active jobs</dt>
          <dd>{provider.active_jobs}</dd>
        </div>
        {!compact ? (
          <div>
            <dt>Version</dt>
            <dd>{provider.version ?? "Unavailable"}</dd>
          </div>
        ) : null}
      </dl>
      {provider.id === "codex" && !compact ? (
        <p className="caption">{provider.securityCompatibility?.compatibilityClass === "VALIDATED" && codexMissionStatus(provider) === "Validated" ? `Mission security policy ${provider.securityCompatibility.policyVersion} validated for read and write access.` : codexMissionExclusion(provider, "read") ?? codexMissionExclusion(provider, "write")}</p>
      ) : null}
      {provider.usageObservedAt && provider.id !== "ollama" ? (
        <p className="caption">
          Reported {reportTime(provider.usageObservedAt)} ·{" "}
          {compact
            ? "Provider report"
            : (provider.usageCapabilities?.source ?? provider.usage_note)}
        </p>
      ) : null}
    </>
  );
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <BunnyMark />
      <h3>{title}</h3>
      {detail ? <p>{detail}</p> : null}
      {children}
    </div>
  );
}
export function ActivityDots() {
  return (
    <span className="activity-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
export function TaskActivity({ task, expanded = false }: { task: OrchTask; expanded?: boolean }) {
  const plan = finitePlan(task.progress);
  return (
    <div className="task-activity">
      <div className="activity-label">
        <ActivityDots />
        <span>
          {task.latestEvent && isPrivateEvent(task.latestEvent.type)
            ? "Working…"
            : (task.latestEvent?.label ?? (task.state === "verifying" ? "Verifying" : "Working…"))}
        </span>
      </div>
      {task.latestEvent?.detail ? (
        <p className={expanded ? "activity-text expanded" : "activity-text"}>
          {activityDetail(task.latestEvent.type, task.latestEvent.detail)}
        </p>
      ) : null}
      {plan ? (
        <div className="finite-progress">
          <progress aria-label="Plan progress" max={plan.total} value={plan.completed} />
          <span>
            {plan.completed} / {plan.total} steps
          </span>
          {plan.current ? <small>{plan.current}</small> : null}
        </div>
      ) : null}
    </div>
  );
}
export function Notice() {
  const store = useIsland();
  return store.notice ? (
    <div className="bunny-toast glass" role="status">
      <span>{store.notice}</span>
      <button
        className="icon-button"
        onClick={store.dismissNotice}
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  ) : null;
}
