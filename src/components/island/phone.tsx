import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  House,
  Info,
  Link2,
  ListChecks,
  Mic,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Users,
} from "lucide-react";
import { useIsland } from "@/store/use-island";
import { WEAPON_LABEL, type PersonalAgentView, type SlotId } from "../../lib/bunny-host/personal-agents.ts";
import type { CompanionView } from "../../lib/bunny-host/voice/voice-companion.ts";
import type { PermissionRequest } from "../../lib/bunny-missions/types.ts";
import { basisText, characterLabel, displayState } from "./character-model.ts";
import { BunnyCompanion, WeaponCharacter, usePrefersReducedMotion, useHappyWindow } from "./characters";
import { appearanceFor } from "./character-style-model";
import { CONNECTION_LABEL } from "./connection-model.ts";
import { companionView, COMPANION_LABEL, levelRingScale } from "./companion-model.ts";
import { LIVE_MISSION } from "./mission-model.ts";
import { allowVerdict, controlCaption, missionApproveVerdict, offerVerdict, rightsSummary, shortId } from "./remote-view-model.ts";
import {
  agentActionAvailability,
  agentRoute,
  animatesFor,
  AGENT_STATE_TEXT,
  boundSlots,
  canSend,
  missionRoute,
  missionRows,
  otherAgentRows,
  parentRoute,
  PHONE_TAB_LABEL,
  PHONE_TABS,
  pendingLabel,
  phoneCapabilities,
  phoneStatus,
  recentTaskRows,
  requestTargetId,
  routeFromSearch,
  routeTab,
  sessionLine,
  stepProgressText,
  stepSegments,
  statusCopy,
  technicalLine,
  verifiedArtifactRows,
  voiceEntry,
  type PhoneCapabilities,
  type PhoneRoute,
  type PhoneStatus,
  type PhoneTab,
  type StatusCopy,
  type StepCounts,
} from "./phone-model.ts";
import "./phone.css";
import { useShownTheme, useThemeScope } from "./theme";
import { UI_THEMES, UI_THEME_IDS, type UiThemeId, type UiThemePreference } from "@/lib/bunny-host/ui-theme";

/**
 * T13 touch-first phone companion. Every number and name on screen is the Host's; nothing here is sample data. The
 * Host's view animates only while it is live. Voice is the workstation's; a paired device is told where voice lives.
 * Controls are offered only where the principal's Host rights allow them, and none reports success before the Host does.
 */

type Island = ReturnType<typeof useIsland.getState>;

type View = {
  store: Island;
  now: number;
  status: PhoneStatus;
  copy: StatusCopy;
  live: boolean;
  reduced: boolean;
  caps: PhoneCapabilities;
  companion: CompanionView;
  companionLevel: number | null;
  go: (route: PhoneRoute) => void;
};

export type PhoneProps = { now?: number };

const clockText = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The page's clock. A fixed `now` (from a parent surface) wins; otherwise it refreshes every few seconds for
 *  staleness. A parent that has not ticked yet passes 0 — that is no clock, so the page's own clock stands in. */
function usePhoneClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [fixed]);
  return fixed || now;
}

const STATUS_PILL = { live: "Live", stale: "Last known", offline: "Offline", connecting: "Connecting", pairing: "Pairing", "host-changed": "Other Host" } as const;

const TITLE: Record<PhoneTab, string> = { ...PHONE_TAB_LABEL, home: "Bunny A" };

const TAB_ICON: Record<PhoneTab, ReactNode> = {
  home: <House size={22} />,
  chat: <MessageSquare size={22} />,
  agents: <Users size={22} />,
  missions: <ListChecks size={22} />,
  settings: <Settings size={22} />,
};

export function Phone({ now: fixedNow }: PhoneProps = {}) {
  const store = useIsland();
  const now = usePhoneClock(fixedNow);
  const systemReduced = usePrefersReducedMotion();
  const [route, setRoute] = useState<PhoneRoute>(() => routeFromSearch(typeof window === "undefined" ? "" : window.location.search));
  const movedByUser = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const status = phoneStatus(store.connection, now);
  const live = animatesFor(status);
  const reduced = systemReduced || store.appearance.motion !== "full";
  const caps = phoneCapabilities(store.viewer);
  const happyUntil = useHappyWindow(store.personalAgents?.slots ?? null, now, live);
  const companion = companionView({
    now,
    connection: store.connection,
    voice: store.voice,
    voiceReceivedAt: store.voiceReceivedAt > 0 ? store.voiceReceivedAt : null,
    happyUntil,
  });
  // The hero ring follows the real input level exactly like the desktop companion (spec section 9), only while a
  // live session has a fresh level sample.
  const companionLevel = store.voice && companion.state !== "DISCONNECTED" ? levelRingScale(store.voice.level, now) : null;
  const copy = statusCopy(status, { snapshotAt: store.connection.snapshotAt, pairingCode: store.connection.pairingCode, format: clockText });
  const go = useCallback((next: PhoneRoute) => {
    movedByUser.current = true;
    setRoute(next);
    if (typeof window !== "undefined") window.scrollTo?.({ top: 0 });
  }, []);
  const scope = useThemeScope();

  // A route change the user made moves focus to the new screen's heading: the Back or tab button that had focus is gone.
  useEffect(() => {
    if (!movedByUser.current) return;
    movedByUser.current = false;
    titleRef.current?.focus();
  }, [route]);

  if (store.pairingRequired || status === "pairing") {
    return (
      <div className="pc-root" {...scope} data-status="pairing">
        <header className="pc-top">
          <span aria-hidden="true" />
          <h1 className="pc-title">Bunny A</h1>
          <span aria-hidden="true" />
        </header>
        <main className="pc-main">
          <Pairing />
        </main>
      </div>
    );
  }

  const view: View = { store, now, status, copy, live, reduced, caps, companion, companionLevel, go };
  const tab = routeTab(route);
  const detail = route.kind !== "tab";
  const title = route.kind === "tab" ? TITLE[route.tab] : route.kind === "agent" ? "Agent details" : route.kind === "mission" ? "Mission" : "Projects";
  return (
    <div className="pc-root" {...scope} data-status={status} data-motion={reduced ? "reduced" : "full"}>
      <header className="pc-top">
        {detail ? (
          <button type="button" className="pc-icon" aria-label="Back" onClick={() => go(parentRoute(route))}>
            <ChevronLeft size={22} />
          </button>
        ) : (
          <button type="button" className="pc-icon" aria-label={`Connection: ${copy.title}`} onClick={() => go({ kind: "tab", tab: "settings" })}>
            <span className="pc-dot" data-tone={copy.tone} aria-hidden="true" />
          </button>
        )}
        <h1 ref={titleRef} tabIndex={-1} className="pc-title">
          {title}
        </h1>
        <span className="pc-pill" data-tone={copy.tone}>
          {STATUS_PILL[status]}
        </span>
      </header>
      <main className="pc-main" id="pc-main">
        {status !== "live" ? <Banner copy={copy} status={status} onTrust={() => store.trustHost()} /> : null}
        <Body route={route} view={view} />
      </main>
      <nav className="pc-tabs" aria-label="Phone navigation">
        {PHONE_TABS.map((item) => (
          <button
            key={item}
            type="button"
            className="pc-tab"
            aria-current={tab === item ? "page" : undefined}
            data-active={tab === item ? "true" : undefined}
            onClick={() => go({ kind: "tab", tab: item })}
          >
            {TAB_ICON[item]}
            <span>{PHONE_TAB_LABEL[item]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Body({ route, view }: { route: PhoneRoute; view: View }) {
  if (route.kind === "agent") return <AgentDetailView slot={route.slot} view={view} />;
  if (route.kind === "mission") return <MissionDetailView missionId={route.missionId} view={view} />;
  if (route.kind === "projects") return <ProjectsView view={view} />;
  if (route.tab === "chat") return <ChatView view={view} />;
  if (route.tab === "agents") return <AgentsView view={view} />;
  if (route.tab === "missions") return <MissionsView view={view} />;
  if (route.tab === "settings") return <SettingsView view={view} />;
  return <HomeView view={view} />;
}

function Banner({ copy, status, onTrust }: { copy: StatusCopy; status: PhoneStatus; onTrust: () => void }) {
  return (
    <section className="pc-banner" data-tone={copy.tone} data-status={status} role="status" aria-live="polite">
      <strong>{copy.title}</strong>
      {copy.detail ? <p>{copy.detail}</p> : null}
      {status === "host-changed" ? (
        <button type="button" className="pc-btn" onClick={onTrust}>
          Trust this Host
        </button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------------------------

function HomeView({ view }: { view: View }) {
  const { store, live, reduced, caps, companion, companionLevel, go } = view;
  const { drawn, attentionSlots, unassigned } = boundSlots(store.personalAgents?.slots ?? []);
  const voice = voiceEntry(store.viewer);
  // A consent ask waits on the Agent, not on the drawn character: turned-off slots count too (the Notch counts
  // every slot), so the Home card cannot under-report while a delegation offer waits on a hidden character.
  const attention = attentionSlots.reduce((sum, slot) => sum + slot.attention.pendingApprovals, 0);
  const label = COMPANION_LABEL[companion.state];
  return (
    <div className="pc-home">
      <section className="pc-hero" aria-label="Bunny A">
        <BunnyCompanion state={companion.state} size="hero" reduced={reduced} paused={!live} level={companionLevel} label={`Bunny A, ${label}`} />
        <p className="pc-hero-state" role="status">
          {label}
        </p>
        {voice.available && store.voiceSupported !== false ? (
          <button type="button" className="pc-primary" disabled={!live} onClick={() => void store.openVoice()}>
            <Mic size={18} aria-hidden="true" />
            {live ? voice.caption : "Reconnect to use voice"}
          </button>
        ) : (
          <p className="pc-note">
            <Smartphone size={16} aria-hidden="true" />
            {/* A workstation whose Host lacks voice is told so; "on your PC" would name the PC it is already on. */}
            {voice.available ? "Voice needs the updated Bunny Host." : voice.caption}
          </p>
        )}
      </section>

      <section className="pc-section" aria-labelledby="pc-slots-heading">
        <div className="pc-section-head">
          <h2 id="pc-slots-heading" className="pc-h2">
            Personal Agents
          </h2>
          <button type="button" className="pc-link" onClick={() => go({ kind: "tab", tab: "agents" })}>
            All Agents
          </button>
        </div>
        {drawn.length ? (
          <div className="pc-slot-row">
            {drawn.map((slot) => (
              <SlotTile key={slot.slot} slot={slot} view={view} />
            ))}
          </div>
        ) : store.personalAgents ? (
          <p className="pc-note">No Personal Agents are assigned yet. Assign them in the Personal Agent Studio on your PC.</p>
        ) : (
          <p className="pc-note">Personal Agents appear when the Host connects.</p>
        )}
        {drawn.length && unassigned > 0 ? (
          <p className="pc-tiny">
            {unassigned} {unassigned === 1 ? "slot is" : "slots are"} not assigned.
          </p>
        ) : null}
      </section>

      {attention > 0 ? (
        <section className="pc-card pc-attention" role="status">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>{pendingLabel(attention)}</strong>
            <p className="pc-tiny">{caps.answer ? "Review them in Missions. Some decisions stay on your PC." : "Approve on your PC."}</p>
          </div>
          {caps.answer ? (
            <button type="button" className="pc-btn" onClick={() => go({ kind: "tab", tab: "missions" })}>
              Review
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="pc-tiles" aria-label="Shortcuts">
        <button type="button" className="pc-tile" onClick={() => go({ kind: "tab", tab: "chat" })}>
          <MessageSquare size={20} aria-hidden="true" />
          <span>Chat</span>
        </button>
        <button type="button" className="pc-tile" onClick={() => go({ kind: "tab", tab: "missions" })}>
          <ListChecks size={20} aria-hidden="true" />
          <span>Missions</span>
        </button>
        <button type="button" className="pc-tile" onClick={() => go({ kind: "tab", tab: "agents" })}>
          <Users size={20} aria-hidden="true" />
          <span>Agents</span>
        </button>
        <button type="button" className="pc-tile" onClick={() => go({ kind: "projects", from: "home" })}>
          <Folder size={20} aria-hidden="true" />
          <span>Projects</span>
        </button>
      </section>
    </div>
  );
}

function SlotTile({ slot, view }: { slot: PersonalAgentView; view: View }) {
  const { live, reduced } = view;
  const state = displayState(slot.presentation.state, live);
  const label = characterLabel({
    weapon: slot.weapon,
    displayName: slot.displayName,
    state,
    basis: live ? slot.presentation.basis : null,
    note: live ? null : "Host connection not live",
  });
  return (
    <button type="button" className="pc-slot" aria-label={label} onClick={() => view.go(agentRoute(slot.slot, "home"))}>
      <WeaponCharacter key={slot.agentId ?? "unassigned"} weapon={slot.weapon} state={state} slot={slot.slot} size="compact" celebrate reduced={reduced} paused={!live} label={label} appearance={appearanceFor(view.store.characterAppearance, slot.slot)} />
      <span className="pc-slot-name">{slot.displayName}</span>
      <span className="pc-slot-state">{live ? slot.presentation.label : `Last known: ${slot.presentation.label}`}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------------------------------

function AgentsView({ view }: { view: View }) {
  const { store, live, go } = view;
  const slots = [...(store.personalAgents?.slots ?? [])].sort((a, b) => a.slot - b.slot);
  const slotted = new Set(slots.flatMap((slot) => (slot.agent ? [slot.agent.id] : [])));
  const others = otherAgentRows(store.agents, slotted);
  return (
    <div className="pc-stack">
      <section className="pc-section">
        <h2 className="pc-h2">Personal Agents</h2>
        {!store.personalAgents ? <p className="pc-note">Personal Agents appear when the Host connects.</p> : null}
        {slots.length ? (
          <ul className="pc-list">
            {slots.map((slot) =>
              slot.agentId && !slot.active ? (
                <li key={slot.slot}>
                  <button type="button" className="pc-row pc-row-static" onClick={() => go(agentRoute(slot.slot, "agents"))}>
                    <span className="pc-slot-empty">Slot {slot.slot}</span>
                    <span className="pc-row-main">
                      <strong>{WEAPON_LABEL[slot.weapon]}</strong>
                      <small>Turned off. Turn it on in the Personal Agent Studio on your PC.</small>
                    </span>
                  </button>
                </li>
              ) : slot.agentId ? (
                <li key={slot.slot}>
                  <button type="button" className="pc-row" onClick={() => go(agentRoute(slot.slot, "agents"))}>
                    <SlotCharacter slot={slot} view={view} />
                    <span className="pc-row-main">
                      <strong>{slot.displayName}</strong>
                      <small>
                        {WEAPON_LABEL[slot.weapon]} · {live ? slot.presentation.label : `Last known: ${slot.presentation.label}`}
                      </small>
                      <small>{stepProgressText(slot.progress)}</small>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ) : (
                <li key={slot.slot} className="pc-row pc-row-static">
                  <span className="pc-slot-empty">Slot {slot.slot}</span>
                  <span className="pc-row-main">
                    <strong>{WEAPON_LABEL[slot.weapon]}</strong>
                    <small>Not assigned. Assign an Agent in the Personal Agent Studio on your PC.</small>
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </section>
      <section className="pc-section">
        <h2 className="pc-h2">Other Agents</h2>
        {others.length ? (
          <ul className="pc-list">
            {others.map((agent) => (
              <li key={agent.id} className="pc-row pc-row-static">
                <span className="pc-row-main">
                  <strong>{agent.name}</strong>
                  <small>{live ? agent.stateLabel : `Last known: ${agent.stateLabel}`}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pc-note">No other Agents.</p>
        )}
      </section>
    </div>
  );
}

function SlotCharacter({ slot, view }: { slot: PersonalAgentView; view: View }) {
  const state = displayState(slot.presentation.state, view.live);
  const label = characterLabel({ weapon: slot.weapon, displayName: slot.displayName, state, basis: view.live ? slot.presentation.basis : null, note: view.live ? null : "Host connection not live" });
  return <WeaponCharacter weapon={slot.weapon} state={state} slot={slot.slot} size="compact" reduced={view.reduced} paused={!view.live} label={label} appearance={appearanceFor(view.store.characterAppearance, slot.slot)} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Agent detail
// ---------------------------------------------------------------------------------------------------------------

/**
 * A Stop confirmation swaps its buttons in and out. Focus follows the user's choice (to Keep running when it opens, back to
 * Stop when it is kept), so keyboard focus is never lost to the page.
 */
function useStopConfirmFocus(confirming: boolean) {
  const keepRunning = useRef<HTMLButtonElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  const next = useRef<"keep" | "stop" | null>(null);
  useEffect(() => {
    const target = next.current;
    next.current = null;
    if (target === "keep") keepRunning.current?.focus();
    if (target === "stop") stop.current?.focus();
  }, [confirming]);
  return { keepRunning, stop, next };
}

function AgentDetailView({ slot, view }: { slot: SlotId; view: View }) {
  const { store, live, reduced, caps, go } = view;
  const [details, setDetails] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const stopFocus = useStopConfirmFocus(confirmStop);
  const row = store.personalAgents?.slots.find((candidate) => candidate.slot === slot) ?? null;
  if (!row) return <EmptyCard text="This slot is not part of your Personal Agents." onBack={() => go({ kind: "tab", tab: "agents" })} />;
  if (!row.agent) {
    return (
      <EmptyCard
        text={
          row.agentId
            ? "The bound Agent's detail is not available on this device. Its history may be trimmed on the phone; the slot keeps its state on the Notch."
            : "Not assigned. Assign an Agent to this slot in the Personal Agent Studio on your PC."
        }
        onBack={() => go({ kind: "tab", tab: "agents" })}
      />
    );
  }
  const agent = row.agent;
  const state = displayState(row.presentation.state, live);
  const label = characterLabel({ weapon: row.weapon, displayName: row.displayName, state, basis: live ? row.presentation.basis : null, note: live ? null : "Host connection not live" });
  const mission = store.missions?.missions.find((candidate) => candidate.id === agent.missionId) ?? null;
  const technical = row.technical;
  const task = technical?.taskId ? store.tasks.find((candidate) => candidate.id === technical.taskId) ?? null : null;
  const project = agent.projectId ? store.projects.find((candidate) => candidate.id === agent.projectId) ?? null : null;
  const requests = (mission?.requests ?? []).filter((request) => request.resolvedAt === null);
  const common = { viewer: store.viewer, targetId: agent.id, canAct: store.canAct(), pending: store.pending, uncertain: store.uncertain };
  const pause = agentActionAvailability({ ...common, action: "pause", state: agent.state });
  const resume = agentActionAvailability({ ...common, action: "resume", state: agent.state });
  const stop = agentActionAvailability({ ...common, action: "stop", state: agent.state });
  const caption = [pause, resume, stop].find((action) => action.visible && action.caption)?.caption ?? null;
  const modelLine = technicalLine(technical);
  const pending = row.attention.pendingApprovals;
  const agentRow = store.agents?.agents.find((candidate) => candidate.id === agent.id) ?? null;
  const offer = agentRow?.authorization?.state === "WAITING_FOR_USER" ? agentRow.authorization : null;
  const offerDecision = offer ? offerVerdict(offer, store.viewer) : null;
  const basisLine = !live
    ? "Host connection not live. Animations are stopped."
    : row.presentation.state === "WAITING_FOR_USER"
      ? "The Host is waiting for your decision."
      : basisText(row.presentation.basis);
  const elsewhere = Math.max(0, pending - requests.length);
  return (
    <div className="pc-stack">
      <section className="pc-hero-well" aria-label={`${row.displayName}`}>
        <WeaponCharacter weapon={row.weapon} state={state} slot={row.slot} size="hero" reduced={reduced} paused={!live} label={label} appearance={appearanceFor(store.characterAppearance, row.slot)} />
      </section>
      <section className="pc-card">
        <h2 className="pc-name">{row.displayName}</h2>
        <p className="pc-muted">
          {WEAPON_LABEL[row.weapon]}
          {agent.name !== row.displayName ? ` · ${agent.name}` : ""}
        </p>
        <p className="pc-state" data-state={row.presentation.state}>
          {live ? row.presentation.label : `Last known: ${row.presentation.label}`}
        </p>
        <p className="pc-basis">{basisLine}</p>
        {modelLine ? <p className="pc-tiny">Model for current task · {modelLine}</p> : null}
      </section>
      <section className="pc-actions" role="group" aria-label="Agent controls">
        {pause.visible ? (
          <button type="button" className="pc-btn" disabled={!pause.enabled} onClick={() => void store.pauseAgent(agent.id)}>
            <Pause size={16} aria-hidden="true" />
            Pause
          </button>
        ) : null}
        {resume.visible ? (
          <button type="button" className="pc-btn" disabled={!resume.enabled} onClick={() => void store.resumeAgent(agent.id)}>
            <Play size={16} aria-hidden="true" />
            Resume
          </button>
        ) : null}
        {stop.visible && confirmStop ? (
          <>
            <button
              type="button"
              className="pc-btn danger"
              disabled={!stop.enabled}
              onClick={() => {
                // Confirm re-swaps the buttons back to Stop; hand focus back to it or the page swallows it.
                stopFocus.next.current = "stop";
                setConfirmStop(false);
                void store.stopAgent(agent.id);
              }}
            >
              Confirm stop
            </button>
            <button
              ref={stopFocus.keepRunning}
              type="button"
              className="pc-btn"
              onClick={() => {
                stopFocus.next.current = "stop";
                setConfirmStop(false);
              }}
            >
              Keep running
            </button>
          </>
        ) : null}
        {stop.visible && !confirmStop ? (
          <button
            ref={stopFocus.stop}
            type="button"
            className="pc-btn danger"
            disabled={!stop.enabled}
            onClick={() => {
              stopFocus.next.current = "keep";
              setConfirmStop(true);
            }}
          >
            <Square size={16} aria-hidden="true" fill="currentColor" />
            Stop
          </button>
        ) : null}
        <button type="button" className="pc-btn" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
          <Info size={16} aria-hidden="true" />
          Details
        </button>
      </section>
      {offer && offerDecision ? (
        <section className="pc-card" aria-label="Delegation">
          <h3 className="pc-h3">Delegation waiting for your approval</h3>
          {caps.delegate && offerDecision.allowed ? (
            <div className="pc-actions">
              <button
                type="button"
                className="pc-btn primary"
                disabled={caption !== null}
                onClick={() => void store.agentAuthorization(agent.id, "approve", offer.revision)}
              >
                <Check size={16} aria-hidden="true" />
                Approve delegation
              </button>
            </div>
          ) : (
            <p className="pc-note">{offerDecision.caption ?? "Approve on your PC"}</p>
          )}
        </section>
      ) : null}
      {confirmStop ? <p className="pc-note">The Host confirms the stop. Nothing is marked stopped until it does.</p> : null}
      {caption ? <p className="pc-note">{caption}</p> : null}
      {!caps.supervise ? <p className="pc-note">Pause, resume and stop for this Agent are on your PC.</p> : null}
      {pending > 0 ? (
        <section className="pc-card" aria-label="Approvals">
          <h3 className="pc-h3">{pendingLabel(pending)}</h3>
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} view={view} />
          ))}
          {elsewhere > 0 ? (
            <p className="pc-note">
              {elsewhere === 1 ? "1 decision is" : `${elsewhere} decisions are`} waiting on your PC.
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="pc-card" aria-label="Progress">
        <h3 className="pc-h3">Progress</h3>
        <StepBar progress={row.progress} />
        <p className="pc-line">{stepProgressText(row.progress)}</p>
      </section>
      <section className="pc-card">
        <dl className="pc-facts">
          <div>
            <dt>Mission</dt>
            <dd>{agent.missionTitle ?? "No Mission"}</dd>
          </div>
          <div>
            <dt>Current task</dt>
            <dd>{task ? task.title : technical ? "Running" : "None running"}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{project ? project.name : agent.projectId ? "Not in the Host view" : "No project"}</dd>
          </div>
          {agent.objective ? (
            <div>
              <dt>Objective</dt>
              <dd>{agent.objective}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      {details ? (
        <section className="pc-card" aria-label="Details">
          <dl className="pc-facts">
            <div>
              <dt>Agent state</dt>
              <dd>{AGENT_STATE_TEXT[agent.state]}</dd>
            </div>
            <div>
              <dt>Basis</dt>
              <dd>{basisText(row.presentation.basis)}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{shortId(agent.id)}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function RequestRow({ request, view }: { request: PermissionRequest; view: View }) {
  const { store, caps } = view;
  const verdict = allowVerdict({ remote: request.remote }, store.viewer);
  // The in-flight and unconfirmed state is held per Agent or Mission, not per ask, so the caption reads that key.
  const target = requestTargetId(request.id, store.agents?.agents ?? [], store.missions?.missions ?? []);
  const caption = controlCaption({ canAct: store.canAct(), targetId: target, pending: store.pending, uncertain: store.uncertain });
  const answerable = caps.answer && verdict.allowed;
  return (
    <div className="pc-request">
      <p>
        <strong>{request.reason}</strong>
      </p>
      <p className="pc-tiny">Host action: {request.action}</p>
      {answerable ? (
        <div className="pc-actions">
          <button type="button" className="pc-btn primary" disabled={caption !== null} onClick={() => void store.respondRequest(request.id, "allow_once")}>
            Allow once
          </button>
          <button type="button" className="pc-btn" disabled={caption !== null} onClick={() => void store.respondRequest(request.id, "deny")}>
            Deny
          </button>
        </div>
      ) : (
        <p className="pc-note">{verdict.allowed ? "Approve on your PC" : (verdict.caption ?? "Approve on your PC")}</p>
      )}
      {caption ? <p className="pc-note">{caption}</p> : null}
    </div>
  );
}

function StepBar({ progress }: { progress: StepCounts | null }) {
  const seg = stepSegments(progress);
  const cells: ReactNode[] = [];
  for (let i = 0; i < seg.verified; i++) cells.push(<i key={`v${i}`} data-seg="verified" />);
  for (let i = 0; i < seg.done; i++) cells.push(<i key={`d${i}`} data-seg="done" />);
  for (let i = 0; i < seg.pending; i++) cells.push(<i key={`p${i}`} data-seg="pending" />);
  return (
    <div className="pc-steps" aria-hidden="true">
      {cells}
    </div>
  );
}

function EmptyCard({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <section className="pc-card">
      <p>{text}</p>
      <button type="button" className="pc-btn" onClick={onBack}>
        Back to Agents
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------------------------------------------

function MissionsView({ view }: { view: View }) {
  const { store, go } = view;
  const rows = missionRows(store.missions?.missions ?? []);
  return (
    <section className="pc-section">
      <h2 className="pc-h2">Missions</h2>
      {!store.missions ? (
        <p className="pc-note">Missions appear when the Host connects.</p>
      ) : store.missions.enabled === false ? (
        <p className="pc-note">Missions are turned off on your PC.</p>
      ) : rows.length === 0 ? (
        <p className="pc-note">No Missions yet. Start one from Chat or on your PC.</p>
      ) : (
        <ul className="pc-list">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="pc-row" onClick={() => go(missionRoute(row.id, "missions"))}>
                <span className="pc-row-main">
                  <strong>{row.title}</strong>
                  <small>{row.progress}</small>
                  <span className="pc-tags">
                    <span className="pc-pill" data-live={row.live ? "true" : undefined}>
                      {row.label}
                    </span>
                    {row.openRequests > 0 ? (
                      <span className="pc-pill" data-tone="warn">
                        {row.openRequests} open
                      </span>
                    ) : null}
                  </span>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MissionDetailView({ missionId, view }: { missionId: string; view: View }) {
  const { store, caps, go } = view;
  const [confirmStop, setConfirmStop] = useState(false);
  const stopFocus = useStopConfirmFocus(confirmStop);
  const mission = store.missions?.missions.find((candidate) => candidate.id === missionId) ?? null;
  if (!mission) return <EmptyCard text="This Mission is not in the Host's current view." onBack={() => go({ kind: "tab", tab: "missions" })} />;
  const row = missionRows([mission])[0];
  const artifacts = verifiedArtifactRows(mission);
  const plan = missionApproveVerdict(mission, store.viewer);
  const common = { canAct: store.canAct(), targetId: mission.id, pending: store.pending, uncertain: store.uncertain };
  const planCaption = controlCaption(common);
  const requests = mission.requests.filter((request) => request.resolvedAt === null);
  const stopVisible = caps.missionStop && LIVE_MISSION.includes(mission.state);
  const counts: StepCounts = {
    completed: mission.progress.completed,
    total: mission.progress.total,
    verified: mission.steps.filter((step) => step.result?.verified === true).length,
  };
  return (
    <div className="pc-stack">
      <section className="pc-card">
        <h2 className="pc-name">{mission.title}</h2>
        <span className="pc-pill" data-live={LIVE_MISSION.includes(mission.state) ? "true" : undefined}>
          {row.label}
        </span>
        {mission.objective ? <p className="pc-muted">{mission.objective}</p> : null}
        <StepBar progress={counts} />
        <p className="pc-line">{row.progress}</p>
        {mission.result ? (
          <p className="pc-tiny">
            Host result: {mission.result.verifiedSteps} verified · {mission.result.unverifiedSteps} unverified
          </p>
        ) : null}
      </section>
      {mission.state === "waiting_for_approval" ? (
        <section className="pc-card" aria-label="Plan approval">
          <h3 className="pc-h3">Plan waiting for approval</h3>
          {caps.approve && plan.allowed ? (
            <button type="button" className="pc-btn primary" disabled={planCaption !== null} onClick={() => void store.approveMission(mission.id)}>
              <Check size={16} aria-hidden="true" />
              Approve plan
            </button>
          ) : (
            <p className="pc-note">{plan.allowed ? "Approve on your PC" : (plan.caption ?? "Approve on your PC")}</p>
          )}
          {planCaption ? <p className="pc-note">{planCaption}</p> : null}
        </section>
      ) : null}
      {requests.length ? (
        <section className="pc-card" aria-label="Asks waiting for you">
          <h3 className="pc-h3">Asks waiting for you</h3>
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} view={view} />
          ))}
        </section>
      ) : null}
      <section className="pc-card" aria-label="Verified results">
        <h3 className="pc-h3">Verified results</h3>
        {artifacts.length ? (
          <ul className="pc-bullets">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                {artifact.title} <span className="pc-tiny">{artifact.type}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pc-note">No verified results yet.</p>
        )}
        {row.unverifiedArtifacts > 0 ? (
          <p className="pc-tiny">
            {row.unverifiedArtifacts} unverified {row.unverifiedArtifacts === 1 ? "item is" : "items are"} not shown as results.
          </p>
        ) : null}
      </section>
      {stopVisible ? (
        <section className="pc-actions" role="group" aria-label="Mission controls">
          {confirmStop ? (
            <>
              <button
                type="button"
                className="pc-btn danger"
                disabled={planCaption !== null}
                onClick={() => {
                  setConfirmStop(false);
                  void store.stopMission(mission.id);
                }}
              >
                Confirm stop
              </button>
              <button
                ref={stopFocus.keepRunning}
                type="button"
                className="pc-btn"
                onClick={() => {
                  stopFocus.next.current = "stop";
                  setConfirmStop(false);
                }}
              >
                Keep running
              </button>
            </>
          ) : (
            <button
              ref={stopFocus.stop}
              type="button"
              className="pc-btn danger"
              disabled={planCaption !== null}
              onClick={() => {
                stopFocus.next.current = "keep";
                setConfirmStop(true);
              }}
            >
              <Square size={16} aria-hidden="true" fill="currentColor" />
              Stop Mission
            </button>
          )}
        </section>
      ) : null}
      {planCaption && stopVisible ? <p className="pc-note">{planCaption}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------------------------

function ChatView({ view }: { view: View }) {
  const { store, caps } = view;
  const ready = canSend({ prompt: store.prompt, submitting: store.submitting, canAct: store.canAct(), viewer: store.viewer });
  const tasks = recentTaskRows(store.tasks, 8);
  return (
    <div className="pc-stack">
      <form
        className="pc-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          store.setComposeKind("task");
          store.submit();
        }}
      >
        <label className="pc-label" htmlFor="pc-prompt">
          Ask Bunny
        </label>
        {caps.chat ? (
          <>
            <textarea
              id="pc-prompt"
              className="pc-input"
              rows={3}
              maxLength={16000}
              placeholder="What would you like to do?"
              value={store.prompt}
              onChange={(event) => store.setPrompt(event.target.value)}
            />
            <div className="pc-actions">
              <button type="submit" className="pc-btn primary" disabled={!ready}>
                <Send size={16} aria-hidden="true" />
                {store.submitting ? "Sending…" : "Send"}
              </button>
            </div>
            {store.submitting ? <p className="pc-note">Waiting for the Host to accept it. Your words stay here until it does.</p> : null}
            {!store.canAct() ? <p className="pc-note">Reconnect to the Host to send.</p> : null}
          </>
        ) : (
          <p className="pc-note">Chat is not available from this device.</p>
        )}
      </form>
      <section className="pc-section">
        <h2 className="pc-h2">Recent tasks</h2>
        {tasks.length ? (
          <ul className="pc-list">
            {tasks.map((task) => (
              <li key={task.id} className="pc-row pc-row-static">
                <span className="pc-row-main">
                  <strong>{task.title}</strong>
                  <small>{task.stateLabel}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pc-note">No tasks yet.</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Settings and projects
// ---------------------------------------------------------------------------------------------------------------

function SettingsView({ view }: { view: View }) {
  const { store, caps, copy } = view;
  const [confirmOut, setConfirmOut] = useState(false);
  const lines = rightsSummary(store.viewer);
  const { appearance } = store;
  return (
    <div className="pc-stack">
      <section className="pc-card" aria-label="Connection">
        <h2 className="pc-h3">Connection</h2>
        <p className="pc-line" data-tone={copy.tone}>
          {copy.title}
        </p>
        {copy.detail ? <p className="pc-muted">{copy.detail}</p> : null}
        <dl className="pc-facts">
          <div>
            <dt>Connection</dt>
            <dd>{CONNECTION_LABEL[store.connection.state]}</dd>
          </div>
          <div>
            <dt>Host</dt>
            <dd>{store.hostIdentity ? shortId(store.hostIdentity.hostId) : "Not known yet"}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{sessionLine(store.viewer)}</dd>
          </div>
        </dl>
        {lines.length ? (
          <ul className="pc-bullets">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="pc-card" aria-label="Appearance">
        <h2 className="pc-h3">AI accounts</h2>
        <p className="pc-muted">Sign-in and provider permissions are managed on your Windows PC.</p>
        {store.deviceConnections.map(row=><p className="pc-line" key={`${row.catalog}:${row.mode}`}><strong>{row.name}</strong> · {row.status.replaceAll("_"," ")} · {row.billing.replaceAll("_"," ")}</p>)}
        <button type="button" className="btn" disabled={!store.canAct()} onClick={()=>void store.connectionCommand("connections.review_request",{})}>Request owner review</button>
      </section>
      <section className="pc-card" aria-label="Appearance">
        <h2 className="pc-h3">Appearance</h2>
        <PhoneThemeChoice />
        <p className="pc-label">Motion</p>
        <div className="pc-segment" role="group" aria-label="Motion">
          {(["full", "reduced"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === "reduced" ? appearance.motion !== "full" : appearance.motion === "full"}
              onClick={() => store.setAppearance({ motion: option })}
            >
              {option === "full" ? "Full" : "Reduced"}
            </button>
          ))}
        </div>
      </section>
      {caps.signOut ? (
        <section className="pc-card" aria-label="This device">
          <h2 className="pc-h3">This device</h2>
          <p className="pc-muted">Signing out removes this device's access. Pair again with a new code from your PC.</p>
          {confirmOut ? (
            <div className="pc-actions">
              <button type="button" className="pc-btn danger" onClick={() => void store.signOutDevice()}>
                Sign out now
              </button>
              <button type="button" className="pc-btn" onClick={() => setConfirmOut(false)}>
                Stay signed in
              </button>
            </div>
          ) : (
            <button type="button" className="pc-btn danger" onClick={() => setConfirmOut(true)}>
              Sign out
            </button>
          )}
        </section>
      ) : null}
      {caps.workstation ? <p className="pc-note">Personal Agents, voice and the Studio are managed on this PC.</p> : null}
    </div>
  );
}

function ProjectsView({ view }: { view: View }) {
  const { store } = view;
  return (
    <section className="pc-section">
      <h2 className="pc-h2">Projects</h2>
      {store.projects.length ? (
        <ul className="pc-list">
          {store.projects.map((project) => (
            <li key={project.id} className="pc-row pc-row-static">
              <span className="pc-row-main">
                <strong>{project.name}</strong>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pc-note">No projects yet. Add one on your PC.</p>
      )}
      <p className="pc-tiny">Projects are managed on your PC.</p>
    </section>
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

/**
 * The phone's look. A paired device keeps its own choice on the device (or follows the workstation); the workstation's own
 * companion window saves to the Host like the desktop gallery. Neither path can change what this device may do.
 */
function PhoneThemeChoice() {
  const store = useIsland();
  const { preference, origin } = useShownTheme();
  const device = store.viewer?.kind === "device";
  const [refusal, setRefusal] = useState<string | null>(null);
  const theme = UI_THEMES[preference.theme];
  const set = (patch: Partial<UiThemePreference>) => {
    setRefusal(null);
    void store.setUiTheme(patch, setRefusal);
  };
  return (
    <>
      <label className="pc-label" htmlFor="pc-theme">
        Theme
      </label>
      <select id="pc-theme" className="pc-input" value={preference.theme} onChange={(event) => set({ theme: event.target.value as UiThemeId })}>
        {UI_THEME_IDS.map((id) => (
          <option key={id} value={id}>
            {UI_THEMES[id].name}
          </option>
        ))}
      </select>
      <p className="pc-muted">
        {device
          ? origin === "device"
            ? "Kept on this phone only."
            : "Following your PC's theme."
          : "Saved on your Host for every window and the Notch."}
      </p>
      <p className="pc-label">Appearance</p>
      <div className="pc-segment" role="radiogroup" aria-label="Appearance">
        {(["system", "light", "dark"] as const).map((option) => {
          const available = option === "system" || theme.variants.includes(option);
          return (
            <button key={option} type="button" role="radio" aria-checked={preference.variant === option} disabled={!available} onClick={() => set({ variant: option })}>
              {option === "system" ? "System" : option === "dark" ? "Dark" : "Light"}
            </button>
          );
        })}
      </div>
      {device && store.deviceTheme ? (
        <button type="button" className="pc-btn" onClick={() => store.followWorkstationTheme()}>
          Follow my PC's theme
        </button>
      ) : null}
      {refusal ? (
        <p className="pc-muted" role="alert">
          {refusal}
        </p>
      ) : null}
    </>
  );
}

