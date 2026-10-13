// T13 PERF lane (web, LIVE) third pass: repeated 10 s windows on the chat page to test whether the frame rate is stable,
// with frame-interval percentiles from rAF timestamps and CDP deltas. A CONTROL window pauses every document animation
// (SIMULATED control, to attribute the frame cost to the character animations), then resumes them.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = resolve("test-results/ma3/t13/perf");
const BASE = "http://127.0.0.1:8096";
const out = { label: "LIVE (disposable Host 43880 + dev server 8096 + Playwright chromium 1.63, headless software compositing); the CONTROL window is SIMULATED (animations paused by script)", generatedAt: new Date().toISOString(), windows: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Runs in the page: rAF timestamps for `ms`, returned as intervals.
const frameIntervals = (ms) =>
  new Promise((resolve) => {
    const stamps = [];
    const t0 = performance.now();
    const f = (t) => { stamps.push(t); if (performance.now() - t0 < ms) requestAnimationFrame(f); else resolve(stamps); };
    requestAnimationFrame(f);
  });
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2); };
const summarize = (stamps) => {
  const iv = []; for (let i = 1; i < stamps.length; i++) iv.push(stamps[i] - stamps[i - 1]);
  const span = (stamps[stamps.length - 1] - stamps[0]) / 1000;
  return { frames: stamps.length, fps: +((stamps.length - 1) / span).toFixed(2), intervalMs: { p50: pct(iv, 50), p95: pct(iv, 95), p99: pct(iv, 99), max: +Math.max(...iv).toFixed(2) }, framesOver33ms: iv.filter((x) => x > 33.4).length };
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message.slice(0, 200)));
const window10 = async (label) => {
  const m0 = await m();
  const stamps = await page.evaluate(frameIntervals, 10000);
  const m1 = await m();
  const win = m1.Timestamp - m0.Timestamp;
  out.windows.push({ label, ...summarize(stamps), cdpWindowSec: +win.toFixed(3), mainThreadBusyPercent: +((100 * (m1.TaskDuration - m0.TaskDuration)) / win).toFixed(2), scriptSec: +(m1.ScriptDuration - m0.ScriptDuration).toFixed(4), layoutSec: +(m1.LayoutDuration - m0.LayoutDuration).toFixed(4), recalcStyleSec: +(m1.RecalcStyleDuration - m0.RecalcStyleDuration).toFixed(4), jsHeapUsedMB: +(m1.JSHeapUsedSize / 1048576).toFixed(2) });
};
try {
  await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".wc-weapon", { timeout: 90000 });
  await sleep(3000);
  out.animationsAtStart = await page.evaluate(() => ({ documentAnimations: document.getAnimations().length, running: document.getAnimations().filter((a) => a.playState === "running").length, names: [...new Set(document.getAnimations().map((a) => a.animationName))].slice(0, 20) }));
  await window10("visible-1");
  await window10("visible-2");
  // CONTROL (SIMULATED): pause every document animation for one window, then resume.
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  await sleep(500);
  await window10("control-all-animations-paused (SIMULATED)");
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await sleep(500);
  await window10("visible-3-after-resume");
  out.consoleErrors = errors;
} catch (error) {
  out.fatal = String(error?.stack ?? error).slice(0, 1200);
} finally {
  await browser.close();
  writeFileSync(resolve(here, "web-perf-3.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out.windows.map((w) => ({ label: w.label, fps: w.fps, p50: w.intervalMs.p50, p95: w.intervalMs.p95, busy: w.mainThreadBusyPercent })), null, 1), out.fatal ?? "");
}
