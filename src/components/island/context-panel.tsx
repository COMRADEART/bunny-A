import { useEffect, useRef, useState } from "react";
import { Activity, ChevronRight, MessageSquare, PanelRightClose, PanelRightOpen, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { appearanceFor } from "./character-style-model";
import { displayState, hostLive } from "./character-model";
import { CONNECTION_LABEL } from "./connection-model";
import { approvalCount, pendingApprovalItems } from "./approvals-model";
import { modelActivity, personalAgentRows, reviewsLabel, telemetryView } from "./context-model";
import { WEAPON_LABEL } from "@/lib/bunny-host/personal-agents";

const COLLAPSE_KEY = "bunny-a.context-panel.v1";

/** Collapsed state is a per-viewer convenience only. Storage can be blocked, so every access is guarded. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}
function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Storage is unavailable: the panel still works for this visit.
  }
}

/**
 * The right context panel: Personal Agents, reviews, Host state, what models are running, real Host telemetry and quick
 * actions that only open existing surfaces. Nothing here is a placeholder: no sample means "Sensor unavailable", never a figure.
 */
export function ContextPanel({ now }: { now: number }) {
  const systemReduced = usePrefersReducedMotion();

  const store = useIsland();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // The toggle is a different element in each state, so focus is moved to the new one after a toggle, not lost to the page.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  useEffect(() => {
    if (!focusToggle.current) return;
    focusToggle.current = false;
    toggleRef.current?.focus();
  }, [collapsed]);
  const toggle = () => {
    focusToggle.current = true;
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };
  const live = hostLive(store.connection, now || Date.now());
  const approvals = approvalCount(
    pendingApprovalItems({
      tasks: store.tasks,
      missions: store.missions?.missions ?? [],
      agents: store.agents?.agents ?? [],
      viewer: store.viewer?.kind === "device" ? "device" : "workstation",
    }),
  );

  if (collapsed) {
    return (
      <aside className="cx-panel" id="bunny-context-panel" data-collapsed="true" aria-label="Context panel">
        <button ref={toggleRef} className="icon-button" type="button" onClick={toggle} aria-label="Context panel" aria-expanded={false} aria-controls="bunny-context-panel">
          <PanelRightOpen size={18} />
        </button>
      </aside>
    );
  }

  const telemetry = telemetryView(store.samples, now || Date.now(), live);
  const running = modelActivity(store.tasks, live);
  const agents = personalAgentRows(store.personalAgents, live);

  return (
    <aside className="cx-panel" id="bunny-context-panel" data-collapsed="false" aria-label="Context panel">
      <div className="section-heading">
        <h2 style={{ fontSize: "var(--text-body)", margin: 0 }}>Context</h2>
        <button ref={toggleRef} className="icon-button" type="button" onClick={toggle} aria-label="Context panel" aria-expanded aria-controls="bunny-context-panel">
          <PanelRightClose size={18} />
        </button>
      </div>

      <section className="cx-section" aria-labelledby="cx-agents">
        <h3 id="cx-agents">Personal Agents</h3>
        {agents.map((row) => (
          <button
            key={row.slot}
            type="button"
            className="cx-row"
            data-bound={row.bound}
            onClick={() => store.setSheet("agents")}
            aria-label={`${row.name}, ${row.stateLabel}. Open Studio.`}
          >
            <WeaponCharacter
              key={store.personalAgents?.slots.find((slot) => slot.slot === row.slot)?.agentId ?? "unassigned"}
              weapon={row.weapon}
              state={displayState(
                row.bound ? (store.personalAgents?.slots.find((slot) => slot.slot === row.slot)?.presentation.state ?? "UNKNOWN") : "UNASSIGNED",
                live,
              )}
              slot={row.slot}
              size="compact" celebrate
              reduced={systemReduced || store.appearance.motion !== "full"}
              displayName={row.name}
              appearance={appearanceFor(store.characterAppearance, row.slot)}
            />
            <span className="cx-copy">
              <strong>{row.bound ? row.name : WEAPON_LABEL[row.weapon]}</strong>
              <small>{row.stateLabel}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
        {!agents.length && <p className="cx-muted">Personal Agents are not available from this Host yet.</p>}
      </section>

      <section className="cx-section" aria-labelledby="cx-reviews">
        <h3 id="cx-reviews">Reviews</h3>
        <button type="button" className="cx-row" onClick={() => store.setSheet("approvals")}>
          <ShieldCheck size={18} />
          <span className="cx-copy">
            <strong>{reviewsLabel(approvals, live)}</strong>
          </span>
          <ChevronRight size={14} />
        </button>
      </section>

      <section className="cx-section" aria-labelledby="cx-host">
        <h3 id="cx-host">Host</h3>
        <p className="cx-muted" role="status">
          {CONNECTION_LABEL[store.connection.state]}
        </p>
      </section>

      <section className="cx-section" aria-labelledby="cx-models">
        <h3 id="cx-models">Model activity</h3>
        {running.length === 0 && <p className="cx-muted">{live ? "Nothing is running on your Host." : "Host not live. Running work is not shown."}</p>}
        {running.map((row) => (
          <div className="cx-row" key={row.taskId} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
            <span className="cx-copy">
              <strong>{row.title}</strong>
              <small>
                {row.provider} · {row.model}
              </small>
            </span>
          </div>
        ))}
      </section>

      <section className="cx-section" aria-labelledby="cx-system">
        <h3 id="cx-system">System</h3>
        {telemetry.available ? (
          <dl className="cx-muted" style={{ margin: 0, display: "grid", gap: 4 }}>
            <div>CPU {telemetry.cpuPercent === null ? "not reported" : `${telemetry.cpuPercent}%`}</div>
            <div>Memory {telemetry.memoryUsedPercent === null ? "not reported" : `${telemetry.memoryUsedPercent}% used`}</div>
            <div>GPU {telemetry.gpuPercent === null ? "not reported" : `${telemetry.gpuPercent}%`}</div>
            <div>{telemetry.fresh ? "Live sample" : `Last sample ${new Date(telemetry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</div>
          </dl>
        ) : (
          <p className="cx-muted">{telemetry.label}</p>
        )}
      </section>

      <section className="cx-section" aria-labelledby="cx-actions">
        <h3 id="cx-actions">Quick actions</h3>
        <button type="button" className="cx-row" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }} onClick={() => { store.setComposeKind("task"); store.setSheet("chat"); }}>
          <MessageSquare size={16} />
          <span>New chat</span>
        </button>
        <button type="button" className="cx-row" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }} onClick={() => store.setSheet("activity")}>
          <Activity size={16} />
          <span>Open Activity</span>
        </button>
      </section>
      <p className="cx-muted" style={{ fontSize: "var(--text-xs)" }}>
        Closing this window does not stop a Mission. Work continues on your Host.
      </p>
    </aside>
  );
}
