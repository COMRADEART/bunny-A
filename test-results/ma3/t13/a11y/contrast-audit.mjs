// T13 A11Y lane (web, LIVE): approximate WCAG text contrast on the chat and approvals surfaces, light and dark, against the
// disposable perf Host (43880) through the dev server (8096). Effective background = alpha-composite of ancestor backgrounds
// up to the page background. Glass with backdrop-filter cannot be composited exactly, so results are APPROXIMATE and every
// flagged element is listed for a human look. Writes a11y/contrast-audit.json.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const here = resolve("test-results/ma3/t13/a11y");
mkdirSync(here, { recursive: true });
const BASE = "http://127.0.0.1:8096";
const out = { label: "LIVE page (real Host 43880) — APPROXIMATE contrast: glass/backdrop-filter is not composited; flagged items need visual confirmation", generatedAt: new Date().toISOString(), surfaces: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const audit = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    // Collect backgrounds from the element up to the root, then composite from the root down.
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (layers.length && layers[layers.length - 1].a >= 1) break;
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
    return acc;
  };
  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  const seen = new Set();
  while ((node = walker.nextNode())) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    if (!inViewport) continue;
    let fg = parse(cs.color);
    if (!fg) continue;
    const op = parseFloat(cs.opacity);
    fg = { ...fg, a: fg.a * op };
    const bg = bgOf(el);
    const composedFg = over(fg, bg);
    const L1 = lum(composedFg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    items.push({ text: text.slice(0, 60), ratio: +ratio.toFixed(2), need, fontPx: size, bold, flagged: ratio < need });
  }
  return items;
};

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ["light", "dark"]) {
    for (const [name, view] of [["chat", "chat"], ["approvals", "approvals"], ["agents-studio", "agents"]]) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: theme });
      const page = await context.newPage();
      await page.goto(`${BASE}/?view=${view}&theme=${theme}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForSelector(".bunny-app", { timeout: 90000 });
      await sleep(2500);
      const items = await page.evaluate(audit);
      const flagged = items.filter((i) => i.flagged);
      out.surfaces[`${name}-${theme}`] = { textNodesInViewport: items.length, flagged: flagged.length, minRatio: Math.min(...items.map((i) => i.ratio)), flaggedSample: flagged.slice(0, 25) };
      await context.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(resolve(here, "contrast-audit.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out.surfaces).map(([k, v]) => [k, { n: v.textNodesInViewport, flagged: v.flagged, minRatio: v.minRatio }])), null, 2));
}
