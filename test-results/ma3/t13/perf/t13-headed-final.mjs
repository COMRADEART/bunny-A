import { createRequire } from "node:module";
const { chromium } = createRequire("C:/Users/allam/Documents/new/bun-router/package.json")("playwright");
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:8080/";
const evidence = { machine: "Intel Core Ultra 9 185H, 32GB RAM, Windows x64", headed: null, error: null, measures: {} };

let browser;
try {
  browser = await chromium.launch({ headless: false, args: ["--window-size=1280,800"] });
  evidence.headed = true;
} catch (error) {
  evidence.headed = false;
  evidence.error = `headed launch failed: ${error.message.split("\n")[0]}`;
  console.log(`HEADED-UNAVAILABLE ${evidence.error}`);
  writeFileSync("/tmp/t13-perf-evidence.json", JSON.stringify(evidence, null, 2));
  process.exit(2);
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console: ${m.text().slice(0, 160)}`); });

// 1. Initial UI render.
const t0 = Date.now();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 50, null, { timeout: 120000 });
const navMs = Date.now() - t0;
const webVitals = await page.evaluate(() => new Promise((resolve) => {
  const paint = performance.getEntriesByType("paint").map((p) => ({ [p.name]: Math.round(p.startTime) }));
  const nav = performance.getEntriesByType("navigation")[0];
  new PerformanceObserver((list, obs) => {
    const lcp = list.getEntries().at(-1);
    obs.disconnect();
    resolve({ paint, lcpMs: lcp ? Math.round(lcp.startTime) : null, domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null, bodyChars: document.body.innerText.length });
  }).observe({ type: "largest-contentful-paint", buffered: true });
  setTimeout(() => resolve({ paint, lcpMs: null, domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null, bodyChars: document.body.innerText.length }), 8000);
}));
evidence.measures.initialRender = { navigationToContentMs: navMs, ...webVitals };
console.log(`RENDER nav=${navMs}ms`, JSON.stringify(webVitals));

// Inventory of interactive controls.
const controls = await page.evaluate(() => ({
  buttons: [...document.querySelectorAll("button")].slice(0, 12).map((b) => b.innerText.trim().slice(0, 40)),
  inputs: [...document.querySelectorAll("input,textarea")].map((i) => ({ tag: i.tagName, label: i.getAttribute("aria-label") || i.placeholder || "" })),
}));
console.log("CONTROLS", JSON.stringify(controls));

// 2/3. Island expand/collapse + input-to-paint on first text input (usually the composer).
const inputProbe = await page.evaluate(async () => {
  const el = document.querySelector("textarea, input[type='text'], input:not([type])");
  if (!el) return { skipped: "no text input found" };
  el.focus();
  const t = performance.now();
  el.value = (el.value || "") + "x";
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "x", inputType: "insertText" }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { inputToPaintMs: Math.round((performance.now() - t) * 10) / 10, tag: el.tagName };
});
evidence.measures.inputToPaint = inputProbe;
console.log("INPUT-PAINT", JSON.stringify(inputProbe));

// 4. Repeated open/close transitions on the first sheet-ish button (5 cycles), measuring handler+paint each.
const toggleProbe = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => /ask bunny|composer|tasks|agents|mission/i.test(b.innerText));
  if (!btn) return { skipped: "no sheet button found" };
  const samples = [];
  for (let n = 0; n < 5; n++) {
    const t = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    samples.push(Math.round((performance.now() - t) * 10) / 10);
    await new Promise((r) => setTimeout(r, 300));
  }
  return { label: btn.innerText.trim().slice(0, 40), openCloseMs: samples };
});
evidence.measures.transitions = toggleProbe;
console.log("TRANSITIONS", JSON.stringify(toggleProbe));

// 5. Memory + CPU footprint.
const mem = await page.evaluate(() => (performance.memory ? {
  jsHeapUsedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  jsHeapTotalMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
} : { skipped: "performance.memory unavailable" }));
evidence.measures.memory = mem;
console.log("MEMORY", JSON.stringify(mem));
evidence.measures.consoleErrors = consoleErrors;
console.log("CONSOLE-ERRORS", JSON.stringify(consoleErrors));
await page.screenshot({ path: "/tmp/t13-perf-headed.png" });
await browser.close();
writeFileSync("/tmp/t13-perf-evidence.json", JSON.stringify(evidence, null, 2));
console.log("EVIDENCE /tmp/t13-perf-evidence.json");
