import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, MousePointerClick, RotateCcw, ShieldCheck, Square, X } from "lucide-react";
import { useIsland } from "@/store/use-island";
import type { MissionView } from "@/lib/bunny-missions/types";
import { NAMES } from "./ui";
import { openTask } from "./task";
import { allowVerdict, missionApproveVerdict } from "./remote-view-model";
import {
  agentDetail,
  agentRows,
  batchButtonLabel,
  batchOfferLines,
  batchStatusLabel,
  duration,
  focusMission,
  MISSION_LABEL,
  progressFraction,
  progressLabel,
  scopeSummary,
  permissionLabel,
} from "./mission-model";
import type { ProviderId } from "@/lib/orch/types";
import { ActivityTimeline } from "./activity";
import { artifactStatus } from "@/lib/bunny-host/presentation";

/** Inbox text with mission titles instead of raw ids. */
function readable(detail: string, missions: MissionView[]) {
  return detail
    .replace(/Mission ([0-9a-f-]{36})/g, (_, id: string) => `"${missions.find((m) => m.id === id)?.title ?? "Mission"}"`)
    .replace(/ request [0-9a-f-]{36}:/g, ":")
    .replace(/ \(step [0-9a-f-]{36}\)/g, "")
    .replace(/("[^"]+") \1/g, "$1");
}
const providerName = (id: string | null) => (id && id in NAMES ? NAMES[id as ProviderId] : id);

/** Compact Bunny Bar strip: mission title and one glyph per agent role. */
export function MissionStrip({ mission, onOpen }: { mission: MissionView; onOpen: () => void }) {
  const tasks = useIsland((s) => s.tasks);
  const { rows, more } = agentRows(mission, tasks, 3);
  return (
    <button
      className="mission-strip"
      data-state={mission.state}
      onClick={onOpen}
      aria-label={`Mission ${mission.title}: ${MISSION_LABEL[mission.state]}, ${progressLabel(mission.progress)}`}
    >
      <span className="mission-strip-title">
        <strong>{mission.title}</strong>
        <small>
          {MISSION_LABEL[mission.state]} · {progressLabel(mission.progress)}
        </small>
      </span>
      <span className="mission-agents" aria-hidden="true">
        {rows.map((row) => (
          <span key={row.stepId} className="mission-agent-chip" data-state={row.state}>
            <span>{row.role}</span>
            <b>{row.glyph}</b>
          </span>
        ))}
        {more ? <span className="count-pill">+{more}</span> : null}
      </span>
    </button>
  );
}

/** Short completion state shown before the Bar collapses back. */
export function MissionCompletion({ mission, onOpen }: { mission: MissionView; onOpen: () => void }) {
  return (
    <button className="mission-strip mission-finished" data-state={mission.state} onClick={onOpen}>
      <span className="mission-strip-title">
        <strong>{mission.title}</strong>
        <small>
          {mission.state === "completed"
            ? (mission.result?.summary ?? "Completed")
            : mission.state === "failed"
              ? `Failed: ${mission.failure?.detail ?? "see details"}`
              : "Stopped"}
        </small>
      </span>
      {mission.state === "completed" ? <Check size={16} /> : <X size={16} />}
    </button>
  );
}

function ProgressMeter({ mission }: { mission: MissionView }) {
  const fraction = progressFraction(mission.progress);
  return (
    <div className="mission-progress">
      <span>{progressLabel(mission.progress)}</span>
      {fraction != null ? (
        <span className="mission-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Mission steps completed">
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

function ApprovalCard({ mission }: { mission: MissionView }) {
  const store = useIsland();
  const delegatedAgent = store.agents?.agents.find(agent => agent.missionId === mission.id && agent.authorization);
  if (delegatedAgent) return <div className="mission-approval"><p className="caption">Review and authorize the exact bounded access for {delegatedAgent.name} in Persistent agents below.</p></div>;
  return (
    <div className="mission-approval">
      <p className="eyebrow">
        <ShieldCheck size={13} /> Approve this mission
      </p>
      <ol className="mission-plan">
        {mission.steps.map((step) => (
          <li key={step.id}>
            <strong>{step.role}</strong>
            <span>{step.executor.kind === "model" ? `AI agent · ${step.scope.access === "read" ? "read only" : "write & shell capable"}` : step.executor.kind === "skill" ? `Skill · ${step.executor.skillId}` : step.executor.action}</span>
          </li>
        ))}
      </ol>
      <ul className="mission-scope">
        {scopeSummary(mission).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {mission.planning.rationale.length ? <p className="caption">{mission.planning.rationale.join(" ")}</p> : null}
      <div className="actions">
        {missionApproveVerdict(mission, store.viewer).allowed ? (
          <button className="btn primary" disabled={!store.canAct()} onClick={() => void store.approveMission(mission.id)}>
            Approve & start
          </button>
        ) : (
          <p className="control-caption host-required">{missionApproveVerdict(mission, store.viewer).caption}</p>
        )}
        <button className="btn quiet" disabled={!store.canAct()} onClick={() => void store.stopMission(mission.id)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Requests({ mission }: { mission: MissionView }) {
  const store = useIsland();
  const open = mission.requests.filter((request) => !request.resolvedAt);
  if (!open.length) return null;
  return (
    <div className="mission-requests">
      {open.map((request) => {
        const offer = request.batchOffer;
        return (
          <div className="mission-request" key={request.id}>
            <p>
              <strong>{mission.steps.find((step) => step.id === request.stepId)?.role ?? "Step"}</strong> wants{" "}
              <code>{request.action}</code> ({request.risk.toLowerCase().replaceAll("_", " ")})
            </p>
            <p className="caption">{request.reason}</p>
            {mission.steps.find((step) => step.id === request.stepId)?.executor.kind === "skill" ? <p className="caption">Allows matching actions throughout this skill run inside the approved folders. Other actions still require their own approval.</p> : null}
            {offer ? (
              <div className="mission-batch-offer">
                <ul className="mission-scope" data-testid="batch-offer">
                  {batchOfferLines(offer).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="actions">
              {allowVerdict(request, store.viewer).allowed ? (
                <>
                  {request.remote?.batchOnly ? null : (
                    <button className="btn primary" disabled={!store.canAct()} onClick={() => void store.respondMission(request.id, "allow_once")}>
                      {permissionLabel(mission, request.stepId)}
                    </button>
                  )}
                  {offer ? (
                    <button className="btn secondary" data-testid="allow-batch" disabled={!store.canAct()} onClick={() => void store.respondMission(request.id, "allow_batch")}>
                      {batchButtonLabel(offer)}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="control-caption host-required">{allowVerdict(request, store.viewer).caption}</p>
              )}
              <button className="btn quiet" disabled={!store.canAct()} onClick={() => void store.respondMission(request.id, "deny")}>
                Deny
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentDetailCard({ mission, stepId, now, onBack }: { mission: MissionView; stepId: string; now: number; onBack: () => void }) {
  const tasks = useIsland((s) => s.tasks);
  const detail = agentDetail(mission, stepId, tasks);
  if (!detail) return null;
  return (
    <div className="mission-agent-detail">
      <button className="quiet-button" onClick={onBack}>
        <ChevronLeft size={14} /> All agents
      </button>
      <div className="section-heading">
        <strong>{detail.role}</strong>
        <time>{duration(detail.startedAt, detail.finishedAt, now)}</time>
      </div>
      <p>{detail.objective}</p>
      <dl className="mission-facts">
        <dt>Executor</dt>
        <dd>{detail.capability ?? (detail.provider ? `${providerName(detail.provider)}${detail.model ? ` · ${detail.model}` : ""}` : "Routing…")}</dd>
        <dt>Activity</dt>
        <dd>{detail.activity}</dd>
        <dt>Progress</dt>
        <dd>
          {detail.progress ? `${detail.progress.completed} / ${detail.progress.total} (provider plan)` : detail.state === "running" ? "Indeterminate — no published plan" : "—"}
        </dd>
        {detail.dependencies.length ? (
          <>
            <dt>Depends on</dt>
            <dd>{detail.dependencies.join(", ")}</dd>
          </>
        ) : null}
        <dt>Artifacts</dt>
        <dd>{detail.artifacts}</dd>
        <dt>Attempts</dt>
        <dd>{detail.attempts}</dd>
      </dl>
      {detail.verification.length ? (
        <ul className="mission-checks">
          {detail.verification.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {detail.failure ? <p className="mission-failure">{detail.failure}</p> : null}
      {detail.taskId ? (
        <button className="btn secondary" onClick={() => openTask(detail.taskId!)}>
          Open child task <ExternalLink size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** Expanded Mission Control: approval, permission requests, agents, agent detail and controls. */
export function MissionPanel({ mission, now }: { mission: MissionView; now: number }) {
  const store = useIsland();
  const [agent, setAgent] = useState<string | null>(null);
  const { rows } = agentRows(mission, store.tasks, 50);
  if (agent && mission.steps.some((step) => step.id === agent))
    return <AgentDetailCard mission={mission} stepId={agent} now={now} onBack={() => setAgent(null)} />;
  const live = ["ready", "running", "waiting_for_user", "verifying", "waiting_for_approval", "planning"].includes(mission.state);
  return (
    <div className="mission-panel" data-state={mission.state}>
      <div className="section-heading">
        <span className="provider-heading">Bunny mission</span>
        <span className="mission-badge" data-state={mission.state}>
          {MISSION_LABEL[mission.state]}
        </span>
      </div>
      <h2>{mission.title}</h2>
      <ProgressMeter mission={mission} />
      {mission.state === "waiting_for_approval" ? <ApprovalCard mission={mission} /> : null}
      <Requests mission={mission} />
      {mission.batch ? (
        <div className="mission-batch" data-state={mission.batch.status} data-testid="batch-block">
          <p className="eyebrow">
            <MousePointerClick size={13} /> Small approval batch
          </p>
          <p className="caption">{batchStatusLabel(mission.batch, now)}</p>
          {mission.batch.status === "active" ? (
            <button className="btn quiet" onClick={() => void store.revokeBatch(mission.id, mission.batch!.id)}>
              Revoke batch
            </button>
          ) : null}
        </div>
      ) : null}
      {mission.recovery ? <p className="mission-failure">{mission.recovery.detail}</p> : null}
      {mission.state !== "waiting_for_approval" ? (
        <ul className="mission-agent-list">
          {rows.map((row) => (
            <li key={row.stepId}>
              <button data-state={row.state} onClick={() => setAgent(row.stepId)}>
                <b aria-hidden="true">{row.glyph}</b>
                <span>
                  <strong>{row.role}</strong>
                  <small>{row.activity}</small>
                </span>
                <em>{row.deterministic ? "deterministic" : (providerName(row.provider) ?? "")}</em>
                <ChevronRight size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {mission.result ? <p className="result-summary">{mission.result.summary}</p> : null}
      <div className="verification-card" data-passed={mission.state === "completed" && mission.result?.unverifiedSteps === 0 ? "true" : "unknown"}>
        <ShieldCheck size={16} aria-hidden="true" /><span>{mission.state === "verifying" ? "Bunny verifying mission" : mission.result ? `${mission.result.verifiedSteps} steps verified · ${mission.result.unverifiedSteps} not independently verified` : "Independent verification is separate from provider and capability completion."}</span>
      </div>
      {mission.artifacts.length ? <section><h3 className="eyebrow">Artifacts</h3><ul className="mission-artifacts">{mission.artifacts.map(artifact=><li key={artifact.id}><strong>{artifact.title}</strong><span>{artifact.type.replaceAll("_"," ")} · {mission.steps.find(step=>step.id===artifact.stepId)?.role ?? "Bunny"}</span><b data-verified={artifact.verification}>{artifactStatus(artifact)}</b></li>)}</ul></section> : null}
      <ActivityTimeline missionId={mission.id} />
      {mission.failure && mission.state !== "stopped" ? <p className="mission-failure">{mission.failure.detail}</p> : null}
      <div className="actions">
        {(mission.state === "failed" || mission.state === "waiting_for_user") &&
        mission.steps.some((step) => step.state === "failed" || step.state === "blocked") ? (
          <button className="btn secondary" onClick={() => void store.retryMission(mission.id)}>
            <RotateCcw size={14} /> Retry failed steps
          </button>
        ) : null}
        {live && mission.state !== "waiting_for_approval" ? (
          <button className="btn danger" onClick={() => void store.stopMission(mission.id)}>
            <Square size={13} /> Stop mission
          </button>
        ) : null}
      </div>
      <p className="caption">
        {mission.accounting.externalModelCalls} cloud · {mission.accounting.localModelCalls} local model calls
        {mission.accounting.tokensReported ? ` · ${mission.accounting.inputTokens + mission.accounting.outputTokens} tokens reported` : ""}
      </p>
    </div>
  );
}

/** Dashboard / phone list of missions with the Inbox items that need attention. */
export function MissionsSection({ now }: { now: number }) {
  const store = useIsland();
  const snapshot = store.missions;
  const [open, setOpen] = useState<string | null>(null);
  if (!snapshot) return null;
  if (!snapshot.enabled) return null;
  const focused = snapshot.missions.find((mission) => mission.id === (open ?? store.missionFocus)) ?? focusMission(snapshot);
  const attention = snapshot.inbox.filter((item) => !item.acknowledgedAt && (item.kind === "requires_approval" || item.kind === "requires_attention" || item.kind === "failure"));
  return (
    <section className="today-section missions-section">
      <div className="section-heading">
        <h2 className="eyebrow">Missions</h2>
        <span className="caption">{snapshot.missions.length ? `${snapshot.missions.length} recent` : "None yet"}</span>
      </div>
      {attention.length ? (
        <ul className="mission-inbox glass">
          {attention.slice(0, 4).map((item) => (
            <li key={item.id} data-kind={item.kind}>
              <span>
                <strong>{item.title}</strong>
                <small>{readable(item.detail, snapshot.missions).slice(0, 160)}</small>
              </span>
              <button className="quiet-button" aria-label="Dismiss" onClick={() => store.ackInbox(item.id)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {focused ? (
        <div className="glass mission-card">
          <MissionPanel mission={focused} now={now} />
        </div>
      ) : (
        <p className="caption">Switch the composer to Mission for multi-step work. Each mission asks for one scoped approval.</p>
      )}
      {snapshot.missions.length > 1 ? (
        <div className="mission-history">
          {snapshot.missions.slice(0, 6).map((mission) => (
            <button key={mission.id} data-active={mission.id === focused?.id} onClick={() => setOpen(mission.id)}>
              <span>{mission.title}</span>
              <small>
                {MISSION_LABEL[mission.state]} · {progressLabel(mission.progress)}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Workstation controls for the mission feature flag. */
export function MissionSettings() {
  const store = useIsland();
  const snapshot = store.missions;
  if (!snapshot) return <p className="caption">This Host does not report mission support yet.</p>;
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>Missions</strong>
          <p>Multi-step plans with one scoped approval. Direct tasks are unaffected either way.</p>
        </div>
        <button className="switch" role="switch" aria-checked={snapshot.enabled} aria-label="Enable missions" onClick={() => store.configureMissions({ enabled: !snapshot.enabled })}>
          <span />
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>Automation triggers</strong>
          <p>Off by default. Triggers can only notify or draft a mission that still needs approval.</p>
        </div>
        <button className="switch" role="switch" aria-checked={snapshot.config.triggersEnabled} aria-label="Enable triggers" disabled={!snapshot.enabled} onClick={() => store.configureMissions({ triggersEnabled: !snapshot.config.triggersEnabled })}>
          <span />
        </button>
      </div>
      <p className="caption">
        Limits: {snapshot.config.limits.maxConcurrentAgents} agents at once · {snapshot.config.limits.maxSteps} steps · {snapshot.config.limits.maxRetriesPerStep} retries per step ·{" "}
        {Math.round(snapshot.config.limits.maxMissionRuntimeMs / 60_000)} min per mission.
      </p>
      <ul className="capability-list">
        {snapshot.capabilities.map((capability) => (
          <li key={capability.id} data-availability={capability.availability}>
            <strong>{capability.id}</strong>
            <span>{capability.availability}</span>
            <small>{capability.detail}</small>
          </li>
        ))}
      </ul>
    </>
  );
}
