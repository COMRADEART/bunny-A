// M-A-3 T14 UX walk: real renders of the BUILT desktop app (JEV_DESKTOP_BUILD=1, scripts/preview-node-middleware.mjs on
// 127.0.0.1:8081) against the disposable seeded Host from seed-host.mjs. Production is never addressed.
// Usage: node t14-walk.mjs <outDir> <host-state.json>
// Matrix: 22 themes x { Mission Control focused on one of the four seeded Missions (desktop 1440x900), phone companion
// (390x844) }. Each page: the requested theme applied, no console/page errors, no horizontal overflow, and the autonomy
// caption equal to the Host's own MissionView.autonomy for that Mission (fetched from the Host, never inferred).
// Then: every Mission in one theme, and the cached-theme restore check (no frame of the shell in the default theme).
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = "http://127.0.0.1:8081";
const THEMES = ["clay", "cybercore", "brutalism", "scrapbook", "surreal", "y2k", "pixel", "synthwave", "glass", "neumorph", "bento",
  "editorial", "swiss", "minimal", "maximal", "luxury", "sketch", "ethereal", "bohemian", "victorian", "cyberpunk", "wabisabi"];
const LABEL = { PLAN: "Planning", DELEGATE: "Handing out work", EXECUTE: "Working", OBSERVE: "Collecting results", VERIFY: "Checking results", REPAIR: "Repairing a failed check",
  WAITING_RESOURCE: "Waiting for a provider or resource", WAITING_DEPENDENCY: "Waiting for earlier work", WAITING_AUTHORIZATION: "Waiting for your approval",
  OUTCOME_UNCERTAIN: "Outcome uncertain — reconciliation required", RECONCILIATION_REQUIRED: "Outcome uncertain — reconciliation required", FAILED: "Failed", CANCELLED: "Stopped" };
const out = resolve(process.argv[2] ?? "walk");
const seeded = JSON.parse(readFileSync(resolve(process.argv[3]), "utf8"));
const token = JSON.parse(readFileSync(seeded.credentialsFile, "utf8")).token;
mkdirSync(out, { recursive: true });
const hostState = async () => (await fetch(`http://127.0.0.1:${seeded.port}/state`, { headers: { authorization: `Bearer ${token}` } })).json();
const hostCommand = async (action, data) => (await fetch(`http://127.0.0.1:${seeded.port}/command`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) })).json();
const expectedCaption = (view) => view.phase === "COMPLETE" ? (view.verified ? "Done — verified by Bunny" : "Done — not independently verified") : LABEL[view.phase];

const browser = await chromium.launch({ headless: true });
const results = { matrix: [], missions: [], restore: null };
const live = (id) => (!id || !!document.querySelector(`[data-ui-theme="${id}"]`))
  && (!!document.querySelector('.stream-indicator[data-connection="live"]') || /Live/.test(document.querySelector(".pc-root")?.textContent ?? ""));
async function open(context, url, selector, theme) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror ${error.message.slice(0, 300)}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console ${message.text().slice(0, 300)}`); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector(selector, { timeout: 90_000 });
  await page.waitForFunction(live, theme ?? null, { timeout: 120_000 });
  await page.waitForTimeout(1_200);
  return { page, errors };
}
const facts = () => ({
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  uiTheme: (document.querySelector(".pc-root, .bunny-app") ?? document.documentElement).getAttribute("data-ui-theme"),
  caption: document.querySelector(".mission-autonomy")?.textContent?.trim() ?? null,
  phase: document.querySelector(".mission-autonomy")?.getAttribute("data-phase") ?? null,
  textLength: document.body.innerText.trim().length,
});

async function missionRow(label, theme, slot, variant = "light") {
  const { missionId } = seeded.slots[slot];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: variant });
  let page; let errors = [];
  try {
    ({ page, errors } = await open(context, `${BASE}/?mission=${missionId}&theme=${variant}&uitheme=${theme}`, ".app-sidebar, .ve-shell", theme));
    await page.waitForSelector(".mission-autonomy", { timeout: 30_000 });
    const seen = await page.evaluate(facts);
    const host = (await hostState()).missions.missions.find((m) => m.id === missionId).autonomy;
    await page.screenshot({ path: join(out, `${label}.png`), animations: "disabled", timeout: 90_000 });
    const ok = !errors.length && !seen.overflowX && seen.uiTheme === theme && seen.phase === host.phase && seen.caption === expectedCaption(host) && host.phase === seeded.expected[slot];
    const row = { label, theme, slot, ok, errors, host, ...seen };
    console.error(`${label} ${ok ? "ok" : "FAIL"} ${seen.phase} "${seen.caption}"`);
    return row;
  } catch (error) {
    console.error(`${label} FAIL ${String(error).slice(0, 160)}`);
    return { label, theme, slot, ok: false, errors: [...errors, String(error).slice(0, 300)] };
  } finally { await page?.close(); await context.close(); }
}

for (const [index, theme] of THEMES.entries()) {
  const slot = (index % 4) + 1;
  results.matrix.push(await missionRow(`${theme}-mission-slot${slot}`, theme, slot));
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
  let page; let errors = [];
  try {
    ({ page, errors } = await open(phone, `${BASE}/?companion=1&theme=light&uitheme=${theme}`, ".pc-root", theme));
    const seen = await page.evaluate(facts);
    await page.screenshot({ path: join(out, `${theme}-phone.png`), animations: "disabled", timeout: 90_000 });
    const ok = !errors.length && !seen.overflowX && seen.uiTheme === theme && seen.textLength > 50;
    results.matrix.push({ label: `${theme}-phone`, theme, ok, errors, ...seen });
    console.error(`${theme}-phone ${ok ? "ok" : "FAIL"}`);
  } catch (error) {
    results.matrix.push({ label: `${theme}-phone`, theme, ok: false, errors: [...errors, String(error).slice(0, 300)] });
  } finally { await page?.close(); await phone.close(); }
}
for (const slot of [1, 2, 3, 4]) {
  results.missions.push(await missionRow(`glass-dark-mission-slot${slot}`, "glass", slot, "dark"));
}

// Cached-theme restore: the Host and this window's cache both say Pixel; no animation frame may show the shell in Glass.
{
  await hostCommand("appearance.theme", { theme: "pixel" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try { localStorage.setItem("bunny-a.ui-theme.v1", JSON.stringify({ schema: "bunny-a.ui-theme.v1", theme: "pixel", variant: "light", accent: null, density: "theme", transparency: "medium", highContrast: false })); } catch { /* storage blocked */ }
    const frames = [];
    window.__t14Frames = frames;
    const sample = () => {
      const shell = document.querySelector(".t8-app");
      if (shell && getComputedStyle(shell).visibility !== "hidden" && shell.getBoundingClientRect().height > 0) frames.push(shell.getAttribute("data-ui-theme"));
      if (frames.length < 400) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-ui-theme="pixel"]'), null, { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const frames = await page.evaluate(() => window.__t14Frames);
  const restoring = await page.evaluate(() => document.documentElement.hasAttribute("data-theme-restoring"));
  const shown = [...new Set(frames)];
  results.restore = { ok: frames.length > 0 && shown.every((id) => id === "pixel") && !restoring && !errors.length, visibleFrames: frames.length, themesShown: shown, attributeLeft: restoring, errors };
  console.error(`restore ${results.restore.ok ? "ok" : "FAIL"} ${JSON.stringify(shown)}`);
  await context.close();
  await hostCommand("appearance.theme_reset", {});
}

await browser.close();
writeFileSync(join(out, "results.json"), JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), ...results }, null, 2) + "\n");
const failed = [...results.matrix, ...results.missions].filter((row) => !row.ok).map((row) => row.label);
if (!results.restore?.ok) failed.push("restore");
console.log(JSON.stringify({ matrix: results.matrix.length, missions: results.missions.length, failed }));
