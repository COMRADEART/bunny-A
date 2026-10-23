// BUNNY-A MA3 T13 final hardware acceptance — Phase 1 web probe (HEAD source).
// Read-only against the running dev server (http://127.0.0.1:8080). No Host
// mutation, no production contact. Writes only its own JSON + screenshots.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const dir = resolve(import.meta.dirname);
mkdirSync(join(dir, "shots"), { recursive: true });
const out = { startedAt: new Date().toISOString(), views: {}, keyboard: null, consoleErrors: [] };
const errors = [];
const j = (f, o) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2) + "\n");

const VIEWS = [
  ["home", "/"],
  ["tasks", "/?view=tasks"],
  ["approvals", "/?view=approvals"],
  ["agents", "/?view=agents"],
  ["settings", "/?view=settings"],
  ["phone", "/?companion=1"],
];

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 500)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 500)));

  for (const [name, url] of VIEWS) {
    await page.goto("http://127.0.0.1:8080" + url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => {
      const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .filter((h) => h.getBoundingClientRect().height > 0 || h.textContent.trim())
        .map((h) => ({ level: h.tagName.toLowerCase(), text: h.textContent.trim().slice(0, 80) }));
      const skipped = [];
      for (let i = 1; i < headings.length; i++) {
        const a = Number(headings[i - 1].level.slice(1)), b = Number(headings[i].level.slice(1));
        if (b > a + 1) skipped.push(`${headings[i - 1].level}("${headings[i - 1].text.slice(0, 30)}") -> ${headings[i].level}("${headings[i].text.slice(0, 30)}")`);
      }
      const landmarks = {
        header: document.querySelectorAll("header").length,
        nav: document.querySelectorAll("nav,[role=navigation]").length,
        main: document.querySelectorAll("main,[role=main]").length,
        footer: document.querySelectorAll("footer,[role=contentinfo]").length,
      };
      const skip = [...document.querySelectorAll("a")].find((a) => /skip to content/i.test(a.textContent || ""));
      const unnamed = [...document.querySelectorAll("button,a,input,select,textarea,[tabindex]")]
        .filter((el) => {
          const ti = el.getAttribute("tabindex");
          if (ti !== null && Number(ti) < 0) return false;
          if (el.getAttribute("aria-hidden") === "true") return false;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder") || el.getAttribute("value") || "").trim();
          return name.length === 0;
        })
        .map((el) => `<${el.tagName.toLowerCase()} class="${(el.className.baseVal ?? el.className ?? "").toString().slice(0, 60)}">`)
        .slice(0, 20);
      const live = [...document.querySelectorAll("[aria-live],[role=status],[role=alert]")].map((el) => ({
        tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), live: el.getAttribute("aria-live"),
        text: (el.textContent || "").trim().slice(0, 100),
      })).slice(0, 20);
      const buttons = [...document.querySelectorAll("button")]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.getAttribute("tabindex") !== "-1"; })
        .map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 60).replace(/\s+/g, " "))
        .slice(0, 40);
      return {
        title: document.title, headings, skippedLevels: skipped, landmarks,
        skipLink: !!skip, bodyTextLen: document.body.innerText.length,
        unnamedInteractive: unnamed, unnamedCount: unnamed.length,
        liveRegions: live, liveCount: live.length, visibleButtons: buttons, buttonCount: buttons.length,
      };
    });
    out.views[name] = data;
    console.log(`VIEW ${name}: h1=${data.headings.filter((h) => h.level === "h1").length} headings=${data.headings.length} skipped=${data.skippedLevels.length} unnamed=${data.unnamedCount} live=${data.liveCount} buttons=${data.buttonCount} skip=${data.skipLink}`);
    if (name === "home") await page.screenshot({ path: join(dir, "shots", "home-desktop-1280.png") });
    if (name === "tasks") await page.screenshot({ path: join(dir, "shots", "tasks-desktop-1280.png") });
    if (name === "approvals") await page.screenshot({ path: join(dir, "shots", "approvals-desktop-1280.png") });
  }

  // Keyboard walkthrough on Home: start from the skip link, 40 Tab stops.
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  const stops = await page.evaluate(async () => {
    const out = [];
    const first = [...document.querySelectorAll("a")].find((a) => /skip to content/i.test(a.textContent || ""));
    if (first) first.focus(); else document.body.focus();
    const name = () => {
      const el = document.activeElement;
      if (!el || el === document.body) return { role: "body", name: "(body)" };
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      const n = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.value || "").trim().replace(/\s+/g, " ").slice(0, 70);
      return { role, name: n || "(UNNAMED)" };
    };
    out.push({ stop: 0, ...name() });
    for (let i = 1; i <= 40; i++) {
      const before = document.activeElement;
      document.activeElement?.blur?.();
      // Simulate real Tab order traversal via focus navigation.
      const focusables = [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")]
        .filter((el) => el.getAttribute("tabindex") !== "-1" && el.getAttribute("aria-hidden") !== "true" && !el.disabled && el.getClientRects().length > 0);
      const idx = focusables.indexOf(before);
      const next = focusables[(idx + 1) % focusables.length];
      if (!next) break;
      next.focus();
      out.push({ stop: i, ...name() });
      if (next === focusables[0] && i > 5) { out.push({ wrapped: true }); break; }
    }
    return out;
  });
  const unnamedStops = stops.filter((s) => s.name === "(UNNAMED)");
  out.keyboard = { stops, unnamedStops: unnamedStops.length, wrapped: stops.some((s) => s.wrapped) };
  console.log(`KEYBOARD: ${stops.length} stops, unnamed=${unnamedStops.length}, wrapped=${out.keyboard.wrapped}`);

  // Mobile home pass.
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("console", (m) => { if (m.type() === "error") errors.push("[mobile] " + m.text().slice(0, 500)); });
  mp.on("pageerror", (e) => errors.push("[mobile] pageerror: " + String(e).slice(0, 500)));
  await mp.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await mp.waitForTimeout(1500);
  out.mobile = await mp.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => ({ level: h.tagName.toLowerCase(), text: h.textContent.trim().slice(0, 60) })),
  }));
  await mp.screenshot({ path: join(dir, "shots", "home-mobile-390.png") });
  console.log(`MOBILE: overflow=${out.mobile.overflow} headings=${out.mobile.headings.length}`);
  await mctx.close();
  await ctx.close();
} finally {
  await browser.close();
}
out.consoleErrors = errors;
out.finished = true;
j("a11y-narrator-probe.json", out);
console.log("consoleErrors:", errors.length);
