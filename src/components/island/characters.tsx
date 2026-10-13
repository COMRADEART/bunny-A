import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import type { PersonalAgentView, PresentationBasis, PresentationState, WeaponId } from "../../lib/bunny-host/personal-agents.ts";
import type { CompanionState } from "../../lib/bunny-host/voice/voice-companion.ts";
import type { Connection } from "./connection-model.ts";
import {
  characterLabel,
  characterMotion,
  characterOverlay,
  companionArtUrl,
  displayState,
  hostLive,
  transitionCue,
  weaponArtUrl,
  type BadgeKind,
  type CharacterSize,
  type TransitionCue,
} from "./character-model.ts";
import { advanceHappyMemo, companionCue, companionDescriptor, type CompanionDescriptor, type HappyMemo } from "./companion-model.ts";
import "./characters.css";

/**
 * T13 character components. Art is the user's own board character (public/bunny-a/characters) drawn on a dark well in
 * both themes. Decorative motion is CSS driven from data attributes set here; one-shots are a data-cue attribute set on
 * an observed transition and cleared on the cue animation's end. Nothing here runs a timer.
 */

// ---------------------------------------------------------------------------------------------------------------
// Animation gate: pauses every loop while the surface is hidden or off-screen.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Sets data-paused="true" on the element (CSS animation-play-state: paused) while the document is hidden, the element is
 * off-screen, or `forcePaused` is set. Observers and listeners are removed on unmount.
 */
export function useAnimationGate(ref: RefObject<HTMLElement | null>, forcePaused = false): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let onScreen = true;
    const apply = () => {
      if (document.hidden || !onScreen || forcePaused) el.setAttribute("data-paused", "true");
      else el.removeAttribute("data-paused");
    };
    apply();
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const entry of entries) if (entry.target === el) onScreen = entry.isIntersecting;
            apply();
          })
        : null;
    observer?.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", apply);
      el.removeAttribute("data-paused");
    };
  }, [ref, forcePaused]);
}

// ---------------------------------------------------------------------------------------------------------------
// One-shot cues: set on an observed transition (never the first observation), cleared on the cue's animation end.
// ---------------------------------------------------------------------------------------------------------------

/** The OS reduced-motion preference, live. The CSS honours the same query, so JS and CSS agree on what is suppressed. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Animation names that end a cue. The shock ring is the longest cue animation, so it clears the attribute. */
const CUE_END = new Set(["wc-cue-ring", "wc-cue-hop", "wc-cue-recoil"]);

const weaponCue = (prev: PresentationState, next: PresentationState): TransitionCue | null => transitionCue(prev, next, false);
const companionOneShot = (prev: CompanionState, next: CompanionState) => companionCue(prev, next, false);

function useObservedCue<S, C extends string>(
  state: S,
  cueOf: (prev: S, next: S) => C | null,
  enabled: boolean,
  target: RefObject<HTMLElement | null>,
): { cue: C | null; clear: () => void } {
  const seen = useRef<{ state: S } | null>(null);
  const [cue, setCue] = useState<C | null>(null);
  useEffect(() => {
    const prev = seen.current;
    seen.current = { state };
    // The first observation seeds the comparison and never produces a cue.
    if (!prev || !enabled) return;
    const next = cueOf(prev.state, state);
    if (next) setCue(next);
  }, [state, enabled, cueOf]);
  // A suppressed attribute cancels the running cue animation, so animationend never fires and the internal cue
  // would replay on re-enable without a new observed transition (spec section 8: one-shots fire only on an
  // observed transition). Motion being turned back on starts a fresh comparison from the current state.
  useEffect(() => {
    if (!enabled) setCue(null);
  }, [enabled]);
  const clear = useCallback(() => setCue(null), []);
  // A cue shows only while its animation runs. Motion Off and the OS reduced-motion setting suppress those animations
  // (characters.css), and a suppressed animation never ends, so the cue would stick (a red ring after the Host went idle).
  // When no cue animation is running one frame after the cue appears, the cue is dropped.
  useEffect(() => {
    const el = target.current;
    if (!cue || !el || typeof el.getAnimations !== "function") return;
    const frame = requestAnimationFrame(() => {
      const running = el
        .getAnimations({ subtree: true })
        .some((animation) => "animationName" in animation && CUE_END.has((animation as CSSAnimation).animationName));
      if (!running) setCue(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [cue, target]);
  return { cue: enabled ? cue : null, clear };
}

// ---------------------------------------------------------------------------------------------------------------
// Badges: one shared glyph set. The label carries the meaning; the glyph is decorative.
// ---------------------------------------------------------------------------------------------------------------

const BADGE_TONE: Record<BadgeKind | "attention" | "failed" | "muted" | "unplugged", string> = {
  verified: "ok",
  completed: "neutral",
  attention: "amber",
  failed: "red",
  paused: "neutral",
  stopped: "neutral",
  unknown: "neutral",
  offline: "grey",
  muted: "amber",
  unplugged: "grey",
};

function BadgeGlyph({ kind }: { kind: keyof typeof BADGE_TONE }) {
  const paths: Record<keyof typeof BADGE_TONE, ReactElement> = {
    verified: <path d="M5.5 12.5l4.2 4.2L18.5 7.5" />,
    completed: <path d="M5.5 12.5l4.2 4.2L18.5 7.5" />,
    attention: <path d="M12 6.5v7.5M12 17.5v.6" />,
    failed: <path d="M12 6.5v7.5M12 17.5v.6" />,
    paused: <path d="M9.5 7.5v9M14.5 7.5v9" />,
    stopped: <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />,
    unknown: <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14M12 17.5v.6" />,
    offline: <path d="M6.5 6.5l11 11M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z" />,
    muted: <path d="M6.5 6.5l11 11M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z" />,
    unplugged: <path d="M6.5 6.5l11 11M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[kind]}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// WeaponCharacter
// ---------------------------------------------------------------------------------------------------------------

const EFFECT_PARTS = [0, 1, 2, 3, 4, 5];

export type WeaponCharacterProps = {
  weapon: WeaponId;
  /** The display state: pass displayState(presentation, live) so an offline view shows OFFLINE. */
  state: PresentationState;
  slot?: number;
  size?: CharacterSize;
  /**
   * Whether this instance may play the one-shot transition cue. Only the slot's home surface sets it (the desktop
   * Personal Agents panel, the strip, the phone Home tiles): a transition is acknowledged once per page, while list
   * rows and detail views show the settled badge without replaying the cue.
   */
  celebrate?: boolean;
  reduced?: boolean;
  /** Forces the loops paused (for example while a parent surface is collapsed). Visibility gating is automatic. */
  paused?: boolean;
  /** Accessible label. Defaults to characterLabel for the given name and basis. */
  label?: string;
  displayName?: string | null;
  basis?: PresentationBasis | null;
  note?: string | null;
};

export function WeaponCharacter({
  weapon,
  state,
  slot,
  size = "pose",
  celebrate = false,
  reduced = false,
  paused = false,
  label,
  displayName,
  basis,
  note,
}: WeaponCharacterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useAnimationGate(ref, paused);
  const { cue, clear } = useObservedCue(state, weaponCue, celebrate && !reduced, ref);
  const url = weaponArtUrl(weapon, state, size);
  if (!url) return null;
  const motion = characterMotion(weapon, state, reduced);
  const overlay = characterOverlay(state);
  const text = label ?? characterLabel({ weapon, displayName, state, basis, note });
  const style = {
    "--wc-base-ms": `${motion.base?.ms ?? 0}ms`,
    "--wc-counter-ms": `${motion.base?.counterMs ?? 0}ms`,
    "--wc-ease": motion.base?.ease ?? motion.effect?.ease ?? "linear",
    "--wc-effect-ms": `${motion.effect?.ms ?? 0}ms`,
    "--wc-halo-ms": `${motion.halo?.ms ?? 0}ms`,
    "--wc-opacity": overlay.opacity,
  } as CSSProperties;
  return (
    <span
      ref={ref}
      className="wc-weapon"
      data-weapon={weapon}
      data-state={state}
      data-size={size}
      data-slot={slot}
      data-reduced={reduced ? "true" : "false"}
      data-tone={overlay.tone}
      data-ring={overlay.ring}
      data-ring-pulse={motion.ringPulse ? "true" : undefined}
      data-ring-spin={motion.ringSpin ? "true" : undefined}
      data-base={motion.base?.loop ?? "none"}
      data-counter={motion.base?.counterMs ? "true" : undefined}
      data-effect={motion.effect?.primitive ?? "none"}
      data-halo={motion.halo ? "true" : undefined}
      data-cue={cue ?? undefined}
      style={style}
      onAnimationEnd={(event) => {
        if (CUE_END.has(event.animationName)) clear();
      }}
    >
      <span className="wc-well">
        <span className="wc-body">
          <img className="wc-art" src={url} alt={text} draggable={false} decoding="async" />
        </span>
        <span className="wc-halo" aria-hidden="true" />
        <span className="wc-glint" aria-hidden="true" />
        <span className="wc-fx" data-prim={motion.effect?.primitive ?? "none"} aria-hidden="true">
          {EFFECT_PARTS.map((part) => (
            <i key={part} style={{ "--wc-i": part } as CSSProperties} />
          ))}
        </span>
        <span className="wc-ring" aria-hidden="true" />
      </span>
      {overlay.badge ? (
        <span className="wc-badge" data-badge={overlay.badge} data-tone={BADGE_TONE[overlay.badge]} aria-hidden="true">
          <BadgeGlyph kind={overlay.badge} />
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// BunnyCompanion
// ---------------------------------------------------------------------------------------------------------------

export type BunnyCompanionProps = {
  state: CompanionState;
  /** Real input level ring scale from levelRingScale (already freshness-checked). Null means a static ring. */
  level?: number | null;
  size?: CharacterSize;
  reduced?: boolean;
  paused?: boolean;
  label?: string;
};

export function BunnyCompanion({ state, level = null, size = "compact", reduced = false, paused = false, label }: BunnyCompanionProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useAnimationGate(ref, paused);
  const { cue, clear } = useObservedCue(state, companionOneShot, !reduced, ref);
  const url = companionArtUrl(state, size);
  if (!url) return null;
  const descriptor: CompanionDescriptor = companionDescriptor(state, { reducedMotion: reduced, levelScale: level });
  const style = {
    "--wc-loop-ms": `${descriptor.loopMs ?? 0}ms`,
    "--wc-ease": descriptor.easing ?? "linear",
    "--wc-level": descriptor.levelScale ?? 1,
  } as CSSProperties;
  const text = label ?? `Bunny A, ${descriptor.label}`;
  return (
    <span
      ref={ref}
      className="wc-companion"
      data-state={state}
      data-size={size}
      data-reduced={reduced ? "true" : "false"}
      data-tone={descriptor.greyscale ? "grey" : descriptor.dim ? "dim" : "normal"}
      data-ring={descriptor.ring}
      data-ring-pulse={descriptor.ringPulse ? "true" : undefined}
      data-level={descriptor.levelScale !== null ? "true" : undefined}
      data-loop={descriptor.loop ?? "none"}
      data-cue={cue ?? undefined}
      style={style}
      onAnimationEnd={(event) => {
        if (CUE_END.has(event.animationName)) clear();
      }}
    >
      <span className="wc-well">
        <span className="wc-body">
          <img className="wc-art" src={url} alt={text} draggable={false} decoding="async" />
        </span>
        <span className="wc-ring" aria-hidden="true" />
      </span>
      {descriptor.badge ? (
        <span className="wc-badge" data-badge={descriptor.badge} data-tone={BADGE_TONE[descriptor.badge]} aria-hidden="true">
          <BadgeGlyph kind={descriptor.badge} />
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// HAPPY window: client-owned state across observations of the four slots.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Tracks the personal slots across renders and returns the HAPPY deadline (ms epoch). The first array seen seeds the
 * comparison and never celebrates. The window ends by the caller re-rendering with a later `now`: no timer is started.
 */
export function useHappyWindow(slots: readonly PersonalAgentView[] | null, now: number, live = true): number {
  const memo = useRef<HappyMemo>({ latest: null, until: 0 });
  memo.current = advanceHappyMemo(memo.current, slots, now, live);
  return memo.current.until;
}

// ---------------------------------------------------------------------------------------------------------------
// WeaponStrip: the bound, active Personal Agents as character art only.
// ---------------------------------------------------------------------------------------------------------------

export function WeaponStrip({
  slots,
  connection,
  now,
  reduced = false,
  unslottedAgents = 0,
}: {
  slots: readonly PersonalAgentView[];
  connection: Pick<Connection, "state" | "snapshotAt">;
  now: number;
  reduced?: boolean;
  /** User-facing Agents outside every slot. Shown as a neutral count, never as a character. */
  unslottedAgents?: number;
}) {
  const live = hostLive(connection, now);
  // Only slots that are active and bound to an Agent: an unassigned slot has nothing to draw.
  const shown = slots.filter((slot) => slot.active && slot.agentId !== null);
  return (
    <div className="wc-strip" role="list" aria-label="Personal Agents">
      {shown.map((slot) => {
        const state = displayState(slot.presentation.state, live);
        const label = characterLabel({
          weapon: slot.weapon,
          displayName: slot.displayName,
          state,
          basis: live ? slot.presentation.basis : null,
          note: live ? null : "Host connection not live",
        });
        return (
          <span key={slot.slot} role="listitem" className="wc-strip-item" title={label}>
            <WeaponCharacter key={slot.agentId ?? "unassigned"} weapon={slot.weapon} state={state} slot={slot.slot} size="compact" celebrate reduced={reduced} label={label} />
          </span>
        );
      })}
      {unslottedAgents > 0 ? (
        <span role="listitem" className="wc-count">
          <span aria-hidden="true">+{unslottedAgents}</span>
          <span className="wc-visually-hidden">{unslottedAgents} more Agents not in a slot</span>
        </span>
      ) : null}
    </div>
  );
}
