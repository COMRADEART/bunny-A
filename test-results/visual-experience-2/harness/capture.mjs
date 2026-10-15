// Visual Experience 2.0 capture driver: real renders of the built/dev app (never illustrations).
// Usage: node capture.mjs <baseUrl> <outDir> [--themes a,b] [--surfaces chat,missions] [--variants light,dark] [--phone]
// Theme selection uses the preview-only `?uitheme=` deep link (never persisted). Every page records console/page errors
// and horizontal overflow; results.json summarises them.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [base = "http://127.0.0.1:8095", outArg = "shots"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : null;
};
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const themes = flag("themes")?.split(",") ?? [null];
const variants = flag("variants")?.split(",") ?? ["light", "dark"];
const DESKTOP = [
  { name: "dashboard", query: "view=chat" },
  { name: "missions", query: "view=missions" },
  { name: "studio", query: "view=agents" },
  { name: "settings", query: "view=settings" },
  { name: "approvals", query: "view=approvals" },
  { name: "activity", query: "view=activity" },
  { name: "files", query: "view=files" },
  { name: "projects", query: "view=projects" },
  { name: "models", query: "view=models" },
  { name: "devices", query: "view=devices" },
];
const surfaces = flag("surfaces")?.split(",");
const desktop = surfaces ? DESKTOP.filter((row) => surfaces.includes(row.name)) : DESKTOP;
const phone = !surfaces || surfaces.includes("phone");
const width = Number(flag("width") ?? 1440), height = Number(flag("height") ?? 900);

const browser = await chromium.launch({ headless: true });
const results = [];
const shoot = async (context, label, url, waitFor, theme) => {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror ${error.message.slice(0, 300)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console ${message.text().slice(0, 300)}`);
  });
  const t0 = Date.now();
  const log = (phase) => console.error(`${label} ${phase} +${Date.now() - t0}ms`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector(waitFor, { timeout: 90_000 });
    // Hydrated (the client applied the requested theme), live, and stable: the page can navigate once more after its first
    // load, so the condition must hold for 2 s with no new navigation. A picture of a server-rendered shell proves nothing.
    const ready = (id) => (!id || !!document.querySelector(`[data-ui-theme="${id}"]`)) && (!!document.querySelector('.stream-indicator[data-connection="live"]') || /Live/.test(document.querySelector(".pc-root")?.textContent ?? ""));
    let navigatedAt = Date.now();
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigatedAt = Date.now(); });
    for (let round = 0; round < 6; round++) {
      await page.waitForFunction(ready, theme, { timeout: 120_000 }).catch(() => log(`round ${round}: not ready after 120 s`));
      const settledFrom = Date.now();
      await page.waitForTimeout(2_000);
      if (navigatedAt < settledFrom && (await page.evaluate(ready, theme))) break;
      log(`round ${round}: ${navigatedAt >= settledFrom ? "navigated while settling" : "no longer ready"}`);
    }
    const facts = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      uiTheme: (document.querySelector(".pc-root, .bunny-app") ?? document.documentElement).getAttribute("data-ui-theme"),
      layout: document.querySelector("[data-ui-theme]")?.getAttribute("data-layout") ?? null,
      textLength: document.body.innerText.trim().length,
      live: !!document.querySelector('.stream-indicator[data-connection="live"]') || /Live/.test(document.querySelector(".pc-root")?.textContent ?? ""),
    }));
    log("ready");
    const file = join(out, `${label}.png`);
    // A still frame: CSS animations are fast-forwarded to their end state for the picture only (motion is measured separately).
    try {
      await page.screenshot({ path: file, timeout: 60_000, animations: "disabled" });
    } catch {
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: file, timeout: 90_000, animations: "disabled" });
    }
    log("shot");
    // Re-checked after the picture: a navigation during the shot would leave the frame unproven.
    const stillReady = await page.evaluate(ready, theme);
    results.push({ label, url, ok: !errors.length && !facts.overflowX && facts.textLength > 40 && facts.live && stillReady && (!theme || facts.uiTheme === theme), stillReady, errors, ...facts });
  } catch (error) {
    results.push({ label, url, ok: false, errors: [...errors, String(error).slice(0, 300)] });
  } finally {
    await page.close();
  }
};
for (const theme of themes) {
  for (const variant of variants) {
    const tag = `${theme ?? "current"}-${variant}`;
    const desktopContext = await browser.newContext({ viewport: { width, height }, colorScheme: variant });
    for (const row of desktop)
      await shoot(desktopContext, `${tag}-${row.name}`, `${base}/?${row.query}&theme=${variant}${theme ? `&uitheme=${theme}` : ""}`, ".app-sidebar, .ve-shell", theme);
    await desktopContext.close();
    if (phone) {
      const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: variant });
      await shoot(phoneContext, `${tag}-phone`, `${base}/?companion=1&theme=${variant}${theme ? `&uitheme=${theme}` : ""}`, ".pc-root", theme);
      await phoneContext.close();
    }
  }
}
await browser.close();
writeFileSync(join(out, "results.json"), JSON.stringify({ base, generatedAt: new Date().toISOString(), viewport: { width, height }, results }, null, 2));
console.log(JSON.stringify({ total: results.length, failed: results.filter((row) => !row.ok).map((row) => ({ label: row.label, errors: row.errors?.slice(0, 2), overflowX: row.overflowX })) }, null, 1));
