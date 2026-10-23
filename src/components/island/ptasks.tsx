import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { isDevice } from "./remote-view-model";
import { ptaskRows, type PtaskControl, type PtaskTone } from "./ptask-model";

const clockText = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// Reuses the agent rows' existing state colours (mission.css) instead of adding styles.
const STATE_STYLE: Record<PtaskTone, string> = { ok: "COMPLETED", warn: "WAITING_FOR_USER", danger: "FAILED", neutral: "PAUSED", active: "RUNNING" };
const CONTROL_LABEL: Record<Exclude<PtaskControl, "reconcile">, string> = { pause: "Pause", resume: "Resume", cancel: "Cancel", approve: "Approve" };

/**
 * MA4-S2-T1 background tasks: what the Host is doing now (or last did, labelled with its time when the view is not live),
 * with the controls this viewer may use. The workstation also sets the background and restart policy here.
 */
export function PersistentTasks({ phone = false }: { phone?: boolean }) {
  const store = useIsland();
  const [reconciling, setReconciling] = useState<string | null>(null);
  const snapshot = store.persistentTasks;
  const workstation = !isDevice(store.viewer);
  const live = store.canAct();
  const rows = ptaskRows(snapshot, { live, snapshotAt: store.connection.snapshotAt, workstation, format: clockText });
  if (!snapshot || (!rows.length && !workstation)) return null;
  const notices = workstation ? snapshot.notifications.filter(n => n.delivered && !n.acknowledged).slice(0, 3) : [];
  const act = (control: PtaskControl, id: string, version?: number) => void store.ptaskCommand(`ptask.${control}`, control === "approve" ? { id, version } : { id });
  const policy = snapshot.policy;
  const setPolicy = (patch: Partial<typeof policy>) => void store.ptaskCommand("ptask.policy", { policy: { ...policy, ...patch } });
  const section = phone ? "pc-section" : "today-section agents-section";
  return (
    <section className={section} data-testid="persistent-tasks" aria-labelledby="ptask-heading">
      <div className={phone ? "pc-section-head" : "section-heading"}>
        <h2 id="ptask-heading" className={phone ? "pc-h2" : "eyebrow"}>Background tasks</h2>
        <span className="caption">{rows.length}</span>
      </div>
      {snapshot.readOnly ? <p className="caption" role="alert">{snapshot.readOnly}</p> : null}
      {notices.map(n => (
        <p key={n.key} className="caption" role="status">
          {n.text}{" "}
          <button type="button" className={phone ? "pc-link" : "btn quiet"} disabled={!live} onClick={() => void store.ptaskCommand("ptask.notification.ack", { key: n.key })}>Dismiss</button>
        </p>
      ))}
      {rows.length ? (
        <ul className={phone ? "pc-card" : "agent-run-list glass"}>
          {rows.map(row => {
            const view = snapshot.tasks.find(t => t.id === row.id);
            const version = view && !view.corrupt ? view.version : undefined;
            return (
              <li key={row.id} data-tone={row.tone} data-state={STATE_STYLE[row.tone]}>
                <div className="agent-run-title">
                  <strong>{row.title}</strong>
                  <small>{row.label}{row.progress ? ` · ${row.progress}` : ""}</small>
                </div>
                {row.detail ? <p className="caption">{row.detail}</p> : null}
                {row.evidence ? <p className="caption">Evidence: {row.evidence}</p> : null}
                {row.note ? <p className="caption">{row.note}</p> : null}
                {row.controls.length ? (
                  <div className="actions">
                    {row.controls.map(control => control === "reconcile" ? (
                      <button key={control} type="button" className={phone ? "pc-btn" : "btn secondary"} onClick={() => setReconciling(reconciling === row.id ? null : row.id)}>Resolve…</button>
                    ) : (
                      <button key={control} type="button" className={phone ? "pc-btn" : control === "cancel" ? "btn quiet" : "btn secondary"} onClick={() => act(control, row.id, version)}>{CONTROL_LABEL[control]}</button>
                    ))}
                  </div>
                ) : null}
                {reconciling === row.id && row.controls.includes("reconcile") ? (
                  <div className="actions" role="group" aria-label="What happened to the uncertain action?">
                    <button type="button" className="btn secondary" onClick={() => { setReconciling(null); void store.ptaskCommand("ptask.reconcile", { id: row.id, decision: "happened" }); }}>It happened</button>
                    <button type="button" className="btn secondary" onClick={() => { setReconciling(null); void store.ptaskCommand("ptask.reconcile", { id: row.id, decision: "not_happened" }); }}>It did not happen — try once more</button>
                    <button type="button" className="btn quiet" onClick={() => { setReconciling(null); void store.ptaskCommand("ptask.reconcile", { id: row.id, decision: "abandon" }); }}>Stop the task</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="caption">No background tasks.</p>
      )}
      {workstation ? (
        <div className="actions" role="group" aria-label="Background task policy">
          <label className="caption">
            <input type="checkbox" checked={policy.background} disabled={!live} onChange={e => setPolicy({ background: e.target.checked })} /> Keep working while Bunny-A's windows are closed (the Host must stay running)
          </label>
          <label className="caption">
            <input type="checkbox" checked={policy.resumeOnStart} disabled={!live} onChange={e => setPolicy({ resumeOnStart: e.target.checked })} /> Continue tasks after Bunny-A restarts
          </label>
        </div>
      ) : null}
    </section>
  );
}
