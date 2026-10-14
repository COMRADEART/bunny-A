import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, Layers, ShieldCheck } from "lucide-react";
import { useIsland } from "@/store/use-island";
import {
  PERSONAL_AGENT_LIMITS,
  WEAPON_LABEL,
  RESPONSIBILITIES,
  isUserFacingAgent,
  presentationLabel,
  type PersonalAgentView,
  type SlotId,
  type WeaponId,
} from "@/lib/bunny-host/personal-agents";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { agentControls, type AgentView } from "./workspace-model";
import { displayState, hostLive } from "./character-model";
import { Empty } from "./ui";
import { AgentConversation } from "./conversation";
import {
  authorityFacts,
  bindAgent,
  draftFromSnapshot,
  isDirty,
  RESPONSIBILITY_LABEL,
  saveRefusalText,
  SCHEDULE_NOTICE,
  slotErrors,
  STYLE_LABEL,
  STYLE_OPTIONS,
  studioMode,
  swapWeapon,
  validateDraft,
  WEAPON_OPTIONS,
  type StudioSlot,
} from "./studio-model";

/**
 * Personal Agent Studio: four slots drawn as the user's own weapon characters, editable on the workstation. Every edit is a
 * draft until the Host acknowledges the save. Names, looks and tags never change what an Agent may do; the authority panel
 * shows the bound Agent's own authorization and links to the existing review controls.
 */
export function Studio() {
  const systemReduced = usePrefersReducedMotion();

  const store = useIsland();
  const snapshot = store.personalAgents;
  const mode = studioMode(store.viewer?.kind === "device" ? "device" : "workstation");
  const live = hostLive(store.connection, Date.now());
  const saved = useMemo(() => (snapshot ? draftFromSnapshot(snapshot) : []), [snapshot]);
  const [draft, setDraft] = useState<StudioSlot[]>(saved);
  const [basedOn, setBasedOn] = useState<number | null>(snapshot?.revision ?? null);
  const [selected, setSelected] = useState<SlotId | null>(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const savedRef = useRef(saved);
  // Focus: the editor takes focus when it opens, and returns to the slot's Edit button when it closes.
  const editButtons = useRef(new Map<SlotId, HTMLButtonElement>());
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const openedFor = useRef<SlotId | null>(null);
  useEffect(() => {
    if (selected !== null) {
      openedFor.current = selected;
      editorHeading.current?.focus();
      return;
    }
    const back = openedFor.current;
    openedFor.current = null;
    if (back !== null) editButtons.current.get(back)?.focus();
  }, [selected]);

  // A newer Host revision replaces a clean draft. A dirty draft is kept, and the user is told it was based on an older view.
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.revision === basedOn) return;
    const previous = savedRef.current;
    savedRef.current = saved;
    // Our own acknowledged save: the draft already is the Host's new content, so adopt it and keep the "Saved" notice.
    if (!isDirty(draft, saved)) {
      setBasedOn(snapshot.revision);
    } else if (!isDirty(draft, previous)) {
      // A clean draft follows the Host's newer revision.
      setDraft(saved);
      setBasedOn(snapshot.revision);
      setNotice(null);
    } else {
      setNotice("Personal Agents changed on the Host while you were editing. Review your changes before saving.");
    }
    // The draft is intentionally read at the moment the Host revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.revision]);

  const bindable = useMemo(() => new Set((snapshot?.bindable ?? []).map((row) => row.id)), [snapshot]);
  // A paired device receives no bindable list (the Host hides it) but its bindings were Host-confirmed. Binding
  // errors are a save-time concern, so the read-only view neither invents "Only your own Agents can fill a slot"
  // over valid data nor blanks the Bound Agent select.
  const rawErrors = useMemo(() => validateDraft(draft, bindable), [draft, bindable]);
  const errors = useMemo(() => (mode.editable ? rawErrors : rawErrors.filter((error) => error.field !== "agentId")), [mode.editable, rawErrors]);
  const dirty = isDirty(draft, saved);
  // A save whose outcome the Host has not confirmed blocks a new save until the store has checked it.
  const saveUnknown = store.uncertain.some((row) => row.action === "personal_agents.configure");
  const canSave = mode.editable && live && dirty && errors.length === 0 && !saving && !saveUnknown && snapshot !== null;
  const current = selected ? draft.find((row) => row.slot === selected) ?? null : null;
  const slotted = new Set(draft.map((row) => row.agentId).filter((id): id is string => id !== null));
  const agents = store.agents?.agents ?? [];
  const boundAgent = current?.agentId ? agents.find((agent) => agent.id === current.agentId) ?? null : null;
  const authority = authorityFacts(boundAgent?.authorization ?? null);
  const owned = new Set(store.personalAgentContext?.slots.flatMap((row) => row.owned.map((agent) => agent.agentId)) ?? []);
  const others = agents.filter((agent) => isUserFacingAgent(agent) && !slotted.has(agent.id) && !owned.has(agent.id));

  const edit = (slot: SlotId, patch: Partial<StudioSlot>) => {
    setDraft((rows) => rows.map((row) => (row.slot === slot ? { ...row, ...patch } : row)));
    setRefusal(null);
    setNotice(null);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setRefusal(null);
    setNotice(null);
    const payload = draft.map((row) => ({
      slot: row.slot,
      weapon: row.weapon,
      displayName: row.displayName,
      description: row.description,
      purpose: row.purpose,
      style: row.style,
      responsibilities: row.responsibilities,
      agentId: row.agentId,
      active: row.active,
    }));
    const ok = await store.configurePersonalAgents(payload, basedOn, (caption) => setRefusal(caption));
    setSaving(false);
    // Only the Host's acknowledgment closes the draft; a refusal keeps every edit so nothing is lost.
    if (ok) setNotice("Saved on your Host.");
  };

  if (!snapshot) {
    return (
      <>
        <PageHeading />
        <Empty title="Personal Agents are not available yet." detail="This Host has not sent its Personal Agent slots. Nothing is changed." />
      </>
    );
  }

  return (
    <>
      <PageHeading />
      <p className="caption" role="note">
        {mode.caption}
      </p>
      <section className="t8-section" aria-labelledby="studio-slots">
        <div className="section-heading">
          <h2 id="studio-slots">Your four Personal Agents</h2>
          <span className="caption">Revision {snapshot.revision}</span>
        </div>
        <div className="st-grid">
          {draft.map((slot) => {
            const view: PersonalAgentView | undefined = snapshot.slots.find((row) => row.slot === slot.slot);
            const state = displayState(view?.presentation.state ?? "UNASSIGNED", live);
            const bound = slot.agentId !== null;
            return (
              <article key={slot.slot} className="t8-surface st-card" data-bound={bound} aria-label={`Slot ${slot.slot}: ${slot.displayName}`}>
                <div className="st-well">
                  <WeaponCharacter
                    weapon={slot.weapon}
                    state={state}
                    slot={slot.slot}
                    size="pose"
                    reduced={systemReduced || store.appearance.motion !== "full"}
                    displayName={slot.displayName}
                    basis={live ? view?.presentation.basis ?? null : null}
                    note={live ? null : "Host connection not live"}
                  />
                </div>
                <strong>{slot.displayName || WEAPON_LABEL[slot.weapon]}</strong>
                <small className="cx-muted">{WEAPON_LABEL[slot.weapon]}</small>
                <span className="cx-badge" aria-live="polite">
                  {live ? presentationLabel(view?.presentation.state ?? "UNASSIGNED") : "Host not live"}
                </span>
                <small className="cx-muted">
                  {bound ? (view?.agent?.name ?? "Agent not found") : "Set up in Studio"}
                </small>
                <button
                  ref={(element) => {
                    if (element) editButtons.current.set(slot.slot, element);
                  }}
                  className="btn secondary"
                  type="button"
                  onClick={() => setSelected(slot.slot)}
                >
                  {mode.editable ? "Edit" : "View"} slot {slot.slot}
                  <ChevronRight size={14} />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <AgentConversation />

      {current && (
        <section className="t8-section" aria-labelledby="studio-editor" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSelected(null); } }}>
          <div className="section-heading">
            <h2 id="studio-editor" ref={editorHeading} tabIndex={-1}>
              Slot {current.slot}: {WEAPON_LABEL[current.weapon]}
            </h2>
            <button className="quiet-button" type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="t8-surface" style={{ padding: 16 }}>
            <fieldset disabled={!mode.editable || saving} className="st-form" style={{ border: 0, padding: 0, margin: 0 }}>
              <label>
                Name
                <input value={current.displayName} maxLength={PERSONAL_AGENT_LIMITS.displayName} onChange={(event) => edit(current.slot, { displayName: event.target.value })} aria-describedby="st-name-err" />
                {slotErrors(errors, current.slot).filter((e) => e.field === "displayName").map((e) => (
                  <span key={e.message} id="st-name-err" className="st-error">{e.message}</span>
                ))}
              </label>
              <label>
                Weapon
                <select
                  value={current.weapon}
                  onChange={(event) => setDraft((rows) => swapWeapon(rows, current.slot, event.target.value as WeaponId))}
                >
                  {WEAPON_OPTIONS.map((option) => (
                    <option key={option.weapon} value={option.weapon}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="cx-muted">Swapping keeps all four weapons unique. Bindings do not move.</span>
              </label>
              <label>
                Bound Agent
                <select
                  value={current.agentId ?? ""}
                  onChange={(event) => setDraft((rows) => bindAgent(rows, current.slot, event.target.value || null))}
                >
                  <option value="">Not assigned</option>
                  {(snapshot.bindable ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.missionTitle ? ` · ${agent.missionTitle}` : ""}
                    </option>
                  ))}
                  {/* A device viewer gets no bindable list; a Host-confirmed binding must still show its Agent. */}
                  {current.agentId && !(snapshot.bindable ?? []).some((agent) => agent.id === current.agentId) ? (
                    <option value={current.agentId}>{boundAgent?.name ?? "Bound Agent (name unavailable on this device)"}</option>
                  ) : null}
                </select>
                <span className="cx-muted">Only your own Agents can fill a slot. An Agent fills one slot at most.</span>
                {slotErrors(errors, current.slot).filter((e) => e.field === "agentId").map((e) => (
                  <span key={e.message} className="st-error">{e.message}</span>
                ))}
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  maxLength={PERSONAL_AGENT_LIMITS.description}
                  value={current.description}
                  aria-invalid={slotErrors(errors, current.slot).some((e) => e.field === "description") || undefined}
                  aria-describedby={slotErrors(errors, current.slot).some((e) => e.field === "description") ? "st-desc-err" : undefined}
                  onChange={(event) => edit(current.slot, { description: event.target.value })}
                />
                {slotErrors(errors, current.slot).filter((e) => e.field === "description").map((e) => (
                  <span key={e.message} id="st-desc-err" className="st-error">{e.message}</span>
                ))}
              </label>
              <label>
                Purpose
                <textarea
                  rows={2}
                  maxLength={PERSONAL_AGENT_LIMITS.purpose}
                  value={current.purpose}
                  aria-invalid={slotErrors(errors, current.slot).some((e) => e.field === "purpose") || undefined}
                  aria-describedby={slotErrors(errors, current.slot).some((e) => e.field === "purpose") ? "st-purpose-err" : undefined}
                  onChange={(event) => edit(current.slot, { purpose: event.target.value })}
                />
                {slotErrors(errors, current.slot).filter((e) => e.field === "purpose").map((e) => (
                  <span key={e.message} id="st-purpose-err" className="st-error">{e.message}</span>
                ))}
              </label>
              <label>
                Interaction style
                <select value={current.style} onChange={(event) => edit(current.slot, { style: event.target.value as StudioSlot["style"] })}>
                  {STYLE_OPTIONS.map((style) => (
                    <option key={style} value={style}>
                      {STYLE_LABEL[style]}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="cx-muted">Responsibilities (descriptive only)</span>
                <div className="st-tags" role="group" aria-label="Responsibilities">
                  {RESPONSIBILITIES.map((tag) => {
                    const on = current.responsibilities.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="st-tag"
                        aria-pressed={on}
                        onClick={() =>
                          edit(current.slot, {
                            responsibilities: on ? current.responsibilities.filter((t) => t !== tag) : [...current.responsibilities, tag],
                          })
                        }
                      >
                        {RESPONSIBILITY_LABEL[tag]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={current.active} onChange={(event) => edit(current.slot, { active: event.target.checked })} />
                Show in the Notch strip
              </label>
            </fieldset>

            {mode.editable && (
              <div className="ap-actions" style={{ marginTop: 12 }}>
                <button className="btn primary" type="button" disabled={!canSave} onClick={() => void save()}>
                  {saving ? "Saving on your Host…" : "Save changes"}
                </button>
                <button className="btn secondary" type="button" disabled={!dirty || saving} onClick={() => { setDraft(saved); setBasedOn(snapshot.revision); setRefusal(null); setNotice(null); }}>
                  Discard edits
                </button>
                {!live && <span className="caption">Reconnect to save. Nothing is sent while the Host is not live.</span>}
                {dirty && errors.length > 0 && <span className="caption">Fix the highlighted fields to save.</span>}
              </div>
            )}
            {saveUnknown && (
              <p className="caption" role="status">
                {saveRefusalText({ code: "UNKNOWN", message: "", outcome: "unknown" })}
              </p>
            )}
            {refusal && (
              <p className="st-error" role="alert">
                {refusal}
              </p>
            )}
            {notice && (
              <p className="caption" role="status">
                {notice}
              </p>
            )}
          </div>

          <div className="t8-surface" style={{ padding: 16, marginTop: 12 }} aria-labelledby="authority-title">
            <h3 id="authority-title">Execution authority</h3>
            <p className="caption">
              Names and looks never change permissions. What this Agent may do is decided by its authorization on the Host, shown here read-only.
            </p>
            {!boundAgent && <p className="caption">Bind an Agent to see its authority.</p>}
            {boundAgent && authority && (
              <dl className="st-form" style={{ margin: "8px 0" }}>
                <div>
                  <dt className="cx-muted">State</dt>
                  <dd>{authority.stateLabel}</dd>
                </div>
                <div>
                  <dt className="cx-muted">Remaining actions</dt>
                  <dd>{authority.remainingActions ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt className="cx-muted">Remaining time</dt>
                  <dd>{authority.remainingMinutes === null ? "Not reported" : `${authority.remainingMinutes} min`}</dd>
                </div>
                <div>
                  <dt className="cx-muted">Pending asks</dt>
                  <dd>{authority.pendingAsks}</dd>
                </div>
              </dl>
            )}
            {boundAgent && !authority && <p className="caption">No authorization record for this Agent yet.</p>}
            <div className="ap-actions">
              <button className="btn secondary" type="button" onClick={() => store.setSheet("approvals")}>
                <ShieldCheck size={15} /> Review asks
              </button>
              {mode.editable && boundAgent && <AgentLifecycle agent={boundAgent} online={store.canAct()} />}
              <button className="btn secondary" type="button" disabled title={SCHEDULE_NOTICE}>
                Schedule
              </button>
            </div>
            <p className="caption">{SCHEDULE_NOTICE}</p>
          </div>
        </section>
      )}

      <section className="t8-section" aria-labelledby="other-agents">
        <h2 id="other-agents">Other agents</h2>
        <div className="t8-surface">
          {others.map((agent) => (
            <div key={agent.id} className="ap-row">
              <span className="ch-neutral-icon" aria-hidden="true">
                <Bot size={20} />
              </span>
              <span>
                <strong>{agent.name}</strong>
                <small className="cx-muted"> · {agent.state.toLowerCase().replaceAll("_", " ")}</small>
              </span>
            </div>
          ))}
          {!others.length && <Empty title="No other Agents." detail="Agents you create that are not in a slot appear here as plain rows." />}
        </div>
        <p className="caption">
          <Layers size={13} /> Internal team members appear only inside a Mission, as neutral rows. They are never weapons.
        </p>
      </section>
    </>
  );
}

function PageHeading() {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">Agents</p>
        <h1>Personal Agent Studio</h1>
        <p>Name your four Agents and choose the characters that stand for them.</p>
      </div>
    </div>
  );
}

/** Pause, resume and stop through the existing Agent commands, only where the Host says the transition is legal. */
function AgentLifecycle({ agent, online }: { agent: AgentView; online: boolean }) {
  const store = useIsland();
  const controls = agentControls(agent, online);
  // Stop halts a running Agent, so it asks first, as the Agents and Missions surfaces do.
  const [confirmStop, setConfirmStop] = useState(false);
  const keepRunning = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmStop) keepRunning.current?.focus();
  }, [confirmStop]);
  return (
    <>
      {controls.pause && (
        <button className="btn secondary" type="button" onClick={() => void store.pauseAgent(agent.id)}>
          Pause
        </button>
      )}
      {controls.resume && (
        <button className="btn secondary" type="button" onClick={() => void store.resumeAgent(agent.id)}>
          Resume
        </button>
      )}
      {controls.stop && !confirmStop && (
        <button className="btn secondary" type="button" onClick={() => setConfirmStop(true)}>
          Stop
        </button>
      )}
      {controls.stop && confirmStop && (
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setConfirmStop(false);
              void store.stopAgent(agent.id);
            }}
          >
            Confirm stop
          </button>
          <button ref={keepRunning} className="btn primary" type="button" onClick={() => setConfirmStop(false)}>
            Keep running
          </button>
        </>
      )}
    </>
  );
}
