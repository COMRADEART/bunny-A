import { useState } from "react";
import {
  defaultPersonalAgentsConfig,
  PRESENTATION_STATES,
  presentationLabel,
  WEAPONS,
  WEAPON_LABEL,
  type PersonalAgentView,
  type PresentationBasis,
  type PresentationState,
} from "../../lib/bunny-host/personal-agents.ts";
import { COMPANION_STATES } from "../../lib/bunny-host/voice/voice-companion.ts";
import type { Connection } from "./connection-model.ts";
import { BunnyCompanion, WeaponCharacter, WeaponStrip } from "./characters.tsx";
import { COMPANION_LABEL } from "./companion-model.ts";
import "./design-preview.css";

/*
 * DESIGN PREVIEW. Every value in this file named FIXTURE_* is invented for the preview; none of it is Host data. The page
 * exists so the character system can be reviewed state by state. It is not reachable from the product surfaces.
 */

const FIXTURE_NOW = 1_700_000_000_000;
const FIXTURE_CONNECTION: Pick<Connection, "state" | "snapshotAt"> = { state: "live", snapshotAt: FIXTURE_NOW };

const FIXTURE_BASIS: Record<PresentationState, PresentationBasis> = {
  UNASSIGNED: { kind: "unassigned" },
  IDLE: { kind: "agent-state", agentState: "CREATED" },
  PLANNING: { kind: "team-step", teamKind: "plan", role: "planner", stepId: "fixture-plan" },
  RESEARCHING: { kind: "provider-event", event: "agent.reading", at: FIXTURE_NOW, taskId: "fixture-task" },
  CODING: { kind: "team-step", teamKind: "generate_json", role: "implementer", stepId: "fixture-code" },
  TESTING: { kind: "command", classified: "agent.testing", stepId: "fixture-test" },
  FILE_WORK: { kind: "capability", action: "filesystem.write", stepId: "fixture-write" },
  ACTIVE: { kind: "no-category", reason: "fixture" },
  VERIFYING: { kind: "step-state", stepState: "verifying", stepId: "fixture-verify" },
  WAITING: { kind: "agent-state", agentState: "WAITING_FOR_DEPENDENCY" },
  WAITING_FOR_USER: { kind: "agent-state", agentState: "WAITING_FOR_USER" },
  PAUSED: { kind: "agent-state", agentState: "PAUSED" },
  COMPLETED: { kind: "mission-result", verifiedSteps: 0, unverifiedSteps: 2 },
  VERIFIED: { kind: "mission-result", verifiedSteps: 3, unverifiedSteps: 0 },
  FAILED: { kind: "agent-state", agentState: "FAILED" },
  STOPPED: { kind: "agent-state", agentState: "STOPPED" },
  RECOVERING: { kind: "agent-state", agentState: "INTERRUPTED" },
  UNKNOWN: { kind: "agent-missing" },
  OFFLINE: { kind: "no-category", reason: "fixture" },
};

/** Four fixture slots, one per weapon, each bound to an invented Agent. The states are the preview's only data. */
const FIXTURE_SLOTS: PersonalAgentView[] = defaultPersonalAgentsConfig(FIXTURE_NOW).slots.map((slot, index) => {
  const state: PresentationState = (["RESEARCHING", "VERIFIED", "WAITING_FOR_USER", "FAILED"] as const)[index];
  return {
    ...slot,
    displayName: ["Research Bot", "Reviewer", "Planner", "Builder"][index],
    agentId: `fixture-agent-${index + 1}`,
    agent: {
      id: `fixture-agent-${index + 1}`,
      name: ["Research Bot", "Reviewer", "Planner", "Builder"][index],
      state: "RUNNING",
      missionId: null,
      missionTitle: "Fixture mission",
      objective: null,
      projectId: null,
      failure: null,
      team: false,
      updatedAt: FIXTURE_NOW,
    },
    presentation: { state, label: presentationLabel(state), basis: FIXTURE_BASIS[state] },
    attention: { pendingApprovals: state === "WAITING_FOR_USER" ? 1 : 0 },
    progress: null,
    result: null,
    technical: null,
  };
});

const FIXTURE_DOCKS = [
  { id: "top", notch: "Horizontal, attached to the top edge", strip: "Left of the Notch, connected", panel: "Opens downward" },
  { id: "bottom", notch: "Horizontal, attached to the bottom edge", strip: "Left of the Notch", panel: "Opens upward" },
  { id: "left", notch: "Vertical", strip: "Above the Notch", panel: "Opens rightward" },
  { id: "right", notch: "Vertical", strip: "Above the Notch", panel: "Opens leftward" },
] as const;

const SIZES = ["compact", "pose", "hero"] as const;

export function DesignPreview() {
  const [reduced, setReduced] = useState(false);
  return (
    <div className="dp-root" data-reduced={reduced ? "true" : "false"}>
      <header className="dp-banner" role="note">
        <strong>Design preview — fixture states, not live Host data</strong>
        <button type="button" className="dp-toggle" aria-pressed={reduced} onClick={() => setReduced((on) => !on)}>
          Reduced motion
        </button>
      </header>

      <section className="dp-section" aria-labelledby="dp-weapons">
        <h2 id="dp-weapons">Weapons: every presentation state, pose size</h2>
        <p className="dp-note">The art is the user&apos;s own character on a dark well. Badges and rings carry the state; motion is removed under reduced motion.</p>
        <div className="dp-grid dp-grid-weapons" role="table" aria-label="Weapon characters by state">
          <div role="row" className="dp-row dp-head">
            <span role="columnheader">State</span>
            {WEAPONS.map((weapon) => (
              <span role="columnheader" key={weapon}>
                {WEAPON_LABEL[weapon]}
              </span>
            ))}
          </div>
          {PRESENTATION_STATES.map((state) => (
            <div role="row" className="dp-row" key={state}>
              <span role="cell" className="dp-state">
                {presentationLabel(state)} <code>{state}</code>
              </span>
              {WEAPONS.map((weapon) => (
                <span role="cell" key={weapon}>
                  <WeaponCharacter weapon={weapon} state={state} size="pose" reduced={reduced} displayName={WEAPON_LABEL[weapon]} basis={FIXTURE_BASIS[state]} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="dp-section" aria-labelledby="dp-sizes">
        <h2 id="dp-sizes">Sizes: compact, pose and hero for every state</h2>
        {PRESENTATION_STATES.map((state) => (
          <div className="dp-size-row" key={state}>
            <h3>
              {presentationLabel(state)} <code>{state}</code>
            </h3>
            <div className="dp-size-cells">
              {WEAPONS.map((weapon) => (
                <div className="dp-size-weapon" key={weapon}>
                  {SIZES.map((size) => (
                    <WeaponCharacter
                      key={size}
                      weapon={weapon}
                      state={state}
                      size={size}
                      reduced={reduced}
                      displayName={WEAPON_LABEL[weapon]}
                      basis={FIXTURE_BASIS[state]}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="dp-section" aria-labelledby="dp-strip">
        <h2 id="dp-strip">Notch strip: bound, active slots as character art only</h2>
        <p className="dp-note">Four fixture slots, plus two Agents outside any slot shown as a neutral count.</p>
        <WeaponStrip slots={FIXTURE_SLOTS} connection={FIXTURE_CONNECTION} now={FIXTURE_NOW} reduced={reduced} unslottedAgents={2} />
        <h3>Offline: the same slots when the Host is not live</h3>
        <WeaponStrip slots={FIXTURE_SLOTS} connection={{ state: "reconnecting", snapshotAt: FIXTURE_NOW }} now={FIXTURE_NOW} reduced={reduced} />
      </section>

      <section className="dp-section" aria-labelledby="dp-companion">
        <h2 id="dp-companion">Bunny companion: every state</h2>
        <div className="dp-companion-grid">
          {COMPANION_STATES.map((state) => (
            <figure className="dp-companion-cell" key={state}>
              <BunnyCompanion state={state} size="pose" reduced={reduced} />
              <figcaption>
                {COMPANION_LABEL[state]} <code>{state}</code>
              </figcaption>
            </figure>
          ))}
        </div>
        <h3>Identity image</h3>
        <BunnyCompanion state="READY" size="hero" reduced={reduced} />
      </section>

      <section className="dp-section" aria-labelledby="dp-docks">
        <h2 id="dp-docks">Dock layouts (static diagram)</h2>
        <div className="dp-docks">
          {FIXTURE_DOCKS.map((dock) => (
            <figure className="dp-dock" data-dock={dock.id} key={dock.id}>
              <div className="dp-screen">
                <span className="dp-notch" aria-hidden="true">
                  Notch
                </span>
                <span className="dp-strip-box" aria-hidden="true">
                  Personal Agent strip
                </span>
              </div>
              <figcaption>
                <strong>{dock.id}</strong>: Notch {dock.notch.toLowerCase()}. Strip {dock.strip.toLowerCase()}. Panel {dock.panel.toLowerCase()}.
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
