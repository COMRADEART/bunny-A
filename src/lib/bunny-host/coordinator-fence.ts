/**
 * CoordinatorFence — split-brain arithmetic for the UOF device fabric (master prompt §3 W3).
 *
 * A serialized task resource may only be coordinated by one device at a time. A
 * coordinator's claim is a lease; every takeover bumps the coordinate epoch and
 * re-derives the fence token, so decisions made under an older epoch are always
 * rejected (`stale_epoch`) — a fenced-out coordinator cannot repeat a destructive
 * side effect on a second device.
 *
 * Pure module: no I/O, no global clocks (callers pass `nowMs`), no imports.
 * Functions mutate the passed state object in place and return result values.
 * Wiring into the persistent host is a later slice, gated on these tests.
 */

export type CoordinatorLease = {
  leaseId: string;
  resourceRef: string;
  holderDeviceId: string;
  /** Monotonic per resource; grows by exactly one at each takeover. */
  epoch: number;
  /** Derived from the epoch: "f-" + zero-padded epoch. */
  fenceToken: string;
  heartbeatMs: number;
  expiresAtMs: number;
  createdAtMs: number;
};

export type LeaseGrant =
  | { granted: true; lease: CoordinatorLease }
  | { granted: false; reason: "held_by_other" };

export type RenewResult = { renewed: true; lease: CoordinatorLease } | { renewed: false; reason: RenewReject };
export type RenewReject = "expired_lease" | "no_lease" | "holder_mismatch" | "stale_epoch" | "wrong_fence_token";

export type TakeoverInput = {
  resourceRef: string;
  newHolderDeviceId: string;
  ttlMs: number;
  heartbeatMs: number;
  nowMs: number;
  /** Presenting the live lease's credentials grants a voluntary handover at any time. */
  epoch?: number;
  fenceToken?: string;
};

export type TakeoverResult = { takeover: true; lease: CoordinatorLease } | { takeover: false; reason: "active_lease" | "wrong_credentials" };

/** A single-writer action, presented with the epoch/fence it was decided under. */
export type FenceAction = {
  resourceRef: string;
  epoch: number;
  fenceToken: string;
  holderDeviceId: string;
  actionKey: string;
};

export type FenceGuardVerdict = { allowed: true } | { allowed: false; reason: FenceReject };
export type FenceReject = "no_lease" | "expired_lease" | "stale_epoch" | "wrong_fence_token" | "holder_mismatch";

export type LeaseState = Record<string, CoordinatorLease>;

export function fenceTokenFor(epoch: number): string {
  if (!Number.isInteger(epoch) || epoch < 1) throw new Error("epoch must be a positive integer");
  return `f-${String(epoch).padStart(4, "0")}`;
}

export function createLeaseState(): LeaseState {
  return {};
}

export function activeLeaseAt(state: LeaseState, resourceRef: string, nowMs: number): CoordinatorLease | null {
  const lease = state[resourceRef];
  if (!lease) return null;
  return nowMs < lease.expiresAtMs ? lease : null;
}

function nextLeaseId(resourceRef: string, epoch: number, state: LeaseState): string {
  // Deterministic and collision-free within a resource: lease-<epoch>-<current-holder-count>.
  const holders = Object.keys(state).length;
  return `lease-${resourceRef.replace(/[^a-z0-9_-]/gi, "-")}-${epoch}-${holders + 1}`;
}

export function acquireLease(state: LeaseState, input: { resourceRef: string; holderDeviceId: string; ttlMs: number; heartbeatMs: number; nowMs: number }): LeaseGrant {
  const { resourceRef, holderDeviceId, ttlMs, heartbeatMs, nowMs } = input;
  if (ttlMs <= 0 || heartbeatMs <= 0) throw new Error("ttlMs and heartbeatMs must be positive");
  const lease = state[resourceRef];
  if (lease && nowMs < lease.expiresAtMs) {
    return { granted: false, reason: "held_by_other" };
  }
  const epoch = lease ? lease.epoch : 1;
  const granted: CoordinatorLease = {
    leaseId: nextLeaseId(resourceRef, epoch, state),
    resourceRef,
    holderDeviceId,
    epoch,
    fenceToken: fenceTokenFor(epoch),
    heartbeatMs,
    expiresAtMs: nowMs + ttlMs,
    createdAtMs: nowMs,
  };
  state[resourceRef] = granted;
  return { granted: true, lease: granted };
}

export function renewLease(state: LeaseState, input: { resourceRef: string; holderDeviceId: string; epoch: number; fenceToken: string; ttlMs: number; nowMs: number }): RenewResult {
  const lease = state[input.resourceRef];
  if (!lease) return { renewed: false, reason: "no_lease" };
  if (input.nowMs >= lease.expiresAtMs) return { renewed: false, reason: "expired_lease" };
  if (input.holderDeviceId !== lease.holderDeviceId) return { renewed: false, reason: "holder_mismatch" };
  if (input.epoch !== lease.epoch) return { renewed: false, reason: "stale_epoch" };
  if (input.fenceToken !== lease.fenceToken) return { renewed: false, reason: "wrong_fence_token" };
  lease.expiresAtMs = input.nowMs + input.ttlMs;
  return { renewed: true, lease };
}

/**
 * Takeover bumps the epoch exactly once and re-derives the fence token. Allowed
 * when the previous lease is expired (crash/disconnect path) or when the caller
 * presents the live lease's credentials (voluntary handover path).
 */
export function takeoverLease(state: LeaseState, input: TakeoverInput): TakeoverResult {
  const lease = state[input.resourceRef];
  if (lease && input.nowMs < lease.expiresAtMs) {
    const presentsValidCredentials =
      input.epoch === lease.epoch &&
      input.fenceToken === lease.fenceToken &&
      input.newHolderDeviceId !== lease.holderDeviceId;
    if (!presentsValidCredentials) {
      const credsPresent = input.epoch !== undefined || input.fenceToken !== undefined;
      return { takeover: false, reason: credsPresent ? "wrong_credentials" : "active_lease" };
    }
  }
  if (lease && input.nowMs >= lease.expiresAtMs) {
    // Expired lease: anything may take over, and the takeover must not carry stale-looking credentials.
    const mismatches = (input.epoch !== undefined && input.epoch !== lease.epoch) || (input.fenceToken !== undefined && input.fenceToken !== lease.fenceToken);
    if (mismatches) return { takeover: false, reason: "wrong_credentials" };
  }
  if (lease && input.epoch !== undefined && input.epoch > lease.epoch) {
    return { takeover: false, reason: "wrong_credentials" };
  }
  const prevEpoch = lease ? lease.epoch : 0;
  const epoch = prevEpoch + 1;
  const granted: CoordinatorLease = {
    leaseId: nextLeaseId(input.resourceRef, epoch, state),
    resourceRef: input.resourceRef,
    holderDeviceId: input.newHolderDeviceId,
    epoch,
    fenceToken: fenceTokenFor(epoch),
    heartbeatMs: input.heartbeatMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    createdAtMs: input.nowMs,
  };
  state[input.resourceRef] = granted;
  return { takeover: true, lease: granted };
}

/** Admission gate for single-writer/destructive actions. Stale epochs always lose. */
export function guardAction(state: LeaseState, action: FenceAction, nowMs: number): FenceGuardVerdict {
  const lease = state[action.resourceRef];
  if (!lease) return { allowed: false, reason: "no_lease" };
  if (nowMs >= lease.expiresAtMs) return { allowed: false, reason: "expired_lease" };
  if (action.epoch !== lease.epoch) return { allowed: false, reason: "stale_epoch" };
  if (action.fenceToken !== lease.fenceToken) return { allowed: false, reason: "wrong_fence_token" };
  if (action.holderDeviceId !== lease.holderDeviceId) return { allowed: false, reason: "holder_mismatch" };
  return { allowed: true };
}

/**
 * Idempotent side-effect runner for reconnect/duplicate-delivery storms.
 * The cache maps actionKey → applied result; a repeated key replays the stored
 * result and never re-runs the effect.
 */
export function applyOnce<T>(cache: Map<string, T>, actionKey: string, run: () => T): { result: T; alreadyApplied: boolean } {
  const existing = cache.get(actionKey);
  if (existing !== undefined) return { result: existing, alreadyApplied: true };
  const result = run();
  cache.set(actionKey, result);
  return { result, alreadyApplied: false };
}

export type CoordinatorCandidate = {
  deviceId: string;
  platform: "windows" | "android" | "linux" | "server";
  roles: string[];
  health: "healthy" | "degraded" | "offline";
};

/**
 * Ownership policy as data (master prompt §3 W3): the self-hosted server is the
 * default coordinator while healthy; the Windows device takes over when it is
 * not; degraded nodes still outrank none. No runtime wiring in this slice.
 */
export function pickCoordinator(candidates: CoordinatorCandidate[]): { deviceId: string | null; basis: string } {
  const order: Array<{ platform: CoordinatorCandidate["platform"]; health: CoordinatorCandidate["health"]; basis: string }> = [
    { platform: "server", health: "healthy", basis: "server-primary: healthy self-hosted server coordinator" },
    { platform: "windows", health: "healthy", basis: "windows-fallback: server not healthy, healthy Windows coordinator" },
    { platform: "server", health: "degraded", basis: "server degraded but no better coordinator" },
    { platform: "windows", health: "degraded", basis: "windows degraded but no better coordinator" },
  ];
  for (const tier of order) {
    for (const candidate of candidates) {
      if (candidate.platform === tier.platform && candidate.health === tier.health && candidate.roles.includes("coordinator")) {
        return { deviceId: candidate.deviceId, basis: tier.basis };
      }
    }
  }
  return { deviceId: null, basis: "no coordinator available" };
}