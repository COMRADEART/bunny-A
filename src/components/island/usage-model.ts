/**
 * M-A-3 T2: presentation helpers for the Host's provider usage truth.
 * Pure formatting and state naming — every number shown is read from the
 * Host's normalized ProviderUsageSnapshot; nothing here derives, ages or
 * fabricates usage. The server owns truth; this module only names it.
 */
import type { ProviderId } from "../../lib/orch/types.ts";
import type {
  ProviderUsageSnapshot,
  ProviderUsageServiceSnapshot,
  UsageState,
} from "../../lib/bunny-host/provider-usage.server.ts";

/** Visible state names (§4). All five are legitimate product states. */
export const USAGE_STATE_LABEL: Record<UsageState, string> = {
  current: "Current",
  stale: "Stale",
  estimated: "Estimated",
  unknown: "Unknown",
  unavailable: "Unavailable",
};

export const usageStateLabel = (state: UsageState): string => USAGE_STATE_LABEL[state];

/** Source labels (§5): a value is only ever shown with what observed it. */
export const USAGE_SOURCE_LABEL: Record<string, string> = {
  provider_native: "Provider reported",
  local_observation: "Locally observed",
  estimate: "Estimated",
};

/** One record per provider, or null when no Host that knows usage has answered. */
export function usageFor(
  snapshot: ProviderUsageServiceSnapshot | null,
  id: ProviderId,
): ProviderUsageSnapshot | null {
  return snapshot?.providers.find((p) => p.providerId === id) ?? null;
}

/**
 * Relative age of a timestamp, formatted for the "Checked …" line. Render-time
 * formatting only — statuses come from the Host, which owns the freshness math.
 */
export function relativeAge(from: number | null | undefined, now: number): string {
  if (from == null || !Number.isFinite(from)) return "never";
  const span = now - from;
  if (span <= 45_000) return "just now"; // slight-past/now; future stamps are rejected server-side.
  const minutes = Math.floor(span / 60_000);
  if (minutes < 1) return "under a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The "Checked …" line: when the Host last examined this provider (any outcome). */
export const checkedLine = (record: ProviderUsageSnapshot | null, now: number): string =>
  `Checked ${relativeAge(record?.refreshedAt ?? null, now)}`;

/** "3h 12m" for a future reset; null when the reset is unknown or already passed. */
export function resetIn(resetAt: number | null | undefined, now: number): string | null {
  if (resetAt == null || !Number.isFinite(resetAt)) return null;
  const span = resetAt - now;
  if (span <= 0) return null;
  const minutes = Math.floor(span / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** One window as text: "5-hour window: 41% used · resets in 3h 12m · Provider reported". */
export function usageWindowLine(window: ProviderUsageSnapshot["windows"][number], now: number): string {
  const used = window.percentUsed == null ? "Unknown used" : `${Math.round(window.percentUsed)}% used`;
  const span = resetIn(window.resetAt, now);
  const reset = span ? ` · resets in ${span}` : window.resetDescription ? ` · ${window.resetDescription}` : "";
  return `${window.label}: ${used}${reset} · ${USAGE_SOURCE_LABEL[window.sourceKind] ?? "Reported"}`;
}

/** Reset text for a facts row: "Resets in 3h 12m"; falls back to the absolute time or the provider's description. */
export function usageWindowReset(window: ProviderUsageSnapshot["windows"][number], now: number): string | null {
  if (window.resetAt == null) return window.resetDescription;
  const span = resetIn(window.resetAt, now);
  return span
    ? `Resets in ${span}`
    : `Resets ${new Date(window.resetAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

/** The headline value: the leading window's utilisation, or the state itself when there is none. */
export function usageHeadline(record: ProviderUsageSnapshot | null): string {
  if (!record) return "Unknown";
  if (record.providerId === "ollama") return "Local";
  const window = record.windows.find((w) => w.sourceKind !== "estimate") ?? record.windows[0];
  if (window?.percentUsed != null) return `${Math.round(window.percentUsed)}% used`;
  if (window) return "Unknown used";
  return USAGE_STATE_LABEL[record.status];
}

/** Chip label: Ollama's defensible truth is local telemetry, not a nonexistent quota state. */
export function usageChipLabel(record: ProviderUsageSnapshot | null): string {
  if (!record) return "Unknown";
  if (record.providerId === "ollama") return record.status === "stale" ? "Stale" : "Local";
  return USAGE_STATE_LABEL[record.status];
}

/** How many probed models a provider has, for the "Models N discovered" row. */
export function modelsDiscovered(
  snapshot: { providers: Array<{ provider: ProviderId; models: unknown[] }> } | null,
  id: ProviderId,
): number | null {
  if (!snapshot) return null;
  const entry = snapshot.providers.find((p) => p.provider === id);
  return entry && entry.models.length ? entry.models.length : null;
}