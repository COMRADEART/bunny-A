import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  FileCheck2,
  Folder,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useIsland } from "@/store/use-island";
import { AuthorizationCard } from "./agent";
import { AGENT_STATE_LABEL, CHECKPOINT_LABEL } from "./agent-model";
import {
  agentControls,
  attentionRequired,
  currentAgentTask,
  selectedTaskModel,
  type AgentView,
} from "./workspace-model";
import { ActivityTimeline } from "./activity";
import { Empty, NAMES } from "./ui";
import { openTask } from "./task";
import { artifactStatus } from "@/lib/bunny-host/presentation";
import type { MissionView, ArtifactSummary } from "@/lib/bunny-missions/types";
import {
  allowVerdict,
  controlCaption,
  isDevice,
  pendingAsks,
  TALK_CAPTION,
  WORKSTATION_CAPTION,
  type PendingAsk,
} from "./remote-view-model";

export function AgentState({ agent }: { agent: AgentView }) {
  return (
    <span className="state-label" data-state={agent.state}>
      {AGENT_STATE_LABEL[agent.state]}
    </span>
  );
}
export function openAgent(agent: AgentView) {
  useIsland.setState({ sheet: "agentic", agentFocus: agent.id, missionFocus: agent.missionId });
}
export function AgentControls({ agent }: { agent: AgentView }) {
  const store = useIsland();
  const [confirmStop, setConfirmStop] = useState(false);
  // M-A-3 T9: controls act only on a fresh canonical view, and never on top of an unconfirmed command.
  const actNow = store.canAct();
  const caption = controlCaption({
    canAct: actNow,
    targetId: agent.id,
    pending: store.pending,
    uncertain: store.uncertain,
  });
  const busy = caption !== null && actNow;
  const allowed = agentControls(agent, actNow && caption === null);
  const consentFirst =
    agent.state === "PAUSED" && agent.authorization?.state === "WAITING_FOR_USER"
      ? "Review the Host's consent offer below before resuming."
      : null;
  const run = async (action: "pause" | "resume" | "stop") => {
    await (action === "pause"
      ? store.pauseAgent(agent.id)
      : action === "resume"
        ? store.resumeAgent(agent.id)
        : store.stopAgent(agent.id));
  };
  return (
    <div className="agent-controls" aria-label={`Controls for ${agent.name}`} aria-busy={busy}>
      <button
        className="btn secondary"
        disabled={!allowed.pause}
        onClick={() => void run("pause")}
        title="Hold new work admissions; already admitted effects may finish."
      >
        <Pause size={15} />
        {store.pending[agent.id] === "agent.pause" ? "Pausing…" : "Pause"}
      </button>
      <button
        className="btn secondary"
        disabled={!allowed.resume || !!consentFirst}
        onClick={() => void run("resume")}
        title="Host revalidates authorization, checkpoints and dependencies."
      >
        <Play size={15} />
        {store.pending[agent.id] === "agent.resume" ? "Resuming…" : "Resume"}
      </button>
      <Dialog.Root open={confirmStop} onOpenChange={setConfirmStop}>
        <Dialog.Trigger asChild>
          <button className="btn danger" disabled={!allowed.stop || busy}>
            <Square size={14} />
            Stop
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <Dialog.Content className="t8-dialog" data-theme={store.theme}>
            <Dialog.Title>Stop {agent.name}?</Dialog.Title>
            <Dialog.Description>
              Stop prevents new work. Completed work and artifacts stay. Effects already made are not
              undone, and an admitted step may still finish.
            </Dialog.Description>
            <div className="actions">
              <Dialog.Close asChild>
                <button className="btn secondary">Keep Agent</button>
              </Dialog.Close>
              <button
                className="btn danger"
                disabled={!allowed.stop}
                onClick={async () => {
                  setConfirmStop(false);
                  await run("stop");
                }}
              >
                Stop future work
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {(caption ?? consentFirst) && (
        <p className="control-caption" role="status">
          {caption ?? consentFirst}
        </p>
      )}
    </div>
  );
}

/**
 * M-A-3 T9 (PHONE-01): every unanswered Host ask for this Agent, answerable in place. Allow once appears only
 * where the Host said this viewer may give it; Deny is always available and always confirmed.
 */
export function PendingAsks({ agent, mission }: { agent: AgentView; mission?: MissionView }) {
  const store = useIsland();
  const asks = pendingAsks(agent.authorization, mission);
  const [denying, setDenying] = useState<PendingAsk | null>(null);
  if (!asks.length) return null;
  const actNow = store.canAct();
  const caption = controlCaption({
    canAct: actNow,
    targetId: agent.id,
    pending: store.pending,
    uncertain: store.uncertain,
  });
  return (
    <section className="t8-surface pending-asks" aria-label="Pending permission requests">
      <div className="section-heading">
        <h2>Bunny needs permission</h2>
        <ShieldCheck size={18} />
      </div>
      {asks.map((ask) => {
        const verdict = allowVerdict(ask, store.viewer);
        return (
          <article className="ask-card" key={ask.id} data-risk={ask.risk}>
            <dl className="fact-list">
              <div>
                <dt>Mission</dt>
                <dd>{mission?.title ?? mission?.objective ?? "Unavailable in this snapshot"}</dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>
                  <code>{ask.action}</code>
                </dd>
              </div>
              {ask.resource && (
                <div>
                  <dt>Exact target</dt>
                  <dd className="wrap-anywhere">{ask.resource}</dd>
                </div>
              )}
              <div>
                <dt>Risk</dt>
                <dd>{ask.risk.replaceAll("_", " ").toLowerCase()}</dd>
              </div>
              <div>
                <dt>Why the Host asks</dt>
                <dd className="wrap-anywhere">{ask.reason}</dd>
              </div>
              {agent.authorization && (
                <div>
                  <dt>Budget</dt>
                  <dd>
                    {agent.authorization.remainingActions} of {agent.authorization.maximumActions}{" "}
                    actions remain · {Math.ceil(agent.authorization.remainingMs / 60_000)} minutes
                  </dd>
                </div>
              )}
              <div>
                <dt>Revision</dt>
                <dd>{ask.revision ?? "Not an Agentic revision"}</dd>
              </div>
            </dl>
            <div className="actions">
              {verdict.allowed ? (
                <button
                  className="btn primary"
                  disabled={caption !== null}
                  onClick={() => void store.respondRequest(ask.id, "allow_once")}
                >
                  Allow once
                </button>
              ) : (
                <p className="control-caption host-required">{verdict.caption}</p>
              )}
              <button className="btn quiet" disabled={caption !== null} onClick={() => setDenying(ask)}>
                Deny
              </button>
            </div>
          </article>
        );
      })}
      {caption && (
        <p className="control-caption" role="status">
          {caption}
        </p>
      )}
      <Dialog.Root open={!!denying} onOpenChange={(open) => !open && setDenying(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <Dialog.Content className="t8-dialog" data-theme={store.theme}>
            <Dialog.Title>Deny {denying?.action}?</Dialog.Title>
            <Dialog.Description>
              The Host records your denial. This exact operation will not run, and the Mission step that
              needed it ends. Other completed work stays.
            </Dialog.Description>
            <div className="actions">
              <Dialog.Close asChild>
                <button className="btn secondary">Keep reviewing</button>
              </Dialog.Close>
              <button
                className="btn danger"
                onClick={async () => {
                  const target = denying;
                  setDenying(null);
                  if (target) await store.respondRequest(target.id, "deny");
                }}
              >
                Deny this request
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

export function AgenticWorkspace() {
  const store = useIsland();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const agents = store.agents?.agents ?? [];
  const missions = store.missions?.missions ?? [];
  const selected =
    agents.find((row) => row.id === store.agentFocus) ??
    (store.missionFocus ? agents.find((row) => row.missionId === store.missionFocus) : undefined);
  const matches = agents
    .filter(
      (row) =>
        `${row.name} ${missions.find((m) => m.id === row.missionId)?.objective ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "attention" ? attentionRequired(row) : row.state === filter)),
    )
    .sort(
      (a, b) =>
        Number(attentionRequired(b)) - Number(attentionRequired(a)) || b.updatedAt - a.updatedAt,
    );
  if (selected)
    return (
      <AgentDetail
        key={selected.id}
        agent={selected}
        mission={missions.find((row) => row.id === selected.missionId)}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Dedicated workspace</p>
          <h1>Agentic</h1>
          <p>Persistent work. Clear progress. You stay in control.</p>
        </div>
        {isDevice(store.viewer) ? (
          <p className="control-caption">New Agents · {WORKSTATION_CAPTION}</p>
        ) : (
          <button
            className="btn primary"
            disabled={!store.canAct() || !store.missions?.enabled}
            onClick={() => setCreating(!creating)}
          >
            <Plus size={16} />
            New Agent
          </button>
        )}
      </div>
      <div className="agentic-summary" aria-label="Agent overview">
        {[
          [
            "Working",
            agents.filter((row) => ["RUNNING", "VERIFYING", "PLANNING"].includes(row.state)).length,
          ],
          ["Needs attention", agents.filter(attentionRequired).length],
          ["Paused", agents.filter((row) => row.state === "PAUSED").length],
          ["Completed", agents.filter((row) => row.state === "COMPLETED").length],
          ["Failed", agents.filter((row) => row.state === "FAILED").length],
        ].map(([label, count]) => (
          <div key={label}>
            <strong>{store.hydratedFromHost ? count : "—"}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {creating && !isDevice(store.viewer) && (
        <form
          className="t8-surface new-agent-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const result = await store.projectCommand("project.agent.create", {
                projectId,
                name,
                objective,
              });
              if (result) {
                setCreating(false);
                setName("");
                setObjective("");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>Create persistent work</h2>
          <p className="caption">
            The Host creates a Mission in a registered Project. Its plan and requested access must
            be reviewed before execution.
          </p>
          <label>
            Agent name
            <input
              value={name}
              maxLength={120}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Project
            <select
              value={projectId}
              required
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Choose a registered Project</option>
              {store.projects.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mission objective
            <textarea
              value={objective}
              maxLength={4000}
              required
              rows={3}
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <div className="actions">
            <button className="btn primary" disabled={busy || store.host !== "online"}>
              Create for review
            </button>
            <button type="button" className="btn secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="workspace-tools">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search Agents"
            placeholder="Search Agents and objectives"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="sr-only" htmlFor="agent-filter">
          Agent status
        </label>
        <select
          id="agent-filter"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setOffset(0);
          }}
        >
          {[
            ["all", "All Agents"],
            ["attention", "Needs attention"],
            ["RUNNING", "Running"],
            ["WAITING_FOR_USER", "Waiting for user"],
            ["WAITING_FOR_DEPENDENCY", "Waiting for dependency"],
            ["PAUSED", "Paused"],
            ["COMPLETED", "Completed"],
            ["FAILED", "Failed"],
            ["STOPPED", "Stopped"],
          ].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="agentic-list t8-surface">
        {matches.slice(offset, offset + 20).map((agent) => {
          const mission = missions.find((row) => row.id === agent.missionId);
          const task = currentAgentTask(agent, mission, store.tasks);
          return (
            <button
              className="agentic-row"
              key={agent.id}
              onClick={() => openAgent(agent)}
              data-agent-id={agent.id}
            >
              <span className="agent-avatar">
                <Bot size={20} />
              </span>
              <span className="agent-row-copy">
                <strong>{agent.name}</strong>
                <span>{mission?.objective ?? "Mission objective unavailable"}</span>
                <small>
                  {task
                    ? `${NAMES[task.provider]} · ${selectedTaskModel(task)}`
                    : agent.activity?.step
                      ? `${["COMPLETED", "FAILED", "STOPPED"].includes(agent.state) ? "Last step" : agent.state === "CREATED" ? "Planned step" : "Retained step"}: ${agent.activity.step}`
                      : "No Task currently admitted"}
                </small>
                <small>
                  {agent.activity?.verification ??
                    (agent.lastCheckpoint
                      ? CHECKPOINT_LABEL[agent.lastCheckpoint.boundary]
                      : "No verified checkpoint yet")}
                </small>
              </span>
              <span className="agent-row-state">
                <AgentState agent={agent} />
                {attentionRequired(agent) && <small>Attention required</small>}
                <time>
                  {new Date(agent.updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </span>
              <ArrowRight size={16} />
            </button>
          );
        })}
        {!matches.length && (
          <Empty
            title={store.connectionChecked ? "No matching Agents." : "Connecting to your Host…"}
            detail={
              !store.hydratedFromHost
                ? "The Host is loading its canonical workspace snapshot."
                : store.missions?.enabled
                  ? "Create an Agent for durable work, or ask a question in regular Bunny chat."
                  : "Agent Missions are disabled on this Host. Review the existing Mission setting to enable them."
            }
          />
        )}
      </div>
      <div className="project-pagination">
        <span>{store.hydratedFromHost ? matches.length : "—"} Agents in this Host snapshot</span>
        <button
          className="btn quiet"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous
        </button>
        <button
          className="btn quiet"
          disabled={offset + 20 >= matches.length}
          onClick={() => setOffset(offset + 20)}
        >
          Next
        </button>
      </div>
      <section className="t8-section">
        <div className="section-heading">
          <h2>Recent Missions</h2>
          <span className="caption">Accepted Host records</span>
        </div>
        <div className="t8-surface">
          {missions.slice(0, 6).map((mission) => (
            <button
              className="mission-link"
              key={mission.id}
              onClick={() => {
                store.openMission(mission.id);
                useIsland.setState({
                  agentFocus: agents.find((row) => row.missionId === mission.id)?.id ?? null,
                });
              }}
            >
              <span>
                <strong>{mission.title}</strong>
                <small>
                  {mission.steps.length} accepted steps · {mission.state.replaceAll("_", " ")}
                </small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
          {!missions.length && (
            <p className="t8-empty-copy">
              {store.hydratedFromHost ? "No Mission history retained." : "Loading Mission history…"}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function AgentDetail({ agent, mission }: { agent: AgentView; mission?: MissionView }) {
  const store = useIsland();
  const [tab, setTab] = useState("Activity");
  const [review, setReview] = useState(false);
  const [artifact, setArtifact] = useState<{
    title: string;
    body: string;
    sha256: string;
    image?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = currentAgentTask(agent, mission, store.tasks);
  const tasks = store.tasks.filter((row) => row.mission?.missionId === agent.missionId);
  const project = store.projects.find((row) => row.id === mission?.projectId);
  const openArtifact = async (row: ArtifactSummary) => {
    if (!mission?.projectId || busy) return;
    setBusy(true);
    try {
      const result = (await store.projectCommand("project.artifact", {
        projectId: mission.projectId,
        artifactId: row.id,
      })) as { artifact: ArtifactSummary; body: string; encoding: string } | null;
      if (result)
        setArtifact({
          title: result.artifact.title,
          body: result.body,
          sha256: result.artifact.sha256,
          image:
            result.encoding === "base64"
              ? `data:${result.artifact.location.mediaType};base64,${result.body}`
              : undefined,
        });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="btn quiet back-button"
        onClick={() => useIsland.setState({ agentFocus: null, missionFocus: null })}
      >
        <ArrowLeft size={15} />
        All Agents
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Agent workspace</p>
          <h1 className="wrap-anywhere">{agent.name}</h1>
          <p className="wrap-anywhere">{mission?.objective ?? "Mission not retained in this snapshot."}</p>
          {agent.missionId && <p className="caption">Mission {agent.missionId.slice(0, 8)}</p>}
        </div>
        <AgentState agent={agent} />
      </div>
      <div className="agent-actionbar">
        <AgentControls agent={agent} />
        <div className="actions talk-actions">
          <button
            className="btn quiet"
            disabled
            title="This Host has no interactive Agent conversation command."
          >
            <MessageSquare size={15} />
            Talk
          </button>
          <button
            className="btn quiet"
            disabled
            title="This Host has no safe executing-Mission redirect command."
          >
            Redirect
          </button>
          <p className="control-caption">{TALK_CAPTION}</p>
        </div>
      </div>
      {attentionRequired(agent) && (
        <div className="attention-banner" role="status">
          <ShieldCheck size={19} />
          <span>
            <strong>
              {agent.authorization?.state === "WAITING_FOR_USER"
                ? "This Mission needs your permission."
                : "This Agent needs your attention."}
            </strong>
            <small>
              Execution: {AGENT_STATE_LABEL[agent.state]} · Authorization:{" "}
              {agent.authorization?.state.replaceAll("_", " ") ?? "Not granted"}
            </small>
          </span>
          {agent.authorization && (
            <button className="btn secondary" onClick={() => setReview(!review)}>
              {review ? "Close review" : "Review access"}
            </button>
          )}
        </div>
      )}
      <PendingAsks agent={agent} mission={mission} />
      <div className="agent-detail-grid">
        <div className="agent-detail-main">
          <section className="t8-surface">
            <nav className="workspace-tabs" aria-label="Agent history">
              {["Activity", "Conversation", "Results"].map((name) => (
                <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>
                  {name}
                </button>
              ))}
            </nav>
            <div className="workspace-tab-body">
              {tab === "Activity" ? (
                <>
                  <ActivityTimeline missionId={agent.missionId ?? undefined} limit={60} />
                  {tasks.map((task) => (
                    <button
                      className="mission-link"
                      key={task.id}
                      onClick={() => openTask(task.id)}
                    >
                      <span>
                        <strong>{task.title}</strong>
                        <small>
                          {NAMES[task.provider]} · {selectedTaskModel(task)} ·{" "}
                          {task.state.replaceAll("_", " ")}
                        </small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </>
              ) : tab === "Conversation" ? (
                <div className="conversation-transcript">
                  <p className="eyebrow">Mission request · retained by Host</p>
                  <p>{mission?.objective ?? "Unavailable"}</p>
                  <div className="conversation-boundary">
                    <MessageSquare size={22} />
                    <h2>Agent messaging is unavailable</h2>
                    <p>
                      This Host does not retain a free-form Agent conversation or support safe live
                      redirection. Activity and verification appear in their own tabs.
                    </p>
                    <button
                      className="btn secondary"
                      onClick={() => {
                        store.setComposeKind("task");
                        store.setSheet("chat");
                      }}
                    >
                      Open regular Bunny chat
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="result-history">
                  <h2>Results & verification</h2>
                  <p>{mission?.result?.summary ?? "No completed Mission result retained."}</p>
                  <p className="caption">
                    {agent.activity?.verification ??
                      "Independent verification has not been recorded."}
                  </p>
                  {mission?.artifacts.map((row) => (
                    <div className="artifact-row" key={row.id}>
                      <FileCheck2 size={18} />
                      <span>
                        <strong>{row.title}</strong>
                        <small>
                          {artifactStatus(row)} · {new Date(row.createdAt).toLocaleString()}
                        </small>
                        <small>
                          {project?.name ?? "Project unknown"} · {agent.name} · Mission{" "}
                          {row.missionId.slice(0, 8)} · step {row.stepId?.slice(0, 8) ?? "Mission"}
                        </small>
                      </span>
                      <button
                        className="btn secondary"
                        disabled={
                          !mission.projectId ||
                          row.verification !== "verified" ||
                          store.host !== "online" ||
                          busy
                        }
                        onClick={() => void openArtifact(row)}
                      >
                        Open verified artifact
                      </button>
                    </div>
                  ))}
                  {!mission?.artifacts.length && <p className="caption">No artifacts committed.</p>}
                </div>
              )}
            </div>
          </section>
          <section className="t8-surface permission-section">
            <div className="section-heading">
              <h2>Mission permissions</h2>
              <ShieldCheck size={18} />
            </div>
            {agent.authorization ? (
              <>
                <p className="caption">
                  {agent.authorization.state.replaceAll("_", " ")} · revision{" "}
                  {agent.authorization.revision}
                </p>
                {review || !attentionRequired(agent) ? (
                  <AuthorizationCard
                    key={`${agent.id}-${agent.authorization.revision}`}
                    id={agent.id}
                    authorization={agent.authorization}
                  />
                ) : (
                  <button className="btn secondary" onClick={() => setReview(true)}>
                    Review access
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="caption">
                  No current authorization. A Project and an objective do not grant access.
                </p>
                {["CREATED", "PLANNING"].includes(agent.state) &&
                  (isDevice(store.viewer) ? (
                    <p className="control-caption">Proposing Mission access · {WORKSTATION_CAPTION}</p>
                  ) : (
                    <button
                      className="btn secondary"
                      disabled={!store.canAct()}
                      onClick={() => void store.agentAuthorization(agent.id, "propose")}
                    >
                      Review bounded Mission access
                    </button>
                  ))}
              </>
            )}
            {agent.authorizationError && <p role="alert">{agent.authorizationError}</p>}
          </section>
        </div>
        <aside className="agent-inspector" aria-label="Mission inspector">
          <section className="t8-surface">
            <h2>Mission plan</h2>
            <p className="caption">Accepted canonical steps</p>
            <ol className="mission-plan">
              {mission?.steps.map((step, index) => (
                <li key={step.id} data-state={step.state}>
                  <span className="step-number">
                    {step.state === "completed" ? <CheckCircle2 size={16} /> : index + 1}
                  </span>
                  <div>
                    <strong>{step.role}</strong>
                    <small>{step.state.replaceAll("_", " ")}</small>
                    <small>
                      {step.dependsOn.length
                        ? `${step.dependsOn.length} dependencies`
                        : "No dependencies"}
                    </small>
                    {step.failure && <small>{step.failure.category.replaceAll("_", " ")}</small>}
                  </div>
                </li>
              ))}
            </ol>
            {!mission?.steps.length && <p className="caption">No accepted steps retained.</p>}
          </section>
          <section className="t8-surface">
            <h2>Execution</h2>
            <dl className="fact-list">
              <div>
                <dt>Current Task</dt>
                <dd>{current?.title ?? "No model Task admitted"}</dd>
              </div>
              <div>
                <dt>Application</dt>
                <dd>{agent.activity?.application ?? "Not acquired"}</dd>
              </div>
              <div>
                <dt>Provider / model</dt>
                <dd>
                  {current
                    ? `${NAMES[current.provider]} · ${selectedTaskModel(current)}`
                    : "Deterministic capability work / no current model"}
                </dd>
              </div>
              <div>
                <dt>Last checkpoint</dt>
                <dd>
                  {agent.lastCheckpoint ? (
                    <>
                      {CHECKPOINT_LABEL[agent.lastCheckpoint.boundary]}
                      <small>
                        {new Date(agent.lastCheckpoint.at).toLocaleString()} ·{" "}
                        {agent.lastCheckpoint.replaySafety.replaceAll("_", " ")}
                      </small>
                    </>
                  ) : (
                    "No checkpoint retained"
                  )}
                </dd>
              </div>
            </dl>
            {current && (
              <details>
                <summary>Routing decision</summary>
                <p>
                  {current.decision?.selection_reason ??
                    current.decision?.reason ??
                    "Reason unavailable"}
                </p>
                <p className="caption">
                  {current.decision?.routing_mode?.toUpperCase() ?? "UNKNOWN"} · effort{" "}
                  {current.effort ?? "UNKNOWN"} · reroutes {current.decision?.reroutes ?? "UNKNOWN"}
                </p>
              </details>
            )}
          </section>
          <section className="t8-surface">
            <h2>Project</h2>
            <p>{project?.name ?? "Not associated"}</p>
            {project && (
              <button
                className="btn quiet"
                onClick={() => useIsland.setState({ projectFocus: project.id, sheet: "project" })}
              >
                <Folder size={16} />
                Open Project
                <ArrowRight size={15} />
              </button>
            )}
            <p className="caption">
              Agent continuity is owned by the Host. Closing this UI does not stop approved work.
            </p>
          </section>
        </aside>
      </div>
      <Dialog.Root
        open={!!artifact}
        onOpenChange={(open) => {
          if (!open) setArtifact(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="t8-overlay" />
          <Dialog.Content className="t8-dialog artifact-dialog" data-theme={store.theme}>
            <Dialog.Title>{artifact?.title}</Dialog.Title>
            <Dialog.Description>
              Verified through the Project artifact authority. SHA-256: {artifact?.sha256}
            </Dialog.Description>
            <Dialog.Close asChild>
              <button className="icon-button dialog-close" aria-label="Close artifact">
                <X size={18} />
              </button>
            </Dialog.Close>
            {artifact?.image ? (
              <img src={artifact.image} alt={artifact.title} />
            ) : (
              <pre>{artifact?.body}</pre>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
