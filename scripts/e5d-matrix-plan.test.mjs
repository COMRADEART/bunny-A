import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SCREENS, PROFILES, VARIANTS, GLASS_INTENSITIES, MEDIA_CASES, FOCUS_SCREENS, FOCUS_PROFILE_ID,
  caseId, planCases,
} from "./e5d-matrix-plan.mjs";

test("screen list matches the canonical E5A/SCREENS.md inventory exactly", () => {
  // Anchored to docs/ux/e5a/SCREENS.md and scripts/e5a-ui-baseline.mjs; any drift is a TODO-E5C decision.
  assert.deepEqual(SCREENS.map((s) => s.id), [
    "home", "chat", "voice", "tasks", "missions", "projects", "files", "personal-agents",
    "agentic-teams", "studio", "models", "routing", "providers", "lotus-memory",
    "connected-services", "automations", "approvals", "activity", "notifications", "devices",
    "server-control", "telemetry", "widgets", "safety", "settings", "characters",
  ]);
  assert.deepEqual(SCREENS.filter((s) => s.relatedOnly).map((s) => s.id), ["connected-services"]);
  assert.equal(new Set(SCREENS.map((s) => s.id)).size, SCREENS.length);
  for (const screen of SCREENS) assert.ok(screen.view && screen.target, `${screen.id} needs view+target`);
});

test("viewport set covers the E5D responsive matrix", () => {
  assert.deepEqual(PROFILES.map((p) => p.id), [
    "desktop", "narrow-1180", "narrow-1181", "narrow-1280",
    "mobile-375", "mobile-390", "landscape-text125", "ultrawide",
  ]);
  const landscape = PROFILES.find((p) => p.id === "landscape-text125");
  assert.equal(landscape.width, 844);
  assert.equal(landscape.height, 390);
  assert.equal(landscape.textScale, 1.25);
  for (const p of PROFILES.filter((p) => p.id.startsWith("mobile"))) assert.equal(p.isMobile, true);
  assert.equal(caseId("home", "dark", "ultrawide"), "home-graphite-ultrawide");
});

test("plan enumerates screens x variants x profiles plus intensity, media and focus sweeps", () => {
  const cases = planCases();
  assert.equal(cases.length, SCREENS.length * PROFILES.length * VARIANTS.length
    + VARIANTS.length * GLASS_INTENSITIES.length
    + VARIANTS.length * Object.keys(MEDIA_CASES).length
    + VARIANTS.length * FOCUS_SCREENS.length);
  assert.equal(cases.length, 440, "416 screen + 8 intensity + 10 media + 6 focus");
  const ids = new Set(cases.map((c) => c.id));
  assert.equal(ids.size, cases.length, "case ids must be unique");
  assert.deepEqual(
    [...new Set(cases.map((c) => c.kind))].sort(),
    ["focus", "intensity", "media", "screen"],
  );
  const intensity = cases.filter((c) => c.kind === "intensity");
  assert.deepEqual(
    intensity.filter((c) => c.variant === "light").map((c) => c.id),
    ["intensity-0-silver-desktop", "intensity-50-silver-desktop", "intensity-85-silver-desktop", "intensity-100-silver-desktop"],
  );
  assert.deepEqual(
    cases.filter((c) => c.kind === "media" && c.variant === "dark").map((c) => c.id),
    ["high-contrast-graphite-desktop", "reduced-transparency-graphite-desktop", "os-reduced-transparency-graphite-desktop", "reduced-motion-graphite-desktop", "forced-colors-graphite-desktop"],
  );
  // Focus cases: keyboard-focused states at the desktop baseline, both variants, stable ids.
  assert.deepEqual(
    cases.filter((c) => c.kind === "focus").map((c) => c.id),
    [
      "focus-home-silver-desktop", "focus-settings-silver-desktop", "focus-approvals-silver-desktop",
      "focus-home-graphite-desktop", "focus-settings-graphite-desktop", "focus-approvals-graphite-desktop",
    ],
  );
  for (const c of cases.filter((c) => c.kind === "focus")) {
    assert.equal(c.profile.id, FOCUS_PROFILE_ID);
    assert.ok(c.screen.view && c.screen.target, `${c.id} needs a real screen`);
  }
  // The base matrix stays at intensity 85; only the sweep varies it.
  for (const c of cases.filter((c) => c.kind === "screen")) assert.equal(c.options.intensity, undefined);
});

test("subset is an OR substring match over id, screen and profile", () => {
  const mobile = planCases(["mobile-390"]);
  assert.ok(mobile.length > 0);
  assert.ok(mobile.every((c) => c.profile.id === "mobile-390"));
  const settings = planCases(["settings"]);
  for (const id of ["home-silver-desktop", "voice-graphite-ultrawide"])
    assert.ok(!settings.some((c) => c.id === id), `settings subset must exclude ${id}`);
  assert.ok(settings.some((c) => c.id === "settings-silver-desktop"));
  // The intensity/media sweeps capture the Settings screen, so the settings token pulls them.
  assert.ok(settings.some((c) => c.id === "intensity-0-silver-desktop"));
  assert.ok(settings.some((c) => c.id === "forced-colors-graphite-desktop"));
  assert.ok(settings.some((c) => c.id === "focus-settings-silver-desktop"));
  const focus = planCases(["focus"]);
  assert.equal(focus.length, VARIANTS.length * FOCUS_SCREENS.length);
  assert.ok(focus.every((c) => c.kind === "focus"));
  const combo = planCases(["graphite", "mobile-375"]);
  assert.ok(combo.every((c) => c.variant === "dark" || c.profile.id === "mobile-375"));
  assert.ok(planCases(["no-such-token"]).length === 0);
});

test("the runner's documented matrix totals stay in sync with the plan module", () => {
  const runner = readFileSync(new URL("./e5d-capture-matrix.mjs", import.meta.url), "utf8");
  assert.ok(runner.includes("planCases().length} matrix cases."), "runner must report plan totals");
  assert.ok(runner.includes('planCases(subset)'));
});