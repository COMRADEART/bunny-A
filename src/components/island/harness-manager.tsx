import { useState } from "react";
import { useIsland } from "@/store/use-island";
import type { HarnessVerdict, HarnessView } from "@/lib/bunny-host/harnesses";
import type { Tone } from "./intelligence-model";

const EXECUTION: Record<HarnessView["execution"], [string, Tone]> = {
  routable: ["Can run Tasks", "ok"],
  disabled: ["Disabled by you", "off"],
  detect_only: ["Detected only", "warn"],
  unsupported: ["Not supported", "off"],
};
const VERDICT: Record<HarnessVerdict, string> = {
  not_found: "Not found",
  found_not_running: "Found, but it did not run",
  runs_not_signed_in: "Runs, not signed in",
  runs: "Runs; inference not yet shown",
  task_completed: "Runs; completed real Tasks",
};

/**
 * M-A-3 T13.3 Gate E: Settings → AI & Models → Harness Manager. Detection, a stepped test and enable/disable/remove;
 * installation is guided only (the owner runs the pinned command). Routing authority stays with the Host's dispatch gate.
 */
export function HarnessManager() {
  const store = useIsland();
  const [status, setStatus] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!store.harnesses)
    return <p className="caption">{store.viewer?.kind === "device" ? "Harnesses are managed on the workstation (Windows Host)." : "The Harness Manager needs the updated Bunny Host."}</p>;
  const act = async (id: string, action: string, done: string) => {
    setBusy(id);
    setStatus((rows) => ({ ...rows, [id]: "" }));
    const result = await store.harnessCommand(action, { id }, (caption) => setStatus((rows) => ({ ...rows, [id]: caption })));
    setBusy(null);
    if (result) setStatus((rows) => ({ ...rows, [id]: done }));
  };
  return (
    <>
      <p className="caption">
        A harness is the program a model runs through. It is not a model and not a subscription, and being installed or signed in does not let Bunny send it
        Tasks: every Task still needs your account consent. Bunny never installs anything; it shows the pinned official command for you to run.
      </p>
      {store.harnesses.map((harness) => {
        const [label, tone] = EXECUTION[harness.execution];
        const disabled = busy !== null || !store.canAct();
        const dispatchable = harness.routes.some((route) => route.dispatch && route.support === "implemented");
        return (
          <section className="ai-card" key={harness.id} aria-labelledby={`harness-${harness.id}`}>
            <header>
              <div style={{ minWidth: 0 }}>
                <strong id={`harness-${harness.id}`}>{harness.name}</strong>
                <p style={{ overflowWrap: "anywhere" }}>
                  {harness.found
                    ? `${harness.version ?? "Version unknown"} · ${harness.path}`
                    : harness.lastTest
                      ? `Not found (${harness.executables.join(" or ")})`
                      : `Not detected yet. Test looks for ${harness.executables.join(" or ")}.`}
                </p>
              </div>
              <span className="ai-pill" data-tone={tone}>
                {label}
              </span>
            </header>
            <ul className="ai-capabilities" aria-label={`${harness.name} routes`}>
              {harness.routes.map((route) => (
                <li key={route.connectionId}>
                  {route.label}: {route.dispatch && route.support === "implemented" ? "can run Tasks" : route.support === "detect_only" ? "detected only" : "not supported"} · sign-in {route.session.replace(/_/g, " ")} ·{" "}
                  {route.billing.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
            {harness.models.length > 0 && <p className="caption">Models it reports: {harness.models.join(", ")}.</p>}
            <p className="caption">
              {harness.lastTest ? `${VERDICT[harness.lastTest.verdict]}. ${harness.lastTest.detail}` : "Not tested yet."} {harness.completedTasks > 0 ? `${harness.completedTasks} Tasks completed through it.` : ""}
            </p>
            {harness.warnings.length > 0 && (
              <ul className="ai-capabilities" aria-label={`${harness.name} warnings`}>
                {harness.warnings.map((warning) => (
                  <li key={warning} className="st-error">
                    {warning}
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary>{harness.found ? "Update or uninstall" : "How to install"}</summary>
              {harness.install.install ? (
                <>
                  <p className="caption">Install {harness.install.version} (run it yourself in a terminal):</p>
                  <code style={{ display: "block", overflowWrap: "anywhere" }}>{harness.install.install}</code>
                  <p className="caption" style={{ overflowWrap: "anywhere" }}>
                    Integrity: {harness.install.integrity}
                  </p>
                  {harness.install.uninstall && (
                    <>
                      <p className="caption">Uninstall:</p>
                      <code style={{ display: "block", overflowWrap: "anywhere" }}>{harness.install.uninstall}</code>
                    </>
                  )}
                </>
              ) : null}
              <p className="caption">
                {harness.install.note}{" "}
                <a href={harness.install.source} target="_blank" rel="noreferrer">
                  Official source
                </a>
              </p>
            </details>
            <div className="ap-actions" style={{ flexWrap: "wrap" }}>
              <button type="button" className="btn secondary" disabled={disabled} onClick={() => void act(harness.id, "harness.test", "Tested.")} aria-label={`Test ${harness.name}`}>
                {busy === harness.id ? "Testing…" : "Test"}
              </button>
              {dispatchable &&
                (harness.execution === "disabled" ? (
                  <button type="button" className="btn" disabled={disabled} onClick={() => void act(harness.id, "harness.enable", "Enabled.")} aria-label={`Enable ${harness.name}`}>
                    Enable
                  </button>
                ) : (
                  <button type="button" className="btn" disabled={disabled} onClick={() => void act(harness.id, "harness.disable", "Disabled. Tasks are refused until you enable it.")} aria-label={`Disable ${harness.name}`}>
                    Disable
                  </button>
                ))}
              {confirm === harness.id ? (
                <>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={disabled}
                    onClick={() => {
                      setConfirm(null);
                      void act(harness.id, "harness.remove", "Removed from routing. Uninstall it yourself if you no longer want it.");
                    }}
                  >
                    Confirm remove
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="btn" disabled={disabled} onClick={() => setConfirm(harness.id)} aria-label={`Remove ${harness.name}`}>
                  Remove
                </button>
              )}
            </div>
            <p className="caption" role="status" aria-live="polite">
              {status[harness.id]}
            </p>
          </section>
        );
      })}
    </>
  );
}
