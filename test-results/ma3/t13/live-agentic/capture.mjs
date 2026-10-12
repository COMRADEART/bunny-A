// T13 live-agentic capture: Playwright against the dev server on 8094 (real UI, real disposable Host). It answers the
// checkpoint requests written by scenario.mjs (cp/<name>.req -> cp/<name>.done). It logs every data-cue change inside the page
// with a MutationObserver, so a one-shot cue is recorded only when the page actually observed a transition. Island window
// shots use PrintWindow on the PID of the Island this run launched (command line contains the run's private temp folder).
import { chromium } from "playwright";
import { mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const here = import.meta.dirname;
const CP = join(here, "cp");
const SHOTS = join(here, "shots");
mkdirSync(CP, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const BASE = "http://127.0.0.1:8094";
const CUE_INIT = `
  window.__cue = [];
  const ts = () => Date.now();
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type !== "attributes") continue;
      const el = r.target;
      if (!(el instanceof Element) || !el.matches(".wc-weapon,.wc-companion")) continue;
      window.__cue.push({ t: ts(), kind: r.attributeName, value: el.getAttribute(r.attributeName), weapon: el.getAttribute("data-weapon"), state: el.getAttribute("data-state"), slot: el.getAttribute("data-slot") });
    }
  });
  document.addEventListener("DOMContentLoaded", () => mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-cue", "data-state"] }));
`;
const FACTS = () => {
  const weapon = [...document.querySelectorAll(".wc-weapon")].map((e) => ({
    weapon: e.getAttribute("data-weapon"), state: e.getAttribute("data-state"), slot: e.getAttribute("data-slot"), cue: e.getAttribute("data-cue"),
    alt: e.querySelector("img")?.getAttribute("alt") ?? null, view: e.closest("[data-view]")?.getAttribute("data-view") ?? null,
  }));
  const companion = [...document.querySelectorAll(".wc-companion")].map((e) => ({ state: e.getAttribute("data-state"), cue: e.getAttribute("data-cue"), alt: e.querySelector("img")?.getAttribute("alt") ?? null }));
  const images = [...document.images].map((i) => i.getAttribute("src")).filter(Boolean).slice(0, 80);
  return { weapon, companion, images, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 1500) };
};
const islandPid = () => {
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*Bunny-Island.ps1*' -and $_.CommandLine -like '*bunny-t13-live-*' } | ForEach-Object { $_.ProcessId }"], { encoding: "utf8", windowsHide: true }).trim();
    return out ? Number(out.split(/\s+/)[0]) : null;
  } catch { return null; }
};
const islandShot = (name) => {
  const pid = islandPid();
  if (!pid) return { captured: false, reason: "no Island launched by this run is running" };
  const out = join(SHOTS, `${name}-island.png`);
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "island-shot.ps1"), "-ProcessId", String(pid), "-Out", out], { encoding: "utf8", windowsHide: true, timeout: 60000 });
    return { captured: true, pid, file: out };
  } catch (error) { return { captured: false, pid, reason: String(error.message).slice(0, 300) }; }
};

const browser = await chromium.launch({ headless: true });
let live = null; // { context, page }
const openLive = async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: "dark" });
  await context.addInitScript(CUE_INIT);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/?view=chat&theme=dark`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll(".wc-weapon").length > 0, null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  live = { context, page, errors, cueSeen: 0 };
  return live;
};
const closeLive = async () => { if (live) { await live.context.close(); live = null; } };
const shot = async (page, name) => { const file = join(SHOTS, `${name}.png`); await page.screenshot({ path: file, fullPage: false }); return file; };
const viewsAt = async (context, name, views) => {
  const out = [];
  for (const view of views) {
    const page = await context.newPage();
    await page.goto(`${BASE}/?view=${view}&theme=dark`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(3500);
    const facts = await page.evaluate(FACTS);
    const file = await shot(page, `${name}-${view}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    out.push({ view, file: file.replace(here, "."), overflowX: overflow, ...facts, cueLogOnFirstLoad: await page.evaluate(() => window.__cue?.length ?? null) });
    await page.close();
  }
  return out;
};

console.log("capture ready", new Date().toISOString());
const handled = new Set();
let fatal = null;
try {
  for (;;) {
    const reqs = readdirSync(CP).filter((f) => f.endsWith(".req")).sort();
    for (const file of reqs) {
      const name = file.replace(/\.req$/, "");
      if (handled.has(name)) continue;
      handled.add(name);
      const req = JSON.parse(readFileSync(join(CP, file), "utf8"));
      const at = new Date().toISOString();
      let out;
      if (name === "cp6-close-ui") {
        // The page AND the Island are closed here; the Host keeps running (scenario closes the Island process).
        const before = live ? await live.page.evaluate(() => ({ cue: window.__cue, facts: null })) : null;
        const preShot = live ? await shot(live.page, name) : null;
        await closeLive();
        out = { captured: true, summary: "web page closed (browser context closed)", cueBeforeClose: before?.cue ?? [], preShot };
      } else if (name === "cp7-reopen-after-background") {
        // Reopened after the Mission finished with no UI: a new page, so the cue log starts empty (first load).
        await closeLive();
        const l = await openLive();
        const facts = await l.page.evaluate(FACTS);
        const file1 = await shot(l.page, name + "-chat");
        const deep = await viewsAt(l.context, name, ["agents", "missions", "files"]);
        out = { captured: true, summary: `reopened; strip ${JSON.stringify(facts.weapon.filter((w) => !w.slot).map((w) => [w.weapon, w.state, w.cue]))}`, pages: [{ view: "chat", file: file1.replace(here, "."), ...facts, cueLogOnFirstLoad: await l.page.evaluate(() => window.__cue.length) }, ...deep], island: islandShot(name), errors: l.errors };
      } else {
        if (!live) await openLive();
        const cueBefore = live.cueSeen;
        const facts = await live.page.evaluate(FACTS);
        const cue = await live.page.evaluate(() => window.__cue.slice());
        const delta = cue.slice(cueBefore);
        live.cueSeen = cue.length;
        const file1 = await shot(live.page, name + "-chat");
        const deep = name.startsWith("cp1") || name === "cp10-final" || name.startsWith("cp3") || name.startsWith("cp8") || name.startsWith("cp9") || name.startsWith("cp2") || name.startsWith("cp4") || name.startsWith("cp5")
          ? await viewsAt(live.context, name, ["agents", "missions", "files"]) : [];
        out = { captured: true, summary: `chat strip ${JSON.stringify(facts.weapon.filter((w) => !w.slot).map((w) => [w.weapon, w.state, w.cue]))}; cue deltas ${JSON.stringify(delta.filter((d) => d.kind === "data-cue"))}`, pages: [{ view: "chat (live page)", file: file1.replace(here, "."), ...facts, cueDeltasSinceLastCheckpoint: delta }, ...deep], island: islandShot(name), errors: live.errors.slice(-10), hostSlotsAtRequest: req.hostSlots };
      }
      writeFileSync(join(CP, `${name}.done`), JSON.stringify({ name, at, ...out }, null, 2));
      console.log(new Date().toISOString(), "done", name, (out.summary ?? "").slice(0, 200));
      if (name === "cp10-final") { fatal = "final"; break; }
    }
    if (fatal) break;
    await sleep(200);
  }
} catch (error) {
  fatal = String(error?.stack ?? error).slice(0, 2000);
  console.error("capture fatal", fatal);
} finally {
  await closeLive();
  await browser.close();
  writeFileSync(join(here, "capture-status.json"), JSON.stringify({ finishedAt: new Date().toISOString(), fatal, handled: [...handled] }, null, 2));
}
void unlinkSync; void existsSync;
