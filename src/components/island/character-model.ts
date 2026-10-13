import {
  WEAPONS,
  WEAPON_LABEL,
  presentationLabel,
  type PresentationBasis,
  type PresentationState,
  type WeaponId,
} from "../../lib/bunny-host/personal-agents.ts";
import type { CompanionState } from "../../lib/bunny-host/voice/voice-companion.ts";
import { SNAPSHOT_FRESH_MS, type Connection } from "./connection-model.ts";

/**
 * T13 character presentation (pure). Maps Host-derived presentation states and the Bunny companion state onto the
 * user's own character art, its badges and rings, its motion descriptor and its accessible label. No React, no timers:
 * the components in characters.tsx consume these descriptors and the CSS in characters.css draws them.
 *
 * Art: public/bunny-a/characters/<id>.png (derived from the board by assets/t13/derive_assets.py). Weapons stand for the
 * user's four Personal Agent slots only; nothing here maps an internal team member or a provider to a weapon.
 */

export const CHARACTER_DIR = "/bunny-a/characters";
export const CHARACTER_SIZES = ["compact", "pose", "hero"] as const;
export type CharacterSize = (typeof CHARACTER_SIZES)[number];

/** Motion tokens (spec §5). Milliseconds; every loop and one-shot reads these values. */
export const MOTION_TOKENS = { micro: 150, content: 220, morph: 360, route: 760, oneshot: 900, breathing: 3200 } as const;
export const EASE = {
  standard: "cubic-bezier(.2,0,0,1)",
  emphasized: "cubic-bezier(.3,0,0,1)",
  weighty: "cubic-bezier(.45,0,.2,1)",
  precise: "cubic-bezier(.65,0,.35,1)",
  orbital: "linear",
} as const;
/** The only task-loop cadence the spec states (trace per 2.4 s); every weapon effect layer uses it. */
export const TASK_LOOP_MS = 2400;
export const RING_PULSE_MS = 2400;
/** Idle loop per weapon personality (spec §6). `ms` is the base period; `counterMs` is Chakra's halo counter-rotation. */
export const WEAPON_BASE: Record<WeaponId, { loop: string; ms: number; ease: string; counterMs: number | null }> = {
  gada: { loop: "gada-float", ms: 4200, ease: EASE.weighty, counterMs: null },
  spear: { loop: "spear-float", ms: 3000, ease: EASE.precise, counterMs: null },
  chakra: { loop: "chakra-rotate", ms: 12000, ease: EASE.orbital, counterMs: 18000 },
  sword: { loop: "sword-hover", ms: 3600, ease: EASE.precise, counterMs: null },
};
/** WAITING runs the base loop slower (spec §7): 0.6x for the three hovering weapons, 0.3x for the rotating Chakra. */
export const WAITING_SPEED: Record<WeaponId, number> = { gada: 0.6, spear: 0.6, chakra: 0.3, sword: 0.6 };

// ---------------------------------------------------------------------------------------------------------------
// Art: asset ids and the pose mapping.
// ---------------------------------------------------------------------------------------------------------------

/** The five pose tiles of the board, named by the chip above them. Chakra and Sword have no fifth pose: complete is hero. */
export type PoseSlot = "idle" | "research" | "coding" | "testing" | "complete";

const POSES: Record<WeaponId, Record<PoseSlot, string>> = {
  gada: { idle: "gada.pose1", research: "gada.pose2", coding: "gada.pose3", testing: "gada.pose4", complete: "gada.pose5" },
  spear: { idle: "spear.pose1", research: "spear.pose2", coding: "spear.pose3", testing: "spear.pose4", complete: "spear.pose5" },
  chakra: { idle: "chakra.pose1", research: "chakra.pose2", coding: "chakra.pose3", testing: "chakra.pose4", complete: "chakra.hero" },
  sword: { idle: "sword.pose1", research: "sword.pose2", coding: "sword.pose3", testing: "sword.pose4", complete: "sword.hero" },
};

/**
 * Interpretation of the board layout (spec §3): Research -> research tile, Coding and FILE_WORK -> coding tile,
 * Testing and VERIFYING (checking work, not a verified claim) -> testing tile, completed outcomes -> complete tile.
 * Everything else, including the failed and waiting states, stays on the idle tile so no pose claims a result.
 */
export const STATE_POSE: Record<PresentationState, PoseSlot> = {
  UNASSIGNED: "idle",
  IDLE: "idle",
  PLANNING: "idle",
  RESEARCHING: "research",
  CODING: "coding",
  TESTING: "testing",
  FILE_WORK: "coding",
  ACTIVE: "idle",
  VERIFYING: "testing",
  WAITING: "idle",
  WAITING_FOR_USER: "idle",
  PAUSED: "idle",
  COMPLETED: "complete",
  VERIFIED: "complete",
  FAILED: "idle",
  STOPPED: "idle",
  RECOVERING: "idle",
  UNKNOWN: "idle",
  OFFLINE: "idle",
};

/** Art the weapons also use outside the state mapping (alternate hero/portrait tiles). Listed so the coverage test sees all 39. */
export const WEAPON_ALTERNATES: Record<WeaponId, readonly string[]> = {
  gada: ["gada.portrait"],
  spear: ["spear.alt"],
  chakra: [],
  sword: ["sword.alt1", "sword.alt2"],
};

export const COMPANION_ART: Record<CompanionState, string> = {
  SLEEPING: "bunny.sleeping",
  READY: "bunny.idle",
  ARMING: "bunny.listening",
  LISTENING: "bunny.listening",
  LISTENING_WHILE_SPEAKING: "bunny.speaking",
  SPEAKING: "bunny.speaking",
  HELD: "bunny.listening",
  TRANSCRIBING: "bunny.processing",
  WAITING_FOR_RESPONSE: "bunny.processing",
  THINKING: "bunny.thinking",
  INTERRUPTED: "bunny.interrupted",
  PERMISSION: "bunny.listening",
  MUTED: "bunny.idle",
  ERROR: "bunny.interrupted",
  DISCONNECTED: "bunny.sleeping",
  HAPPY: "bunny.happy",
  UNKNOWN: "bunny.idle",
};
/** The identity image (Settings, About, phone Home, Notch at 56 px and up) is the resting companion. */
export const BUNNY_IDENTITY_ART = "bunny.hero";

export const isWeapon = (value: unknown): value is WeaponId =>
  typeof value === "string" && (WEAPONS as readonly string[]).includes(value);

/**
 * The art id for a weapon. Returns null (refuses) for anything that is not one of the four weapons, so an internal team
 * member or a provider can never be drawn as a character, and for a state with no pose mapping.
 */
export function weaponArtId(weapon: unknown, state: PresentationState, size: CharacterSize): string | null {
  if (!isWeapon(weapon)) return null;
  if (size === "compact") return `${weapon}.compact`;
  if (size === "hero") return `${weapon}.hero`;
  const slot = STATE_POSE[state];
  return slot ? POSES[weapon][slot] : null;
}

export function weaponArtUrl(weapon: unknown, state: PresentationState, size: CharacterSize): string | null {
  const id = weaponArtId(weapon, state, size);
  return id ? `${CHARACTER_DIR}/${id}.png` : null;
}

/** The companion art. The hero size shows the identity image only for READY; expressive states keep their board tile. */
export function companionArtId(state: CompanionState, size: CharacterSize): string | null {
  if (size === "hero" && state === "READY") return BUNNY_IDENTITY_ART;
  return COMPANION_ART[state] ?? null;
}

export function companionArtUrl(state: CompanionState, size: CharacterSize): string | null {
  const id = companionArtId(state, size);
  return id ? `${CHARACTER_DIR}/${id}.png` : null;
}

/** Every art id the character system can draw. The test checks this equals the manifest's 39 ids. */
export function allCharacterArtIds(): string[] {
  const ids = new Set<string>(Object.values(COMPANION_ART));
  ids.add(BUNNY_IDENTITY_ART);
  for (const weapon of WEAPONS) {
    ids.add(`${weapon}.compact`);
    ids.add(`${weapon}.hero`);
    for (const id of Object.values(POSES[weapon])) ids.add(id);
    for (const id of WEAPON_ALTERNATES[weapon]) ids.add(id);
  }
  return [...ids].sort();
}

// ---------------------------------------------------------------------------------------------------------------
// Liveness: is the Host view trustworthy right now?
// ---------------------------------------------------------------------------------------------------------------

/**
 * Whether the client may present the Host's states as current. Live only when the connection is `live` or `polling`
 * AND the last canonical snapshot is within SNAPSHOT_FRESH_MS. `connecting`, `reconnecting`, `offline`, `pairing` and
 * `host-changed` are never live, and a `live`/`polling` connection whose snapshot has aged out is not live either.
 */
export function hostLive(connection: Pick<Connection, "state" | "snapshotAt">, now: number): boolean {
  return (
    (connection.state === "live" || connection.state === "polling") &&
    connection.snapshotAt !== null &&
    now - connection.snapshotAt <= SNAPSHOT_FRESH_MS
  );
}

/** The state the character shows: the Host's state while live, OFFLINE (client overlay) otherwise. */
export function displayState(presentation: PresentationState, live: boolean): PresentationState {
  return live ? presentation : "OFFLINE";
}

// ---------------------------------------------------------------------------------------------------------------
// Overlays: badge, ring and tone per state (spec §4, §7, §8).
// ---------------------------------------------------------------------------------------------------------------

export type BadgeKind = "verified" | "completed" | "attention" | "failed" | "paused" | "stopped" | "unknown" | "offline";
export type RingKind = "none" | "amber" | "dashed";
export type CharacterOverlay = {
  badge: BadgeKind | null;
  ring: RingKind;
  /** normal: full colour. muted: desaturated (spec "40 % desaturated"). grey: offline, fully desaturated. */
  tone: "normal" | "muted" | "grey";
  opacity: number;
};

export function characterOverlay(state: PresentationState): CharacterOverlay {
  switch (state) {
    case "VERIFIED": return { badge: "verified", ring: "none", tone: "normal", opacity: 1 };
    case "COMPLETED": return { badge: "completed", ring: "none", tone: "normal", opacity: 1 };
    case "WAITING_FOR_USER": return { badge: "attention", ring: "amber", tone: "normal", opacity: 1 };
    case "FAILED": return { badge: "failed", ring: "none", tone: "muted", opacity: 1 };
    case "PAUSED": return { badge: "paused", ring: "none", tone: "muted", opacity: 1 };
    case "STOPPED": return { badge: "stopped", ring: "none", tone: "muted", opacity: 1 };
    case "RECOVERING": return { badge: null, ring: "dashed", tone: "normal", opacity: 0.6 };
    case "WAITING": return { badge: null, ring: "none", tone: "normal", opacity: 0.8 };
    case "UNKNOWN": return { badge: "unknown", ring: "none", tone: "muted", opacity: 1 };
    case "OFFLINE": return { badge: "offline", ring: "none", tone: "grey", opacity: 0.7 };
    case "UNASSIGNED": return { badge: null, ring: "none", tone: "muted", opacity: 0.5 };
    default: return { badge: null, ring: "none", tone: "normal", opacity: 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Motion descriptor per (weapon, state, reduced). Reduced motion keeps the pose, ring and badge and removes every loop
// and one-shot.
// ---------------------------------------------------------------------------------------------------------------

export type EffectPrimitive = "ring" | "beam" | "motes" | "segments" | "sheets" | "sweep" | "pulse" | "trace";

/** Task effect layer per state and weapon (spec §7). The primitives are shared; weapon data attributes parameterize them. */
const EFFECTS: Partial<Record<PresentationState, Record<WeaponId, EffectPrimitive>>> = {
  PLANNING: { gada: "ring", spear: "segments", chakra: "segments", sword: "pulse" },
  RESEARCHING: { gada: "motes", spear: "beam", chakra: "ring", sword: "sweep" },
  CODING: { gada: "segments", spear: "segments", chakra: "segments", sword: "motes" },
  TESTING: { gada: "pulse", spear: "motes", chakra: "ring", sword: "pulse" },
  FILE_WORK: { gada: "sheets", spear: "sheets", chakra: "sheets", sword: "sheets" },
  VERIFYING: { gada: "trace", spear: "trace", chakra: "trace", sword: "trace" },
};

/** States whose base idle loop keeps running. Settled, paused, failed, unknown and offline states hold the idle pose. */
const BASE_LOOP_STATES = new Set<PresentationState>([
  "IDLE", "PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "ACTIVE", "VERIFYING", "WAITING",
]);

export type CharacterMotion = {
  /** The weapon's idle loop at this state's speed, or null. `counterMs` is Chakra's halo counter-rotation. */
  base: { loop: string; ms: number; ease: string; counterMs: number | null } | null;
  /** The task effect layer drawn over the base loop, or null. */
  effect: { primitive: EffectPrimitive; ms: number; ease: string } | null;
  /** Soft halo breathe while ACTIVE (not Chakra, whose rotation is the whole motion). */
  halo: { ms: number } | null;
  /** Amber ring pulse (WAITING_FOR_USER), a loop. */
  ringPulse: boolean;
  /** Slow dashed ring rotation (RECOVERING), a loop. */
  ringSpin: boolean;
  /** Whether one-shot acknowledgments (verified, failed, completed) may play on an observed transition. */
  oneShots: boolean;
};

const STILL: CharacterMotion = { base: null, effect: null, halo: null, ringPulse: false, ringSpin: false, oneShots: false };

export function characterMotion(weapon: unknown, state: PresentationState, reducedMotion: boolean): CharacterMotion {
  if (reducedMotion || !isWeapon(weapon)) return STILL;
  const spec = WEAPON_BASE[weapon];
  const speed = state === "WAITING" ? WAITING_SPEED[weapon] : 1;
  const base = BASE_LOOP_STATES.has(state)
    ? {
        loop: spec.loop,
        ms: Math.round(spec.ms / speed),
        ease: spec.ease,
        counterMs: spec.counterMs === null ? null : Math.round(spec.counterMs / speed),
      }
    : null;
  const primitive = state === "WAITING" ? undefined : EFFECTS[state]?.[weapon];
  return {
    base,
    effect: primitive ? { primitive, ms: TASK_LOOP_MS, ease: spec.ease } : null,
    halo: state === "ACTIVE" && weapon !== "chakra" ? { ms: MOTION_TOKENS.breathing } : null,
    ringPulse: state === "WAITING_FOR_USER",
    ringSpin: state === "RECOVERING",
    oneShots: true,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One-shot cues: fire only on an observed transition, never on the first observation, never from a client overlay.
// ---------------------------------------------------------------------------------------------------------------

export type TransitionCue = "verified" | "failed" | "completed";

/**
 * The acknowledgment for a move from `prev` to `next`. Null on the first observation, when nothing changed, when the
 * previous state was OFFLINE (a return from offline is not an observed Host transition), and for a VERIFIED to COMPLETED
 * downgrade. `verified` is produced only when the Host state itself is VERIFIED.
 */
export function transitionCue(
  prev: PresentationState | null | undefined,
  next: PresentationState,
  firstObservation: boolean,
): TransitionCue | null {
  if (firstObservation || !prev || prev === next || prev === "OFFLINE") return null;
  if (next === "VERIFIED") return "verified";
  if (next === "FAILED") return "failed";
  if (next === "COMPLETED" && prev !== "VERIFIED") return "completed";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Accessible labels.
// ---------------------------------------------------------------------------------------------------------------

/** "Gada" when unnamed, otherwise "Gada — Research Bot": the weapon identifies the slot, the name identifies the Agent. */
export function weaponName(weapon: WeaponId, displayName?: string | null): string {
  const base = WEAPON_LABEL[weapon];
  const name = (displayName ?? "").trim();
  return !name || name === base ? base : `${base} — ${name}`;
}

/** Plain text for every presentation basis, as expanded views show it ("Host step: filesystem.read"). */
export function basisText(basis: PresentationBasis): string {
  switch (basis.kind) {
    case "unassigned": return "No Agent assigned";
    case "agent-missing": return "Bound Agent not found";
    case "agent-state": return `Host state: ${basis.agentState.toLowerCase().replace(/_/g, " ")}`;
    case "mission-result": return `Mission result: ${basis.verifiedSteps} verified, ${basis.unverifiedSteps} unverified`;
    case "capability": return `Host step: ${basis.action}`;
    case "command": return `Host command: ${basis.classified.replace(/^agent\./, "")}`;
    case "team-step": return `Team step: ${basis.teamKind}`;
    case "provider-event": return `Provider reported: ${basis.event.replace(/^agent\./, "")}`;
    case "step-state": return `Host step: ${basis.stepState}`;
    case "no-category": return "No category reported, shown neutral";
    default: return "Source not recorded";
  }
}

export function characterLabel(input: {
  weapon: WeaponId;
  displayName?: string | null;
  state: PresentationState;
  basis?: PresentationBasis | null;
  note?: string | null;
}): string {
  const head = `${weaponName(input.weapon, input.displayName)}, ${presentationLabel(input.state)}`;
  const detail = input.note ?? (input.basis ? basisText(input.basis) : null);
  return detail ? `${head} (${detail})` : head;
}
