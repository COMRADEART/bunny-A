#!/usr/bin/env node
/** E1 PROPOSED-CONCEPT captures: the two Liquid Glass defaults at anchors 0/50/85/100 plus the limited case,
 *  desktop and mobile. Reads the BUILT preview (scripts/preview-platform.mjs restart) at 127.0.0.1:8081 with the
 *  ?uitheme&theme&glassintensity links (screenshots need the Host online for anything else, and none of this saves).
 *  Output: screenshots-e1/<case>.png + a verdict JSON. Never asserted as live data. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8081";
const outDir = resolve("docs/ux/captures-e1");
mkdirSync(outDir, { recursive: true });

const CASES = [
  { id: "silver-0", query: "?uitheme=glass&theme=light&glassintensity=0" },
  { id: "silver-50", query: "?uitheme=glass&theme=light&glassintensity=50" },
  { id: "silver-85", query: "?uitheme=glass&theme=light&glassintensity=85" },
  { id: "silver-100", query: "?uitheme=glass&theme=light&glassintensity=100" },
  { id: "graphite-0", query: "?uitheme=glass&theme=dark&glassintensity=0" },
  { id: "graphite-85", query: "?uitheme=glass&theme=dark&glassintensity=85" },
  { id: "graphite-100", query: "?uitheme=glass&theme=dark&glassintensity=100" },
];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const verdict = { base, captured: [], errors: [] };
try {
  for (const vp of [{ name: "desktop", width: 1280, height: 800 }, { name: "mobile", width: 390, height: 844 }]) {
    for (const item of CASES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err?.message || err)));
      page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
      try {
        // One navigation per case; the theme/view links apply when the store hydrates (later when the Host is offline),
        // so wait for the themed root to carry this case's own intensity attribute, then for the gallery slider.
        await page.goto(new URL(`${item.query}&view=settings`, base).href, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector(`.bunny-app[data-glass-intensity="${item.query.match(/glassintensity=(\d+)/)[1]}"]`, { timeout: 20000 });
        await page.waitForSelector("input[type=range][aria-label='Glass intensity']", { timeout: 20000 });
        await page.waitForTimeout(600);
        const path = resolve(outDir, `${item.id}-${vp.name}.png`);
        await page.evaluate(() => {
          const tag = document.createElement("div");
          tag.textContent = "PROPOSED CONCEPT — E1 Glass Intensity (design capture, not live data)";
          tag.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;font:600 11px 'Segoe UI',sans-serif;color:#111;background:#ffd;padding:4px 8px;border-radius:4px;opacity:.92";
          document.body.appendChild(tag);
        });
        await page.screenshot({ path, fullPage: false });
        const note = await page.locator("[data-glass-limited='true']").count();
        verdict.captured.push({ id: item.id, viewport: vp.name, path, pageErrors: errors, limitedAttr: note });
      } catch (err) {
        verdict.errors.push({ id: item.id, viewport: vp.name, error: String(err?.message || err) });
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
writeFileSync(resolve(outDir, "verdict.json"), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify({ captured: verdict.captured.length, errors: verdict.errors.length, outDir }, null, 2));
process.exitCode = verdict.errors.length ? 1 : 0;