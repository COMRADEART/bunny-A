// Visual Experience 2.0 Gate H: keyboard and focus, measured in a real browser on the live app (no axe-core: nothing new
// is installed for evidence). For each theme:
//   - Tab through the first 40 stops of Chat and Settings: every stop has an accessible name, a visible focus indicator
//     (outline or a box-shadow ring that differs from its unfocused state) and is not hidden behind decoration
//     (elementFromPoint at its centre is the element or inside it);
//   - Theme Gallery by keyboard only: focus "Preview <Name>", press Enter → the window shows that theme and aria-pressed is
//     true, Escape → back to the saved theme; nothing is saved (the Host revision does not change).
// Usage: node a11y-keyboard.mjs <base> <host-state.json> <out.json>
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [base, statePath, out] = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const token = JSON.parse(readFileSync(state.credentialsFile, "utf8")).token;
const revision = async () => (await (await fetch(`http://127.0.0.1:${state.port}/state`, { headers: { authorization: `Bearer ${token}` } })).json()).uiTheme?.revision ?? null;
const THEMES = [["glass", "light"], ["cybercore", "dark"], ["brutalism", "light"], ["pixel", "dark"], ["scrapbook", "light"], ["luxury", "dark"], ["neumorph", "light"], ["cyberpunk", "dark"]];
const browser = await chromium.launch();
const report = { base, classification: "LIVE keyboard walk (Playwright Chromium)", themes: [], gallery: null };

async function ready(page, theme) {
  await page.waitForFunction((id) => !!document.querySelector(`.bunny-app[data-ui-theme="${id}"]`) && !!document.querySelector('.stream-indicator[data-connection="live"]'), theme, { timeout: 120_000 });
  await page.waitForTimeout(2_000);
}

async function walk(page, stops) {
  const rows = [];
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    const row = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const focused = getComputedStyle(el);
      const ring = (focused.outlineStyle !== "none" && parseFloat(focused.outlineWidth) > 0) || (focused.boxShadow && focused.boxShadow !== "none");
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const inView = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
      const top = inView ? document.elementFromPoint(x, y) : null;
      return { tag: el.tagName.toLowerCase(), name, ring, covered: inView && !!top && top !== el && !el.contains(top) && !top.contains(el), size: [Math.round(rect.width), Math.round(rect.height)] };
    });
    if (row) rows.push(row);
  }
  return rows;
}

for (const [theme, variant] of THEMES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: variant });
  const page = await context.newPage();
  const entry = { theme, variant, views: {} };
  for (const view of ["chat", "settings"]) {
    await page.goto(`${base}/?view=${view}&theme=${variant}&uitheme=${theme}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await ready(page, theme);
    const rows = await walk(page, 40);
    const unnamed = rows.filter((row) => !row.name);
    const noRing = rows.filter((row) => !row.ring);
    const covered = rows.filter((row) => row.covered);
    entry.views[view] = { stops: rows.length, unnamed, noRing, covered, ok: rows.length >= 10 && !unnamed.length && !noRing.length && !covered.length };
    console.log(`${theme}/${variant} ${view}: ${rows.length} stops, unnamed ${unnamed.length}, no ring ${noRing.length}, covered ${covered.length}`);
  }
  report.themes.push(entry);
  await context.close();
}

// Theme Gallery, keyboard only.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  await page.goto(`${base}/?view=settings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => !!document.querySelector('.stream-indicator[data-connection="live"]') && !!document.querySelector(".tg-grid"), null, { timeout: 120_000 });
  await page.waitForTimeout(1_500);
  const savedRevision = await revision();
  const saved = await page.evaluate(() => document.querySelector(".bunny-app")?.getAttribute("data-ui-theme"));
  const target = saved === "pixel" ? ["clay", "Claymorphism"] : ["pixel", "Pixel Art"];
  await page.getByRole("button", { name: `Preview ${target[1]} without applying it` }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const during = await page.evaluate((name) => ({ shown: document.querySelector(".bunny-app")?.getAttribute("data-ui-theme"), pressed: document.querySelector(`[aria-label="Preview ${name} without applying it"]`)?.getAttribute("aria-pressed") }), target[1]);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => document.querySelector(".bunny-app")?.getAttribute("data-ui-theme"));
  const afterRevision = await revision();
  report.gallery = { saved, target: target[0], during, after, savedRevision, afterRevision, ok: during.shown === target[0] && during.pressed === "true" && after === saved && afterRevision === savedRevision };
  console.log(`gallery keyboard: ${JSON.stringify(report.gallery)}`);
  await context.close();
}
await browser.close();
report.ok = report.themes.every((t) => Object.values(t.views).every((v) => v.ok)) && report.gallery.ok;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok }));
