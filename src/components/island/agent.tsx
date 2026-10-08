import { Pause, Play, Square } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { agentPanelRows, CHECKPOINT_LABEL } from "./agent-model";

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
            <div className="actions" data-testid={`agent-actions-${row.id}`}>
              <button
                className="btn quiet"
                disabled={!row.controllable || row.paused}
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