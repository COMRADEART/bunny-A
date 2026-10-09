import { useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Link2,
  Monitor,
  Plus,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { activeTasks, liveProviders, useIsland } from "@/store/use-island";
import { elapsed, percent, RUNNING } from "./ui-model";
import { NAMES, ProviderMark, ProviderStatus, TaskActivity, TaskBadge } from "./ui";
import { openTask } from "./task";
import { thermalReadingFor } from "./ui-model";
import { MissionsSection } from "./mission";
import { ActivityTimeline } from "./activity";

export function Phone({ now }: { now: number }) {
  const store = useIsland();
  const sample = store.samples.at(-1);
  const active = activeTasks(store.tasks);
  const heat = thermalReadingFor(store.samples, store.host, store.cpuWarn, store.gpuWarn, now);
  const working = active.some((t) => RUNNING.includes(t.state));
  const presence = !store.connectionChecked
    ? "Connecting"
    : store.pairingRequired
      ? "Not paired"
      : store.host === "online"
        ? working
          ? "Busy"
          : "Idle"
        : store.host === "sleeping"
          ? "Sleeping"
          : "Connection unavailable";
  return (
    <div className="phone-home">
      <section className="workstation-card glass">
        <div>
          <span className="workstation-icon">
            <Monitor size={24} />
          </span>
          <div>
            <p className="eyebrow">Your connection</p>
            <h1>My workstation</h1>
          </div>
        </div>
        <span className="phone-presence" data-state={store.host}>
          <span className="presence-dot" />
          {store.host === "online" ? `Online · ${presence}` : presence}
        </span>
        <p className="caption remote-status">{store.remoteConfigured ? "Remote configured · availability not verified" : "Remote unavailable"}</p>
        {store.host !== "online" && !store.pairingRequired ? (
          <p>
            {store.host === "sleeping"
              ? "Bunny can run your task when the workstation wakes."
              : "The connection is unavailable. Host operational health could not be checked."}
          </p>
        ) : null}
      </section>
      {store.pairingRequired ? (
        <Pairing compact />
      ) : (
        <>
          <MissionsSection now={now} />
          <ActivityTimeline limit={6} />
          <section>
            <div className="section-heading">
              <h2 className="eyebrow">Active</h2>
              <span className="caption">
                {active.length
                  ? `${active.length} ${active.length === 1 ? "task" : "tasks"}`
                  : "All quiet"}
              </span>
            </div>
            {active.length ? (
              active.map((task) => (
                <article className="phone-task glass" key={task.id} data-state={task.state}>
                  <button
                    className="phone-task-heading"
                    onClick={() =>
                      task.state === "waiting_for_approval"
                        ? store.openDecision(task.id)
                        : openTask(task.id)
                    }
                  >
                    <ProviderMark
                      provider={liveProviders(store).find((p) => p.id === task.provider)!}
                    />
                    <div>
                      <small>{NAMES[task.provider]}</small>
                      <h3>{task.title}</h3>
                    </div>
                    <time>{elapsed(task, now)}</time>
                    <ChevronRight size={16} />
                  </button>
                  {task.state === "waiting_for_approval" ? (
                    <div className="phone-review">
                      <TaskBadge state={task.state} />
                      <button className="btn primary" onClick={() => store.openDecision(task.id)}>
                        Review route <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <TaskActivity task={task} />
                  )}
                  {task.state !== "waiting_for_approval" ? <button className="btn danger" disabled={!store.canAct()} onClick={()=>void store.stop(task.id)} aria-label={`Stop task ${task.title}`}>Stop task</button> : null}
                </article>
              ))
            ) : (
              <div className="phone-quiet glass">
                <Check size={16} />
                <p>No active tasks. Ready for your next idea.</p>
              </div>
            )}
          </section>
          <form
            className="phone-prompt glass"
            onSubmit={(e) => {
              e.preventDefault();
              store.setSheet("compose");
            }}
          >
            <label htmlFor="phone-prompt">Ask Bunny…</label>
            <div>
              <input
                id="phone-prompt"
                placeholder="What would you like to do?"
                value={store.prompt}
                maxLength={16000}
                onChange={(e) => store.setPrompt(e.target.value)}
              />
              <button className="icon-button" type="submit" aria-label="Compose remote task">
                <ArrowRight size={20} />
              </button>
            </div>
          </form>
          {store.drafts.length ? (
            <section>
              <h2 className="eyebrow">Saved on this device</h2>
              {store.drafts.map((d) => (
                <div className="phone-draft glass" key={d.id}>
                  <p>{d.prompt}</p>
                  <button className="quiet-button" onClick={() => store.reviewDraft(d.id)}>
                    Review <ArrowRight size={14} />
                  </button>
                  <button className="quiet-button" onClick={() => store.removeDraft(d.id)}>
                    Discard
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          <section>
            <div className="section-heading">
              <h2 className="eyebrow">System</h2>
              <button className="quiet-button" onClick={() => store.setSheet("system")}>
                View <ChevronRight size={13} />
              </button>
            </div>
            <div className="phone-metrics glass" data-thermal={heat ? "warning" : "normal"}>
              <div>
                <span>CPU</span>
                <strong>{percent(sample?.cpu.utilization)}</strong>
              </div>
              <div>
                <span>GPU</span>
                <strong>
                  {percent(sample?.gpus.find((g) => g.utilization != null)?.utilization)}
                </strong>
              </div>
              <div>
                <span>RAM</span>
                <strong>
                  {percent(
                    sample && sample.memory.totalBytes > 0
                      ? (sample.memory.usedBytes / sample.memory.totalBytes) * 100
                      : null,
                  )}
                </strong>
              </div>
            </div>
            {sample && store.host !== "online" ? (
              <p className="caption">Saved reading · {new Date(sample.at).toLocaleTimeString()}</p>
            ) : null}
          </section>
          <section>
            <div className="section-heading">
              <h2 className="eyebrow">Providers</h2>
              <span className="caption">On your workstation</span>
            </div>
            <div className="phone-providers glass">
              {liveProviders(store)
                .filter((p) => !p.extension)
                .map((p) => (
                  <button key={p.id} onClick={() => store.setProviderFocus(p.id)}>
                    <ProviderMark provider={p} />
                    <strong>{NAMES[p.id]}</strong>
                    <ProviderStatus provider={p} />
                  </button>
                ))}
            </div>
          </section>
        </>
      )}
      <button className="phone-link" onClick={() => store.setSheet("extensions")}>
        <Bell size={17} />
        Notifications
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
export function Pairing({ compact = false }: { compact?: boolean }) {
  const store = useIsland();
  const [code, setCode] = useState("");
  const [name, setName] = useState("Phone companion");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const secure = typeof window !== "undefined" && window.location.protocol === "https:";
  // M-A-3 T9: any non-workstation origin (the secure companion address) is a device; it pairs, never issues codes.
  const remoteOrigin =
    secure && typeof window !== "undefined" && !["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);
  const companion =
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("companion") === "1") ||
    remoteOrigin ||
    store.viewer?.kind === "device" ||
    store.connection.state === "pairing";
  return (
    <section className={`pairing glass ${compact ? "compact" : ""}`}>
      <div className="pairing-title">
        <Smartphone size={26} />
        <p className="eyebrow">Remote access</p>
        <h2>{companion ? "Bring Bunny with you." : "Your workstation, wherever you are."}</h2>
        <p>
          {companion
            ? "Enter the one-time code from Bunny Island."
            : "Pair a phone with your workstation’s secure companion."}
        </p>
        <span className="caption">
          <ShieldCheck size={14} />
          Private access · one-time pairing
        </span>
      </div>
      {!companion ? (
        <>
          <div className="pairing-workstation">
            <p className="caption">
              {store.remoteConfigured
                ? "The Host manages your authorized devices and HTTPS connection."
                : "Remote access is not configured on this workstation."}
            </p>
            {store.remoteUrl ? (
              <a
                className="btn secondary"
                href={`${store.remoteUrl}/?companion=1`}
                target="_blank"
                rel="noreferrer"
              >
                Open secure phone companion <ArrowRight size={15} />
              </a>
            ) : (
              <p className="caption">Secure address unavailable.</p>
            )}
            <button
              className="btn primary"
              disabled={!store.canAct() || !store.remoteConfigured}
              onClick={store.createPairCode}
            >
              <Plus size={15} />
              Create workstation pairing code
            </button>
            {store.pairCode ? (
              <div className="pairing-code-display">
                <code>{store.pairCode}</code>
                <small>Single use · expires in 10 minutes</small>
              </div>
            ) : null}
          </div>
        </>
      ) : store.host === "online" && store.viewer?.kind === "device" ? (
        <p className="pair-status">
          <Check size={16} />
          This device is securely paired.
        </p>
      ) : (
        <form
          className="pairing-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              // The store pins the Host this device paired with; the credential stays an HttpOnly cookie.
              const paired = await store.pairDevice(code, name);
              if (paired) {
                setCode("");
                setStatus("Paired securely. Reconnecting…");
              } else setStatus("Pairing failed. Check the one-time code on your workstation.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Device name
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <label className="field">
            Workstation code
            <input
              placeholder="Enter your one-time code"
              value={code}
              maxLength={100}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <button className="btn primary" disabled={!code.trim() || !secure || busy}>
            <Link2 size={16} />
            {busy ? "Pairing…" : "Pair this device"}
          </button>
          {!secure ? (
            <p className="caption">Use your workstation’s secure HTTPS address for pairing.</p>
          ) : null}
          <p className="pair-status" role="status">
            {status}
          </p>
        </form>
      )}
    </section>
  );
}
