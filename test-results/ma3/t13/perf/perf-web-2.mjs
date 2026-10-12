// T13 PERF lane (web, LIVE) second pass: (a) rAF baseline on a blank page (is the chat frame rate a headless limit?),
// (b) a REAL hidden document via CDP window minimize (falls back to a labelled SIMULATED visibility override),
// (c) window-scroll off-screen gating of the characters, (d) Studio Close button focus return.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = resolve("test-results/ma3/t13/perf");
const BASE = "http://127.0.0.1:8096";
const out = { label: "LIVE (disposable Host 43880 + dev server 8096 + Playwright chromium); items marked SIMULATED are not real browser state", generatedAt: new Date().toISOString(), checks: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frameCounter = (ms) =>
  new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else resolve({ frames: n, ms: Math.round(performance.now() - t0) }); };
    requestAnimationFrame(f);
  });
const gate = () => [...document.querySelectorAll(".wc-weapon, .wc-companion")].map((el) => ({
  weapon: el.dataset.weapon ?? "companion",
  state: el.dataset.state,
  paused: el.dataset.paused ?? null,
  top: Math.round(el.getBoundingClientRect().top),
  bottom: Math.round(el.getBoundingClientRect().bottom),
  runningAnims: el.getAnimations().filter((a) => a.playState === "running").length,
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
try {
  // (a) Baseline: an idle blank page in the same browser, same viewport.
  const blank = await context.newPage();
  await blank.setContent("<!doctype html><html><body style='margin:0'><div>blank</div></body></html>");
  await sleep(1000);
  const base = await blank.evaluate(frameCounter, 5000);
  out.checks.rafBaselineBlankPage = { rafFps: +(base.frames / (base.ms / 1000)).toFixed(2), windowMs: base.ms };
  await blank.close();

  // Chat page for (b)-(d).
  await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".wc-weapon", { timeout: 90000 });
  await sleep(2500);
  out.checks.gateVisibleTop = (await page.evaluate(gate));
  out.checks.pageScroll = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: innerHeight, scrollable: document.documentElement.scrollHeight > innerHeight + 1 }));

  // (b) Real hidden document: minimize the browser window through CDP, then check document.hidden.
  const cdp = await context.newCDPSession(page);
  let hiddenMode = "none";
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    await sleep(2000);
    const probe = await page.evaluate(() => ({ hidden: document.hidden, visibilityState: document.visibilityState }));
    hiddenMode = probe.hidden ? "real-minimized-window" : "minimize-did-not-hide";
    out.checks.realHiddenAttempt = { method: "CDP Browser.setWindowBounds windowState=minimized", probe, gate: (await page.evaluate(gate)), rafFramesOver3s: (await page.evaluate(frameCounter, 3000)).frames };
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await sleep(1500);
  } catch (error) {
    out.checks.realHiddenAttempt = { error: String(error).slice(0, 300) };
  }
  if (hiddenMode !== "real-minimized-window") {
    // SIMULATED: override the document.hidden getter and dispatch visibilitychange (the same event a real tab switch fires).
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(800);
    out.checks.simulatedHidden = { label: "SIMULATED (document.hidden overridden + visibilitychange dispatched)", gate: (await page.evaluate(gate)), rafFramesOver3s: (await page.evaluate(frameCounter, 3000)).frames };
    await page.evaluate(() => {
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(800);
    out.checks.simulatedHiddenRestored = (await page.evaluate(gate));
  }

  // (c) Off-screen via window scroll: scroll to the bottom, then back to the top.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(1200);
  out.checks.gateWindowScrolledBottom = { scrollY: await page.evaluate(() => scrollY), gate: (await page.evaluate(gate)) };
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1200);
  out.checks.gateWindowScrolledTop = { scrollY: await page.evaluate(() => scrollY), gate: (await page.evaluate(gate)) };

  // (d) Studio: open slot 1, press the Close button, check focus returns to Edit slot 1.
  await page.goto(`${BASE}/?view=agents&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("button", { timeout: 90000 });
  await sleep(2500);
  await page.getByRole("button", { name: /Edit slot 1/i }).first().click();
  await sleep(700);
  const openH = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
  await page.getByRole("button", { name: /^Close$/ }).first().click();
  await sleep(700);
  const closed = await page.evaluate(() => ({ focus: document.activeElement?.textContent?.trim().slice(0, 40), textareas: document.querySelectorAll("textarea").length }));
  out.checks.studioCloseButton = { focusOnOpen: openH, afterClose: closed, focusReturnedToEdit1: closed.focus === "Edit slot 1" };
  out.checks.consoleErrors = errors;
} catch (error) {
  out.fatal = String(error?.stack ?? error).slice(0, 1500);
} finally {
  await browser.close();
  writeFileSync(resolve(here, "web-perf-2.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: "perf/web-perf-2.json", fatal: out.fatal ?? null, baseline: out.checks.rafBaselineBlankPage, hidden: out.checks.realHiddenAttempt?.probe ?? out.checks.realHiddenAttempt?.error ?? null, simulated: !!out.checks.simulatedHidden }, null, 2));
}
