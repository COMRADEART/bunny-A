// T13: ?companion=1 must render the full-screen companion (Phone), never the Devices page.
import { chromium } from "playwright";
import { resolve } from "node:path";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
await page.goto("http://127.0.0.1:8092/?companion=1&theme=light", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);
const result = await page.evaluate(() => ({
  surface: document.querySelector(".bunny-app")?.getAttribute("data-surface"),
  hasSidebar: !!document.querySelector(".app-sidebar"),
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  text: (document.querySelector("#bunny-content")?.textContent ?? "").slice(0, 120),
}));
await page.screenshot({ path: resolve("test-results/ma3/t13/web/shots/companion-390x844.png") });
console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();
