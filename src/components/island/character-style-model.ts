import {
  CHARACTER_STYLES,
  DEFAULT_APPEARANCE,
  resolvedStyle,
  type CharacterAppearance,
  type CharacterAppearanceView,
  type CharacterStyle,
} from "../../lib/bunny-host/character-style.ts";
import type { PresentationState, WeaponId } from "../../lib/bunny-host/personal-agents.ts";
import { EASE, WEAPON_BASE, characterMotion, isWeapon, type CharacterSize } from "./character-model.ts";

/**
 * T13.3 Gate H style presentation (pure). A style changes how the canonical art is drawn (material, linework, motion
 * flavour, accent effect); characterMotion() still decides WHETHER anything moves, from the Host-derived state alone.
 * So a style can never animate a settled, paused, failed or offline character, and changing style never produces a cue.
 */

export type StyleAccent = "orb-pulse" | "light-sweep" | "radial-pulse" | "ink-sheen" | "pixel-blink";

const STYLE_SPEC: Record<CharacterStyle, { accent: StyleAccent; ms: number; ease: string; steps: number | null }> = {
  glossy: { accent: "orb-pulse", ms: 2400, ease: "cubic-bezier(.34,1.4,.64,1)", steps: null },
  cel: { accent: "light-sweep", ms: 3000, ease: EASE.precise, steps: null },
  arcade: { accent: "radial-pulse", ms: 2400, ease: EASE.orbital, steps: null },
  comic: { accent: "ink-sheen", ms: 3600, ease: EASE.emphasized, steps: null },
  pixel: { accent: "pixel-blink", ms: 1600, ease: "steps(4, end)", steps: 4 },
};

export const SUBTLE_PERIOD = 1.6;

export type StylePresentation = {
  style: CharacterStyle;
  /** Easing that flavours the weapon's own base loop (stepped for pixel art). Null when nothing moves. */
  ease: string | null;
  /** The style's accent loop, synchronised to the base loop's speed. Null whenever the base loop is not running. */
  accent: { kind: StyleAccent; ms: number } | null;
  /** Motion amplitude: 1 full, 0.5 subtle, 0 off. */
  amplitude: number;
  /** Loop period multiplier: subtle motion is also slower. A rotation has no amplitude, so this is its only control. */
  periodScale: number;
  /** Decorative material overlays (gloss, halftone, scanlines, glow). Off in high contrast. */
  decorations: boolean;
  /** Solid high-contrast outline around the art. */
  outline: boolean;
  /** Pixel art is drawn from a downsampled sprite with nearest-neighbour scaling. */
  pixel: boolean;
};

/** Whether all motion is off for this character: the system or app reduced-motion setting, or this slot's intensity. */
export function stillFor(reduced: boolean, appearance: CharacterAppearance | null | undefined): boolean {
  return reduced || (appearance ?? DEFAULT_APPEARANCE).intensity === "off";
}

export function stylePresentation(input: {
  weapon: WeaponId;
  state: PresentationState;
  appearance: CharacterAppearance | null | undefined;
  reduced: boolean;
}): StylePresentation {
  const appearance = input.appearance ?? DEFAULT_APPEARANCE;
  const style = resolvedStyle(input.weapon, appearance);
  const spec = STYLE_SPEC[style];
  const still = stillFor(input.reduced, appearance);
  const base = isWeapon(input.weapon) ? characterMotion(input.weapon, input.state, still).base : null;
  const speed = base ? WEAPON_BASE[input.weapon].ms / base.ms : 1;
  const periodScale = appearance.intensity === "subtle" ? SUBTLE_PERIOD : 1;
  return {
    style,
    ease: base ? spec.ease : null,
    accent: base && !appearance.highContrast ? { kind: spec.accent, ms: Math.round((spec.ms * periodScale) / speed) } : null,
    amplitude: still ? 0 : appearance.intensity === "subtle" ? 0.5 : 1,
    periodScale,
    decorations: !appearance.highContrast,
    outline: appearance.highContrast,
    pixel: style === "pixel",
  };
}

const WORKING = new Set<PresentationState>(["PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "ACTIVE", "VERIFYING"]);

/** Whether the Host reports this slot as doing work right now (waiting, paused and settled states are not work). */
export const isWorking = (state: PresentationState) => WORKING.has(state);

/** The Notch marker for one slot: the conversational speaker, still working, or neither. Both may hold at once. */
export function notchRole(slot: number, state: PresentationState, speaker: number | "bunny" | null | undefined) {
  return { speaking: speaker === slot, working: isWorking(state) };
}

export const NOTCH_EDGES = ["top", "bottom", "left", "right"] as const;
export type NotchEdge = (typeof NOTCH_EDGES)[number];

/**
 * The four-edge rule the native Notch uses (Get-BunnyIndicatorLayout): on a top or bottom edge the Agents sit in one row
 * to the left of Bunny; on a left or right edge they sit in one column above Bunny. Styles never change it.
 */
export function notchLayout(edge: NotchEdge): { axis: "row" | "column"; agents: "left-of-bunny" | "above-bunny" } {
  return edge === "left" || edge === "right" ? { axis: "column", agents: "above-bunny" } : { axis: "row", agents: "left-of-bunny" };
}

/** A slot's appearance from the Host view; null (signature defaults) when the Host has not sent one. */
export function appearanceFor(view: CharacterAppearanceView | null | undefined, slot: number | null | undefined): CharacterAppearance | null {
  if (!view || slot === null || slot === undefined) return null;
  return view.slots.find((row) => row.slot === slot)?.appearance ?? null;
}

export const styleSpec = (style: CharacterStyle) => STYLE_SPEC[style];
export const allStyles = (): readonly CharacterStyle[] => CHARACTER_STYLES;

// ---------------------------------------------------------------------------------------------------------------
// SNES-style pixel sprite: derived at runtime from the canonical PNG (never a separate asset), so provenance is the
// same file and hash the manifest pins.
// ---------------------------------------------------------------------------------------------------------------

/** Sprite long side per character size. Compact stays readable at 24 cells. */
export const PIXEL_GRID: Record<CharacterSize, number> = { compact: 24, pose: 32, hero: 48 };

/** 15-bit colour (5 bits per channel, as the SNES palette), expanded back to 8 bits. */
export const quantize5 = (value: number) => {
  const five = Math.round((Math.max(0, Math.min(255, value)) / 255) * 31);
  return (five << 3) | (five >> 2);
};

/**
 * Box-downsample RGBA to `grid` cells on the long side. Colour is alpha-weighted and quantised to 15 bits; alpha is
 * one bit (cell coverage at or above `alphaCut`), as SNES sprites have. Pure: works on any RGBA buffer.
 */
export function pixelSprite(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  grid: number,
  alphaCut = 0.5,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const scale = Math.min(1, grid / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const data = new Uint8ClampedArray(outW * outH * 4);
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * height) / outH);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * width) / outW);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outW));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha;
          g += rgba[i + 1] * alpha;
          b += rgba[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (oy * outW + ox) * 4;
      const coverage = n ? a / n : 0;
      if (coverage >= alphaCut && a > 0) {
        data[o] = quantize5(r / a);
        data[o + 1] = quantize5(g / a);
        data[o + 2] = quantize5(b / a);
        data[o + 3] = 255;
      }
    }
  }
  return { data, width: outW, height: outH };
}
