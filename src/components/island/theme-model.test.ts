import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_UI_PREFERENCE, uiThemeView, type UiThemePreference } from "../../lib/bunny-host/ui-theme.ts";
import {
  effectivePreference, hostView, previewOf, readStoredPreference, storedPreference, themeLinkFromSearch, variantToggle,
  type ThemeInputs,
} from "./theme-model.ts";

const pref = (patch: Partial<UiThemePreference>): UiThemePreference => ({ ...DEFAULT_UI_PREFERENCE, ...patch });
const base: ThemeInputs = { host: null, viewer: "workstation", device: null, preview: null, link: { theme: null, variant: null }, cached: null };

test("precedence: preview, then link, then a device's own look, then the Host, then the cache, then the default", () => {
  assert.deepEqual(effectivePreference(base), { preference: DEFAULT_UI_PREFERENCE, origin: "default" });
  assert.equal(effectivePreference({ ...base, cached: pref({ theme: "pixel" }) }).preference.theme, "pixel");
  const host = uiThemeView(pref({ theme: "swiss" }), 3);
  assert.deepEqual(effectivePreference({ ...base, host, cached: pref({ theme: "pixel" }) }).origin, "host");
  // The workstation always shows the Host's choice, even if a device-local value exists in this browser.
  assert.equal(effectivePreference({ ...base, host, device: pref({ theme: "y2k" }) }).preference.theme, "swiss");
  assert.equal(effectivePreference({ ...base, viewer: "device", host, device: pref({ theme: "y2k" }) }).preference.theme, "y2k");
  assert.equal(effectivePreference({ ...base, viewer: "device", host }).preference.theme, "swiss", "a device follows the workstation by default");
  const linked = effectivePreference({ ...base, host, link: { theme: "bento", variant: "dark" } });
  assert.deepEqual([linked.origin, linked.preference.theme, linked.preference.variant], ["link", "bento", "dark"]);
  const preview = effectivePreference({ ...base, host, preview: pref({ theme: "victorian" }) });
  assert.deepEqual([preview.origin, preview.preference.theme], ["preview", "victorian"]);
});

test("links accept only known themes and the two appearances", () => {
  assert.deepEqual(themeLinkFromSearch("?uitheme=cyberpunk&theme=dark"), { theme: "cyberpunk", variant: "dark" });
  assert.deepEqual(themeLinkFromSearch("?uitheme=<script>&theme=sepia"), { theme: null, variant: null });
});

test("stored values round-trip; damaged or foreign-schema values are ignored, never partially applied", () => {
  const stored = storedPreference(pref({ theme: "wabisabi", density: "spacious" }));
  assert.equal(readStoredPreference(stored)?.theme, "wabisabi");
  for (const bad of [null, "", "{", JSON.stringify({ theme: "pixel" }), JSON.stringify({ schema: "other", theme: "pixel" }), JSON.stringify({ schema: "bunny-a.ui-theme.v1", theme: "pixel", grant: true })])
    assert.equal(readStoredPreference(bad), null);
});

test("toggles, previews and Host views", () => {
  assert.deepEqual(variantToggle("dark"), { variant: "light" });
  assert.deepEqual(previewOf(pref({ theme: "glass", density: "compact" }), "luxury"), pref({ theme: "luxury", density: "compact" }));
  assert.equal(hostView({ schema: "bunny-a.ui-theme.v2" }), null);
  assert.equal(hostView(uiThemeView(pref({ theme: "clay" }), 1))?.preference.theme, "clay");
});
