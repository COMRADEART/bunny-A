/**
 * UofCoordinator — MA6 Phase 1B runtime wiring (the owner-authorized integration gate).
 *
 * The thin runtime owner of the three UOF lane modules. It holds the
 * coordinator-fence's volatile lease state, records route decisions BESIDE
 * BunnyRouter (never a second decision engine — UOF_LANE_CORE.md), ingests
 * honest capability and quota facts, adopts a coordinator identity and
 * assembles uof.v1 contract bundles on demand.
 *
 * Truth rules: state is in-memory and volatile (the fence module's contract —
 * a Host restart fences every token out); leases are workstation-managed
 * (no DEVICE_RIGHTS entries — devices stay default-denied); the coordinator
 * deviceId is host-derived (stableHostId), never client-supplied; a bundle's
 * violations are data, never an exception; unknown cost is never zero.
 */

import {
  activeLeaseAt,
  applyOnce,
  createLeaseState,
  guardAction,
  pickCoordinator,
  takeoverLease,
  type CoordinatorCandidate,
  type CoordinatorLease,
  type LeaseState,
  type TakeoverResult,
} from "./coordinator-fence.ts";
import {
  decideRoute,
  recordOutcome,
  type LedgerRecord,
  type RouteCandidate,
  type RouteOutcome,
} from "../orch/route-ledger.ts";
import type { RouteDecision as LaneRouteDecision } from "../orch/route-ledger.ts";
import {
  advertisedCapability,
  noteLocalObservedQuota,
  noteProviderQuotaWindow,
  noteQuota429,
  recordProbeResult,
  unavailableCapability,
  type CapabilityRecord,
  type QuotaSignal,
} from "../orch/capability-surface.ts";
import {
  capabilityToUof,
  decisionEvent,
  epochToUof,
  leaseToUof,
  outcomeEvent,
  quotaToUof,
  toBundle,
} from "../orch/uof-adopt.ts";
import type { ExecutionEvent } from "../orch/contracts.ts";

/** The facts a routed task's decision record carries at the two live routing sites. */
export type RoutingFacts = {
  taskId: string;
  providers: { id: string; availability: string; latency_estimate_ms: number | null; usageWindows?: { label: string; usedPercent: number }[] }[];
  decision: {
    recommended_provider: string | null;
    eligible_providers?: string[];
    excluded?: { provider: string; reason: string }[];
  };
};

const BOUNCE = { records: 64, events: 256, capabilities: 64, quota: 16, leases: 32, epochs: 8, ledgerViews: 10, recentExpired: 8 } as const;

/** The additive `uof?` snapshot block. Workstation-only, stripped from device principals like scheduler. */
export type UofSnapshot = {
  schema: "uof.v1";
  coordinator: { deviceId: string | null; basis: string; epoch: number; fenceToken: string } | null;
  leases: { leaseId: string; resourceRef: string; holderDeviceId: string; epoch: number; fenceToken: string; heartbeatMs: number; expiresAtMs: number }[];
  recentExpired: { resourceRef: string; holderDeviceId: string; epoch: number; because: string }[];
  epochs: { epoch: number; coordinatorDeviceId: string | null; startedAtMs: number; fenceToken: string }[];
  routingLedger: { decisionId: string; atMs: number | null; reason: string; chosenCostBasis: string | null; outcome: string | null }[];
  capabilities: { capabilityId: string; providerId: string; modality: string; status: string; toolUse: boolean; evidenceNote: string; lastProbeAtMs: number | null }[];
  quotaSignals: { quotaSignalId: string; providerId: string; windowLabel: string; usedPercent: number | null; resetsAtMs: number | null; source: string; observedAtMs: number }[];
  violations: { code: string; detail: string }[] | null;
};

type UofTaskInput = { taskId: string; goal: string; traceId: string; createdAtMs: number; state: string };

const bounce = <T,>(rows: T[], max: number): T[] => (rows.length > max ? rows.slice(rows.length - max) : rows);

const taskStateFor = (orchState: string): "open" | "running" | "blocked" | "completed" | "failed" | "cancelled" =>
  orchState === "running" || orchState === "routing" ? "running"
  : orchState === "waiting_for_approval" || orchState.startsWith("waiting") || orchState === "paused" ? "blocked"
  : orchState === "completed" ? "completed"
  : orchState === "failed" ? "failed"
  : orchState === "stopped" || orchState === "canceled" || orchState === "cancelled" ? "cancelled"
  : "open";

export class UofCoordinator {
  static readonly SCHEMA = "uof.v1" as const;
  private readonly state: LeaseState = createLeaseState();
  /** Idempotent fence side effects (coordinator-fence applyOnce); keyed by the caller's operation id. */
  private readonly applied = new Map<string, unknown>();
  private records: LedgerRecord[] = [];
  private events: ExecutionEvent[] = [];
  private readonly decisionIdByTask = new Map<string, string>();
  private readonly seq = new Map<string, number>();
  private capabilities = new Map<string, CapabilityRecord>();
  private quotaSignals: QuotaSignal[] = [];
  private epochs: ReturnType<typeof epochToUof>[] = [];
  private picked: { deviceId: string | null; basis: string } | null = null;
  private readonly recentExpired: { resourceRef: string; holderDeviceId: string; epoch: number; because: string }[] = [];
  private violations: { code: string; detail: string }[] | null = null;

  constructor(
    private readonly deps: {
      deviceId: string;
      /** The Host's own fabric platform and health, read live at command time. */
      platform: () => CoordinatorCandidate["platform"];
      health: () => CoordinatorCandidate["health"];
      /** Other fabric candidates (paired devices), read live; default is the Host alone. */
      candidates?: () => CoordinatorCandidate[];
      /** Live task facts for bundle export; default none (the export then reflects recorded decisions only). */
      tasks?: () => UofTaskInput[];
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Per-task event sequence from one host-side allocator (multi-bundle regressions otherwise stay undetectable). */
  private nextSeq(taskId: string): number {
    const next = (this.seq.get(taskId) ?? 0) + 1;
    this.seq.set(taskId, next);
    return next;
  }

  // ── W3: the recording layer BESIDE the router ───────────────────────────────────────────────

  /** Records, without influencing, the running BunnyRouter decision (the lane's decideRoute ranks on its own rule). */
  recordRouting(facts: RoutingFacts): void {
    const at = this.now();
    const known = new Set(facts.decision.eligible_providers ?? []);
    const excluded = new Map((facts.decision.excluded ?? []).map((row) => [row.provider, row.reason]));
    const candidates: RouteCandidate[] = [
      ...new Set([...known, ...excluded.keys(), ...facts.providers.map((provider) => provider.id)]),
    ].map((id): RouteCandidate => {
      const provider = facts.providers.find((row) => row.id === id);
      return {
        id: `route-${id}`,
        provider: id,
        availability: (provider?.availability ?? "unknown") as RouteCandidate["availability"],
        // No measured quality layer exists yet: quality stays 0 against floor 0 — never a claimed quality.
        qualityScore: 0,
        // No provider-supplied cost facts exist on ProviderLive today: unknown cost, honestly (it ranks last).
        estimatedCostUsd: null,
        costBasis: "unknown",
        latencyP50Ms: provider?.latency_estimate_ms ?? null,
        quotaUsedPercent: provider?.usageWindows?.[0]?.usedPercent ?? null,
        deviceRef: null,
        eligible: known.has(id),
        excludeReason: excluded.get(id),
      };
    });
    const lane: LaneRouteDecision | null = decideRoute({ candidates, qualityFloor: 0, nowMs: at });
    // No eligible survivor means nothing to record: BunnyRouter's own refusal already says so.
    if (!lane) return;
    this.decisionIdByTask.set(facts.taskId, lane.decisionId);
    this.records = bounce([...this.records, { decision: lane, outcome: null }], BOUNCE.records);
    this.events = bounce([...this.events, decisionEvent(lane, facts.taskId, this.nextSeq(facts.taskId), at)], BOUNCE.events);
  }

  /** Records the attempt's honest outcome class against its task's recorded decision. */
  recordTaskOutcome(taskId: string, outcome: RouteOutcome["outcome"], attemptId = taskId): void {
    const decisionId = this.decisionIdByTask.get(taskId);
    if (!decisionId) return;
    const at = this.now();
    this.records = recordOutcome(this.records, decisionId, { decisionId, outcome, attemptedAtMs: at, attemptId });
    this.events = bounce([...this.events, outcomeEvent({ decisionId, outcome, attemptedAtMs: at, attemptId }, taskId, this.nextSeq(taskId), at)], BOUNCE.events);
  }

  // ── W4: honest capability and quota ingestion (observe-only; no connector/OAuth change) ─────

  noteCapability(providerId: string, modality: CapabilityRecord["modality"], toolUse: boolean): void {
    const id = `cap-${providerId}-${modality}`;
    this.capabilities.set(id, advertisedCapability(id, providerId, modality, toolUse));
    if (this.capabilities.size > BOUNCE.capabilities)
      this.capabilities.delete(this.capabilities.keys().next().value as string);
  }

  recordProbe(providerId: string, modality: CapabilityRecord["modality"], result: { ok: boolean; note: string }): void {
    const id = `cap-${providerId}-${modality}`;
    // A probe without an advertised record: unavailable (with the reason), not an invented "reported".
    const base = this.capabilities.get(id) ?? unavailableCapability(id, providerId, modality, false, "probed without an advertised capability record");
    this.capabilities.set(id, recordProbeResult(base, { ...result, atMs: this.now() }));
  }

  noteProviderQuota(providerId: string, window: { label: string; usedPercent: number; resetsAtMs?: number | null }): void {
    this.quotaSignals = bounce([...this.quotaSignals, noteProviderQuotaWindow(providerId, window.label, window.usedPercent, window.resetsAtMs ?? null, this.now())], BOUNCE.quota);
  }

  noteLocalQuota(providerId: string, label: string, usedPercent: number | null, note?: string): void {
    this.quotaSignals = bounce([...this.quotaSignals, noteLocalObservedQuota(providerId, label, usedPercent, this.now(), undefined, note)], BOUNCE.quota);
  }

  /** The connections layer's rate-limited flip (http 429); a window without a fill number lands usedPercent null. */
  note429(providerId: string, retryAfterMs: number | null): void {
    this.quotaSignals = bounce([...this.quotaSignals, noteQuota429(providerId, this.now(), { retryAfterMs })], BOUNCE.quota);
  }

  // ── W1/W2/W6: lease state, expiry sweep and the workstation-managed lease surface ───────────

  /** A takeover, idempotent per operation id (the fence's applyOnce); epoch/token are host-derived always. */
  leaseTakeover(input: { resourceRef: string; holderDeviceId?: string; ttlMs?: number; heartbeatMs?: number; credentials?: { epoch: number; fenceToken: string } }, operationId?: string): { result: TakeoverResult; alreadyApplied: boolean } {
    const takeover = () => takeoverLease(this.state, {
      resourceRef: input.resourceRef,
      newHolderDeviceId: input.holderDeviceId ?? this.deps.deviceId,
      ttlMs: input.ttlMs ?? 10 * 60_000,
      heartbeatMs: input.heartbeatMs ?? 30_000,
      nowMs: this.now(),
      ...(input.credentials ?? {}),
    });
    if (operationId === undefined) return { result: takeover(), alreadyApplied: false };
    const once = applyOnce(this.applied, `lease.takeover:${operationId}`, takeover);
    return { result: once.result as TakeoverResult, alreadyApplied: once.alreadyApplied };
  }

  leaseState(): LeaseState {
    return this.state;
  }

  activeLease(resourceRef: string): CoordinatorLease | null {
    return activeLeaseAt(this.state, resourceRef, this.now());
  }

  /** Drops expired leases from the volatile state (pure read + delete); called by the Host's supervised loop. */
  sweep(): number {
    const now = this.now();
    let dropped = 0;
    for (const [resourceRef, lease] of Object.entries(this.state)) {
      if (now < lease.expiresAtMs) continue;
      delete this.state[resourceRef];
      this.recentExpired.unshift({ resourceRef, holderDeviceId: lease.holderDeviceId, epoch: lease.epoch, because: "expired" });
      dropped += 1;
    }
    if (this.recentExpired.length > BOUNCE.recentExpired) this.recentExpired.length = BOUNCE.recentExpired;
    return dropped;
  }

  // ── W6: the coordinator identity (host-derived; never client-supplied) ──────────────────────

  /** Pure preview over live candidates; the mutating adoption stores the resulting epoch. */
  pickPreview(): { deviceId: string | null; basis: string; candidates: CoordinatorCandidate[] } {
    const candidates = [
      ...(this.deps.candidates?.() ?? []),
      { deviceId: this.deps.deviceId, platform: this.deps.platform(), roles: ["coordinator"], health: this.deps.health() },
    ];
    return { ...pickCoordinator(candidates), candidates };
  }

  adoptCoordinator(): { deviceId: string | null; basis: string } | null {
    const pick = this.pickPreview();
    this.picked = { deviceId: pick.deviceId, basis: pick.basis };
    if (pick.deviceId) {
      const epoch = this.epochs.length ? Math.max(...this.epochs.map((row) => row.epoch)) + 1 : 1;
      this.epochs = bounce([...this.epochs, epochToUof(epoch, pick.deviceId, this.now())], BOUNCE.epochs);
    }
    return this.picked;
  }

  // ── W7: the admission fence composition (mission children only) ─────────────────────────────

  fenceRefusal(task: { mission?: { missionId: string } }, actorDeviceId: string | null): string | null {
    const missionId = task.mission?.missionId;
    if (!missionId) return null; // Direct tasks never leave the workstation; the fence serializes Mission worktrees.
    const resourceRef = `mission:${missionId}`;
    const lease = this.activeLease(resourceRef);
    if (!lease?.fenceToken) return null; // Nothing fenced the resource: unchanged behavior.
    const verdict = guardAction(this.state, {
      resourceRef,
      epoch: lease.epoch,
      fenceToken: lease.fenceToken,
      holderDeviceId: actorDeviceId ?? this.deps.deviceId,
      actionKey: `mission:${missionId}`,
    }, this.now());
    return verdict.allowed ? null : `Mission ${missionId} is fenced by coordinator lease ${lease.fenceToken} (held by ${lease.holderDeviceId}). ${verdict.reason}.`;
  }

  // ── W5: the snapshot view and W6's bundle export ────────────────────────────────────────────

  view(): UofSnapshot {
    const coordinator = this.picked
      ? {
          deviceId: this.picked.deviceId,
          basis: this.picked.basis,
          epoch: this.epochs.length ? Math.max(...this.epochs.map((row) => row.epoch)) : 1,
          fenceToken: this.epochs.length ? `f-${String(Math.max(...this.epochs.map((row) => row.epoch))).padStart(4, "0")}` : "f-0001",
        }
      : null;
    return {
      schema: UofCoordinator.SCHEMA,
      coordinator,
      leases: Object.values(this.state).sort((a, b) => a.resourceRef.localeCompare(b.resourceRef)).slice(0, BOUNCE.leases)
        .map((lease) => ({ leaseId: lease.leaseId, resourceRef: lease.resourceRef, holderDeviceId: lease.holderDeviceId, epoch: lease.epoch, fenceToken: lease.fenceToken, heartbeatMs: lease.heartbeatMs, expiresAtMs: lease.expiresAtMs })),
      recentExpired: [...this.recentExpired],
      epochs: [...this.epochs].slice(-BOUNCE.epochs).sort((a, b) => a.epoch - b.epoch).map((row) => ({ epoch: row.epoch, coordinatorDeviceId: row.coordinatorDeviceId, startedAtMs: row.startedAtMs, fenceToken: row.fenceToken })),
      routingLedger: [...this.records].slice(-BOUNCE.ledgerViews).map((record) => ({
        decisionId: record.decision.decisionId,
        atMs: record.decision.decidedAtMs,
        reason: record.decision.reason.slice(0, 300),
        chosenCostBasis: record.decision.chosenCostBasis,
        outcome: record.outcome?.outcome ?? null,
      })),
      capabilities: [...this.capabilities.values()].slice(-BOUNCE.capabilities).map((record) => ({
        capabilityId: record.capabilityId, providerId: record.providerId, modality: record.modality, status: record.status,
        toolUse: record.toolUse, evidenceNote: record.evidenceNote, lastProbeAtMs: record.lastProbeAtMs,
      })),
      quotaSignals: [...this.quotaSignals].slice(-BOUNCE.quota).map((row) => ({
        quotaSignalId: row.quotaSignalId, providerId: row.providerId, windowLabel: row.windowLabel,
        usedPercent: row.usedPercent, resetsAtMs: row.resetsAtMs, source: row.source, observedAtMs: row.observedAtMs,
      })),
      violations: this.violations,
    };
  }

  /** Assembles and validates the uof.v1 bundle; violations are data (and remembered for the snapshot view). */
  exportBundle(facts: { tasks?: UofTaskInput[] } = {}): { bundle: unknown; violations: { code: string; detail: string }[] } {
    const result = toBundle({
      tasks: [...(facts.tasks ?? this.deps.tasks?.() ?? [])].map((task) => ({
        taskId: task.taskId,
        goal: task.goal.trim().slice(0, 300) || "Task",
        traceId: task.traceId,
        createdAtMs: task.createdAtMs,
        priority: "normal" as const,
        state: taskStateFor(task.state),
      })),
      events: [...this.events],
      capabilities: [...this.capabilities.values()].slice(-BOUNCE.capabilities).map(capabilityToUof),
      quotaSignals: [...this.quotaSignals].slice(-BOUNCE.quota).map(quotaToUof),
      leases: Object.values(this.state).slice(0, BOUNCE.leases).map(leaseToUof),
      coordinatorEpochs: [...this.epochs],
    });
    this.violations = result.violations;
    return result;
  }
}