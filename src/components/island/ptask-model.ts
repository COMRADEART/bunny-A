import type { HostSnapshot } from "../../lib/bunny-host/contracts.ts";
import type { CorruptTaskView, DisplayState, TaskView } from "../../lib/bunny-host/ma4/task-runtime.ts";

/**
 * MA4-S2-T1 persistent task rows for the dashboard and the phone (pure). Every fact is the Host's: state, step counts,
 * evidence hashes. A view the Host has not just confirmed is labelled "Last known" with its time, and its controls stay
 * off — a cached RUNNING never reads as running now. Approval and reconciliation are offered on the workstation only.
 */
export type PtaskSnapshot = NonNullable<HostSnapshot["persistentTasks"]>;
export type PtaskTone = "ok" | "warn" | "danger" | "neutral" | "active";
export type PtaskControl = "pause" | "resume" | "cancel" | "approve" | "reconcile";
export type PtaskRow = {
  id: string; title: string; label: string; tone: PtaskTone; progress: string | null; detail: string | null; evidence: string | null;
  controls: PtaskControl[]; note: string | null;
};

const TONE: Record<DisplayState, PtaskTone> = { Queued: "neutral", Working: "active", "Waiting for approval": "warn", Paused: "neutral", Recovering: "active", "Needs attention": "warn", Completed: "ok", Failed: "danger", Cancelled: "neutral" };
const URGENCY: DisplayState[] = ["Needs attention", "Waiting for approval", "Recovering", "Working", "Paused", "Queued", "Failed", "Completed", "Cancelled"];
const OPEN = new Set<DisplayState>(["Queued", "Working", "Waiting for approval", "Paused", "Recovering", "Needs attention"]);

function controlsFor(task: TaskView, workstation: boolean): PtaskControl[] {
  const c: PtaskControl[] = [];
  if (task.state === "QUEUED" || task.state === "RUNNING" || task.state === "RESUMING") c.push("pause");
  if (task.state === "PAUSED") c.push("resume");
  if (workstation && task.state === "AWAITING_APPROVAL") c.push("approve");
  if (workstation && task.state === "UNCERTAIN") c.push("reconcile");
  if (OPEN.has(task.display)) c.push("cancel");
  return c;
}
function progressText(task: TaskView): string | null {
  const { done, total } = task.progress;
  if (task.state === "COMPLETED") return `All ${total} step${total === 1 ? "" : "s"} completed`;
  if (task.display === "Working") return `Step ${Math.min(done + 1, total)} of ${total}`;
  return `${done} of ${total} step${total === 1 ? "" : "s"} done`;
}

export function ptaskRows(snapshot: PtaskSnapshot | null | undefined, view: { live: boolean; snapshotAt: number | null; workstation: boolean; format: (at: number) => string }): PtaskRow[] {
  if (!snapshot) return [];
  const asOf = view.snapshotAt === null ? null : view.format(view.snapshotAt);
  const rows = snapshot.tasks.map((item: TaskView | CorruptTaskView): PtaskRow & { rank: number; at: number } => {
    if (item.corrupt) return { id: item.id, title: "Unreadable task", label: "Needs attention", tone: "warn", progress: null, detail: item.detail, evidence: null, controls: [], note: "Bunny will not run it until it is reviewed on the PC.", rank: 0, at: 0 };
    const label = view.live ? item.display : `Last known: ${item.display}${asOf ? ` (${asOf})` : ""}`;
    const detail = item.uncertainOperation ? "An action may or may not have happened. Decide on your PC before anything continues."
      : item.blocked?.detail ?? item.failure?.detail ?? null;
    const note = !view.live ? "Controls are paused until the Host answers."
      : !view.workstation && (item.state === "AWAITING_APPROVAL" || item.state === "UNCERTAIN") ? "Approve or resolve this on your PC." : null;
    const evidence = item.state === "COMPLETED" && item.evidence.length ? `${item.evidence.length} step receipt${item.evidence.length === 1 ? "" : "s"} · ${item.evidence.map(e => e.outputSha256.slice(0, 8)).join(" ")}` : null;
    return { id: item.id, title: item.title, label, tone: view.live ? TONE[item.display] : "neutral", progress: progressText(item), detail, evidence,
      controls: view.live ? controlsFor(item, view.workstation) : [], note, rank: URGENCY.indexOf(item.display), at: item.updatedAt };
  });
  return rows.sort((a, b) => a.rank - b.rank || b.at - a.at).map(({ rank: _rank, at: _at, ...row }) => row);
}
