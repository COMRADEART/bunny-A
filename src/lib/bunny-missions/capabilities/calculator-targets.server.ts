/** Target identity is execution state, never permission. Every operation still passes the Bus. */
export type CalculatorIdentity = {
  handle: string; processId: number; processStartedAt: string;
  contentProcessId?: number; contentStartedAt?: string;
};
export type CalculatorTarget = {
  phase: "acquiring" | "bound";
  identity: CalculatorIdentity | null;
  acquiredAt: number;
  createdByBunny: boolean;
  runId: string | null;
};
export type CalculatorTargetStorage = {
  load(owner: string): CalculatorTarget | null;
  save(owner: string, target: CalculatorTarget): void;
};
export type CalculatorAcquisition = {
  identity: CalculatorIdentity;
  decision: "launched" | "reuse_existing" | "reuse_bound";
  launcherPid?: number;
  reason?: string;
};
export type CalculatorDriver = {
  valid(identity: CalculatorIdentity): Promise<boolean>;
  existing(): Promise<CalculatorIdentity | null>;
  launch(): Promise<CalculatorAcquisition>;
};

/**
 * Serialize only native Calculator acquisition, not Tasks or authority. Records are per logical
 * workflow; independent workflows may choose the same uniquely verified existing window after
 * their own approval. No global trusted application or global canonical target is introduced.
 */
export class CalculatorTargets {
  private tail: Promise<void> = Promise.resolve();
  storage: CalculatorTargetStorage;
  constructor(storage?: CalculatorTargetStorage) {
    const records = new Map<string, CalculatorTarget>();
    this.storage = storage ?? { load: owner => records.get(owner) ?? null, save: (owner, target) => { records.set(owner, target); } };
  }
  async acquire(owner: string, runId: string | null, driver: CalculatorDriver, signal: AbortSignal): Promise<CalculatorAcquisition> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(done => { release = done; });
    await previous;
    try {
      signal.throwIfAborted();
      const saved = this.storage.load(owner);
      if (saved?.identity && await driver.valid(saved.identity)) {
        signal.throwIfAborted();
        return { identity: saved.identity, decision: "reuse_bound", reason: "Canonical target remains valid." };
      }
      signal.throwIfAborted();
      const existing = await driver.existing();
      signal.throwIfAborted();
      if (existing) {
        this.storage.save(owner, { phase: "bound", identity: existing, acquiredAt: Date.now(), createdByBunny: false, runId });
        return { identity: existing, decision: "reuse_existing", reason: saved?.identity ? "Previous identity invalid; acquired a verified existing target." : "Acquired a uniquely verified existing target." };
      }
      // If a previous launch's outcome is unknown, retry cannot create a second target. A later
      // call may recover a uniquely verified window, but absence is not proof no launch is pending.
      if (saved?.phase === "acquiring") throw new Error("Previous Calculator launch outcome is uncertain; review the desktop before reacquisition. No additional launch attempted.");
      signal.throwIfAborted();
      this.storage.save(owner, { phase: "acquiring", identity: null, acquiredAt: Date.now(), createdByBunny: false, runId });
      const acquired = await driver.launch();
      // Persist successful identity even if cancellation just arrived: a new explicit decision
      // can revalidate it later, while Stop still discards late success and grants no execution.
      if (!await driver.valid(acquired.identity)) throw new Error("Acquired Calculator identity could not be validated; no automatic relaunch.");
      this.storage.save(owner, { phase: "bound", identity: acquired.identity, acquiredAt: Date.now(), createdByBunny: acquired.decision === "launched", runId });
      signal.throwIfAborted();
      return { ...acquired, reason: saved?.identity ? "Previous native target proved invalid; one controlled replacement acquisition." : "No verified existing target; one acquisition attempt." };
    } finally { release(); }
  }
}
