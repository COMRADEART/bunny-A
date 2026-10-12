// T13 PERF lane (web, LIVE): Playwright chromium against the disposable perf Host (port 43880) through the dev server on 8096.
// Measures rAF FPS, CDP Performance metrics, animation counts, hidden/off-screen pausing, reduced-motion and Motion=Off,
// the 330-character design preview stress case, and a keyboard-only focus audit. Writes perf/web-perf.json and PNGs.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = resolve("test-results/ma3/t13/perf");
const shots = resolve(here, "shots");
mkdirSync(shots, { recursive: true });
const BASE = "http://127.0.0.1:8096";
const PREF_KEY = "bunny-a.preferences.v1";
const result = {
  label: "LIVE (real disposable Host 43880 + dev server 8096 + Playwright chromium 1.63)",
  generatedAt: new Date().toISOString(),
  viewport: "1920x1080",
  colorScheme: "light",
  checks: {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metrics = async (cdp) => {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
};
// Runs in the page: counts requestAnimationFrame callbacks over `ms` and resolves after the window.
const frameCounter = (ms) =>
  new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const f = () => {
      n++;
      if (performance.now() - t0 < ms) requestAnimationFrame(f);
      else resolve({ frames: n, ms: Math.round(performance.now() - t0) });
    };
    requestAnimationFrame(f);
  });
// Runs in the page: animation and character state snapshot.
const animStats = () => {
  const all = document.getAnimations();
  const chars = [...document.querySelectorAll(".wc-weapon, .wc-companion")];
  const charAnims = all.filter((a) => a.effect?.target?.closest?.(".wc-weapon, .wc-companion"));
  const count = (list, state) => list.filter((a) => a.playState === state).length;
  return {
    documentAnimations: all.length,
    documentRunning: count(all, "running"),
    documentPaused: count(all, "paused"),
    characterElements: chars.length,
    characterAnimations: charAnims.length,
    characterRunning: count(charAnims, "running"),
    characterPaused: count(charAnims, "paused"),
    pausedAttrElements: chars.filter((el) => el.getAttribute("data-paused") === "true").length,
    cssPlayStatePausedElements: chars.filter((el) => getComputedStyle(el).animationPlayState === "paused").length,
    weapons: [...document.querySelectorAll(".wc-weapon")].map((el) => ({ weapon: el.dataset.weapon, state: el.dataset.state, base: el.dataset.base, effect: el.dataset.effect, reduced: el.dataset.reduced, paused: el.dataset.paused ?? null })),
    companion: [...document.querySelectorAll(".wc-companion")].map((el) => ({ state: el.dataset.state, reduced: el.dataset.reduced, paused: el.dataset.paused ?? null })),
  };
};
// Runs in the page: the nearest scrollable ancestor of the first character (used to scroll characters out of view).
const findScroller = () => {
  const el = document.querySelector(".wc-weapon") ?? document.querySelector(".wc-companion");
  let node = el?.parentElement;
  while (node && !(node.scrollHeight > node.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
  return node;
};
// Runs in the page: names and roles for the keyboard audit, with no eval.
const focusableAudit = () => {
  const nameOf = (el) => {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
      if (t) return t;
    }
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return al.trim();
    if (el.tagName === "IMG" && el.alt) return el.alt;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
      const l = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
      if (l?.textContent?.trim()) return l.textContent.trim();
      if (el.placeholder) return "placeholder: " + el.placeholder;
      if (el.title) return "title: " + el.title;
    }
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt) return txt.slice(0, 80);
    const img = el.querySelector("img[alt]");
    if (img?.alt) return img.alt;
    if (el.title) return "title: " + el.title;
    return "";
  };
  const roleOf = (el) => el.getAttribute("role") || ({ BUTTON: "button", A: "link", INPUT: "input", TEXTAREA: "textbox", SELECT: "combobox" })[el.tagName] || el.tagName.toLowerCase();
  return Array.from(document.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="switch"], [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.disabled && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden")
    .map((el) => ({ tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), tabIndex: el.tabIndex }));
};
// Runs in the page after a Tab press: the focused element with its name.
const focusedNow = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: "body", role: null, name: "" };
  const lb = el.getAttribute("aria-labelledby");
  const name = (el.getAttribute("aria-label") || (lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ") : "") || el.textContent || el.placeholder || el.title || el.querySelector("img[alt]")?.alt || "").replace(/\s+/g, " ").trim().slice(0, 70);
  return { tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), name };
};

const browser = await chromium.launch({ headless: true });
const newPage = async (opts = {}) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light", ...(opts.context ?? {}) });
  if (opts.pref) {
    const value = JSON.stringify(opts.pref);
    await context.addInitScript(([key, val]) => { try { localStorage.setItem(key, val); } catch { /* storage blocked */ } }, [PREF_KEY, value]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 240)); });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message.slice(0, 240)));
  return { context, page, errors };
};

try {
  // (1) Chat + context panel, idle and visible, 10 s window.
  {
    const { context, page, errors } = await newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".wc-weapon", { timeout: 90000 });
    await sleep(3000);
    const before = await page.evaluate(animStats);
    await page.screenshot({ path: resolve(shots, "chat-light-1920x1080.png") });
    const m0 = await metrics(cdp);
    const t0 = Date.now();
    const fr = await page.evaluate(frameCounter, 10000);
    const elapsed = Date.now() - t0;
    const m1 = await metrics(cdp);
    const d = (k) => +(m1[k] - m0[k]).toFixed(4);
    const winSec = m1.Timestamp - m0.Timestamp;
    result.checks.chatIdleVisible = {
      windowSecondsCdp: +winSec.toFixed(3),
      windowMsWallclock: elapsed,
      rafFrames: fr.frames,
      rafFpsMeasured: +(fr.frames / (fr.ms / 1000)).toFixed(2),
      taskDurationSec: d("TaskDuration"),
      mainThreadBusyPercent: +((100 * d("TaskDuration")) / winSec).toFixed(2),
      scriptDurationSec: d("ScriptDuration"),
      layoutDurationSec: d("LayoutDuration"),
      recalcStyleDurationSec: d("RecalcStyleDuration"),
      jsHeapUsedMB_end: +(m1.JSHeapUsedSize / 1048576).toFixed(2),
      jsHeapTotalMB_end: +(m1.JSHeapTotalSize / 1048576).toFixed(2),
      nodes_end: m1.Nodes,
      animationsBefore: before,
      animationsAfter: await page.evaluate(animStats),
      visibilityState: await page.evaluate(() => document.visibilityState),
      consoleErrors: errors,
    };

    // (2a) Hidden: a second tab takes focus, so this page is hidden. Pause and frame throttling are measured.
    const second = await context.newPage();
    await second.goto(`${BASE}/?view=design-preview&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
    await second.bringToFront();
    await sleep(2000);
    const hiddenProbe = await page.evaluate(() => ({ hidden: document.hidden, visibilityState: document.visibilityState }));
    const hiddenAnims = await page.evaluate(animStats);
    const hiddenRaf = await page.evaluate(frameCounter, 3000);
    result.checks.documentHidden = { probe: hiddenProbe, animations: hiddenAnims, rafFramesOver3s: hiddenRaf.frames, rafWindowMs: hiddenRaf.ms, note: "Second tab brought to front. Frame count measured in the hidden page, not assumed." };
    await page.bringToFront();
    await sleep(1000);
    await second.close();

    // (2b) Off-screen: scroll the nearest scrollable ancestor of the weapon strip so the characters leave the viewport.
    await page.evaluate((src) => { window.__findScroller = eval("(" + src + ")"); }, findScroller.toString());
    const scrollerInfo = await page.evaluate(() => {
      const s = window.__findScroller();
      return s ? { tag: s.tagName, class: String(s.className).slice(0, 80), scrollHeight: s.scrollHeight, clientHeight: s.clientHeight } : null;
    });
    const rectBefore = await page.evaluate(() => { const r = (document.querySelector(".wc-weapon") ?? document.querySelector(".wc-companion")).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
    await page.evaluate(() => { const s = window.__findScroller(); if (s) s.scrollTop = s.scrollHeight; });
    await sleep(1200);
    const offscreenAfter = await page.evaluate(() => {
      const el = document.querySelector(".wc-weapon") ?? document.querySelector(".wc-companion");
      const r = el.getBoundingClientRect();
      const s = window.__findScroller();
      const sr = s?.getBoundingClientRect();
      return {
        rectAfter: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        intersectsViewport: r.bottom > 0 && r.top < window.innerHeight,
        scrollerClipRect: sr ? { top: Math.round(sr.top), bottom: Math.round(sr.bottom) } : null,
        dataPausedAfterScroll: [...document.querySelectorAll(".wc-weapon, .wc-companion")].map((x) => x.dataset.paused ?? null),
        documentRunningAfterScroll: document.getAnimations().filter((a) => a.playState === "running" && a.effect?.target?.closest?.(".wc-weapon, .wc-companion")).length,
      };
    });
    await page.evaluate(() => { const s = window.__findScroller(); if (s) s.scrollTop = 0; });
    await sleep(1200);
    result.checks.offscreenScroll = { scroller: scrollerInfo, rectBefore, ...offscreenAfter, dataPausedAfterScrollBack: await page.evaluate(() => [...document.querySelectorAll(".wc-weapon, .wc-companion")].map((x) => x.dataset.paused ?? null)) };
    await context.close();
  }

  // (3a) OS reduced motion (prefers-reduced-motion: reduce).
  {
    const { context, page, errors } = await newPage({ context: { reducedMotion: "reduce" } });
    await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".wc-weapon", { timeout: 90000 });
    await sleep(2500);
    const stats = await page.evaluate(animStats);
    result.checks.reducedMotionOS = {
      mediaQueryMatches: await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      characterRunning: stats.characterRunning,
      characterAnimationsTotal: stats.characterAnimations,
      documentRunning: stats.documentRunning,
      weapons: stats.weapons,
      companion: stats.companion,
      consoleErrors: errors,
    };
    await context.close();
  }

  // (3b) App Motion = Off (stored preference), OS motion default.
  {
    const { context, page, errors } = await newPage({ pref: { theme: "light", appearance: { motion: "off" } } });
    await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".wc-weapon", { timeout: 90000 });
    await sleep(2500);
    const stats = await page.evaluate(animStats);
    result.checks.motionOff = {
      appDataMotion: await page.evaluate(() => document.querySelector(".bunny-app")?.getAttribute("data-motion")),
      characterRunning: stats.characterRunning,
      characterAnimationsTotal: stats.characterAnimations,
      documentRunning: stats.documentRunning,
      weapons: stats.weapons,
      companion: stats.companion,
      consoleErrors: errors,
    };
    await page.screenshot({ path: resolve(shots, "chat-motion-off-1920x1080.png") });
    await context.close();
  }

  // (4) Design preview: the 330-character stress case.
  {
    const { context, page, errors } = await newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.goto(`${BASE}/?view=design-preview&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".wc-weapon, .wc-companion", { timeout: 90000 });
    await sleep(3000);
    const before = await page.evaluate(animStats);
    await page.screenshot({ path: resolve(shots, "design-preview-light-1920x1080.png") });
    const m0 = await metrics(cdp);
    const fr = await page.evaluate(frameCounter, 10000);
    const m1 = await metrics(cdp);
    const winSec = m1.Timestamp - m0.Timestamp;
    const dd = (k) => +(m1[k] - m0[k]).toFixed(4);
    result.checks.designPreviewStress = {
      characterElements: before.characterElements,
      animationsBefore: { documentRunning: before.documentRunning, characterAnimations: before.characterAnimations, characterRunning: before.characterRunning, characterPaused: before.characterPaused },
      windowSecondsCdp: +winSec.toFixed(3),
      rafFpsMeasured: +(fr.frames / (fr.ms / 1000)).toFixed(2),
      mainThreadBusyPercent: +((100 * dd("TaskDuration")) / winSec).toFixed(2),
      scriptDurationSec: dd("ScriptDuration"),
      layoutDurationSec: dd("LayoutDuration"),
      recalcStyleDurationSec: dd("RecalcStyleDuration"),
      jsHeapUsedMB_end: +(m1.JSHeapUsedSize / 1048576).toFixed(2),
      nodes_end: m1.Nodes,
      consoleErrors: errors,
    };
    await context.close();
  }

  // (5) Keyboard-only: static named-control audit and a Tab trace on Chat and Approvals.
  const traceTabs = async (view, label, presses = 60) => {
    const { context, page, errors } = await newPage();
    await page.goto(`${BASE}/?view=${view}&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".bunny-app", { timeout: 90000 });
    await sleep(2500);
    const controls = await page.evaluate(focusableAudit);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    const sequence = [];
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press("Tab");
      sequence.push(await page.evaluate(focusedNow));
    }
    const keys = sequence.map((s) => `${s.tag}|${s.role ?? ""}|${s.name}`);
    const firstRepeat = keys.findIndex((k, i) => keys.indexOf(k) < i);
    const unnamed = controls.filter((c) => !c.name);
    result.checks[label] = {
      view,
      focusableControls: controls.length,
      unnamedControls: unnamed.length,
      unnamedSample: unnamed.slice(0, 20),
      tabSequence: sequence.map((s, i) => `${i + 1}. ${s.tag}${s.role ? "[" + s.role + "]" : ""} "${s.name}"`),
      tabRepeatsAtStep: firstRepeat === -1 ? null : firstRepeat + 1,
      consoleErrors: errors,
    };
    await page.screenshot({ path: resolve(shots, `${label}-light-1920x1080.png`) });
    await context.close();
  };
  await traceTabs("chat", "keyboardChat");
  await traceTabs("approvals", "keyboardApprovals");

  // Studio: keyboard open of the slot 1 editor, focus placement, then Escape.
  {
    const { context, page, errors } = await newPage();
    await page.goto(`${BASE}/?view=agents&theme=light`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("button", { timeout: 90000 });
    await sleep(2500);
    const editBtn = page.getByRole("button", { name: /Edit slot 1/i }).first();
    const editFound = (await editBtn.count()) > 0;
    if (editFound) {
      await editBtn.focus();
      const beforeName = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 60));
      await page.keyboard.press("Enter");
      await sleep(800);
      const openFocus = await page.evaluate(() => { const e = document.activeElement; return { tag: e?.tagName, role: e?.getAttribute("role"), text: e?.textContent?.trim().slice(0, 80) }; });
      const openInfo = await page.evaluate(() => ({ roleDialog: document.querySelectorAll("[role=dialog]").length, ariaModal: document.querySelectorAll("[aria-modal=true]").length, headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => h.textContent.trim().slice(0, 60)).slice(0, 10), textareaCount: document.querySelectorAll("textarea").length, inputCount: document.querySelectorAll("input").length }));
      await page.screenshot({ path: resolve(shots, "studio-editor-open-1920x1080.png") });
      await page.keyboard.press("Escape");
      await sleep(800);
      const afterEsc = await page.evaluate(() => { const e = document.activeElement; return { tag: e?.tagName, text: e?.textContent?.trim().slice(0, 60), textareaCount: document.querySelectorAll("textarea").length, inputCount: document.querySelectorAll("input").length }; });
      result.checks.studioEditor = { editButtonFound: true, triggerFocusBeforeEnter: beforeName, focusAfterEnter: openFocus, openState: openInfo, afterEscape: afterEsc, focusReturnedToTrigger: afterEsc.text === beforeName, consoleErrors: errors };
    } else {
      result.checks.studioEditor = { editButtonFound: false, consoleErrors: errors };
    }
    await context.close();
  }
} catch (error) {
  result.fatal = String(error?.stack ?? error).slice(0, 2000);
} finally {
  await browser.close();
  writeFileSync(resolve(here, "web-perf.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: "perf/web-perf.json", fatal: result.fatal ?? null, checks: Object.keys(result.checks) }, null, 2));
}
