/**
 * M-A-3 T13.3 Gate H: the character style registry (pure). A style is a presentation skin drawn over the user's canonical
 * board art: material, linework, shading, motion flavour and effects. It never changes which Agent a slot is, what it may
 * do, what it remembers or which models it may use. Any of the four weapons can wear any of the five styles; the
 * signature pairing is only the default a slot shows until its owner picks something else.
 */
import { SLOT_IDS, WEAPONS, type SlotId, type WeaponId } from "./personal-agents.ts";

export const CHARACTER_STYLES = ["glossy", "cel", "arcade", "comic", "pixel"] as const;
export type CharacterStyle = (typeof CHARACTER_STYLES)[number];

export const CHARACTER_STYLE_LABEL: Record<CharacterStyle, string> = {
  glossy: "Glossy Inflatable",
  cel: "Cel-Shaded",
  arcade: "Arcade",
  comic: "Comic Book",
  pixel: "SNES Pixel Art",
};

export const CHARACTER_STYLE_SUMMARY: Record<CharacterStyle, string> = {
  glossy: "Rounded reflective highlights, a weighted bounce and a soft orb glow.",
  cel: "Hard light boundaries, clean colour blocks and a sharp light sweep.",
  arcade: "Neon edges, a radial pulse and orbiting energy.",
  comic: "Ink outlines, halftone accents and an illustrated sheen.",
  pixel: "Crisp pixels from the same art, stepped motion and no blur at any size.",
};

/** The default look per weapon (directive §23). A suggestion only: nothing enforces it. */
export const SIGNATURE_STYLE: Record<WeaponId, CharacterStyle> = { gada: "glossy", spear: "cel", chakra: "arcade", sword: "comic" };

export const ANIMATION_INTENSITIES = ["full", "subtle", "off"] as const;
export type AnimationIntensity = (typeof ANIMATION_INTENSITIES)[number];

export type CharacterAppearance = {
  /** null follows the weapon's signature style, so a weapon swap shows the new weapon's signature. */
  style: CharacterStyle | null;
  intensity: AnimationIntensity;
  highContrast: boolean;
};

export const DEFAULT_APPEARANCE: CharacterAppearance = { style: null, intensity: "full", highContrast: false };
export const CHARACTER_APPEARANCE_SCHEMA = "bunny-a.character-appearance.v1";

const KEYS = new Set(["style", "intensity", "highContrast"]);

export const isCharacterStyle = (value: unknown): value is CharacterStyle =>
  typeof value === "string" && (CHARACTER_STYLES as readonly string[]).includes(value);

/** Strict: unknown keys or values are refused, never coerced. Missing keys keep the current value. */
export function validateAppearance(input: unknown, current: CharacterAppearance = DEFAULT_APPEARANCE): CharacterAppearance {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Appearance must be an object.");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!KEYS.has(key)) throw new Error(`Unsupported appearance setting: ${key}.`);
  const next = { ...current };
  if ("style" in record) {
    if (record.style !== null && !isCharacterStyle(record.style)) throw new Error("Unsupported character style.");
    next.style = record.style as CharacterStyle | null;
  }
  if ("intensity" in record) {
    if (!(ANIMATION_INTENSITIES as readonly unknown[]).includes(record.intensity)) throw new Error("Unsupported animation intensity.");
    next.intensity = record.intensity as AnimationIntensity;
  }
  if ("highContrast" in record) {
    if (typeof record.highContrast !== "boolean") throw new Error("High contrast must be true or false.");
    next.highContrast = record.highContrast;
  }
  return next;
}

/** A stored row read back: anything damaged falls back to the default rather than throwing. */
export function parseAppearance(input: unknown): CharacterAppearance {
  try {
    return validateAppearance(input);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function resolvedStyle(weapon: WeaponId, appearance: Pick<CharacterAppearance, "style"> | null | undefined): CharacterStyle {
  return appearance?.style ?? SIGNATURE_STYLE[weapon];
}

export type CharacterAppearanceView = {
  schema: typeof CHARACTER_APPEARANCE_SCHEMA;
  slots: { slot: SlotId; appearance: CharacterAppearance }[];
};

export function appearanceView(read: (slot: SlotId) => CharacterAppearance): CharacterAppearanceView {
  return { schema: CHARACTER_APPEARANCE_SCHEMA, slots: SLOT_IDS.map((slot) => ({ slot, appearance: read(slot) })) };
}

/** Every weapon × style pairing the registry supports (20). */
export const STYLE_MATRIX: readonly { weapon: WeaponId; style: CharacterStyle }[] = WEAPONS.flatMap((weapon) =>
  CHARACTER_STYLES.map((style) => ({ weapon, style })),
);
