import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_UI_PREFERENCE, GLASS_RIM_COLORS, NOTCH_THEME_SCHEMA, UI_THEMES, UI_THEME_SCHEMA, UI_THEME_SCHEMA_V1,
  contrast, glassIntensityOf, glassMaterialTokens, notchTheme, over, parseColor, parseUiPreference, resolveTheme,
  scaledGlassShadow, themeAttributes, themeCssVars, validateUiPreference,
} from "./ui-theme.ts";
import type { Palette, UiThemePreference, Variant } from "./ui-theme.ts";

/** E1 Glass Intensity (bunny-a.ui-theme.v2): strict validation, deterministic decoration mapping, v1↔v2 compatibility,
 *  and the two invariants the owner pinned: intensity never touches blur, and text never drops below 4.5:1. */

const pref = (patch: Partial<UiThemePreference>): UiThemePreference => ({ ...DEFAULT_UI_PREFERENCE, ...patch });
const glassLight = (intensity: number, patch: Partial<UiThemePreference> = {}) =>
  pref({ theme: "glass", variant: "light", glassIntensity: intensity, ...patch });
const rgb = (value: string) => parseColor(value)!.rgb;

test("glass intensity validation is strict and authoritative: whole numbers 0-100 only, unknown keys still refused", () => {
  for (const bad of [-1, 101, 1.5, "85", true, null])
    assert.throws(() => validateUiPreference({ glassIntensity: bad }), /whole number from 0 to 100/, String(bad));
  for (const good of [0, 1, 85, 99, 100]) assert.equal(validateUiPreference({ glassIntensity: good }).glassIntensity, good);
  assert.throws(() => validateUiPreference({ GlassIntensity: 85 }), /Unsupported theme setting/);
  assert.throws(() => validateUiPreference({ notAGlass: 1 }), /Unsupported theme setting/);
});

test("the approved mapping hits its published anchors exactly at 0, 50, 85 and 100 (light appearance)", () => {
  const anchors: [number, string, string, string, number][] = [
    [0, "30%", "18%", "1px", 0.55],
    [50, "65%", "49%", "2.5px", 0.875],
    [85, "89.5%", "70.7%", "3.55px", 1.1025],
    [100, "100%", "80%", "4px", 1.2],
  ];
  for (const [intensity, rim, sheen, refraction, depth] of anchors) {
    const resolved = resolveTheme(glassLight(intensity));
    const vars = themeCssVars(resolved);
    assert.equal(vars["--glass-rim"], rim, `rim at ${intensity}`);
    assert.equal(vars["--glass-sheen"], sheen, `sheen at ${intensity}`);
    assert.equal(vars["--glass-refract"], refraction, `refraction at ${intensity}`);
    assert.equal(vars["--glass-depth"], String(depth), `depth at ${intensity}`);
    assert.equal(vars["--glass-intensity"], String(intensity));
    assert.equal(vars["--glass-rim-color"], GLASS_RIM_COLORS.light, "Silver's rim is a pure glint");
    assert.equal(resolved.glass!.intensity, intensity);
    assert.equal(resolved.glass!.limited, false);
  }
  // Dark (Graphite) anchors share the numbers and take their own glint colour.
  const dark = themeCssVars(resolveTheme(glassLight(85, { variant: "dark" })));
  assert.equal(dark["--glass-rim"], "89.5%");
  assert.equal(dark["--glass-rim-color"], GLASS_RIM_COLORS.dark, "Graphite's rim is a cool white glint");
});

test("the owner invariant: intensity never touches blur — only the transparency axis moves it", () => {
  for (const transparency of ["low", "medium", "high"] as const) {
    const blurs = new Set<string>();
    for (let intensity = 0; intensity <= 100; intensity += 1) {
      blurs.add(themeCssVars(resolveTheme(glassLight(intensity, { transparency })))["--blur"]);
    }
    assert.equal(blurs.size, 1, `${transparency}: blur stays one value across all 101 intensities (${[...blurs].join(", ")})`);
  }
  assert.deepEqual(
    (["low", "medium", "high"] as const).map((t) => themeCssVars(resolveTheme(glassLight(85, { transparency: t })))["--blur"]),
    ["0px", "24px", "36px"],
    "blur stays exactly f(transparency): 0 | manifest | ×1.5",
  );
  // No emitted variable value can smuggle markup or a URL.
  for (const intensity of [0, 85, 100])
    for (const value of Object.values(themeCssVars(resolveTheme(glassLight(intensity)))))
      assert.doesNotMatch(value, /url\(|<|>|javascript:|expression\(|@import/i);
});

test("decoration rises monotonically; every cleared panel keeps fg and muted at 4.5:1 over page and washes", () => {
  for (const variant of ["light", "dark"] as const) {
    const washes = {
      a: UI_THEMES.glass.palettes[variant]!.washA,
      b: UI_THEMES.glass.palettes[variant]!.washB,
    };
    let previous: { rim: number; sheen: number; refract: number; depth: number } | undefined;
    for (let intensity = 0; intensity <= 100; intensity += 1) {
      const resolved = resolveTheme(glassLight(intensity, { variant }));
      const glass = resolved.glass!;
      const current = { rim: parseFloat(glass.rim), sheen: parseFloat(glass.sheen), refract: parseFloat(glass.refraction), depth: glass.depth };
      if (previous) {
        assert.ok(current.rim > previous.rim, `rim rises (${variant} @ ${intensity})`);
        assert.ok(current.sheen >= previous.sheen, `sheen rises (${variant} @ ${intensity})`);
        assert.ok(current.refract >= previous.refract, `refraction rises (${variant} @ ${intensity})`);
        assert.ok(current.depth >= previous.depth, `depth rises (${variant} @ ${intensity})`);
      }
      const panelAlpha = parseColor(resolved.palette.panel)!.alpha;
      const page = rgb(resolved.palette.page);
      for (const backdrop of [
        page,
        over({ rgb: rgb(washes.a), alpha: 1 }, page),
        over({ rgb: rgb(washes.b), alpha: 1 }, page),
      ]) {
        const surface = over({ rgb: rgb(resolved.palette.panel), alpha: panelAlpha }, backdrop);
        assert.ok(contrast(rgb(resolved.palette.fg), surface) >= 4.5, `${variant} fg on panel at ${intensity}`);
        assert.ok(contrast(rgb(resolved.palette.muted), surface) >= 4.5, `${variant} muted on panel at ${intensity}`);
        // Controls keep their own alpha but sit on the cleared panel: the stack as rendered stays readable.
        const field = over({ rgb: rgb(resolved.palette.field), alpha: parseColor(resolved.palette.field)!.alpha }, surface);
        assert.ok(contrast(rgb(resolved.palette.fg), field) >= 4.5, `${variant} fg on field over panel at ${intensity}`);
      }
      previous = { rim: parseFloat(glass.rim), sheen: parseFloat(glass.sheen), refract: parseFloat(glass.refraction), depth: glass.depth };
    }
  }
});

test("the clear term clamps to the contrast floor and never exceeds the published ideal", () => {
  for (const variant of ["light", "dark"] as const)
    for (const intensity of [0, 25, 50, 75, 85, 100]) {
      const resolved = resolveTheme(glassLight(intensity, { variant }));
      const ideal = Math.round(0.06 * (intensity / 100) * 1000) / 1000;
      assert.ok(resolved.glass!.clear <= ideal + 0.0001, `clear never exceeds its formula (${variant} @ ${intensity})`);
      if (intensity === 0) assert.equal(resolved.glass!.clear, 0, "intensity 0 clears nothing");
    }
});

test("the preference migration reads v1 and v2 and stamps the default when a v1 row carries no intensity", () => {
  assert.equal(parseUiPreference({ schema: UI_THEME_SCHEMA_V1, theme: "pixel", density: "compact" }).glassIntensity, 85, "v1 rows gain the default");
  assert.equal(parseUiPreference({ schema: UI_THEME_SCHEMA_V1, theme: "pixel", glassIntensity: 42 }).glassIntensity, 42);
  assert.equal(parseUiPreference({ schema: UI_THEME_SCHEMA, theme: "pixel", glassIntensity: 42 }).glassIntensity, 42);
  for (const bad of [
    { schema: "bunny-a.ui-theme.v9", theme: "pixel" },
    { schema: UI_THEME_SCHEMA, theme: "pixel", glassIntensity: 42.5 },
    { schema: UI_THEME_SCHEMA, theme: "pixel", glassIntensity: "85" },
  ])
    assert.deepEqual(parseUiPreference(bad), DEFAULT_UI_PREFERENCE, "foreign schemas and invalid intensities fall back whole");
  // A migrated v1 choice keeps everything else of it untouched.
  const migrated = parseUiPreference({ schema: UI_THEME_SCHEMA_V1, theme: "swiss", variant: "dark", transparency: "high" });
  assert.deepEqual(migrated, { ...pref({ theme: "swiss", variant: "dark", transparency: "high" }) });
});

test("the notch token channel keeps its exact v1 schema and carries the additive glass block", () => {
  for (const [highContrast, variant] of [[false, "light"], [false, "dark"], [true, "light"]] as const) {
    const notch = notchTheme(glassLight(85, { variant, highContrast }));
    assert.equal(notch.schema, UI_THEME_SCHEMA_V1, "the island requires this literal string (Bunny-Island.Theme.ps1)");
    assert.equal(notch.schema, NOTCH_THEME_SCHEMA);
    if (!highContrast) {
      assert.deepEqual(notch.glass, { intensity: 85, rimAlpha: 0.895, sheenAlpha: 0.707 }, "rim/sheen match the approved formulas");
    } else {
      assert.ok(notch.glass.rimAlpha >= 0 && notch.glass.rimAlpha <= 1 && notch.glass.sheenAlpha >= 0 && notch.glass.sheenAlpha <= 1, "bounded under high contrast too");
    }
  }
  assert.deepEqual(notchTheme(glassLight(0)).glass, { intensity: 0, rimAlpha: 0.3, sheenAlpha: 0.18 });
});

test("glass material attributes expose the intensity and the limited explanation", () => {
  const plain = themeAttributes(resolveTheme(glassLight(85)));
  assert.equal(plain["data-glass-intensity"], "85");
  assert.equal(plain["data-glass-limited"], undefined, "no limited note when glass renders fully");
  const limited = themeAttributes(resolveTheme(glassLight(85, { highContrast: true })));
  assert.equal(limited["data-glass-limited"], "true");
  assert.equal(limited["data-material"], "solid");
  const opaque = themeAttributes(resolveTheme(glassLight(85, { transparency: "low" })));
  assert.equal(opaque["data-glass-limited"], "true");
  assert.equal(opaque["data-glass-intensity"], "85", "the stored preference is retained and reported");
});

test("shadow scaling multiplies each layer's px lengths exactly, for glass depth", () => {
  assert.equal(scaledGlassShadow("0 8px 30px rgba(30, 40, 80, 0.1)", 1.25), "0 10px 37.5px rgba(30, 40, 80, 0.1)");
  assert.equal(scaledGlassShadow("none", 2), "none");
  assert.equal(scaledGlassShadow("0 8px 30px rgba(0, 0, 0, 0.4)", 1), "0 8px 30px rgba(0, 0, 0, 0.4)");
  // At the default 85 the glass light shadows grow by depth 1.1025.
  const vars = themeCssVars(resolveTheme(glassLight(85)));
  assert.equal(vars["--shadow"], "0 8.8px 33.1px rgba(30, 40, 80, 0.1)");
  assert.equal(vars["--raised-shadow"], "0 17.6px 52.9px rgba(30, 40, 80, 0.16)");
});

test("non-glass themes resolve without glass tokens (the mechanism stays glass-material) but keep validated intensities", () => {
  const resolved = resolveTheme(pref({ theme: "swiss", variant: "light" }));
  assert.equal(resolved.glass, null);
  assert.equal(themeAttributes(resolved)["data-glass-intensity"], "85", "the preference is carried even where the material does not consume it");
  assert.equal(glassIntensityOf({ ...DEFAULT_UI_PREFERENCE, glassIntensity: 999 }), 100, "the reader clamps defensively");
});