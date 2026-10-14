import { useRef, useState } from "react";
import { useIsland } from "@/store/use-island";
import {
  ANIMATION_INTENSITIES,
  CHARACTER_STYLES,
  CHARACTER_STYLE_LABEL,
  CHARACTER_STYLE_SUMMARY,
  DEFAULT_APPEARANCE,
  SIGNATURE_STYLE,
  resolvedStyle,
  type AnimationIntensity,
  type CharacterAppearance,
} from "@/lib/bunny-host/character-style";
import { WEAPON_LABEL, type SlotId, type WeaponId } from "@/lib/bunny-host/personal-agents";
import { BunnyCompanion, WeaponCharacter, WeaponStrip } from "./characters";
import { CHARACTER_SIZES, displayState, hostLive } from "./character-model";
import { NOTCH_EDGES, appearanceFor, notchLayout, type NotchEdge } from "./character-style-model";
import { COMPANION_LABEL, resolveCompanion } from "./companion-model";

const INTENSITY_LABEL: Record<AnimationIntensity, string> = { full: "Full", subtle: "Subtle", off: "Off" };
const EDGE_LABEL: Record<NotchEdge, string> = { top: "Top", bottom: "Bottom", left: "Left", right: "Right" };

/**
 * Studio → Appearance → Character style (T13.3 Gate H §25). Saved on the Host at once and apart from the slot draft: a look
 * is presentation only, so it never needs the configuration revision and never changes a Mission, an owner, a permission,
 * a memory or which models the Agent may use. The previews draw the slot's real Host state, so nothing here animates work
 * that is not happening.
 */
export function CharacterAppearancePanel({ slot, weapon, displayName, editable, reduced }: {
  slot: SlotId;
  weapon: WeaponId;
  displayName: string;
  editable: boolean;
  reduced: boolean;
}) {
  const store = useIsland();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [edge, setEdge] = useState<NotchEdge>("top");
  const now = Date.now();
  const live = hostLive(store.connection, now);
  const appearance: CharacterAppearance = appearanceFor(store.characterAppearance, slot) ?? DEFAULT_APPEARANCE;
  const shown = resolvedStyle(weapon, appearance);
  const signature = SIGNATURE_STYLE[weapon];
  const view = store.personalAgents?.slots.find((row) => row.slot === slot);
  const state = displayState(view?.presentation.state ?? "UNASSIGNED", live);
  // Controls stay enabled (and focused) while a change is in flight; a disabled radio would drop keyboard focus to the page.
  const canChange = editable && live && store.characterAppearance !== null;
  const name = displayName || WEAPON_LABEL[weapon];
  const layout = notchLayout(edge);
  const bunny = resolveCompanion({ now, connection: store.connection, voice: store.voice, voiceReceivedAt: store.voiceReceivedAt || null, happyUntil: 0, reduced });
  const speaker = store.personalAgentContext?.foreground ?? null;

  const send = async (action: "personal_agent.appearance" | "personal_agent.appearance_reset", data: Record<string, unknown>) => {
    if (!canChange || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      await store.personalAgentCommand(action, { slot, ...data }, (caption) => setRefusal(caption));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const change = (patch: Partial<CharacterAppearance>) => void send("personal_agent.appearance", { appearance: patch });

  return (
    <section className="t8-section ca-panel" aria-labelledby={`ca-heading-${slot}`} aria-busy={busy}>
      <div className="section-heading">
        <h3 id={`ca-heading-${slot}`}>Appearance · Character style</h3>
        <span className="caption">Saved on your Host as soon as you choose</span>
      </div>
      <p className="caption" role="note">
        {WEAPON_LABEL[weapon]} stays {name}. A style changes only how the character is drawn: never its Missions, permissions,
        memory or which models it may use.
      </p>

      <div className="ca-preview" role="group" aria-label={`${name} in ${CHARACTER_STYLE_LABEL[shown]}`}>
        {CHARACTER_SIZES.map((size) => (
          <figure key={size} className="ca-figure">
            <WeaponCharacter weapon={weapon} state={state} slot={slot} size={size} reduced={reduced} displayName={displayName} appearance={appearance} />
            <figcaption className="caption">{size === "compact" ? "Notch" : size === "pose" ? "Card" : "Detail"}</figcaption>
          </figure>
        ))}
      </div>

      <fieldset className="ca-styles" disabled={!canChange}>
        <legend>Character style</legend>
        {CHARACTER_STYLES.map((style) => (
          <label key={style} className="ca-option" data-selected={style === shown || undefined}>
            <input
              type="radio"
              name={`ca-style-${slot}`}
              value={style}
              checked={style === shown}
              onChange={() => change({ style })}
            />
            <span className="ca-option-copy">
              <strong>
                {CHARACTER_STYLE_LABEL[style]}
                {style === signature ? <span className="ca-tag">Signature</span> : null}
              </strong>
              <span className="caption">{CHARACTER_STYLE_SUMMARY[style]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="ca-controls">
        <fieldset className="ca-intensity" disabled={!canChange}>
          <legend>Animation intensity</legend>
          {ANIMATION_INTENSITIES.map((intensity) => (
            <label key={intensity}>
              <input type="radio" name={`ca-intensity-${slot}`} value={intensity} checked={appearance.intensity === intensity} onChange={() => change({ intensity })} />
              {INTENSITY_LABEL[intensity]}
            </label>
          ))}
        </fieldset>
        <label className="ca-check">
          <input type="checkbox" checked={appearance.highContrast} disabled={!canChange} onChange={(event) => change({ highContrast: event.target.checked })} />
          High contrast (solid outline, no decorative effects)
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={!canChange || (appearance.style === null && appearance.intensity === "full" && !appearance.highContrast)}
          onClick={() => void send("personal_agent.appearance_reset", {})}
        >
          Reset to signature ({CHARACTER_STYLE_LABEL[signature]})
        </button>
      </div>
      <p className="caption" role="note">
        {reduced
          ? "Reduced motion is on for this device, so every character holds still whatever the intensity."
          : "Characters move only while the Host reports work. Reduced motion, here or in your system settings, always stops them."}
      </p>
      {!editable ? <p className="caption">Character style is changed on the workstation.</p> : null}
      {editable && !live ? <p className="caption">Reconnect to change the style. Nothing is sent while the Host is not live.</p> : null}
      {refusal ? (
        <p className="st-error" role="alert">
          {refusal}
        </p>
      ) : null}

      <div className="ca-notch-head">
        <h4>Notch preview</h4>
        <label className="ca-edge">
          Docked edge
          <select value={edge} onChange={(event) => setEdge(event.target.value as NotchEdge)}>
            {NOTCH_EDGES.map((value) => (
              <option key={value} value={value}>
                {EDGE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ca-notch" data-axis={layout.axis} aria-label={`Notch preview on the ${edge} edge`}>
        <WeaponStrip
          slots={store.personalAgents?.slots ?? []}
          connection={store.connection}
          now={now}
          reduced={reduced}
          appearances={store.characterAppearance}
          speaker={speaker}
          celebrate={false}
        />
        <BunnyCompanion state={bunny.state} level={bunny.level} size="compact" reduced={reduced} label={`Bunny is ${COMPANION_LABEL[bunny.state]}`} />
      </div>
      <p className="caption">
        {layout.agents === "left-of-bunny" ? "Top and bottom edges: Agents sit left of Bunny." : "Left and right edges: Agents sit above Bunny."}{" "}
        {typeof speaker === "number" ? `A bar marks ${WEAPON_LABEL[store.personalAgents?.slots.find((row) => row.slot === speaker)?.weapon ?? weapon]} as the active speaker; ` : "Bunny is the active speaker; "}
        a blue dot marks each Agent the Host reports as still working.
      </p>
    </section>
  );
}
