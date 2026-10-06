import type { BatchView } from "./types.ts";

/**
 * Shared batch display labels (Gate T9). Pure data and pure functions only, so the Host server
 * modules and the island UI render user-facing batch text from the same truth — product language,
 * never raw selectors, capability JSON or pids beyond "pid N".
 */

export const BATCH_ACTION_LABELS: Record<string, string> = {
  "computer.open_app": "Open its app",
  "computer.focus_window": "Bring its window forward",
  "computer.type": "Enter text into a field",
  "computer.invoke_control": "Press one of its buttons",
  "computer.list_windows": "List windows",
};
export const APP_LABELS: Record<string, string> = { notepad: "Notepad", calculator: "Calculator", paint: "Paint", explorer: "File Explorer", terminal: "Terminal" };
export const batchActionLabel = (action: string) => BATCH_ACTION_LABELS[action] ?? action;

/** Truthful target label for offers and the batch block: never selectors, pids only as "pid N". */
export function targetLabelOf(target: { app: string | null; processId: number | null; title: string | null }): string {
  if (target.app && APP_LABELS[target.app]) return APP_LABELS[target.app];
  if (target.title) return target.title.slice(0, 40);
  if (target.processId != null) return `pid ${target.processId}`;
  return "this desktop";
}

const ttlPhrase = (ttlMs: number): string => (ttlMs >= 60_000 ? `${Math.max(1, Math.round(ttlMs / 60_000))} min` : `${Math.max(1, Math.round(ttlMs / 1000))} s`);

/** The batch button's own label carries its shape, per the approval UX: "Allow this small batch · 8 actions · Calculator only · 2 min". */
export function batchButtonLabel(offer: { maxActions: number; targetLabel: string; ttlMs: number }): string {
  return `Allow this small batch · ${offer.maxActions} action${offer.maxActions === 1 ? "" : "s"} · ${offer.targetLabel} only · ${ttlPhrase(offer.ttlMs)}`;
}

/** Truthful offer lines for the permission card: what, where, how many, how long, what it never covers. */
export function batchOfferLines(offer: { actions: string[]; counts: Record<string, number>; readOnly: string[]; maxActions: number; targetLabel: string; ttlMs: number }): string[] {
  const covered = offer.actions
    .filter((action) => (offer.counts[action] ?? 0) > 0)
    .map((action) => {
      const count = offer.counts[action] ?? 0;
      return count === 1 ? batchActionLabel(action) : `${batchActionLabel(action)} ×${count}`;
    });
  const reads = offer.readOnly.map((action) => `${batchActionLabel(action)} (read-only, never counted)`);
  return [
    `What it covers inside ${offer.targetLabel}: ${[...covered, ...reads].join(", ")}`,
    `At most ${offer.maxActions} desktop action${offer.maxActions === 1 ? "" : "s"} within ${ttlPhrase(offer.ttlMs)}`,
    "Only ordinary on-screen steps — it never covers shell commands, files, installs, payments, secrets or anything destructive",
  ];
}

/** One truth line for the mission panel's batch block; the count is canonical, the clock is the Host's. */
export function batchStatusLabel(batch: Pick<BatchView, "status" | "endReason" | "usedCount" | "maxActions" | "expiresAt" | "targetLabel">, now: number): string {
  const used = `${batch.usedCount} of ${batch.maxActions} actions`;
  if (batch.status === "ended") {
    const reason =
      batch.endReason === "exhausted" ? "all its actions were used"
      : batch.endReason === "expired" ? "it expired"
      : batch.endReason === "revoked" ? "it was revoked"
      : batch.endReason === "scope_mismatch" ? "it reached a window outside its approval"
      : batch.endReason === "mission_ended" ? "the mission ended"
      : batch.endReason === "host_restart" ? "the Host restarted" : "it ended";
    return `Small approval batch for ${batch.targetLabel}: ${reason} after ${used}.`;
  }
  const remaining = Math.max(0, batch.expiresAt - now);
  const seconds = Math.floor(remaining / 1000);
  return `Small approval batch for ${batch.targetLabel}: ${used} used · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left.`;
}