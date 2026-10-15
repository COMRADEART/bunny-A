// Visual Experience 2.0: the 22 "theme configuration previews". For each theme, Settings → Appearance → Theme Gallery is
// opened on the saved theme, the theme's real "Preview <Name> without applying it" control is pressed, and the window is
// captured with the preview bar and that theme's card in view. Nothing is saved: the Host revision is read before and after.
// Usage: node preview-shots.mjs <base> <host-state.json> <outDir>
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UI_THEME_IDS, UI_THEMES } from "../../../src/lib/bunny-host/ui-theme.ts";

const [base, statePath, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const state = JSON.parse(readFileSync(statePath, "utf8"));
const token = JSON.parse(readFileSync(state.credentialsFile, "utf8")).token;
const revision = async () => (await (await fetch(`http://127.0.0.1:${state.port}/state`, { headers: { authorization: `Bearer ${token}` } })).json()).uiTheme?.revision ?? null;
const before = await revision();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const results = [];
for (const id of UI_THEME_IDS) {
  const name = UI_THEMES[id].name;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));
  try {
    await page.goto(`${base}/?view=settings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => !!document.querySelector('.stream-indicator[data-connection="live"]') && !!document.querySelector(".tg-grid"), null, { timeout: 120_000 });
    await page.waitForTimeout(1_500);
    const control = page.getByRole("button", { name: `Preview ${name} without applying it` });
    await control.scrollIntoViewIfNeeded();
    await control.click();
    await page.waitForFunction((theme) => document.querySelector(".bunny-app")?.getAttribute("data-ui-theme") === theme, id, { timeout: 30_000 });
    await page.waitForTimeout(900);
    const facts = await page.evaluate((label) => ({
      shown: document.querySelector(".bunny-app")?.getAttribute("data-ui-theme"),
      pressed: document.querySelector(`[aria-label="${label}"]`)?.getAttribute("aria-pressed"),
      bar: !!document.querySelector(".tg-global-preview"),
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    }), `Preview ${name} without applying it`);
    await page.screenshot({ path: join(out, `${id}-preview.png`), animations: "disabled" });
    results.push({ id, ok: facts.shown === id && facts.pressed === "true" && facts.bar && !facts.overflowX && !errors.length, ...facts, errors });
  } catch (error) {
    results.push({ id, ok: false, errors: [...errors, String(error).slice(0, 200)] });
  }
  console.log(`${id}: ${results.at(-1).ok ? "ok" : `FAIL ${JSON.stringify(results.at(-1))}`}`);
  await page.close();
}
await browser.close();
const after = await revision();
writeFileSync(join(out, "results.json"), JSON.stringify({ base, revisionBefore: before, revisionAfter: after, nothingSaved: before === after, results }, null, 2));
console.log(JSON.stringify({ total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.id), nothingSaved: before === after }));
