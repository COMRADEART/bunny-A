// T13.1 render check for Settings > AI & Models against the disposable Host dev server (8093).
// Usage: node test-results/ma3/t13-1/shots.mjs <phase>. Walks the three tabs with the keyboard (ArrowRight), records
// console errors, horizontal overflow and whether any key material is visible, at desktop and phone sizes, light and dark.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.T131_BASE ?? "http://127.0.0.1:8093";
const phase = process.argv[2] ?? "fresh";
const FIXTURE_KEY = "ts_FIXTURE_screenshot_not_a_real_key_000";
const out = resolve("test-results/ma3/t13-1/shots");
mkdirSync(out, { recursive: true });
const SIZES = [
  ["desktop", 1366, 900],
  ["phone", 390, 844],
];
const THEMES = phase === "fresh" ? ["light"] : ["light", "dark"];
const TABS = ["connections", "routing", "privacy"];

const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const theme of THEMES)
    for (const [device, width, height] of SIZES) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, ...(device === "phone" ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text().slice(0, 300));
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
      await page.goto(`${BASE}/?view=settings&theme=${theme}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(2500);
      await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "AI & Models" }).click();
      await page.waitForTimeout(600);
      const tablist = page.getByRole("tablist");
      await tablist.getByRole("tab").first().focus();
      for (const [index, tab] of TABS.entries()) {
        if (index > 0) await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(400);
        const metrics = await page.evaluate((key) => {
          const active = document.activeElement;
          const html = document.documentElement.outerHTML;
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            focusedTab: active?.getAttribute("role") === "tab" ? active.textContent?.trim() : null,
            selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
            panelLabelled: Boolean(document.querySelector('[role="tabpanel"][aria-labelledby]')),
            keyInDom: html.includes(key),
            keyInStorage: JSON.stringify({ ...localStorage }).includes(key) || JSON.stringify({ ...sessionStorage }).includes(key),
          };
        }, FIXTURE_KEY);
        const name = `ai-models-${phase}-${tab}-${device}-${theme}`;
        await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
        report.push({ name, phase, overflowX: metrics.scrollWidth > metrics.innerWidth + 1, ...metrics, consoleErrors: [...errors] });
      }
      await context.close();
    }
} finally {
  await browser.close();
}
writeFileSync(resolve(`test-results/ma3/t13-1/shots-${phase}.json`), JSON.stringify(report, null, 2) + "\n");
const failures = report.filter((row) => row.overflowX || row.consoleErrors.length || row.keyInDom || row.keyInStorage || !row.panelLabelled);
console.log(`phase=${phase} shots=${report.length} failures=${failures.length}`);
for (const row of failures) console.log(row.name, JSON.stringify({ overflow: row.overflowX, key: row.keyInDom || row.keyInStorage, errors: row.consoleErrors.slice(0, 2) }));
