import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { LEARNING_GRID, type LearningWeights, type RoutingLearningView } from "@/lib/bunny-host/routing-feedback";
import type { ProviderId } from "@/lib/orch/types";

const PROVIDER: Record<ProviderId, string> = { codex: "Codex", claude: "Claude Code", ollama: "Ollama", opencode: "OpenCode", cline: "Cline", cursor: "Cursor Agent" };
const STATE_LABEL = { evaluated: "Evaluated", shadow: "Shadow testing", accepted: "Accepted", rejected: "Rejected", superseded: "Replaced" } as const;
type Candidate = RoutingLearningView["candidates"][number];

const weightsLine = (weights: LearningWeights) =>
  `Past results ×${weights.historyWeight} · speed ${weights.latencyWeight ? `×${weights.latencyWeight}` : "off"} · ${weights.perTaskType ? "learns per kind of task" : "one history for all tasks"}`;
const duration = (ms: number | null) => (ms === null ? "no timing yet" : ms < 60_000 ? `${Math.round(ms / 1000)}s typical` : `${Math.round(ms / 60_000)} min typical`);
const evaluationLine = (row: Candidate) => {
  const e = row.evaluation;
  if (!e) return "Evaluated before routing improvement recorded live decisions.";
  return `Replayed ${e.decisions} recorded decision(s); ${e.verified} had a verified result. It would change ${e.changed}: ${e.improvements} away from a verified failure, ${e.risks} away from a verified success, ${e.unmeasured} unverified.`;
};
const shadowLine = (row: Candidate) =>
  row.shadow
    ? `Shadow: ${row.shadow.decisions} live decision(s) scored, ${row.shadow.differed} different choice(s), ${row.shadow.verified} verified, ${row.shadow.avoided} failure(s) it would have avoided, ${row.shadow.risks} success(es) it would have changed.`
    : null;

/**
 * M-A-3 T13.3 Gate G: Settings → AI & Models → Routing improvement. What Bunny observed, and the owner-decided cycle
 * evaluate → shadow test → accept or reject → roll back. Nothing here changes routing until the owner accepts a policy.
 */
export function RoutingImprovement() {
  const store = useIsland();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LearningWeights>({ historyWeight: 1, latencyWeight: 0, perTaskType: true });
  const learning = store.routingLearning;
  if (!learning)
    return <p className="caption">{store.viewer?.kind === "device" ? "Routing improvement is decided on the workstation (Windows Host)." : "Routing improvement needs the updated Bunny Host."}</p>;
  const disabled = busy || !store.canAct();
  const send = async (action: string, data: Record<string, unknown>, done: string) => {
    setBusy(true);
    setStatus("");
    const result = await store.routingLearningCommand(`routing.learning.${action}`, data, setStatus);
    setBusy(false);
    if (result) setStatus(done);
  };
  const isBase = learning.active.previousId === null;
  return (
    <>
      <section className="ai-card" aria-labelledby="routing-active">
        <header>
          <div style={{ minWidth: 0 }}>
            <strong id="routing-active">Routing in use</strong>
            <p>
              Bunny learns only from results it verified itself. Your likes and dislikes are shown below but never count as proof that a Task was
              done correctly. {learning.autopilot ? "Autopilot is on: Bunny accepts a policy itself once it passes every gate below." : "Nothing changes until you accept a policy."}
            </p>
          </div>
        </header>
        <div className="setting-row">
          <div style={{ minWidth: 0 }}>
            <strong>{isBase ? "Standard routing" : `Accepted policy ${learning.active.id.slice(0, 8)}`}</strong>
            <p>{weightsLine(learning.active.weights)}</p>
            {learning.active.since ? <p>Since {new Date(learning.active.since).toLocaleString()}</p> : null}
          </div>
          {!isBase ? (
            <button type="button" className="btn secondary" disabled={disabled} onClick={() => void send("rollback", {}, "Rolled back to the previous routing.")}>
              Roll back
            </button>
          ) : null}
        </div>
        <div className="setting-row">
          <div style={{ minWidth: 0 }}>
            <strong>Autopilot</strong>
            <p>
              After every {learning.minimumSamples} verified Tasks, Bunny proposes, shadow tests and accepts a policy on its own through the same gates, and
              drops one that cannot pass. It calls no model and costs nothing. Roll back stays with you.
            </p>
          </div>
          <button
            type="button"
            className="btn secondary"
            aria-pressed={learning.autopilot}
            disabled={disabled}
            onClick={() => void send("autopilot", { enabled: !learning.autopilot }, learning.autopilot ? "Autopilot off." : "Autopilot on.")}
          >
            {learning.autopilot ? "Turn off" : "Turn on"}
          </button>
        </div>
      </section>

      <section className="ai-card" aria-labelledby="routing-observed">
        <header>
          <div style={{ minWidth: 0 }}>
            <strong id="routing-observed">What Bunny observed</strong>
            <p>
              Per model service and kind of task. A service needs {learning.minimumSamples} finished Tasks before its history can move routing at all.
            </p>
          </div>
        </header>
        {learning.observations.length === 0 ? (
          <p className="caption">No finished Tasks yet.</p>
        ) : (
          <ul className="ai-capabilities" aria-label="Observed results">
            {learning.observations.map((row) => (
              <li key={`${row.provider}-${row.taskType}`} style={{ overflowWrap: "anywhere" }}>
                <strong>
                  {PROVIDER[row.provider] ?? row.provider} · {row.taskType}
                </strong>
                : {row.samples} Task(s), {row.verified} verified passed, {row.verifiedFailed} verified failed, {row.failed} failed, {row.stopped} stopped by you,{" "}
                {row.repairs} repair attempt(s), {duration(row.medianMs)}
                {row.inputTokens || row.outputTokens ? `, ${row.inputTokens.toLocaleString()} in / ${row.outputTokens.toLocaleString()} out tokens` : ""}, cost{" "}
                {row.costUsd === null ? "unknown" : `$${row.costUsd.toFixed(2)}`}. Your feedback: {row.feedback.positive} liked, {row.feedback.negative} disliked.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ai-card" aria-labelledby="routing-candidates">
        <header>
          <div style={{ minWidth: 0 }}>
            <strong id="routing-candidates">Improve routing</strong>
            <p>
              A candidate is replayed on past decisions first. If it fixes verified failures without changing verified successes, it can be shadow
              tested: it scores every new Task beside the routing in use but never chooses what runs. After {learning.shadowMinVerified} verified
              Tasks with no risk, you may accept it.
            </p>
          </div>
        </header>
        <div className="setting-row">
          <div>
            <strong>Ask Bunny for a proposal</strong>
            <p>Bunny searches a small, bounded set of settings and suggests the one your verified results support, or explains why none helps.</p>
          </div>
          <button type="button" className="btn secondary" disabled={disabled} onClick={() => void send("propose", {}, "Bunny proposed a candidate. Review it below.")}>
            Propose
          </button>
        </div>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <strong>Try your own</strong>
            <p>{weightsLine(draft)}</p>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label="Weight of past results" value={draft.historyWeight} disabled={disabled} onChange={(event) => setDraft({ ...draft, historyWeight: Number(event.target.value) })}>
              {LEARNING_GRID.historyWeight.map((value) => (
                <option key={value} value={value}>
                  Past results ×{value}
                </option>
              ))}
            </select>
            <select aria-label="Weight of speed" value={draft.latencyWeight} disabled={disabled} onChange={(event) => setDraft({ ...draft, latencyWeight: Number(event.target.value) })}>
              {LEARNING_GRID.latencyWeight.map((value) => (
                <option key={value} value={value}>
                  {value ? `Speed ×${value}` : "Speed off"}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={draft.perTaskType}
                disabled={disabled}
                style={{ width: 16, height: 16, minHeight: 0, flex: "none" }}
                onChange={(event) => setDraft({ ...draft, perTaskType: event.target.checked })}
              />
              Per kind of task
            </label>
            <button type="button" className="btn secondary" disabled={disabled} onClick={() => void send("candidate", { ...draft }, "Candidate evaluated. Review it below.")}>
              Evaluate
            </button>
          </div>
        </div>
        {learning.candidates.length === 0 ? (
          <p className="caption">No candidates yet.</p>
        ) : (
          learning.candidates.map((row) => (
            <div key={row.id} className="setting-row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <strong>
                  {STATE_LABEL[row.state]} · {row.id.slice(0, 8)} · {row.proposedBy === "evidence" ? "proposed by Bunny" : "yours"}
                </strong>
                <p>{weightsLine(row.weights)}</p>
                <p>{evaluationLine(row)}</p>
                {row.benchmarkRegressions ? <p>Changes {row.benchmarkRegressions} case(s) of Bunny's fixed routing checks.</p> : null}
                {shadowLine(row) ? <p>{shadowLine(row)}</p> : null}
                {row.gate && !row.gate.ok ? <p>Not ready: {row.gate.reason}</p> : row.gate?.ok ? <p>{row.state === "shadow" ? "Ready to accept." : "Ready for a shadow test."}</p> : null}
                {row.reason && row.state !== "evaluated" ? <p>{row.reason}</p> : null}
              </div>
              {row.state === "evaluated" || row.state === "shadow" ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {row.state === "evaluated" ? (
                    <button type="button" className="btn secondary" disabled={disabled || !row.gate?.ok} onClick={() => void send("shadow", { id: row.id }, "Shadow test started. Routing is unchanged.")}>
                      Shadow test
                    </button>
                  ) : (
                    <button type="button" className="btn secondary" disabled={disabled || !row.gate?.ok} onClick={() => void send("accept", { id: row.id }, "Policy accepted. New Tasks use it.")}>
                      Accept
                    </button>
                  )}
                  <button type="button" className="btn secondary" disabled={disabled} onClick={() => void send("reject", { id: row.id }, "Candidate rejected.")}>
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>
      <p className="caption" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
