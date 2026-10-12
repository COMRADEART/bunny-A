// T13 render check: every surface in light and dark at three desktop sizes against the disposable Host dev server (8092).
// Records console errors, uncaught page errors and horizontal overflow per shot. Screenshots go to shots/.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.T13_BASE ?? "http://127.0.0.1:8092";
const out = resolve("test-results/ma3/t13/web/shots");
mkdirSync(out, { recursive: true });
const VIEWS = (process.env.T13_VIEWS ?? "chat,missions,agents,projects,files,approvals,activity,settings,models,design-preview").split(",");
const THEMES = (process.env.T13_THEMES ?? "light,dark").split(",");
const SIZES = [
  [1920, 1080],
  [1366, 768],
  [1280, 800],
];

const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const theme of THEMES)
    for (const [width, height] of SIZES)
      for (const view of VIEWS) {
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme === "dark" ? "dark" : "light" });
        const page = await context.newPage();
        const errors = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text().slice(0, 300));
        });
        page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
        const url = `${BASE}/?view=${view}&theme=${theme}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(2500);
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          bodyText: (document.querySelector("#bunny-content")?.textContent ?? "").trim().slice(0, 160),
          theme: document.querySelector(".bunny-app")?.getAttribute("data-theme") ?? null,
          headingCount: document.querySelectorAll("h1").length,
        }));
        const name = `${view}-${theme}-${width}x${height}`;
        await page.screenshot({ path: `${out}/${name}.png` });
        report.push({
          name,
          url,
          overflowX: metrics.scrollWidth > metrics.innerWidth + 1,
          scrollWidth: metrics.scrollWidth,
          theme: metrics.theme,
          headingCount: metrics.headingCount,
          textStart: metrics.bodyText,
          consoleErrors: errors,
        });
        await context.close();
      }
} finally {
  await browser.close();
}
writeFileSync(resolve("test-results/ma3/t13/web/shots-report.json"), JSON.stringify(report, null, 2) + "\n");
const failures = report.filter((row) => row.overflowX || row.consoleErrors.length);
console.log(`shots=${report.length} overflow_or_errors=${failures.length}`);
for (const row of failures.slice(0, 12)) console.log(row.name, row.overflowX ? "OVERFLOW" : "", row.consoleErrors.slice(0, 2).join(" | "));
