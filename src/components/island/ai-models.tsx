import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Cpu, Cloud, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { ConnectedAccounts, RoutingPrivacy } from "./accounts";
import { HarnessManager } from "./harness-manager";
import { SessionUsage } from "./session-usage";
import type { IntelligenceSnapshot } from "@/lib/bunny-host/intelligence-snapshot";
import type { JevPolicy } from "@/lib/bunny-host/intelligence";
import {
  JEV_STATE_LABEL,
  LAYA_STATUS_LABEL,
  MASKED_KEY,
  apiKeyProblem,
  assistanceLine,
  boundedNumber,
  jevDistinctions,
  jevTone,
  lastTestLine,
  layaDistinctions,
  usageLine,
  type Distinction,
  type Tone,
} from "./intelligence-model";

const SECTIONS = ["Connected Accounts", "Harness Manager", "Local & advice", "Routing & Privacy", "Routing preferences", "Usage & limits"] as const;
type Section = (typeof SECTIONS)[number];
const REVEAL_MS = 20_000;

function Row({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      {children}
    </div>
  );
}
function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}
function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="ai-pill" data-tone={tone}>
      {children}
    </span>
  );
}
function Facts({ items, label }: { items: Distinction[]; label: string }) {
  return (
    <ul className="ai-facts" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} data-on={item.value}>
          <strong>
            {item.label}: {item.value ? "Yes" : "No"}
          </strong>
          <span>{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function AiModelsSettings() {
  const store = useIsland();
  const [section, setSection] = useState<Section>("Connected Accounts");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const intelligence = store.intelligence;
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SECTIONS.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setSection(SECTIONS[next]);
    tabs.current[next]?.focus();
  };
  return (
    <>
      <div className="ai-tabs" role="tablist" aria-label="AI & Models sections">
        {SECTIONS.map((name, index) => (
          <button
            key={name}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            role="tab"
            id={`${base}-tab-${index}`}
            aria-selected={section === name}
            aria-controls={section === name ? `${base}-panel-${index}` : undefined}
            tabIndex={section === name ? 0 : -1}
            onClick={() => setSection(name)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel-${SECTIONS.indexOf(section)}`} aria-labelledby={`${base}-tab-${SECTIONS.indexOf(section)}`} tabIndex={0} className="ai-panel">
        {section === "Connected Accounts" ? <ConnectedAccounts /> : section === "Harness Manager" ? <HarnessManager /> : section === "Routing & Privacy" ? <RoutingPrivacy /> : section === "Routing preferences" ? (
          <RoutingPreferences key={JSON.stringify(intelligence?.jev.thresholds ?? null)} intelligence={intelligence} />
        ) : section === "Usage & limits" ? (
          <>
            <SessionUsage />
            {intelligence ? <PrivacyUsage key={JSON.stringify(intelligence.jev.limits)} intelligence={intelligence} /> : null}
          </>
        ) : !intelligence ? (
          <p className="caption">
            {store.viewer?.kind === "device"
              ? "Model connections and API keys are managed on the workstation (Windows Host)."
              : "AI & Models connections need the updated Bunny Host."}
          </p>
        ) : section === "Local & advice" ? (
          <Connections intelligence={intelligence} />
        ) : (
          <PrivacyUsage key={JSON.stringify(intelligence.jev.limits)} intelligence={intelligence} />
        )}
      </div>
    </>
  );
}

function Connections({ intelligence }: { intelligence: IntelligenceSnapshot }) {
  return (
    <>
      <p className="caption">
        BunnyRouter makes every routing decision. Connections below only add options it may consider; none is assigned to a
        Personal Agent.
      </p>
      <h3 className="ai-heading">
        <Cpu size={16} aria-hidden /> Local models
      </h3>
      <LayaCard intelligence={intelligence} />
      <h3 className="ai-heading">
        <Cloud size={16} aria-hidden /> Cloud connections
      </h3>
      <JevCard intelligence={intelligence} />
    </>
  );
}

function LayaCard({ intelligence }: { intelligence: IntelligenceSnapshot }) {
  const store = useIsland();
  const laya = intelligence.laya;
  const [status, setStatus] = useState("");
  const busy = !!store.pending.laya;
  return (
    <section className="ai-card" aria-labelledby="laya-title">
      <header>
        <div>
          <strong id="laya-title">Laya</strong>
          <p>Local model resource · no API key needed</p>
        </div>
        <Pill tone={laya.status === "installed" ? "ok" : laya.status === "missing" ? "off" : "warn"}>{LAYA_STATUS_LABEL[laya.status]}</Pill>
      </header>
      <p className="caption">{laya.detail}</p>
      <Row label="Allow BunnyRouter to use Laya" detail="Laya is used only for task classes it passed a local benchmark on.">
        <Switch
          label="Allow Laya routing"
          checked={laya.enabled}
          disabled={busy}
          onChange={async (next) => {
            setStatus("");
            if (await store.configureLaya(next, setStatus)) setStatus(next ? "Laya allowed." : "Laya turned off.");
          }}
        />
      </Row>
      {laya.models.map((model) => (
        <div className="ai-model" key={model.model}>
          <Row
            label={model.model}
            detail={`${model.runtime}${model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} token context` : " · context window not probed"}${model.memoryRequirement ? ` · ${model.memoryRequirement}` : " · memory not measured"}`}
          >
            <button
              className="btn secondary"
              disabled={busy || laya.benchmarking !== null || !model.local}
              onClick={async () => {
                setStatus("");
                if (await store.benchmarkLaya(model.model, setStatus)) setStatus("Benchmark started on this PC. Results appear here when it finishes.");
              }}
            >
              {laya.benchmarking === model.model ? "Benchmarking…" : "Run local benchmark"}
            </button>
          </Row>
          <ul className="ai-capabilities" aria-label={`${model.model} capabilities`}>
            {model.capabilities.map((row) => (
              <li key={row.capability}>
                {row.capability}: {row.demonstrated === null ? "unknown" : row.demonstrated ? "demonstrated" : "not supported"}
              </li>
            ))}
          </ul>
          <p className="caption">
            {model.benchmarks.length
              ? `Last benchmark: ${model.benchmarks.map((row) => `${row.taskClass} ${row.passed ? "passed" : "failed"}${row.latencyMs !== null ? ` (${(row.latencyMs / 1000).toFixed(1)} s)` : ""}`).join(", ")}.`
              : "Not benchmarked yet."}{" "}
            {model.routingEligible ? `Eligible for: ${model.eligibleTaskClasses.join(", ")}.` : "Not eligible for automatic routing."}
          </p>
        </div>
      ))}
      <Facts items={layaDistinctions(intelligence, store.tasks)} label="Laya status details" />
      <p className="caption" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function JevCard({ intelligence }: { intelligence: IntelligenceSnapshot }) {
  const store = useIsland();
  const jev = intelligence.jev;
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [billableOk, setBillableOk] = useState(false);
  const [status, setStatus] = useState("");
  const keyId = useId();
  const busy = !!store.pending.intelligence;
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);
  const showForm = !jev.hasCredential || editing;
  const problem = key ? apiKeyProblem(key) : null;
  const save = async () => {
    const invalid = apiKeyProblem(key);
    if (invalid) {
      setStatus(invalid);
      return;
    }
    setStatus("");
    const submitted = key.trim();
    setKey("");
    setRevealed(false);
    if (await store.saveIntelligenceKey(submitted, setStatus)) {
      setEditing(false);
      setStatus("Saved and encrypted on this PC. Not tested yet: use Test connection.");
    }
  };
  const configure = async (patch: Partial<JevPolicy>, done: string) => {
    setStatus("");
    const { enabled, model, privacy, limits, thresholds } = jev;
    if (await store.configureIntelligence({ enabled, model, privacy, limits, thresholds, ...patch }, setStatus)) setStatus(done);
  };
  const models = [...new Set([jev.model, "jev-latest", ...jev.models])];
  return (
    <section className="ai-card" aria-labelledby="jev-title">
      <header>
        <div>
          <strong id="jev-title">TypeSafe Jev</strong>
          <p>Hosted structured decisions · optional · advisory only</p>
        </div>
        <Pill tone={jevTone(jev.state)}>{JEV_STATE_LABEL[jev.state]}</Pill>
      </header>
      <p className="caption">{jev.detail}</p>
      <Row label="Use hosted decision assistance" detail="Off by default. When on, BunnyRouter may ask for advice among models it already found eligible; it still decides.">
        <Switch label="Use TypeSafe Jev decision assistance" checked={jev.enabled} disabled={busy} onChange={(next) => configure({ enabled: next }, next ? "Hosted decisions on." : "Hosted decisions off.")} />
      </Row>
      <div className="setting-row ai-key">
        <div>
          <strong>
            <KeyRound size={14} aria-hidden /> API key
          </strong>
          <p>
            {jev.hasCredential
              ? `Saved ${jev.credentialUpdatedAt ? new Date(jev.credentialUpdatedAt).toLocaleString() : ""} · ${jev.credentialProtection}. Saving does not test it.`
              : "Not saved. Bunny A works fully without it."}
          </p>
        </div>
        {jev.hasCredential && !editing ? (
          <div className="ai-key-actions">
            <span className="ai-mask" aria-label="Saved API key, hidden">
              {MASKED_KEY}
            </span>
            <button className="btn secondary" disabled={busy} onClick={() => { setEditing(true); setConfirmRemove(false); }}>
              Replace
            </button>
            {confirmRemove ? (
              <button
                className="btn secondary danger-text"
                disabled={busy}
                onClick={async () => {
                  setConfirmRemove(false);
                  setStatus("");
                  if (await store.removeIntelligenceKey(setStatus)) setStatus("API key removed from this PC.");
                }}
              >
                Confirm remove
              </button>
            ) : (
              <button className="btn secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            )}
          </div>
        ) : null}
      </div>
      {showForm ? (
        <form
          className="ai-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={keyId}>{jev.hasCredential ? "New TypeSafe API key" : "Paste your TypeSafe API key"}</label>
          <div>
            <input
              id={keyId}
              type={revealed ? "text" : "password"}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              data-1p-ignore
              data-lpignore="true"
              aria-invalid={!!problem}
              aria-describedby={`${keyId}-hint`}
            />
            <button type="button" className="btn secondary" aria-pressed={revealed} onClick={() => setRevealed((value) => !value)} disabled={!key}>
              {revealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              {revealed ? "Hide" : "Show"}
            </button>
            <button type="submit" className="btn" disabled={busy || !key}>
              Save
            </button>
            {jev.hasCredential ? (
              <button type="button" className="btn secondary" onClick={() => { setEditing(false); setKey(""); setRevealed(false); }}>
                Cancel
              </button>
            ) : null}
          </div>
          <p className="caption" id={`${keyId}-hint`}>
            {problem ?? "Stored encrypted for your Windows account on this PC only. Never shown again, never sent to Agents or your phone."}
          </p>
        </form>
      ) : null}
      <Row label="Model" detail={jev.models.length ? "Models from TypeSafe's last model list." : "Run Test connection to list available models."}>
        <select aria-label="TypeSafe Jev model" value={jev.model} disabled={busy} onChange={(event) => configure({ model: event.target.value }, "Model saved.")}>
          {models.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Test connection" detail={jev.enabled ? lastTestLine(jev.lastTest) : "Turn on hosted decision assistance to test. Nothing is sent while it is off."}>
        <button className="btn secondary" disabled={busy || !jev.enabled || !jev.hasCredential} onClick={async () => {
          setStatus("Testing…");
          if (await store.testIntelligence(false, setStatus)) setStatus("Test finished. See the result above.");
        }}>
          Test connection
        </button>
      </Row>
      <Row label="Decision test" detail="Sends one small decision request. It counts against your allowance and may be billed by TypeSafe.">
        <div className="ai-billable">
          <label>
            <input type="checkbox" checked={billableOk} onChange={(event) => setBillableOk(event.target.checked)} />
            I understand this is billable
          </label>
          <button className="btn secondary" disabled={busy || !jev.enabled || !jev.hasCredential || !billableOk} onClick={async () => {
            setBillableOk(false);
            setStatus("Testing…");
            if (await store.testIntelligence(true, setStatus)) setStatus("Decision test finished. See the result above.");
          }}>
            Run decision test
          </button>
        </div>
      </Row>
      {jev.lastError ? <p className="caption danger-text">{jev.lastError}</p> : null}
      <Facts items={jevDistinctions(intelligence, store.tasks)} label="TypeSafe Jev status details" />
      <p className="caption" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function RoutingPreferences({ intelligence }: { intelligence: IntelligenceSnapshot | null }) {
  const store = useIsland();
  const [status, setStatus] = useState("");
  const thresholds = intelligence?.jev.thresholds;
  const [draft, setDraft] = useState(() => ({
    acceptConfidence: String(thresholds?.acceptConfidence ?? 0.75),
    fallbackBelow: String(thresholds?.fallbackBelow ?? 0.5),
    clarifyNoul: String(thresholds?.clarifyNoul ?? 0.8),
  }));
  const parsed = {
    acceptConfidence: boundedNumber(draft.acceptConfidence, 0, 1),
    fallbackBelow: boundedNumber(draft.fallbackBelow, 0, 1),
    clarifyNoul: boundedNumber(draft.clarifyNoul, 0, 1),
  };
  const valid = parsed.acceptConfidence !== null && parsed.fallbackBelow !== null && parsed.clarifyNoul !== null && parsed.fallbackBelow <= parsed.acceptConfidence;
  const field = (name: keyof typeof draft, label: string) => (
    <label className="threshold-input">
      <input aria-label={label} type="number" inputMode="decimal" min={0} max={1} step={0.05} value={draft[name]} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />
    </label>
  );
  return (
    <>
      <Row label="Approval before launch" detail="Every new route waits for an explicit Run action.">
        <span className="caption">Required by Host</span>
      </Row>
      <Row label="Next Task depth">
        <select aria-label="Default task depth" value={store.mode} onChange={(e) => store.setMode(e.target.value as "fast" | "balanced" | "deep")}>
          <option value="fast">Fast</option>
          <option value="balanced">Balanced</option>
          <option value="deep">Deep</option>
        </select>
      </Row>
      <Row label="Local only" detail="A hard routing constraint for your next task.">
        <Switch label="Local-only routing" checked={store.localOnly} onChange={(next) => store.setLocalOnly(next)} />
      </Row>
      {intelligence ? (
        <>
          <h3 className="ai-heading">
            <ShieldCheck size={16} aria-hidden /> Decision assistance
          </h3>
          <p className="caption">
            {intelligence.localDecisionPolicy.label}: {intelligence.localDecisionPolicy.detail}
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!valid) return;
              const jev = intelligence.jev;
              setStatus("");
              if (await store.configureIntelligence({ enabled: jev.enabled, model: jev.model, privacy: jev.privacy, limits: jev.limits, thresholds: { acceptConfidence: parsed.acceptConfidence!, fallbackBelow: parsed.fallbackBelow!, clarifyNoul: parsed.clarifyNoul! } }, setStatus))
                setStatus("Thresholds saved.");
            }}
          >
            <Row label="Accept advice at confidence" detail="Hosted advice changes the route only at or above this confidence (0–1).">
              {field("acceptConfidence", "Accept advice confidence threshold")}
            </Row>
            <Row label="Ignore advice below" detail="Below this, BunnyRouter's own choice stands without review (0–1).">
              {field("fallbackBelow", "Fallback confidence threshold")}
            </Row>
            <Row label="Ask me to clarify at" detail="Probability that the request is ambiguous before Bunny suggests clarifying (0–1).">
              {field("clarifyNoul", "Clarification threshold")}
            </Row>
            <p className="caption" role="status" aria-live="polite">
              {!valid ? "Use values from 0 to 1, with the ignore threshold no higher than the accept threshold." : status}
            </p>
            <button type="submit" className="btn secondary" disabled={!valid || !!store.pending.intelligence}>
              Save thresholds
            </button>
          </form>
          <p className="caption">{assistanceLine(intelligence.lastAssistance)}</p>
        </>
      ) : null}
    </>
  );
}

function PrivacyUsage({ intelligence }: { intelligence: IntelligenceSnapshot }) {
  const store = useIsland();
  const jev = intelligence.jev;
  const [status, setStatus] = useState("");
  const busy = !!store.pending.intelligence;
  const [draft, setDraft] = useState(() => ({
    perSession: String(jev.limits.maxRequestsPerSession),
    perDay: String(jev.limits.maxRequestsPerDay),
    tokens: jev.limits.maxTokensPerDay === null ? "" : String(jev.limits.maxTokensPerDay),
    concurrent: String(jev.limits.maxConcurrent),
    timeout: String(jev.limits.timeoutMs / 1000),
    money: jev.limits.monetaryCapUsdPerDay === null ? "" : String(jev.limits.monetaryCapUsdPerDay),
  }));
  const whole = (value: number | null) => (value !== null && Number.isInteger(value) ? value : null);
  const parsed = {
    perSession: whole(boundedNumber(draft.perSession, 0, 10_000)),
    perDay: whole(boundedNumber(draft.perDay, 0, 100_000)),
    tokens: draft.tokens.trim() === "" ? null : whole(boundedNumber(draft.tokens, 0, 100_000_000)),
    concurrent: whole(boundedNumber(draft.concurrent, 1, 4)),
    timeout: boundedNumber(draft.timeout, 1, 30),
    money: draft.money.trim() === "" ? null : boundedNumber(draft.money, 0, 10_000),
  };
  const valid =
    parsed.perSession !== null && parsed.perDay !== null && parsed.concurrent !== null && parsed.timeout !== null &&
    (draft.tokens.trim() === "" || parsed.tokens !== null) && (draft.money.trim() === "" || parsed.money !== null);
  const policy = (patch: Partial<JevPolicy>): JevPolicy => ({ enabled: jev.enabled, model: jev.model, privacy: jev.privacy, limits: jev.limits, thresholds: jev.thresholds, ...patch });
  const configure = async (next: JevPolicy, done: string) => {
    setStatus("");
    if (await store.configureIntelligence(next, setStatus)) setStatus(done);
  };
  const field = (name: keyof typeof draft, label: string, unit: string) => (
    <label className="threshold-input ai-limit">
      <input aria-label={label} type="number" inputMode="decimal" min={0} value={draft[name]} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />
      {unit}
    </label>
  );
  return (
    <>
      <p className="caption">
        Hosted decisions never receive Project content, private files, transcripts, voice audio, credentials, repository source
        or Agent scratch. Only you can change these settings, on this PC.
      </p>
      <Row label="Share routing metadata" detail="Task category, the model keys BunnyRouter found eligible and your depth setting. Required for hosted decisions.">
        <Switch label="Share routing metadata with TypeSafe" checked={jev.privacy.allowDecisionMetadata} disabled={busy} onChange={(next) => configure(policy({ privacy: { ...jev.privacy, allowDecisionMetadata: next, allowTaskDescription: next && jev.privacy.allowTaskDescription } }), next ? "Metadata sharing on." : "Metadata sharing off.")} />
      </Row>
      <Row label="Include my request text" detail="Off by default. A request that contains anything shaped like a key, token or password is never sent.">
        <Switch label="Include request text in hosted decisions" checked={jev.privacy.allowTaskDescription} disabled={busy || !jev.privacy.allowDecisionMetadata} onChange={(next) => configure(policy({ privacy: { ...jev.privacy, allowTaskDescription: next } }), next ? "Request text sharing on." : "Request text sharing off.")} />
      </Row>
      <h3 className="ai-heading">Usage</h3>
      <p className="caption">{usageLine(jev.usage, jev.limits)}{jev.usage.unknownUsageRows ? ` · ${jev.usage.unknownUsageRows} request(s) with unknown billing` : ""}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          void configure(
            policy({
              limits: {
                maxRequestsPerSession: parsed.perSession!,
                maxRequestsPerDay: parsed.perDay!,
                maxTokensPerDay: parsed.tokens,
                maxConcurrent: parsed.concurrent!,
                timeoutMs: Math.round(parsed.timeout! * 1000),
                monetaryCapUsdPerDay: parsed.money,
                strictBudget: jev.limits.strictBudget,
              },
            }),
            "Limits saved.",
          );
        }}
      >
        <Row label="Requests per session" detail="0 means no hosted requests.">{field("perSession", "Hosted requests per session", "")}</Row>
        <Row label="Requests per day" detail="0 (the default) means no hosted requests.">{field("perDay", "Hosted requests per day", "")}</Row>
        <Row label="Input tokens per day" detail="Leave empty for no token ceiling.">{field("tokens", "Hosted input tokens per day", "")}</Row>
        <Row label="Concurrent requests">{field("concurrent", "Concurrent hosted requests", "")}</Row>
        <Row label="Timeout">{field("timeout", "Hosted request timeout in seconds", "s")}</Row>
        <Row label="Daily spending limit" detail="Estimated from TypeSafe's published price. Leave empty for none.">{field("money", "Daily spending limit in US dollars", "USD")}</Row>
        <p className="caption" role="status" aria-live="polite">
          {!valid ? "Check the limits: request, token and concurrency limits are whole numbers within range." : status}
        </p>
        <button type="submit" className="btn secondary" disabled={!valid || busy}>
          Save limits
        </button>
      </form>
      <Row label="Strict budget" detail="When usage or price is unknown, stop hosted requests instead of guessing.">
        <Switch label="Strict hosted budget" checked={jev.limits.strictBudget} disabled={busy} onChange={(next) => configure(policy({ limits: { ...jev.limits, strictBudget: next } }), next ? "Strict budget on." : "Strict budget off.")} />
      </Row>
    </>
  );
}
