import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  DEFAULT_UI_PREFERENCE, FONT_PROVENANCE, NOTCH_FONTS, UI_THEMES, UI_THEME_IDS, UI_THEME_SCHEMA, UI_THEME_SCHEMA_V1,
  accentInk, contrast, notchTheme, over, parseColor, parseUiPreference, resolveTheme, resolveVariant, themeAttributes,
  themeCssVars, themeManifest, validateUiPreference, type Palette, type UiThemeId, type Variant,
} from "./ui-theme.ts";

const rgb = (value: string, below: [number, number, number]) => {
  const parsed = parseColor(value);
  assert.ok(parsed, `${value} parses as a colour`);
  return over(parsed, below);
};

test("the registry has exactly the 22 directive themes, numbered 1-22, each with a complete design contract", () => {
  assert.equal(UI_THEME_IDS.length, 22);
  assert.deepEqual(UI_THEME_IDS.map((id) => UI_THEMES[id].number), Array.from({ length: 22 }, (_, i) => i + 1));
  for (const id of UI_THEME_IDS) {
    const m = UI_THEMES[id];
    assert.equal(m.id, id);
    assert.ok(m.name.length > 2, `${id}.name`);
    for (const key of ["philosophy", "description", "assets"] as const) assert.ok(m[key].length > 10, `${id}.${key}`);
    assert.ok(m.variants.length >= 1 && m.variants.includes(m.defaultVariant), `${id} default variant exists`);
    for (const variant of m.variants) assert.ok(m.palettes[variant], `${id} has a ${variant} palette`);
    assert.ok(m.motion.base >= m.motion.quick && m.motion.base <= 700, `${id} motion durations`);
    assert.ok(m.motion.language && m.motion.description, `${id} motion language`);
    assert.ok((NOTCH_FONTS as readonly string[]).includes(m.notch.font), `${id} notch font is a Windows system font`);
    assert.ok(m.performance.fallback.length > 5, `${id} performance fallback`);
    for (const role of ["body", "display", "mono"] as const) {
      const font = m.typography[role];
      assert.ok(font === "segoe" || FONT_PROVENANCE[font].license === "OFL-1.1", `${id} ${role} font is OFL or the system font`);
    }
  }
});

test("themes are genuinely different compositions, not recolours", () => {
  const signature = (id: (typeof UI_THEME_IDS)[number]) => {
    const m = UI_THEMES[id];
    return [m.layout, m.home, m.studio, m.nav, m.material, m.typography.display, m.geometry.rLg, m.motion.enter].join("|");
  };
  assert.equal(new Set(UI_THEME_IDS.map(signature)).size, 22, "every theme's structural signature is unique");
  assert.ok(new Set(UI_THEME_IDS.map((id) => UI_THEMES[id].layout)).size >= 6, "at least six shell layouts");
  assert.ok(new Set(UI_THEME_IDS.map((id) => UI_THEMES[id].home)).size >= 8, "at least eight dashboard compositions");
  assert.ok(new Set(UI_THEME_IDS.map((id) => UI_THEMES[id].motion.enter)).size === 22, "every theme has its own entrance motion");
  // The directive: Cybercore and Cyberpunk must stay distinct.
  const a = UI_THEMES.cybercore, b = UI_THEMES.cyberpunk;
  assert.notEqual(a.typography.display, b.typography.display);
  assert.notEqual(a.palettes.dark!.action, b.palettes.dark!.action);
  assert.notEqual(a.motion.enter, b.motion.enter);
  assert.notEqual(a.agentFrame === b.agentFrame && a.notch.shape === b.notch.shape && a.geometry.border === b.geometry.border, true);
});

let failures: string[] = [];
const ok = (cond: boolean, message: string) => { if (!cond) failures.push(message); };
function checkPalette(label: string, p: Palette) {
  const page = rgb(p.page, [255, 255, 255]);
  const backdrops = [page, rgb(p.washA, page), rgb(p.washB, page)];
  for (const base of backdrops) {
    const panel = rgb(p.panel, base);
    const field = rgb(p.field, panel);
    const elevated = rgb(p.elevated, base);
    for (const [name, surface] of [["panel", panel], ["field", field], ["elevated", elevated], ["page", base]] as const) {
      for (const role of ["fg", "muted"] as const) {
        const ratio = contrast(rgb(p[role], surface), surface);
        ok(ratio >= 4.5, `${label}: ${role} on ${name} is ${ratio.toFixed(2)}:1`);
      }
    }
    for (const role of ["positive", "negative", "warning", "working"] as const) {
      const ratio = contrast(rgb(p[role], panel), panel);
      ok(ratio >= 4.5, `${label}: ${role} text on panel is ${ratio.toFixed(2)}:1`);
    }
    const hover = rgb(p.hover, panel);
    ok(contrast(rgb(p.fg, hover), hover) >= 4.5, `${label}: text on hover`);
    const ws = rgb(p.workingSoft, panel);
    ok(contrast(rgb(p.working, ws), ws) >= 4.5, `${label}: selected nav text (working on working-soft) is ${contrast(rgb(p.working, ws), ws).toFixed(2)}:1`);
  }
  const action = rgb(p.action, page);
  const ink = contrast(rgb(p.actionInk, action), action);
  ok(ink >= 4.5, `${label}: button label on action is ${ink.toFixed(2)}:1`);
  const focus = contrast(rgb(p.focus, page), page);
  ok(focus >= 3, `${label}: focus ring on page is ${focus.toFixed(2)}:1`);
}

test("every palette of every theme meets WCAG AA for text, controls and focus (composited over page and washes)", () => {
  for (const id of UI_THEME_IDS)
    for (const [variant, palette] of Object.entries(UI_THEMES[id].palettes)) checkPalette(`${id}/${variant}`, palette!);
  assert.deepEqual(failures, []);
  failures = [];
});

test("high contrast resolves to opaque surfaces, full-strength separators and passing text in every theme", () => {
  for (const id of UI_THEME_IDS)
    for (const variant of UI_THEMES[id].variants) {
      const resolved = resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: id, variant, highContrast: true }, variant === "dark");
      assert.equal(resolved.palette.panel, resolved.palette.panelSolid);
      assert.equal(resolved.palette.shadow, "none");
      assert.equal(resolved.palette.border, resolved.palette.fg);
      checkPalette(`${id}/${variant}/hc`, resolved.palette);
      assert.deepEqual(failures, []);
      assert.equal(themeAttributes(resolved)["data-material"], "solid");
      assert.equal(themeCssVars(resolved)["--blur"], "0px");
    }
});

test("preferences are strict: unknown keys, themes, colours and contrast-failing accents are refused", () => {
  assert.throws(() => validateUiPreference({ theme: "nope" }), /Unsupported theme/);
  assert.throws(() => validateUiPreference({ authority: "admin" }), /Unsupported theme setting/);
  assert.throws(() => validateUiPreference({ accent: "red" }), /#rrggbb/);
  assert.throws(() => validateUiPreference({ accent: "url(javascript:alert(1))" }), /#rrggbb/);
  assert.throws(() => validateUiPreference({ accent: "#777777" }), /contrast/);
  assert.throws(() => validateUiPreference({ highContrast: "yes" }), /true or false/);
  assert.throws(() => validateUiPreference([]), /object/);
  assert.deepEqual(validateUiPreference({ theme: "swiss", accent: "#0047FF" }), { ...DEFAULT_UI_PREFERENCE, theme: "swiss", accent: "#0047ff" });
});

test("a damaged, foreign-schema or future value falls back to the system default (Glassmorphism) instead of throwing", () => {
  for (const bad of [null, "x", 7, { theme: "future-theme" }, { schema: "bunny-a.ui-theme.v9", theme: "pixel" }, { theme: "pixel", extra: 1 }])
    assert.deepEqual(parseUiPreference(bad), DEFAULT_UI_PREFERENCE);
  assert.equal(parseUiPreference({ schema: UI_THEME_SCHEMA, theme: "pixel" }).theme, "pixel");
  assert.equal(themeManifest("missing").id, "glass");
});

test("variants: a single-appearance theme keeps its own, system follows the OS when the theme has both", () => {
  assert.equal(resolveVariant(UI_THEMES.cyberpunk, "light", false), "dark");
  assert.equal(resolveVariant(UI_THEMES.scrapbook, "dark", true), "light");
  assert.equal(resolveVariant(UI_THEMES.swiss, "system", true), "dark");
  assert.equal(resolveVariant(UI_THEMES.swiss, "system", false), "light");
});

test("an accent is applied only when its label and page contrast pass; otherwise the theme's own accent stays and a note says why", () => {
  assert.equal(accentInk("#ffffff"), "#101018");
  assert.equal(accentInk("#000000"), "#ffffff");
  const ok = resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "minimal", accent: "#0047ff" });
  assert.equal(ok.palette.action, "#0047ff");
  assert.equal(ok.notes.length, 0);
  // Pale yellow on the near-white Minimal page is invisible as a focus/selection colour.
  const pale = resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "minimal", accent: "#fff6a0" });
  assert.equal(pale.palette.action, UI_THEMES.minimal.palettes.light!.action);
  assert.equal(pale.notes.length, 1);
});

test("an accent and every theme's own action colour read as text wherever a theme stylesheet uses them as text", () => {
  // Independent review finding 3: 3:1 on the page let a luxury-light gold accent (#b08a3a, ~3.3:1) become button text.
  const gold = resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "luxury", variant: "light", accent: "#b08a3a" });
  assert.equal(gold.palette.action, UI_THEMES.luxury.palettes.light!.action);
  assert.equal(gold.notes.length, 1);
  const dir = new URL("../../components/island/themes/", import.meta.url);
  const textThemes = readdirSync(dir).filter((file) => /color:\s*var\(--action\)/.test(readFileSync(new URL(file, dir), "utf8"))).map((file) => file.replace(/\.css$/, "")).filter((id) => (UI_THEME_IDS as readonly string[]).includes(id));
  assert.ok(textThemes.length >= 5, `found ${textThemes.join(", ")}`);
  for (const id of textThemes as UiThemeId[])
    for (const [variant, p] of Object.entries(UI_THEMES[id].palettes))
      for (const surface of [p!.page, p!.panelSolid]) {
        const ratio = contrast(rgb(p!.action, rgb(surface, [255, 255, 255])), rgb(surface, [255, 255, 255]));
        assert.ok(ratio >= 4.5, `${id}/${variant}: action as text is ${ratio.toFixed(2)}:1`);
      }
});

test("density, transparency and theme tokens reach the CSS variables", () => {
  const compact = themeCssVars(resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "glass", density: "compact" }));
  const spacious = themeCssVars(resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "glass", density: "spacious" }));
  assert.ok(parseFloat(compact["--s4"]) < parseFloat(spacious["--s4"]));
  const low = resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "glass", transparency: "low" });
  assert.equal(low.palette.panel, low.palette.panelSolid);
  assert.equal(themeCssVars(low)["--blur"], "0px");
  assert.equal(themeCssVars(resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "glass", transparency: "high" }))["--blur"], "36px");
  const vars = themeCssVars(resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: "pixel", variant: "dark" }));
  assert.equal(vars["--r-lg"], "0px");
  assert.match(vars["--font-display"], /Pixelify Sans/);
  // No variable value can smuggle markup or a URL: values come from the registry or a strict #rrggbb accent.
  for (const id of UI_THEME_IDS)
    for (const value of Object.values(themeCssVars(resolveTheme({ ...DEFAULT_UI_PREFERENCE, theme: id }))))
      assert.doesNotMatch(value, /url\(|<|>|javascript:|expression\(|@import/i);
});

test("the glass theme reproduces the accepted T13 glass tokens exactly (no regression of the default)", () => {
  const light = UI_THEMES.glass.palettes.light!, dark = UI_THEMES.glass.palettes.dark!;
  assert.equal(light.page, "#eef2fb");
  assert.equal(light.panel, "rgba(255, 255, 255, 0.64)");
  assert.equal(light.action, "#4a5be0");
  assert.equal(dark.page, "#0a0d16");
  assert.equal(dark.action, "#8ea2ff");
});

test("the Notch receives flat, opaque #rrggbb tokens for both appearances and a Windows font", () => {
  for (const id of UI_THEME_IDS)
    for (const highContrast of [false, true]) {
      const notch = notchTheme({ ...DEFAULT_UI_PREFERENCE, theme: id, highContrast });
      // E1: the notch token channel keeps its exact v1 string (the installed island validates it literally).
      assert.equal(notch.schema, UI_THEME_SCHEMA_V1);
      for (const variant of ["light", "dark"] as Variant[])
        for (const [key, value] of Object.entries(notch[variant])) assert.match(value, /^#[0-9a-f]{6}$/, `${id}.${variant}.${key}`);
      for (const variant of ["light", "dark"] as Variant[]) {
        const c = notch[variant];
        const fill = rgb(c.fill, [0, 0, 0]);
        assert.ok(contrast(rgb(c.ink, fill), fill) >= 4.5, `${id}/${variant}${highContrast ? "/hc" : ""}: Notch text ${contrast(rgb(c.ink, fill), fill).toFixed(2)}:1`);
      }
      if (highContrast) assert.equal(notch.glow, false);
    }
});
