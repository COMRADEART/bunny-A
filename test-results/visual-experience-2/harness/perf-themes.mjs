// Visual Experience 2.0 Gate J: theme switching and animation cost, measured in a real browser on the dev or built app.
// Switching uses the real Settings → Appearance → Theme Gallery "Preview" control (the same code path as Apply minus the
// Host write). For each theme: time from click to the first painted frame that carries the theme, then a 4 s window of
// rAF frame intervals, CDP main-thread busy time and the count of running animations. Finally one idle check: ambient
// loops must stop after the idle window. Usage: node perf-themes.mjs <base> <out.json> [--idle]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [base = "http://127.0.0.1:8095", out = "perf.json"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const idleCheck = process.argv.includes("--idle");
const THEMES = ["clay", "cybercore", "brutalism", "scrapbook", "surreal", "y2k", "pixel", "synthwave", "glass", "neumorph", "bento", "editorial", "swiss", "minimal", "maximal", "luxury", "sketch", "ethereal", "bohemian", "victorian", "cyberpunk", "wabisabi"];
const NAMES = { clay: "Claymorphism", cybercore: "Cybercore", brutalism: "Neo-Brutalism", scrapbook: "Scrapbook", surreal: "Surrealism", y2k: "Y2K", pixel: "Pixel Art", synthwave: "Synthwave", glass: "Glassmorphism", neumorph: "Neumorphism", bento: "Bento Grid", editorial: "Editorial", swiss: "Swiss Design", minimal: "Minimalism", maximal: "Maximalism", luxury: "Luxury Typography", sketch: "Conceptual Sketch", ethereal: "Ethereal", bohemian: "Bohemian", victorian: "Victorian", cyberpunk: "Cyberpunk", wabisabi: "Wabi-sabi" };

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(2);
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
await page.goto(`${base}/?view=settings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".tg-grid", { timeout: 90_000 });
await page.waitForFunction(() => !!document.querySelector('.stream-indicator[data-connection="live"]'), null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1500);

const result = { base, generatedAt: new Date().toISOString(), classification: "LIVE browser measurement (Playwright Chromium, headless software compositing)", viewport: "1440x900", themes: [], errors };
for (const id of THEMES) {
  // Pointer over the page keeps ambient motion awake, as for a person using the window.
  await page.mouse.move(700, 400);
  const button = page.getByRole("button", { name: `Preview ${NAMES[id]} without applying it` });
  await button.scrollIntoViewIfNeeded();
  const switchMs = await page.evaluate(async (target) => {
    const start = performance.now();
    const control = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith(`Preview `) && b.closest(".tg-card")?.querySelector("h4")?.textContent?.startsWith(target.name));
    if (!control) return null;
    if (control.getAttribute("aria-pressed") === "true") return 0;
    control.click();
    await new Promise((done) => {
      const check = () => (document.documentElement.dataset.uiTheme === target.id ? requestAnimationFrame(() => requestAnimationFrame(done)) : requestAnimationFrame(check));
      check();
    });
    return +(performance.now() - start).toFixed(2);
  }, { id, name: NAMES[id] });
  await page.waitForTimeout(700);
  const m0 = await metrics();
  const stamps = await page.evaluate((ms) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const tick = (t) => { out.push(t); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out); };
    requestAnimationFrame(tick);
  }), 4000);
  const m1 = await metrics();
  const intervals = stamps.slice(1).map((t, i) => t - stamps[i]);
  const animations = await page.evaluate(() => {
    const running = document.getAnimations().filter((a) => a.playState === "running");
    return { running: running.length, infinite: running.filter((a) => a.effect?.getTiming?.().iterations === Infinity).length, names: [...new Set(running.map((a) => a.animationName ?? "transition"))].slice(0, 12) };
  });
  const window = m1.Timestamp - m0.Timestamp;
  result.themes.push({
    theme: id,
    switchToPaintedFrameMs: switchMs,
    fps: +((stamps.length - 1) / ((stamps.at(-1) - stamps[0]) / 1000)).toFixed(2),
    frameIntervalMs: { p50: pct(intervals, 50), p95: pct(intervals, 95), max: +Math.max(...intervals).toFixed(2) },
    mainThreadBusyPercent: +((100 * (m1.TaskDuration - m0.TaskDuration)) / window).toFixed(2),
    recalcStyleMs: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000).toFixed(2),
    layoutMs: +((m1.LayoutDuration - m0.LayoutDuration) * 1000).toFixed(2),
    animations,
  });
  console.log(`${id}: switch ${switchMs} ms, ${result.themes.at(-1).fps} fps, busy ${result.themes.at(-1).mainThreadBusyPercent}%, running ${animations.running} (infinite ${animations.infinite})`);
}
if (idleCheck) {
  // Ambient loops must stop when the window is idle: Synthwave's grid and Surrealism's drift are the loudest.
  for (const id of ["synthwave", "surreal"]) {
    const control = page.getByRole("button", { name: `Preview ${NAMES[id]} without applying it` });
    await control.click();
    await page.mouse.move(600, 300);
    await page.waitForTimeout(800);
    const active = await page.evaluate(() => ({ ambient: document.querySelector(".bunny-app")?.getAttribute("data-ambient"), infinite: document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming?.().iterations === Infinity).length }));
    await page.waitForTimeout(47_000);
    const idle = await page.evaluate(() => ({ ambient: document.querySelector(".bunny-app")?.getAttribute("data-ambient"), infinite: document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming?.().iterations === Infinity).length }));
    result[`idle-${id}`] = { active, afterIdle47s: idle };
    console.log(`idle ${id}: active ${JSON.stringify(active)} -> idle ${JSON.stringify(idle)}`);
  }
}
await page.getByRole("button", { name: "End preview" }).first().click().catch(() => {});
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
const switches = result.themes.map((row) => row.switchToPaintedFrameMs).filter((value) => typeof value === "number");
console.log(JSON.stringify({ themes: result.themes.length, switchMs: { p50: pct(switches, 50), p95: pct(switches, 95), max: Math.max(...switches) }, errors: errors.length }));
