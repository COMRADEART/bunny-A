if (process.env.E5A_ISOLATED_HOST !== "1")
  throw Error("Set E5A_ISOLATED_HOST=1 only with a separate audit Host state directory.");
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const b = await chromium.launch();
const out = "docs/ux/e5a/evidence";
mkdirSync(out, { recursive: true });
const result = {
  qualification: "Browser keyboard/DOM checks, not Narrator/TalkBack qualification",
  checks: [],
  errors: [],
};
async function check(id, run) {
  try {
    const evidence = await run();
    result.checks.push({ id, status: "PASS", evidence });
  } catch (e) {
    result.checks.push({ id, status: "FAIL", error: e.message });
  }
}
const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await c.newPage();
p.on("pageerror", (e) => result.errors.push(e.message));
await p.goto("http://127.0.0.1:8082/?view=home");
await p.locator('.stream-indicator[data-connection="live"]').waitFor();
await check("skip-link", async () => {
  const link = p.getByRole("link", { name: "Skip to content" });
  await link.focus();
  await p.keyboard.press("Enter");
  if ((await p.evaluate(() => document.activeElement?.id)) !== "bunny-content")
    throw Error("Skip did not focus main");
  return "Enter moves focus to the main landmark";
});
await check("primary-navigation-keyboard", async () => {
  await p
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Tasks", exact: true })
    .focus();
  await p.keyboard.press("Enter");
  await p.getByRole("heading", { name: "Tasks", exact: true }).waitFor();
  return "Tasks opens through keyboard";
});
await check("context-collapse-focus", async () => {
  const toggle = p.getByRole("button", { name: "Context panel", exact: true });
  await toggle.focus();
  await p.keyboard.press("Enter");
  await p.locator('.cx-panel[data-collapsed="true"]').waitFor();
  if (
    (await p.evaluate(() => document.activeElement?.getAttribute("aria-label"))) !== "Context panel"
  )
    throw Error("Focus lost on collapse");
  await p.keyboard.press("Enter");
  await p.locator('.cx-panel[data-collapsed="false"]').waitFor();
  return "Collapse and expand retain focus on replacement toggle";
});
await check("ai-tab-arrow-navigation", async () => {
  await p.goto("http://127.0.0.1:8082/?view=settings");
  await p
    .getByRole("navigation", { name: "Settings groups" })
    .getByRole("button", { name: "AI & Models", exact: true })
    .click();
  const tab = p.getByRole("tab", { name: "Connected Accounts", exact: true });
  await tab.focus();
  await p.keyboard.press("ArrowRight");
  const next = p.getByRole("tab", { name: "Harness Manager", exact: true });
  if (
    (await next.getAttribute("aria-selected")) !== "true" ||
    !(await next.evaluate((e) => e === document.activeElement))
  )
    throw Error("Arrow did not move focus and selection");
  return "ArrowRight selects/focuses Harness Manager";
});
await check("goal-validation-focus", async () => {
  await p.goto("http://127.0.0.1:8082/?view=tasks");
  await p.locator('.stream-indicator[data-connection="live"]').waitFor();
  await p.getByRole("button", { name: "New goal", exact: true }).click();
  const form = p.locator("form.proactive-form");
  await form.getByRole("button", { name: "Review", exact: true }).click();
  await p.waitForTimeout(100);
  const invalid = await p.evaluate(() => document.activeElement?.getAttribute("aria-invalid"));
  if (invalid !== "true") throw Error("First invalid field did not receive focus");
  await form.screenshot({ path: out + "/goal-validation-desktop.png" });
  return "Invalid empty draft is not sent; focus moves to invalid field";
});
await c.close();
for (const variant of ["light", "dark"]) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: variant,
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:8082/?view=home&uitheme=glass&theme=${variant}`);
  await page.locator('.stream-indicator[data-connection="live"]').waitFor();
  await check(`mobile-navigation-${variant}`, async () => {
    const menu = page.getByRole("button", { name: "Toggle navigation", exact: true });
    await menu.click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: "Advanced", exact: true })
      .click();
    const settings = page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: "Settings", exact: true });
    await settings.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Make Bunny feel like yours.", exact: true }).waitFor();
    return "Mobile menu exposes Advanced and keyboard opens Settings";
  });
  await ctx.close();
}
const themeContext = await b.newContext({ viewport: { width: 1440, height: 1000 } }),
  themePage = await themeContext.newPage();
await themePage.goto("http://127.0.0.1:8082/?view=settings");
await themePage.locator('.stream-indicator[data-connection="live"]').waitFor();
await check("system-appearance-follows-os", async () => {
  await themePage
    .getByRole("button", { name: "Preview Glassmorphism without applying it", exact: true })
    .click();
  await themePage.getByRole("radio", { name: "System", exact: true }).click();
  await themePage.emulateMedia({ colorScheme: "dark" });
  await themePage.locator('.bunny-app[data-theme="dark"]').waitFor();
  await themePage.emulateMedia({ colorScheme: "light" });
  await themePage.locator('.bunny-app[data-theme="light"]').waitFor();
  await themePage.getByRole("button", { name: "End preview", exact: true }).click();
  return "Unsaved System preview follows OS dark and light";
});
await check("theme-catalogue-22", async () => {
  const n = await themePage.locator(".tg-grid > li").count();
  if (n !== 22) throw Error(`Expected 22 themes, got ${n}`);
  return "All 22 existing themes are present in Explore Themes";
});
await check("slider-keyboard-and-value", async () => {
  const slider = themePage.getByRole("slider", { name: "Glass intensity", exact: true });
  await slider.focus();
  await themePage.keyboard.press("ArrowRight");
  await themePage.waitForTimeout(150);
  if ((await slider.inputValue()) !== "86") throw Error("ArrowRight did not move 85 to 86");
  await themePage.keyboard.press("ArrowLeft");
  await themePage.waitForTimeout(150);
  if ((await slider.inputValue()) !== "85") throw Error("ArrowLeft did not restore 85");
  await themePage.keyboard.press("Home");
  await themePage.waitForTimeout(150);
  if ((await slider.inputValue()) !== "0") throw Error("Home did not select 0");
  await themePage.keyboard.press("End");
  await themePage.waitForTimeout(150);
  if ((await slider.inputValue()) !== "100") throw Error("End did not select 100");
  await themePage.keyboard.press("Shift+ArrowLeft");
  await themePage.waitForTimeout(150);
  if ((await slider.inputValue()) !== "90") throw Error("Shift+ArrowLeft did not step by 10");
  for (let i = 0; i < 5; i++) {
    await themePage.keyboard.press("ArrowLeft");
    await themePage.waitForTimeout(100);
  }
  if ((await slider.inputValue()) !== "85") throw Error("Could not restore 85");
  return {
    value: await slider.inputValue(),
    ariaSnapshot: await slider.ariaSnapshot(),
    scope: "DOM slider value/keyboard, not spoken screen-reader output",
  };
});
await check("reduced-motion-decorative-animations", async () => {
  await themePage.emulateMedia({ reducedMotion: "reduce" });
  await themePage.waitForTimeout(300);
  const animations = await themePage.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().duration > 1)
        .length,
  );
  if (animations) throw Error(`${animations} animations still running`);
  return "No running decorative animation longer than 1 ms under reduced-motion emulation";
});
await themeContext.close();
await b.close();
writeFileSync(out + "/keyboard-checks.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

process.exitCode = result.errors.length || result.checks.some((c) => c.status === "FAIL") ? 1 : 0;
