import { useEffect, useState } from "react";
import { liveProviders, useIsland } from "@/store/use-island";
import { NAMES, Empty } from "./ui";
import { TaskRow } from "./desktop";
import { Studio } from "./studio";
import { TeamsSection } from "./agent";
import { teamPanels } from "./team-model";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { appearanceFor, isWorking } from "./character-style-model";
import { displayState, hostLive } from "./character-model";
import { CharacterAppearancePanel } from "./character-appearance";
import { studioMode } from "./studio-model";
import { voiceListening } from "./voice-model";
import { approvalCount, pendingApprovalItems } from "./approvals-model";
import { elapsed } from "./ui-model";
import { WidgetSurface, type WidgetOpeners } from "./widgets";
import type { SlotId } from "@/lib/bunny-host/personal-agents";
import {
  islandPresence,
  onboardingRecord,
  ONBOARDING_STEPS,
  providerSetupLine,
  type OnboardingRecord,
} from "./journey-model";

const ONBOARDING_KEY = "bunny-a.onboarding.v1";

function readOnboarding(): OnboardingRecord {
  try {
    return onboardingRecord(JSON.parse(localStorage.getItem(ONBOARDING_KEY) || "null"));
  } catch {
    return { status: "active", step: 0 };
  }
}

function writeOnboarding(record: OnboardingRecord) {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(record));
  } catch {
    /* Private mode can refuse storage. The flow still works for this visit. */
  }
}

/** Compact Island status for the workspace top bar. Every word comes from islandPresence. */
export function IslandStatus({ now }: { now: number }) {
  const store = useIsland();
  const live = hostLive(store.connection, now || Date.now());
  const slots = store.personalAgents?.slots ?? [];
  const working = live ? slots.filter((slot) => isWorking(slot.presentation.state) && slot.presentation.state !== "PLANNING") : [];
  const planning = live ? slots.filter((slot) => slot.presentation.state === "PLANNING") : [];
  const active = store.tasks.filter((task) => ["running", "routing", "launching", "verifying"].includes(task.state));
  const focused = active[0] ?? store.tasks.find((task) => task.id === store.decisionTaskId) ?? null;
  const taskState = !focused
    ? "idle"
    : focused.state === "waiting_for_approval" || focused.state === "waiting_for_agent_approval"
      ? "approval"
      : focused.state === "completed"
        ? "completed"
        : focused.state === "failed"
          ? "failed"
          : focused.state === "paused"
            ? "paused"
            : focused.state === "routing"
        ? "routing"
        : focused.state === "running" || focused.state === "verifying" || focused.state === "launching"
              ? "running"
              : "idle";
  const elapsedLabel = focused ? elapsed(focused, now || Date.now()) : "—";
  const viewer = store.viewer?.kind === "device" ? "device" : "workstation";
  const approvals = approvalCount(
    pendingApprovalItems({
      tasks: store.tasks,
      missions: store.missions?.missions ?? [],
      agents: store.agents?.agents ?? [],
      viewer,
    }),
  );
  const disconnectTitle =
    store.connection.state === "pairing"
      ? "Pairing required"
      : store.connection.state === "host-changed"
        ? "Different Host"
        : store.connection.state === "reconnecting" || store.connection.state === "connecting"
          ? "Reconnecting"
          : "Offline";
  const presence = islandPresence({
    live,
    disconnectTitle,
    voiceListening: voiceListening(store.voice, store.voiceReceivedAt, now || Date.now()),
    pendingApprovals: approvals,
    workingAgents: working.length,
    planningAgents: planning.length,
    events: store.events.map((event) => ({
      type: event.type,
      at: event.at,
      sequence: event.sequence,
      detail: event.detail,
    })),
    agentName: working[0]?.displayName ?? planning[0]?.displayName ?? null,
    taskName: focused?.title ?? null,
    taskState,
    elapsed: elapsedLabel === "—" ? null : elapsedLabel,
  });
  return (
    <p className="island-status" role="status" data-island={presence.state}>
      <strong>{presence.title}</strong>
      <span>{presence.detail}</span>
    </p>
  );
}

/** First-run guide. Skip and resume are stored on this device. Steps never start work. */
export function Onboarding({ onOpenDevices }: { onOpenDevices: () => void }) {
  const store = useIsland();
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  useEffect(() => {
    setRecord(readOnboarding());
  }, []);
  if (!record || record.status !== "active") return null;
  const step = ONBOARDING_STEPS[record.step] ?? ONBOARDING_STEPS[0];
  const providers = liveProviders(store)
    .filter((row) => !row.extension || row.installed)
    .map((row) => ({ name: NAMES[row.id] ?? row.id, availability: row.availability }));
  const save = (next: OnboardingRecord) => {
    setRecord(next);
    writeOnboarding(next);
  };
  const go = (stepIndex: number) => save({ status: "active", step: stepIndex });
  return (
    <section className="onboarding t8-surface" aria-labelledby="onboarding-title">
      <p className="eyebrow">
        Setup {record.step + 1} of {ONBOARDING_STEPS.length}
      </p>
      <h2 id="onboarding-title">{step.title}</h2>
      <p>{step.body}</p>
      {step.id === "providers" ? <p className="caption">{providerSetupLine(providers)}</p> : null}
      {step.id === "execution" && store.hostIdentity ? (
        <p className="caption">This window is talking to Host {store.hostIdentity.hostId.slice(0, 8)}.</p>
      ) : null}
      <div className="onboarding-actions">
        {record.step > 0 ? (
          <button type="button" className="btn secondary" onClick={() => go(record.step - 1)}>
            Back
          </button>
        ) : null}
        {record.step < ONBOARDING_STEPS.length - 1 ? (
          <button type="button" className="btn primary" onClick={() => go(record.step + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => save({ status: "done", step: record.step })}>
            Finish
          </button>
        )}
        {step.id === "first-task" ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              store.setSheet("chat");
              document.getElementById("task-prompt")?.focus();
            }}
          >
            Write a task
          </button>
        ) : null}
        {step.id === "phone" ? (
          <button type="button" className="btn secondary" onClick={onOpenDevices}>
            Open pairing
          </button>
        ) : null}
        <button type="button" className="btn quiet" onClick={() => save({ status: "skipped", step: record.step })}>
          Skip
        </button>
      </div>
    </section>
  );
}

export function TasksHome({ now }: { now: number }) {
  const store = useIsland();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">What Bunny is doing</p>
          <h1>Tasks</h1>
          <p>Requests this Host has accepted. Open one to see its result, or the full history for every event.</p>
        </div>
        <button type="button" className="btn secondary" onClick={() => store.setSheet("activity")}>
          Execution history
        </button>
      </div>
      <div className="task-list t8-surface">
        {store.tasks.slice(0, 40).map((task) => (
          <TaskRow key={task.id} task={task} now={now} />
        ))}
        {!store.tasks.length && (
          <Empty title="No tasks yet." detail="Describe one on Home. Bunny shows the recommendation before it runs." />
        )}
      </div>
    </>
  );
}

export function AgentsHome({ now }: { now: number }) {
  const store = useIsland();
  const reduced = usePrefersReducedMotion() || store.appearance.motion !== "full";
  const live = hostLive(store.connection, now || Date.now());
  const slots = store.personalAgents?.slots ?? [];
  const assigned = slots.filter((slot) => slot.agentId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your four companions</p>
          <h1>Agents</h1>
          <p>Each slot shows the state the Host last reported. Names and looks do not change what an Agent may do.</p>
        </div>
        <button type="button" className="btn secondary" onClick={() => store.setSheet("studio")}>
          Open Studio
        </button>
      </div>
      {!store.personalAgents ? (
        <Empty title="Agents are unavailable." detail="Personal Agents appear when the Host connects. Nothing here is a sample agent." />
      ) : (
        <div className="ch-agent-grid">
          {slots.map((slot) => (
            <button
              key={slot.slot}
              type="button"
              className="t8-surface ch-agent"
              onClick={() => store.setSheet("studio")}
            >
              <WeaponCharacter
                weapon={slot.weapon}
                state={displayState(slot.presentation.state, live)}
                size="compact"
                reduced={reduced}
                displayName={slot.displayName}
                appearance={appearanceFor(store.characterAppearance, slot.slot)}
              />
              <span className="ch-copy">
                <strong>{slot.displayName}</strong>
                <small>{live ? slot.presentation.label : `Last known: ${slot.presentation.label}`}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {store.personalAgents && !assigned.length ? (
        <Empty title="No agents assigned." detail="Open Studio on this PC to bind an Agent you already have. A phone cannot create one." />
      ) : null}
    </>
  );
}

export function TeamsHome() {
  const store = useIsland();
  const teams = teamPanels(store.agents, store.missions?.missions ?? []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Coordinated work</p>
          <h1>Agentic teams</h1>
          <p>Teams the Host has actually formed. Internal members stay listed as roles, not as weapon characters.</p>
        </div>
      </div>
      {teams.length ? <TeamsSection teams={teams} /> : <Empty title="No agent teams." detail="A team appears when a Mission has a coordinator and a team view from the Host." />}
    </>
  );
}

export function CharactersHome({ now }: { now: number }) {
  const store = useIsland();
  const slots = store.personalAgents?.slots ?? [];
  const [slotId, setSlotId] = useState<SlotId>(slots[0]?.slot ?? 1);
  const slot = slots.find((row) => row.slot === slotId) ?? slots[0];
  const reduced = usePrefersReducedMotion() || store.appearance.motion !== "full";
  const mode = studioMode(store.viewer?.kind === "device" ? "device" : store.viewer?.kind === "workstation" ? "workstation" : null);
  const editable = store.viewer?.kind === "workstation" && hostLive(store.connection, now || Date.now());
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Visual identity</p>
          <h1>Characters</h1>
          <p>{mode.caption}</p>
        </div>
      </div>
      {!slot ? (
        <Empty title="No characters to show." detail="Character looks attach to Personal Agent slots. They appear when the Host sends those slots." />
      ) : (
        <>
          <div className="ch-chips" role="group" aria-label="Character slots">
            {slots.map((row) => (
              <button key={row.slot} type="button" className="ch-chip" aria-pressed={row.slot === slot.slot} onClick={() => setSlotId(row.slot)}>
                {row.displayName}
              </button>
            ))}
          </div>
          <CharacterAppearancePanel
            slot={slot.slot}
            weapon={slot.weapon}
            displayName={slot.displayName}
            editable={editable && mode.editable}
            reduced={reduced}
          />
        </>
      )}
    </>
  );
}

export function StudioHome() {
  return <Studio />;
}

export function WidgetsPage({ openers }: { openers: WidgetOpeners }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">At a glance</p>
          <h1>Widgets</h1>
          <p>Cards show Host facts only. Apply saves the layout on the Host. Unapplied edits stay on this page.</p>
        </div>
      </div>
      <WidgetSurface mode="board" page="settings" openers={openers} />
    </>
  );
}
