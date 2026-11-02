/**
 * M-E4 Server Control / Device Fabric truth (pure). Server Control is a workstation management surface over the
 * EXISTING Host: it renders only fields the Host snapshot serves today, shows fabric coordination (leases, epochs,
 * topology, takeover) as not-configured while the owner-gated integration slice is pending, and never invents a
 * percentage, a health state, a node or a quota. A paired device never sees Server Control at all.
 */
import type { HostEvent, HostIdentity } from "../../lib/bunny-host/contracts.ts";

/** The input rows are structural (the store projects these fields from the same snapshot pieces). */
export type DeviceInput = { id: string; name: string; createdAt: number; expiresAt?: number; lastSeenAt?: number | null; revoked?: boolean };
export type LedgerRowInput = {
  provider: string; model: string | null; outcome: string;
  inputTokens: number | null; outputTokens: number | null; observedCostUsd: number | null; costSource: string;
};
export type FabricOverview = {
  hostId: string | null;
  epoch: string | null;
  startedAt: number | null;
  tasks: number;
  agents: number;
  devices: number;
  projects: number;
};

export const COORDINATION_NOT_CONFIGURED = "Not configured — coordinator wiring (leases, epochs, topology, takeover) is a later, owner-gated slice.";

export function fabricOverview(input: {
  hostIdentity?: HostIdentity | null;
  tasks: readonly unknown[];
  agents?: { agents: readonly unknown[] } | null;
  devices?: readonly DeviceInput[] | null;
  projects: readonly unknown[];
}): FabricOverview {
  return {
    hostId: input.hostIdentity?.hostId ?? null,
    epoch: input.hostIdentity?.epoch ?? null,
    startedAt: input.hostIdentity?.startedAt ?? null,
    tasks: input.tasks.length,
    agents: input.agents?.agents.length ?? 0,
    devices: input.devices?.length ?? 0,
    projects: input.projects.length,
  };
}

export type FabricDeviceRow = DeviceInput & { state: "active" | "revoked" | "expired" | "idle" };

/** The registry rows as the fabric shows them: newest presence first, every row labelled with its own truth. */
export function fabricDeviceRows(devices: readonly DeviceInput[] | null | undefined, now: number): FabricDeviceRow[] {
  return [...(devices ?? [])]
    .sort((a, b) => (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt))
    .map((row) => ({
      ...row,
      state: row.revoked
        ? "revoked"
        : row.expiresAt && row.expiresAt < now
          ? "expired"
          : row.lastSeenAt && now - row.lastSeenAt > 90_000
            ? "idle"
            : "active",
    }));
}

/** Usage rows from the workstation-only ledger: a cost is shown only where the ledger calls it known (local_device). */
export type FabricUsageRow = {
  provider: string;
  model: string | null;
  outcome: string;
  input: number | null;
  output: number | null;
  costKnown: boolean;
  cost: number | null;
};

export function fabricUsageRows(ledger: { recent?: readonly LedgerRowInput[] } | null | undefined, limit = 8): FabricUsageRow[] {
  return (ledger?.recent ?? []).slice(0, limit).map((row) => ({
    provider: row.provider,
    model: row.model,
    outcome: row.outcome,
    input: row.inputTokens,
    output: row.outputTokens,
    costKnown: row.costSource === "local_device",
    cost: row.costSource === "local_device" ? row.observedCostUsd : null,
  }));
}

/** The bound-limited event window the fabric shows; the ledger itself stays on Activity (which owns the full view). */
export function fabricEvents(events: readonly HostEvent[] | null | undefined, limit = 12): HostEvent[] {
  return (events ?? []).slice(0, limit);
}

/** Performance profiles pass through unchanged; the view adds nothing to them. */
export function fabricProfiles<T extends { provider: string; taskType: string; count: number; completed: number; verified: number; durationMs: number; sufficient?: boolean }>(
  performance: readonly T[] | null | undefined,
  limit = 8,
): T[] {
  return (performance ?? []).slice(0, limit);
}