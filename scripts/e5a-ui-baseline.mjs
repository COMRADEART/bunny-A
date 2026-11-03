#!/usr/bin/env node
/** E5A: actual application baseline, never generated UI or injected Host fixtures.
 * Run against an already started, isolated Host + built preview. No task is submitted,
 * microphone started, provider authenticated, permission granted or approval accepted.
 * UI-only navigation and appearance previews are allowed; fresh browser contexts per case.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

export const SCREENS = [
  { id: "home", name: "Home", view: "home", target: ".ch-home", source: "chat-home.tsx" },
  {
    id: "chat",
    name: "Chat",
    view: "chat",
    target: ".chat-compose",
    source: "chat-home.tsx",
    note: "Home and Chat share the same routed composer; not a separate chat-history page.",
  },
  {
    id: "voice",
    name: "Voice",
    view: "settings",
    group: "Voice",
    target: ".settings-panel",
    source: "voice-personalization.tsx",
    note: "Voice preferences only. Live VoicePanel requires a Host voice session; no microphone started by audit.",
  },
  { id: "tasks", name: "Tasks", view: "tasks", target: ".task-list", source: "surfaces.tsx" },
  {
    id: "missions",
    name: "Missions",
    view: "missions",
    target: ".workspace-content",
    source: "agentic.tsx",
  },
  {
    id: "projects",
    name: "Projects",
    view: "projects",
    target: ".workspace-content",
    source: "projects.tsx",
  },
  { id: "files", name: "Files", view: "files", target: ".workspace-content", source: "files.tsx" },
  {
    id: "personal-agents",
    name: "Personal Agents",
    view: "agents",
    target: ".workspace-content",
    source: "surfaces.tsx",
  },
  {
    id: "agentic-teams",
    name: "Agentic Teams",
    view: "teams",
    target: ".workspace-content",
    source: "surfaces.tsx",
  },
  {
    id: "studio",
    name: "Studio",
    view: "studio",
    target: ".workspace-content",
    source: "studio.tsx",
  },
  { id: "models", name: "Models", view: "models", target: ".models-list", source: "premium.tsx" },
  {
    id: "routing",
    name: "Routing",
    view: "settings",
    group: "AI & Models",
    tab: "Routing preferences",
    target: ".ai-panel",
    source: "ai-models.tsx",
  },
  {
    id: "providers",
    name: "Providers",
    view: "settings",
    group: "Providers",
    target: ".settings-panel",
    source: "settings.tsx",
  },
  {
    id: "lotus-memory",
    name: "Lotus Memory",
    view: "studio",
    target: '[id^="memory-"]',
    source: "memory.tsx",
    memory: true,
    note: "Embedded in Studio > Talk to your Agents > choose an existing Host slot. Never seed memories.",
  },
  {
    id: "connected-services",
    name: "Connected Services",
    view: "settings",
    group: "AI & Models",
    tab: "Connected Accounts",
    target: ".ai-panel",
    source: "accounts.tsx",
    relatedOnly: true,
    note: "No Connected Services destination exists. Related Connected Accounts is captured, not relabelled as services coverage.",
  },
  {
    id: "automations",
    name: "Automations",
    view: "tasks",
    target: '[data-testid="proactive"]',
    source: "proactive.tsx",
    note: "Embedded Goals, schedules and monitors; capture only when Host snapshot makes it available.",
  },
  {
    id: "approvals",
    name: "Approvals",
    view: "approvals",
    target: ".workspace-content",
    source: "approvals.tsx",
  },
  {
    id: "activity",
    name: "Activity",
    view: "activity",
    target: ".workspace-content",
    source: "premium.tsx",
  },
  {
    id: "notifications",
    name: "Notifications",
    view: "notifications",
    target: ".workspace-content",
    source: "desktop.tsx",
  },
  {
    id: "devices",
    name: "Devices",
    view: "devices",
    target: ".workspace-content",
    source: "premium.tsx",
  },
  {
    id: "server-control",
    name: "Server Control",
    view: "server",
    target: ".fabric",
    source: "fabric.tsx",
  },
  {
    id: "telemetry",
    name: "Telemetry",
    view: "telemetry",
    target: ".workspace-content",
    source: "telemetry.tsx",
  },
  {
    id: "widgets",
    name: "Widgets",
    view: "widgets",
    target: ".workspace-content",
    source: "widgets.tsx",
  },
  {
    id: "safety",
    name: "Safety",
    view: "settings",
    group: "Privacy and permissions",
    target: ".settings-panel",
    source: "mission.tsx",
    note: "Privacy and permissions is the existing safety surface; do not change authorization.",
  },
  {
    id: "settings",
    name: "Settings",
    view: "settings",
    target: ".settings-panel",
    source: "theme-gallery.tsx",
  },
  {
    id: "characters",
    name: "Characters (additional navigable section)",
    view: "characters",
    target: ".workspace-content",
    source: "surfaces.tsx",
  },
];
export const PROFILES = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "windows-narrow", width: 1024, height: 900 },
  { id: "mobile-web", width: 390, height: 844, isMobile: true, hasTouch: true },
];
if (process.env.E5A_ISOLATED_HOST !== "1")
  throw Error("Set E5A_ISOLATED_HOST=1 only after starting a separate audit Host state directory.");
const base = new URL(process.argv[2] || "http://127.0.0.1:8082/");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:")
  throw Error("Audit requires a local isolated app, never production.");
const out = resolve(process.argv[3] || "docs/ux/e5a/evidence");
mkdirSync(out, { recursive: true });
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const previous =
  process.env.E5A_APPEND === "1"
    ? JSON.parse(readFileSync(resolve(out, "baseline.json"), "utf8"))
    : null;
const selected = process.env.E5A_SCREENS?.split(",");
const report = previous ?? {
  schema: "bunny-a.e5a-baseline.v1",
  sourceCommit: sha,
  capturedAt: new Date().toISOString(),
  base: base.origin,
  runtime: "Real built application; isolated Host; no mocked API responses or seeded tasks.",
  qualification:
    "Browser viewport emulation, not installed Windows/native Android or physical-device qualification.",
  screens: SCREENS,
  profiles: PROFILES,
  captures: [],
  checks: [],
};
const browser = await chromium.launch({ headless: true });
const save = () =>
  writeFileSync(resolve(out, "baseline.json"), JSON.stringify(report, null, 2) + "\n");
async function capture(screen, profile, variant, options = {}) {
  const id = `${options.prefix || screen.id}-${variant === "light" ? "silver" : "graphite"}-${profile.id}`;
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    isMobile: !!profile.isMobile,
    hasTouch: !!profile.hasTouch,
    colorScheme: variant,
    reducedMotion: options.reduceMotion ? "reduce" : "no-preference",
    forcedColors: options.forcedColors ? "active" : "none",
  });
  const page = await context.newPage();
  const errors = [],
    failedResources = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) failedResources.push({ status: r.status(), url: r.url().split("?")[0] });
  });
  const record = {
    id,
    section: screen.id,
    variant,
    profile: profile.id,
    status: "PARTIAL",
    notes: [],
    consoleErrors: errors,
    failedResources,
  };
  try {
    const params = new URLSearchParams({
      view: screen.view,
      uitheme: "glass",
      theme: variant,
      glassintensity: String(options.intensity ?? 85),
    });
    if (options.companion) {
      params.set("companion", "1");
      if (options.phoneTab) params.set("tab", options.phoneTab);
    }
    const response = await page.goto(new URL("?" + params, base).href, {
      waitUntil: "domcontentloaded",
    });
    record.httpStatus = response.status();
    record.url = page.url();
    await page
      .locator(
        `.bunny-app[data-theme="${variant}"][data-glass-intensity="${options.intensity ?? 85}"]`,
      )
      .waitFor({ timeout: 25000 });
    await page
      .waitForFunction(
        () =>
          !!document.querySelector(
            '.stream-indicator[data-connection="live"], .stream-indicator[data-connection="polling"], .stream-indicator[data-connection="offline"], .pc-root[data-status="live"]',
          ),
        { timeout: 12000 },
      )
      .catch(() =>
        record.notes.push("Host did not reach a settled connection indicator in 12 seconds."),
      );
    if (screen.group)
      await page
        .getByRole("navigation", { name: "Settings groups" })
        .getByRole("button", { name: screen.group, exact: true })
        .click();
    if (screen.tab) await page.getByRole("tab", { name: screen.tab, exact: true }).click();
    if (screen.memory) {
      const choices = page.getByRole("radiogroup", { name: "Who answers" }).getByRole("radio");
      if ((await choices.count()) > 1 && (await choices.nth(1).isEnabled()))
        await choices.nth(1).click();
    }
    if (options.contrast || options.transparency) {
      await page
        .getByRole("button", { name: "Preview Glassmorphism without applying it", exact: true })
        .click();
      if (options.contrast)
        await page.getByRole("switch", { name: "High contrast", exact: true }).click();
      if (options.transparency)
        await page.getByLabel("Transparency", { exact: true }).selectOption("low");
    }
    if (options.reducedTransparencyMedia) {
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
      });
    }
    if (options.collapse)
      await page.getByRole("button", { name: "Context panel", exact: true }).click();
    if (options.focus) await page.getByRole("button", { name: "Focus", exact: true }).click();
    const target = page.locator(options.companion ? ".workspace-content" : screen.target).first();
    const exists = await target.waitFor({ state: "visible", timeout: 3000 }).then(
      () => true,
      () => false,
    );
    if (exists) await target.scrollIntoViewIfNeeded();
    else
      record.notes.push(
        "Requested embedded surface absent from this genuine Host state; screenshot is its parent, not coverage of the missing surface.",
      );
    await page.waitForTimeout(350);
    await page.evaluate(() => document.fonts.ready);
    record.measurements = await page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          display: s.display,
          columns: s.gridTemplateColumns,
          maxWidth: s.maxWidth,
          blur: s.backdropFilter,
          background: s.backgroundColor,
        };
      };
      const visible = (e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const controls = [
        ...document.querySelectorAll("main button,main input,main select,main textarea"),
      ].filter(visible);
      const small = controls
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        })
        .map((e) => ({
          tag: e.tagName,
          label: e.getAttribute("aria-label") || e.textContent.trim().slice(0, 60),
          width: Math.round(e.getBoundingClientRect().width),
          height: Math.round(e.getBoundingClientRect().height),
        }));
      const clipped = [...document.querySelectorAll("main *")]
        .filter(visible)
        .filter(
          (e) =>
            e.scrollWidth > e.clientWidth + 3 &&
            ["hidden", "clip"].includes(getComputedStyle(e).overflowX),
        )
        .slice(0, 25)
        .map((e) => ({
          tag: e.tagName,
          class: e.className,
          width: e.clientWidth,
          scrollWidth: e.scrollWidth,
        }));
      const root = document.querySelector(".bunny-app");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        documentWidth: document.documentElement.scrollWidth,
        bodyTextLength: document.body.innerText.length,
        headings: [...document.querySelectorAll("main h1,main h2,main h3")]
          .map((e) => e.textContent.trim())
          .slice(0, 30),
        root: Object.fromEntries(
          [...root.attributes]
            .filter((a) => a.name.startsWith("data-"))
            .map((a) => [a.name, a.value]),
        ),
        main: box(".workspace-content"),
        split: box(".workspace-split"),
        sidebar: box(".app-sidebar"),
        inspector: box(".cx-panel"),
        widgetSidebar: box(".widget-sidebar"),
        settings: box(".settings-layout"),
        settingsPanel: box(".settings-panel"),
        material: box(".t8-surface,.glass"),
        smallControls: small,
        clippedCandidates: clipped,
        connection: document.querySelector(".stream-indicator")?.getAttribute("data-connection"),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        reducedTransparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
        forcedColors: matchMedia("(forced-colors: active)").matches,
      };
    });
    record.screenshot = `${id}.png`;
    await page.screenshot({ path: resolve(out, record.screenshot), fullPage: false });
    // A focused embedded panel is additionally captured to retain content below the viewport.
    if (exists && ![".workspace-content", ".ch-home"].includes(screen.target)) {
      const bounds = await target.boundingBox();
      if (bounds && bounds.width > 0 && bounds.height > 0 && bounds.height < 7000) {
        record.panelScreenshot = `${id}-panel.png`;
        await target.screenshot({ path: resolve(out, record.panelScreenshot) });
      }
    }
    record.status = !exists
      ? "BLOCKED"
      : errors.length || record.measurements.horizontalOverflow || record.httpStatus !== 200
        ? "FAIL"
        : "PARTIAL";
    if (screen.relatedOnly) {
      record.status = "BLOCKED";
      record.notes.push(screen.note);
    }
    if (exists && !screen.relatedOnly && record.status !== "FAIL")
      record.notes.push(
        "Capture PASS; visual/interaction acceptance remains PARTIAL until reviewed.",
      );
    if (screen.memory && (await page.getByRole("radiogroup", { name: "Who answers" }).count()))
      await page
        .getByRole("radiogroup", { name: "Who answers" })
        .getByRole("radio")
        .first()
        .click();
  } catch (e) {
    record.status = "BLOCKED";
    record.notes.push(String(e.message));
  } finally {
    report.captures = report.captures.filter((r) => r.id !== record.id);
    report.captures.push(record);
    save();
    await context.close();
    console.log(`${record.status} ${id}`);
  }
}
try {
  for (const profile of PROFILES)
    for (const variant of ["light", "dark"])
      for (const screen of SCREENS.filter((s) => !selected || selected.includes(s.id)))
        await capture(screen, profile, variant);
  if (selected?.includes("companion")) {
    for (const variant of ["light", "dark"])
      for (const tab of ["home", "chat", "agents", "missions", "settings"]) {
        const home = SCREENS[0];
        await capture(
          tab === "home" ? home : { ...home, id: `companion-${tab}`, name: `Companion ${tab}` },
          PROFILES[2],
          variant,
          {
            prefix: tab === "home" ? "companion" : `companion-${tab}`,
            companion: true,
            phoneTab: tab,
          },
        );
      }
  }
  const settings = SCREENS.find((x) => x.id === "settings"),
    server = SCREENS.find((x) => x.id === "server-control"),
    home = SCREENS[0];
  if (!selected)
    for (const variant of ["light", "dark"]) {
      for (const intensity of [0, 50, 85, 100])
        await capture(settings, PROFILES[0], variant, {
          prefix: `intensity-${intensity}`,
          intensity,
        });
      for (const [name, options] of Object.entries({
        "high-contrast": { contrast: true },
        "reduced-transparency": { transparency: true },
        "os-reduced-transparency": { reducedTransparencyMedia: true },
        "reduced-motion": { reduceMotion: true },
        "forced-colors": { forcedColors: true },
      }))
        await capture(settings, PROFILES[0], variant, { prefix: name, ...options });
      await capture(server, { id: "server-wide", width: 1920, height: 1080 }, variant);
      await capture(home, PROFILES[0], variant, { prefix: "inspector-collapsed", collapse: true });
      await capture(home, PROFILES[0], variant, { prefix: "focus", focus: true });
      await capture(home, PROFILES[2], variant, { prefix: "companion", companion: true });
    }
} finally {
  await browser.close();
  save();
}
console.log(
  JSON.stringify(
    {
      captures: report.captures.length,
      statuses: report.captures.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
      output: relative(process.cwd(), out),
    },
    null,
    2,
  ),
);

process.exitCode = report.captures.some((capture) => capture.status === "FAIL") ? 1 : 0;
