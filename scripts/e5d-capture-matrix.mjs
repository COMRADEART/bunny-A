#!/usr/bin/env node
/** E5D: universal screenshot matrix against the isolated real-Host built desktop adapter.
 * E5A conventions exactly: E5A-style isolation assertion, loopback-only local base, fresh
 * browser context per case, UI-only navigation and appearance previews — no Task submitted,
 * microphone started, provider authenticated, permission granted or approval accepted; never
 * the populated production Host; never weaken auth/gateway checks to get a capture.
 *
 * Environment (this machine, Node 26.13.0): dev-server shared-font 403 caveat — capture against
 * BUILT output only, never `npm run dev`:
 *   1. JEV_DESKTOP_BUILD=1 npm run build     (desktop node-middleware output)
 *   2. BUNNY_HOST_DATA_DIRECTORY=<fresh temp dir> npm run host   (isolated Host state)
 *   3. node install/server.mjs               (real desktop adapter, loopback checks intact, :8082)
 *
 * Usage:
 *   $env:E5D_ISOLATED_HOST='1'
 *   node scripts/e5d-capture-matrix.mjs [base=http://127.0.0.1:8082/] [outdir=docs/ux/e5d/evidence] [--subset=<a,b>]
 *   npm run e5d:matrix -- --subset=mobile              (token OR-match on "<id> <screen> <profile>")
 * E5D_APPEND=1 keeps records already in the verdict file for targeted recapture (E5A_APPEND twin).
 *
 * Verdict: docs/ux/e5d/evidence/e5d-matrix.json plus per-case PNGs with E5A naming
 * (<id>-<silver|graphite>-<profile>.png). Exits 1 on any FAIL or when no capture PARTIALed
 * (a dead adapter or misconfigured Host must not green-light); BLOCKED stays honest-but-green
 * per E5A (screens may be unreachable until Lane A lands — see TODO-E5C in e5d-matrix-plan.mjs).
 * Focus cases (kind focus) Tab-press like a real keyboard user and record focusRect/focus ring;
 * the 125% text leg re-applies the preference once and records BLOCKED rather than capture at
 * a scale the app did not apply.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { writeEvidence } from "./evidence-guard.mjs";
import { PROFILES, SCREENS, planCases } from "./e5d-matrix-plan.mjs";

if (process.env.E5D_ISOLATED_HOST !== "1")
  throw Error("Set E5D_ISOLATED_HOST=1 only after starting a separate capture Host state directory.");
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const positionals = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const base = new URL(positionals[0] || "http://127.0.0.1:8082/");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:")
  throw Error("Captures require a local isolated app, never production.");
const out = resolve(positionals[1] || "docs/ux/e5d/evidence");
const unknown = flags.filter((f) => !f.startsWith("--subset="));
if (unknown.length) throw Error(`Unknown flag(s): ${unknown.join(" ")}. Only --subset=<a,b> is supported.`);
const subset = flags
  .find((f) => f.startsWith("--subset="))
  ?.split("=")[1]
  ?.split(",")
  .map((t) => t.trim())
  .filter(Boolean);
mkdirSync(out, { recursive: true });
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const cases = planCases(subset);
if (!cases.length)
  throw Error(`--subset=${subset?.join(",")} matched none of the ${planCases().length} matrix cases.`);
const matrixFile = resolve(out, "e5d-matrix.json");
const previous =
  process.env.E5D_APPEND === "1"
    ? JSON.parse(readFileSync(matrixFile, "utf8"))
    : null;
const report = previous ?? {
  schema: "bunny-a.e5d-matrix.v1",
  sourceCommit: sha,
  capturedAt: new Date().toISOString(),
  base: base.origin,
  runtime: "Real built desktop adapter; isolated Host state directory; no mocked responses or seeded work.",
  qualification: "Browser viewport/media emulation, not installed Windows/native Android qualification.",
  screens: SCREENS,
  profiles: PROFILES,
  captures: [],
};
const save = () => writeEvidence(matrixFile, report);
save();
// Exit decision counts THIS run only: an E5D_APPEND recapture must not ride on old PARTIALs.
const run = { partial: 0, fail: 0 };

const SETTLED_SELECTOR =
  '.stream-indicator[data-connection="live"], .stream-indicator[data-connection="polling"], ' +
  '.stream-indicator[data-connection="offline"], .pc-root[data-status="live"]';
const settled = (page, timeout = 12000) =>
  page.waitForFunction((sel) => !!document.querySelector(sel), SETTLED_SELECTOR, { timeout });

/** 125% text leg (F02), E5A's working mechanism (scripts/e5a-layout-probes.mjs): the Text size
 * select only persists when picked on a fully settled page — a change event that lands before
 * React hydration is dropped and the preference never saves — so wait for hydration (the theme
 * attribute for light flips only then) and a settled connection, select, then verify fontSize. */
async function applyTextScale(page, variant, scale) {
  await page.locator(`.bunny-app[data-theme="${variant}"]`).waitFor({ timeout: 25000 });
  await settled(page, 20000);
  await page.getByLabel("Text size", { exact: true }).selectOption(String(scale));
  await page
    .waitForFunction(
      (s) => getComputedStyle(document.documentElement).fontSize === `${16 * s}px`,
      scale,
      { timeout: 5000 },
    )
    .catch(() => {}); // the target-navigation verify in capture() is the authority
}

/** Keyboard focus (focus cases): :focus-visible shows only for real keyboard interaction, so
 * press Tab (trusted key presses, never focus()) until a visible control inside the target
 * surface is focused. Returns the focus evidence or null when the walk reaches nothing. */
const FOCUS_TAB_STEPS = 40;
async function keyboardFocus(page, targetSelector) {
  for (let step = 1; step <= FOCUS_TAB_STEPS; step++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(
      (sel) => {
        const a = document.activeElement;
        if (!a || a === document.body || !a.closest(sel)) return null;
        const r = a.getBoundingClientRect(),
          s = getComputedStyle(a);
        if (!(r.width > 0 && r.height > 0) || s.visibility === "hidden" || s.display === "none")
          return null;
        return {
          tag: a.tagName.toLowerCase(),
          label: a.getAttribute("aria-label") || (a.textContent || "").trim().slice(0, 60),
          focusVisible: a.matches(":focus-visible"),
          focusRect: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
          ring: { outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, boxShadow: s.boxShadow },
        };
      },
      targetSelector,
    );
    if (hit) return { ...hit, tabStep: step, surface: targetSelector };
  }
  return null;
}

/** E6A: the app applies the persisted 125% scale in a post-hydration pass, so a plain read right
 * after navigation races it — the definitive matrix lost the scale on 9 of 25 silver landscape
 * navigations and every one held after the re-apply (only connected-services lost twice in a row).
 * Measurement waits like a real user's settled page: bounded waitForFunction on the root fontSize,
 * then the existing single re-apply through the real control, then BLOCK with the measured reason. */
const textScaleSettled = (page, scale, timeout = 5000) =>
  page
    .waitForFunction(
      (s) => getComputedStyle(document.documentElement).fontSize === `${16 * s}px`,
      scale,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );

const browser = await chromium.launch({ headless: true });
async function capture(kase) {
  const { screen, profile, variant, options } = kase;
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
    id: kase.id,
    kind: kase.kind,
    section: screen.id,
    variant,
    profile: profile.id,
    status: "PARTIAL",
    notes: [],
    consoleErrors: errors,
    failedResources,
  };
  const params = new URLSearchParams({
    view: screen.view,
    uitheme: "glass",
    theme: variant,
    glassintensity: String(options.intensity ?? 85),
  });
  const settingsHref = new URL(
    `/?view=settings&uitheme=glass&theme=${variant}&glassintensity=${options.intensity ?? 85}`,
    base,
  ).href;
  const targetHref = new URL("?" + params, base).href;
  try {
    if (profile.textScale) {
      // Landscape 844x390 at supported 125% text (F02): set the appearance preference first,
      // then navigate to the target within the same context.
      await page.goto(settingsHref, { waitUntil: "domcontentloaded" });
      await applyTextScale(page, variant, profile.textScale);
    }
    const response = await page.goto(targetHref, {
      waitUntil: "domcontentloaded",
    });
    record.httpStatus = response.status();
    record.url = page.url();
    await page
      .locator(
        `.bunny-app[data-theme="${variant}"][data-glass-intensity="${options.intensity ?? 85}"]`,
      )
      .waitFor({ timeout: 25000 });
    if (profile.textScale) {
      if (!(await textScaleSettled(page, profile.textScale))) {
        // Never capture the 125% leg at the wrong scale: wait for the app's post-hydration scale,
        // then re-apply once through the app's real control path; a second failure is BLOCKED with
        // the measured reason.
        const lost = await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        );
        record.notes.push(
          `125% text not settled after navigation (root fontSize ${lost}); re-applying through the Settings control once.`,
        );
        await page.goto(settingsHref, { waitUntil: "domcontentloaded" });
        await applyTextScale(page, variant, profile.textScale);
        const retry = await page.goto(targetHref, { waitUntil: "domcontentloaded" });
        record.httpStatus = retry.status();
        record.url = page.url();
        await page
          .locator(`.bunny-app[data-theme="${variant}"][data-glass-intensity="${options.intensity ?? 85}"]`)
          .waitFor({ timeout: 25000 });
        if (!(await textScaleSettled(page, profile.textScale))) {
          const after = await page.evaluate(
            () => getComputedStyle(document.documentElement).fontSize,
          );
          record.status = "BLOCKED";
          record.notes.push(
            `125% text-scale could not be applied (root fontSize ${after} even after settling and re-applying through the Settings control); recorded BLOCKED instead of capturing at ${after}.`,
          );
          return;
        }
      }
    }
    await settled(page).catch(() =>
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
    // TODO-E5C: when Lane A lands new reachable screens, extend group/tab/memory flows here
    // only if the destination genuinely needs them; BLOCKED must stay capture-honest.
    const target = page.locator(screen.target).first();
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
    if (kase.kind === "focus") {
      // Press Tab only after scrollIntoViewIfNeeded so the focused control and its ring stay in
      // frame for the capture below.
      // No Tab-reachable control means no focus evidence: BLOCK instead of an unfocused frame.
      record.focus = await keyboardFocus(page, screen.target);
      if (!record.focus) {
        record.status = "BLOCKED";
        record.notes.push(
          `Keyboard Tab walk (${FOCUS_TAB_STEPS} presses) reached no visible control inside ${screen.target}; no focus evidence without a focused control.`,
        );
        return;
      }
    }
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
          [...root.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value]),
        ),
        main: box(".workspace-content"),
        split: box(".workspace-split"),
        sidebar: box(".app-sidebar"),
        inspector: box(".cx-panel"),
        widgetSidebar: box(".widget-sidebar"),
        settings: box(".settings-layout"),
        settingsPanel: box(".settings-panel"),
        material: box(".t8-surface,.glass"),
        clippedCandidates: clipped,
        smallControls: small,
        connection: document.querySelector(".stream-indicator")?.getAttribute("data-connection"),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        reducedTransparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
        forcedColors: matchMedia("(forced-colors: active)").matches,
      };
    });
    record.screenshot = `${record.id}.png`;
    await page.screenshot({ path: resolve(out, record.screenshot), fullPage: false });
    if (exists && ![".workspace-content", ".ch-home"].includes(screen.target)) {
      const bounds = await target.boundingBox();
      if (bounds && bounds.width > 0 && bounds.height > 0 && bounds.height < 7000) {
        record.panelScreenshot = `${record.id}-panel.png`;
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
        "Capture rendered; E5D acceptance remains open until E5D review (E5A PARTIAL semantics retained).",
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
    if (record.status === "PARTIAL") run.partial++;
    if (record.status === "FAIL") run.fail++;
    report.captures = report.captures.filter((r) => r.id !== record.id);
    report.captures.push(record);
    save();
    await context.close();
    console.log(`${record.status} ${record.id}`);
  }
}

try {
  for (const kase of cases) await capture(kase);
} finally {
  await browser.close();
  save();
}
const verdict = {
  captures: report.captures.length,
  planned: cases.length,
  run,
  statuses: report.captures.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
  failed: report.captures.filter((r) => r.status === "FAIL").map((r) => r.id),
  blocked: report.captures.filter((r) => r.status === "BLOCKED").map((r) => r.id),
  output: relative(process.cwd(), out),
};
console.log(JSON.stringify(verdict, null, 2));
process.exitCode = run.fail || !run.partial ? 1 : 0;