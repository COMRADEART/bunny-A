import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { WEAPON_LABEL, SLOT_IDS, type SlotId } from "@/lib/bunny-host/personal-agents";
import { ROUTING_PRIORITIES, type AgentPriority, type RoutingPriority } from "@/lib/bunny-host/fairness";
import type { Allowance, Known, Totals } from "@/lib/bunny-host/session-ledger";

const PRIORITY_LABEL: Record<RoutingPriority, [string, string]> = {
  minimize_cost: ["Minimize cost", "Prefer local models, especially for light work."],
  balanced: ["Balanced", "Bunny's standard routing."],
  prioritize_quality: ["Prioritize quality", "Prefer the strongest eligible model."],
  local_only: ["Local only", "Keep every Task on this PC; cloud models are not used."],
  fastest: ["Fastest eligible", "Prefer the quickest eligible model."],
};

const usd = (value: Known<number>) => (value === "UNKNOWN" ? "Unknown" : `$${value.toFixed(2)}`);
const totalsLine = (totals: Totals) =>
  `${totals.completed} completed · ${totals.failed} failed${totals.reserved ? ` · ${totals.reserved} running` : ""}${totals.interrupted ? ` · ${totals.interrupted} interrupted by a restart` : ""}`;
const tokensLine = (totals: Totals) =>
  totals.tokens.input || totals.tokens.output
    ? `${totals.tokens.input.toLocaleString()} in / ${totals.tokens.output.toLocaleString()} out tokens${totals.tokens.unreported ? ` (${totals.tokens.unreported} requests did not report tokens)` : ""}`
    : totals.completed + totals.failed
      ? "Tokens: not reported by this provider"
      : "No tokens yet";
const allowanceLine = (allowance: Allowance) =>
  allowance.state === "local"
    ? "Runs on this PC; no provider allowance."
    : allowance.state === "UNKNOWN"
      ? `Remaining allowance: Unknown. ${allowance.reason}`
      : `Remaining: ${allowance.windows.map((window) => `${window.label} ${window.remainingPercent === null ? "unknown" : `${Math.round(window.remainingPercent)}%`}${window.status === "stale" ? " (stale)" : ""}`).join(", ")}`;

/**
 * M-A-3 T13.3 Gate F: Settings → AI & Models → Usage & limits. This Host run's usage per account and per Personal
 * Agent, the routing priority, and fair sharing between Agents. Values nobody reported are shown as Unknown.
 */
export function SessionUsage() {
  const store = useIsland();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const ledger = store.sessionLedger;
  const scheduler = store.scheduler;
  if (!ledger || !scheduler)
    return <p className="caption">{store.viewer?.kind === "device" ? "Usage and scheduling are managed on the workstation (Windows Host)." : "Session usage needs the updated Bunny Host."}</p>;
  const nameOf = (slot: number | null) => {
    if (slot === null) return "Not owned by a Personal Agent";
    const config = store.personalAgents?.slots.find((row) => row.slot === slot);
    return config?.displayName || (config ? WEAPON_LABEL[config.weapon] : `Agent ${slot}`);
  };
  const send = async (action: string, data: Record<string, unknown>, done: string) => {
    setBusy(true);
    setStatus("");
    const result = await store.schedulerCommand(action, data, setStatus);
    setBusy(false);
    if (result) setStatus(done);
  };
  const disabled = busy || !store.canAct();
  return (
    <>
      <section className="ai-card" aria-labelledby="routing-priority">
        <header>
          <div style={{ minWidth: 0 }}>
            <strong id="routing-priority">Routing priority</strong>
            <p>Reorders eligible models only. Your account consent, budgets and privacy rules still decide what may run.</p>
          </div>
        </header>
        <div role="radiogroup" aria-label="Routing priority" className="ai-capabilities" style={{ display: "grid", gap: 6 }}>
          {ROUTING_PRIORITIES.map((priority) => (
            <label key={priority} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: disabled ? "default" : "pointer" }}>
              <input
                type="radio"
                name="routing-priority"
                value={priority}
                checked={scheduler.priority === priority}
                disabled={disabled}
                style={{ width: 16, height: 16, minHeight: 0, flex: "none", marginTop: 1 }}
                onChange={() => void send("scheduler.priority", { priority }, `Routing priority: ${PRIORITY_LABEL[priority][0]}.`)}
              />
              <span>
                <strong>{PRIORITY_LABEL[priority][0]}</strong> <span className="caption">{PRIORITY_LABEL[priority][1]}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="ai-card" aria-labelledby="session-usage">
        <header>
          <div style={{ minWidth: 0 }}>
            <strong id="session-usage">This session</strong>
            <p>Work sent since Bunny Host last started. Account totals for today are shown beside it and still apply as limits.</p>
          </div>
        </header>
        {ledger.accounts.length === 0 ? (
          <p className="caption">No model requests yet in this session.</p>
        ) : (
          ledger.accounts.map((account) => (
            <div key={account.connectionId} className="setting-row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{account.harness}</strong>
                <p style={{ overflowWrap: "anywhere" }}>
                  {account.billing.replace(/_/g, " ")}
                  {account.models.length ? ` · ${account.models.join(", ")}` : ""}
                </p>
                <p>{totalsLine(account.session)}</p>
                <p>{tokensLine(account.session)}</p>
                <p>
                  Cost this session: {usd(account.session.observedCostUsd)}
                  {account.session.observedCostUsd === "UNKNOWN" ? " (the provider does not report cost to Bunny)" : ""}
                </p>
                <p>
                  Account today: {account.accountToday.requests}
                  {account.limits.maxRequestsPerDay !== null ? ` of ${account.limits.maxRequestsPerDay}` : ""} requests · {usd(account.accountToday.usd)}
                  {account.limits.maxUsdPerDay !== null ? ` of $${account.limits.maxUsdPerDay.toFixed(2)}` : ""}
                </p>
                <p>{allowanceLine(account.remaining)}</p>
              </div>
            </div>
          ))
        )}
        {ledger.agents.length > 0 && (
          <ul className="ai-capabilities" aria-label="Usage by Personal Agent">
            {ledger.agents.map((agent) => (
              <li key={agent.slot ?? "none"}>
                {nameOf(agent.slot)}: {totalsLine(agent.session)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ai-card" aria-labelledby="agent-fairness">
        <header>
          <div style={{ minWidth: 0 }}>
            <strong id="agent-fairness">Sharing between Agents</strong>
            <p>
              All four Agents can work at once. Each gets a fair turn; no Agent can take every slot. Memory in use: {scheduler.memoryUsedPercent}%.
            </p>
          </div>
        </header>
        <div className="setting-row">
          <div>
            <strong>Steps running at once (all Agents)</strong>
            <p>{Object.values(scheduler.live).reduce((sum, count) => sum + (count ?? 0), 0)} running now.</p>
          </div>
          <select
            aria-label="Steps running at once across all Agents"
            value={scheduler.fairness.sharedCeiling}
            disabled={disabled}
            onChange={(event) => void send("scheduler.fairness", { fairness: { sharedCeiling: Number(event.target.value) } }, "Saved.")}
          >
            {Array.from({ length: 16 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        {SLOT_IDS.map((slot: SlotId) => {
          const agent = scheduler.fairness.agents[slot];
          const held = scheduler.held.filter((row) => row.slot === slot);
          return (
            <div className="setting-row" key={slot}>
              <div style={{ minWidth: 0 }}>
                <strong>{nameOf(slot)}</strong>
                <p>
                  {scheduler.live[slot] ?? 0} running
                  {held.length ? ` · waiting: ${held[0].reason.replace(/^[A-Z_]+: /, "")}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select
                  aria-label={`${nameOf(slot)} steps at once`}
                  value={agent.maxConcurrent}
                  disabled={disabled}
                  onChange={(event) => void send("scheduler.fairness", { fairness: { agents: { [slot]: { maxConcurrent: Number(event.target.value) } } } }, "Saved.")}
                >
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value} at once
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${nameOf(slot)} priority`}
                  value={agent.priority}
                  disabled={disabled}
                  onChange={(event) => void send("scheduler.fairness", { fairness: { agents: { [slot]: { priority: event.target.value as AgentPriority } } } }, "Saved.")}
                >
                  <option value="low">Low priority</option>
                  <option value="normal">Normal priority</option>
                  <option value="high">High priority</option>
                </select>
              </div>
            </div>
          );
        })}
        <p className="caption">CPU and GPU load are not measured yet; the memory limit and step limits are what Bunny enforces.</p>
      </section>
      <p className="caption" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
