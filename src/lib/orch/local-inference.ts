/**
 * MA5-S2 P4-2: the one admission point for local (Ollama) generations. Ollama queues requests first-in first-out and the
 * 6 GB GPU serves one at a time, so a spoken question used to wait behind every agent request already sent. Bunny now
 * holds local requests itself:
 * - at most `slots` generations run at once (one by default: one model context in GPU memory);
 * - a waiting interactive request (a voice turn) is admitted before waiting background requests; each class is FIFO;
 * - a running generation is never cancelled or pre-empted, so a voice turn waits at most for the one in flight;
 * - no starvation: after `maxInteractiveStreak` interactive admissions in a row while background work waits, the oldest
 *   background request is admitted next.
 * It only orders requests that already passed every model, provider and permission check; it never changes one.
 */
export type InferenceClass = "interactive" | "background";
export type Admission = { id: string; cls: InferenceClass; aheadAtEnqueue: number; queuedMs: number; overrode: boolean };

type Waiter = { id: string; cls: InferenceClass; enqueuedAt: number; ahead: number; admit: () => void; signal?: AbortSignal; onAbort?: () => void };

export class LocalInferenceQueue {
  private running = 0;
  private waiters: Waiter[] = [];
  private streak = 0;
  private readonly admissions: Admission[] = [];
  private readonly counts = { interactive: 0, background: 0, starvationOverrides: 0 };

  private readonly slots: number;
  private readonly maxInteractiveStreak: number;
  private readonly now: () => number;

  constructor(slots = 1, maxInteractiveStreak = 3, now: () => number = () => Date.now()) {
    this.slots = slots;
    this.maxInteractiveStreak = maxInteractiveStreak;
    this.now = now;
  }

  /** Resolves with an idempotent release once admitted; rejects if `signal` aborts first (the request then never ran). */
  acquire(id: string, cls: InferenceClass, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error("Stopped before local inference."));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        id, cls, signal, enqueuedAt: this.now(), ahead: this.running + this.waiters.length,
        admit: () => {
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.running -= 1;
            this.pump();
          });
        },
      };
      if (signal) {
        waiter.onAbort = () => {
          const at = this.waiters.indexOf(waiter);
          if (at < 0) return;
          this.waiters.splice(at, 1);
          reject(new Error("Stopped before local inference."));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.pump();
    });
  }

  /** True while `id` waits for a slot (its request has not been sent to the model yet). */
  isWaiting(id: string): boolean {
    return this.waiters.some((w) => w.id === id);
  }

  stats() {
    const waiting = (cls: InferenceClass) => this.waiters.filter((w) => w.cls === cls).length;
    return { slots: this.slots, running: this.running, waiting: { interactive: waiting("interactive"), background: waiting("background") }, admitted: { ...this.counts } };
  }

  /** The last 200 admissions, oldest first (bounded; for measurement and receipts, never persisted). */
  recent(): readonly Admission[] {
    return this.admissions;
  }

  private pump() {
    while (this.running < this.slots && this.waiters.length > 0) {
      const interactive = this.waiters.find((w) => w.cls === "interactive");
      const background = this.waiters.find((w) => w.cls === "background");
      const overrode = !!interactive && !!background && this.streak >= this.maxInteractiveStreak;
      const next = (interactive && !overrode ? interactive : background)!;
      this.waiters.splice(this.waiters.indexOf(next), 1);
      if (next.onAbort) next.signal!.removeEventListener("abort", next.onAbort);
      this.streak = next.cls === "interactive" && background ? this.streak + 1 : 0;
      this.counts[next.cls] += 1;
      if (overrode) this.counts.starvationOverrides += 1;
      this.admissions.push({ id: next.id, cls: next.cls, aheadAtEnqueue: next.ahead, queuedMs: this.now() - next.enqueuedAt, overrode });
      if (this.admissions.length > 200) this.admissions.shift();
      this.running += 1;
      next.admit();
    }
  }
}

/** The Host-wide queue every local generation passes through (orch/exec.server.ts execute() and the MA4 tool chat). */
export const localInference = new LocalInferenceQueue();
