import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { isDevice } from "./remote-view-model";
import { ptaskRows, type PtaskControl, type PtaskRow, type PtaskTone } from "./ptask-model";

const clockText = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// Reuses the agent rows' existing state colours (mission.css) instead of adding styles.
const STATE_STYLE: Record<PtaskTone, string> = { ok: "COMPLETED", warn: "WAITING_FOR_USER", danger: "FAILED", neutral: "PAUSED", active: "RUNNING" };
const CONTROL_LABEL: Record<Exclude<PtaskControl, "reconcile">, string> = { pause: "Pause", resume: "Resume", cancel: "Cancel", approve: "Approve", approve_action: "Approve this action", deny_action: "Deny", inspect: "Inspect details" };
type Context = { task: string; step: string; role: string; operation: string; sideEffect: string; scope: string[]; expected: string; recovery: string; approvalExpiresAt: number | null; taskExpiresAt: number; schedule: string | null; goal: string | null };
type Inspected = { id: string; action: { preview: string; data: string[]; changes: string[]; target: string; expiresAt: number } | null; context?: Context | null; receipts: { seq: number; at: number; kind: string; event: string; detail: string }[] };

/**
 * MA4-S2-T1 background tasks: what the Host is doing now (or last did, labelled with its time when the view is not live),
 * with the controls this viewer may use. The workstation also sets the background and restart policy here.
 */
export function PersistentTasks({ phone = false }: { phone?: boolean }) {
  const store = useIsland();
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const snapshot = store.persistentTasks;
  const workstation = !isDevice(store.viewer);
  const live = store.canAct();
  const rows = ptaskRows(snapshot, { live, snapshotAt: store.connection.snapshotAt, workstation, format: clockText });
  if (!snapshot || (!rows.length && !workstation)) return null;
  const notices = workstation ? snapshot.notifications.filter(n => n.delivered && !n.acknowledged).slice(0, 3) : [];
  const act = (control: PtaskControl, row: PtaskRow, version?: number) => {
    const id = row.id, pending = row.pending;
    // MA4-S2-T2 Approval Center: the decision names the exact action and the payload hash that was shown.
    if (control === "approve_action" && pending) { setInspected(null); return void store.ptaskCommand("action.approve", { id, actionId: pending.actionId, payloadSha256: pending.payloadSha256 }); }
    if (control === "deny_action" && pending) { setInspected(null); return void store.ptaskCommand("action.deny", { id, actionId: pending.actionId }); }
    if (control === "inspect") {
      if (inspected?.id === id) return setInspected(null);
      return void store.ptaskCommand("action.inspect", { id }).then(reply => { const data = reply?.data as Omit<Inspected, "id"> | undefined; if (data) setInspected({ id, ...data }); });
    }
    void store.ptaskCommand(`ptask.${control}`, control === "approve" ? { id, version } : { id });
  };
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
                      <button key={control} type="button" className={phone ? "pc-btn" : control === "cancel" || control === "deny_action" ? "btn quiet" : "btn secondary"} onClick={() => act(control, row, version)}>{CONTROL_LABEL[control]}</button>
                    ))}
                  </div>
                ) : null}
                {inspected?.id === row.id ? (
                  <div className="caption" role="region" aria-label="Action details">
                    {inspected.action && inspected.context ? (
                      // MA4-S2-T3R: who asks, for what, touching what, and what recovery looks like — before the decision.
                      <dl className="proactive-preview">
                        {([["Requested by", `${inspected.context.role} agent, ${inspected.context.step}`], ["Task", inspected.context.task],
                          ["Started by", [inspected.context.schedule && `schedule “${inspected.context.schedule}”`, inspected.context.goal && `goal “${inspected.context.goal}”`].filter(Boolean).join(" for ") || "you"],
                          ["Operation", inspected.context.operation], ["Kind of effect", inspected.context.sideEffect], ["Exact scope", inspected.context.scope.join("; ") || "none"],
                          ["Expected outcome", inspected.context.expected], ["If it goes wrong", inspected.context.recovery],
                          ["This approval expires", inspected.context.approvalExpiresAt ? clockText(inspected.context.approvalExpiresAt) : "when the task ends"]] as [string, string][])
                          .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                      </dl>
                    ) : null}
                    {inspected.action ? (
                      <>
                        <p><strong>{inspected.action.target}</strong> · expires {clockText(inspected.action.expiresAt)}</p>
                        {inspected.action.data.map(line => <p key={line}>Reads or sends: {line}</p>)}
                        {inspected.action.changes.map(line => <p key={line}>Changes: {line}</p>)}
                        <pre className="glass" style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{inspected.action.preview}</pre>
                      </>
                    ) : <p>No action is waiting.</p>}
                    {inspected.action && row.controls.includes("cancel") ? (
                      <div className="actions"><button type="button" className={phone ? "pc-btn" : "btn quiet"} onClick={() => { setInspected(null); void store.ptaskCommand("ptask.cancel", { id: row.id }); }}>Cancel the whole task</button></div>
                    ) : null}
                    {inspected.receipts.length ? (
                      <ol aria-label="Action history">
                        {inspected.receipts.slice(-8).map(r => <li key={r.seq}>{clockText(r.at)} · {r.kind} · {r.event}{r.detail ? ` — ${r.detail}` : ""}</li>)}
                      </ol>
                    ) : null}
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
