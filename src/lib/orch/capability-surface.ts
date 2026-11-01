/**
 * CapabilityProbeSurface — honest capability reporting + quota-signal ingestion
 * (master prompt §3 W2: "Every integration reports supported / limited / unavailable
 * honestly"; §3 W1.4 quota signals; §7 rate-limit etiquette).
 *
 * Status is tri-state and provenance-bound:
 *  - "reported"   : the provider *advertises* it (model list, docs). Never enough to act on.
 *  - "verified"   : a real probe or a recorded run settled it at lastProbeAtMs.
 *  - "unavailable": a probe failed or the provider declined; the reason is carried.
 *
 * Quota signals come from three honest sources only: provider APIs, HTTP 429
 * responses (with the reset window the provider actually sends), and Bunny A's
 * own locally observed counts (never presented as provider quota).
 *
 * Account rotation to evade provider limits is structurally forbidden.
 *
 * Pure module: no I/O, no network, no imports, no secrets — references only.
 */

export type CapabilityStatus = "verified" | "reported" | "unavailable";

export type Modality = "text" | "image" | "audio" | "video" | "code";

export type CapabilityRecord = {
  capabilityId: string;
  providerId: string;
  modality: Modality;
  status: CapabilityStatus;
  toolUse: boolean;
  /** Where the status came from; never empty. */
  evidenceNote: string;
  lastProbeAtMs: number | null;
};

export type QuotaSource = "provider_api" | "http_429" | "local_observed";

export type QuotaSignal = {
  quotaSignalId: string;
  providerId: string;
  windowLabel: string;
  /** Provider-reported fill; null when the provider did not expose a number. */
  usedPercent: number | null;
  resetsAtMs: number | null;
  source: QuotaSource;
  observedAtMs: number;
  note?: string;
};

/** Struct-rule: rotating accounts to dodge a provider's rate limits is never allowed. */
export const ACCOUNT_ROTATION_FORBIDDEN = true as const;

export function attemptAccountRotation(): never {
  throw new Error("account rotation to evade provider limits is forbidden");
}

export function advertisedCapability(id: string, providerId: string, modality: Modality, toolUse: boolean): CapabilityRecord {
  return {
    capabilityId: id,
    providerId,
    modality,
    status: "reported",
    toolUse,
    evidenceNote: "advertised by provider model list; not probed",
    lastProbeAtMs: null,
  };
}

export function unavailableCapability(id: string, providerId: string, modality: Modality, toolUse: boolean, reason: string): CapabilityRecord {
  if (reason.trim() === "") throw new Error("unavailableCapability requires a reason");
  return {
    capabilityId: id,
    providerId,
    modality,
    status: "unavailable",
    toolUse,
    evidenceNote: `unavailable: ${reason}`,
    lastProbeAtMs: null,
  };
}

export function recordProbeResult(record: CapabilityRecord, result: { ok: boolean; atMs: number; note: string }): CapabilityRecord {
  if (result.note.trim() === "") throw new Error("probe result requires a note");
  return {
    ...record,
    status: result.ok ? "verified" : "unavailable",
    evidenceNote: result.ok ? `probe: ${result.note}` : `probe failed: ${result.note}`,
    lastProbeAtMs: result.atMs,
  };
}

export function noteQuota429(providerId: string, atMs: number, opts?: { retryAfterMs?: number | null; windowLabel?: string; signalIdBase?: string }): QuotaSignal {
  const { retryAfterMs = null, windowLabel = "HTTP 429 rate limit", signalIdBase } = opts ?? {};
  const resetsAtMs = retryAfterMs !== null && retryAfterMs > 0 ? atMs + retryAfterMs : null;
  return {
    quotaSignalId: `${signalIdBase ?? providerId}-http_429-${atMs}`,
    providerId,
    windowLabel,
    usedPercent: null,
    resetsAtMs,
    source: "http_429",
    observedAtMs: atMs,
    note: "recorded from the provider's own 429 response; no retry-before-reset",
  };
}

export function noteProviderQuotaWindow(providerId: string, windowLabel: string, usedPercent: number, resetsAtMs: number | null, observedAtMs: number, signalIdBase?: string): QuotaSignal {
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    throw new Error("usedPercent must be within 0..100");
  }
  if (windowLabel.trim() === "") throw new Error("provider quota window requires a label");
  return {
    quotaSignalId: `${signalIdBase ?? providerId}-provider_api-${observedAtMs}`,
    providerId,
    windowLabel,
    usedPercent,
    resetsAtMs,
    source: "provider_api",
    observedAtMs,
  };
}

export function noteLocalObservedQuota(providerId: string, windowLabel: string, usedPercent: number | null, observedAtMs: number, signalIdBase?: string, note?: string): QuotaSignal {
  if (usedPercent !== null && (usedPercent < 0 || usedPercent > 100)) {
    throw new Error("usedPercent must be within 0..100 or null");
  }
  return {
    quotaSignalId: `${signalIdBase ?? providerId}-local_observed-${observedAtMs}`,
    providerId,
    windowLabel,
    usedPercent,
    resetsAtMs: null,
    source: "local_observed",
    observedAtMs,
    note,
  };
}

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|credential|api[-_]?key|authorization|bearer|cookie|session)/i;

/**
 * Mechanical secret guard: no key anywhere in a payload may carry a secret.
 * Secrets live behind opaque refs (accountRef); a `fence`-prefixed key is a
 * split-brain fence marker, not a credential.
 */
export function assertNoSecretKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value)) {
    if (/^fence/i.test(key)) continue;
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`secret-shaped key "${key}" — move it behind an opaque ref`);
    }
    if (typeof inner === "object") assertNoSecretKeys(inner);
  }
}

/**
 * Honest aggregate status for UI/routing: the WORST status wins unless the
 * stronger one carries probe evidence. reported < verified by evidence, and a
 * single unavailable record drags the provider+modality pair down.
 */
export function aggregateCapabilityStatus(records: CapabilityRecord[]): CapabilityStatus {
  if (records.length === 0) return "unavailable";
  const statuses = records.map((r) => r.status);
  if (statuses.every((s) => s === "unavailable")) return "unavailable";
  if (statuses.includes("verified")) {
    return statuses.every((s) => s !== "unavailable") ? "verified" : "reported";
  }
  return "reported";
}