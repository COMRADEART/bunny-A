import { useEffect, useState } from "react";
import { liveProviders, useIsland } from "@/store/use-island";
import { NAMES, Empty } from "./ui";
import { TaskRow } from "./desktop";
import { PersistentTasks } from "./ptasks";
import { Proactive } from "./proactive";
import { Studio } from "./studio";
import { TeamsSection } from "./agent";
import { teamPanels } from "./team-model";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { appearanceFor, isWorking } from "./character-style-model";
import { displayState, hostLive } from "./character-model";
import { CharacterAppearancePanel } from "./character-appearance";
import { studioMode } from "./studio-model";
import { notchVoicePhase, voiceListening } from "./voice-model";
import { approvalCount, pendingApprovalItems } from "./approvals-model";
import { elapsed } from "./ui-model";
import { WidgetSurface, type WidgetOpeners } from "./widgets";
import type { SlotId } from "@/lib/bunny-host/personal-agents";
import { islandPresence, providerSetupLine } from "./journey-model";
import {
  evaluateLocalModelReadiness,
  GUIDED_ONBOARDING_STAGE_IDS,
  migrateLegacyOnboarding,
  resolveGuidedOnboardingState,
  type GuidedOnboardingState,
} from "@/lib/bunny-host/ma4/native-notifications";

const ONBOARDING_CACHE = "bunny-a.onboarding.v2";
const STAGE_COPY: Record<(typeof GUIDED_ONBOARDING_STAGE_IDS)[number], { title: string; body: string }> = {
  welcome: { title: "Welcome to Bunny-A", body: "Bunny-A is your personal companion. You ask, Bunny recommends, and work starts only when you allow it." },
  "local-architecture": { title: "It runs on this computer", body: "The Host on this Windows PC is the authority. A phone can watch. It is not a second workstation, and nothing here turns on cloud inference." },
  preferences: { title: "What should Bunny call you?", body: "A name and language are optional. They stay on this Host." },
  "local-model-readiness": { title: "Local model", body: "Bunny only offers a local model this Host can see right now. A name from an old setup is not enough." },
  "model-selection": { title: "Choose a local model", body: "Pick one model from the list the Host reported. You can change it later in Models." },
  "permissions-boundary": { title: "You stay in control", body: "Ordinary requests that policy already allows can run with one confirmation. Consequential actions wait for an explicit approval. This step grants nothing by itself." },
  "background-execution-opt-in": { title: "Background execution", body: "Leave this off unless you want approved work to continue while the window is closed. Skipping setup leaves it off." },
  "phone-pairing-optional": { title: "Phone pairing", body: "Pairing is optional. It uses a one-time code from this PC. The phone still has to submit that code, and the Host checks it." },
  "voice-check-optional": { title: "Voice", body: "Voice is optional. You can try it later from the Island. Skipping does not open the microphone." },
  "first-safe-workflow": { title: "A first task", body: "When you are ready, describe one task on Home. Bunny will show the recommendation before anything runs." },
};

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
    voicePhase: notchVoicePhase(store.voice, store.voiceReceivedAt, now || Date.now()),
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

/** First-run guide. The Host record is authoritative; this browser only caches it. Skipping grants nothing. */
export function Onboarding({ onOpenDevices }: { onOpenDevices: () => void }) {
  const store = useIsland();
  const [record, setRecord] = useState<GuidedOnboardingState | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const saved = await useIsland.getState().ownerCommand("onboarding.get", {});
      if (cancel) return;
      const host = saved?.data as GuidedOnboardingState | null;
      if (host && typeof host === "object" && "stageId" in host) {
        setRecord(host);
        setName(host.preferences.preferredName);
        return;
      }
      let legacy: unknown = null;
      try { legacy = JSON.parse(localStorage.getItem(ONBOARDING_CACHE) || localStorage.getItem("bunny-a.onboarding.v1") || "null"); } catch { legacy = null; }
      const next = legacy && typeof legacy === "object" && "stageId" in legacy ? resolveGuidedOnboardingState(legacy as never) : migrateLegacyOnboarding(legacy);
      setRecord(next);
      setName(next.preferences.preferredName);
    })();
    return () => { cancel = true; };
  }, []);
  if (!record || record.status !== "active") return null;
  const copy = STAGE_COPY[record.stageId];
  const ollama = liveProviders(store).find((row) => row.id === "ollama");
  const readiness = evaluateLocalModelReadiness({
    ollamaAvailable: ollama?.availability === "ready" || ollama?.availability === "busy",
    models: ollama?.models?.length ? ollama.models : ollama?.current_model ? [ollama.current_model] : [],
    remoteModels: ollama?.remoteModels ?? [],
  });
  const providers = liveProviders(store)
    .filter((row) => !row.extension || row.installed)
    .map((row) => ({ name: NAMES[row.id] ?? row.id, availability: row.availability }));
  const save = async (next: GuidedOnboardingState) => {
    setRecord(next);
    try { localStorage.setItem(ONBOARDING_CACHE, JSON.stringify(next)); } catch { /* private mode */ }
    const answer = await useIsland.getState().ownerCommand("onboarding.save", {
      state: { status: next.status, stageIndex: next.stageIndex, preferences: next.preferences },
    });
    const host = answer?.data as GuidedOnboardingState | null;
    if (host && typeof host === "object" && "stageId" in host) setRecord(host);
  };
  const go = (stageIndex: number) => void save(resolveGuidedOnboardingState({
    status: "active",
    stageIndex,
    preferences: { ...record.preferences, preferredName: name },
  }));
  return (
    <section className="onboarding t8-surface" aria-labelledby="onboarding-title">
      <p className="eyebrow">Setup {record.stageIndex + 1} of {GUIDED_ONBOARDING_STAGE_IDS.length}</p>
      <h2 id="onboarding-title">{copy.title}</h2>
      <p>{copy.body}</p>
      {record.stageId === "local-architecture" ? <p className="caption">{providerSetupLine(providers)}{store.hostIdentity ? ` · Host ${store.hostIdentity.hostId.slice(0, 8)}` : ""}</p> : null}
      {record.stageId === "preferences" ? (
        <label className="caption">Name
          <input aria-label="Preferred name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
      ) : null}
      {record.stageId === "local-model-readiness" || record.stageId === "model-selection" ? <p className="caption">{readiness.userGuidance}</p> : null}
      {record.stageId === "model-selection" ? <p className="caption">This saves a preference, not a hard pin. If that model is unavailable, pick another local model from this list. Bunny will not substitute one.</p> : null}
      {record.stageId === "model-selection" ? readiness.runnableLocalModels.map((model) => (
        <button key={model} type="button" className={record.preferences.selectedLocalModel === model ? "btn primary" : "btn secondary"} onClick={() => setRecord({ ...record, preferences: { ...record.preferences, selectedLocalModel: model } })}>{model}</button>
      )) : null}
      {record.stageId === "background-execution-opt-in" ? (
        <label className="caption">
          <input type="checkbox" checked={record.preferences.backgroundExecutionOptIn} onChange={(event) => setRecord({ ...record, preferences: { ...record.preferences, backgroundExecutionOptIn: event.target.checked } })} />
          Continue approved work while the window is closed
        </label>
      ) : null}
      <div className="onboarding-actions">
        {record.stageIndex > 0 ? <button type="button" className="btn secondary" onClick={() => go(record.stageIndex - 1)}>Back</button> : null}
        {record.stageIndex < GUIDED_ONBOARDING_STAGE_IDS.length - 1 ? (
          <button type="button" className="btn primary" onClick={() => go(record.stageIndex + 1)}>Continue</button>
        ) : (
          <button type="button" className="btn primary" onClick={() => void save(resolveGuidedOnboardingState({ status: "done", stageIndex: record.stageIndex, preferences: { ...record.preferences, preferredName: name } }))}>Finish</button>
        )}
        {record.stageId === "first-safe-workflow" ? (
          <button type="button" className="btn secondary" onClick={() => { store.setSheet("chat"); document.getElementById("task-prompt")?.focus(); }}>Write a task</button>
        ) : null}
        {record.stageId === "phone-pairing-optional" ? <button type="button" className="btn secondary" onClick={onOpenDevices}>Open pairing</button> : null}
        <button type="button" className="btn quiet" onClick={() => void save(resolveGuidedOnboardingState({ status: "skipped", stageIndex: record.stageIndex, preferences: record.preferences }))}>Skip</button>
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
          <Empty
            title="No tasks yet."
            detail="Describe one on Home. Bunny shows the recommendation before it runs."
            headingLevel={2}
          />
        )}
      </div>
      {/* MA4-S2-T2: background tasks and the Approval Center on the routed shell (S2-T1 mounted them only in the legacy one). */}
      <PersistentTasks />
      <Proactive />
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
        <Empty title="Agents are unavailable." detail="Personal Agents appear when the Host connects. Nothing here is a sample agent." headingLevel={2} />
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
