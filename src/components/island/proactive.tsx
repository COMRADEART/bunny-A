import { useIsland } from "@/store/use-island";
import { isDevice } from "./remote-view-model";
import { noticeRows, proactiveHeadline, proactiveRows, type ProactiveControl, type ProactiveRow, type ProactiveTone } from "./proactive-model";

const clockText = (at: number) => new Date(at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
// Reuses the agent rows' existing state colours (mission.css) instead of adding styles.
const STATE_STYLE: Record<ProactiveTone, string> = { ok: "COMPLETED", warn: "WAITING_FOR_USER", danger: "FAILED", neutral: "PAUSED", active: "RUNNING" };
const LABEL: Record<ProactiveControl, string> = { approve: "Approve", pause: "Pause", resume: "Resume", cancel: "Cancel", disable: "Turn off" };
const KIND: Record<ProactiveRow["kind"], string> = { goal: "Goal", schedule: "Schedule", monitor: "Monitor" };

/**
 * MA4-S2-T3 proactive companion: owner-approved goals, schedules and monitors, the notifications they raised and a
 * "while you were away" summary — all from durable Host records. Goals, schedules and monitors are proposed through
 * Bunny and approved here on the PC; the phone may pause, resume, cancel, turn a monitor off and dismiss or snooze.
 */
export function Proactive({ phone = false }: { phone?: boolean }) {
  const store = useIsland();
  const snapshot = store.proactive;
  const workstation = !isDevice(store.viewer);
  const live = store.canAct();
  const view = { live, snapshotAt: store.connection.snapshotAt, workstation, format: clockText };
  const rows = proactiveRows(snapshot, view);
  const notices = live ? noticeRows(snapshot) : [];
  if (!snapshot || (!rows.length && !notices.length && !snapshot.away)) return null;
  const headline = proactiveHeadline(snapshot, view);
  const act = (control: ProactiveControl, row: ProactiveRow) =>
    void store.ptaskCommand(`${row.kind}.${control}`, control === "approve" ? { id: row.id, version: row.version } : { id: row.id });
  const quiet = snapshot.prefs.quietHours;
  const btn = (quietStyle = false) => phone ? "pc-btn" : quietStyle ? "btn quiet" : "btn secondary";
  return (
    <section className={phone ? "pc-section" : "today-section agents-section"} data-testid="proactive" aria-labelledby="proactive-heading">
      <div className={phone ? "pc-section-head" : "section-heading"}>
        <h2 id="proactive-heading" className={phone ? "pc-h2" : "eyebrow"}>Goals, schedules and monitors</h2>
        {headline ? <span className="caption">{headline}</span> : null}
      </div>
      {snapshot.away && live ? (
        <p className="caption" role="status">
          While you were away: {snapshot.away.text}.{" "}
          <button type="button" className={phone ? "pc-link" : "btn quiet"} onClick={() => void store.ptaskCommand("proactive.away.ack", {})}>Got it</button>
        </p>
      ) : null}
      {snapshot.corrupt.map(c => <p key={c.id} className="caption" role="alert">{c.detail}</p>)}
      {notices.length ? (
        <ul className={phone ? "pc-card" : "agent-run-list glass"} aria-label="Notifications">
          {notices.map(n => (
            <li key={n.key} data-state={n.priority === "high" ? "WAITING_FOR_USER" : "PAUSED"}>
              <div className="agent-run-title"><strong>{n.title}</strong><small>{n.category} · {clockText(n.at)}</small></div>
              <p className="caption">{n.text}</p>
              <div className="actions">
                <button type="button" className={btn(true)} onClick={() => void store.ptaskCommand("proactive.notification.snooze", { key: n.key, minutes: 60 })}>Snooze 1 h</button>
                <button type="button" className={btn(true)} onClick={() => void store.ptaskCommand("proactive.notification.dismiss", { key: n.key })}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {snapshot.held ? <p className="caption">{snapshot.held} notification{snapshot.held === 1 ? " is" : "s are"} held until quiet hours end.</p> : null}
      {rows.length ? (
        <ul className={phone ? "pc-card" : "agent-run-list glass"}>
          {rows.map(row => (
            <li key={`${row.kind}:${row.id}`} data-tone={row.tone} data-state={STATE_STYLE[row.tone]}>
              <div className="agent-run-title">
                <strong>{row.title}</strong>
                <small>{KIND[row.kind]} · {row.label}</small>
              </div>
              {row.meta ? <p className="caption">{row.meta}</p> : null}
              {row.detail ? <p className="caption">{row.detail}</p> : null}
              {!workstation && live && row.label === "Waiting for approval" ? <p className="caption">Approve this on your PC.</p> : null}
              {row.controls.length ? (
                <div className="actions">
                  {row.controls.map(c => <button key={c} type="button" className={btn(c === "cancel" || c === "disable")} onClick={() => act(c, row)}>{LABEL[c]}</button>)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {workstation ? (
        <div className="actions" role="group" aria-label="Notification settings">
          <label className="caption">
            <input type="checkbox" checked={quiet.enabled} disabled={!live}
              onChange={e => void store.ptaskCommand("proactive.prefs", { prefs: { ...snapshot.prefs, quietHours: { ...quiet, enabled: e.target.checked, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } } })} />{" "}
            Quiet hours {quiet.start}–{quiet.end} (notifications wait until they end)
          </label>
        </div>
      ) : null}
    </section>
  );
}
