import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PRESENTATION_STATES, WEAPONS, type PresentationState, type WeaponId } from "../../lib/bunny-host/personal-agents.ts";
import {
  CHARACTER_STYLES,
  CHARACTER_STYLE_LABEL,
  CHARACTER_STYLE_SUMMARY,
  DEFAULT_APPEARANCE,
  SIGNATURE_STYLE,
  STYLE_MATRIX,
  parseAppearance,
  resolvedStyle,
  validateAppearance,
  type CharacterAppearance,
} from "../../lib/bunny-host/character-style.ts";
import { allCharacterArtIds, characterMotion } from "./character-model.ts";
import {
  NOTCH_EDGES,
  PIXEL_GRID,
  SUBTLE_PERIOD,
  isWorking,
  notchLayout,
  notchRole,
  pixelSprite,
  quantize5,
  stillFor,
  stylePresentation,
} from "./character-style-model.ts";

const MANIFEST = new URL("../../../assets/t13/derived/manifest.json", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const appearance = (over: Partial<CharacterAppearance> = {}): CharacterAppearance => ({ ...DEFAULT_APPEARANCE, ...over });
const SETTLED: PresentationState[] = ["COMPLETED", "VERIFIED", "FAILED", "PAUSED", "STOPPED", "OFFLINE", "UNKNOWN", "UNASSIGNED", "WAITING_FOR_USER", "RECOVERING"];

/** Minimal PNG decoder for the runtime art (8-bit RGBA, non-interlaced, as the manifest's processing produces). */
function decodePng(bytes: Buffer): { width: number; height: number; data: Uint8Array } {
  let offset = 8;
  let width = 0, height = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8, "8-bit depth");
      assert.equal(body[9], 6, "RGBA colour type");
      assert.equal(body[12], 0, "non-interlaced");
    }
    if (type === "IDAT") idat.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? data[y * stride + x - 4] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let out = value;
      if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      data[y * stride + x] = out & 0xff;
    }
  }
  return { width, height, data };
}

const art = (id: string) => decodePng(readFileSync(new URL(`public/bunny-a/characters/${id}.png`, ROOT)));

/** Nearest-neighbour upscale of a sprite back to a source size, as image-rendering: pixelated draws it. */
function upscale(sprite: { data: Uint8ClampedArray; width: number; height: number }, width: number, height: number) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sprite.height - 1, Math.floor((y * sprite.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sprite.width - 1, Math.floor((x * sprite.width) / width));
      out.set(sprite.data.subarray((sy * sprite.width + sx) * 4, (sy * sprite.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return out;
}

const silhouetteIoU = (a: Uint8Array, b: Uint8Array) => {
  let inter = 0, union = 0;
  for (let i = 3; i < a.length; i += 4) {
    const inA = a[i] >= 128, inB = b[i] >= 128;
    if (inA && inB) inter++;
    if (inA || inB) union++;
  }
  return union ? inter / union : 1;
};

/** Mean premultiplied colour distance over the union of both silhouettes (0 identical .. ~441 opposite). */
const colourDistance = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 128 && b[i + 3] < 128) continue;
    const pa = a[i + 3] / 255, pb = b[i + 3] / 255;
    sum += Math.hypot(a[i] * pa - b[i] * pb, a[i + 1] * pa - b[i + 1] * pb, a[i + 2] * pa - b[i + 2] * pb);
    n++;
  }
  return n ? sum / n : 0;
};

test("H01 the registry has exactly the five styles, each labelled and described, and the §23 signature defaults", () => {
  assert.deepEqual([...CHARACTER_STYLES], ["glossy", "cel", "arcade", "comic", "pixel"]);
  assert.deepEqual(CHARACTER_STYLE_LABEL, {
    glossy: "Glossy Inflatable",
    cel: "Cel-Shaded",
    arcade: "Arcade",
    comic: "Comic Book",
    pixel: "SNES Pixel Art",
  });
  for (const style of CHARACTER_STYLES) assert.ok(CHARACTER_STYLE_SUMMARY[style].length > 20);
  assert.deepEqual(SIGNATURE_STYLE, { gada: "glossy", spear: "cel", chakra: "arcade", sword: "comic" });
  // SNES Pixel Art is universal: it is nobody's signature, so it is never a fifth identity.
  assert.ok(!Object.values(SIGNATURE_STYLE).includes("pixel"));
});

test("H02 every weapon accepts every style (4 × 5 = 20): no weapon-to-style pairing is enforced", () => {
  assert.equal(STYLE_MATRIX.length, 20);
  for (const { weapon, style } of STYLE_MATRIX) {
    const chosen = validateAppearance({ style });
    assert.equal(resolvedStyle(weapon, chosen), style, `${weapon} wears ${style}`);
    const view = stylePresentation({ weapon, state: "IDLE", appearance: chosen, reduced: false });
    assert.equal(view.style, style);
    assert.equal(view.pixel, style === "pixel");
  }
});

test("H03 appearance validation is strict: unknown keys and values are refused, partial updates keep the rest", () => {
  assert.throws(() => validateAppearance(null), /object/);
  assert.throws(() => validateAppearance([]), /object/);
  assert.throws(() => validateAppearance({ style: "vaporwave" }), /Unsupported character style/);
  assert.throws(() => validateAppearance({ intensity: "max" }), /intensity/);
  assert.throws(() => validateAppearance({ highContrast: "yes" }), /true or false/);
  // Authority-shaped keys are not appearance: they are refused, never silently dropped.
  for (const key of ["permissions", "weapon", "agentId", "missionId", "models", "memory"]) {
    assert.throws(() => validateAppearance({ [key]: "x" }), /Unsupported appearance setting/);
  }
  const current = appearance({ style: "arcade", intensity: "subtle" });
  assert.deepEqual(validateAppearance({ highContrast: true }, current), { style: "arcade", intensity: "subtle", highContrast: true });
  assert.deepEqual(validateAppearance({ style: null }, current), { style: null, intensity: "subtle", highContrast: false });
  assert.deepEqual(parseAppearance({ style: "bogus" }), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("garbage"), DEFAULT_APPEARANCE);
});

test("H04 a slot with no chosen style follows its weapon's signature, including after a weapon swap", () => {
  for (const weapon of WEAPONS) assert.equal(resolvedStyle(weapon, DEFAULT_APPEARANCE), SIGNATURE_STYLE[weapon]);
  assert.equal(resolvedStyle("gada", null), "glossy");
  assert.equal(resolvedStyle("sword", undefined), "comic");
  const chosen = appearance({ style: "pixel" });
  for (const weapon of WEAPONS) assert.equal(resolvedStyle(weapon, chosen), "pixel");
});

test("H05 style motion runs only where the Host-derived state runs the base loop: never on a settled or offline state", () => {
  for (const weapon of WEAPONS) {
    for (const style of CHARACTER_STYLES) {
      for (const state of PRESENTATION_STATES) {
        const view = stylePresentation({ weapon, state, appearance: appearance({ style }), reduced: false });
        const base = characterMotion(weapon, state, false).base;
        assert.equal(view.accent !== null, base !== null, `${weapon}/${style}/${state}`);
        assert.equal(view.ease !== null, base !== null);
      }
      for (const state of SETTLED) {
        const view = stylePresentation({ weapon, state, appearance: appearance({ style }), reduced: false });
        assert.equal(view.accent, null, `${weapon}/${style}/${state} draws no false work or celebration`);
      }
    }
  }
});

test("H06 reduced motion and intensity off stop every style loop; subtle halves the amplitude but keeps the state signal", () => {
  for (const weapon of WEAPONS) {
    for (const style of CHARACTER_STYLES) {
      for (const [reduced, intensity] of [[true, "full"], [false, "off"], [true, "off"]] as const) {
        const view = stylePresentation({ weapon, state: "CODING", appearance: appearance({ style, intensity }), reduced });
        assert.equal(view.accent, null);
        assert.equal(view.ease, null);
        assert.equal(view.amplitude, 0);
      }
      const subtle = stylePresentation({ weapon, state: "CODING", appearance: appearance({ style, intensity: "subtle" }), reduced: false });
      assert.equal(subtle.amplitude, 0.5);
      assert.equal(subtle.periodScale, SUBTLE_PERIOD);
      const full = stylePresentation({ weapon, state: "CODING", appearance: appearance({ style }), reduced: false });
      assert.ok(subtle.accent && full.accent && subtle.accent.ms > full.accent.ms, "subtle is slower as well as smaller");
    }
  }
  assert.equal(stillFor(false, appearance({ intensity: "off" })), true);
  assert.equal(stillFor(true, null), true);
  assert.equal(stillFor(false, null), false);
});

test("H07 high contrast removes decorative overlays and the accent loop and adds a solid outline", () => {
  for (const weapon of WEAPONS) {
    for (const style of CHARACTER_STYLES) {
      const view = stylePresentation({ weapon, state: "RESEARCHING", appearance: appearance({ style, highContrast: true }), reduced: false });
      assert.equal(view.decorations, false);
      assert.equal(view.outline, true);
      assert.equal(view.accent, null);
      assert.ok(view.ease, "the Host-driven base loop still shows work");
      const normal = stylePresentation({ weapon, state: "RESEARCHING", appearance: appearance({ style }), reduced: false });
      assert.equal(normal.decorations, true);
      assert.equal(normal.outline, false);
    }
  }
});

test("H08 WAITING slows the style accent with the base loop; a style never adds a cue or a state", () => {
  for (const weapon of WEAPONS) {
    const active = stylePresentation({ weapon, state: "ACTIVE", appearance: DEFAULT_APPEARANCE, reduced: false });
    const waiting = stylePresentation({ weapon, state: "WAITING", appearance: DEFAULT_APPEARANCE, reduced: false });
    assert.ok(active.accent && waiting.accent);
    assert.ok(waiting.accent.ms > active.accent.ms, `${weapon} waits slower`);
  }
  const keys = Object.keys(stylePresentation({ weapon: "gada", state: "VERIFIED", appearance: DEFAULT_APPEARANCE, reduced: false })).sort();
  assert.deepEqual(keys, ["accent", "amplitude", "decorations", "ease", "outline", "periodScale", "pixel", "style"]);
});

test("H09 canonical artwork is intact: the art set is still the 39 manifest ids and every runtime PNG matches its pinned hash", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { assets: { id: string; runtime: { path: string; sha256: string } }[] };
  assert.equal(manifest.assets.length, 39);
  assert.deepEqual(allCharacterArtIds(), manifest.assets.map((asset) => asset.id).sort());
  for (const asset of manifest.assets) {
    const hash = createHash("sha256").update(readFileSync(new URL(asset.runtime.path, ROOT))).digest("hex");
    assert.equal(hash, asset.runtime.sha256, `${asset.id} is the approved art`);
  }
});

test("H10 pixel sprites: 15-bit colour, one-bit alpha, the long side fits the grid, aspect kept", () => {
  assert.equal(quantize5(0), 0);
  assert.equal(quantize5(255), 255);
  for (let v = 0; v < 256; v++) assert.equal(quantize5(v) & 0b111, quantize5(v) >> 5, "low bits repeat the high bits (5-bit expansion)");
  const source = art("gada.compact");
  const sprite = pixelSprite(source.data, source.width, source.height, PIXEL_GRID.compact);
  assert.equal(sprite.height, 24);
  assert.equal(sprite.width, Math.round((source.width * 24) / source.height));
  const colours = new Set<number>();
  for (let i = 0; i < sprite.data.length; i += 4) {
    assert.ok(sprite.data[i + 3] === 0 || sprite.data[i + 3] === 255);
    if (sprite.data[i + 3]) {
      for (let c = 0; c < 3; c++) assert.equal(sprite.data[i + c], quantize5(sprite.data[i + c]));
      colours.add((sprite.data[i] << 16) | (sprite.data[i + 1] << 8) | sprite.data[i + 2]);
    }
  }
  assert.ok(colours.size > 8, "the sprite keeps the art's colours, not a flat fill");
  // Art smaller than the grid is never upscaled by the downsampler.
  const tiny = pixelSprite(new Uint8Array(4 * 4 * 4).fill(255), 4, 4, 24);
  assert.deepEqual([tiny.width, tiny.height], [4, 4]);
});

test("H12 all four Notch placements keep the four-edge rule: top/bottom left of Bunny in a row, left/right above Bunny in a column", () => {
  assert.deepEqual([...NOTCH_EDGES], ["top", "bottom", "left", "right"]);
  assert.deepEqual(notchLayout("top"), { axis: "row", agents: "left-of-bunny" });
  assert.deepEqual(notchLayout("bottom"), { axis: "row", agents: "left-of-bunny" });
  assert.deepEqual(notchLayout("left"), { axis: "column", agents: "above-bunny" });
  assert.deepEqual(notchLayout("right"), { axis: "column", agents: "above-bunny" });
});

test("H13 the Notch marks the active speaker apart from the Agents still working, from Host facts only", () => {
  // Gada is speaking while idle; Sword keeps coding: Gada gets the speaker mark only, Sword the working mark only.
  assert.deepEqual(notchRole(1, "IDLE", 1), { speaking: true, working: false });
  assert.deepEqual(notchRole(4, "CODING", 1), { speaking: false, working: true });
  // Speaking does not hide work: a speaker that is also working carries both marks.
  assert.deepEqual(notchRole(1, "RESEARCHING", 1), { speaking: true, working: true });
  // Bunny speaking, or no identity (a paired device never receives it): no Agent is marked as the speaker.
  for (const speaker of ["bunny", null, undefined] as const) assert.equal(notchRole(1, "IDLE", speaker).speaking, false);
  for (const state of PRESENTATION_STATES) {
    const expected = ["PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "ACTIVE", "VERIFYING"].includes(state);
    assert.equal(isWorking(state), expected, `${state} ${expected ? "is" : "is not"} work`);
  }
});

test("H11 compact and hero pixel sprites stay recognizable: silhouette overlap and four-way identification against the originals", () => {
  const report: string[] = [];
  for (const size of ["compact", "hero"] as const) {
    const sources = Object.fromEntries(WEAPONS.map((weapon) => [weapon, art(`${weapon}.${size}`)])) as Record<WeaponId, ReturnType<typeof art>>;
    for (const weapon of WEAPONS) {
      const source = sources[weapon];
      const sprite = pixelSprite(source.data, source.width, source.height, PIXEL_GRID[size]);
      const iou = silhouetteIoU(upscale(sprite, source.width, source.height), source.data);
      assert.ok(iou >= 0.75, `${weapon}.${size} silhouette IoU ${iou.toFixed(3)}`);
      const distances = WEAPONS.map((other) => {
        const target = sources[other];
        return { other, d: colourDistance(upscale(sprite, target.width, target.height), target.data) };
      }).sort((a, b) => a.d - b.d);
      assert.equal(distances[0].other, weapon, `${weapon}.${size} pixel sprite is closest to its own art`);
      report.push(`${weapon}.${size} grid=${PIXEL_GRID[size]} iou=${iou.toFixed(3)} margin=${(distances[1].d - distances[0].d).toFixed(1)}`);
    }
  }
  console.log(report.join("\n"));
});
