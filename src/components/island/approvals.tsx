import { ChevronRight, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { Empty } from "./ui";
import { answerableHere, approvalCount, pendingApprovalItems, type ApprovalItem } from "./approvals-model";
import { ReconciliationReview, useReconcileItems } from "./reconciliation";

/**
 * Approvals: every ask the Host is waiting on, in one list. Answers go only through the existing controls: a Task opens its
 * decision view, a Mission permission request takes the existing respond command, and a consent offer opens its Agent's panel.
 * A paired device sees the Host's per-request verdict and never a control it may not use.
 */
export function Approvals() {
  const store = useIsland();
  const viewer = store.viewer?.kind === "device" ? "device" : "workstation";
  const items = pendingApprovalItems({
    tasks: store.tasks,
    missions: store.missions?.missions ?? [],
    agents: store.agents?.agents ?? [],
    viewer,
  });
  const canAct = store.canAct();
  const here = answerableHere(items).length;
  // "Nothing needs you" is a claim about the Host's asks, so it is made only once both sources have arrived.
  const known = !!store.missions && !!store.agents;
  const paused = useReconcileItems().length;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Approvals</p>
          <h1>
            {items.length > 0
              ? `${approvalCount(items)} waiting for you`
              : paused > 0
                ? "Review needed"
                : known
                  ? "Nothing needs you"
                  : "Approvals are loading"}
          </h1>
          <p>
            Each ask is listed once. Closing this window does not stop a Mission. Asks wait on your Host until you answer them.
          </p>
        </div>
      </div>
      <ReconciliationReview />
      {!known && (
        <Empty title="Approvals are loading." detail="The Host has not sent its asks yet. Nothing is approved while this is loading." headingLevel={2} />
      )}
      {items.length > 0 && (
        <p className="caption" role="status">
          {here} of {items.length} can be answered from this {viewer === "device" ? "device" : "workstation"}.
        </p>
      )}
      <section className="t8-surface" aria-label="Pending asks">
        {items.map((item) => (
          <ApprovalRow key={item.id} item={item} canAct={canAct} />
        ))}
        {!items.length && known && (
          <Empty title="No approvals waiting." detail="When a Task, Mission or Agent needs your decision, it appears here." headingLevel={2} />
        )}
      </section>
      <p className="caption">
        <ShieldCheck size={13} /> Answers are recorded by your Host. Nothing is approved until the Host confirms it.
      </p>
    </>
  );
}

function ApprovalRow({ item, canAct }: { item: ApprovalItem; canAct: boolean }) {
  const store = useIsland();
  const answerable = item.answer.kind === "answerable";
  // The Host records each answer once: while a command for this ask is in flight, both controls wait for it.
  const owner = store.agents?.agents.find((agent) => agent.authorization?.pending.some((row) => row.id === item.id))?.id ?? (item.target.sheet === "missions" ? item.target.missionId : null);
  const waiting = !!owner && !!store.pending[owner];
  const reviewLabel = item.kind === "task" ? "Review task" : item.kind === "agent_consent" ? "Open Agent" : "Open Mission";
  const open = () => {
    if (item.target.sheet === "decision") {
      store.openDecision(item.target.taskId);
      return;
    }
    if (item.target.agentId) useIsland.setState({ agentFocus: item.target.agentId });
    if (item.target.missionId) store.openMission(item.target.missionId);
    store.setSheet("missions");
  };
  return (
    <div className="ap-row" data-kind={item.kind}>
      <span>
        <strong>{item.title}</strong>
        <small className="cx-muted"> {item.detail}</small>
        {!answerable && item.answer.kind === "not-answerable" && <small className="cx-muted"> {item.answer.reason}</small>}
      </span>
      <span className="ap-actions">
        {item.kind === "mission_request" && answerable && (
          <>
            <button className="btn primary" type="button" disabled={!canAct || waiting} onClick={() => void store.respondRequest(item.id, "allow_once")}>
              Allow once
            </button>
            <button className="btn secondary" type="button" disabled={!canAct || waiting} onClick={() => void store.respondRequest(item.id, "deny")}>
              Deny
            </button>
            {waiting && <small className="cx-muted" role="status">Waiting for the Host…</small>}
          </>
        )}
        <button className="btn secondary" type="button" onClick={open}>
          {reviewLabel}
          <ChevronRight size={14} />
        </button>
      </span>
    </div>
  );
}
