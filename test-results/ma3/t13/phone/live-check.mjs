// M-A-3 T13 phone live re-check (browser simulation, NOT physical-phone acceptance).
// Loads the real companion routes on the dev server (127.0.0.1:8093) against the DISPOSABLE Host (438xx) from
// seed-host.mjs. Measures horizontal overflow, targets under 44 px and console errors, and writes a few screenshots
// under phone/shots/live-*. Credentials are read into memory only and never written out.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dirname);
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });
const hostState = JSON.parse(readFileSync(join(here, "host-state.json"), "utf8"));
const credentials = JSON.parse(readFileSync(hostState.credentialsFile, "utf8"));
const snapshot = await (await fetch(`http://127.0.0.1:${credentials.port}/state`, { headers: { authorization: `Bearer ${credentials.token}` } })).json();
const missionId = snapshot.agents.agents.find((agent) => agent.name === "Permission review")?.missionId ?? null;

const BASE = "http://127.0.0.1:8093/";
const routes = [
  { name: "home", query: "" },
  { name: "agent-waiting", query: "?slot=2" },
  { name: "agents", query: "?tab=agents" },
  { name: "missions", query: "?tab=missions" },
  { name: "mission-detail", query: missionId ? `?mission=${missionId}` : "?tab=missions" },
  { name: "chat", query: "?tab=chat" },
  { name: "settings", query: "?tab=settings" },
];
const widths = [390];
const browser = await chromium.launch();
const report = [];
try {
  for (const width of widths) {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: "dark" });
      await context.addInitScript(() => {
        try { localStorage.setItem("bunny-island-appearance", JSON.stringify({ theme: "dark", motion: "full" })); } catch {}
      });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 200)); });
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 200)}`));
      await page.goto(`${BASE}?companion=1${route.query ? `&${route.query.slice(1)}` : ""}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector(".pc-root", { timeout: 60_000 });
      await page.waitForTimeout(1500);
      const metrics = await page.evaluate(() => {
        const root = document.querySelector(".pc-root");
        const overflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const small = [...root.querySelectorAll("button, a, [role='button']")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
          .filter((item) => item.w < 44 || item.h < 44);
        return { overflowX, undersized: small.length, undersizedSample: small.slice(0, 5), status: root.getAttribute("data-status"), title: document.querySelector(".pc-title")?.textContent ?? null };
      });
      const file = `live-${route.name}-${width}.png`;
      await page.screenshot({ path: join(shots, file), fullPage: false });
      report.push({ route: route.name, width, ...metrics, consoleErrors: errors.length, errorSample: errors.slice(0, 3), shot: file });
      await context.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(here, "live-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
