import type { HostSnapshot } from "../../lib/bunny-host/contracts.ts";

/**
 * MA4-S2-T3 goals, schedules, monitors and proactive notifications for the dashboard and the phone (pure). Every fact is
 * the Host's. A view the Host has not just confirmed reads "Last known" with its time and offers no controls. Monitoring
 * is never shown as work: a monitor checks a source, it does not generate. Approving stays on the workstation.
 */
export type ProactiveSnapshot = NonNullable<HostSnapshot["proactive"]>;
export type ProactiveTone = "ok" | "warn" | "danger" | "neutral" | "active";
export type ProactiveControl = "approve" | "pause" | "resume" | "cancel" | "disable" | "reject";
export type ProactiveRow = { kind: "goal" | "schedule" | "monitor"; id: string; version: number; title: string; label: string; tone: ProactiveTone; detail: string | null; meta: string | null; controls: ProactiveControl[] };
export type NoticeRow = { key: string; title: string; text: string; category: string; priority: "low" | "normal" | "high"; at: number };
type View = { live: boolean; snapshotAt: number | null; workstation: boolean; format: (at: number) => string };

const STATE: Record<string, [string, ProactiveTone]> = {
  PROPOSED: ["Suggested", "warn"], AWAITING_APPROVAL: ["Waiting for approval", "warn"], ACTIVE: ["Active", "ok"], PAUSED: ["Paused", "neutral"],
  NEEDS_ATTENTION: ["Needs attention", "warn"], COMPLETED: ["Completed", "ok"], FAILED: ["Failed", "danger"], CANCELLED: ["Cancelled", "neutral"],
  EXPIRED: ["Expired", "neutral"], DISABLED: ["Disabled", "neutral"],
};
const CLASS: Record<string, string> = { no_change: "no change", routine_change: "expected change", meaningful: "changed", source_unavailable: "source unavailable", invalid: "invalid reading", permission_expired: "no longer authorized", uncertain: "uncertain reading" };
const CATEGORY: Record<string, string> = { reminder_due: "Reminder", goal_milestone: "Goal milestone", source_changed: "Source changed", task_completed: "Task completed", task_failed: "Task failed", approval_required: "Approval required", schedule_missed: "Scheduled task missed", recovery_blocked: "Recovery blocked", permission_expired: "Permission expired" };
const OPEN = ["PROPOSED", "AWAITING_APPROVAL", "ACTIVE", "PAUSED", "NEEDS_ATTENTION"];
const RANK = ["NEEDS_ATTENTION", "AWAITING_APPROVAL", "PROPOSED", "ACTIVE", "PAUSED", "FAILED", "COMPLETED", "EXPIRED", "CANCELLED", "DISABLED"];

function controls(kind: ProactiveRow["kind"], state: string, workstation: boolean): ProactiveControl[] {
  const c: ProactiveControl[] = [];
  if (workstation && (state === "AWAITING_APPROVAL" || state === "PROPOSED")) c.push("approve");
  if (state === "ACTIVE" || (kind === "goal" && state === "NEEDS_ATTENTION")) c.push("pause");
  if (state === "PAUSED") c.push("resume");
  // Turning down something not yet approved reads as a rejection; the Host action is the same cancel/disable.
  if (state === "PROPOSED" || state === "AWAITING_APPROVAL") c.push("reject");
  else if (OPEN.includes(state)) c.push(kind === "monitor" ? "disable" : "cancel");
  return c;
}

export function proactiveRows(snapshot: ProactiveSnapshot | null | undefined, view: View): ProactiveRow[] {
  if (!snapshot) return [];
  const asOf = view.snapshotAt === null ? null : view.format(view.snapshotAt);
  const finish = (row: Omit<ProactiveRow, "label" | "tone" | "controls">, state: string, label: string, tone: ProactiveTone) => ({
    ...row, label: view.live ? label : `Last known: ${label}${asOf ? ` (${asOf})` : ""}`, tone: view.live ? tone : "neutral" as const,
    controls: view.live ? controls(row.kind, state, view.workstation) : [], rank: RANK.indexOf(state),
  });
  const rows = [
    ...snapshot.goals.map(g => {
      const [text, tone] = STATE[g.state] ?? [g.state, "neutral"];
      return finish({ kind: "goal", id: g.id, version: g.version, title: g.title, detail: g.attention, meta: `${g.progress.met} of ${g.progress.total} criteria met by completed work${g.deadlineAt ? ` · due ${view.format(g.deadlineAt)}` : ""}` }, g.state, text, tone);
    }),
    ...snapshot.schedules.map(s => {
      const [text, tone] = STATE[s.state] ?? [s.state, "neutral"];
      // A schedule is "Working" only while the task it started is open; otherwise it is scheduled, not busy.
      const label = s.runningTaskId ? "Working" : s.state === "ACTIVE" ? (s.nextAt ? `Scheduled · next ${view.format(s.nextAt)}` : "Scheduled") : text;
      const last = s.lastAttempt ? `Last: ${s.lastAttempt.outcome === "missed" ? "missed" : s.lastAttempt.outcome === "defer" ? "skipped" : "ran"} ${view.format(s.lastAttempt.at)}` : null;
      return finish({ kind: "schedule", id: s.id, version: s.version, title: s.title, detail: s.lastAttempt && ["missed", "defer", "fail_safe"].includes(s.lastAttempt.outcome) ? s.lastAttempt.reason : null, meta: [s.trigger, last].filter(Boolean).join(" · ") }, s.state, label, s.runningTaskId ? "active" : tone);
    }),
    ...snapshot.monitors.map(m => {
      const [text, tone] = STATE[m.state] ?? [m.state, "neutral"];
      // Three or more failed reads is its own state: the owner must not mistake an unreadable source for "no change".
      const unreadable = m.state === "ACTIVE" && m.errors >= 3;
      const label = unreadable ? "Cannot read source" : m.state === "ACTIVE" ? "Monitoring" : text;
      const checked = m.lastCheckAt ? `checked ${view.format(m.lastCheckAt)}${m.lastClass ? ` (${CLASS[m.lastClass] ?? m.lastClass})` : ""}` : "not checked yet";
      const meta = [m.label, checked, m.lastChangeAt ? `last change ${view.format(m.lastChangeAt)}` : "no change seen yet", m.nextCheckAt ? `next check ${view.format(m.nextCheckAt)}` : null].filter(Boolean).join(" · ");
      return finish({ kind: "monitor", id: m.id, version: m.version, title: m.title, detail: m.errors >= 3 ? `${m.label} could not be read ${m.errors} times in a row.` : null, meta }, m.state, label, unreadable ? "danger" : m.state === "ACTIVE" ? "neutral" : tone);
    }),
  ];
  return rows.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...row }) => row);
}

export function noticeRows(snapshot: ProactiveSnapshot | null | undefined): NoticeRow[] {
  return (snapshot?.notifications ?? []).map(n => ({ key: n.key, title: n.title, text: n.reason, category: CATEGORY[n.category] ?? n.category, priority: n.priority, at: n.at }));
}

/** One line for headers, the phone and the notch: truthful about monitoring versus work. */
export function proactiveHeadline(snapshot: ProactiveSnapshot | null | undefined, view: Pick<View, "live" | "format">): string | null {
  if (!snapshot) return null;
  const s = snapshot.status, parts: string[] = [];
  if (s.attention) parts.push(`${s.attention} need${s.attention === 1 ? "s" : ""} attention`);
  if (s.waiting) parts.push(`${s.waiting} waiting for approval`);
  if (s.working) parts.push(`${s.working} working`);
  if (s.monitoring) parts.push(`Monitoring ${s.monitoring}`);
  if (s.scheduled && !s.working) parts.push(s.nextRunAt ? `Next run ${view.format(s.nextRunAt)}` : `${s.scheduled} scheduled`);
  if (!parts.length) return null;
  return view.live ? parts.join(" · ") : `Last known: ${parts.join(" · ")}`;
}
