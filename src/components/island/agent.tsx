import { Pause, Play, Square } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ThemedDialogContent } from "./theme";
import { useIsland } from "@/store/use-island";
import { agentPanelRows, CHECKPOINT_LABEL } from "./agent-model";
import { teamAgentIds, teamPanels, type TeamPanel } from "./team-model";
import { useState } from "react";
import type { AgenticProjection } from "../../lib/bunny-missions/agentic-types";
import { controlCaption, isDevice, offerVerdict, WORKSTATION_CAPTION } from "./remote-view-model";

export function AuthorizationCard({
  id,
  authorization: a,
}: {
  id: string;
  authorization: AgenticProjection;
}) {
  const store = useIsland();
  // M-A-3 T9: a fresh canonical view, no unconfirmed command on this Agent, and the Host's own verdict.
  const caption = controlCaption({
    canAct: store.canAct(),
    targetId: id,
    pending: store.pending,
    uncertain: store.uncertain,
  });
  const busy = !!store.pending[id];
  const allowed = caption === null;
  const device = isDevice(store.viewer);
  const offer = offerVerdict(a, store.viewer);
  const [confirming, setConfirming] = useState<"deny" | "revoke" | null>(null);
  const act = async (
    action: "approve" | "adjust" | "deny" | "revoke",
    patch?: { maximumActions: number; durationMs: number; capabilities: string[] },
  ) => {
    if (!allowed) return;
    await store.agentAuthorization(id, action, a.revision, patch);
  };
  const [adjusting, setAdjusting] = useState(false);
  const [actions, setActions] = useState(a.maximumActions);
  const [minutes, setMinutes] = useState(Math.max(1, Math.floor(a.durationMs / 60_000)));
  const [selected, setSelected] = useState(a.capabilities);
  const ended = ["REVOKED", "EXPIRED", "COMPLETED", "EXHAUSTED"].includes(a.state);
  return (
    <div className="agent-authorization" aria-busy={busy} data-testid={`agent-authorization-${id}`}>
      <strong>Mission access · {a.state.replaceAll("_", " ").toLowerCase()}</strong>
      <p className="caption">{a.objective}</p>
      <ul aria-label="Requested access">
        {a.capabilities.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
      <p className="caption wrap-anywhere">
        Workspace: {a.roots.filter((root, i, roots) => roots.indexOf(root) === i).join(", ")}
      </p>
      {a.browserOrigins?.length ? (
        <p className="caption">Browser origins: {a.browserOrigins.join(", ")}</p>
      ) : null}
      {a.applications?.length ? (
        <p className="caption">Applications: {a.applications.join(", ")}</p>
      ) : null}
      {a.commands.map((command, i) => (
        <p className="caption wrap-anywhere" key={i}>
          Exact test:{" "}
          <code>
            {command.command} {command.args.join(" ")}
          </code>{" "}
          · {Math.ceil(command.timeoutMs / 1000)} seconds
        </p>
      ))}
      <p className="caption">
        {a.remainingActions} of {a.maximumActions} actions remain ·{" "}
        {Math.ceil(a.remainingMs / 60_000)} minutes remain · up to {a.maximumConcurrency} at once ·
        risk ceiling {a.riskCeiling.toLowerCase()}
      </p>
      <p className="caption">
        Expires {new Date(a.expiresAt).toLocaleString()} · scope revision {a.revision}
      </p>
      <p className="caption">
        Publishing, messages, system changes, credentials and arbitrary shells require separate
        review.
      </p>
      <details>
        <summary>Execution boundaries</summary>
        <ul>
          {a.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      {a.latestAdmission ? (
        <p className="caption">
          Latest admission: {a.latestAdmission.capability} ·{" "}
          {a.latestAdmission.outcome.toLowerCase()}
        </p>
      ) : null}
      {a.pending.map((request) => (
        <p className="caption wrap-anywhere" key={request.id}>
          Pending request: {request.action} · {request.resource ? `${request.resource} · ` : ""}
          {request.reason}
        </p>
      ))}
      {adjusting && !device ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act("adjust", {
              maximumActions: actions,
              durationMs: minutes * 60_000,
              capabilities: selected,
            });
          }}
        >
          <label>
            Maximum total actions{" "}
            <input
              aria-label="Maximum total actions"
              type="number"
              min="1"
              max={a.maximumActions}
              value={actions}
              onChange={(event) => setActions(Number(event.target.value))}
            />
          </label>
          <label>
            Duration in minutes{" "}
            <input
              aria-label="Authorization duration in minutes"
              type="number"
              min="1"
              max={Math.floor(a.durationMs / 60_000)}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          {a.capabilities.map((capability) => (
            <label key={capability}>
              <input
                type="checkbox"
                checked={selected.includes(capability)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, capability]
                      : selected.filter((c) => c !== capability),
                  )
                }
              />
              {capability}
            </label>
          ))}
          <button className="btn secondary" type="submit" disabled={!allowed}>
            Save reduced scope
          </button>
          <button className="btn quiet" type="button" onClick={() => setAdjusting(false)}>
            Cancel
          </button>
        </form>
      ) : null}
      <div className="actions">
        {a.state === "WAITING_FOR_USER" ? (
          <>
            {offer.allowed ? (
              <button className="btn primary" disabled={!allowed} onClick={() => void act("approve")}>
                {busy && store.pending[id] === "agent.authorization.approve" ? "Authorizing…" : "Authorize Mission"}
              </button>
            ) : (
              <p className="control-caption host-required">{offer.caption}</p>
            )}
            <button className="btn quiet" disabled={!allowed} onClick={() => setConfirming("deny")}>
              Deny
            </button>
          </>
        ) : null}
        {!ended ? (
          <>
            {device ? (
              <p className="control-caption">Reducing scope · {WORKSTATION_CAPTION}</p>
            ) : (
              <button
                className="btn quiet"
                disabled={!allowed}
                onClick={() => setAdjusting(!adjusting)}
              >
                Reduce scope
              </button>
            )}
            <button className="btn danger" disabled={!allowed} onClick={() => setConfirming("revoke")}>
              Revoke access
            </button>
          </>
        ) : null}
      </div>
      {caption && (
        <p className="control-caption" role="status">
          {caption}
        </p>
      )}
      <Dialog.Root open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <ThemedDialogContent className="t8-dialog">
            <Dialog.Title>{confirming === "deny" ? "Deny this Mission access?" : "Revoke this Mission access?"}</Dialog.Title>
            <Dialog.Description>
              {confirming === "deny"
                ? "The Host refuses this consent offer and stops the Agent. Completed work and artifacts stay."
                : "The Host ends this authorization and stops the Agent. Completed work and artifacts stay; effects already made are not undone."}
            </Dialog.Description>
            <div className="actions">
              <Dialog.Close asChild>
                <button className="btn secondary">Keep access</button>
              </Dialog.Close>
              <button
                className="btn danger"
                onClick={async () => {
                  const action = confirming;
                  setConfirming(null);
                  if (action) await act(action);
                }}
              >
                {confirming === "deny" ? "Deny access" : "Revoke access"}
              </button>
            </div>
          </ThemedDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/**
 * M-A-3 T4 — minimal durable-Agent panel. Honest control states only: Pause is offered while the
 * agent can still pause, Resume only a paused agent, Stop anything not already finished.
 */
export function AgentsSection() {
  const store = useIsland();
  const inTeams = teamAgentIds(store.agents);
  const { rows, more } = agentPanelRows(store.agents ? { ...store.agents, agents: store.agents.agents.filter((agent) => !inTeams.has(agent.id)) } : store.agents);
  const teams = teamPanels(store.agents, store.missions?.missions);
  if (!rows.length && !teams.length) return null;
  if (!rows.length) return <TeamsSection teams={teams} />;
  return (
    <>
    {teams.length ? <TeamsSection teams={teams} /> : null}
    <section className="today-section agents-section" data-testid="agents-section">
      <div className="section-heading">
        <h2 className="eyebrow">Persistent agents</h2>
        <span className="caption">
          {more ? `${rows.length} of ${rows.length + more}` : `${rows.length}`}
        </span>
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
                      row.lastCheckpoint
                        ? ` · last: ${CHECKPOINT_LABEL[row.lastCheckpoint.boundary] ?? row.lastCheckpoint.boundary}`
                        : ""
                    }`
                  : ""}
              </small>
            </div>
            {row.note ? <p className="caption">{row.note}</p> : null}
            {row.activity ? (
              <div className="agent-activity">
                <p className="caption">
                  {row.activity.application} · {row.activity.step} · {row.activity.completed} of{" "}
                  {row.activity.total} steps completed
                </p>
                <p className="caption">{row.activity.verification}</p>
                <details>
                  <summary>Steps and verified artifacts</summary>
                  <ol>
                    {row.activity.history.map((item, index) => (
                      <li key={index}>
                        {item.step} · {item.state.replaceAll("_", " ")}
                      </li>
                    ))}
                  </ol>
                  <ul>
                    {row.activity.artifacts.map((artifact) => (
                      <li key={artifact.id}>
                        <button
                          className="btn quiet"
                          onClick={() => store.openMission(row.missionId ?? null)}
                        >
                          {artifact.title} · verified
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}
            {row.authorizationError ? (
              <p role="alert" className="caption">
                {row.authorizationError}
              </p>
            ) : null}
            {row.authorization ? (
              <AuthorizationCard
                key={`${row.id}-${row.authorization.revision}`}
                id={row.id}
                authorization={row.authorization}
              />
            ) : ["CREATED", "PLANNING"].includes(row.state) ? (
              <button
                className="btn secondary"
                onClick={() => void store.agentAuthorization(row.id, "propose")}
              >
                Review bounded Mission access
              </button>
            ) : null}
            <div className="actions" data-testid={`agent-actions-${row.id}`}>
              <button
                className="btn quiet"
                disabled={
                  !row.controllable ||
                  row.paused ||
                  (!!row.authorization && row.authorization.state !== "ACTIVE")
                }
                title={
                  row.paused
                    ? "Already paused; nothing new is admitted."
                    : row.controllable
                      ? "Pause: keep finished work, hold new steps."
                      : "Finished agents cannot pause."
                }
                aria-label={`Pause agent ${row.name}`}
                onClick={() => void store.pauseAgent(row.id)}
              >
                <Pause size={13} /> Pause
              </button>
              <button
                className="btn secondary"
                disabled={!row.paused}
                title={
                  row.paused
                    ? "Resume: revalidate authority, finish what is admitted."
                    : "Only a paused agent can resume."
                }
                aria-label={`Resume agent ${row.name}`}
                onClick={() => void store.resumeAgent(row.id)}
              >
                <Play size={13} /> Resume
              </button>
              <button
                className="btn danger"
                disabled={!row.controllable}
                title={
                  row.controllable
                    ? "Stop: persisted first; nothing revives it."
                    : "Finished agents cannot stop again."
                }
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
    </>
  );
}

/**
 * M-A-3 T11 — Agent teams: who is working on what, the reviewed plan graph, verified handoffs, Bunny's verdict per
 * requirement and the advisory Reviewer findings. Approve binds to the exact reviewed plan reference.
 */
export function TeamsSection({ teams }: { teams: TeamPanel[] }) {
  return (
    <section className="today-section agents-section" data-testid="teams-section">
      <div className="section-heading">
        <h2 className="eyebrow">Agent teams</h2>
        <span className="caption">{teams.length}</span>
      </div>
      {teams.map((team) => <TeamCard key={team.missionId} team={team} />)}
    </section>
  );
}

function TeamCard({ team }: { team: TeamPanel }) {
  const store = useIsland();
  const [note, setNote] = useState("");
  const working = team.members.filter((member) => member.state === "RUNNING" || member.state === "VERIFYING").length;
  return (
    <article className="glass team-card" data-testid={`team-${team.missionId}`} data-phase={team.phase}>
      <div className="agent-run-title">
        <strong>{team.name}</strong>
        <small>
          {team.phase === "planning" ? "Planner Agent is proposing a plan" : team.phase === "review" ? "Plan ready for your review" : team.phase === "ended" ? `Mission ${team.missionState}` : `${working} of ${team.members.length} Agents working`}
          {` · ${team.progress.done} of ${team.progress.total} tasks done`}
          {team.reworkRounds ? ` · ${team.reworkRounds} rework round${team.reworkRounds === 1 ? "" : "s"}` : ""}
          {team.approvals ? ` · ${team.approvals} awaiting you` : ""}
        </small>
      </div>
      <ul className="agent-run-list" aria-label="Team members">
        {team.members.map((member) => (
          <li key={member.id} data-state={member.state} data-role={member.role}>
            <div className="agent-run-title">
              <strong>{member.roleLabel}</strong>
              <small>
                {member.stateLabel}
                {member.task ? ` · ${member.task}${member.taskState ? ` (${member.taskState})` : ""}` : ""}
                {member.owned ? ` · ${member.owned.verified}/${member.owned.total} verified` : ""}
              </small>
            </div>
            {member.model ? <p className="caption">{member.model}</p> : null}
            <div className="actions">
              <button className="btn quiet" disabled={!member.controllable || member.paused} aria-label={`Pause ${member.roleLabel} agent`} title="Pause this Agent only: its admitted step finishes, nothing new of its own starts." onClick={() => void store.pauseAgent(member.id)}><Pause size={13} /> Pause</button>
              <button className="btn secondary" disabled={!member.paused} aria-label={`Resume ${member.roleLabel} agent`} onClick={() => void store.resumeAgent(member.id)}><Play size={13} /> Resume</button>
              <button className="btn danger" disabled={!member.controllable} aria-label={`Stop ${member.roleLabel} agent`} title="Stop this Agent only; the team waits for you if its work was needed." onClick={() => void store.stopAgent(member.id)}><Square size={12} /> Stop</button>
            </div>
          </li>
        ))}
      </ul>
      {team.graph.length ? (
        <details open={team.phase === "review"}>
          <summary>Plan · {team.graph.length} tasks{team.reserved ? ` · ${team.reserved} reserved rework step${team.reserved === 1 ? "" : "s"}` : ""}</summary>
          <ol className="team-graph" aria-label="Task graph">
            {team.graph.map((node) => (
              <li key={node.id} data-state={node.state}>
                <strong>{node.key}</strong> · {node.label} · {node.stateLabel}{node.verified ? " · verified by Bunny" : ""}{node.rework ? ` · rework round ${node.round}` : ""}
                <br />
                <small>{node.objective}{node.dependsOn.length ? ` — after ${node.dependsOn.join(", ")}` : ""}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {team.rejected.length ? (
        <details>
          <summary>Bunny rejected {team.planRevisions} plan proposal{team.planRevisions === 1 ? "" : "s"}</summary>
          <ul>{team.rejected.map((reason, index) => <li key={index} className="caption">{reason}</li>)}</ul>
        </details>
      ) : null}
      <div aria-label="Requirements">
        <p className="eyebrow">Requirements · checked by Bunny</p>
        <ul>
          {team.requirements.map((requirement) => (
            <li key={requirement.id} data-state={requirement.state}>
              {requirement.id} · {requirement.text} — {requirement.state === "passed" ? "passed" : requirement.state === "failed" ? "failed" : "not checked yet"}
              {requirement.detail ? <small> ({requirement.detail})</small> : null}
            </li>
          ))}
        </ul>
      </div>
      {team.findings.length ? (
        <details>
          <summary>Reviewer findings (advisory; Bunny&apos;s checks decide)</summary>
          {team.findings.map((review, index) => (
            <ul key={index}>
              {review.items.map((item, at) => <li key={at} className="caption">{item.requirement ?? "General"} · {item.severity} · {item.summary} · Bunny {item.host}</li>)}
            </ul>
          ))}
        </details>
      ) : null}
      {team.handoffs.length ? (
        <details>
          <summary>Verified handoffs · {team.handoffs.length}</summary>
          <ul>{team.handoffs.map((handoff) => <li key={handoff.id} className="caption">{handoff.from} → {handoff.to} · {handoff.type} · sha256 {handoff.sha}… · {handoff.state === "DELIVERED" ? "delivered" : "refused"}</li>)}</ul>
        </details>
      ) : null}
      <div className="actions" data-testid={`team-actions-${team.missionId}`}>
        {team.phase === "review" ? (
          <>
            <button className="btn primary" disabled={!team.planReference} title="Approve exactly the plan shown here." onClick={() => void store.approveTeamPlan(team.coordinatorId, team.planReference)}>Approve plan</button>
            <input className="input" value={note} maxLength={600} placeholder="Optional note for a revised plan" aria-label="Revision note" onChange={(event) => setNote(event.target.value)} />
            <button className="btn secondary" onClick={() => void store.reviseTeamPlan(team.coordinatorId, note)}>Ask for a revised plan</button>
          </>
        ) : team.phase === "planning" && team.missionState === "waiting_for_approval" ? (
          <button className="btn primary" onClick={() => void store.approveTeamPlan(team.coordinatorId, null)}>Start planning</button>
        ) : null}
        <button className="btn quiet" onClick={() => store.openMission(team.missionId)}>Open Mission</button>
        <button className="btn quiet" disabled={!team.controllable || team.paused} onClick={() => void store.pauseAgent(team.coordinatorId)}><Pause size={13} /> Pause team</button>
        <button className="btn secondary" disabled={!team.paused} onClick={() => void store.resumeAgent(team.coordinatorId)}><Play size={13} /> Resume team</button>
        <button className="btn danger" disabled={!team.controllable} title="Stops every Agent of this team." onClick={() => void store.stopAgent(team.coordinatorId)}><Square size={12} /> Stop team</button>
      </div>
    </article>
  );
}

