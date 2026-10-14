import { CONNECTION_CATALOG, type BillingProvenance, type ConnectionView, type UsageView } from "./connections.ts";
import type { ProviderUsageSnapshot } from "./provider-usage.server.ts";
import type { ProviderId } from "../orch/types.ts";

/**
 * M-A-3 T13.3 Gate F — active-session usage ledger (pure, browser-safe).
 *
 * One row per T13.2 connection reservation (`connection_usage.id`), tagged with the Bunny session (Host run), Mission,
 * Project, worker Task, account, harness, model and provider session. It is a view of work this Host run sent, kept
 * apart from account-wide totals, which still apply as independent ceilings through the T13.2 dispatch gate. Nothing
 * here is estimated from a subscription price or past use: a value nobody reported is UNKNOWN.
 */

export const SESSION_LEDGER_SCHEMA = "bunny-a.session-ledger.v1";

export type LedgerOutcome = "pending" | "completed" | "failed" | "unknown_restart";

export type LedgerRow = {
  usageId: number;
  sessionId: string;
  at: number;
  settledAt: number | null;
  connectionId: string;
  provider: ProviderId;
  model: string | null;
  taskId: string;
  missionId: string | null;
  projectId: string | null;
  providerSession: string | null;
  outcome: LedgerOutcome;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  observedCostUsd: number | null;
  costSource: "local_device" | "provider_unknown";
};

export type Known<T> = T | "UNKNOWN";

/** Only a local model is known to cost nothing; every other cost stays UNKNOWN until a provider reports it. */
export const knownCost = (billing: BillingProvenance): { estimated: number | null; observed: number | null; source: LedgerRow["costSource"] } =>
  billing === "local_device" ? { estimated: 0, observed: 0, source: "local_device" } : { estimated: null, observed: null, source: "provider_unknown" };

export type Totals = {
  reserved: number;
  completed: number;
  failed: number;
  interrupted: number;
  /** Sum of provider-reported tokens; `unreported` counts settled rows with no report. */
  tokens: { input: number; output: number; unreported: number };
  estimatedCostUsd: Known<number>;
  observedCostUsd: Known<number>;
};

export type Allowance =
  | { state: "reported"; windows: { label: string; remainingPercent: number | null; resetsAt: number | null; status: string }[] }
  | { state: "local" }
  | { state: "UNKNOWN"; reason: string };

export type AccountLedger = {
  connectionId: string;
  harness: string;
  billing: BillingProvenance;
  models: string[];
  session: Totals;
  /** Account-wide totals for today (all Host runs), shown beside the session, never merged into it. */
  accountToday: { requests: number; usd: Known<number> };
  limits: { maxRequestsPerDay: number | null; maxUsdPerDay: number | null };
  remaining: Allowance;
};

export type AgentLedger = { slot: number | null; session: Totals };

export type SessionLedgerView = {
  schema: string;
  sessionId: string;
  accounts: AccountLedger[];
  /** Per Personal Agent (slot 1–4); `slot: null` is work no Personal Agent owns. */
  agents: AgentLedger[];
  recent: (LedgerRow & { slot: number | null })[];
};

function totals(rows: readonly LedgerRow[]): Totals {
  const settled = rows.filter((row) => row.outcome !== "pending");
  const sum = (pick: (row: LedgerRow) => number | null): Known<number> =>
    rows.some((row) => pick(row) === null) ? "UNKNOWN" : rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return {
    reserved: rows.filter((row) => row.outcome === "pending").length,
    completed: rows.filter((row) => row.outcome === "completed").length,
    failed: rows.filter((row) => row.outcome === "failed").length,
    interrupted: rows.filter((row) => row.outcome === "unknown_restart").length,
    tokens: {
      input: settled.reduce((total, row) => total + (row.inputTokens ?? 0), 0),
      output: settled.reduce((total, row) => total + (row.outputTokens ?? 0), 0),
      unreported: settled.filter((row) => row.inputTokens === null && row.outputTokens === null).length,
    },
    estimatedCostUsd: sum((row) => row.estimatedCostUsd),
    observedCostUsd: sum((row) => row.observedCostUsd),
  };
}

/** Remaining allowance comes only from provider-reported windows for a plan route; everything else is UNKNOWN. */
export function allowanceFor(connection: ConnectionView, usage: readonly ProviderUsageSnapshot[]): Allowance {
  if (connection.billing === "local_device") return { state: "local" };
  const providerId = CONNECTION_CATALOG.find((entry) => entry.id === connection.catalog)?.providerId;
  if (connection.billing !== "plan_included" || !providerId) return { state: "UNKNOWN", reason: "This account does not report a remaining allowance to Bunny." };
  const snapshot = usage.find((entry) => entry.providerId === providerId);
  const windows = (snapshot?.windows ?? []).filter((window) => window.percentUsed !== null);
  if (!snapshot || !windows.length || !["current", "stale"].includes(snapshot.status))
    return { state: "UNKNOWN", reason: snapshot?.note || "The provider has not reported its limits in this session." };
  return {
    state: "reported",
    windows: windows.map((window) => ({ label: window.label, remainingPercent: Math.max(0, 100 - (window.percentUsed ?? 0)), resetsAt: window.resetAt, status: snapshot.status })),
  };
}

export function sessionLedgerView(input: {
  sessionId: string;
  rows: readonly LedgerRow[];
  connections: readonly ConnectionView[];
  usage: UsageView;
  providerUsage: readonly ProviderUsageSnapshot[];
  slotFor: (missionId: string | null) => number | null;
}): SessionLedgerView {
  const rows = input.rows.filter((row) => row.sessionId === input.sessionId);
  const accounts = [...new Set(rows.map((row) => row.connectionId))].map((id): AccountLedger => {
    const own = rows.filter((row) => row.connectionId === id);
    const connection = input.connections.find((row) => row.id === id) ?? null;
    return {
      connectionId: id,
      harness: CONNECTION_CATALOG.find((entry) => entry.id === connection?.catalog)?.name ?? id.split(":")[0],
      billing: connection?.billing ?? "unknown",
      models: [...new Set(own.map((row) => row.model).filter((model): model is string => !!model))],
      session: totals(own),
      accountToday: { requests: input.usage.requestsToday[id] ?? 0, usd: input.usage.usdToday[id] ?? "UNKNOWN" },
      limits: { maxRequestsPerDay: connection?.consent.maxRequestsPerDay ?? null, maxUsdPerDay: connection?.consent.maxUsdPerDay ?? null },
      remaining: connection ? allowanceFor(connection, input.providerUsage) : { state: "UNKNOWN", reason: "The account is no longer connected." },
    };
  });
  const tagged = rows.map((row) => ({ ...row, slot: input.slotFor(row.missionId) }));
  const slots = [...new Set(tagged.map((row) => row.slot))].sort((a, b) => (a ?? 9) - (b ?? 9));
  return {
    schema: SESSION_LEDGER_SCHEMA,
    sessionId: input.sessionId,
    accounts,
    agents: slots.map((slot) => ({ slot, session: totals(tagged.filter((row) => row.slot === slot)) })),
    recent: tagged.slice(-50).reverse(),
  };
}
