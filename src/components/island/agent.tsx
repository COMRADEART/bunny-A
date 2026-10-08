import { Pause, Play, Square } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { agentPanelRows, CHECKPOINT_LABEL } from "./agent-model";
import { useState } from "react";
import type { AgenticProjection } from "../../lib/bunny-missions/agentic-types";

function AuthorizationCard({ id, authorization: a }: { id: string; authorization: AgenticProjection }) {
  const store = useIsland();
  const [adjusting, setAdjusting] = useState(false);
  const [actions, setActions] = useState(a.maximumActions);
  const [minutes, setMinutes] = useState(Math.max(1, Math.floor(a.durationMs / 60_000)));
  const [selected, setSelected] = useState(a.capabilities);
  const ended = ["REVOKED", "EXPIRED", "COMPLETED", "EXHAUSTED"].includes(a.state);
  return <div className="agent-authorization" data-testid={`agent-authorization-${id}`}>
    <strong>Mission access · {a.state.replaceAll("_", " ").toLowerCase()}</strong>
    <p className="caption">{a.objective}</p>
    <ul aria-label="Requested access">{a.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul>
    <p className="caption">Workspace: {a.roots.filter((root, i, roots) => roots.indexOf(root) === i).join(", ")}</p>
    {a.browserOrigins?.length ? <p className="caption">Browser origins: {a.browserOrigins.join(", ")}</p> : null}
    {a.applications?.length ? <p className="caption">Applications: {a.applications.join(", ")}</p> : null}
    {a.commands.map((command, i) => <p className="caption" key={i}>Exact test: <code>{command.command} {command.args.join(" ")}</code> · {Math.ceil(command.timeoutMs / 1000)} seconds</p>)}
    <p className="caption">{a.remainingActions} of {a.maximumActions} actions remain · {Math.ceil(a.remainingMs / 60_000)} minutes remain · up to {a.maximumConcurrency} at once · risk ceiling {a.riskCeiling.toLowerCase()}</p>
    <p className="caption">Publishing, messages, system changes, credentials and arbitrary shells require separate review.</p>
    <details><summary>Execution boundaries</summary><ul>{a.limitations.map(line => <li key={line}>{line}</li>)}</ul></details>
    {a.latestAdmission ? <p className="caption">Latest admission: {a.latestAdmission.capability} · {a.latestAdmission.outcome.toLowerCase()}</p> : null}
    {a.pending.map(request => <p className="caption" key={request.id}>Additional access: {request.action} · {request.resource ? `${request.resource} · ` : ""}{request.reason}</p>)}
    {adjusting ? <form onSubmit={event => { event.preventDefault(); void store.agentAuthorization(id, "adjust", a.revision, { maximumActions: actions, durationMs: minutes * 60_000, capabilities: selected }).then(() => setAdjusting(false)); }}>
      <label>Maximum total actions <input aria-label="Maximum total actions" type="number" min="1" max={a.maximumActions} value={actions} onChange={event => setActions(Number(event.target.value))} /></label>
      <label>Duration in minutes <input aria-label="Authorization duration in minutes" type="number" min="1" max={Math.floor(a.durationMs / 60_000)} value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></label>
      {a.capabilities.map(capability => <label key={capability}><input type="checkbox" checked={selected.includes(capability)} onChange={event => setSelected(event.target.checked ? [...selected, capability] : selected.filter(c => c !== capability))} />{capability}</label>)}
      <button className="btn secondary" type="submit">Save reduced scope</button><button className="btn quiet" type="button" onClick={() => setAdjusting(false)}>Cancel</button>
    </form> : null}
    <div className="actions">
      {a.state === "WAITING_FOR_USER" ? <><button className="btn primary" onClick={() => void store.agentAuthorization(id, "approve", a.revision)}>Authorize Mission</button><button className="btn quiet" onClick={() => void store.agentAuthorization(id, "deny", a.revision)}>Deny</button></> : null}
      {!ended ? <><button className="btn quiet" onClick={() => setAdjusting(!adjusting)}>Adjust scope</button><button className="btn danger" onClick={() => void store.agentAuthorization(id, "revoke", a.revision)}>Revoke access</button></> : null}
    </div>
  </div>;
}

/**
 * M-A-3 T4 — minimal durable-Agent panel. Honest control states only: Pause is offered while the
 * agent can still pause, Resume only a paused agent, Stop anything not already finished.
 */
export function AgentsSection() {
  const store = useIsland();
  const { rows, more } = agentPanelRows(store.agents);
  if (!rows.length) return null;
  return (
    <section className="today-section agents-section" data-testid="agents-section">
      <div className="section-heading">
        <h2 className="eyebrow">Persistent agents</h2>
        <span className="caption">{more ? `${rows.length} of ${rows.length + more}` : `${rows.length}`}</span>
      </div>
      <ul className="agent-run-list glass">
        {rows.map((row) => (
          <li key={row.id} data-state={row.state}>
            <div className="agent-run-title">
              <strong>{row.name}</strong>
              <small>
                {row.label}
                {row.generation != null ? ` · generation ${row.generation}` : ""}
                {row.checkpoints
                  ? ` · ${row.checkpoints} checkpoint${row.checkpoints === 1 ? "" : "s"}${
                      row.lastCheckpoint ? ` · last: ${CHECKPOINT_LABEL[row.lastCheckpoint.boundary] ?? row.lastCheckpoint.boundary}` : ""
                    }`
                  : ""}
              </small>
            </div>
            {row.note ? <p className="caption">{row.note}</p> : null}
            {row.activity ? <div className="agent-activity">
              <p className="caption">{row.activity.application} · {row.activity.step} · {row.activity.completed} of {row.activity.total} steps completed</p>
              <p className="caption">{row.activity.verification}</p>
              <details><summary>Steps and verified artifacts</summary><ol>{row.activity.history.map((item, index) => <li key={index}>{item.step} · {item.state.replaceAll("_", " ")}</li>)}</ol><ul>{row.activity.artifacts.map(artifact => <li key={artifact.id}><button className="btn quiet" onClick={() => store.openMission(row.missionId ?? null)}>{artifact.title} · verified</button></li>)}</ul></details>
            </div> : null}
            {row.authorizationError ? <p role="alert" className="caption">{row.authorizationError}</p> : null}
            {row.authorization ? <AuthorizationCard key={`${row.id}-${row.authorization.revision}`} id={row.id} authorization={row.authorization} /> : ["CREATED", "PLANNING"].includes(row.state) ? <button className="btn secondary" onClick={() => void store.agentAuthorization(row.id, "propose")}>Review bounded Mission access</button> : null}
            <div className="actions" data-testid={`agent-actions-${row.id}`}>
              <button
                className="btn quiet"
                disabled={!row.controllable || row.paused || (!!row.authorization && row.authorization.state !== "ACTIVE")}
                title={row.paused ? "Already paused; nothing new is admitted." : row.controllable ? "Pause: keep finished work, hold new steps." : "Finished agents cannot pause."}
                aria-label={`Pause agent ${row.name}`}
                onClick={() => void store.pauseAgent(row.id)}
              >
                <Pause size={13} /> Pause
              </button>
              <button
                className="btn secondary"
                disabled={!row.paused}
                title={row.paused ? "Resume: revalidate authority, finish what is admitted." : "Only a paused agent can resume."}
                aria-label={`Resume agent ${row.name}`}
                onClick={() => void store.resumeAgent(row.id)}
              >
                <Play size={13} /> Resume
              </button>
              <button
                className="btn danger"
                disabled={!row.controllable}
                title={row.controllable ? "Stop: persisted first; nothing revives it." : "Finished agents cannot stop again."}
                aria-label={`Stop agent ${row.name}`}
                onClick={() => void store.stopAgent(row.id)}
              >
                <Square size={12} /> Stop
              </button>
            </div>
          </li>
        ))}
      </ul>
      {more ? <p className="caption">+{more} more in Host history.</p> : null}
    </section>
  );
}
