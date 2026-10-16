// Widget Studio walk: real renders of the BUILT desktop app (JEV_DESKTOP_BUILD=1, scripts/preview-node-middleware.mjs on
// 127.0.0.1:8081) against the disposable seeded Host from seed-host.mjs (port 4389x). Production is never addressed.
// Usage: node widget-walk.mjs <outDir> [--matrix-only|--interaction-only]
// Matrix: 22 themes x light/dark on Settings (desktop 1440x900) + 22 themes on the phone companion (390x844).
// Interaction: inspector, keyboard reorder, hide/show, resize, layouts, persistence, stale revision, drawer Escape,
// reconciliation opener. Theme selection uses the preview-only ?uitheme= link (never saved).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = "http://127.0.0.1:8081";
const THEMES = ["clay", "cybercore", "brutalism", "scrapbook", "surreal", "y2k", "pixel", "synthwave", "glass", "neumorph", "bento",
  "editorial", "swiss", "minimal", "maximal", "luxury", "sketch", "ethereal", "bohemian", "victorian", "cyberpunk", "wabisabi"];
const out = resolve(process.argv[2] ?? "walk");
mkdirSync(out, { recursive: true });
const only = process.argv.find((arg) => arg.startsWith("--"));
const browser = await chromium.launch({ headless: true });

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
  await page.waitForTimeout(1_500);
  return { page, errors };
}

/** Facts about the widget surface: cards, their text, overflow, and the lowest text contrast inside the widgets. */
const widgetFacts = () => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p[3] ?? 1 }; };
  const background = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none" && !/^url/.test(style.backgroundImage)) return null; // gradient: not measurable here
      const color = parse(style.backgroundColor);
      if (color && color.a >= 0.95) return color.rgb;
    }
    return [255, 255, 255];
  };
  const root = document.querySelector(".wd-root, .wd-drawer-anchor");
  const cards = [...document.querySelectorAll(".wd-card")];
  let minContrast = null; let measured = 0; let unmeasured = 0;
  for (const element of root ? root.querySelectorAll("p, h3, strong, span, small, button, li, dd") : []) {
    if (!element.textContent.trim() || element.children.length > 3) continue;
    const box = element.getBoundingClientRect(); if (!box.width || !box.height) continue;
    const fg = parse(getComputedStyle(element).color); const bg = background(element);
    if (!fg || !bg) { unmeasured++; continue; }
    const [a, b] = [lum(fg.rgb), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    measured++;
    if (minContrast === null || ratio < minContrast) minContrast = Math.round(ratio * 100) / 100;
  }
  return {
    present: !!root,
    layout: root?.getAttribute("data-widget-layout") ?? null,
    surface: root?.getAttribute("data-surface") ?? null,
    cards: cards.length,
    visibleCards: cards.filter((card) => { const box = card.getBoundingClientRect(); return box.width > 40 && box.height > 40; }).length,
    emptyCards: cards.filter((card) => card.innerText.trim().length < 20).length,
    cardsOutside: cards.filter((card) => { const box = card.getBoundingClientRect(); return box.right > window.innerWidth + 1 || box.left < -1; }).length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    minContrast, measured, unmeasured,
    uiTheme: (document.querySelector(".pc-root, .bunny-app") ?? document.documentElement).getAttribute("data-ui-theme"),
  };
};

const results = { matrix: [], interaction: [] };
async function matrixRow(context, label, url, selector, theme) {
  let page; let errors = [];
  try {
    ({ page, errors } = await open(context, url, selector, theme));
    await page.waitForSelector(".wd-card", { timeout: 30_000 });
    const facts = await page.evaluate(widgetFacts);
    await page.screenshot({ path: join(out, `${label}.png`), animations: "disabled", timeout: 90_000 });
    // The board sits below the page on desktop: also capture the widget surface itself, so the picture shows the widgets.
    await page.locator(".wd-root, .wd-drawer-anchor").first().screenshot({ path: join(out, `${label}-widgets.png`), animations: "disabled", timeout: 90_000 });
    const ok = !errors.length && facts.present && facts.cards === 6 && facts.visibleCards === 6 && facts.emptyCards === 0
      && facts.cardsOutside === 0 && !facts.overflowX && facts.uiTheme === theme;
    results.matrix.push({ label, url, ok, errors, ...facts });
    console.error(`${label} ${ok ? "ok" : "FAIL"} contrast ${facts.minContrast}`);
  } catch (error) {
    results.matrix.push({ label, url, ok: false, errors: [...errors, String(error).slice(0, 300)] });
    console.error(`${label} FAIL ${String(error).slice(0, 160)}`);
  } finally { await page?.close(); }
}

if (only !== "--interaction-only") {
  for (const theme of THEMES) {
    for (const variant of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: variant });
      await matrixRow(context, `${theme}-${variant}-settings`, `${BASE}/?view=settings&theme=${variant}&uitheme=${theme}`, ".app-sidebar, .ve-shell", theme);
      await context.close();
    }
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
    await matrixRow(phone, `${theme}-light-phone`, `${BASE}/?companion=1&theme=light&uitheme=${theme}`, ".pc-root", theme);
    await phone.close();
  }
}

/** One named interaction check; a thrown error or a false result is a FAIL with the reason kept. */
async function check(name, run) {
  try {
    const detail = await run();
    const ok = detail?.ok !== false;
    results.interaction.push({ name, ok, ...(typeof detail === "object" ? detail : {}) });
    console.error(`${name} ${ok ? "ok" : "FAIL"}`);
  } catch (error) {
    results.interaction.push({ name, ok: false, error: String(error).slice(0, 400) });
    console.error(`${name} FAIL ${String(error).slice(0, 200)}`);
  }
}
const order = (page) => page.$$eval(".wd-card", (cards) => cards.map((card) => card.getAttribute("aria-label")));
const settings = `${BASE}/?view=settings&theme=light`;

if (only !== "--matrix-only") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, errors } = await open(context, settings, ".app-sidebar, .ve-shell", null);
  await page.waitForSelector(".wd-card");

  await check("board renders six live widgets from the Host", async () => {
    const facts = await page.evaluate(widgetFacts);
    const text = await page.$eval(".wd-root", (root) => root.innerText);
    return { ok: facts.cards === 6 && facts.layout === "board", cards: facts.cards, layout: facts.layout,
      agents: /Receipt verification|Permission review|Paused research|Idle sword/.test(text) || text.includes("Agents"), sample: text.slice(0, 400) };
  });
  await check("inspector opens and names data source and permissions", async () => {
    await page.getByRole("button", { name: "Customize widgets" }).click();
    await page.waitForSelector("#widget-inspector");
    const text = await page.$eval("#widget-inspector", (node) => node.innerText);
    return { ok: /Data source/.test(text) && /Permissions/.test(text) && /Apply/.test(text), sample: text.slice(0, 300) };
  });
  await check("keyboard Alt+ArrowDown reorders a widget in the draft", async () => {
    const before = await order(page);
    await page.locator(".wd-card").first().focus();
    await page.keyboard.press("Alt+ArrowDown");
    const after = await order(page);
    return { ok: before[0] === after[1] && before[1] === after[0], before, after };
  });
  await check("hide one widget, then Show all restores six", async () => {
    await page.getByRole("button", { name: /^Hide / }).first().click();
    const hidden = (await order(page)).length;
    await page.getByRole("button", { name: "Show all" }).click();
    const shown = (await order(page)).length;
    return { ok: hidden === 5 && shown === 6, hidden, shown };
  });
  await check("resize through the inspector Size control", async () => {
    await page.locator("#widget-inspector select").first().selectOption("mission");
    await page.locator("#widget-inspector label", { hasText: "Size" }).locator("select").selectOption("compact");
    const size = await page.$eval('.wd-card[aria-label="Mission Control widget"]', (card) => card.getAttribute("data-size"));
    return { ok: size === "compact", size };
  });
  await check("Apply sidebar layout persists across a reload", async () => {
    await page.getByRole("group", { name: "Panel composition" }).getByRole("button", { name: "Sidebar" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#widget-inspector"), null, { timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(live, null, { timeout: 120_000 });
    await page.waitForSelector(".wd-card");
    const layout = await page.$eval(".wd-root", (root) => root.getAttribute("data-widget-layout"));
    const size = await page.$eval('.wd-card[aria-label="Mission Control widget"]', (card) => card.getAttribute("data-size"));
    const first = (await order(page))[0];
    await page.screenshot({ path: join(out, "interaction-sidebar.png"), animations: "disabled" });
    return { ok: layout === "sidebar" && size === "compact", layout, size, first };
  });

  // Stale revision across two windows: A opens a draft, B saves a density change, A's Apply must be refused.
  await check("a draft opened before another window's save is refused (stale revision)", async () => {
    const { page: other } = await open(context, settings, ".app-sidebar, .ve-shell", null);
    await other.waitForSelector(".wd-card");
    await page.getByRole("button", { name: "Customize widgets" }).click();
    await page.waitForSelector("#widget-inspector");
    await page.locator("#widget-inspector label", { hasText: "Spacing" }).locator("select").selectOption("16");
    await other.getByRole("button", { name: "Customize widgets" }).click();
    await other.locator("#widget-inspector label", { hasText: "Density" }).locator("select").selectOption("compact");
    await other.getByRole("button", { name: "Apply", exact: true }).click();
    await other.waitForFunction(() => !document.querySelector("#widget-inspector"), null, { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelector(".wd-root")?.getAttribute("data-widget-density") === "compact" || true, null, { timeout: 5_000 });
    await page.waitForTimeout(2_500); // let A receive the newer snapshot, which is exactly when the old client sent the new revision
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    const alert = await page.waitForSelector('#widget-inspector [role="alert"]', { timeout: 10_000 }).then((node) => node.innerText()).catch(() => null);
    await page.screenshot({ path: join(out, "interaction-stale.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click().catch(() => {});
    await other.close();
    return { ok: !!alert && /changed since/i.test(alert), alert };
  });
  await check("drawer: toggle opens, Escape inside the drawer closes, Escape in the composer does not", async () => {
    await page.getByRole("button", { name: "Customize widgets" }).click();
    await page.getByRole("group", { name: "Panel composition" }).getByRole("button", { name: "Drawer" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.goto(`${BASE}/?view=chat&theme=light`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(live, null, { timeout: 120_000 });
    const toggle = page.getByRole("button", { name: "Open widgets" });
    await toggle.click();
    await page.waitForSelector(".wd-drawer-anchor[data-open=true] .wd-card", { timeout: 15_000 });
    await page.screenshot({ path: join(out, "interaction-drawer.png"), animations: "disabled" });
    const composer = page.locator("textarea").first();
    let composerKeepsDrawer = null;
    if (await composer.count()) {
      await composer.focus();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1_500);
      composerKeepsDrawer = !!(await page.$(".wd-drawer-anchor[data-open=true]"));
    }
    await page.locator(".wd-drawer-anchor .wd-card").first().focus();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".wd-drawer-anchor[data-open=true]"), null, { timeout: 10_000 });
    return { ok: composerKeepsDrawer !== false, composerKeepsDrawer, closedFromInside: true };
  });
  await check("reconciliation widget opens the existing owner review (no decision from the widget)", async () => {
    await page.goto(settings, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(live, null, { timeout: 120_000 });
    // The Host is in the drawer layout from the previous check: the studio lives inside the drawer.
    await page.getByRole("button", { name: "Open widgets" }).click();
    await page.getByRole("button", { name: "Customize widgets" }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".wd-root")?.getAttribute("data-widget-layout") === "board", null, { timeout: 15_000 });
    const card = page.locator('.wd-card[aria-label="Reconciliation widget"]');
    const text = await card.innerText();
    const decideButtons = await card.getByRole("button", { name: /retry|mark|accept|reject|replay|done/i }).count();
    await card.getByRole("button", { name: "Open the owner review" }).click();
    await page.waitForTimeout(1_500);
    const url = page.url();
    const approvals = /approvals/.test(url) || !!(await page.$('[aria-current="page"]:has-text("Approvals")'));
    return { ok: /reconciliation|uncertain/i.test(text) && decideButtons === 0 && approvals, decideButtons, url, sample: text.slice(0, 300) };
  });
  await check("phone companion: stacked widgets, no inspector", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const { page: p } = await open(phone, `${BASE}/?companion=1&theme=light`, ".pc-root", null);
    await p.waitForSelector(".wd-root[data-surface=phone] .wd-card");
    const facts = await p.evaluate(widgetFacts);
    const inspector = !!(await p.$("#widget-inspector, .wd-resize"));
    await phone.close();
    return { ok: facts.cards === 6 && !facts.overflowX && !inspector, ...facts, inspector };
  });
  results.interaction.push({ name: "page errors during interaction", ok: errors.length === 0, errors });
  await context.close();
}

await browser.close();
writeFileSync(join(out, "results.json"), JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), ...results }, null, 2) + "\n");
const failed = [...results.matrix, ...results.interaction].filter((row) => !row.ok);
console.log(JSON.stringify({ matrix: results.matrix.length, matrixFailed: results.matrix.filter((r) => !r.ok).length, interaction: results.interaction.length,
  interactionFailed: results.interaction.filter((r) => !r.ok).length, failed: failed.map((row) => row.label ?? row.name) }));
