import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_UI_PREFERENCE, UI_THEME_SCHEMA, UI_THEME_SCHEMA_V1, type UiThemePreference } from "../../lib/bunny-host/ui-theme.ts";
import {
  LEGACY_GLASS_MAP, effectivePreference, glassLimitedNote, hostView, legacyGlassToIntensity, previewOf,
  readStoredPreference, storedPreference, themeLinkFromSearch,
  type ThemeInputs,
} from "./theme-model.ts";
import { uiThemeView } from "../../lib/bunny-host/ui-theme.ts";

/** E1 Glass Intensity at the window layer: v1 cache/device rows keep reading, v2 rows carry the intensity, the legacy
 *  per-window glass lever maps deterministically, and links may pin an intensity for captures. */

const pref = (patch: Partial<UiThemePreference>): UiThemePreference => ({ ...DEFAULT_UI_PREFERENCE, ...patch });
const base: ThemeInputs = { host: null, viewer: "workstation", device: null, preview: null, link: { theme: null, variant: null, glassIntensity: null }, cached: null };

test("stored rows: v1 and v2 both read; v2 rows carry the intensity; the writer stamps v2", () => {
  const v1 = JSON.stringify({ schema: UI_THEME_SCHEMA_V1, theme: "pixel", density: "spacious" });
  const read = readStoredPreference(v1);
  assert.equal(read?.theme, "pixel");
  assert.equal(read?.glassIntensity, 85, "a v1 row gains the default intensity");
  const v2 = JSON.stringify({ schema: UI_THEME_SCHEMA, theme: "pixel", density: "spacious", glassIntensity: 42 });
  const readV2 = readStoredPreference(v2);
  assert.equal(readV2?.glassIntensity, 42);
  for (const bad of [null, "", "{", JSON.stringify({ theme: "pixel" }), JSON.stringify({ schema: "other", theme: "pixel" }), JSON.stringify({ schema: UI_THEME_SCHEMA, theme: "pixel", grant: true }), JSON.stringify({ schema: UI_THEME_SCHEMA_V1, theme: "pixel", glassIntensity: 42.5 })])
    assert.equal(readStoredPreference(bad), null);
  const stamped = JSON.parse(storedPreference(pref({ theme: "wabisabi" }))) as Record<string, unknown>;
  assert.equal(stamped.schema, UI_THEME_SCHEMA, "saved rows carry the current schema");
  assert.equal(stamped.glassIntensity, 85);
});

test("host views: both known schemas parse; unknown schemas and missing revisions are refused", () => {
  assert.equal(hostView({ schema: "bunny-a.ui-theme.v9" }), null);
  assert.equal(hostView({ schema: UI_THEME_SCHEMA }), null, "a view without a numeric revision is not one");
  const v1Shape = { schema: UI_THEME_SCHEMA_V1, revision: 3, preference: { theme: "clay", variant: "light", accent: null, density: "theme", transparency: "medium", highContrast: false } };
  assert.equal(hostView(v1Shape)?.preference.theme, "clay");
  assert.equal(hostView(v1Shape)?.preference.glassIntensity, 85);
  assert.equal(hostView(uiThemeView(pref({ theme: "clay" }), 1))?.preference.theme, "clay");
});

test("the legacy window glass lever maps onto intensity deterministically (medium = the new default)", () => {
  assert.deepEqual(LEGACY_GLASS_MAP, { low: 30, medium: 85, high: 100 });
  assert.equal(legacyGlassToIntensity("low"), 30);
  assert.equal(legacyGlassToIntensity("medium"), 85);
  assert.equal(legacyGlassToIntensity("high"), 100);
});

test("the limited note appears only when glass cannot render; the stored value is said to be retained", () => {
  assert.equal(glassLimitedNote(pref({})), null);
  assert.equal(glassLimitedNote(pref({ transparency: "low" })), "Effective intensity limited — stored preference retained.");
  assert.equal(glassLimitedNote(pref({ highContrast: true })), "Effective intensity limited — stored preference retained.");
  assert.equal(glassLimitedNote(pref({ transparency: "high" })), null, "more glass is not a limit");
});

test("a link may pin the glass intensity for captures; it merges over any base", () => {
  assert.equal(themeLinkFromSearch("?uitheme=glass&theme=dark&glassintensity=42").glassIntensity, 42);
  assert.equal(themeLinkFromSearch("?glassintensity=-1").glassIntensity, null);
  assert.equal(themeLinkFromSearch("?glassintensity=85.5").glassIntensity, null);
  const host = uiThemeView(pref({ glassIntensity: 85 }), 2);
  const linked = effectivePreference({ ...base, host, link: themeLinkFromSearch("?glassintensity=0") });
  assert.deepEqual([linked.origin, linked.preference.glassIntensity], ["link", 0]);
  const preview = effectivePreference({ ...base, preview: previewOf(pref({}), "bento"), link: themeLinkFromSearch("?glassintensity=100") });
  assert.deepEqual([preview.origin, preview.preference.glassIntensity, preview.preference.theme], ["preview", 100, "bento"]);
});