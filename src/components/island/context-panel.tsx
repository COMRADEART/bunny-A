import { useEffect, useRef } from "react";
import { Activity, ChevronRight, MessageSquare, PanelRightClose, PanelRightOpen, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { appearanceFor } from "./character-style-model";
import { displayState, hostLive } from "./character-model";
import { CONNECTION_LABEL } from "./connection-model";
import { approvalCount, pendingApprovalItems } from "./approvals-model";
import { modelActivity, personalAgentRows, reviewsLabel, telemetryView } from "./context-model";
import { WEAPON_LABEL } from "@/lib/bunny-host/personal-agents";
import { drawerEdgeFor } from "@/lib/bunny-host/widgets";
import { escapeClosesDrawer } from "./workspace-layout";

/**
 * The right context panel: Personal Agents, reviews, Host state, what models are running, real Host telemetry and quick
 * actions that only open existing surfaces. Nothing here is a placeholder: no sample means "Sensor unavailable", never a figure.
 *
 * Placement comes from the shared workspace allocation model (workspace-layout.ts): "inline" is the sticky panel of the
 * wide shell, "drawer" is the same panel as a fixed drawer at narrow widths — focus moves into it when it opens, Escape
 * closes it and focus returns to the reopen control. The collapsed rail is the owner's own preference either way.
 * E6A: "dock" is the phone profile's expanded in-flow dock (workspace-layout.ts): it is not an overlay, but Escape from
 * inside it collapses back to the rail — the same toggle, so focus lands on the reopen control just like the drawer.
 */
export function ContextPanel({
  now, placement, collapsed, onToggle,
}: {
  now: number;
  placement: "inline" | "drawer" | "dock";
  collapsed: boolean;
  onToggle: () => void;
}) {
  const systemReduced = usePrefersReducedMotion();

  const store = useIsland();
  const panelRef = useRef<HTMLElement>(null);
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
    onToggle();
  };
  // Escape only from inside the drawer or the expanded phone dock (shared guard): the composer and real dialogs keep
  // their own Escape.
  useEffect(() => {
    if (placement !== "drawer" && placement !== "dock") return;
    if (collapsed) return;
    const onKey = (event: KeyboardEvent) => {
      if (!escapeClosesDrawer(event, panelRef.current?.contains(document.activeElement) ?? false)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placement, collapsed, onToggle]);
  // The drawer always opens on the edge away from the Notch, like the widget drawer.
  const edge = drawerEdgeFor(store.shownWidgets().notchEdge);
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
    // The owner's collapsed rail: it never demotes (it is already the collapsed form) and keeps its re-open control.
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
    <aside
      className={placement === "drawer" ? "cx-panel ws-drawer" : "cx-panel"}
      id="bunny-context-panel"
      data-collapsed="false"
      data-open={placement === "drawer" ? "true" : undefined}
      data-edge={placement === "drawer" ? edge : undefined}
      ref={panelRef}
      aria-label="Context panel"
    >
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
