// M-A-3 T13.3 Gate H browser QA: Studio → Appearance → Character style, against the isolated QA Host (43190) through the
// dev UI (Vite, 8091). The installed Microsoft Edge (Chromium; headed, real GPU) driven by Playwright, so keyboard input
// has its default actions.
// Records: keyboard selection and focus, the live Notch preview on four edges, reduced motion, forced colours, mobile
// overflow, the design-preview gallery, Mission facts before/after, console errors, and per-style frame timing with
// renderer/GPU process CPU time and Windows GPU engine utilization. No model request, account or credential is used.
// Usage: node appearance-qa.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "..", "screenshots");
mkdirSync(shots, { recursive: true });
const BASE = "http://127.0.0.1:8091/";
const STYLES = ["glossy", "cel", "arcade", "comic", "pixel"];
const checks = {};
const notes = [];
const consoleErrors = [];
const check = (name, ok, detail) => {
  checks[name] = { ok: !!ok, ...(detail === undefined ? {} : { detail }) };
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  return last;
}

function watch(page, tag) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`${tag}: ${message.text().slice(0, 300)}`); });
  page.on("pageerror", (error) => consoleErrors.push(`${tag} pageerror: ${String(error).slice(0, 300)}`));
}

// The primary navigation sits behind "Toggle navigation" at phone width.
async function nav(page, name) {
  const target = page.getByRole("button", { name, exact: true });
  if (!(await target.isVisible())) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await target.click();
}

async function openStudioSlot1(page) {
  await page.goto(BASE);
  await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 20000 });
  await nav(page, "Agents");
  await page.getByRole("button", { name: "Edit slot 1" }).click();
  await page.locator(".ca-panel").waitFor();
}

async function missionFacts(page) {
  await nav(page, "Chat");
  const region = page.getByRole("region", { name: "Recent Missions" });
  await region.waitFor();
  await sleep(500);
  const missions = await region.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") || el.textContent.trim()).filter((t) => t && t !== "All Missions"));
  const agents = await page.getByRole("region", { name: "PERSONAL AGENTS" }).getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") || el.textContent.trim()));
  return { missions, agents };
}

const styleRadio = (page, value) => page.locator(`.ca-panel input[name="ca-style-1"][value="${value}"]`);
const intensityRadio = (page, value) => page.locator(`.ca-panel input[name="ca-intensity-1"][value="${value}"]`);
const checkedStyle = (page) => page.locator('.ca-panel input[name="ca-style-1"]:checked').getAttribute("value");
const activeInfo = (page) => page.evaluate(() => ({ tag: document.activeElement?.tagName, name: document.activeElement?.getAttribute("name"), value: document.activeElement?.getAttribute("value"), text: document.activeElement?.textContent?.trim().slice(0, 60), focusVisible: document.activeElement?.matches(":focus-visible") ?? false }));

async function setStyle(page, style) {
  if ((await checkedStyle(page)) === style) return true;
  await page.locator(`.ca-panel label.ca-option:has(input[value="${style}"])`).click();
  return until(async () => (await checkedStyle(page)) === style && (await page.locator(".ca-panel").getAttribute("aria-busy")) === "false");
}
async function setIntensity(page, value) {
  const radio = intensityRadio(page, value);
  if (await radio.isChecked()) return true;
  await page.locator(".ca-panel .ca-intensity label", { hasText: new RegExp(`^${value}$`, "i") }).click();
  return until(async () => (await radio.isChecked()) && (await page.locator(".ca-panel").getAttribute("aria-busy")) === "false");
}

// Windows GPU engine utilization for the given process ids, sampled once a second by PowerShell (the only Windows API path
// to per-process GPU use). Returns per-pid mean / max of the summed engines.
function sampleGpu(pids, seconds) {
  const script = `$ErrorActionPreference='SilentlyContinue'; $pids=@(${pids.join(",")}); $out=@{}; foreach($p in $pids){ $out[[string]$p]=@() }
for($i=0;$i -lt ${seconds};$i++){ foreach($p in $pids){ $s=Get-Counter -Counter ("\\GPU Engine(pid_{0}_*)\\Utilization Percentage" -f $p) -SampleInterval 1 -MaxSamples 1; if($s){ $out[[string]$p]+=[Math]::Round([double](($s.CounterSamples|Measure-Object CookedValue -Sum).Sum),3) } } }
$out | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("close", () => {
      try {
        const raw = JSON.parse(out || "{}");
        resolve(Object.fromEntries(Object.entries(raw).map(([pid, values]) => {
          const list = [].concat(values ?? []).map(Number).filter((v) => Number.isFinite(v));
          return [pid, { samples: list.length, mean: list.length ? +(list.reduce((a, b) => a + b, 0) / list.length).toFixed(3) : null, max: list.length ? Math.max(...list) : null }];
        })));
      } catch { resolve({ error: out.slice(0, 200) }); }
    });
  });
}

async function measure(page, cdp, browserCdp, label) {
  await sleep(1500);
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const processes = async () => (await browserCdp.send("SystemInfo.getProcessInfo")).processInfo;
  const p0 = await processes();
  const m0 = await metrics();
  const gpuPid = p0.find((p) => p.type === "GPU")?.id;
  const rendererPids = p0.filter((p) => p.type === "renderer").map((p) => p.id);
  const gpuSampling = gpuPid ? sampleGpu([gpuPid], 5) : Promise.resolve({});
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const times = [];
    const end = performance.now() + 5000;
    const step = (ts) => { times.push(ts); if (ts < end) requestAnimationFrame(step); else resolve(times); };
    requestAnimationFrame(step);
  }));
  const m1 = await metrics();
  const p1 = await processes();
  const gpu = await gpuSampling;
  const intervals = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const pct = (p) => +intervals[Math.min(intervals.length - 1, Math.floor(p * (intervals.length - 1)))].toFixed(2);
  const span = (frames.at(-1) - frames[0]) / 1000;
  const cpu = (type) => {
    const before = p0.filter((p) => p.type === type).reduce((s, p) => s + p.cpuTime, 0);
    const after = p1.filter((p) => p.type === type).reduce((s, p) => s + p.cpuTime, 0);
    return +((100 * (after - before)) / Math.max(0.001, (m1.Timestamp - m0.Timestamp))).toFixed(2);
  };
  const perSecond = (key) => +((1000 * (m1[key] - m0[key])) / Math.max(0.001, m1.Timestamp - m0.Timestamp)).toFixed(1);
  const animated = await page.locator('.wc-weapon[data-reduced="false"][data-base]:not([data-base="none"])').count();
  const result = {
    label,
    windowSeconds: +(m1.Timestamp - m0.Timestamp).toFixed(2),
    animatedCharacters: animated,
    frames: { count: frames.length, fps: +((frames.length - 1) / span).toFixed(1), p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99), maxMs: +intervals.at(-1).toFixed(2), over25Ms: intervals.filter((v) => v > 25).length, over50Ms: intervals.filter((v) => v > 50).length },
    mainThreadMsPerSecond: { task: perSecond("TaskDuration"), script: perSecond("ScriptDuration"), style: perSecond("RecalcStyleDuration"), layout: perSecond("LayoutDuration") },
    processCpuPercentOneCore: { renderer: cpu("renderer"), gpu: cpu("GPU"), browser: cpu("browser") },
    gpuEngineUtilizationPercent: gpuPid ? gpu[String(gpuPid)] ?? null : null,
    rendererProcesses: rendererPids.length,
  };
  console.log(`PERF ${label}: fps=${result.frames.fps} p95=${result.frames.p95Ms}ms renderer=${result.processCpuPercentOneCore.renderer}% gpuProc=${result.processCpuPercentOneCore.gpu}% gpuUtil=${JSON.stringify(result.gpuEngineUtilizationPercent)} animated=${animated}`);
  return result;
}

const browser = await chromium.launch({ channel: "msedge", headless: false, args: ["--window-size=1320,900"] });
const browserCdp = await browser.newBrowserCDPSession();
const receipt = { milestone: "M-A-3 T13.3 Gate H", purpose: "Browser QA of Studio Appearance → Character style against the isolated QA Host.", environment: "Dev UI (Vite 8091) + QA Host 43190 with its own data directory under %TEMP%. Production Host 43119 untouched. Headed Microsoft Edge (Chromium, driven by Playwright) with the real GPU.", generatedAt: new Date().toISOString() };
try {
  // Desktop.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  watch(page, "desktop");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(BASE);
  await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 20000 });
  const before = await missionFacts(page);
  receipt.missionFactsBefore = before;

  await openStudioSlot1(page);
  check("panel renders with five styles and the signature tag", (await page.locator('.ca-panel input[name="ca-style-1"]').count()) === 5 && (await page.locator(".ca-panel .ca-tag").innerText()) === "Signature");
  check("start from signature (reset before QA)", await (async () => {
    const reset = page.getByRole("button", { name: /Reset to signature/ });
    if (await reset.isEnabled()) { await reset.click(); }
    return until(async () => (await checkedStyle(page)) === "glossy" && (await intensityRadio(page, "full").isChecked()));
  })());

  // Keyboard: arrow keys move through the styles, focus stays on the radio and is visible, each choice is saved on the Host.
  await styleRadio(page, "glossy").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  let info = await activeInfo(page);
  check("keyboard focus reaches the style group", info.name === "ca-style-1" && info.value === "glossy", info);
  await page.keyboard.press("ArrowRight");
  const celSaved = await until(async () => (await checkedStyle(page)) === "cel" && (await page.locator(".ca-panel").getAttribute("aria-busy")) === "false");
  info = await activeInfo(page);
  check("ArrowRight selects Cel-Shaded and the Host saves it", !!celSaved);
  check("focus stays on the chosen radio after the Host answers, and is visible", info.value === "cel" && info.focusVisible, info);
  await page.keyboard.press("ArrowRight");
  await until(async () => (await checkedStyle(page)) === "arcade" && (await page.locator(".ca-panel").getAttribute("aria-busy")) === "false");
  check("a second ArrowRight selects Arcade", (await checkedStyle(page)) === "arcade" && (await activeInfo(page)).value === "arcade");
  await page.keyboard.press("Tab");
  info = await activeInfo(page);
  check("Tab moves to the animation intensity group", info.name === "ca-intensity-1" && info.value === "full", info);
  await page.keyboard.press("ArrowRight");
  const subtle = await until(async () => (await intensityRadio(page, "subtle").isChecked()) && (await page.locator(".ca-panel").getAttribute("aria-busy")) === "false");
  check("ArrowRight sets intensity Subtle", !!subtle && (await page.locator('.ca-preview .wc-weapon[data-size="pose"]').evaluate((el) => getComputedStyle(el).getPropertyValue("--wc-amp").trim())) === "0.5");
  await page.keyboard.press("Tab");
  info = await activeInfo(page);
  check("Tab moves to High contrast", info.tag === "INPUT" && (await page.evaluate(() => document.activeElement?.type)) === "checkbox", info);
  await page.keyboard.press("Space");
  const contrastOn = await until(async () => (await page.locator('.ca-preview .wc-weapon[data-contrast="high"]').count()) === 3);
  check("Space turns high contrast on (solid outline, no decorations) in all three previews", !!contrastOn);
  check("high contrast hides the decorative skin layer", await page.locator('.ca-preview .wc-weapon[data-size="pose"] .wc-skin').evaluate((el) => getComputedStyle(el, "::before").display === "none" || getComputedStyle(el, "::before").content === "none" || getComputedStyle(el).display === "none" || getComputedStyle(el).opacity === "0"));
  await page.locator(".ca-panel").screenshot({ path: join(shots, "t13-3-h-appearance-high-contrast.png") });
  await page.keyboard.press("Space");
  await until(async () => (await page.locator('.ca-preview .wc-weapon[data-contrast="high"]').count()) === 0 && (await page.locator(".ca-panel").getAttribute("aria-busy")) === "false");
  await page.keyboard.press("Tab");
  info = await activeInfo(page);
  check("Tab reaches Reset to signature", /Reset to signature/.test(info.text ?? ""), info);
  await page.keyboard.press("Enter");
  const reset = await until(async () => (await checkedStyle(page)) === "glossy" && (await intensityRadio(page, "full").isChecked()));
  check("Enter on Reset returns Gada to Glossy Inflatable (signature), Full", !!reset);

  // Live Notch preview on the four edges.
  for (const edge of ["top", "bottom", "left", "right"]) {
    await page.locator(".ca-edge select").selectOption(edge);
    const axis = await page.locator(".ca-notch").getAttribute("data-axis");
    const want = edge === "top" || edge === "bottom" ? "row" : "column";
    const caption = await page.locator(".ca-notch + .caption").innerText();
    const order = await page.locator(".ca-notch").evaluate((el) => {
      const strip = el.querySelector(".wc-strip")?.getBoundingClientRect();
      const bunny = el.querySelector(".wc-companion")?.getBoundingClientRect();
      return strip && bunny ? { stripBeforeBunnyX: strip.right <= bunny.left + 1, stripAboveBunnyY: strip.bottom <= bunny.top + 1 } : null;
    });
    const placed = want === "row" ? order?.stripBeforeBunnyX : order?.stripAboveBunnyY;
    check(`Notch preview ${edge}: ${want === "row" ? "Agents left of Bunny" : "Agents above Bunny"}`, axis === want && placed === true && caption.includes(want === "row" ? "left of Bunny" : "above Bunny"), { axis, order });
    await page.locator(".ca-notch").screenshot({ path: join(shots, `t13-3-h-notch-preview-${edge}.png`) });
  }
  await page.locator(".ca-edge select").selectOption("top");
  const speaking = await page.locator(".ca-notch .wc-strip-item[data-speaking='true']").count();
  const working = await page.locator(".ca-notch .wc-strip-item[data-working='true']").count();
  check("the Notch preview marks exactly one active speaker (the Host's foreground) and the Agents the Host reports working", speaking === 1 && working >= 1, { speaking, working });
  check("no completion celebration plays in the preview", (await page.locator(".ca-panel .wc-weapon[data-cue]").count()) === 0);

  // Every style on the desktop panel.
  for (const style of STYLES) {
    const ok = await setStyle(page, style);
    const previews = await page.locator(".ca-preview .wc-weapon").evaluateAll((els) => els.map((el) => el.getAttribute("data-style")));
    const pixelReady = style !== "pixel" || (await until(async () => (await page.locator('.ca-preview img[data-pixel="ready"]').count()) === 3));
    check(`style ${style}: saved and drawn in all three previews`, !!ok && previews.every((s) => s === style) && !!pixelReady, previews);
    await page.locator(".ca-panel").screenshot({ path: join(shots, `t13-3-h-appearance-${style}.png`) });
  }
  if ((await page.locator(".ca-preview img[data-pixel]").count()) > 0) {
    check("pixel art draws with pixelated scaling", (await page.locator('.ca-preview img[data-pixel="ready"]').first().evaluate((el) => getComputedStyle(el).imageRendering)) === "pixelated");
  }

  // Performance per style: Gada (slot 1) wears the style; the Studio shows Gada animated in several places.
  receipt.performance = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  receipt.performance.push(await measure(page, cdp, browserCdp, "baseline-reduced-motion"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setStyle(page, "glossy");
  await setIntensity(page, "off");
  receipt.performance.push(await measure(page, cdp, browserCdp, "baseline-gada-intensity-off"));
  await setIntensity(page, "full");
  for (const style of STYLES) {
    await setStyle(page, style);
    receipt.performance.push(await measure(page, cdp, browserCdp, `style-${style}`));
  }
  const worst = receipt.performance.filter((p) => p.label.startsWith("style-")).reduce((a, p) => (p.frames.p95Ms > a.frames.p95Ms ? p : a));
  check("every style was measured (frames, main thread, renderer and GPU process CPU)", receipt.performance.length === 7 && receipt.performance.every((p) => p.frames.count > 100));
  notes.push(`Slowest style by p95 frame interval: ${worst.label} (${worst.frames.p95Ms} ms, ${worst.frames.fps} fps).`);

  // Reduced motion: every character stills, decorations do not animate.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sleep(400);
  const reducedState = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".wc-weapon")];
    const moving = els.filter((el) => {
      const parts = [el.querySelector(".wc-body"), el.querySelector(".wc-skin"), el.querySelector(".wc-halo")].filter(Boolean);
      return parts.some((p) => getComputedStyle(p).animationName !== "none" || getComputedStyle(p, "::before").animationName !== "none" || getComputedStyle(p, "::after").animationName !== "none");
    });
    return { total: els.length, reducedAttr: els.filter((el) => el.dataset.reduced === "true").length, moving: moving.length };
  });
  check("reduced motion: every character is still (no animation on body, skin or halo, including pseudo-elements)", reducedState.total > 0 && reducedState.reducedAttr === reducedState.total && reducedState.moving === 0, reducedState);
  await page.locator(".ca-panel").screenshot({ path: join(shots, "t13-3-h-appearance-reduced-motion.png") });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Forced colours (Windows high contrast): decorations go, the art and the controls stay readable.
  await page.emulateMedia({ forcedColors: "active" });
  await sleep(300);
  const forced = await page.evaluate(() => ({ skins: [...document.querySelectorAll(".ca-panel .wc-skin")].filter((el) => getComputedStyle(el).display !== "none").length, radiosVisible: [...document.querySelectorAll('.ca-panel input[type="radio"]')].every((el) => el.getBoundingClientRect().width > 0) }));
  check("forced colours: the decorative skin layer is hidden and the controls stay visible", forced.skins === 0 && forced.radiosVisible, forced);
  await page.locator(".ca-panel").screenshot({ path: join(shots, "t13-3-h-appearance-forced-colors.png") });
  await page.emulateMedia({ forcedColors: "none" });

  await setStyle(page, "glossy");
  const resetBtn = page.getByRole("button", { name: /Reset to signature/ });
  if (await resetBtn.isEnabled()) await resetBtn.click();
  await until(async () => (await checkedStyle(page)) === "glossy");
  await page.locator(".ca-panel").screenshot({ path: join(shots, "t13-3-h-appearance-desktop.png") });

  // Design preview gallery (fixture data).
  await nav(page, "Settings");
  await page.getByRole("button", { name: /About Bunny/ }).click();
  await page.getByRole("button", { name: "Open design preview" }).click();
  const gallery = page.locator(".dp-style-cell").first();
  await gallery.waitFor();
  const cells = await page.locator(".dp-style-cell .wc-weapon").evaluateAll((els) => els.map((el) => `${el.dataset.weapon}:${el.dataset.style}`));
  const pairs = new Set(cells);
  check("design preview shows all four weapons in all five styles", ["gada", "spear", "chakra", "sword"].every((w) => STYLES.every((s) => pairs.has(`${w}:${s}`))), { distinct: pairs.size });
  const gallerySection = page.locator("section", { has: page.locator(".dp-style-cell") }).first();
  await gallerySection.screenshot({ path: join(shots, "t13-3-h-design-preview-styles.png") });

  const after = await missionFacts(page);
  receipt.missionFactsAfter = after;
  check("style changes left every Mission and Agent fact unchanged", JSON.stringify(before) === JSON.stringify(after), { before, after });
  await context.close();

  // Mobile 390x844: the panel and the gallery do not overflow.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const phone = await mobile.newPage();
  watch(phone, "mobile");
  await openStudioSlot1(phone);
  const overflow = async () => phone.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, panel: (() => { const el = document.querySelector(".ca-panel"); if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: window.innerWidth }; })() }));
  const mobileOverflow = await overflow();
  check("mobile 390x844: no horizontal overflow on the Appearance panel", mobileOverflow.doc <= 0 && mobileOverflow.panel && mobileOverflow.panel.left >= 0 && mobileOverflow.panel.right <= mobileOverflow.panel.width, mobileOverflow);
  // A panel taller than the viewport is captured by stitching, which draws the off-screen fixed skip link over the panel;
  // t13-3-h-appearance-mobile-viewport.png is the plain viewport capture (skip link at y = -100, not shown).
  receipt.mobileFocusAfterNavigation = await phone.evaluate(() => document.activeElement?.className || document.activeElement?.tagName || null);
  await phone.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await phone.locator(".ca-panel").screenshot({ path: join(shots, "t13-3-h-appearance-mobile.png") });
  const targets = await phone.locator(".ca-panel label.ca-option").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  check("mobile: each style option is at least 44 px tall", targets.every((h) => h >= 44), targets);
  for (const edge of ["left", "top"]) {
    await phone.locator(".ca-edge select").selectOption(edge);
    const o = await overflow();
    check(`mobile: Notch preview ${edge} does not overflow`, o.doc <= 0, o);
  }
  await phone.locator(".ca-notch").screenshot({ path: join(shots, "t13-3-h-notch-preview-mobile-top.png") });
  await nav(phone, "Settings");
  await phone.getByRole("button", { name: /About Bunny/ }).click();
  await phone.getByRole("button", { name: "Open design preview" }).click();
  await phone.locator(".dp-style-cell").first().waitFor();
  const galleryOverflow = await phone.evaluate(() => {
    const table = document.querySelector(".dp-style-cell")?.closest("table, [role='table'], .dp-styles, section");
    const scroller = table?.parentElement;
    return { doc: document.documentElement.scrollWidth - window.innerWidth, contained: scroller ? getComputedStyle(scroller).overflowX : null };
  });
  check("mobile: the design-preview gallery does not overflow the page (any wide table scrolls inside its own box)", galleryOverflow.doc <= 0, galleryOverflow);
  await phone.screenshot({ path: join(shots, "t13-3-h-design-preview-mobile.png") });
  await mobile.close();
} catch (error) {
  check("QA script completed", false, String(error?.stack ?? error).slice(0, 800));
} finally {
  await browser.close();
}
check("no console errors on desktop or mobile", consoleErrors.length === 0, consoleErrors.slice(0, 10));
receipt.checks = checks;
receipt.notes = notes;
receipt.consoleErrors = consoleErrors;
writeFileSync(join(here, "appearance-qa.json"), JSON.stringify(receipt, null, 2));
const failed = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(`checks: ${Object.keys(checks).length}; failed: ${failed.length}${failed.length ? " → " + failed.join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
