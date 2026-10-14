import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { OPEN_STATES, WORKER_LIMITS, type AgentWorker, type WorkerAbility, type WorkerState } from "@/lib/bunny-host/workers";
import type { SlotId } from "@/lib/bunny-host/personal-agents";

const STATE: Record<WorkerState, string> = {
  PROPOSED: "Proposed",
  ELIGIBILITY_CHECK: "Checking",
  ADMITTED: "Waiting for your approval",
  RUNNING: "Running",
  RESULT_REPORTED: "Reported",
  VERIFIED: "Verified by the Host",
  REJECTED: "Rejected",
  INDETERMINATE: "Not verified",
  CLOSED: "Closed",
};
const LIVE = new Set(["draft", "planning", "waiting_for_approval", "ready", "running", "waiting_for_user", "verifying"]);

const outcome = (worker: AgentWorker) =>
  worker.state === "CLOSED" ? [...worker.history].reverse().find((row) => row.state !== "CLOSED")?.state ?? "CLOSED" : worker.state;

/**
 * M-A-3 T13.3 Gate D: one Personal Agent's bounded workers. The Host decides admission, runs each worker as a child Mission
 * and judges the result; this panel only proposes, cancels and reviews abilities.
 */
export function AgentWorkers({ slot, name, workers, abilities, ownedMissionIds }: { slot: SlotId; name: string; workers: AgentWorker[]; abilities: WorkerAbility[]; ownedMissionIds: string[] }) {
  const store = useIsland();
  const parents = (store.missions?.missions ?? []).filter((mission) => ownedMissionIds.includes(mission.id) && LIVE.has(mission.state));
  const active = abilities.filter((ability) => ability.status === "active");
  const components = abilities.filter((ability) => ability.source === "builtin" && ability.kind === "skill" && !ability.parameters?.length);
  const [parentId, setParentId] = useState("");
  const [abilityId, setAbilityId] = useState("test");
  const [objective, setObjective] = useState("");
  const [url, setUrl] = useState("");
  const [compose, setCompose] = useState({ name: "", description: "", components: [] as string[] });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true);
    setRefusal(null);
    const result = await store.personalAgentCommand(action, data, setRefusal);
    setBusy(false);
    return result;
  };
  const parent = parents.find((mission) => mission.id === parentId) ?? parents[0];
  const ability = active.find((row) => row.id === abilityId);
  const disabled = busy || !store.canAct();
  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-heading">
        <h3 id={`workers-${slot}`}>{name}'s workers</h3>
      </div>
      <p className="caption">
        A worker is a small child Mission inside one of {name}'s Missions, with its own time limit and tools. Only the Host's own checks can verify it; a worker
        saying it succeeded is not enough.
      </p>
      <ul aria-labelledby={`workers-${slot}`} style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "grid", gap: 8 }}>
        {workers.map((worker) => (
          <li key={worker.id} className="ap-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <span style={{ flex: "1 1 240px", minWidth: 0 }}>
              <strong>{worker.abilityName}</strong>
              <small className="cx-muted">
                {" "}
                · {STATE[outcome(worker)]} · up to {Math.round(worker.budget.timeoutMs / 60_000)} min
              </small>
              <span style={{ display: "block", overflowWrap: "anywhere" }}>{worker.objective}</span>
              {(worker.result?.reason || worker.problems.length > 0) && (
                <small className="cx-muted" style={{ display: "block", overflowWrap: "anywhere" }}>
                  {worker.result ? `${worker.result.summary} ${worker.result.reason}` : worker.problems.join(" ")}
                </small>
              )}
            </span>
            {OPEN_STATES.includes(worker.state) && (
              <span className="ap-actions">
                <button type="button" className="btn" disabled={disabled} onClick={() => void act("worker.cancel", { id: worker.id })} aria-label={`Stop ${worker.abilityName} worker`}>
                  Stop
                </button>
              </span>
            )}
          </li>
        ))}
        {!workers.length && <li className="cx-muted">No workers yet.</li>}
      </ul>
      {parents.length ? (
        <form
          className="ap-actions"
          style={{ flexWrap: "wrap" }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!parent || !ability) return;
            const data = { slot, parentMissionId: parent.id, ability: ability.id, objective, ...(parent.projectId ? { projectId: parent.projectId } : {}), ...(ability.parameters?.includes("url") ? { params: { url } } : {}) };
            if (await act("worker.propose", data)) setObjective("");
          }}
        >
          <label style={{ flex: "1 1 160px" }}>
            <span className="cx-muted">Inside Mission</span>
            <select value={parent?.id ?? ""} onChange={(event) => setParentId(event.target.value)} style={{ width: "100%" }}>
              {parents.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.title}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: "1 1 140px" }}>
            <span className="cx-muted">Ability</span>
            <select value={ability?.id ?? ""} onChange={(event) => setAbilityId(event.target.value)} style={{ width: "100%" }}>
              {active.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: "2 1 220px" }}>
            <span className="cx-muted">What the worker should do</span>
            <input value={objective} maxLength={WORKER_LIMITS.objective} onChange={(event) => setObjective(event.target.value)} style={{ width: "100%" }} />
          </label>
          {ability?.parameters?.includes("url") && (
            <label style={{ flex: "2 1 220px" }}>
              <span className="cx-muted">Page address</span>
              <input value={url} type="url" onChange={(event) => setUrl(event.target.value)} style={{ width: "100%" }} />
            </label>
          )}
          <button type="submit" className="btn primary" disabled={disabled || !objective.trim() || !ability}>
            Add worker
          </button>
        </form>
      ) : (
        <p className="caption">Give {name} a Mission first; workers only run inside a Mission it owns.</p>
      )}
      <h4 style={{ margin: "12px 0 4px" }}>Abilities</h4>
      <ul aria-label="Abilities you described" style={{ listStyle: "none", padding: 0, margin: "4px 0", display: "grid", gap: 6 }}>
        {abilities
          .filter((row) => row.source === "user")
          .map((row) => (
            <li key={row.id} className="ap-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <span style={{ flex: "1 1 240px", minWidth: 0 }}>
                <strong>{row.name}</strong>
                <small className="cx-muted">
                  {" "}
                  · {row.status === "active" ? "Approved" : "Waiting for your review"} · runs {row.components?.join(", ")}
                </small>
                <span style={{ display: "block", overflowWrap: "anywhere" }}>{row.description}</span>
              </span>
              <span className="ap-actions">
                {row.status !== "active" && (
                  <button type="button" className="btn primary" disabled={disabled} onClick={() => void act("worker.ability.approve", { id: row.id })} aria-label={`Approve ${row.name}`}>
                    Approve
                  </button>
                )}
                <button type="button" className="btn" disabled={disabled} onClick={() => void act("worker.ability.remove", { id: row.id })} aria-label={`Remove ${row.name}`}>
                  Remove
                </button>
              </span>
            </li>
          ))}
      </ul>
      <form
        className="ap-actions"
        style={{ flexWrap: "wrap" }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (await act("worker.ability.compose", compose)) setCompose({ name: "", description: "", components: [] });
        }}
      >
        <label style={{ flex: "1 1 140px" }}>
          <span className="cx-muted">New ability name</span>
          <input value={compose.name} maxLength={60} onChange={(event) => setCompose({ ...compose, name: event.target.value })} style={{ width: "100%" }} />
        </label>
        <label style={{ flex: "2 1 220px" }}>
          <span className="cx-muted">Describe what it does</span>
          <input value={compose.description} maxLength={400} onChange={(event) => setCompose({ ...compose, description: event.target.value })} style={{ width: "100%" }} />
        </label>
        <fieldset style={{ flex: "1 1 100%", border: 0, padding: 0, margin: 0 }}>
          <legend className="cx-muted">Built from (in order)</legend>
          <span className="st-tags">
            {components.map((row) => (
              <label key={row.id} className="st-tag" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={compose.components.includes(row.id)}
                  onChange={(event) =>
                    setCompose({ ...compose, components: event.target.checked ? [...compose.components, row.id] : compose.components.filter((id) => id !== row.id) })
                  }
                />
                {row.name}
              </label>
            ))}
          </span>
        </fieldset>
        <button type="submit" className="btn" disabled={disabled || !compose.name.trim() || !compose.description.trim() || !compose.components.length}>
          Describe ability
        </button>
      </form>
      {refusal && (
        <p className="st-error" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
