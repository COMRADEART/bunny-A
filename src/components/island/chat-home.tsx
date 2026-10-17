import { Layers, Mic } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { Composer, Routing } from "./task";
import { TaskRow } from "./desktop";
import { Empty } from "./ui";
import { WeaponCharacter, usePrefersReducedMotion } from "./characters";
import { appearanceFor } from "./character-style-model";
import { displayState, hostLive } from "./character-model";
import { CHAT_QUESTION, composerChips, greetingFor, QUICK_ACTIONS, recentMissionRows, RECENT_MISSIONS_EMPTY } from "./chat-model";
import { sheetForView } from "./nav-model";

/** Composer chips prefill a sentence about existing context. They attach nothing and start nothing by themselves. */
const CHIP_PREFIX: Record<"web" | "files" | "code", string> = {
  web: "Using current web sources: ",
  files: "Using the files in my project: ",
  code: "In my code: ",
};

/**
 * The Chat landing: a time-of-day greeting with no user name, the composer, quick actions that prefill or open an existing
 * surface, the Host's real recent Missions, and ordinary Tasks. Voice appears only where this viewer may use it.
 */
export function ChatHome({ now }: { now: number }) {
  const systemReduced = usePrefersReducedMotion();

  const store = useIsland();
  const hour = new Date(now || Date.now()).getHours();
  const live = hostLive(store.connection, now || Date.now());
  const isWorkstation = store.viewer?.kind !== "device";
  const voiceAvailable = isWorkstation && store.voiceSupported !== false;
  const missions = recentMissionRows(store.missions?.missions ?? [], store.personalAgents, 4, store.personalAgentContext);
  const chips = composerChips(voiceAvailable);

  const onChip = (id: string) => {
    if (id === "voice") {
      void store.openVoice("push_to_talk");
      return;
    }
    const key = id as keyof typeof CHIP_PREFIX;
    if (!store.prompt.trim()) store.setPrompt(CHIP_PREFIX[key]);
  };

  const slots = store.personalAgents?.slots ?? [];
  return (
    <div className="ch-home">
      <section className="ch-hero" aria-labelledby="chat-greeting">
        <p className="eyebrow">{new Date(now || Date.now()).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 id="chat-greeting">{greetingFor(hour)}</h1>
        <p className="caption">{CHAT_QUESTION}</p>
      </section>
      <section className="t8-surface chat-compose" aria-label="Ask Bunny">
        {store.submitting ? <Routing /> : <Composer />}
        <div className="ch-chips" role="group" aria-label="Add context">
          {chips.map((chip) => (
            <button key={chip.id} className="ch-chip" type="button" onClick={() => onChip(chip.id)} aria-label={chip.id === "voice" ? "Start voice" : `Add ${chip.label} context`}>
              {chip.id === "voice" ? <Mic size={14} /> : null}
              {chip.label}
            </button>
          ))}
        </div>
      </section>
      <section className="ch-quick" aria-label="Quick actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              if (action.kind === "prefill") store.setPrompt(action.prompt);
              else store.setSheet(sheetForView(action.view));
            }}
          >
            {action.label}
          </button>
        ))}
      </section>
      {slots.length > 0 && (
        // The four Personal Agents as a dashboard module. Every state shown is the Host's presentation fact for that slot.
        <section className="t8-section ch-agents" aria-labelledby="home-agents">
          <div className="section-heading">
            <h2 id="home-agents">Personal Agents</h2>
            <button className="quiet-button" type="button" onClick={() => store.setSheet("studio")}>
              Agent Studio
            </button>
          </div>
          <div className="ch-agent-grid">
            {slots.map((slot) => (
              <button key={slot.slot} type="button" className="t8-surface ch-agent" onClick={() => store.setSheet("agents")} aria-label={`${slot.displayName}: ${slot.presentation.label}`}>
                <WeaponCharacter
                  weapon={slot.weapon}
                  state={displayState(slot.presentation.state, live)}
                  size="compact"
                  reduced={systemReduced || store.appearance.motion !== "full"}
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
        </section>
      )}
      <section className="t8-section ch-missions" aria-labelledby="recent-missions">
        <div className="section-heading">
          <h2 id="recent-missions">Recent Missions</h2>
          <button className="quiet-button" type="button" onClick={() => store.setSheet("missions")}>
            All Missions
          </button>
        </div>
        <div className="t8-surface">
          {missions.map((row) => (
            <button
              key={row.id}
              className="ch-mission-row"
              type="button"
              onClick={() => {
                store.openMission(row.id);
                store.setSheet("missions");
              }}
            >
              {row.weapon ? (
                <WeaponCharacter
                  weapon={row.weapon}
                  state={displayState(row.presentation ?? "UNKNOWN", live)}
                  size="compact"
                  reduced={systemReduced || store.appearance.motion !== "full"}
                  displayName={row.weaponName}
                  appearance={appearanceFor(store.characterAppearance, row.slot)}
                />
              ) : (
                <span className="ch-neutral-icon" aria-hidden="true">
                  <Layers size={22} />
                </span>
              )}
              <span className="ch-copy">
                <strong>{row.title}</strong>
                <small>
                  {row.weaponName ? `${row.weaponName} · ` : ""}
                  {row.stepLabel}
                </small>
              </span>
              <span className="cx-badge">{live ? row.stateLabel : `Last known: ${row.stateLabel}`}</span>
            </button>
          ))}
          {!missions.length && <Empty title={RECENT_MISSIONS_EMPTY.title} detail={RECENT_MISSIONS_EMPTY.detail} />}
        </div>
      </section>
      <section className="t8-section ch-tasks">
        <h2>Recent ordinary Tasks</h2>
        <div className="task-list t8-surface">
          {store.tasks
            .filter((row) => !row.mission)
            .slice(0, 8)
            .map((task) => (
              <TaskRow task={task} now={now} key={task.id} />
            ))}
          {!store.tasks.some((row) => !row.mission) && (
            <Empty title="Start a conversation." detail="Replies and outcomes come from the supported Host Task path." />
          )}
        </div>
      </section>
    </div>
  );
}
