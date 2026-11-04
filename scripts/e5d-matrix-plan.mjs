/** E5D matrix plan: pure data for scripts/e5d-capture-matrix.mjs so the enumeration is
 * importable (and assertable) without a browser. No side effects, no Playwright here.
 *
 * TODO-E5C: extend SCREENS when Lane A lands new reachable screens; unreachable destinations
 * stay capture-honest (BLOCKED, never fabricated). Keep this list in sync with
 * docs/ux/e5a/SCREENS.md and scripts/e5a-ui-baseline.mjs.
 */
export const SCREENS = [
  { id: "home", name: "Home", view: "home", target: ".ch-home" },
  { id: "chat", name: "Chat", view: "chat", target: ".chat-compose" },
  { id: "voice", name: "Voice", view: "settings", group: "Voice", target: ".settings-panel" },
  { id: "tasks", name: "Tasks", view: "tasks", target: ".task-list" },
  { id: "missions", name: "Missions", view: "missions", target: ".workspace-content" },
  { id: "projects", name: "Projects", view: "projects", target: ".workspace-content" },
  { id: "files", name: "Files", view: "files", target: ".workspace-content" },
  { id: "personal-agents", name: "Personal Agents", view: "agents", target: ".workspace-content" },
  { id: "agentic-teams", name: "Agentic Teams", view: "teams", target: ".workspace-content" },
  { id: "studio", name: "Studio", view: "studio", target: ".workspace-content" },
  { id: "models", name: "Models", view: "models", target: ".models-list" },
  {
    id: "routing",
    name: "Routing",
    view: "settings",
    group: "AI & Models",
    tab: "Routing preferences",
    target: ".ai-panel",
  },
  {
    id: "providers",
    name: "Providers",
    view: "settings",
    group: "Providers",
    target: ".settings-panel",
  },
  {
    id: "lotus-memory",
    name: "Lotus Memory",
    view: "studio",
    target: '[id^="memory-"]',
    memory: true,
    note: "Embedded in Studio > Talk to your Agents. Never seed memories; UI navigation only.",
  },
  {
    id: "connected-services",
    name: "Connected Services",
    view: "settings",
    group: "AI & Models",
    tab: "Connected Accounts",
    target: ".ai-panel",
    relatedOnly: true,
    note: "Related Connected Accounts is captured, never relabelled as services coverage.",
  },
  { id: "automations", name: "Automations", view: "tasks", target: '[data-testid="proactive"]' },
  { id: "approvals", name: "Approvals", view: "approvals", target: ".workspace-content" },
  { id: "activity", name: "Activity", view: "activity", target: ".workspace-content" },
  { id: "notifications", name: "Notifications", view: "notifications", target: ".workspace-content" },
  { id: "devices", name: "Devices", view: "devices", target: ".workspace-content" },
  { id: "server-control", name: "Server Control", view: "server", target: ".fabric" },
  { id: "telemetry", name: "Telemetry", view: "telemetry", target: ".workspace-content" },
  { id: "widgets", name: "Widgets", view: "widgets", target: ".workspace-content" },
  {
    id: "safety",
    name: "Safety",
    view: "settings",
    group: "Privacy and permissions",
    target: ".settings-panel",
  },
  { id: "settings", name: "Settings", view: "settings", target: ".settings-panel" },
  { id: "characters", name: "Characters", view: "characters", target: ".workspace-content" },
];

/** F01/F02/F03 probe set: 1180/1181 breakpoint sides, 1280 with sidebar, mobile 375/390,
 * landscape 844x390 at supported 125% text (fontScale sets html fontSize 16*1.25=20px),
 * ultrawide 2560x1440 (F03). 1440x900 is the desktop baseline. */
export const PROFILES = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "narrow-1180", width: 1180, height: 900 },
  { id: "narrow-1181", width: 1181, height: 900 },
  { id: "narrow-1280", width: 1280, height: 900 },
  { id: "mobile-375", width: 375, height: 812, isMobile: true, hasTouch: true },
  { id: "mobile-390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { id: "landscape-text125", width: 844, height: 390, textScale: 1.25 },
  { id: "ultrawide", width: 2560, height: 1440 },
];

export const VARIANTS = ["light", "dark"];
export const THEME_NAMES = { light: "silver", dark: "graphite" };
export const GLASS_INTENSITIES = [0, 50, 85, 100];

/** Material/media precedence cases at Settings × desktop, E5A option vocabulary. */
export const MEDIA_CASES = {
  "high-contrast": { contrast: true },
  "reduced-transparency": { transparency: true },
  "os-reduced-transparency": { reducedTransparencyMedia: true },
  "reduced-motion": { reduceMotion: true },
  "forced-colors": { forcedColors: true },
};

/** Focused-state cases (matrix defect 2): keyboard focus at the desktop baseline, both variants.
 * The runner Tab-presses like a real keyboard user until a control inside the screen's target is
 * focused; ids are stable for tests. 2 variants x 3 screens = 6 cases. */
export const FOCUS_SCREENS = ["home", "settings", "approvals"];
export const FOCUS_PROFILE_ID = "desktop";

export function caseId(prefix, variant, profileId) {
  return `${prefix}-${THEME_NAMES[variant]}-${profileId}`;
}

export function caseIncluded(idText, tokens = []) {
  return !tokens.length || tokens.some((token) => idText.includes(token));
}

/** Enumerates the whole matrix: screens x variants x profiles, then the Settings x desktop
 * intensity, media and keyboard-focus sweeps. --subset tokens are OR-matched against
 * "<id> <screen id>". */
export function planCases(tokens = []) {
  const settings = SCREENS.find((s) => s.id === "settings");
  const cases = [];
  for (const variant of VARIANTS)
    for (const profile of PROFILES)
      for (const screen of SCREENS)
        cases.push({
          kind: "screen",
          screen,
          profile,
          variant,
          prefix: screen.id,
          options: {},
        });
  for (const variant of VARIANTS)
    for (const intensity of GLASS_INTENSITIES)
      cases.push({
        kind: "intensity",
        screen: settings,
        profile: PROFILES[0],
        variant,
        prefix: `intensity-${intensity}`,
        options: { intensity },
      });
  for (const variant of VARIANTS)
    for (const [name, options] of Object.entries(MEDIA_CASES))
      cases.push({
        kind: "media",
        screen: settings,
        profile: PROFILES[0],
        variant,
        prefix: name,
        options,
      });
  for (const variant of VARIANTS)
    for (const id of FOCUS_SCREENS)
      cases.push({
        kind: "focus",
        screen: SCREENS.find((s) => s.id === id),
        profile: PROFILES.find((p) => p.id === FOCUS_PROFILE_ID),
        variant,
        prefix: `focus-${id}`,
        options: {},
      });
  return cases
    .map((c) => ({ ...c, id: caseId(c.prefix, c.variant, c.profile.id) }))
    .filter((c) => caseIncluded(`${c.id} ${c.screen.id} ${c.profile.id} ${c.variant}`, tokens));
}