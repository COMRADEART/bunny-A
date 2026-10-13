import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, KeyRound, Link2, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import {
  CONNECTION_CATALOG,
  VENDOR_LABEL,
  type CatalogEntry,
  type ConnectionView,
  type RoutingPrivacyPolicy,
} from "@/lib/bunny-host/connections";
import { ACCOUNT_STATUS, BILLING_LABEL, accountFacts } from "./account-model";

export function ConnectedAccounts() {
  const store = useIsland();
  if (store.viewer?.kind === "device")
    return (
      <section className="ai-card">
        <h3>AI accounts</h3>
        <p>Account sign-in and permissions are managed on your Windows PC.</p>
        {store.deviceConnections.map((row) => (
          <p key={`${row.catalog}:${row.mode}`}>
            <strong>{row.name}</strong> · {ACCOUNT_STATUS[row.status]} ·{" "}
            {BILLING_LABEL[row.billing]}
          </p>
        ))}
        <button
          className="button"
          onClick={() => void store.connectionCommand("connections.review_request", {})}
        >
          Request owner review
        </button>
      </section>
    );
  if (!store.connections)
    return <p className="caption">Connect to the updated Bunny Host to manage AI accounts.</p>;
  return (
    <>
      <p className="caption">
        One BunnyRouter, with separate account, entitlement, billing and Task permissions. You
        complete sign-in with the provider. No password, OTP or browser cookies enter Bunny.
      </p>
      <div className="account-grid">
        {CONNECTION_CATALOG.map((entry) => (
          <AccountCard
            key={entry.id}
            entry={entry}
            rows={store.connections!.accounts.filter((r) => r.catalog === entry.id)}
          />
        ))}
      </div>
    </>
  );
}

function AccountCard({ entry, rows }: { entry: CatalogEntry; rows: ConnectionView[] }) {
  const store = useIsland(),
    base = useId(),
    section = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState(rows[0]?.id ?? ""),
    [message, setMessage] = useState(""),
    [hint, setHint] = useState(""),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false);
  const row = rows.find((r) => r.id === selected) ?? rows[0];
  const mode = entry.modes.find((m) => m.mode === row?.mode);
  useEffect(() => {
    if (store.accountFocus === entry.id)
      section.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [store.accountFocus, entry.id]);
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => setKey(""), 20000);
    return () => clearTimeout(timer);
  }, [key]);
  if (!row || !mode) return null;
  const act = async (action: string, data: Record<string, unknown> = {}) => {
    setBusy(true);
    setMessage("");
    const ok = await store.connectionCommand(action, { id: row.id, ...data }, setMessage);
    if (ok)
      setMessage(
        action === "connections.signin.start"
          ? "Complete sign-in in the provider's window, then Check status."
          : "Host confirmed the change.",
      );
    setBusy(false);
    return ok;
  };
  const changeConsent = (patch: Partial<ConnectionView["consent"]>) =>
    void act("connections.consent.set", { consent: { ...row.consent, ...patch } });
  return (
    <section
      ref={section}
      className="ai-card account-card"
      aria-labelledby={`${base}-title`}
      data-focused={store.accountFocus === entry.id}
    >
      <header className="ai-card-head">
        <h3 id={`${base}-title`}>
          <Link2 size={18} aria-hidden /> {entry.name}
        </h3>
        <span className="ai-pill" data-tone={row.status === "connected" ? "ok" : "warn"}>
          {ACCOUNT_STATUS[row.status]}
        </span>
      </header>
      <label className="account-mode" htmlFor={`${base}-mode`}>
        Connection mode
        <select
          id={`${base}-mode`}
          value={row.id}
          onChange={(e) => {
            setSelected(e.target.value);
            setMessage("");
            setKey("");
          }}
        >
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {entry.modes.find((m) => m.mode === r.mode)?.label ?? r.mode}
            </option>
          ))}
        </select>
      </label>
      <p>
        <strong>{BILLING_LABEL[row.billing]}</strong>
      </p>
      <p className="caption">{mode.detail}</p>
      <dl className="account-facts">
        {accountFacts(row).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        <div>
          <dt>Account / workspace</dt>
          <dd>
            {row.maskedIdentity ?? "Not reported"}
            {row.maskedWorkspace ? ` · ${row.maskedWorkspace}` : ""}
          </dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>
            {row.plan.label ?? "Unknown"} · {row.plan.source.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt>Last verified</dt>
          <dd>
            {row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : "Not checked"}
          </dd>
        </div>
      </dl>
      <p className="caption">{row.detail}</p>
      {mode.reason ? (
        <p className="account-limitation">
          <ShieldCheck size={16} aria-hidden /> {mode.reason}
        </p>
      ) : null}
      <p className="caption">{entry.termsNote}</p>
      {mode.support !== "unsupported" &&
      mode.signIn.kind === "native_cli" &&
      ["openai", "anthropic", "cursor", "opencode"].includes(entry.id) ? (
        <div className="account-connect">
          <label htmlFor={`${base}-hint`}>
            Optional email hint
            <input
              id={`${base}-hint`}
              type="email"
              autoComplete="off"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Account hint only"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !store.canAct()}
            onClick={() => void act("connections.signin.start", { accountHint: hint })}
          >
            Sign in with provider
          </button>
        </div>
      ) : null}
      {row.mode === "api_key" && mode.support !== "unsupported" ? (
        <div className="account-connect">
          <label htmlFor={`${base}-key`}>
            <KeyRound size={16} aria-hidden /> Separate API key
            <input
              id={`${base}-key`}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const value = key;
                  setKey("");
                  void act("connections.credential.save", { apiKey: value });
                }
              }}
            />
          </label>
          <button
            className="button"
            disabled={busy || !key || !store.canAct()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const value = key;
              setKey("");
              void act("connections.credential.save", { apiKey: value });
            }}
          >
            Save encrypted key
          </button>
          {row.credential?.present ? (
            <button
              className="button"
              disabled={busy}
              onClick={() => void act("connections.credential.remove")}
            >
              Remove saved key
            </button>
          ) : null}
          <p className="caption">
            Encrypted with Windows DPAPI for this profile. Saving does not verify inference or
            enable billing. The field clears after use.
          </p>
        </div>
      ) : null}
      <label className="account-check">
        <input
          type="checkbox"
          checked={row.consent.allowTasks}
          disabled={busy || !row.dispatch || !store.canAct()}
          onChange={(e) => changeConsent({ allowTasks: e.target.checked })}
        />{" "}
        Allow Bunny to send Tasks after individual approval
      </label>
      {row.dispatch ? (
        <label htmlFor={`${base}-scope`} className="account-mode">
          Project data scope
          <select
            id={`${base}-scope`}
            value={row.consent.projects === "all" ? "all" : (row.consent.projects[0] ?? "")}
            disabled={busy}
            onChange={(e) =>
              changeConsent({ projects: e.target.value === "all" ? "all" : [e.target.value] })
            }
          >
            <option value="all">All projects and direct chat</option>
            <option value="">Direct chat only</option>
            {store.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="account-actions">
        <button
          className="button"
          disabled={busy || mode.support === "unsupported" || !store.canAct()}
          onClick={() => void act("connections.check")}
        >
          Check status
        </button>
        <button
          className="button"
          disabled={busy || !row.dispatch || !store.canAct()}
          onClick={() =>
            void act(row.lifecycle === "paused" ? "connections.resume" : "connections.pause")
          }
        >
          {row.lifecycle === "paused" ? "Resume" : "Pause"}
        </button>
        {row.session === "account_switched" ? (
          <button
            className="button"
            disabled={busy}
            onClick={() => void act("connections.accept_account")}
          >
            Confirm new account
          </button>
        ) : null}
        <button
          className="button"
          disabled={busy || mode.support === "unsupported"}
          onClick={() => void act("connections.disconnect")}
        >
          Disconnect from Bunny
        </button>
        <a className="button" href={entry.manageUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden /> Manage on provider site
        </a>
      </div>
      <p className="caption">
        Disconnect stops Bunny access and leaves the provider's native login unchanged. To change
        native accounts, sign in again in that client and confirm the changed account here.
      </p>
      <p role="status" aria-live="polite" className="caption">
        {message}
      </p>
    </section>
  );
}

export function RoutingPrivacy() {
  const store = useIsland(),
    base = useId(),
    snapshot = store.connections;
  const [message, setMessage] = useState("");
  if (!snapshot)
    return <p className="caption">Routing privacy is managed on the Windows workstation.</p>;
  const policy = snapshot.policy;
  const update = (patch: Partial<RoutingPrivacyPolicy>) =>
    void store.connectionCommand(
      "connections.policy.set",
      { policy: { ...policy, ...patch } },
      setMessage,
    );
  return (
    <section className="ai-card">
      <h3>Routing & privacy</h3>
      <p>
        A Task stays with its approved provider, account and billing mode. Local fallbacks keep data
        on this PC. A different cloud destination needs your explicit allowance or a new Task
        approval.
      </p>
      <p className="caption">
        Existing native clients still require each Task approval. API and metered modes are never
        selected automatically. Custom credential environment overrides are ignored.
      </p>
      <fieldset className="account-allowlist">
        <legend>Allow switches to these cloud vendors</legend>
        {(["openai", "anthropic"] as const).map((v) => (
          <label className="account-check" key={v}>
            <input
              type="checkbox"
              checked={policy.switchAllowlist.includes(v)}
              onChange={(e) =>
                update({
                  switchAllowlist: e.target.checked
                    ? [...policy.switchAllowlist, v]
                    : policy.switchAllowlist.filter((x) => x !== v),
                })
              }
            />{" "}
            {VENDOR_LABEL[v]}
          </label>
        ))}
      </fieldset>
      <label className="account-mode" htmlFor={`${base}-failover`}>
        Failure policy
        <select
          id={`${base}-failover`}
          value={policy.failover}
          onChange={(e) => update({ failover: e.target.value as RoutingPrivacyPolicy["failover"] })}
        >
          <option value="same_vendor_or_local">Same provider or local fallback</option>
          <option value="ask">Stop and ask for a new review</option>
        </select>
      </label>
      <label className="account-mode" htmlFor={`${base}-retention`}>
        Detailed usage retention (days)
        <input
          id={`${base}-retention`}
          type="number"
          min={7}
          max={365}
          defaultValue={policy.retentionDays}
          onBlur={(e) => {
            const days = Number(e.target.value);
            if (days !== policy.retentionDays) update({ retentionDays: days });
          }}
        />
      </label>
      <p className="caption">
        Older details roll into daily totals in bounded transactions. Today's budgets, pending
        requests, current Jev session and latest Jev request stay intact.
      </p>
      <button
        className="button"
        onClick={() => void store.connectionCommand("connections.retention.run", {}, setMessage)}
      >
        Clean up eligible history
      </button>
      <h4>Recent account audit</h4>
      {snapshot.audit.length ? (
        <ul className="account-audit">
          {snapshot.audit.map((e, i) => (
            <li key={`${e.at}:${i}`}>
              {new Date(e.at).toLocaleTimeString()} · {e.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="caption">No account changes recorded yet.</p>
      )}
      <p role="status" className="caption">
        {message}
      </p>
    </section>
  );
}
