import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { WEAPON_LABEL } from "@/lib/bunny-host/personal-agents";
import { RECONCILE_HEADLINE, mayReconcile, reconcileItems, type ReconcileChoice, type ReconcileItem } from "./reconciliation-model";
import "./reconciliation.css";

export function useReconcileItems(): ReconcileItem[] {
  const store = useIsland();
  return reconcileItems({
    tasks: store.tasks,
    missions: store.missions?.missions ?? [],
    personalAgents: store.personalAgents,
    projects: store.projects,
  });
}

/**
 * The owner's review of work the Host paused because it cannot prove whether a write finished. Every fact shown is the
 * Host's; a choice sends the existing workstation-only `task.reconcile` / `mission.reconcile` command and nothing else.
 * A paired device sees the review and a pointer to the workstation, never the controls.
 */
export function ReconciliationReview() {
  const store = useIsland();
  const items = useReconcileItems();
  if (!items.length) return null;
  const owner = mayReconcile(store.viewer);
  return (
    <section className="t8-section rc-review" aria-labelledby="rc-heading">
      <div className="section-heading">
        <h2 id="rc-heading">
          <AlertTriangle size={18} aria-hidden="true" /> {RECONCILE_HEADLINE}
        </h2>
        <span className="caption">{items.length === 1 ? "1 item paused" : `${items.length} items paused`}</span>
      </div>
      <p className="caption">
        Bunny could not confirm whether this work finished, so it stopped and is not repeating anything on its own. A lost
        connection does not mean the work failed. Check the target, then decide.
      </p>
      {!owner && (
        <p className="rc-device" role="note">
          <ShieldCheck size={16} aria-hidden="true" /> Only the workstation owner can decide. Open Bunny-A on your Windows PC to review.
        </p>
      )}
      <div className="rc-list">
        {items.map((item) => (
          <ReconcileCard key={item.key} item={item} owner={owner} />
        ))}
      </div>
    </section>
  );
}

function ReconcileCard({ item, owner }: { item: ReconcileItem; owner: boolean }) {
  const store = useIsland();
  const [pending, setPending] = useState<ReconcileChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const live = store.canAct();
  // Keyboard: the chosen button is replaced by the confirmation, so focus moves to Confirm, and Back returns it to the choice.
  const confirmRef = useRef<HTMLButtonElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
    else if (returnTo.current) {
      choicesRef.current?.querySelector<HTMLButtonElement>(`[data-resolution="${returnTo.current}"]`)?.focus();
      returnTo.current = null;
    }
  }, [pending]);
  const decide = async (choice: ReconcileChoice) => {
    setBusy(true);
    setRefusal(null);
    try {
      const ok = await store.reconcile(item.command.action, { ...item.command.data, resolution: choice.resolution }, setRefusal);
      if (ok) {
        returnTo.current = null;
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="t8-surface rc-card" aria-labelledby={`rc-${item.key}`} aria-busy={busy}>
      <header>
        <span className="state-label" data-state="WAITING_FOR_USER">
          Paused
        </span>
        <h3 id={`rc-${item.key}`}>{item.title}</h3>
      </header>
      <dl className="fact-list rc-facts">
        <div>
          <dt>Personal Agent</dt>
          <dd>{item.owner ? `${item.owner.name} (${WEAPON_LABEL[item.owner.weapon as keyof typeof WEAPON_LABEL] ?? item.owner.weapon})` : "Not owned by a Personal Agent"}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{item.project ?? "No project"}</dd>
        </div>
        {item.mission && (
          <div>
            <dt>Mission</dt>
            <dd>{item.mission.title}</dd>
          </div>
        )}
        <div>
          <dt>Task</dt>
          <dd className="wrap-anywhere">{item.task ? `${item.task.title} · ${item.task.id}` : "No task record"}</dd>
        </div>
        <div>
          <dt>Last verified checkpoint</dt>
          <dd>{item.checkpoint}</dd>
        </div>
        <div>
          <dt>Last attempt</dt>
          <dd>{item.lastAttempt}</dd>
        </div>
        <div className="rc-wide">
          <dt>Why it is uncertain</dt>
          <dd>{item.reason}</dd>
        </div>
        <div>
          <dt>Paused since</dt>
          <dd>{new Date(item.since).toLocaleString()}</dd>
        </div>
      </dl>
      <div className="rc-columns">
        <div>
          <h4>What it may have changed</h4>
          <ul>
            {item.sideEffects.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Evidence from the Host</h4>
          {item.evidence.length ? (
            <ul>
              {item.evidence.map((line) => (
                <li key={line} className="wrap-anywhere">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="caption">The Host recorded no further evidence.</p>
          )}
        </div>
      </div>
      {owner ? (
        pending ? (
          <div className="rc-confirm" role="group" aria-label="Confirm your decision">
            <p>
              <strong>{pending.label}?</strong> {pending.consequence}
            </p>
            <div className="actions">
              <button ref={confirmRef} className={pending.resolution === "retry" ? "btn primary" : "btn danger"} type="button" disabled={busy || !live} onClick={() => void decide(pending)}>
                {busy ? "Sending…" : `Confirm: ${pending.label}`}
              </button>
              <button className="btn secondary" type="button" disabled={busy} onClick={() => setPending(null)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="rc-choices actions" ref={choicesRef}>
            {item.choices.map((choice) => (
              <button key={choice.resolution} data-resolution={choice.resolution} className="btn secondary" type="button" disabled={!live} onClick={() => { returnTo.current = choice.resolution; setPending(choice); }} title={choice.consequence}>
                {choice.label}
              </button>
            ))}
            {!live && <span className="caption">Reconnect to the Host to decide. Nothing is sent while it is not live.</span>}
          </div>
        )
      ) : null}
      {refusal && (
        <p className="st-error" role="alert">
          {refusal}
        </p>
      )}
    </article>
  );
}
